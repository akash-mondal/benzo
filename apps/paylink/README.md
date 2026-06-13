# @benzo/app-paylink — Payment-link microsite

**Status: scaffold (ready to build).** Builds today, implements the `IBenzoPlatform`
port (`PaylinkPlatform`), and consumes the shared `@benzo/core` + `@benzo/links`.
No feature UI yet — fill in the TODOs below.

## Architecture
- Shared logic comes from `@benzo/core` (protocol) and `@benzo/links` (typed links).
- This package only owns the **paylink runtime adapter** (`src/platform.ts`) and its entry.
- Prover: `NodeProver` (from `@benzo/prover`).

## TODO to finish this surface
- Claim-link + request-link landing pages (parse @benzo/links; secret stays in URL fragment).
- One-tap "claim into a fresh passkey account" flow (rides on the web PWA onboarding).
- One-command Docker deploy; server renders, client claims.
- PaylinkPlatform: ephemeral storage; NodeProver server-side for request settlement.
