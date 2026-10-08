// Step, result and waiting helpers shared by the two specs.
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DRAND, E2E, OUT } from "./env";

type Result = "PASS" | `PASS (narrowed: ${string})` | "FAIL" | "NOT RUN";

// One line: the assertion's name plus its expected and received values, without colour codes.
const reason = (message: string) =>
  message
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("expect("))
    .join(" | ")
    .slice(0, 400);

export class Run {
  results: Record<string, Result> = {};
  constructor(private spec: string) {}

  private save() {
    mkdirSync(path.join(E2E, "results"), { recursive: true });
    writeFileSync(path.join(E2E, "results", `${this.spec}.json`), JSON.stringify(this.results, null, 1));
  }

  // One assertion ID: a soft failure is recorded and printed as `ERROR <id> <reason>`, and the next step still runs.
  async check(id: string, title: string, body: () => Promise<void> | void) {
    await test.step(`${id} ${title}`, async () => {
      const before = test.info().errors.length;
      try {
        await body();
      } catch (err) {
        expect.soft(String((err as Error)?.message ?? err), `${id} threw`).toBe("");
      }
      const errors = test.info().errors.slice(before);
      this.results[id] = errors.length ? "FAIL" : "PASS";
      if (errors.length) console.log(`ERROR ${id} ${reason(errors[0].message ?? "")}`);
      this.save();
    });
  }

  // R49 (Reviewer R P2-6 on R47): a check that ran only part of its title records that in run.json, not a bare PASS.
  narrowed(id: string, why: string) {
    if (!(id in this.results)) throw new Error(`narrowed: unknown check ${id}`); // R52 (P2): a typo must not leave a bare PASS
    if (this.results[id] === "PASS") { this.results[id] = `PASS (narrowed: ${why})`; this.save(); }
  }

  // A failed precondition: print `NOT RUN <cause>`, mark every ID NOT RUN, and fail the test.
  notRun(ids: string[], cause: string): never {
    console.log(`NOT RUN ${cause}`);
    for (const id of ids) this.results[id] = "NOT RUN";
    this.save();
    throw new Error(`NOT RUN ${cause}`);
  }
}

export function write(rel: string, content: string | Uint8Array) {
  const p = path.join(OUT, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

export async function latestRound(): Promise<number> {
  const res = await fetch(`${DRAND}/public/latest`);
  if (!res.ok) throw new Error(`drand /public/latest: HTTP ${res.status}`);
  const round = (await res.json()).round;
  if (!Number.isInteger(round)) throw new Error("drand /public/latest: no round");
  return round;
}

// Polls until the drand round or chain height reaches `target`; throws at the deadline (ms since epoch).
export async function waitFor(what: { round: number } | { height: number; tip: () => number | Promise<number> }, deadline: number) {
  for (;;) {
    const now = "round" in what ? await latestRound() : await what.tip();
    const target = "round" in what ? what.round : what.height;
    if (now >= target) return now;
    if (Date.now() > deadline) throw new Error(`deadline passed waiting for ${JSON.stringify(what)}; at ${now}`);
    await new Promise((r) => setTimeout(r, "round" in what ? 1000 : 15000));
  }
}
