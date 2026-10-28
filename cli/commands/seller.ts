// benzo seller check — the seller's own one-line check, before bidding opens.
// The signed manifest commits the seller payout address as seller_ua_commitment; this read-only command verifies the
// manifest signature, recomputes the one commitment (manifest/schema.ts sellerUaCommitment) from the address the
// seller passes, and answers whether they match. It touches no state and never prints any other party's data.
// Only the PUBLISHED signed manifest.json (the signed packet) is accepted — a raw manifest
// object is refused with one ERROR line, so a seller pointed at a doctored manifest never gets a false all-clear.
import { readFileSync } from "node:fs";
import { requireThat, sellerUaCommitment, verifyRecord, type Manifest, type Signed } from "../../manifest/schema";

export const noun = "seller", verb = "check";
export const help = "benzo seller check --manifest manifest.json --ua UA [--signer HEX] — read-only: check the published signed manifest.json's seller_ua_commitment against the payout address you pass (the seller's pre-open check); a raw manifest object is refused";

export async function run(argv: string[]): Promise<number | object> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--manifest", "--ua", "--signer"].includes(argv[i]) || argv[i + 1] === undefined) { process.stderr.write(`ERROR seller check usage: ${help}\n`); return 2; }
    o[argv[i].slice(2)] = argv[i + 1];
  }
  try {
    requireThat(o.manifest !== undefined && o.ua !== undefined, "usage");
    const file = JSON.parse(readFileSync(o.manifest, "utf8"));
    // The public dir's manifest.json is the signed packet, and only it is accepted. With
    // --signer the packet must be signed by exactly that key.
    const packet = typeof file?.bytes === "string" ? (file as Signed) : null;
    if (!packet) {
      process.stderr.write("ERROR seller check: pass the published manifest.json (the signed packet), not a raw manifest object\n");
      return 1;
    }
    // Without --signer there is no trust anchor — the packet's own signer is accepted, so a
    // doctored manifest signed by an attacker's key would self-consistently match its own committed UA.
    // One WARN says exactly that (the output's printed `signer` is the key to compare out of band), and the
    // commitment check below still runs and still answers.
    if (o.signer === undefined) process.stderr.write("WARN no trust anchor: pass --signer HEX (the auction's published receipt key) to check who signed this manifest\n");
    const manifest = verifyRecord<Manifest>(packet, o.signer ?? packet.signer) as Manifest;
    requireThat(manifest && typeof manifest === "object" && typeof manifest.network === "string", "manifest");
    const committed = manifest.seller_ua_commitment;
    requireThat(committed === undefined || (typeof committed === "string" && /^[0-9a-f]{64}$/.test(committed)), "seller_ua_commitment shape");
    const mine = sellerUaCommitment(o.ua);
    const bound = committed !== undefined, matches = bound && committed === mine;
    const result = { signer: packet?.signer ?? o.signer ?? null, network: manifest.network, seller_ua_commitment: committed ?? null, ua_commitment: mine, bound, matches };
    if (!bound) process.stderr.write("WARN legacy manifest: seller payout address not bound\n");
    if (!matches) {
      process.stderr.write(`${JSON.stringify(result)}\n`);
      process.stderr.write("ERROR seller check: this address is not the manifest's committed seller payout address\n");
      return 1;
    }
    return result;
  } catch (e) {
    process.stderr.write(`ERROR seller check ${(e as Error).message}\n`);
    return 1;
  }
}
