# @benzo/app-web — Consumer wallet PWA (flagship)

**Status: scaffold (ready to build).** Builds today, implements the `IBenzoPlatform`
port (`WebPlatform`), and consumes the shared `@benzo/core` + `@benzo/links`.
No feature UI yet — fill in the TODOs below.

## Architecture
- Shared logic comes from `@benzo/core` (protocol) and `@benzo/links` (typed links).
- This package only owns the **web runtime adapter** (`src/platform.ts`) and its entry.
- Prover: `WasmProver` (from `@benzo/prover`).

## TODO to finish this surface
- Passkey onboarding via kalepail smart-account-kit (secp256r1/WebAuthn smart account).
- Real WASM Web Worker prover wired into ProverPort (replace the WasmProver stub).
- Optimistic UI over send(): confirm-now, prove+settle in background, silent retry on stale root.
- Stellar-Wallets-Kit (SEP-43) connect for funding from LOBSTR/Freighter/xBull.
- WebPlatform: localStorage for storage, WebAuthn/IndexedDB for keychain, navigator.clipboard.
- Screens: balance, send (@handle/contact/claim-link), receive, history, share-receipt.
