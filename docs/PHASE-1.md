# Phase 1: testnet feasibility spike

- **Window:** 2026-09-30 to 2026-10-07 23:59 UTC.
- **Gate A (FROST) cut-off:** 2026-10-05 23:59 UTC, the day before the planned testnet NU7 activation.
- **Networks:** Zcash testnet (NU6.3 / Ironwood, active since height 4,134,000) and drand mainnet quicknet. No mainnet transaction of any kind.
- **Ownership:** the head agent owns this file. You read it and don't edit it.
  - Results, questions and deviations go in `docs/STATUS.md`.
  - Artifacts go in `docs/evidence/phase-1/`.
  - The phase changes only through committed Rulings (section 14).
- **Pinned values:** the endpoints, the drand chain hash, public key, genesis and period, and the collateral C live in `.env.example`. Changing one needs a Ruling.

## 1. Goal and finish line

DESIGN.md §12 lists the week-1 claims, and none of them has been run end to end. In this phase you:
- run each claim once on testnet;
- leave evidence that a reviewer who trusts nothing in this repository can re-check;
- record three decisions.

Build nothing from later phases.

| Gate | Question |
|---|---|
| G0 | Do the pinned tools build from their pins? |
| A | Can a 2-of-3 FROST group (RedPallas, dealerless DKG) spend, through a PCZT, Ironwood notes it **received** (not migrated)? |
| B | Do exact binary memo bytes survive sending, mining and a full-transaction scan with the vault's viewing key? |
| C | A 128-byte bid is sealed in the browser with tlock-js. Does Go `tle` fail to open it before round R, and open it byte-exact after R? |
| D | Does the vault scanner map each fixed-C deposit to its per-bid diversified address, while the operator sees only "C plus an opaque blob"? |

| Decision (rules in section 8) | Options |
|---|---|
| Bid transport | `binary_memo` or `offchain_digest` |
| Custody | `frost_2of3`, or `single_key` (the second only by Ruling) |
| Sealer | `tlock-js@0.9.0` or a named fallback |

**Finish line.** Phase 1 is done when all of the following hold:
1. Every gate is READY FOR REVIEW, or FAILED or BLOCKED with its evidence and a one-command repro. Gate C depends only on drand and our code, so only a drand or network outage can block it.
2. The evidence for gates A–D was written by `tools/setup-testnet.sh` (`setup/`) and by one run of `BNZ_EVIDENCE_DIR=docs/evidence/phase-1 npm run e2e:live` at a recorded commit (everything else, with `run.json`).
3. `docs/evidence/phase-1/verify.sh` exits 0 on that evidence, and has been seen failing (section 7).
4. Each test has been seen failing under every mutation section 9 names for it.
5. The three decisions are recorded in STATUS and in `EVIDENCE.md`, each with the evidence that drove it.
6. STATUS says READY FOR REVIEW.

## 2. Read first

- `docs/research/DESIGN.md`: §1, §3–6, §12 and §14.
- `docs/research/zcash-feasibility.md`:
  - §2–6;
  - "Proposed stack and coherent dependency strategy";
  - "Hard blockers and workarounds";
  - "Four-week execution gates".

  Skip its "Proposed bid format and transport fallback" (the `AUC` marker, and the refund receiver inside the plaintext). DESIGN §4 and section 6 here replace it.
- `docs/research/threat-model.md`:
  - "Minimum design for judging 'no leaks'", items 1, 2, 6 and 8;
  - threats 001, 003, 013, 021, 036 and 057.
- PR #593, the testnet sequence you are reproducing. It produced mined FROST-signed Ironwood spends in Aug 2026: https://github.com/ZcashFoundation/frost-tools/pull/593
- The FROST book devtool tutorial. Two of its details are stale (trap 2): https://github.com/ZcashFoundation/frost/blob/main/book/src/zcash/devtool-demo.md

## 3. Pinned facts

These were verified on 2026-09-30. Re-check a fact only when something that depends on it fails.

**Primary endpoint:** `testnet.zec.rocks:443`.
- Native gRPC over TLS: lightwalletd v0.5.4 on Zebra 6.3.0, consensus branch `37a5165b`.
- Browsers can't reach it; the gRPC-Web preflight returns 404.

**Second endpoint:** `zaino.testnet.unsafe.zec.rocks:443` (ZainoD 0.6.0). Use it for cross-checks only.

