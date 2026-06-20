/**
 * @benzo/ui — shared, framework-agnostic privacy/payment primitives for both
 * Benzo apps (pay.benzo.xyz consumer + work.benzo.xyz console).
 *
 * The *logic* lives here (formatting, the payment/proving/wallet state machines,
 * balance masking) so both apps behave identically; the *presentational* chrome
 * (cards, buttons, Tailwind tokens) stays per-app. React hooks in `./hooks`
 * connect the pure reducers to a screen — import those only in a React app.
 */
export * from "./format.js";
export * from "./payment-state.js";
export * from "./send-sequence.js";
export * from "./proving-state.js";
export * from "./wallet-state.js";
export * from "./balance.js";
export * from "./hooks.js";
