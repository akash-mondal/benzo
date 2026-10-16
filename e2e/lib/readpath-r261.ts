// R35 fold (run 33): a verbatim port of tools/repro/r26-1-deposit-party-repro.mjs (R26 item 1) — the
// script stays until gate RG proves the folded IDs pass and then deletes it. The body is the script's own
// (fixture wallet DDL, the real benzo-scan, the shipped CLI and settlement Ledger); its
// `check(id, ok, reason)` calls are collected and replayed through Run.check so the assertion IDs and
// expected values are byte-identical to the script's. Verbatim port => no new typing here (ts-nocheck);
// the e2e typecheck still covers the hand-written files.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import * as schema from "../../manifest/schema";
import * as api from "../../api/public-auction";
import * as ledger from "../../settle/ledger";
import { ROOT } from "./env";
import type { Run } from "./run";

export async function foldR261(run: Run): Promise<void> {
  const WORK = path.join(ROOT, "tmp/e2e/r26-1");
  const STATE = path.join(WORK, "state");
  const REPO = path.join(WORK, "repo"); // scratch git root: the shipped CLI resolves its .env and tools here
  const sha256 = (b: any) => createHash("sha256").update(b).digest("hex");
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
  const check = (id: any, ok: any, reason: any) => { collected.push([String(id), !!ok, String(reason ?? "")]); };
// ---- scanner-shaped fixtures: one transaction, two outputs to the same deposit address + zero-value ----
const ID = createHash("sha256").update("r26-1 fixture auction").digest("hex");
const TXID = "f100000000000000000000000000000000000000000000000000000000000001";
const D1 = "utest1r261fixturedepositone", D2 = "utest1r261fixturedeposittwo";
const memoBytes = (tag: any) => {
  const m = Buffer.alloc(512);
  Buffer.from("ff424e5a01", "hex").copy(m, 0);
  const ct = randomBytes(200);
  m.writeUInt16BE(ct.length, 5);
  ct.copy(m, 7);
  return m;
};
// The plan's refund candidates: two notes to the SAME deposit address (same diversifier index — the
// pre-fix identity) plus one zero-value note. action_index is the output position the scanner emits.
const FIXTURE = [
  { txid: TXID, height: 85, pool: "ironwood", address: D1, action_index: 0, diversifier_index: "0", value_zats: 7000, memo_hex: memoBytes(0).toString("hex"), spent_in_txid: null },
  { txid: TXID, height: 85, pool: "ironwood", address: D1, action_index: 1, diversifier_index: "0", value_zats: 8000, memo_hex: memoBytes(1).toString("hex"), spent_in_txid: null },
  { txid: TXID, height: 85, pool: "ironwood", address: D2, action_index: 2, diversifier_index: "1", value_zats: 0, memo_hex: Buffer.alloc(512).toString("hex"), spent_in_txid: null },
];

// ---- fixture wallet: the pinned zcash_client_sqlite schema, filled with the fixture notes ----
rmSync(WORK, { recursive: true, force: true });
mkdirSync(path.join(STATE, "vault"), { recursive: true });
mkdirSync(path.join(STATE, "run"), { recursive: true });
mkdirSync(path.join(STATE, "signers", "alice"), { recursive: true });
mkdirSync(path.join(STATE, "product"), { recursive: true });
mkdirSync(path.join(STATE, "settle"), { recursive: true });
// Wallet schema: verbatim CREATE statements from zcash_client_sqlite@0.22.0:src/wallet/db.rs
// (the exact tables/views the pinned benzo-scan queries). Fixture data only; no wallet tool runs.
const DDL = String.raw`CREATE TABLE "accounts" (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    uuid BLOB NOT NULL,
    account_kind INTEGER NOT NULL DEFAULT 0,
    key_source TEXT,
    hd_seed_fingerprint BLOB,
    hd_account_index INTEGER,
    ufvk TEXT,
    uivk TEXT NOT NULL,
    orchard_ivk_item_cache BLOB,
    sapling_ivk_item_cache BLOB,
    p2pkh_ivk_item_cache BLOB,
    p2sh_ivk_item_cache BLOB,
    birthday_height INTEGER NOT NULL,
    birthday_sapling_tree_size INTEGER,
    birthday_orchard_tree_size INTEGER,
    recover_until_height INTEGER,
    has_spend_key INTEGER NOT NULL DEFAULT 1,
    zcashd_legacy_address_index INTEGER NOT NULL DEFAULT -1,
    CHECK (
      (
        account_kind = 0
        AND hd_seed_fingerprint IS NOT NULL
        AND hd_account_index IS NOT NULL
        AND ufvk IS NOT NULL
      )
      OR
      (
        account_kind = 1
        AND (hd_seed_fingerprint IS NULL) = (hd_account_index IS NULL)
      )
    ),
    CHECK (
      NOT (p2pkh_ivk_item_cache IS NOT NULL AND p2sh_ivk_item_cache IS NOT NULL)
    )
);
CREATE TABLE "addresses" (
    id INTEGER NOT NULL PRIMARY KEY,
    account_id INTEGER NOT NULL
        REFERENCES accounts(id) ON DELETE CASCADE,
    key_scope INTEGER NOT NULL,
    diversifier_index_be BLOB,
    address TEXT NOT NULL,
    transparent_child_index INTEGER,
    cached_transparent_receiver_address TEXT,
    exposed_at_height INTEGER,
    receiver_flags INTEGER NOT NULL,
    transparent_receiver_next_check_time INTEGER,
    imported_transparent_receiver_pubkey BLOB,
    imported_transparent_receiver_script BLOB,
    UNIQUE (account_id, key_scope, diversifier_index_be),
    UNIQUE (imported_transparent_receiver_pubkey),
    UNIQUE (imported_transparent_receiver_script),
    CONSTRAINT ck_addr_transparent_index_consistency CHECK (
        (transparent_child_index IS NULL OR diversifier_index_be < x'0000000F00000000000000')
        AND (
            -- no transparent receiver: all transparent columns are absent
            (
                cached_transparent_receiver_address IS NULL
                AND transparent_child_index IS NULL
                AND imported_transparent_receiver_pubkey IS NULL
                AND imported_transparent_receiver_script IS NULL
            )
            OR (
                cached_transparent_receiver_address IS NOT NULL
                -- a transparent receiver has a child index iff it was derived
                AND ((transparent_child_index IS NULL) == (key_scope = -1))
                -- at most one kind of imported key material
                AND NOT (
                    imported_transparent_receiver_pubkey IS NOT NULL
                    AND imported_transparent_receiver_script IS NOT NULL
                )
                -- imported key material appears only on imported (key_scope = -1) rows
                AND (
                    key_scope = -1 OR (
                        imported_transparent_receiver_pubkey IS NULL
                        AND imported_transparent_receiver_script IS NULL
                    )
                )
            )
        )
    ),
    CONSTRAINT ck_addr_foreign_or_diversified CHECK (
        (diversifier_index_be IS NULL) == (key_scope = -1)
    )
);
CREATE TABLE blocks (
    height INTEGER PRIMARY KEY,
    hash BLOB NOT NULL,
    time INTEGER NOT NULL,
    sapling_tree BLOB NOT NULL ,
    sapling_commitment_tree_size INTEGER,
    orchard_commitment_tree_size INTEGER,
    sapling_output_count INTEGER,
    orchard_action_count INTEGER,
    ironwood_commitment_tree_size INTEGER,
    ironwood_action_count INTEGER);
CREATE TABLE "transactions" (
    id_tx INTEGER PRIMARY KEY,
    txid BLOB NOT NULL UNIQUE,
    created TEXT,
    block INTEGER,
    mined_height INTEGER,
    tx_index INTEGER,
    expiry_height INTEGER,
    raw BLOB,
    fee INTEGER,
    target_height INTEGER,
    min_observed_height INTEGER NOT NULL,
    confirmed_unmined_at_height INTEGER,
    trust_status INTEGER,
    zip318_kind INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (block) REFERENCES blocks(height),
    CONSTRAINT height_consistency CHECK (
        block IS NULL OR mined_height = block
    ),
    CONSTRAINT min_observed_consistency CHECK (
        mined_height IS NULL OR min_observed_height <= mined_height
    ),
    CONSTRAINT confirmed_unmined_consistency CHECK (
        confirmed_unmined_at_height IS NULL OR mined_height IS NULL
    )
);
CREATE TABLE "sapling_received_notes" (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL
        REFERENCES transactions(id_tx) ON DELETE CASCADE,
    output_index INTEGER NOT NULL,
    account_id INTEGER NOT NULL
        REFERENCES accounts(id) ON DELETE CASCADE,
    diversifier BLOB NOT NULL,
    value INTEGER NOT NULL,
    rcm BLOB NOT NULL,
    nf BLOB UNIQUE,
    is_change INTEGER NOT NULL,
    memo BLOB,
    commitment_tree_position INTEGER,
    recipient_key_scope INTEGER,
    address_id INTEGER
        REFERENCES addresses(id) ON DELETE CASCADE,
    witness_stabilized INTEGER NOT NULL DEFAULT 0,
    lock_expiry_height INTEGER,
    lock_owner BLOB,
    UNIQUE (transaction_id, output_index)
);
CREATE TABLE "sapling_received_note_spends" (
    sapling_received_note_id INTEGER NOT NULL
        REFERENCES sapling_received_notes(id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL
        REFERENCES transactions(id_tx) ON DELETE CASCADE,
    UNIQUE (sapling_received_note_id, transaction_id)
);
CREATE TABLE "orchard_received_notes" (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL
        REFERENCES transactions(id_tx) ON DELETE CASCADE,
    action_index INTEGER NOT NULL,
    account_id INTEGER NOT NULL
        REFERENCES accounts(id) ON DELETE CASCADE,
    diversifier BLOB NOT NULL,
    value INTEGER NOT NULL,
    rho BLOB NOT NULL,
    rseed BLOB NOT NULL,
    nf BLOB UNIQUE,
    is_change INTEGER NOT NULL,
    memo BLOB,
    commitment_tree_position INTEGER,
    recipient_key_scope INTEGER,
    address_id INTEGER
        REFERENCES addresses(id) ON DELETE CASCADE,
    witness_stabilized INTEGER NOT NULL DEFAULT 0,
    note_version INTEGER NOT NULL DEFAULT 2,
    lock_expiry_height INTEGER,
    lock_owner BLOB,
    UNIQUE (transaction_id, action_index)
);
CREATE TABLE "orchard_received_note_spends" (
    orchard_received_note_id INTEGER NOT NULL
        REFERENCES orchard_received_notes(id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL
        REFERENCES transactions(id_tx) ON DELETE CASCADE,
    UNIQUE (orchard_received_note_id, transaction_id)
);
CREATE TABLE ironwood_received_notes (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL
        REFERENCES transactions(id_tx) ON DELETE CASCADE,
    action_index INTEGER NOT NULL,
    account_id INTEGER NOT NULL
        REFERENCES accounts(id) ON DELETE CASCADE,
    diversifier BLOB NOT NULL,
    value INTEGER NOT NULL,
    rho BLOB NOT NULL,
    rseed BLOB NOT NULL,
    nf BLOB UNIQUE,
    is_change INTEGER NOT NULL,
    memo BLOB,
    commitment_tree_position INTEGER,
    recipient_key_scope INTEGER,
    address_id INTEGER
        REFERENCES addresses(id) ON DELETE CASCADE,
    witness_stabilized INTEGER NOT NULL DEFAULT 0,
    note_version INTEGER NOT NULL,
    lock_expiry_height INTEGER,
    lock_owner BLOB,
    UNIQUE (transaction_id, action_index)
);
CREATE TABLE ironwood_received_note_spends (
    ironwood_received_note_id INTEGER NOT NULL
        REFERENCES ironwood_received_notes(id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL
        REFERENCES transactions(id_tx) ON DELETE CASCADE,
    UNIQUE (ironwood_received_note_id, transaction_id)
);
CREATE TABLE "transparent_received_outputs" (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL
        REFERENCES transactions(id_tx) ON DELETE CASCADE,
    output_index INTEGER NOT NULL,
    account_id INTEGER NOT NULL
        REFERENCES accounts(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    script BLOB NOT NULL,
    value_zat INTEGER NOT NULL,
    max_observed_unspent_height INTEGER,
    address_id INTEGER NOT NULL
        REFERENCES addresses(id) ON DELETE CASCADE,
    lock_expiry_height INTEGER,
    lock_owner BLOB,
    UNIQUE (transaction_id, output_index)
);
CREATE TABLE "transparent_received_output_spends" (
    transparent_received_output_id INTEGER NOT NULL
        REFERENCES transparent_received_outputs(id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL
        REFERENCES transactions(id_tx) ON DELETE CASCADE,
    UNIQUE (transparent_received_output_id, transaction_id)
);
CREATE TABLE "sent_notes" (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL
        REFERENCES transactions(id_tx) ON DELETE CASCADE,
    output_pool INTEGER NOT NULL,
    output_index INTEGER NOT NULL,
    from_account_id INTEGER NOT NULL
        REFERENCES accounts(id) ON DELETE CASCADE,
    to_address TEXT,
    to_account_id INTEGER
        REFERENCES accounts(id) ON DELETE SET NULL,
    value INTEGER NOT NULL,
    memo BLOB,
    UNIQUE (transaction_id, output_pool, output_index)
);
CREATE TABLE scan_queue (
    block_range_start INTEGER NOT NULL,
    block_range_end INTEGER NOT NULL,
    priority INTEGER NOT NULL,
    CONSTRAINT range_start_uniq UNIQUE (block_range_start),
    CONSTRAINT range_end_uniq UNIQUE (block_range_end),
    CONSTRAINT range_bounds_order CHECK (
        block_range_start < block_range_end
    )
);
CREATE VIEW v_received_outputs AS
    SELECT
        sapling_received_notes.id AS id_within_pool_table,
        sapling_received_notes.transaction_id,
        2 AS pool,
        sapling_received_notes.output_index,
        account_id,
        sapling_received_notes.value,
        is_change,
        sapling_received_notes.memo,
        sent_notes.id AS sent_note_id,
        sapling_received_notes.address_id
    FROM sapling_received_notes
    LEFT JOIN sent_notes
    ON (sent_notes.transaction_id, sent_notes.output_pool, sent_notes.output_index) =
       (sapling_received_notes.transaction_id, 2, sapling_received_notes.output_index)
UNION
    SELECT
        orchard_received_notes.id AS id_within_pool_table,
        orchard_received_notes.transaction_id,
        3 AS pool,
        orchard_received_notes.action_index AS output_index,
        account_id,
        orchard_received_notes.value,
        is_change,
        orchard_received_notes.memo,
        sent_notes.id AS sent_note_id,
        orchard_received_notes.address_id
    FROM orchard_received_notes
    LEFT JOIN sent_notes
    ON (sent_notes.transaction_id, sent_notes.output_pool, sent_notes.output_index) =
       (orchard_received_notes.transaction_id, 3, orchard_received_notes.action_index)
UNION
    SELECT
        ironwood_received_notes.id AS id_within_pool_table,
        ironwood_received_notes.transaction_id,
        4 AS pool,
        ironwood_received_notes.action_index AS output_index,
        account_id,
        ironwood_received_notes.value,
        is_change,
        ironwood_received_notes.memo,
        sent_notes.id AS sent_note_id,
        ironwood_received_notes.address_id
    FROM ironwood_received_notes
    LEFT JOIN sent_notes
    ON (sent_notes.transaction_id, sent_notes.output_pool, sent_notes.output_index) =
       (ironwood_received_notes.transaction_id, 4, ironwood_received_notes.action_index)
UNION
    SELECT
        u.id AS id_within_pool_table,
        u.transaction_id,
        0 AS pool,
        u.output_index,
        u.account_id,
        u.value_zat AS value,
        0 AS is_change,
        NULL AS memo,
        sent_notes.id AS sent_note_id,
        u.address_id
    FROM transparent_received_outputs u
    LEFT JOIN sent_notes
    ON (sent_notes.transaction_id, sent_notes.output_pool, sent_notes.output_index) =
       (u.transaction_id, 0, u.output_index);
CREATE VIEW v_received_output_spends AS
SELECT
    2 AS pool,
    s.sapling_received_note_id AS received_output_id,
    s.transaction_id,
    rn.account_id
FROM sapling_received_note_spends s
JOIN sapling_received_notes rn ON rn.id = s.sapling_received_note_id
UNION
SELECT
    3 AS pool,
    s.orchard_received_note_id AS received_output_id,
    s.transaction_id,
    rn.account_id
FROM orchard_received_note_spends s
JOIN orchard_received_notes rn ON rn.id = s.orchard_received_note_id
UNION
SELECT
    4 AS pool,
    s.ironwood_received_note_id AS received_output_id,
    s.transaction_id,
    rn.account_id
FROM ironwood_received_note_spends s
JOIN ironwood_received_notes rn ON rn.id = s.ironwood_received_note_id
UNION
SELECT
    0 AS pool,
    s.transparent_received_output_id AS received_output_id,
    s.transaction_id,
    rn.account_id
FROM transparent_received_output_spends s
JOIN transparent_received_outputs rn ON rn.id = s.transparent_received_output_id;
`;
const db = new DatabaseSync(path.join(STATE, "vault", "data.sqlite"));
db.exec(DDL);
db.prepare("INSERT INTO accounts(id,name,uuid,account_kind,uivk,birthday_height,has_spend_key) VALUES(1,'fixture',X'01',1,'ufvk-fixture',1,1)").run();
db.prepare("INSERT INTO addresses(id,account_id,key_scope,diversifier_index_be,address,receiver_flags) VALUES(1,1,0,X'00',?,0)").run(D1);
db.prepare("INSERT INTO addresses(id,account_id,key_scope,diversifier_index_be,address,receiver_flags) VALUES(2,1,0,X'01',?,0)").run(D2);
db.prepare("INSERT INTO transactions(id_tx,txid,mined_height,min_observed_height) VALUES(1,?,85,80)").run(Buffer.from(TXID, "hex").reverse()); // txid blobs are little-endian; benzo-scan prints the conventional hex
const insert = db.prepare("INSERT INTO ironwood_received_notes(id,transaction_id,action_index,account_id,diversifier,value,rho,rseed,is_change,memo,address_id,note_version) VALUES(?,1,?,1,X'00',?,X'00',X'00',0,?,?,2)");
FIXTURE.forEach((n, i) => insert.run(i + 1, n.action_index, n.value_zats, Buffer.from(n.memo_hex, "hex"), n.action_index === 2 ? 2 : 1));
db.prepare("INSERT INTO scan_queue(block_range_start,block_range_end,priority) VALUES(1,101,0)").run();
db.close();

// ---- the real scanner over the fixture wallet ----
const scanned = execFileSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "vault")], { maxBuffer: 64 << 20 })
  .toString().trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
