// Multi-output PCZT construction and strict inspection using the pinned wallet/PCZT crates.
// source: zcash/zcash-devtool@5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8:src/commands/pczt/create.rs
use std::{io::{self, Read}, num::NonZeroUsize, path::Path, str::FromStr};
use anyhow::{anyhow, ensure, Context};
use orchard::pczt::Bundle;
use pczt::{Pczt, roles::verifier::{Verifier, OrchardError}};
use rand::rngs::OsRng;
use serde_json::{json, Value};
use zcash_address::ZcashAddress;
use zcash_client_backend::{data_api::{WalletRead, WalletWrite, wallet::{ConfirmationsPolicy, create_pczt_from_proposal, input_selection::{GreedyInputSelector, SpendPolicy}, propose_transfer}}, fees::{DustOutputPolicy, SplitPolicy, StandardFeeRule, standard::MultiOutputChangeStrategy}, wallet::OvkPolicy};
use zcash_client_sqlite::{WalletDb, util::SystemClock};
use zcash_keys::{address::Address, keys::UnifiedFullViewingKey};
use zcash_protocol::{consensus::Network, ShieldedPool, value::Zatoshis};
use zip321::{Payment, TransactionRequest};

fn create(wallet: &str, output: &str) -> anyhow::Result<()> {
    let mut text=String::new(); io::stdin().read_to_string(&mut text)?;
    let outputs: Vec<Value>=serde_json::from_str(&text)?;
    ensure!(!outputs.is_empty() && outputs.len()<=50,"batch must have 1–50 recipients");
    let payments=outputs.iter().enumerate().map(|(i,o)| {
        let addr=o["recipient"].as_str().context("recipient missing")?;
        let amount=o["amount_zats"].as_str().context("amount must be decimal string")?.parse::<u64>()?;
        ensure!(amount>0,"zero payment");
        Payment::new(ZcashAddress::from_str(addr)?,Some(Zatoshis::from_u64(amount)?),None,None,None,vec![]).map_err(|e|anyhow!("payment {i}: {e:?}"))
    }).collect::<anyhow::Result<Vec<_>>>()?;
    let mut db=WalletDb::for_path(Path::new(wallet).join("data.sqlite"),Network::TestNetwork,SystemClock,OsRng)?;
    let accounts=db.get_account_ids()?;
    ensure!(accounts.len()==1,"wallet must have one account");
    let change=MultiOutputChangeStrategy::new(StandardFeeRule::Zip317,None,ShieldedPool::Orchard,DustOutputPolicy::default(),SplitPolicy::with_min_output_value(NonZeroUsize::new(1).unwrap(),Zatoshis::from_u64(10_000_000)?));
    let proposal=propose_transfer::<_,_,_,_,zcash_client_sqlite::wallet::commitment_tree::Error>(&mut db,&Network::TestNetwork,accounts[0],&GreedyInputSelector::new(),&change,TransactionRequest::new(payments)?,ConfirmationsPolicy::default(),&SpendPolicy::default(),None,None).map_err(|e|anyhow!("proposal: {e:?}"))?;
    let pczt=create_pczt_from_proposal::<_,_,zcash_client_backend::data_api::wallet::input_selection::GreedyInputSelectorError,_,zcash_primitives::transaction::fees::zip317::FeeError,_>(&mut db,&Network::TestNetwork,accounts[0],OvkPolicy::Sender,&proposal,None,zcash_primitives::transaction::builder::BundlePadding::DEFAULT).map_err(|e|anyhow!("PCZT creation: {e:?}"))?;
    std::fs::write(output,pczt.serialize().map_err(|e|anyhow!("serialization: {e:?}"))?)?;
    Ok(())
}
// source: zcash/zcash-devtool@5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8:src/commands/wallet/gen_addr.rs
fn address(wallet: &str) -> anyhow::Result<()> {
    use zcash_keys::keys::UnifiedAddressRequest;
    let mut db=WalletDb::for_path(Path::new(wallet).join("data.sqlite"),Network::TestNetwork,SystemClock,OsRng)?;
    let accounts=db.get_account_ids()?;ensure!(accounts.len()==1,"wallet must have one account");
    let (ua,_)=db.get_next_available_address(accounts[0],UnifiedAddressRequest::ORCHARD)?.context("no shielded address")?;
    println!("{}",ua.encode(&Network::TestNetwork));Ok(())
}
fn inspect(file: &str, ufvk: &str) -> anyhow::Result<()> {
    let pczt=Pczt::parse(&std::fs::read(file)?).map_err(|e|anyhow!("PCZT parse: {e:?}"))?;
    ensure!(pczt.global().tx_version()==&6 && pczt.global().consensus_branch_id()==&0x37a5165b,"unsupported version/branch");
    ensure!(pczt.transparent().inputs().is_empty() && pczt.transparent().outputs().is_empty() && pczt.sapling().spends().is_empty() && pczt.sapling().outputs().is_empty(),"only shielded Orchard/Ironwood supported");
    let key=UnifiedFullViewingKey::decode(&Network::TestNetwork,std::fs::read_to_string(ufvk)?.trim()).map_err(|e|anyhow!("UFVK decode: {e}"))?;
    let fvk=key.orchard().context("Orchard FVK missing")?;
    let mut inputs=vec![]; let mut outputs=vec![];
    let mut collect=|b: &Bundle,pool: &str| -> Result<(),OrchardError<()>> {
        b.verify_cross_address_restriction()?;
        for (index,a) in b.actions().iter().enumerate() {
            a.verify_cv_net()?; a.spend().verify_nullifier(Some(fvk))?; a.spend().verify_rk(Some(fvk))?; a.output().verify_note_commitment(a.spend())?;
            let value=a.spend().value().ok_or_else(||OrchardError::Custom(()))?.inner();
            if value>0 { inputs.push(json!({"pool":pool,"index":index,"value_zats":value})); }
            let value=a.output().value().ok_or_else(||OrchardError::Custom(()))?.inner();
            if value>0 {
                let receiver=a.output().recipient().as_ref().ok_or_else(||OrchardError::Custom(()))?;
                let ock=a.output().ock().as_ref().ok_or_else(||OrchardError::Custom(()))?;
                let recovered=if pool=="ironwood" {
                    zcash_note_encryption::try_output_recovery_with_ock(&orchard::note_encryption::IronwoodDomain::for_pczt_action(a),ock,a,&a.output().encrypted_note().out_ciphertext)
                } else {
                    zcash_note_encryption::try_output_recovery_with_ock(&orchard::note_encryption::OrchardDomain::for_pczt_action(a),ock,a,&a.output().encrypted_note().out_ciphertext)
                }.ok_or_else(||OrchardError::Custom(()))?;
                if recovered.0.value().inner()!=value || &recovered.1!=receiver {return Err(OrchardError::Custom(()));}
                let address=a.output().user_address().as_ref();
                let is_change=address.is_none() && fvk.scope_for_address(receiver).is_some();
                if let Some(address)=address {
                    let decoded=match Address::decode(&Network::TestNetwork,address) {Some(Address::Unified(ua))=>ua.orchard().copied(),_=>None}.ok_or_else(||OrchardError::Custom(()))?;
                    if receiver!=&decoded {return Err(OrchardError::Custom(()));}
                } else if !is_change {return Err(OrchardError::Custom(()));}
                outputs.push(json!({"pool":pool,"index":index,"recipient":address,"is_change":is_change,"amount_zats":value.to_string()}));
            }
        }
        Ok(())
    };
    let pczt=Verifier::new(pczt).with_orchard(|b|collect(b,"orchard")).map_err(|e|anyhow!("Orchard validation: {e:?}"))?.with_ironwood(|b|collect(b,"ironwood")).map_err(|e|anyhow!("Ironwood validation: {e:?}"))?.finish();
    let input: u64=inputs.iter().map(|v|v["value_zats"].as_u64().unwrap()).sum();
    let output: u64=outputs.iter().map(|v|v["amount_zats"].as_str().unwrap().parse::<u64>().unwrap()).sum();
    let fee=input.checked_sub(output).context("outputs exceed inputs")?;
    let standard_fee=5000*std::cmp::max(2,pczt.orchard().actions().len()+pczt.ironwood().actions().len()) as u64;
    ensure!(fee==standard_fee,"fee {fee} differs from ZIP-317 fee {standard_fee}");
    println!("{}",json!({"inputs":inputs,"outputs":outputs,"input_zats":input,"output_zats":output,"fee_zats":fee,"expiry_height":pczt.global().expiry_height(),"tx_version":pczt.global().tx_version(),"consensus_branch_id":format!("{:08x}",pczt.global().consensus_branch_id())}));
    Ok(())
}
fn main() -> anyhow::Result<()> {
    let args: Vec<_>=std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("address") if args.len()==3=>address(&args[2]),
        Some("create") if args.len()==4=>create(&args[2],&args[3]),
        Some("inspect") if args.len()==4=>inspect(&args[2],&args[3]),
        _=>Err(anyhow!("usage: benzo-pczt create <testnet wallet> <output.pczt> | inspect <pczt> <ufvk file>"))
    }
}
