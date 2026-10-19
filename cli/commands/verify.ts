// benzo verify — independent gate R: public inputs only, cold copy, ERROR lines on corruption.
// Re-derives every opening offline from its ciphertext and authenticated published quicknet beacon.
import os from "node:os";
import path from "node:path";
import { existsSync, lstatSync } from "node:fs";
import { verifyBeacon } from "drand-client/beacon-verification.js";
import { hash, requireThat } from "../../manifest/schema";
import { requireReserveOpening, tleOpening as tleDecrypt } from "../../manifest/reserve";
import { checkPublicAuction, loadCompletePublicAuction, loadPublicAuction } from "../../api/public-auction";
import { checkSeriesLink } from "../../clear/features";
import type { Opened } from "../../clear/core";
import { publishedClient, decryptPublished, deriveClaimOpenings } from "../published-beacon";
import { openSealedBid } from "../../envelope/opening";
import { beaconSha256, loadOpenings } from "../openings-cache";

export const noun = "verify";
export const verb = "";
export const help = "benzo verify --dir <public-auction-dir> --signer <ed25519-spki-der-hex> [--fetch-beacon] [--tle] [--offline] [--previous <prior-round-dir>] [--legacy-unattested] [--openings-cache FILE] — re-derive openings offline and reproduce clear + accounting. --openings-cache is HOST-ONLY: FILE must be the signer host's own $BNZ_STATE_DIR/auctions/<id>/openings.json (B43 H13) and only skips re-decrypting the openings that file covers; the public benzo verify never uses it and re-derives every opening.";

// Go tle is an optional independent cross-check, resolved only through PATH (shared with the signer
// plan through manifest/reserve.ts so the sealed-reserve rules cannot drift).
const tleOpening = (ciphertext: string, chain: string) => tleDecrypt("tle", chain, ciphertext);

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(help + "\n");
    return 0;
  }
  let dir = "", signerHex = "", fetchBeacon = false, crossCheck = false, previous = "", legacyUnattested = false, openingsCache = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = argv[++i] ?? "";
    else if (argv[i] === "--signer") signerHex = argv[++i] ?? "";
    else if (argv[i] === "--offline") { /* deprecated alias of the default */ }
    else if (argv[i] === "--fetch-beacon") fetchBeacon = true;
    else if (argv[i] === "--tle") crossCheck = true;
    else if (argv[i] === "--openings-cache") openingsCache = argv[++i] ?? "";
    else if (argv[i] === "--previous") previous = argv[++i] ?? "";
    else if (argv[i] === "--legacy-unattested") legacyUnattested = true; // R78: pre-R42 testnet evidence only
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
    // B43 (H13 item 5): the host-only openings cache. A signer host's deriveRows passes its OWN
    // $BNZ_STATE_DIR/auctions/<id>/openings.json — the cache of its own prior computation — and this run skips
    // re-decrypting exactly the leaves that file covers while still checking everything else against the
    // published document. The file must be the host's own: any other path is refused. A cache with other
    // keys (a different frozen root or beacon) covers nothing, so every opening is re-derived. The public
    // `benzo verify` never passes the flag (see --help) and re-derives every opening.
    // B48 (H18 P3-3): host-only by construction, not by convention. The resolved path must be exactly the
    // host's own cache for the directory's auction id, and the file at it must BE the host's own file there —
    // a cache copied elsewhere is refused, and so is a link standing in for one at the host's own name. Only
    // the host's own plain file is ever read through this flag.
    let cache: Record<string, string | null> | null = null;
    if (openingsCache) {
      const state = process.env.BNZ_STATE_DIR ? path.resolve(process.env.BNZ_STATE_DIR) : path.join(os.homedir(), ".benzo");
      const own = path.join(state, "auctions", pub.manifest.auction_id, "openings.json");
      requireThat(path.resolve(openingsCache) === path.resolve(own), "openings cache must be this host's own $BNZ_STATE_DIR/auctions/<id>/openings.json");
      if (existsSync(own)) requireThat(lstatSync(own).isFile(), "openings cache must be the host's own file at that path, not a link to a cache copied elsewhere");
      cache = loadOpenings(own, pub.frozen.root, beaconSha256(pub.beacon!));
    }
    const derived: Opened[] = [];
    for (const leaf of pub.frozen.leaves) {
      // B43 (H14 item 2): re-derive through the one opener — a leaf whose fault it is (bad shape — a wrong
      // round included — any tlock/age/IBE failure, non-128-byte plaintext) re-derives as `undecryptable`,
      // exactly what `open` publishes, so a griefing ciphertext can never stop the verify (B44: the opener
      // never throws on a leaf); only an unusable beacon client still stops it.
      // B43 (H13 item 5): a leaf the host's cache covers takes its cached opening instead of re-decrypting.
      const covered = cache && Object.hasOwn(cache, String(leaf.leaf_index)) ? cache[String(leaf.leaf_index)] : undefined;
      const plaintext = covered !== undefined ? covered : await openSealedBid(leaf.ciphertext_hex, local);
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
    // R16 item 4 (Reviewer R F3): every stray claim's owner key is derived here from the memo the claim
    // publishes (the scanned deposit's memo) and this authenticated published beacon — no claims[].opening.
    const claimOpenings = await deriveClaimOpenings(pub.claims ?? [], pub.beacon);
    if (pub.manifest.sealed_reserve !== undefined) {
      const reserve = await decryptPublished(pub.manifest.sealed_reserve, local);
      requireReserveOpening(pub.manifest, pub.reserveOpening, reserve,
        crossCheck ? tleOpening(pub.manifest.sealed_reserve, pub.manifest.drand.chain_hash) : undefined);
    } else requireReserveOpening(pub.manifest, pub.reserveOpening, null);
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
    const checks = checkPublicAuction(pub, { claimOpenings, allowUnattested: legacyUnattested });
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
