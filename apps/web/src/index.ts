/**
 * @benzo/app-web — Consumer wallet PWA (flagship).
 *
 * Headless composition layer: wires the web adapters (IndexedDB storage,
 * WasmProver, StellarRpcClient + relayer/sponsor service) into a ready
 * BenzoClient via createWebWallet(). The UI renders over `wallet.client`.
 */
export * from "./platform.js";
export * from "./wallet.js";
