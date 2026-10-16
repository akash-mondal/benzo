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

// R54: one dropped drand read (`fetch failed: read ETIMEDOUT`, RG attempt 6 settle-crash) must not fail a live run:
// each request is bounded at 15 s and a network error or HTTP 5xx is retried 5x with backoff.
export async function latestRound(): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${DRAND}/public/latest`, { signal: AbortSignal.timeout(15_000) });
      if (res.status >= 500) throw new Error(`drand /public/latest: HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`drand /public/latest: HTTP ${res.status}`), { final: true });
      const round = (await res.json()).round;
      if (!Number.isInteger(round)) throw Object.assign(new Error("drand /public/latest: no round"), { final: true });
      return round;
    } catch (e) {
      if ((e as any).final || attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
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

// R71 (B37 leak audit, real findings 1–3): evidence never carries a full shielded or transparent destination — a
// refund/output address in committed evidence links a payout to its recipient. Writers that capture raw tool output
// pass it through here; the abbreviated form keeps enough to cross-reference within one evidence directory.
const ADDRESS = /\b(?:utest1|u1|ztestsapling1|zs1|tm|t1|tex1)[0-9a-z]{30,}\b/gi;
export const redactAddresses = (text: string): string => text.replace(ADDRESS, (a) => `${a.slice(0, 10)}…${a.slice(-6)}`);
