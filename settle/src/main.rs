// Multi-output PCZT construction and strict inspection using the pinned wallet/PCZT crates.
// source: zcash/zcash-devtool@5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8:src/commands/pczt/create.rs
use std::{io::{self, Read}, num::NonZeroUsize, path::Path, str::FromStr};
use anyhow::{anyhow, ensure, Context};
use ff::PrimeField;
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
use zcash_note_encryption::Domain;

fn network(arg: &str) -> anyhow::Result<Network> {
    match arg { "test" => Ok(Network::TestNetwork), "main" => Ok(Network::MainNetwork), _ => Err(anyhow!("--network must be test or main")) }
}
fn create(wallet: &str, output: &str, expiry_blocks: u32, net: Network) -> anyhow::Result<()> {
    ensure!(expiry_blocks>0&&expiry_blocks<=10000,"expiry blocks must be 1–10000");
    let mut text=String::new(); io::stdin().read_to_string(&mut text)?;
    let outputs: Vec<Value>=serde_json::from_str(&text)?;
    ensure!(!outputs.is_empty() && outputs.len()<=13,"batch must have 1–13 recipients");
    let payments=outputs.iter().enumerate().map(|(i,o)| {
        let addr=o["recipient"].as_str().context("recipient missing")?;
        let amount=o["amount_zats"].as_str().context("amount must be decimal string")?.parse::<u64>()?;
        ensure!(amount>0,"zero payment");
        Payment::new(ZcashAddress::from_str(addr)?,Some(Zatoshis::from_u64(amount)?),None,None,None,vec![]).map_err(|e|anyhow!("payment {i}: {e:?}"))
    }).collect::<anyhow::Result<Vec<_>>>()?;
    let mut db=WalletDb::for_path(Path::new(wallet).join("data.sqlite"),net,SystemClock,OsRng)?;
    let accounts=db.get_account_ids()?;
    ensure!(accounts.len()==1,"wallet must have one account");
    let change=MultiOutputChangeStrategy::new(StandardFeeRule::Zip317,None,ShieldedPool::Orchard,DustOutputPolicy::default(),SplitPolicy::with_min_output_value(NonZeroUsize::new(1).unwrap(),Zatoshis::from_u64(10_000_000)?));
    let proposal=propose_transfer::<_,_,_,_,zcash_client_sqlite::wallet::commitment_tree::Error>(&mut db,&net,accounts[0],&GreedyInputSelector::new(),&change,TransactionRequest::new(payments)?,ConfirmationsPolicy::default(),&SpendPolicy::default(),None,None).map_err(|e|anyhow!("proposal: {e:?}"))?;
    let expiry=proposal.min_target_height()+expiry_blocks;
    // Ruling R27: the testnet NU7 activation at 4,465,026. Mainnet keeps the as-pinned Ironwood stack and its
    // activation height is not yet set (docs/mainnet-risks.md records it once decided); this straddle guard is
    // therefore testnet-only until then.
    if net==Network::TestNetwork { ensure!(!(u32::from(proposal.min_target_height())<=4_465_026 && u32::from(expiry)>=4_465_026),"PCZT expiry reaches NU7 activation; refusing create"); }
    let pczt=create_pczt_from_proposal::<_,_,zcash_client_backend::data_api::wallet::input_selection::GreedyInputSelectorError,_,zcash_primitives::transaction::fees::zip317::FeeError,_>(&mut db,&net,accounts[0],OvkPolicy::Discard,&proposal,Some(expiry),zcash_primitives::transaction::builder::BundlePadding::DEFAULT).map_err(|e|anyhow!("PCZT creation: {e:?}"))?;
    std::fs::write(output,pczt.serialize().map_err(|e|anyhow!("serialization: {e:?}"))?)?;
    Ok(())
}
// source: zcash/zcash-devtool@5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8:src/commands/wallet/gen_addr.rs
fn address(wallet: &str, net: Network) -> anyhow::Result<()> {
    use zcash_keys::keys::UnifiedAddressRequest;
    let mut db=WalletDb::for_path(Path::new(wallet).join("data.sqlite"),net,SystemClock,OsRng)?;
    let accounts=db.get_account_ids()?;ensure!(accounts.len()==1,"wallet must have one account");
    let (ua,_)=db.get_next_available_address(accounts[0],UnifiedAddressRequest::ORCHARD)?.context("no shielded address")?;
    println!("{}",ua.encode(&net));Ok(())
}
// §11 H7: `allow_redacted` (the coordinator under host custody) accepts outputs whose recipient, rseed and ock were
// redacted by the building host (`zcash-devtool pczt redact`): they are reported with recipient null and
// redacted true and are not opened here — every approving host checks the full candidate, sealed to its own
// envelope key, and that its redaction is byte-identical to this one. Hosts call the strict mode.
fn inspect(file: &str, ufvk: &str, allow_redacted: bool, net: Network) -> anyhow::Result<()> {
    let pczt=Pczt::parse(&std::fs::read(file)?).map_err(|e|anyhow!("PCZT parse: {e:?}"))?;
    // Ruling R27: v6 under Ironwood (NU6.3, 0x37a5165b) or NU7 (0x77190ad9; testnet from height 4,465,026).
    ensure!(pczt.global().tx_version()==&6 && [0x37a5165b,0x77190ad9].contains(pczt.global().consensus_branch_id()),"unsupported version/branch");
    ensure!(pczt.transparent().inputs().is_empty() && pczt.transparent().outputs().is_empty() && pczt.sapling().spends().is_empty() && pczt.sapling().outputs().is_empty(),"only shielded Orchard/Ironwood supported");
    let key=UnifiedFullViewingKey::decode(&net,std::fs::read_to_string(ufvk)?.trim()).map_err(|e|anyhow!("UFVK decode: {e}"))?;
    let fvk=key.orchard().context("Orchard FVK missing")?;
    let mut inputs=vec![]; let mut outputs=vec![];
    // Ruling R29 (Phase 6 option A): the spend randomizers zcash-sign will prompt for, in its order — every action whose
    // spend carries an alpha and no spend-auth signature yet, Orchard pool first, then Ironwood (the Verifier's order) —
    // so the coordinator can sign them all in ONE multi-message FROST session and answer zcash-sign from the result.
    let mut randomizers: Vec<serde_json::Value> = vec![];
    let mut collect=|b: &Bundle,pool: &str| -> Result<(),OrchardError<&'static str>> {
        b.verify_cross_address_restriction()?;
        for (index,a) in b.actions().iter().enumerate() {
            if a.spend().spend_auth_sig().is_none() {
                if let Some(alpha)=a.spend().alpha() { randomizers.push(json!({"pool":pool,"index":index,"alpha":hex::encode(alpha.to_repr())})); }
            }
            a.verify_cv_net()?; a.spend().verify_nullifier(Some(fvk))?; a.spend().verify_rk(Some(fvk))?;
            let redacted=allow_redacted && a.output().recipient().is_none();
            if redacted {
                if a.output().rseed().is_some() || a.output().user_address().is_some() {return Err(OrchardError::Custom("partially redacted output"));}
                let value=a.output().value().ok_or_else(||OrchardError::Custom("missing output value"))?.inner();
                let spent=a.spend().value().ok_or_else(||OrchardError::Custom("missing spend value"))?.inner();
                if spent>0 { inputs.push(json!({"pool":pool,"index":index,"value_zats":spent})); }
                if value>0 { outputs.push(json!({"pool":pool,"index":index,"recipient":null,"is_change":false,"redacted":true,"amount_zats":value.to_string()})); }
                continue;
            }
            a.output().verify_note_commitment(a.spend())?;
            let value=a.spend().value().ok_or_else(||OrchardError::Custom("missing spend value"))?.inner();
            if value>0 { inputs.push(json!({"pool":pool,"index":index,"value_zats":value})); }
            let value=a.output().value().ok_or_else(||OrchardError::Custom("missing output value"))?.inner();
            if value>0 {
                let receiver=a.output().recipient().as_ref().ok_or_else(||OrchardError::Custom("missing output recipient"))?;
                let rho=orchard::note::Rho::from_bytes(&a.spend().nullifier().to_bytes()).into_option().ok_or(OrchardError::Custom("invalid output rho"))?;
                let note=orchard::Note::from_parts(*receiver,*a.output().value().as_ref().unwrap(),rho,*a.output().rseed().as_ref().ok_or(OrchardError::Custom("missing output randomness"))?,*a.output().note_version()).into_option().ok_or(OrchardError::Custom("invalid output note"))?;
                let recovered=if pool=="ironwood" {
                    type D=orchard::note_encryption::IronwoodDomain;
                    zcash_note_encryption::try_output_recovery_with_pkd_esk(&D::for_pczt_action(a),D::get_pk_d(&note),D::derive_esk(&note).ok_or(OrchardError::Custom("missing encryption secret"))?,a)
                } else {
                    type D=orchard::note_encryption::OrchardDomain;
                    zcash_note_encryption::try_output_recovery_with_pkd_esk(&D::for_pczt_action(a),D::get_pk_d(&note),D::derive_esk(&note).ok_or(OrchardError::Custom("missing encryption secret"))?,a)
                }.ok_or(OrchardError::Custom("encrypted output recovery failed"))?;
                if let Some(ock)=a.output().ock() {
                    let outgoing=if pool=="ironwood" {
                        zcash_note_encryption::try_output_recovery_with_ock(&orchard::note_encryption::IronwoodDomain::for_pczt_action(a),ock,a,&a.output().encrypted_note().out_ciphertext)
                    } else {
                        zcash_note_encryption::try_output_recovery_with_ock(&orchard::note_encryption::OrchardDomain::for_pczt_action(a),ock,a,&a.output().encrypted_note().out_ciphertext)
                    }.ok_or(OrchardError::Custom("outgoing ciphertext recovery failed"))?;
                    if outgoing.0!=recovered.0 || outgoing.1!=recovered.1 {return Err(OrchardError::Custom("outgoing ciphertext mismatch"));}
                }
                if recovered.0.value().inner()!=value || &recovered.1!=receiver {return Err(OrchardError::Custom("encrypted recipient or amount mismatch"));}
                let address=a.output().user_address().as_ref();
                // Ruling R28 item 4 (F3): change is ONLY an internal-scope (change) address of the vault; an external vault
                // address (a deposit or funding address) is never change, so it must match a derived row like any payment.
                let is_change=address.is_none() && fvk.scope_for_address(receiver)==Some(orchard::keys::Scope::Internal);
                if let Some(address)=address {
                    let decoded=match Address::decode(&net,address) {Some(Address::Unified(ua))=>ua.orchard().copied(),_=>None}.ok_or_else(||OrchardError::Custom("user address is not a shielded UA"))?;
                    if receiver!=&decoded {return Err(OrchardError::Custom("user address receiver mismatch"));}
                } else if !is_change {return Err(OrchardError::Custom("output has no user address and is not owned change"));}
                outputs.push(json!({"pool":pool,"index":index,"recipient":address,"is_change":is_change,"amount_zats":value.to_string()}));
            }
        }
        Ok(())
    };
    let pczt=Verifier::new(pczt).with_orchard(|b|collect(b,"orchard")).map_err(|e|anyhow!("Orchard validation: {e:?}"))?.with_ironwood(|b|collect(b,"ironwood")).map_err(|e|anyhow!("Ironwood validation: {e:?}"))?.finish();
    let sighash=pczt::roles::signer::Signer::new(pczt.clone()).map_err(|e|anyhow!("PCZT sighash: {e:?}"))?.shielded_sighash();
    // Ruling R28 item 3 (F2): the txid is fixed before signing (v5/v6 txids commit to effects, not authorization), so a
    // host can record what it approved and later see from the chain whether that transaction mined.
    let txid={
        let tx=pczt.clone().into_effects().map_err(|e|anyhow!("PCZT effects: {e:?}"))?;
        let digests=tx.digest(zcash_primitives::transaction::txid::TxIdDigester);
        zcash_primitives::transaction::txid::to_txid(tx.version(),tx.consensus_branch_id(),&digests).to_string()
    };
    let input: u64=inputs.iter().map(|v|v["value_zats"].as_u64().unwrap()).sum();
    let output: u64=outputs.iter().map(|v|v["amount_zats"].as_str().unwrap().parse::<u64>().unwrap()).sum();
    let fee=input.checked_sub(output).context("outputs exceed inputs")?;
    let standard_fee=5000*std::cmp::max(2,pczt.orchard().actions().len()+pczt.ironwood().actions().len()) as u64;
    ensure!(fee==standard_fee,"fee {fee} differs from ZIP-317 fee {standard_fee}");
    println!("{}",json!({"shielded_sighash":hex::encode(sighash),"txid":txid,"randomizers":randomizers,"inputs":inputs,"outputs":outputs,"input_zats":input,"output_zats":output,"fee_zats":fee,"actions":pczt.orchard().actions().len()+pczt.ironwood().actions().len(),"expiry_height":pczt.global().expiry_height(),"tx_version":pczt.global().tx_version(),"consensus_branch_id":format!("{:08x}",pczt.global().consensus_branch_id())}));
    Ok(())
}
// R24 item 3 (i): classify a Zcash address with the pinned audited `zcash_address` (librustzcash) —
// the single source of address classification, called from `envelope/destination.ts` (which keeps the
// shielded-only rule). Returns `{kind, network, receivers[]}`: kind is unified|sapling|transparent|
// tex|sprout, `invalid_unified` for a unified-encoding string whose container fails (the caller
// refuses it as "invalid unified address"), or `other` when the string is not a Zcash address;
// receivers are the unified container's items in encoded order (`items_as_parsed`, the order the
// pre-swap parser reported).
fn classify_address(addr: &str) -> anyhow::Result<()> {
    use zcash_address::{ConversionError, ParseError, TryFromAddress, ZcashAddress, unified::{self, Container, Encoding, Receiver}};
    use zcash_protocol::consensus::NetworkType;
    fn net_str(net: NetworkType) -> &'static str {
        match net { NetworkType::Main => "main", NetworkType::Test => "test", NetworkType::Regtest => "regtest" }
    }
    struct Classified { kind: &'static str, network: &'static str, receivers: Vec<(u32, Vec<u8>)> }
    impl TryFromAddress for Classified {
        type Error = core::convert::Infallible;
        fn try_from_sprout(net: NetworkType, _data: [u8; 64]) -> Result<Self, ConversionError<Self::Error>> {
            Ok(Classified { kind: "sprout", network: net_str(net), receivers: vec![] })
        }
        fn try_from_sapling(net: NetworkType, _data: [u8; 43]) -> Result<Self, ConversionError<Self::Error>> {
            Ok(Classified { kind: "sapling", network: net_str(net), receivers: vec![] })
        }
        fn try_from_unified(net: NetworkType, addr: zcash_address::unified::Address) -> Result<Self, ConversionError<Self::Error>> {
            let receivers = addr.items_as_parsed().iter().map(|r| match r {
                Receiver::P2pkh(d) => (0u32, d.to_vec()),
                Receiver::P2sh(d) => (1u32, d.to_vec()),
                Receiver::Sapling(d) => (2u32, d.to_vec()),
                Receiver::Orchard(d) => (3u32, d.to_vec()),
                Receiver::Unknown { typecode, data } => (*typecode, data.clone()),
            }).collect();
            Ok(Classified { kind: "unified", network: net_str(net), receivers })
        }
        fn try_from_transparent_p2pkh(net: NetworkType, _data: [u8; 20]) -> Result<Self, ConversionError<Self::Error>> {
            Ok(Classified { kind: "transparent", network: net_str(net), receivers: vec![] })
        }
        fn try_from_transparent_p2sh(net: NetworkType, _data: [u8; 20]) -> Result<Self, ConversionError<Self::Error>> {
            Ok(Classified { kind: "transparent", network: net_str(net), receivers: vec![] })
        }
        fn try_from_tex(net: NetworkType, _data: [u8; 20]) -> Result<Self, ConversionError<Self::Error>> {
            Ok(Classified { kind: "tex", network: net_str(net), receivers: vec![] })
        }
    }
    let classified = match addr.parse::<ZcashAddress>() {
        Ok(a) => a.convert::<Classified>().ok(),
        Err(e) => {
            // a unified-encoding string whose container fails (UA HRP + valid checksum, bad body) is
            // its own class — the caller refuses it as "invalid unified address", never as junk
            let invalid_unified = matches!(e, ParseError::InvalidEncoding)
                && matches!(unified::Address::decode(addr), Err(unified::ParseError::InvalidEncoding(_)));
            if invalid_unified {
                println!("{}", json!({"kind": "invalid_unified", "network": Value::Null, "receivers": []}));
                return Ok(());
            }
            None
        }
    };
    let out = match classified {
        Some(c) => json!({
            "kind": c.kind,
            "network": c.network,
            "receivers": c.receivers.iter().map(|(t, d)| json!({"typecode": t, "data_hex": hex::encode(d)})).collect::<Vec<_>>(),
        }),
        None => json!({"kind": "other", "network": Value::Null, "receivers": []}),
    };
    println!("{}", out);
    Ok(())
}
// Ruling R28 item 5 (F4): the vault's Orchard spend-validating key ak (the first 32 bytes of the Orchard FVK), so a
// host can require it to equal its own FROST group key; and the scope in which a UA's Orchard receiver belongs to the
// UFVK (external | internal | none), so a host can require every manifest address to be its vault's own.
fn ufvk_ak(ufvk: &str, net: Network) -> anyhow::Result<()> {
    let key=UnifiedFullViewingKey::decode(&net,std::fs::read_to_string(ufvk)?.trim()).map_err(|e|anyhow!("UFVK decode: {e}"))?;
    println!("{}",hex::encode(&key.orchard().context("Orchard FVK missing")?.to_bytes()[..32])); Ok(())
}
fn owns(ufvk: &str, addr: &str, net: Network) -> anyhow::Result<()> {
    let key=UnifiedFullViewingKey::decode(&net,std::fs::read_to_string(ufvk)?.trim()).map_err(|e|anyhow!("UFVK decode: {e}"))?;
    let receiver=match Address::decode(&net,addr) {Some(Address::Unified(ua))=>ua.orchard().copied(),_=>None}.context("not a UA with an Orchard receiver")?;
    println!("{}",match key.orchard().context("Orchard FVK missing")?.scope_for_address(&receiver) {Some(orchard::keys::Scope::External)=>"external",Some(orchard::keys::Scope::Internal)=>"internal",None=>"none"}); Ok(())
}
fn main() -> anyhow::Result<()> {
    // Every network-dependent command takes `--network test|main` — no default, so a mainnet caller can never
    // silently get testnet behaviour (the value comes from the signed manifest at every product call site).
    let mut args: Vec<_>=std::env::args().skip(1).collect();
    let mut net=None;
    if let Some(i)=args.iter().position(|a|a=="--network") {
        net=Some(network(args.get(i+1).map(String::as_str).context("--network needs test|main")?)?);
        args.drain(i..i+2);
    }
    let net=|| net.context("missing --network test|main");
    match args.get(0).map(String::as_str) {
        Some("address") if args.len()==2=>address(&args[1],net()?),
        Some("create") if args.len()==3||args.len()==4=>create(&args[1],&args[2],if args.len()==4 {args[3].parse()?} else {364},net()?),
        Some("inspect") if args.len()==3=>inspect(&args[1],&args[2],false,net()?),
        Some("inspect") if args.len()==4 && args[3]=="--allow-redacted"=>inspect(&args[1],&args[2],true,net()?),
        Some("classify-address") if args.len()==2=>classify_address(&args[1]),
        Some("ufvk-ak") if args.len()==2=>ufvk_ak(&args[1],net()?),
        Some("owns") if args.len()==3=>owns(&args[1],&args[2],net()?),
        _=>Err(anyhow!("usage: benzo-pczt address <wallet> --network test|main | create <wallet> <output.pczt> [expiry-blocks] --network test|main | inspect <pczt> <ufvk file> [--allow-redacted] --network test|main | classify-address <address> | ufvk-ak <ufvk file> --network test|main | owns <ufvk file> <address> --network test|main"))
    }
}