**Transaction lookup:** call `GetTransaction` with `TxFilter.hash` set to the txid bytes in reverse order (base64 in grpcurl JSON).

**drand quicknet:**
- Scheme: `bls-unchained-g1-rfc9380`.
- The first round at or after UTC time T is `R = 1 + ceil((T − genesis) / period)`.
- A request for a future round returns HTTP 425.
- Never use a drand testnet chain.

**Go `tle` v1.2.0:**
- Decrypting before the round fails with `too early to decrypt`. It reports **any** failure to fetch the beacon (outage, timeout, 5xx) with the same error, which is why gate C also checks the relay.
- It reads binary or armor, and has no `--version` flag.
- It trusts the chain hash inside the ciphertext. That is why gate C checks the stanza.

**tlock-js 0.9.0:**
- `timelockEncrypt` returns armor, so decode it to binary.
- It does not reject past rounds.
- It fetches chain info over the network unless you give it a client built from the pinned info.

**Known-good FROST spends** (PR #593; both v6, branch `37a5165b`):
- `c5a1c4a11706d2c0083390c9220e2729aba024045030d24854ed38eca7d7410e`, height 4,246,513.
- `23ec9a37dc58e0317f10a51be9b0254766c5ef59cc812f3c140a1c1165fc7740`, a 4-input spend at height 4,246,606.

**NU7:**
- Planned for testnet on Oct 6 and mainnet on Nov 5. The final decision is due Oct 20. There is no new transaction format.
- As of Sep 30, no testnet activation height has been published, and Zebra `main` still has a placeholder branch ID.
- After activation, PCZTs and sighashes must bind the NU7 branch ID (https://forum.zcashcommunity.com/t/nu7-timeline/57655).

**This machine:**
- Installed: Rust 1.93.1, Go 1.25.6, Node 24.15.0, openssl 3.6, jq and sqlite3.
- Not installed: `protoc`, `mkcert`, `grpcurl` and `tle`.
- 88 GiB of disk was free on Sep 30 (after the head agent removed 75 GB of research clones).

## 4. Toolchain (G0) and known traps

**Pins and bootstrap.**
- Put every pin in `tools/pins.env`.
- `tools/bootstrap.sh` installs into `$BNZ_STATE_DIR/bin` with:
  - `cargo install --locked --git <url> --rev <sha> --root "$BNZ_STATE_DIR" <bin>`;
  - `GOBIN="$BNZ_STATE_DIR/bin" go install <pkg>@<tag>`.
- It then writes `docs/evidence/phase-1/versions.txt`:
  - for each Rust tool, its line from `cargo install --list --root "$BNZ_STATE_DIR"` (the line includes `?rev=<sha>`);
  - for each Go tool, `go version -m "$BNZ_STATE_DIR/bin/<tool>"`;
  - for each npm package, the version resolved in `package-lock.json`.

| Tool | Pin |
|---|---|
| zcash-devtool | `5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8` (pczt 0.9.3) |
| frost-tools: frost-client, frostd, zcash-sign | `06c0dbdbb1bac9b99cd255e74ba2f387c295e660` (pczt 0.8.0-rc.1; orchard patched to conradoplg `42015f1`). The old frost-zcash-demo URL resolves to this repo. |
| tle | `github.com/drand/tlock/cmd/tle@v1.2.0` |
| tlock-js | exactly `0.9.0`, with the lockfile committed |
| grpcurl | A tagged release. Protos: `lightwallet-protocol/walletrpc/{service,compact_formats}.proto` from `zcash/lightwalletd` at `d16d48124e9a`, fetched at that commit. The `walletrpc/*.proto` paths are symlinks; don't use them. |
| Playwright, esbuild | exact versions; Chromium only |

**Known traps.** Handle them; don't rediscover them.

1. **PCZT version gap.** devtool writes pczt 0.9.3, but zcash-sign parses 0.8.0-rc.1. PR #593 crossed an older gap (0.7 to 0.8.0-rc.1); this one is unverified.
   - As soon as any wallet holds a spendable note, create a PCZT with devtool and run `zcash-sign sign -n test` on it until it prints `SIGHASH:`. This is a development check; record the result in STATUS.
   - If parsing fails, pin devtool to `f00def6aac4b` (pczt 0.8.0-rc.1, the version zcash-sign parses). If that fails, pin it to `fabd984c1e38` (pczt 0.7.0, the gap PR #593 crossed). Both have every command this phase uses. Don't use `dc7d1cf1bad5`: it has pczt 0.9.1.
   - After a devtool downgrade, re-create the wallets, because newer wallet databases may not open in older builds. Re-create the vault with `init-fvk` and the same UFVK, and the bidder with `restore-mnemonic`.
   - If both pins fail, bump zcash-sign's `pczt` with a patch of at most 50 lines in `tools/patches/`.
   - These changes are pre-authorized. Record the path you took under Deviations.
2. **Stale tutorial; zcash-sign default network.**
   - The flag is `-n/--network test`, not `--net`. Only `main` and `test` exist.
   - zcash-sign defaults to `main`, so pass `-n test` on every call.
   - Use a birthday of the current tip minus 10, not `3720000`.
3. **frostd TLS.** frost-client only speaks https.
   - With openssl, generate a local CA and a certificate with SANs `DNS:localhost` and `IP:127.0.0.1`, into `$BNZ_STATE_DIR/tls/`.
   - frostd binds 0.0.0.0 by default. Start it with `-i 127.0.0.1 -c <cert> -k <key>`.
   - Set `SSL_CERT_FILE=<CA>` only on frost-client invocations. Set globally, it breaks every other TLS client.
   - Don't use `mkcert -install`, which changes the system keychain. Don't use `--no-tls-very-insecure`.
4. **Binary memos.** `pczt create --memo` takes text only. Send binary memos through ZIP-321:
   `zcash-devtool wallet -w "$BNZ_STATE_DIR/bidder" pay -i "$BNZ_STATE_DIR/bidder.age" --disable-confirmation -s zecrocks --payment-uri 'zcash:<ua>?amount=<C in ZEC, e.g. 0.005>&memo=<base64url, no padding>'`.
5. **Zero-trimmed memos.** `MemoBytes::as_slice()` trims trailing zeros. Read memos with `WalletRead::get_memo` and emit `MemoBytes::from(&memo).as_array()`: all 512 bytes. The envelope's length field marks where the ciphertext ends.
6. **Three commands read stdin.** Drive them from the E2E glue:
   - `zcash-sign sign` prints `SIGHASH: <hex>`, then for each shielded spend prints `Randomizer #<i> (<pool>): <hex>` and waits for that spend's hex signature before it prints the next one. Keep the process running while the signatures are made.
   - `frost-client participant` asks `Do you want to sign it? (y/n)`; answer `y`.
   - `wallet pay` asks for confirmation unless you pass `--disable-confirmation`.
7. **frost-client defaults and signing sessions.**
   - Without `-c <config>`, frost-client reads and writes `$HOME/.local/frost/credentials.toml`, which is outside this repository. Pass `-c "$BNZ_STATE_DIR/frost/<name>.toml"` on every call.
   - The ciphersuite defaults to ed25519. Pass `-C redpallas` wherever the flag applies.
   - At `06c0dbdb` one coordinator session produces exactly one signature: it signs only the first `-m` with the first `-r`. Run one session per randomizer.
   - Without `-r`, the coordinator picks a random randomizer, and the signature won't match the PCZT. `-m` and `-r` take a path to a raw-bytes file, or `-` to read hex from stdin.
8. **Confirmations.** `pczt create` and `create-max` require 10 confirmations on received notes (3 on your own change). At 75 s blocks, a note becomes spendable about 13 minutes after it is mined. By default `create-max` fails while the wallet holds any unspendable funds. Poll; don't change the policy.
9. **`wallet sync` does not fetch memos.** At devtool `5a26ee85`, `sync` scans compact blocks only. `zcash-devtool wallet -w <dir> enhance -s zecrocks` fetches the full transactions, and with them the memos. Run `sync`, then `enhance`, before the scanner reads memos.
10. **No regtest and no own node.** zcash-sign accepts only `main` and `test`, and Zebra, lightwalletd and Zaino don't fit on this disk. Use the two public endpoints.
11. **Disk.** If `df -h .` shows less than 20 GiB free before G0, or a build would leave less than 5 GiB, ask under Needs user.

**G0 is READY FOR REVIEW** when every tool builds from its pin through `tools/bootstrap.sh` and `versions.txt` is written.

## 5. The golden path

### One-time setup: `tools/setup-testnet.sh`

The script is safe to re-run: it refuses to generate keys when `$BNZ_STATE_DIR/frost/` or the vault wallet already exists. With `BNZ_EVIDENCE_DIR` set, it writes `setup/group-key.txt`. That file holds the DKG command lines, frostd's log lines for the DKG session (if frostd logs them), and the group key as printed by all three configs. Its full log goes to `$BNZ_STATE_DIR/run/`.

1. **Bootstrap and frostd.** Run `tools/bootstrap.sh` (G0). Start frostd detached, with the local TLS certificate (trap 3).
2. **FROST group.**
   - Create three frost-client configs: `$BNZ_STATE_DIR/frost/{alice,bob,carol}.toml`.
   - Exchange contacts between them.
   - Run a dealerless DKG with all three running at the same time: `frost-client dkg … -C redpallas -t 2`.
   - A trusted dealer is for local debugging only. It never appears in committed code or in evidence.
3. **Vault key.** `zcash-sign generate -n test --ak <group public key>` prints the vault UFVK and address.
   - Store the UFVK in `$BNZ_STATE_DIR/ufvk.txt`, and the group key and the birthday under `$BNZ_STATE_DIR`.
   - This FVK is final for Phase 1. Never regenerate it after funding, and don't mix in Cyze's FVK derivation.
4. **Vault wallet.** Run `zcash-devtool wallet -w "$BNZ_STATE_DIR/vault" init-fvk --name vault --fvk "$(cat "$BNZ_STATE_DIR/ufvk.txt")" --birthday <tip − 10> -s zecrocks`.
5. **Bidder wallet.** Run `zcash-devtool wallet -w "$BNZ_STATE_DIR/bidder" init --name bidder -i "$BNZ_STATE_DIR/bidder.age" -n test -s zecrocks`. It generates the age identity if the file is missing.
   - Post the wallet's UA under Needs user, asking for at least 0.1 TAZ (0.5 recommended).
   - Build gate C while you wait. Faucet funds need about 10 confirmations.

**Signers.** By default all three participants run on this machine, each with its own config, and `EVIDENCE.md` lists that as a limitation. If a Ruling provides a second machine, bob runs there. Then start frostd with `-i <LAN IP>`, add `IP:<LAN IP>` to the certificate SANs, set `BNZ_FROSTD_ADDR` to `<LAN IP>:2744` on both machines, and copy only the CA certificate (never its key) to bob's machine.

### Live run (test 2 in section 9)

6. **Seal.**
   - Derive two fresh vault addresses with `zcash-devtool wallet -w "$BNZ_STATE_DIR/vault" generate-address`, one per bid. Record each bid's address before paying (evidence: `scan/addresses.json`).
   - Seal two bids in the sealer page. Use different random prices and quantities, the same auction ID and C, and an opening time 30 minutes ahead.
7. **Pay.** Pay each bid from the bidder wallet, through its ZIP-321 URI (trap 4), to that bid's vault address. The amount is exactly C. If the first payment leaves the bidder no spendable note, poll until its change has 3 confirmations, then pay the second.
8. **Scan.** When both deposits are mined, run `sync` and then `enhance` on the vault (trap 9), then run the scanner.
   - It opens only the vault wallet and reads its received notes through librustzcash (`zcash_client_backend` / `zcash_client_sqlite` at devtool's crate versions).
   - It prints one JSON line per received note, with all 512 memo bytes (trap 5): `{txid, height, pool, address, diversifier_index, value_zats, memo_hex}`.
   - It never opens the bidder wallet, a sent-notes table or the sealer's output. It never parses human-readable CLI output and never hand-rolls trial decryption. Compact blocks carry only 52 memo bytes.
9. **FROST refund.** After 10 confirmations, follow PR #593's order. Keep raw PCZTs under `$BNZ_STATE_DIR`.
   1. `pczt create-max --address <fresh bidder UA> --output created.pczt` on the vault wallet.
   2. `pczt prove created.pczt --output proven.pczt`.
   3. `zcash-sign sign -n test -i proven.pczt -o signed.pczt`. It prints the sighash, then one randomizer at a time (trap 6).
   4. For each randomizer, run one signing session (trap 7): `frost-client coordinator -c "$BNZ_STATE_DIR/frost/alice.toml" -s "$BNZ_FROSTD_ADDR" -g <group key> -S <alice pubkey>,<bob pubkey> -m <sighash.bin> -r <alpha_i.bin> -o -`. Meanwhile alice and bob each run `frost-client participant -c <own config> -s "$BNZ_FROSTD_ADDR" -g <group key>` and answer `y`. Write the printed signature to the waiting zcash-sign.
   5. `pczt send signed.pczt`. PR #593 signs the proven PCZT, so no `pczt combine` is needed. Combine only if you sign `created.pczt` instead, as the FROST book does.
10. **Settle.** Sync both wallets and read `zcash-devtool wallet -w <dir> balance --json` for each. The bidder's total has risen by the value of the spent vault notes minus the fee, and the vault's total is 0.

A failed run can leave notes in the vault, and the next run's `create-max` sweeps them. So assert that this run's two deposits are among the refund's inputs, and don't assert an exact input count.

## 6. Sealer contract (gate C)

`seal/` holds one static page, bundled with the pinned esbuild into `seal/dist/` (gitignored). It has no UI framework and no styling. It is the only user-facing code in this phase.

**Plaintext v0.** Exactly 128 bytes, with big-endian integers:

| Bytes | Field |
|---|---|
| 0 | version u8 = `0x00` |
| 1–32 | auction_id |
| 33–40 | price_zats u64 |
| 41–44 | quantity u32 |
| 45–60 | nonce (CSPRNG) |
| 61–92 | owner_pubkey |
| 93–124 | settlement_commitment |
| 125–127 | zero pad |

In Phase 1, `owner_pubkey` and `settlement_commitment` are random bytes; no keys or envelopes stand behind them yet.

**Envelope.** 512 bytes:

```
0xFF | "BNZ" | 0x01 | ct_len u16 BE | raw binary age ciphertext | zero pad to 512
```

- Expect about 487 ciphertext bytes, 494 in total. Measure the real length and record it.
- Never put armor or base64 in a memo.

**The page:**
- takes the auction's opening time T (UTC) as input, and computes R with the formula in section 3;
- refuses any R at or below the current round, which it computes from the clock;
- pins the quicknet chain hash and public key, and builds its tlock client from them;
- keeps the plaintext in memory only;
- makes no network request of any kind (fetch, XHR, websocket, sendBeacon, image) from the first keystroke until the envelope is shown.

**It outputs** what a bidder copies: the envelope hex and the ZIP-321 URI.

## 7. Gates: criteria and evidence

Paths are relative to `docs/evidence/phase-1/`. The assertion IDs are defined in section 9.

**G0.** Ready for review when every tool builds from its pin (section 4). Evidence: `versions.txt`.

**Gate A.** Ready for review when A1–A5 hold. Evidence:
- `frost/refund.json`: the txid; the height as returned by both endpoints; the v6 header; the branch ID.
- `frost/coordinator.txt`: the sighash, and for each session the signer pubkeys, the randomizer and the signature.
- `frost/settle.json`: for each run deposit, its txid, value and `spent_in_txid` (the refund txid), read by the scanner from the vault wallet; the bidder's and the vault's `balance --json` totals before and after the refund; the fee, from `pczt inspect`.
- `frost/pczt-inspect.txt`: `pczt inspect` summaries. Never raw PCZTs.
- `setup/group-key.txt` (section 5).

**Gate B.** Ready for review when B1 holds. Evidence: `memo/bid{1,2}.sent.hex`, `memo/bid{1,2}.scanned.hex`, `memo/sha256sums.txt`, and `memo/deposits.json` (the deposit txids and heights).

**Gate C.** Ready for review when C1–C7 hold. Evidence:
- `tlock/before.txt` and `tlock/after.txt`: for each ciphertext, the UTC time, the latest round, the HTTP status of `/public/<R>`, the `tle` exit code and its output.
- `tlock/beacon-R.json`.
- `tlock/*.ct.hex` and `tlock/*.pt.hex`: the ciphertexts and plaintexts.
- `tlock/requests.jsonl`: every request and websocket event the page made.

**Gate D.** Ready for review when D1–D3 hold. Evidence: `scan/addresses.json` and `scan/operator-view.jsonl`.

**`run.json`** records the evidence run (section 10).

**`verify.sh`** takes the evidence directory as its only argument and re-checks it against the chain and drand. It:
- re-fetches every recorded txid from both endpoints, and re-checks heights, the v6 header and the branch ID;
- checks that the byte-reversed sighash equals the refund txid (ZIP 244, shielded-only tx; see PR #593);
- checks that each 64-byte signature appears in the raw tx;
- re-runs `tle -d` on the committed ciphertexts and compares the output with the committed plaintexts;
- re-derives each memo from the raw deposit tx fetched from `BNZ_LWD_URL_ALT` and decrypted with the vault UFVK by a `verify` mode of the scanner (`zcash_client_backend::decrypt_transaction`, no wallet database). The memo must equal both `bidN.scanned.hex` and `bidN.sent.hex`;
- checks that the Orchard-protocol `ak` in the vault UFVK equals the group key in `setup/group-key.txt`. If the pinned crates can't expose `ak`, record that under Found;
- checks each file's SHA-256 against `run.json`, and that `git diff --quiet <run commit> HEAD -- e2e seal scan tools package-lock.json playwright.config.ts` reports no change.

The two UFVK checks read `$BNZ_STATE_DIR`, so they run only on this machine. A missing or empty input prints `ERROR <gate> missing <path>`. The one exception is a gate that `EVIDENCE.md` marks BLOCKED or FAILED, which prints `NOT CHECKED <gate> <state>`. A check with no input never prints OK. Every check runs even after an earlier one fails. verify.sh prints one line per check, and exits 0 only if every check passes.

It must be seen failing. Copy the evidence to `tmp/verify-neg/`, flip one hex digit in `memo/bid1.scanned.hex` and one in the txid in `frost/refund.json`, and run verify.sh on the copy. It must exit non-zero, with an `ERROR B` line from the memo re-derivation and an `ERROR A` line from the chain re-fetch. Record both lines in STATUS.

## 8. Decisions

Record each decision in STATUS and in `EVIDENCE.md`, with the evidence that drove it.

**Bid transport.**
- Choose `binary_memo` if B1 holds on the reference path (devtool `wallet pay` with a ZIP-321 URI) and the envelope fits in 512 bytes.
- Otherwise choose `offchain_digest`: a text memo `BNZ1:<auction_id>:<R>:<sha256(ciphertext)>`. Record the decision only; don't build replication.
- The user may report consumer-wallet results. They go in a small table in `EVIDENCE.md`; they inform Phase 3 and don't change this decision.

**Custody.**
- Choose `frost_2of3` if gate A is READY FOR REVIEW by the cut-off.
- If only a 1-input FROST spend works (tried from a scratch script in `tmp/`, never as gate evidence), record it, name the blocker for the 2-input spend, and set custody to `pending_ruling`.
- If gate A has no evidence by the cut-off:
  - stop FROST work;
  - write the blocker with a one-command repro;
  - set custody to `pending_ruling`.

  The head agent then rules on `single_key` or an extension.

**Sealer.**
- Choose `tlock-js@0.9.0` if gate C is READY FOR REVIEW.
- Otherwise, name the failure and propose one fallback without building it: tlock-rs `tlock_age` compiled to WASM, or Go `tle` compiled to WASM.

## 9. Tests this phase leaves behind: exactly two

Both follow the test rules in `AGENTS.md`, and each file opens with the four answers.

**Harness.**
- `package.json`: `"e2e": "playwright test --project=default"` and `"e2e:live": "BNZ_LIVE=1 playwright test --project=live"`.
- `playwright.config.ts` defines project `default` (seal-open) and, only when `BNZ_LIVE=1`, project `live` (both specs). It sets `retries: 0` and `forbidOnly: true`.
- Each spec has one `test()`. Each assertion ID below is one `test.step("<ID> …")` using `expect.soft`, so a failure in one gate doesn't hide the others. Each failure prints `ERROR <ID> <reason>`, and an evidence run writes one result per ID into `run.json`.
- These lists are locked. Adding a step, assertion or loop, or removing or loosening one, needs a Ruling.
- The tests serve `seal/dist/` over `http://127.0.0.1`, so the page-load request is recorded.
- Deadlines (a Ruling changes them): test 1 as a whole, (T − now) + 120 s; drand serves round R within 60 s of its time; each deposit and the refund is mined within 30 minutes of broadcast; vault notes are spendable within 16 blocks of mining; test 2 as a whole, 75 minutes. Wait only through one helper in `e2e/lib`, `waitFor(height or round, deadline)`, which polls and never re-runs an assertion.

**1. `e2e/seal-open.spec.ts`** runs in both commands. About 1–2 minutes; owns gate C.

The test loads the built sealer and types an opening time T about 30 s ahead, plus a random price, quantity and auction ID. It never types R; it computes `R = 1 + ceil((T − BNZ_DRAND_GENESIS) / BNZ_DRAND_PERIOD)` itself. It seals two bids with different values.
- **C1** Envelope bytes 0–4 are `FF 42 4E 5A 01`, bytes 5–6 are ct_len (BE), then ct_len bytes of binary age, then zeros to 512.
- **C2** The age header has exactly one stanza: `tlock <R> <BNZ_DRAND_CHAIN_HASH>`.
- **C3** The two bids' envelopes have the same length, and their nonces differ.
- **C4** An opening time in the past shows the page's refusal and produces no envelope.
- **C5** Zero request or websocket events between the first keystroke and the envelope output, while the same listener recorded the page-load request.
- **C6** Before R: `/public/latest` returns a round below R and `/public/<R>` returns HTTP 425, and in the same step `tle -d` exits non-zero with `too early to decrypt`, naming round R.
- **C7** After R: `tle -d` returns 128 bytes whose fields at the section 6 offsets equal the typed values, with byte 0 = `0x00` and bytes 125–127 = 0.

Mutations that must each turn it red (about 2 minutes each):
- **M1** the page drops the +1 from the round formula (C2 fails);
- **M2** the page writes quantity little-endian (C7 fails);
- **M3** the page calls `fetch("https://api.drand.sh/?e=" + envelopeHex)` while sealing (C5 fails);
- **M4** the page's past-round guard is removed (C4 fails).

**2. `e2e/testnet-golden-path.spec.ts`** runs only in `npm run e2e:live`. About 35 minutes and about 0.0003 TAZ in fees; the collateral comes back. Runs section 5 steps 6–10 and owns gates A, B and D. Gate C belongs only to test 1: B1 already proves the chain returns the sealed bytes unchanged, so running `tle` here would test the same contract twice.

Preconditions, exactly these (adding one needs a Ruling):
- the pinned binaries match `tools/pins.env`;
- drand and both endpoints answer;
- the bidder's spendable balance is at least 2C + 30,000 zats;
- `<repo>/.benzo` holds the vault wallet and the three frost configs.

The test starts frostd from the pinned binary and stops it at the end; stop any frostd you started by hand first. If frostd doesn't come up, the result is FAIL (harness), not NOT RUN.
- **B1** Each scanned `memo_hex` equals that bid's page envelope, zero-padded to 512 bytes.
- **D1** Each deposit appears exactly once, and its `address` equals the address the test paid for that bid.
- **D2** `pool` is Ironwood and `value_zats` equals `BNZ_COLLATERAL_ZATS`.
- **D3** The two operator-view lines differ only in txid, height, address, diversifier index and the ciphertext bytes.
- **A1** The refund is mined at the same height on both endpoints, and spends both of this run's deposits.
- **A2** Each coordinator session ran through frostd with 2 participants, and there is one signature per randomizer.
- **A3** The byte-reversed sighash equals the txid, and each signature appears in the raw tx.
- **A4** The bidder's total rose by the value of the spent vault notes minus the fee.
- **A5** The vault's total balance, spendable or not, is 0.

Mutations, applied together in one live run, which must print ERROR lines for B1, D1, A4 and A5:
- **M5** the scanner returns the zero-trimmed memo (`MemoBytes::as_slice`) instead of all 512 bytes;
- **M6** the scanner reports the account's default address instead of the note's receiving address;
- **M7** `create-max` refunds to a fresh vault address instead of the bidder.

## 10. Evidence rules

- An evidence run (`BNZ_EVIDENCE_DIR` set) first checks `git status --porcelain`. If the tree is dirty, it stops with `NOT RUN dirty tree`.
- The run deletes and rewrites `frost/`, `memo/`, `tlock/`, `scan/` and `run.json`, and never appends to a file from an earlier run.
- `run.json` records:
  - the command, `git rev-parse HEAD`, and the UTC start and end;
  - one result per assertion ID;
  - the SHA-256 of every file the setup script and the run wrote, of the built sealer bundle and of the scanner binary;
  - the version line of every pinned tool.
- Don't assemble evidence by hand. Keep `docs/evidence/phase-1/` under 1 MB.
- Allowed in evidence: txids, heights, addresses, the group public key, sighashes, randomizers, signatures, ciphertexts, test plaintexts, hashes, balances, tool versions and short log excerpts.
- Never allowed in evidence or anywhere in git: mnemonics, age identities, FROST key packages or configs, the UFVK, TLS keys, raw PCZTs, wallet databases, full logs.
- `EVIDENCE.md` is one page, with:
  - a gate table: one line per gate (READY FOR REVIEW, FAILED or BLOCKED), linked to its files;
  - the three decisions;
  - the consumer-wallet table, if the user reported any results;
  - the limitations. Name at least these: the signers ran on one machine, the endpoints are public, and drand threshold trust is assumed.
- Anything partial, such as a 1-input spend, says so in its first line.
- `README.md` may get one "Reproduce Phase 1" section. Add no other prose files.

## 11. Layout and size

Create a directory only when a file goes into it.

```
tools/pins.env  tools/bootstrap.sh  tools/setup-testnet.sh  [tools/patches/, only if trap 1 forces it]
seal/                   sealer page (bundle in seal/dist/, gitignored)
scan/                   thin Rust reader: scan mode (section 5 step 8) and verify mode (section 7)
e2e/seal-open.spec.ts  e2e/testnet-golden-path.spec.ts  e2e/lib/ (CLI glue for the tests)
docs/evidence/phase-1/  EVIDENCE.md  verify.sh  versions.txt  run.json  setup/  frost/  memo/  tlock/  scan/  mutations/
package.json  package-lock.json  playwright.config.ts
```

`e2e/lib` only spawns the pinned CLIs and our shipped programs, passes their bytes through unchanged, and parses their output. It contains no byte layouts and no key handling, and it does no amount arithmetic beyond adding and subtracting values that the tools print.

Budget: about 1,000 lines of hand-written code, not counting lockfiles and evidence. If you go over, justify it under Questions.

## 12. Out of scope

- **Auction logic:**
  - the auction manifest and its signing;
  - the receipt ledger, Merkle freeze, witnesses and inclusion receipts;
  - clearing in any mode (mode A, Vickrey, mode B).
- **Settlement:** the settlement ledger, and any refund batch beyond this run's refund.
- **UI and wallets:** the signer console; any UI beyond the one-page sealer, including styling; WebZjs and consumer-wallet integration.
- **Integrations:** NEAR 1Click and asset adapters.
- **Networks and nodes:**
  - any mainnet transaction;
  - running Zebra, lightwalletd or Zaino, or a regtest harness;
  - NU7-specific code;
  - Tor or other network privacy.
- **Hardening:**
  - settlement-envelope encryption and owner-key signatures;
  - drand relay failover, and any admission parser beyond the stanza check;
  - FROST share encryption and a nonce database.
- **Infrastructure and docs:** CI, Docker and deployment; ADRs and architecture docs.

## 13. Phase rules and schedule

**NU7.** If testnet NU7 activates during the phase and the pinned tools stop producing valid transactions:
- keep the evidence from before activation;
- write `NU7 re-run pending` under Blocked items;
- don't upgrade the pinned tools without a Ruling.

Don't broadcast within about 40 blocks before a published activation height.

**Suggested order:**

| When | Work |
|---|---|
| Day 1 | G0; setup and the bidder UA to the user; sealer; test 1 and its mutations (gate C) |
| Days 2–3 | PCZT parse check (trap 1); deposits and scanner (gates B and D) |
| By Oct 5 | FROST refund (gate A); the test 2 mutation run; one full evidence run; verify.sh and its negative check |
| Oct 6–7 | If NU7 activated, one live re-run or a recorded break; `EVIDENCE.md`; READY FOR REVIEW |

**What you may ask the user for in this phase:**
- testnet TAZ for the bidder wallet (required);
- a second machine for bob (optional);
- a consumer-wallet memo test (optional).

## 14. Rulings

Only the head agent writes here, in commits authored by `head@benzo.invalid`. Entries go newest last, as `R<n> <UTC date>: <ruling>`, and a Ruling overrides anything earlier in this file. A gate is PASSED only when a Ruling names it with its commit.

None yet.
