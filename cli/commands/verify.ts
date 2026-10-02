// benzo verify — independent gate R: public inputs only, cold copy, ERROR lines on corruption.
// By default re-derives every opening from its ciphertext with pinned tle + the published beacon (R16),
// then reproduces clear/. --offline trusts the published openings and prints WARN openings not re-derived.
import { verifyBeacon } from "drand-client/beacon-verification.js";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { hash, requireThat } from "../../manifest/schema";
import { checkPublicAuction, loadCompletePublicAuction, loadPublicAuction, type CompletePublicAuction } from "../../api/public-auction";
import { checkSeriesLink } from "../../clear/features";
import type { Opened } from "../../clear/core";

export const noun = "verify";
export const verb = "";
export const help = "benzo verify --dir <public-auction-dir> --signer <ed25519-spki-der-hex> [--offline] [--previous <prior-round-dir>] — reproduce clear + settlement accounting from public inputs (default re-derives openings with tle; --offline trusts published openings; --previous checks recurring-round linkage)";

function tleBin(): string {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const stateDir = path.resolve(root, process.env.BNZ_STATE_DIR || ".benzo");
  const p = path.join(stateDir, "bin", "tle");
  if (!existsSync(p)) throw new Error(`tle not found at ${p}`);
  return p;
}

// Re-derive every opening with the pinned Go tle against drand quicknet (the published beacon binds the chain).
function deriveOpenings(pub: CompletePublicAuction): Opened[] {
  const tle = tleBin();
  const chain = pub.beacon ? pub.beacon.chain_hash : pub.manifest.drand.chain_hash;
  return pub.frozen.leaves.map(leaf => {
    const r = spawnSync(tle, ["-d", "-c", chain], {
      input: Buffer.from(leaf.ciphertext_hex, "hex"),
      maxBuffer: 1 << 20,
    });
    const err = () => ((r.stderr ?? Buffer.alloc(0)).toString().trim() || `exit ${r.status}`);
    if (r.error) return { leaf_index: leaf.leaf_index, plaintext_hex: null, error: `tle: ${r.error.message}` };
    if (r.status !== 0) {
      // Only authenticated ciphertext failures are bad bids, matching the operator open path (clear/auction-cli.ts).
      if (/bad header MAC|failed to decrypt and authenticate payload chunk/.test(err()))
        return { leaf_index: leaf.leaf_index, plaintext_hex: null, error: "undecryptable" };
      return { leaf_index: leaf.leaf_index, plaintext_hex: null, error: `tle: ${err()}` };
    }
    return { leaf_index: leaf.leaf_index, plaintext_hex: r.stdout.toString("hex") };
  });
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(help + "\n");
    return 0;
  }
  let dir = "", signerHex = "", offline = false, previous = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = argv[++i] ?? "";
    else if (argv[i] === "--signer") signerHex = argv[++i] ?? "";
    else if (argv[i] === "--offline") offline = true;
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
    // Gate CF: the sealed reserve/max price opens at R with the bids; re-derive it with tle and require the
    // published opening to match exactly. --offline trusts the published opening like the bid openings.
    const deriveReserve = (): string => {
      const tle = tleBin();
      const chain = pub.beacon ? pub.beacon.chain_hash : pub.manifest.drand.chain_hash;
      const r = spawnSync(tle, ["-d", "-c", chain], {
        input: Buffer.from(pub.manifest.sealed_reserve ?? "", "hex"),
        maxBuffer: 1 << 20,
      });
      if (r.error) throw new Error(`derive reserve tle: ${r.error.message}`);
      if (r.status !== 0) throw new Error(`derive reserve tle: ${(r.stderr ?? Buffer.alloc(0)).toString().trim() || `exit ${r.status}`}`);
      return r.stdout.toString("hex");
    };
    if (offline) {
      requireThat(pub.opened.length === pub.frozen.leaf_count, "--offline needs one published opening per leaf");
      requireThat(pub.manifest.sealed_reserve === undefined || (pub.reserveOpening !== null && pub.reserveOpening.length > 0), "--offline needs the published reserve opening");
      process.stderr.write("WARN openings not re-derived\n");
      if (pub.manifest.sealed_reserve !== undefined) process.stderr.write("WARN reserve opening not re-derived\n");
    } else {
      const derived = deriveOpenings(pub);
      let deriveFailed = false;
      for (const d of derived) {
        if (d.error && d.error !== "undecryptable") {
          process.stderr.write(`ERROR derive ${d.leaf_index} ${d.error}\n`);
          deriveFailed = true;
        }
      }
      if (deriveFailed) return 1;
      if (pub.opened.length) {
        requireThat(pub.opened.length === derived.length, "published opening count");
        for (const d of derived) {
          const p = pub.opened.find(o => o.leaf_index === d.leaf_index);
          requireThat(p, `opening ${d.leaf_index} missing from published set`);
          requireThat(
            p!.plaintext_hex === d.plaintext_hex && (p!.error ?? null) === (d.error ?? null),
            `opening ${d.leaf_index} published differs from re-derived`,
          );
        }
      }
      pub.opened = derived;
      if (pub.manifest.sealed_reserve !== undefined) {
        requireThat(pub.reserveOpening !== null, "missing reserve opening");
        requireThat(pub.reserveOpening === deriveReserve(), "reserve opening published differs from re-derived");
      } else {
        requireThat(pub.reserveOpening === null, "reserve opening without sealed reserve");
      }
    }
    // Serial assignment is replayed by the registry. Authenticate the future beacon before using it.
    if (pub.manifest.serials) {
      const round = pub.manifest.drand.R + pub.manifest.serials.seed_round_offset;
      requireThat(pub.result.serial_assignment && pub.result.serial_beacon_round === round, "serial result round/assignment");
      let beacon = pub.serialBeacon;
      if (!offline) {
        const base = process.env.BNZ_DRAND_URLS?.split(",")[0];
        requireThat(base, "BNZ_DRAND_URLS required for serial beacon");
        const response = await fetch(`${base}/${pub.manifest.drand.chain_hash}/public/${round}`, { signal: AbortSignal.timeout(15000) });
        requireThat(response.ok, `serial drand HTTP ${response.status}`);
        const fetched = await response.json() as { round: number; signature: string };
        requireThat(fetched.round === round && /^[0-9a-f]{96}$/.test(fetched.signature), "serial beacon round/signature");
        if (beacon) requireThat(beacon.round === fetched.round && beacon.signature === fetched.signature, "published serial beacon differs");
        beacon = { round: fetched.round, signature: fetched.signature };
      }
      requireThat(beacon, "--offline needs published serial beacon");
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
