// benzo sign delivery — item 3, run ON a signer host after the clear: the launch delivery
// records reach the hosts SEALED to the manifest's `envelope_keys` ("as claims do"), so the leaf<->destination
// join never enters the operator's view or any published document. This host opens each record with its own
// envelope key, checks every owner signature against the opened order (its own tlock openings of the frozen
// leaves, from the published beacon), builds the canonical delivery list (clear/launch.ts deliveryBatch) and
// signs `benzo-delivery-list-v1` over its allocation_file_hash with its own witness key. The coordinator
// publishes the canonical allocation.json and two such signatures; `benzo verify` re-checks the public
// invariants and the signatures — integrity rests on the same 2-of-3 trust as settlement.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { QUICKNET, hash, jsonBytes, requireThat } from "../../manifest/schema";
import { fetchVerifiedBeacon, publishedClient } from "../published-beacon";
import { openSealedBid } from "../../envelope/opening";
import { repoRoot } from "../../manifest/root";
import { loadPublicAuction } from "../../api/public-auction";
import { envelopeRecordValid, openDelivery, verifyStatement } from "../../envelope";
import { deliveryBatch } from "../../clear/launch";
import { signDeliveryList } from "../../witness";
import { ownEnvelopePrivate, requireOwnEnvelopeKey } from "../../settle/envelopes";
import { custodyBinding } from "../host-derive";

export const noun = "sign", verb = "delivery";
export const help = "benzo sign delivery --id AUCTION_ID --public DIR --deliveries FILE --name SIGNER --signer HEX — on a signer host: open the sealed launch delivery records with this host's envelope key, check every owner signature against this host's own openings, build the canonical delivery list and sign benzo-delivery-list-v1 over its allocation_file_hash";
const state = () => process.env.BNZ_STATE_DIR ? path.resolve(process.env.BNZ_STATE_DIR) : path.join(os.homedir(), ".benzo");

export async function run(argv: string[]): Promise<number | object> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--id", "--public", "--deliveries", "--name", "--signer"].includes(argv[i]) || argv[i + 1] === undefined) { process.stderr.write(`ERROR sign delivery usage: ${help}\n`); return 2; }
    o[argv[i].slice(2)] = argv[i + 1];
  }
  try {
    requireThat(/^[0-9a-f]{64}$/.test(o.id ?? "") && ["alice", "bob", "carol"].includes(o.name ?? "") && /^(?:[0-9a-f]{64}|[0-9a-f]{88})$/.test(o.signer ?? ""), "usage"); // --signer is the manifest signer (ed25519 SPKI hex, 88 chars)
    process.env.BNZ_AUCTION_ID = o.id;
    const st = state(), root = repoRoot(), dir = path.resolve(o.public);
    const pub = loadPublicAuction(dir, { signer: o.signer });
    requireThat(pub.manifest.auction_id === o.id, "public dir is for another auction");
    requireThat(pub.result, "launch delivery list is built after the clear");
    custodyBinding(o.id, st, root, pub, o.signer);
    // The full public check (the same `benzo verify`), so this signature never covers a broken directory.
    const verify = spawnSync(process.execPath, [process.argv[1], "verify", "--dir", dir, "--signer", o.signer], { encoding: "utf8", env: process.env });
    requireThat(verify.status === 0, `public check failed: ${(verify.stdout + verify.stderr).split("\n").filter(l => /^ERROR/.test(l)).slice(0, 3).join(" | ") || `exit ${verify.status}`}`);

    // This host's own data only: its envelope key and its own tlock openings of the frozen leaves (the
    // one opener, offline from the one BLS-verified beacon — the published one, fetched when a packet lacks it).
    const key = ownEnvelopePrivate(st, o.name);
    requireThat(key, "this signer's envelope key is missing");
    requireOwnEnvelopeKey(pub.manifest as any, o.name, st);
    const local = publishedClient(pub.beacon ?? await fetchVerifiedBeacon((pub.manifest as any).drand.R));
    const opened: { leaf_index: number; plaintext_hex: string | null }[] = [];
    for (const l of pub.frozen?.leaves ?? []) {
      const pt = await openSealedBid(l.ciphertext_hex, local);
      opened.push({ leaf_index: l.leaf_index, plaintext_hex: pt });
    }
    const ownerOf = (i: number) => { const p = opened.find(x => x.leaf_index === i)?.plaintext_hex; return p && /^[0-9a-f]{256}$/.test(p) ? Buffer.from(p, "hex").subarray(61, 93).toString("hex") : null; };

    // Open every sealed record and check its owner signature against the opened order.
    const records: { leaf_index: number; delivery_envelope_ct: string; owner_sig: string }[] = JSON.parse(readFileSync(path.resolve(o.deliveries), "utf8"));
    requireThat(Array.isArray(records) && records.length > 0, "delivery records");
    const plain: { leaf_index: number; destinations: string[] }[] = [];
    for (const r of records) {
      requireThat(r && typeof r === "object" && Object.keys(r).sort().join(",") === "delivery_envelope_ct,leaf_index,owner_sig" && Number.isInteger(r.leaf_index), "delivery record shape");
      requireThat(envelopeRecordValid({ envelope_ct: r.delivery_envelope_ct, owner_sig: r.owner_sig }, (pub.manifest as any).envelope_keys), "delivery record format");
      const owner = ownerOf(r.leaf_index);
      requireThat(owner, "delivery record for an unknown leaf");
      requireThat(verifyStatement(owner!, { kind: "launch-deliver", auction_id: o.id, leaf_index: r.leaf_index, delivery_envelope_sha256: hash(Buffer.from(r.delivery_envelope_ct, "hex")) }, r.owner_sig), "launch delivery owner signature");
      const destinations = openDelivery(r.delivery_envelope_ct, key!);
      plain.push({ leaf_index: r.leaf_index, destinations });
    }
    // The canonical delivery list over this host's own view of the result, signed with its witness key.
    const batch = deliveryBatch(pub.manifest as any, pub.result as any, plain);
    const allocation_file_hash = hash(jsonBytes(batch));
    const wkey = path.join(st, "witness", `${o.name}.key`);
    requireThat(existsSync(wkey), "this host's witness key is missing");
    const signature = signDeliveryList({ version: 1, auction_id: o.id, allocation_file_hash }, readFileSync(wkey, "utf8").trim());
    return { allocation_file_hash, batch, signatures: [signature] };
  } catch (e) {
    process.stderr.write(`ERROR sign delivery ${(e as Error).message}\n`);
    return 1;
  }
}