check("r26-1-scanner-action-index",
  scanned.length === 3 && scanned.every((n, i) => n.action_index === FIXTURE[i].action_index && n.txid === TXID) &&
  scanned[0].action_index !== scanned[1].action_index && scanned[0].address === scanned[1].address,
  `scanner output positions differ: ${JSON.stringify(scanned.map(n => [n.action_index, n.diversifier_index, n.value_zats]))}`);

// ---- the tree's own party rule, through the shipped `benzo sign envelope-opens` ----
rmSync(REPO, { recursive: true, force: true });
mkdirSync(REPO, { recursive: true });
execFileSync("git", ["init", "-q"], { cwd: REPO });
writeFileSync(path.join(REPO, ".env"), "# fixture: the repro passes BNZ_STATE_DIR in the environment\n");
symlinkSync(path.join(ROOT, "scan"), path.join(REPO, "scan"), "dir");
writeFileSync(path.join(STATE, "signers", "alice", "envelope-key.json"), JSON.stringify({ public_hex: "11".repeat(32), private_hex: "22".repeat(32) }));
// R23 item 2: the report is signed with the signer's own witness key (a fixture key here; the flag is
// ignored by trees from before R23 item 2, so this harness runs against either).
writeFileSync(path.join(STATE, "witness-alice.key"), "33".repeat(32), { mode: 0o600 });
const signerKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const now = Math.floor(Date.now() / 1000);
const R = 2 + Math.floor((now + 30 * 86400 - schema.QUICKNET.genesis) / schema.QUICKNET.period);
const manifest = {
  version: 1, network: "test", auction_id: ID, escrow_ua: "utest1r261fixtureescrow", frost_group_key: "ab".repeat(32),
  lot: "r26-1 fixture", supply: 1, reserve_zats: "10", tick_zats: "10", B_max_zats: "30", q_max: 1,
  C_zats: "500000", fee_zats: "0", deposit_addresses: [D1, D2],
  drand: { ...schema.QUICKNET, R }, T_submit: now + 3600, T_freeze: now + 4500, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
};
const packet = schema.signRecord(manifest, signerKey);
const publicDir = path.join(WORK, "public");
mkdirSync(publicDir, { recursive: true });
writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify({ version: 1, auction_id: ID, signer: packet.signer, manifest: packet, state: "REFUNDING", receipts: [] }));
writeFileSync(path.join(STATE, "product", `${ID}.json`), JSON.stringify({ public_dir: publicDir, settlement: { signers: ["alice", "bob"], pczt_expiry_blocks: 364, batch_cap: 13 }, routing: { bidders: [], seller_ua: "utest1seller" } }));
const cli = spawnSync(process.execPath, [path.join(ROOT, "cli/dist/benzo.mjs"), "sign", "envelope-opens", "--id", ID, "--name", "alice", "--witness-key", path.join(STATE, "witness-alice.key")],
  { cwd: REPO, env: { ...process.env, BNZ_STATE_DIR: STATE }, encoding: "utf8", maxBuffer: 64 << 20 });
