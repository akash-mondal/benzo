// benzo hosts … — the operator's host-custody commands (the OrbStack testnet deployment, one operator provisions the
// three signer hosts). Every verb runs the same code the live harness runs (cli/hosts.ts) over
// the same bounded orb/orbctl calls. Each command prints one JSON object and never prints key material.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const noun = "hosts";
export const verb = "";
export const help = "benzo hosts keys — the three signer hosts' envelope and witness public keys, in signer order (a missing key is generated on its host, an existing key is reused) | benzo hosts dkg --id AUCTION_ID — the per-auction 2-of-3 DKG on the three hosts, then this auction's keys (group_key, escrow_ua) and the operator UFVK imported on every host; refuses when state/vaults/<id> already exists | benzo hosts witness --id AUCTION_ID [--names alice,bob] — after freeze: the named hosts' frozen-root certificates, checked and merged into the public dir, then republished; refuses before freeze | benzo hosts envelope-opens --id AUCTION_ID — the three hosts' envelope-opening reports, saved where settle reads them";

export async function run(argv: string[]): Promise<number | object> {
  const mode = argv[0];
  const o: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--id") o.id = argv[++i] ?? "";
    else if (argv[i] === "--names") o.names = argv[++i] ?? "";
    else { process.stderr.write(`ERROR hosts usage: ${help}\n`); return 2; }
  }
  try {
    if (!["keys", "dkg", "witness", "envelope-opens"].includes(mode)) { process.stderr.write(`ERROR hosts usage: ${help}\n`); return 2; }
    const { requireThat, verifyRecord } = await import("../../manifest/schema");
    const { validateWitnessSet } = await import("../../witness");
    const h = await import("../hosts");
    if (mode === "keys") return { envelope_keys: h.hostEnvelopeKeys(), witness_keys: h.hostWitnessKeys() };
    requireThat(/^[0-9a-f]{64}$/.test(o.id ?? ""), "--id AUCTION_ID");
    const id = o.id;
    if (mode === "dkg") {
      // One fresh DKG per auction: an existing vault means this auction already has its keys, and a second DKG
      // would mint a different group key. The run takes the harness's DKG lock, so it never collides with a
      // live run against the same hosts and frostd.
      requireThat(!existsSync(path.join(h.STATE, "vaults", id)), `state/vaults/${id} already exists; refusing to run another DKG for this auction`);
      const k = await h.withDkgLock(() => h.dkgOnHosts(id, h.localBenzo));
      return { group_key: k.group_key, escrow_ua: k.escrow_ua, keys: k.keys };
    }
    // witness and envelope-opens act on the published directory the operator config names.
    const configFile = path.join(h.STATE, "product", `${id}.json`);
    requireThat(existsSync(configFile), "no operator config for this auction (run auction publish first)");
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    const publicDir = config.public_dir as string;
    requireThat(typeof publicDir === "string" && publicDir.length > 0, "operator config has no public_dir");
    const docFile = path.join(publicDir, "auction.json");
    const readDoc = () => JSON.parse(readFileSync(docFile, "utf8"));
    if (mode === "witness") {
      const names = (o.names ?? "alice,bob").split(",").filter(Boolean);
      requireThat(names.length > 0 && names.every(n => ["alice", "bob", "carol"].includes(n)), "--names alice,bob");
      const doc = readDoc();
      requireThat(doc.frozen, "witness certificates exist only after freeze; refusing");
      const spec = validateWitnessSet(verifyRecord(doc.witness_set, doc.signer), id);
      h.hostWitnessCerts(id, publicDir, doc.signer, names);
      const { publish } = await import("../product");
      publish(id);
      return { certificates: readDoc().witness_cert ?? [], q_w: spec.q_w };
    }
    const reports = h.hostEnvelopeOpens(id, publicDir);
    return {
      reports: reports.map((r: any) => ({
        name: r.signer,
        ok_rows: r.opens.filter((x: any) => x.ok).length,
        not_ok_rows: r.opens.filter((x: any) => !x.ok).length,
      })),
    };
  } catch (e) {
    process.stderr.write(`ERROR hosts ${(e as Error).message}\n`);
    return 1;
  }
}
