// Step, result and waiting helpers shared by the two specs.
import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DRAND, E2E, OUT } from "./env";
import { redactAddresses } from "./redact";
export { redactAddresses };

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
  reasons: Record<string, string> = {}; // R74 (Reviewer R P2-6 on R73): a FAIL's first reason goes into run.json, not only the console
  // R73 (Reviewer R P1-1 on R72): per ID, the evidence files that must exist when the ID closes (a temporal bucket —
  // a file is listed under the first ID that closes after its write(), not under the ID whose claim cites it). A
  // missing file FAILs that ID, so a swallowed or skipped write() cannot pass silently (R71 lost signatures.json).
  constructor(private spec: string, private evidence: Record<string, string[]> = {}) {}

  private save() {
    mkdirSync(path.join(E2E, "results"), { recursive: true });
    writeFileSync(path.join(E2E, "results", `${this.spec}.json`), JSON.stringify(this.results, null, 1));
    mkdirSync(path.join(E2E, "fail-reasons"), { recursive: true });
    writeFileSync(path.join(E2E, "fail-reasons", `${this.spec}.json`), JSON.stringify(this.reasons, null, 1));
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
      for (const rel of this.evidence[id] ?? []) expect.soft(existsSync(path.join(OUT, rel)), `${id} evidence ${rel} was not written`).toBe(true);
      const errors = test.info().errors.slice(before);
      this.results[id] = errors.length ? "FAIL" : "PASS";
      // R74: the reason is committed in run.json, so it is redacted like any evidence text.
      if (errors.length) { this.reasons[id] = redactAddresses(reason(errors[0].message ?? "")); console.log(`ERROR ${id} ${this.reasons[id]}`); }
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

// Agent-friendly (class F): evidence is redacted by construction. write() abbreviates every address in any text it
// is given (UTF-8 bytes included), so a new evidence file cannot leak a destination by forgetting a call. Writing raw
// needs writeRaw() with a stated reason, which is greppable and reviewable.
export function write(rel: string, content: string | Uint8Array) {
  const text = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
  const isText = typeof content === "string" || Buffer.from(text, "utf8").equals(Buffer.from(content));
  writeRaw(rel, isText ? redactAddresses(text) : content, "binary evidence: no text to redact");
}

export function writeRaw(rel: string, content: string | Uint8Array, reason: string) {
  if (!reason.trim()) throw new Error(`writeRaw(${rel}) needs a reason`);
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
