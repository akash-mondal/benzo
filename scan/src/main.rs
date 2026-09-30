//! Benzo vault reader (docs/PHASE-1.md sections 5 and 7).
//!
//! benzo-scan scan   <network> <wallet dir>        one JSON line per note the vault wallet received
//! benzo-scan verify <network> <ufvk file> <height>  raw tx hex on stdin; one JSON line per output the UFVK decrypts
//! benzo-scan ak     <network> <ufvk file>           the Orchard-protocol `ak` in the UFVK, hex
//!
//! `scan` reads only the vault wallet that zcash-devtool maintains: notes and spends through zcash_client_sqlite's
//! views, memos through `WalletRead::get_memo`. It never decrypts anything itself. `verify` uses no wallet database.
use std::{collections::HashMap, io::Read, path::Path};

use anyhow::{Context, anyhow, bail};
use rusqlite::{Connection, OpenFlags};
use serde_json::json;
use zcash_client_backend::{data_api::WalletRead, decrypt_transaction, wallet::NoteId};
use zcash_client_sqlite::WalletDb;
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_primitives::transaction::Transaction;
use zcash_protocol::{
    ShieldedPool,
    consensus::{BlockHeight, BranchId, Network},
    memo::MemoBytes,
    TxId,
};

fn network(name: &str) -> anyhow::Result<Network> {
    match name {
        "test" => Ok(Network::TestNetwork),
        "main" => Ok(Network::MainNetwork),
        _ => bail!("network must be test or main, got {name}"),
    }
}

fn read_ufvk(params: &Network, path: &str) -> anyhow::Result<UnifiedFullViewingKey> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
    UnifiedFullViewingKey::decode(params, text.trim()).map_err(|e| anyhow!("invalid UFVK in {path}: {e}"))
}

fn scan(params: Network, wallet_dir: &str) -> anyhow::Result<()> {
    let db_path = Path::new(wallet_dir).join("data.sqlite");
    let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let wallet = WalletDb::for_path(&db_path, params, (), ())?;
    let mut stmt = conn.prepare(
        "SELECT t.txid, t.mined_height, ro.pool, ro.output_index, ro.value, a.address, a.diversifier_index_be,
                (SELECT st.txid FROM v_received_output_spends s JOIN transactions st ON st.id_tx = s.transaction_id
                 WHERE s.pool = ro.pool AND s.received_output_id = ro.id_within_pool_table) AS spent_in
         FROM v_received_outputs ro
         JOIN transactions t ON t.id_tx = ro.transaction_id
         LEFT JOIN addresses a ON a.id = ro.address_id
         WHERE ro.pool IN (2, 3, 4)
         ORDER BY t.mined_height, t.txid, ro.output_index",
    )?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let txid = TxId::from_bytes(row.get::<_, [u8; 32]>(0)?);
        let (pool, name) = match row.get::<_, i64>(2)? {
            2 => (ShieldedPool::Sapling, "sapling"),
            3 => (ShieldedPool::Orchard, "orchard"),
            _ => (ShieldedPool::Ironwood, "ironwood"),
        };
        let output_index: u16 = row.get(3)?;
        let memo = wallet
            .get_memo(NoteId::new(txid, pool, output_index))?
            .ok_or_else(|| anyhow!("no memo stored for {txid}:{output_index}; run `wallet enhance` first"))?;
        let diversifier_index = row
            .get::<_, Option<Vec<u8>>>(6)?
            .map(|be| be.iter().fold(0u128, |acc, b| (acc << 8) | u128::from(*b)).to_string());
        let spent_in = row.get::<_, Option<[u8; 32]>>(7)?.map(|b| TxId::from_bytes(b).to_string());
        println!(
            "{}",
            json!({
                "txid": txid.to_string(),
                "height": row.get::<_, Option<u32>>(1)?,
                "pool": name,
                "address": row.get::<_, Option<String>>(5)?,
                "diversifier_index": diversifier_index,
                "value_zats": row.get::<_, i64>(4)?,
                "memo_hex": hex::encode(MemoBytes::from(&memo).as_array()),
                "spent_in_txid": spent_in,
            })
        );
    }
    Ok(())
}

fn verify(params: Network, ufvk_path: &str, height: u32) -> anyhow::Result<()> {
    let ufvk = read_ufvk(&params, ufvk_path)?;
    let mut raw_hex = String::new();
    std::io::stdin().read_to_string(&mut raw_hex)?;
    let raw = hex::decode(raw_hex.trim()).context("stdin is not hex")?;
    let height = BlockHeight::from_u32(height);
    let tx = Transaction::read(&raw[..], BranchId::for_height(&params, height))?;
    let ufvks = HashMap::from([(0u32, ufvk)]);
    let decrypted = decrypt_transaction(&params, Some(height), None, &tx, &ufvks);
    let outputs = decrypted
        .orchard_outputs()
        .iter()
        .map(|o| ("orchard", o))
        .chain(decrypted.ironwood_outputs().iter().map(|o| ("ironwood", o)));
    for (pool, o) in outputs {
        println!(
            "{}",
            json!({
                "txid": tx.txid().to_string(),
                "pool": pool,
                "output_index": o.index(),
                "value_zats": o.note().0.value().inner(),
                "memo_hex": hex::encode(o.memo().as_array()),
            })
        );
    }
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        ["scan", net, wallet_dir] => scan(network(net)?, wallet_dir),
        ["verify", net, ufvk, height] => verify(network(net)?, ufvk, height.parse()?),
        ["ak", net, ufvk] => {
            let params = network(net)?;
            let fvk = read_ufvk(&params, ufvk)?;
            let orchard = fvk.orchard().ok_or_else(|| anyhow!("UFVK has no Orchard-protocol key"))?;
            println!("{}", hex::encode(&orchard.to_bytes()[..32]));
            Ok(())
        }
        _ => bail!("usage: benzo-scan scan <network> <wallet dir> | verify <network> <ufvk file> <height> | ak <network> <ufvk file>"),
    }
}