if (cli.status !== 0) { console.log(`ERROR r26-1-report-parties benzo sign envelope-opens refused: ${(cli.stderr || cli.stdout).trim().slice(-300)}`); } // R73-proto: was failed++ on an undefined name (a ReferenceError turned this FAIL into NOT RUN); the check below fails on an empty report
const report = cli.status === 0 ? JSON.parse(readFileSync(path.join(STATE, "settle", ID, "envelope-opens-alice.json"), "utf8")) : { opens: [] };
const entries = report.opens ?? [];
const newParty = (n: any) => `deposit:${n.txid}:${n.pool}:${n.action_index}`;
const expectedParties = new Set([newParty(FIXTURE[0]), newParty(FIXTURE[1])]);
check("r26-1-report-parties",
  entries.length === 2 && new Set(entries.map((e: any) => e.party)).size === 2 && entries.every((e: any) => expectedParties.has(e.party)),
  `tree party rule gave ${JSON.stringify(entries.map((e: any) => e.party))}; want exactly ${JSON.stringify([...expectedParties])} (no zero-value entry)`);

// ---- the shipped ledger: one refund row per report entry (the plan's per-note rows) ----
// Party to note: the new rule matches exactly; the pre-fix diversifier-index rule maps to the first note
// of the address (both same-address notes collide) — that collision is what the ledger then refuses.
const noteFor = (party: any) => {
  const neu = /^deposit:([0-9a-f]{64}):(sapling|orchard|ironwood):(\d+)$/.exec(party);
  if (neu) return FIXTURE.find(n => n.txid === neu[1] && n.pool === neu[2] && String(n.action_index) === neu[3]);
  const legacy = /^deposit:([0-9a-f]{64}):(.+)$/.exec(party);
  return legacy ? FIXTURE.find(n => n.txid === legacy[1] && String(n.diversifier_index) === legacy[2]) : undefined;
};
const rows = entries.map((e: any) => ({ party: e.party, kind: "refund", amount_zats: String(noteFor(e.party)?.value_zats) }));
const led = new ledger.Ledger(STATE, ID);
let pinned = null, pinError = null;
try { pinned = led.pin(rows); } catch (e) { pinError = ((e as Error).message ?? String(e)).replace(/^refused: /, ""); }
const stored = led.rows();
led.close();
check("r26-1-two-refund-rows",
  pinned !== null && stored.length === 2 && new Set(stored.map(r => r.party)).size === 2 &&
  stored.every(r => r.kind === "refund") && stored.map(r => r.amount_zats).sort().join(",") === "7000,8000" &&
  !stored.some(r => r.party === `deposit:${TXID}:ironwood:2`),
  pinError ? `plan refuses (${pinError})` : `ledger rows ${JSON.stringify(stored.map(r => [r.party, r.amount_zats]))}`);

