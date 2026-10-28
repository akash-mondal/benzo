// The one caller of
// `benzo-pczt quote-sweep` — the wallet's OWN quote of the one-row reserve sweep. The fee the return pays
// is the tool's fee for the transaction it will really build (the ZIP-317 fee of its real per-pool action
// counts), never a prediction from the source count: a prediction is wrong whenever the sweep's single
// output lands in a pool none of the sources is in, and the wrong amount made every host's build die.
//
// The result is the tool's own figures or the tool's own error. Callers turn an error into the typed
// "reserve return waits" line (the plan) or the typed refusal (a signer host) and NEVER crash the run.
import { execFileSync } from "node:child_process";
export type SweepQuote = { amount_zats: string; fee_zats: string; input_zats: string; spends: number; actions: number };
export function quoteSweep(pczt: string, wallet: string, to: string, network: string): SweepQuote | { error: string } {
  try {
    const out = execFileSync(pczt, ["quote-sweep", "--wallet", wallet, "--to", to, "--network", network], { encoding: "utf8", maxBuffer: 16 << 20 });
    const q = JSON.parse(out.trim().split("\n").filter(l => l.startsWith("{")).at(-1)!);
    if (!/^[1-9][0-9]*$/.test(String(q.amount_zats)) || !/^[1-9][0-9]*$/.test(String(q.fee_zats)) || !/^[1-9][0-9]*$/.test(String(q.input_zats))
      || !Number.isInteger(q.spends) || q.spends < 1 || !Number.isInteger(q.actions) || q.actions < 1)
      return { error: "quote-sweep printed an unexpected shape" };
    return { amount_zats: String(q.amount_zats), fee_zats: String(q.fee_zats), input_zats: String(q.input_zats), spends: q.spends, actions: q.actions };
  } catch (e) {
    const err = e as Error & { stderr?: string | Buffer };
    const tail = String(err.stderr ?? "").trim() || err.message;
    return { error: tail.split("\n").filter(Boolean).at(-1)?.slice(0, 200) ?? "quote-sweep failed" };
  }
}
