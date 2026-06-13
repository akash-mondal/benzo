# @benzo/app-extension — Browser extension

**Status: scaffold (ready to build).** Builds today, implements the `IBenzoPlatform`
port (`ExtensionPlatform`), and consumes the shared `@benzo/core` + `@benzo/links`.
No feature UI yet — fill in the TODOs below.

## Architecture
- Shared logic comes from `@benzo/core` (protocol) and `@benzo/links` (typed links).
- This package only owns the **extension runtime adapter** (`src/platform.ts`) and its entry.
- Prover: `WasmProver` (from `@benzo/prover`).

## TODO to finish this surface
- Injected Benzo provider + published dApp-facing API (request a private USDC payment).
- Background service-worker scanner (trial-decrypt / view-tag fast-path) keeps balance fresh.
- Popup wallet reusing the shared UI; content script for pay-with-Benzo on checkout pages.
- ExtensionPlatform: chrome.storage for storage, chrome identity for keychain.