// ---- verify's accounting over the same identities ----
const zeroParty = `deposit:${TXID}:ironwood:2`;
const basePub = {
  dir: ROOT, signer: packet.signer, legacy: true, state: "REFUNDING",
  manifestPacket: packet, manifest, manifest_hash: schema.hash(Buffer.from(packet.bytes, "base64")),
  frozen: null, opened: [], beacon: null, serialBeacon: null, launchInput: undefined,
  result: null, resultBytes: null, receipts: [], envelopes: [], witnessSet: null, witnessCerts: [],
  claims: [], reserveOpening: null, deliveryList: null,
};
const accountingStrays = (settlement: any) => {
  const checks = api.checkPublicAuction({ ...basePub, settlement } as any, {}) /* test fixture */;
  return checks.find(c => c.id === "accounting-strays")?.error ?? null;
};
const paidZero = accountingStrays({
  rows: [{ party: zeroParty, kind: "refund", amount_zats: "0", state: "paid" }],
  receipts: [{ auction_id: ID, party: zeroParty, txid: "cd".repeat(32), pool: "ironwood", output_index: 2, amount_zats: "0" }],
});
check("r26-1-zero-paid-refused", !!paidZero && /stray .* amount/.test(paidZero),
  paidZero === null ? "accounting-strays accepted a settlement paying the zero-value note" : `unexpected error ${paidZero}`);
const counted = accountingStrays({ rows: [], receipts: [], ignored: [{ party: zeroParty, amount_zats: "0" }] });
const miscounted = accountingStrays({ rows: [], receipts: [], ignored: [{ party: zeroParty, amount_zats: "5" }] });
check("r26-1-zero-counted", counted === null && !!miscounted,
  `counted=${JSON.stringify(counted)} miscounted=${JSON.stringify(miscounted)}`);
  for (const [id, ok, reason] of collected) await run.check(id, id, () => need(ok, reason));
}
