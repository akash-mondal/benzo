// Design §5 (gate X): a witness signs the frozen root only after recomputing it from its own vault scan.
// Runs recomputeFrozen on a real published auction against this machine's own scan of that auction's vault, then
// the mutations a dishonest operator could try. The fixture auction is already settled, so its deposits are spent
// now; the spent marker is cleared in the copy used here (at signing time, before open, they are unspent).
// Build+run: npx esbuild tools/repro/x-witness-recompute.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/xw.mjs && node tmp/xw.mjs <public-dir> <signer>
import { execFileSync } from "node:child_process";
import path from "node:path";
import { loadPublicAuction } from "../../api/public-auction";
import { tree } from "../../clear/merkle";
import { repoRoot } from "../../manifest/root";
import { scanBin, vaultDir } from "../../manifest/paths";
import { recomputeFrozen, type ScannedNote } from "../../witness/recompute";

const [dir, signer] = process.argv.slice(2);
const root = repoRoot(), state = path.resolve(root, process.env.BNZ_STATE_DIR ?? ".benzo");
const pub = loadPublicAuction(dir, { signer });
const id = pub.manifest.auction_id, m = pub.manifest as any, frozen = pub.frozen!;
const notes: ScannedNote[] = execFileSync(scanBin(root, state), ["scan", "test", vaultDir(state, id)], { encoding: "utf8", maxBuffer: 64 << 20 })
  .trim().split("\n").filter(Boolean).map(l => ({ ...JSON.parse(l), spent_in_txid: null }));
let ok = true;
const check = (name: string, pass: boolean, detail = "") => { console.log(`${pass ? "PASS" : "ERROR"} ${name}${detail ? " " + detail : ""}`); ok &&= pass; };
const refused = (f: () => unknown): string | null => { try { f(); return null; } catch (e) { return (e as Error).message; } };

const own = recomputeFrozen(m, pub.manifest_hash, frozen, notes);
check("xw-honest-root-matches", own.root === frozen.root && own.leaf_count === frozen.leaf_count, `${own.root.slice(0, 16)}… ${own.leaf_count} leaves`);
const first = frozen.leaves[0];
const missing = refused(() => recomputeFrozen(m, pub.manifest_hash, frozen, notes.filter(n => n.txid !== first.deposit.txid || n.address !== first.deposit.address)));
check("xw-leaf-not-in-own-scan-refused", /not in this witness's own scan/.test(missing ?? ""), missing ?? "accepted");
const forgedCt = first.ciphertext_hex.slice(0, -2) + (first.ciphertext_hex.endsWith("00") ? "01" : "00");
const forgedLeaves = frozen.leaves.map((l, i) => i === 0 ? { ...l, ciphertext_hex: forgedCt } : l);
const forged = refused(() => recomputeFrozen(m, pub.manifest_hash, { ...frozen, leaves: forgedLeaves, root: tree(forgedLeaves).root }, notes));
check("xw-substituted-ciphertext-refused", /scanned memo differs/.test(forged ?? ""), forged ?? "accepted");
const wrongC = refused(() => recomputeFrozen({ ...m, C_zats: String(BigInt(m.C_zats) + 1n) }, pub.manifest_hash, frozen, notes));
check("xw-wrong-amount-refused", /not an admissible bid/.test(wrongC ?? ""), wrongC ?? "accepted");
const spent = refused(() => recomputeFrozen(m, pub.manifest_hash, frozen, notes.map(n => ({ ...n, spent_in_txid: "00".repeat(32) }))));
check("xw-spent-deposit-refused", /not an admissible bid/.test(spent ?? ""), spent ?? "accepted");
// A published root that is not the tree of its leaves: the recompute yields the true root, so `witness sign` refuses.
const fakeRoot = (frozen.root.startsWith("0") ? "1" : "0") + frozen.root.slice(1);
check("xw-forged-root-detected", recomputeFrozen(m, pub.manifest_hash, { ...frozen, root: fakeRoot }, notes).root !== fakeRoot);
console.log(ok ? "RESULT PASS all witness recompute assertions" : "RESULT FAIL");
process.exitCode = ok ? 0 : 1;
