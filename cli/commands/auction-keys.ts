// benzo auction keys — Phase 5 part 1 §2 (gate Y), run by the operator after every signer's `benzo sign dkg`.
// Takes the group key each signer reported, refuses unless all three agree (and unless it is fresh: never the global
// Phase 1 key or any earlier auction's key), derives this auction's escrow UFVK with zcash-sign, and creates a
// VIEW-ONLY per-auction vault wallet at state/vaults/<id>/ (no spending key exists anywhere but the signer shares).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { requireThat } from "../../manifest/schema";
import { isUnifiedOn } from "../../envelope/destination";
import { ROOT, STATE, bin, env, run as execute } from "../../settle/io";

export const noun = "auction", verb = "keys";
export const help = "benzo auction keys --id AUCTION_ID --group-keys KEY,KEY,KEY [--ufvk FILE (signer hosts: the operator's UFVK)] — check the three signers' DKG group keys agree and are fresh, derive the escrow UFVK, create the view-only vault state/vaults/<id>/, print {group_key, escrow_ua}";

export async function run(argv: string[]): Promise<number | object> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--id", "--group-keys", "--ufvk"].includes(argv[i]) || argv[i + 1] === undefined) { process.stderr.write(`ERROR auction keys usage: ${help}\n`); return 2; }
    o[argv[i].slice(2)] = argv[i + 1];
  }
  try {
    requireThat(/^[0-9a-f]{64}$/.test(o.id ?? ""), "auction id");
    const reported = (o["group-keys"] ?? "").split(",");
    requireThat(reported.length === 3 && reported.every(k => /^[0-9a-f]{64}$/.test(k)), "three 64-hex group keys");
    requireThat(new Set(reported).size === 1, "the three signers report different group keys; refusing");
    const groupKey = reported[0];
    // On a signer host, the agreed key must be the one this host's own DKG produced (Ruling R28 item 5).
    const own = path.join(STATE, "auctions", o.id, "group-key.txt");
    if (existsSync(own)) requireThat(readFileSync(own, "utf8").trim() === groupKey, "reported group key is not this host's own DKG result; refusing");
    // Fresh per auction (Y1 / mutation 5M5): never the global Phase 1 key, never an earlier auction's key.
    const globalKey = existsSync(path.join(STATE, "group-key.txt")) ? readFileSync(path.join(STATE, "group-key.txt"), "utf8").trim() : "";
    requireThat(groupKey !== globalKey, "group key equals the global Phase 1 key; a fresh DKG is required");
    const vaults = path.join(STATE, "vaults");
    for (const other of existsSync(vaults) ? readdirSync(vaults) : []) {
      const f = path.join(vaults, other, "keys.json");
      if (other !== o.id && existsSync(f)) requireThat(JSON.parse(readFileSync(f, "utf8")).group_key !== groupKey, `group key reused from auction ${other}`);
    }
    const dir = path.join(vaults, o.id), keys = path.join(dir, "keys.json");
    if (existsSync(keys)) {
      const k = JSON.parse(readFileSync(keys, "utf8"));
      requireThat(k.group_key === groupKey, "this auction already has different keys; refusing");
      return { auction_id: o.id, group_key: k.group_key, escrow_ua: k.escrow_ua, reused: true };
    }
    // zcash-sign takes ak from the FROST group key but draws the other viewing components at random, so the UFVK is
    // generated ONCE by the operator and signer hosts import that same one (--ufvk FILE). A wrong UFVK cannot move
    // funds (spends are authorised by the FROST shares); it only makes a host's own approvals fail.
    const ufvk = o.ufvk ? readFileSync(path.resolve(o.ufvk), "utf8").trim()
      : execute(bin("zcash-sign"), ["generate", "-n", env("BNZ_NETWORK"), "--ak", groupKey]).match(/^Unified Full Viewing Key: "(.*)"$/m)?.[1];
    requireThat(typeof ufvk === "string" && /^uview(test)?1[0-9a-z]+$/.test(ufvk), "UFVK");
    requireThat(ufvk, "zcash-sign generate printed no UFVK");
    // Ruling R28 item 5 (F4): the vault must be spendable ONLY by this auction's FROST group — its Orchard ak is the
    // group key. A host importing the operator's UFVK refuses one for any other key (e.g. a single-key operator wallet).
    const pcztBinPath = process.env.BNZ_PCZT_BIN || path.join(ROOT, "settle/target/release/benzo-pczt");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const probe = path.join(dir, ".ufvk-check.txt"); writeFileSync(probe, ufvk + "\n", { mode: 0o600 });
    const ak = execFileSync(pcztBinPath, ["ufvk-ak", probe, "--network", env("BNZ_NETWORK")], { encoding: "utf8" }).trim(); rmSync(probe, { force: true });
    requireThat(ak === groupKey, "UFVK is not spendable by this auction's group key (its ak differs); refusing");
    const tip = Number(JSON.parse(execute(bin("grpcurl"), ["-import-path", path.join(STATE, "proto"), "-proto", "service.proto", "-d", "{}", env("BNZ_LWD_URL"), "cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock"])).height);
    requireThat(Number.isSafeInteger(tip) && tip > 10, "lightwalletd tip");
    mkdirSync(vaults, { recursive: true, mode: 0o700 });
    const wallet = path.join(dir, "wallet");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    execute(bin("zcash-devtool"), ["wallet", "-w", wallet, "init-fvk", "--name", `vault-${o.id.slice(0, 8)}`, "--fvk", ufvk!, "--birthday", String(tip - 10), "-s", env("BNZ_LWD_URL")]);
    // BNZ_PCZT_BIN (set by the signer-host launcher, no checkout there) overrides the working-tree build, as envelope/destination.ts.
    const pcztBin = process.env.BNZ_PCZT_BIN || path.join(ROOT, "settle/target/release/benzo-pczt");
    const escrowUa = execFileSync(pcztBin, ["address", wallet, "--network", env("BNZ_NETWORK")], { encoding: "utf8" }).trim().split("\n").at(-1)!;
    // G-7: the derived escrow UA is checked through the audited classifier on this deployment's network
    requireThat(isUnifiedOn(escrowUa, env("BNZ_NETWORK")), "benzo-pczt printed no escrow UA");
    writeFileSync(path.join(dir, "ufvk.txt"), ufvk + "\n", { mode: 0o600 });
    writeFileSync(keys, JSON.stringify({ auction_id: o.id, group_key: groupKey, escrow_ua: escrowUa, birthday: tip - 10, created_at: Math.floor(Date.now() / 1000) }) + "\n", { mode: 0o600 });
    return { auction_id: o.id, group_key: groupKey, escrow_ua: escrowUa };
  } catch (e) {
    process.stderr.write(`ERROR auction keys ${(e as Error).message}\n`);
    return 1;
  }
}
