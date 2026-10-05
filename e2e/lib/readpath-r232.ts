// @ts-nocheck
// R35 fold (run 33): a verbatim port of tools/repro/r23-2-signed-opens-repro.mjs (R23 item 2) — the
// script stays until gate RG proves the folded IDs pass and then deletes it. The body is the script's
// own (fixture wallet + scratch state, the shipped `benzo sign envelope-opens` writer and the
// settle/envelopes agreedDestinations gate); its `check(id, ok, reason)` calls are collected and replayed
// through Run.check so the assertion IDs and expected values are byte-identical to the script's.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync, statSync, existsSync } from "node:fs";
import { createHash, generateKeyPairSync, randomBytes, sign as edSign, verify as edVerify } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import * as schema from "../../manifest/schema";
import * as witness from "../../witness";
import * as settle from "../../settle/envelopes";
import { ROOT } from "./env";
import type { Run } from "./run";

export async function foldR232(run: Run): Promise<void> {
  const WORK = path.join(ROOT, "tmp/e2e/r23-2");
  const STATE = path.join(WORK, "state");
  const REPO = path.join(WORK, "repo");
  const sha256 = (b: any) => createHash("sha256").update(b).digest("hex");
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
  const check = (id: any, ok: any, reason: any) => { collected.push([String(id), !!ok, String(reason ?? "")]); };
// ---- fixture wallet (one note) + scratch state/repo for the shipped writer ----------------------
rmSync(WORK, { recursive: true, force: true });
for (const d of ["vault", "run", "signers/alice", "product", "settle", "witness"]) mkdirSync(path.join(STATE, d), { recursive: true });
const TXID = "f200000000000000000000000000000000000000000000000000000000000002";
const D = "utest1r232fixturedeposit";
const memo = Buffer.alloc(512);
Buffer.from("ff424e5a01", "hex").copy(memo, 0);
const ct = randomBytes(180);
memo.writeUInt16BE(ct.length, 5);
ct.copy(memo, 7);
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
db.prepare("INSERT INTO addresses(id,account_id,key_scope,diversifier_index_be,address,receiver_flags) VALUES(1,1,0,X'00',?,0)").run(D);
db.prepare("INSERT INTO transactions(id_tx,txid,mined_height,min_observed_height) VALUES(1,?,85,80)").run(Buffer.from(TXID, "hex").reverse());
db.prepare("INSERT INTO ironwood_received_notes(id,transaction_id,action_index,account_id,diversifier,value,rho,rseed,is_change,memo,address_id,note_version) VALUES(1,1,0,1,X'00',4000,X'00',X'00',0,?,1,2)").run(memo);
db.prepare("INSERT INTO scan_queue(block_range_start,block_range_end,priority) VALUES(1,101,0)").run();
db.close();

execFileSync("git", ["init", "-q"], { cwd: (mkdirSync(REPO, { recursive: true }), REPO) });
writeFileSync(path.join(REPO, ".env"), "# fixture: the repro passes BNZ_STATE_DIR in the environment\n");
symlinkSync(path.join(ROOT, "scan"), path.join(REPO, "scan"), "dir");
writeFileSync(path.join(STATE, "signers", "alice", "envelope-key.json"), JSON.stringify({ public_hex: "11".repeat(32), private_hex: "22".repeat(32) }));

// The pinned witness set: three fixture keys, q_w = 2 (the same shape the product flow pins).
const edRaw = (k) => ({
  private_hex: k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16).toString("hex"),
  public_hex: k.publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex"),
});
const W = [0, 1, 2].map(() => edRaw(generateKeyPairSync("ed25519")));
const foreign = edRaw(generateKeyPairSync("ed25519"));
for (const [i, w] of W.entries()) writeFileSync(path.join(STATE, "witness", `w${i}.key`), w.private_hex, { mode: 0o600 });

const signerKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
const now = Math.floor(Date.now() / 1000);
const R = 2 + Math.floor((now + 30 * 86400 - schema.QUICKNET.genesis) / schema.QUICKNET.period);
const ID = createHash("sha256").update("r23-2 fixture").digest("hex");
const witnessSet = schema.signRecord({ version: 1, auction_id: ID, q_w: 2, keys: W.map(w => w.public_hex) }, signerKey);
const manifest = {
  version: 1, network: "test", auction_id: ID, escrow_ua: "utest1r232fixtureescrow", frost_group_key: "cd".repeat(32),
  lot: "r23-2 fixture", supply: 1, reserve_zats: "10", tick_zats: "10", B_max_zats: "30", q_max: 1,
  C_zats: "500000", fee_zats: "0", deposit_addresses: [D],
  drand: { ...schema.QUICKNET, R }, T_submit: now + 3600, T_freeze: now + 4500, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  witness_set_hash: schema.hash(schema.jsonBytes(witnessSet)),
};
const packet = schema.signRecord(manifest, signerKey);
const publicDir = path.join(WORK, "public");
mkdirSync(publicDir, { recursive: true });
writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify({ version: 1, auction_id: ID, signer: packet.signer, manifest: packet, state: "REFUNDING", receipts: [], witness_set: witnessSet }));
writeFileSync(path.join(STATE, "product", `${ID}.json`), JSON.stringify({ public_dir: publicDir, settlement: { signers: ["alice", "bob"], pczt_expiry_blocks: 364, batch_cap: 13 }, routing: { bidders: [], seller_ua: "utest1seller" } }));

// ---- the shipped writer: `benzo sign envelope-opens` signs with the signer's own witness key ----
const cliRun = spawnSync(process.execPath, [path.join(ROOT, "cli/dist/benzo.mjs"), "sign", "envelope-opens", "--id", ID, "--name", "alice", "--witness-key", path.join(STATE, "witness", "w0.key")],
  { cwd: REPO, env: { ...process.env, BNZ_STATE_DIR: STATE }, encoding: "utf8", maxBuffer: 64 << 20 });
const reportFile = path.join(STATE, "settle", ID, "envelope-opens-alice.json");
if (cliRun.status !== 0) {
  check("r23-2-report-signed", false, `writer refused: ${(cliRun.stderr || cliRun.stdout).trim().slice(-300)}`);
} else {
  const r = JSON.parse(readFileSync(reportFile, "utf8"));
  // Independent check (node:crypto, the documented format): Ed25519 over
  // "benzo-envelope-opens-v1" || canonical JSON {signer, opens}, by the signer's witness key.
  const body = schema.jsonBytes({ signer: r.signer, opens: r.opens });
  let bound = false;
  try {
    const keyDer = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(r.witness, "hex")]);
    bound = r.witness === W[0].public_hex && r.signer === "alice" &&
      typeof r.signature === "string" && /^[0-9a-f]{128}$/.test(r.signature) &&
      edVerify(null, Buffer.concat([Buffer.from("benzo-envelope-opens-v1"), body]), { key: keyDer, type: "spki", format: "der" }, Buffer.from(r.signature, "hex"));
  } catch { bound = false; }
  check("r23-2-report-signed", bound, `report ${JSON.stringify({ signer: r.signer, witness: r.witness, signature: r.signature })}`);
}

// ---- the shipped gate (settle/envelopes.ts agreedDestinations) -----------------------------------
const keys = W.map(w => w.public_hex);
const dest = createHash("sha256").update("agreed destination").digest("hex");
const party = `deposit:${TXID}:ironwood:0`;
const opens = [{ leaf: null, party, ok: true, dest_sha256: dest }];
const signReport = (signer, w) => ({ signer, opens, witness: w.public_hex, signature: edSign(null, Buffer.concat([Buffer.from("benzo-envelope-opens-v1"), schema.jsonBytes({ signer, opens })]), { key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(w.private_hex, "hex")]), type: "pkcs8", format: "der" }).toString("hex") });

const forged = [{ signer: "alice", opens }, { signer: "bob", opens }];
const forgedAgreed = settle.agreedDestinations(forged, keys);
check("r23-2-forged-report-ignored", !forgedAgreed.has(party),
  `forged unsigned reports agreed ${party} -> ${forgedAgreed.get(party)} (a fabricated pair satisfied the two-signer gate)`);

const twoSigned = [signReport("alice", W[0]), signReport("bob", W[1])];
const signedAgreed = settle.agreedDestinations(twoSigned, keys);
check("r23-2-two-signed-agree", signedAgreed.get(party) === dest,
  `two distinct pinned witness keys did not agree (got ${signedAgreed.get(party)})`);

const oneKey = [signReport("alice", W[0]), signReport("bob", W[0])];
const oneKeyAgreed = settle.agreedDestinations(oneKey, keys);
check("r23-2-one-key-twice", !oneKeyAgreed.has(party),
  `one witness key counted twice (agreed ${oneKeyAgreed.get(party)})`);

const outside = [signReport("alice", foreign), signReport("bob", W[1])];
const outsideAgreed = settle.agreedDestinations(outside, keys);
check("r23-2-foreign-key", !outsideAgreed.has(party),
  `a report outside the pinned witness set counted (agreed ${outsideAgreed.get(party)})`);
  for (const [id, ok, reason] of collected) await run.check(id, id, () => need(ok, reason));
}
