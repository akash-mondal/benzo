# @benzo/app-telegram — Telegram bot + mini-app (TWA)

**Status: scaffold (ready to build).** Builds today, implements the `IBenzoPlatform`
port (`TelegramPlatform`), and consumes the shared `@benzo/core` + `@benzo/links`.
No feature UI yet — fill in the TODOs below.

## Architecture
- Shared logic comes from `@benzo/core` (protocol) and `@benzo/links` (typed links).
- This package only owns the **telegram runtime adapter** (`src/platform.ts`) and its entry.
- Prover: `WasmProver` (from `@benzo/prover`).

## TODO to finish this surface
- Bot command handlers: /send <amt> @handle, /balance, /request, /claim.
- Telegram Mini-App (TWA) webview reusing @benzo/core + shared UI.
- TelegramPlatform: Telegram CloudStorage for storage, WebApp.* for clipboard/openLink.
- Telegram-identity -> @handle mapping via the on-chain handle_registry.
- In-chat claim-links onboard the next user in two taps.
