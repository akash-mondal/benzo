// benzo verify — independent gate R: public inputs only, cold copy, ERROR lines on corruption.
// Re-derives every opening offline from its ciphertext and authenticated published quicknet beacon.
import { verifyBeacon } from "drand-client/beacon-verification.js";
import { spawnSync } from "node:child_process";
import { hash, requireThat } from "../../manifest/schema";
import { checkPublicAuction, loadCompletePublicAuction, loadPublicAuction } from "../../api/public-auction";
import { checkSeriesLink } from "../../clear/features";
import type { Opened } from "../../clear/core";
import { publishedClient, decryptPublished } from "../published-beacon";

export const noun = "verify";
export const verb = "";
export const help = "benzo verify --dir <public-auction-dir> --signer <ed25519-spki-der-hex> [--fetch-beacon] [--tle] [--offline] [--previous <prior-round-dir>] — re-derive openings offline and reproduce clear + accounting";

// Go tle is an optional independent cross-check, resolved only through PATH.
function tleOpening(ciphertext: string, chain: string): string | null {
  const r = spawnSync("tle", ["-d", "-c", chain], { input: Buffer.from(ciphertext, "hex"), maxBuffer: 1 << 20 });
  if (r.error) throw new Error(`tle: ${r.error.message}`);
  if (r.status === 0) return r.stdout.toString("hex");
  const error = r.stderr.toString().trim();
  if (/bad header MAC|failed to decrypt and authenticate payload chunk/.test(error)) return null;
  throw new Error(`tle: ${error || `exit ${r.status}`}`);
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(help + "\n");
    return 0;
  }
  let dir = "", signerHex = "", fetchBeacon = false, crossCheck = false, previous = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = argv[++i] ?? "";
    else if (argv[i] === "--signer") signerHex = argv[++i] ?? "";
    else if (argv[i] === "--offline") { /* deprecated alias of the default */ }
    else if (argv[i] === "--fetch-beacon") fetchBeacon = true;
    else if (argv[i] === "--tle") crossCheck = true;
    else if (argv[i] === "--previous") previous = argv[++i] ?? "";
    else {
      process.stderr.write(`ERROR verify usage: ${help}\n`);
      return 2;
    }
  }
  if (!dir || !/^[0-9a-f]{88}$/.test(signerHex)) {
    process.stderr.write(`ERROR verify usage: ${help}\n`);
    return 2;
  }
  try {
    // verify keeps requiring frozen and result (R21 item 5); the read API is the lifecycle-safe reader.
    const pub = loadCompletePublicAuction(dir, { signer: signerHex });
    if (pub.legacy) process.stderr.write("WARN legacy projections (no auction.json); fallback for Phase 2/3 evidence dirs\n");
    requireThat(pub.beacon || fetchBeacon, "no published beacon; rerun with --fetch-beacon");
    const fetchPublished = async (round: number, beacon?: { round: number; signature: string } | null) => {
      const base = process.env.BNZ_DRAND_URLS?.split(",")[0] || "https://api.drand.sh";
      const response = await fetch(`${base}/${pub.manifest.drand.chain_hash}/public/${round}`, { signal: AbortSignal.timeout(15000) });
      requireThat(response.ok, `drand HTTP ${response.status}`);
      const fetched = await response.json() as { round: number; signature: string };
      requireThat(fetched.round === round, "fetched beacon round");
      if (beacon) requireThat(fetched.signature === beacon.signature, "published beacon differs from fetched beacon");
      return { round: fetched.round, signature: fetched.signature, chain_hash: pub.manifest.drand.chain_hash };
    };
    const published = pub.beacon;
    if (fetchBeacon) pub.beacon = await fetchPublished(pub.manifest.drand.R, published);
    const local = publishedClient(pub.beacon!);
    if (!published) process.stderr.write("WARN beacon fetched (not published)\n");
    const derived: Opened[] = [];
    for (const leaf of pub.frozen.leaves) {
      const plaintext = await decryptPublished(leaf.ciphertext_hex, local);
      if (crossCheck) requireThat(tleOpening(leaf.ciphertext_hex, pub.manifest.drand.chain_hash) === plaintext, `opening ${leaf.leaf_index} tle differs`);
      derived.push(plaintext === null ? { leaf_index: leaf.leaf_index, plaintext_hex: null, error: "undecryptable" }
        : { leaf_index: leaf.leaf_index, plaintext_hex: plaintext });
    }
    if (pub.opened.length) {
      requireThat(pub.opened.length === derived.length, "published opening count");
      const published = new Map(pub.opened.map(o => [o.leaf_index, o]));
      for (const d of derived) {
        const p = published.get(d.leaf_index);
        requireThat(p && p.plaintext_hex === d.plaintext_hex && (p.error ?? null) === (d.error ?? null),
          `opening ${d.leaf_index} published differs from re-derived`);
      }
    }
    pub.opened = derived;
    if (pub.manifest.sealed_reserve !== undefined) {
      const reserve = await decryptPublished(pub.manifest.sealed_reserve, local);
      requireThat(reserve !== null && pub.reserveOpening === reserve, "reserve opening published differs from re-derived");
      if (crossCheck) requireThat(tleOpening(pub.manifest.sealed_reserve, pub.manifest.drand.chain_hash) === reserve, "reserve opening tle differs");
    } else requireThat(pub.reserveOpening === null, "reserve opening without sealed reserve");
    // Serial assignment is replayed by the registry. Authenticate the future beacon before using it.
    if (pub.manifest.serials) {
      const round = pub.manifest.drand.R + pub.manifest.serials.seed_round_offset;
      requireThat(pub.result.serial_assignment && pub.result.serial_beacon_round === round, "serial result round/assignment");
      let beacon = pub.serialBeacon;
      requireThat(beacon, "missing published serial beacon");
      if (fetchBeacon) await fetchPublished(round, beacon);
      const d = pub.manifest.drand;
      requireThat(await verifyBeacon({ public_key: d.public_key, period: d.period, genesis_time: d.genesis,
        hash: d.chain_hash, groupHash: "", schemeID: d.scheme, metadata: { beaconID: "quicknet" } },
        { ...beacon!, randomness: hash(Buffer.from(beacon!.signature, "hex")) }, round), "serial beacon BLS signature");
      pub.serialBeacon = beacon;
    } else requireThat(!pub.result.serial_assignment && pub.result.serial_beacon_round === undefined && !pub.serialBeacon, "serial material without manifest serials");
    // Gate CF recurring rounds: with --previous, this round's link must chain to the previous round's result.
    if (pub.manifest.series !== undefined || previous) {
      if (!previous) process.stderr.write("WARN series linkage not checked (no --previous)\n");
      else {
        try {
          const prev = loadPublicAuction(previous, { signer: signerHex });
          requireThat(prev.resultBytes, "previous round has no result");
          checkSeriesLink(pub.manifest.series, { link: prev.manifest.series, result_hash: hash(prev.resultBytes!) });
          process.stdout.write("OK series\n");
        } catch (e) {
          process.stderr.write(`ERROR series ${(e as Error).message}\n`);
          return 1;
        }
      }
    }
    const checks = checkPublicAuction(pub);
    let failed = false;
    for (const c of checks) {
      if (c.warn) process.stderr.write(`WARN ${c.warn}\n`);
      if (c.error) {
        failed = true;
        process.stderr.write(`ERROR ${c.id} ${c.error}\n`);
      } else {
        process.stdout.write(`OK ${c.id}\n`);
      }
    }
    return failed ? 1 : 0;
  } catch (e) {
    process.stderr.write(`ERROR verify ${(e as Error).message}\n`);
    return 1;
  }
}
