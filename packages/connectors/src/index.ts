/**
 * @benzo/connectors — typed clients for the self-serve PUBLIC SANDBOX
 * integrations the MVP wires (no sales call). The BFF (apps/console-api) maps
 * these provider shapes onto the @benzo/types domain model.
 *
 * Verified self-serve sandboxes:
 *   Merge (unified accounting+HRIS), QuickBooks Online, Xero, Plaid, Slack.
 */
export * from "./common.js";
export * from "./merge.js";
export * from "./quickbooks.js";
export * from "./xero.js";
export * from "./plaid.js";
export * from "./slack.js";
