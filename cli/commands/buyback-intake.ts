// Part 2 §1 row 5 (recurring buyback): the round's serial intake. Each winner signs {auction_id, ciphertext_hash,
// serials} with the one-time owner key inside its own opened bid (adapters/buyback-report.ts), and this shipped
// command validates every record against the round — the same rule `benzo report` and `benzo verify` apply — then
// publishes serial-intake.json and the per-window report.json with the round. A record that fails any check is
// refused and nothing is published.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { jsonBytes, requireThat } from "../../manifest/schema";
import { loadCompletePublicAuction } from "../../api/public-auction";
import { buybackReport } from "../../adapters/buyback-report";

export const noun = "buyback", verb = "intake";
export const help = "benzo buyback intake --id AUCTION_ID --file records.json — recurring buyback: validate the winners' signed serial intake against the round and publish serial-intake.json + report.json";
const state = () => process.env.BNZ_STATE_DIR ? path.resolve(process.env.BNZ_STATE_DIR) : path.join(os.homedir(), ".benzo");

export async function run(argv: string[]): Promise<number | object> {
  let id = "", file = "";
  for (let i = 0; i < argv.length; i += 2) {
    if (["--id", "--file"].includes(argv[i]) && argv[i + 1] !== undefined) { if (argv[i] === "--id") id = argv[i + 1]; else file = argv[i + 1]; }
    else { process.stderr.write(`ERROR buyback intake usage: ${help}\n`); return 2; }
  }
  try {
    requireThat(/^[0-9a-f]{64}$/.test(id) && file, "usage");
    const st = state(), cfg = JSON.parse(readFileSync(path.join(st, "product", `${id}.json`), "utf8"));
    const publicDir = path.resolve(cfg.public_dir), target = path.join(publicDir, "serial-intake.json");
    const intake = JSON.parse(readFileSync(path.resolve(file), "utf8"));
    requireThat(Array.isArray(intake) && intake.length > 0, "serial intake array");
    requireThat(!existsSync(target), "serial intake already published");
    const ledger = JSON.parse(readFileSync(path.join(st, "auction", `${id}.json`), "utf8"));
    writeFileSync(target, jsonBytes(intake), { mode: 0o600 });
    try {
      const report = buybackReport(loadCompletePublicAuction(publicDir, { signer: ledger.signer }));
      writeFileSync(path.join(publicDir, "report.json"), jsonBytes(report), { mode: 0o600 });
      return report;
    } catch (e) { rmSync(target, { force: true }); throw e; }
  } catch (e) {
    process.stderr.write(`ERROR buyback intake ${(e as Error).message}\n`);
    return 1;
  }
}
