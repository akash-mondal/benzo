# @benzo/app-pos — Point-of-sale terminal

**Status: scaffold (ready to build).** Builds today, implements the `IBenzoPlatform`
port (`PosPlatform`), and consumes the shared `@benzo/core` + `@benzo/links`.
No feature UI yet — fill in the TODOs below.

## Architecture
- Shared logic comes from `@benzo/core` (protocol) and `@benzo/links` (typed links).
- This package only owns the **pos runtime adapter** (`src/platform.ts`) and its entry.
- Prover: `WasmProver` (from `@benzo/prover`).

## TODO to finish this surface
- Generate a private request QR (benzo:// request link) for an exact amount.
- Settlement polling -> "Paid" confirmation (the live demo beat).
- Optional auto cash-out: sweep merchant balance to fiat via the SEP-24 anchor corridor.
- PosPlatform: tablet/phone PWA storage + camera/QR; WasmProver only if the merchant also pays.
