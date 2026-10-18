# Gate H — P0 threat closure (head design, 2026-10-18)

Gate H asks: is every **P0 row** of `docs/research/threat-model.md` (34 rows, table lines 81–114) either **closed on the live path** with a pointer to the code and the live evidence that closes it, or **disclosed** as a trust boundary in the README's honest limits?

This is an offline batch for a builder. The head reviews it and owns the verdict.

## Inputs (read, do not change)

- `docs/research/threat-model.md` — the 34 P0 rows (rank, ID, threat, mitigation).
- `docs/research/DESIGN.md` (§14 honest limits) and `README.md` (`## Honest limits`).
- `docs/evidence/phase-6/closure.md` — the R6–R26 P0/P1 reviewer-finding closure table. Supporting material only: it maps reviewer findings, not threat-model rows.
- Live evidence: `docs/evidence/phase-6/rg/<project>/run.json` (gate RG, PASSED at `910a531`, R84) and the per-ID files beside it; `docs/evidence/phase-{1..5}/EVIDENCE.md`; `docs/evidence/phase-5/markets/`.
- Rulings: `docs/PHASE-{3,4,5,6}.md`. Phase 7 list: `docs/design/phase7-hardening.md`.

## Deliverable 1: `docs/evidence/phase-6/h-closure.md`

One table, one row per P0 row, in threat-model rank order. Columns:

| Rank | ID | Threat (short) | State | Code that closes it | Live evidence | Disclosure |

- **State** is exactly one of:
  - **closed** — a code path enforces the mitigation on the live (testnet) path, AND a live RG/phase evidence ID shows it. Give `file:line` for the enforcing check and the evidence as `rg/<project>/run.json <ID>` (or a phase-N evidence path + ID). A unit/offline repro alone is not "closed"; say **closed (offline proof only)** and name the repro.
  - **disclosed** — the residual is a trust boundary; quote the README honest-limits line that discloses it (line number). If the README lacks the line, state **disclosed — README GAP** and write the exact sentence that should be added (one plain line).
  - **closed + disclosed** — both apply (e.g. #13 FROST collusion: dealerless DKG and signer binding are enforced, and the 2-of-3 collusion limit is disclosed).
  - **out of scope (MVP)** — only if a ruling excludes the feature (e.g. a NEAR/bridge funding path that the product does not ship). Cite the ruling or design line. If the feature ships anywhere (`crosschain`, `docs/design/crosschain.md`), it is not out of scope.
  - **GAP** — neither enforced nor disclosed. Describe the gap in one line. Do not fix it.
- Every pointer must be checked by opening the file: no pointer from memory or from another table without verifying it at HEAD.

## Deliverable 2: §5a items (same file, section "Signer binding and kill drill")

- Threat rows #13 (011, FROST quorum collusion) and #15 (013, dealer/DKG centralization): cite the signer-binding evidence (Phase 5 R3 item 8) and the mid-batch signer-kill drill (`BNZ_DRILL_STOP`, restored in `signParallelHost`, PHASE-6 R-entry for Y1b) with the RG evidence ID that ran it live.

## Deliverable 3: README honest-limits patch list (same file, last section)

- List every **README GAP** sentence from Deliverable 1, ready to paste, each tagged with its threat rank. Do not edit README.md; the head applies them.

## Rules

- Offline only. No `.benzo/`, no OrbStack/`orb`, no testnet, no wallets, no Playwright live runs, no `.env`. Read-only git, grep, node scripts that read files, and `npx tsc --noEmit` are fine.
- No product, harness or README changes. Only `docs/evidence/phase-6/h-closure.md` and a status block in `docs/STATUS-B.md`.
- Plain English, short lines. Prefer "closed" claims you can prove over generous ones; when unsure, mark it GAP and say why.
- Commit on your branch with message `B38: gate H closure table (phase6-h.md)`. Report the count per State at the end.
