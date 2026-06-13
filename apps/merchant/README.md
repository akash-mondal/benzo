# @benzo/app-merchant — Merchant / payroll dashboard

**Status: scaffold (ready to build).** Builds today, implements the `IBenzoPlatform`
port (`MerchantPlatform`), and consumes the shared `@benzo/core` + `@benzo/links`.
No feature UI yet — fill in the TODOs below.

## Architecture
- Shared logic comes from `@benzo/core` (protocol) and `@benzo/links` (typed links).
- This package only owns the **merchant runtime adapter** (`src/platform.ts`) and its entry.
- Prover: `NodeProver` (from `@benzo/prover`).

## TODO to finish this surface
- Confidential batch payroll: CSV -> N shielded transfers in one run.
- Selective-disclosure console: mint a time-scoped TVK, give an auditor scoped read-only access.
- Merchant settlement view: private incoming receipts reconciled against orders; cash-out via anchor.
- Invoice/request-link generation per customer (reuses @benzo/links request links).
- MerchantPlatform: server-side storage/keychain (DB + KMS), NodeProver.
