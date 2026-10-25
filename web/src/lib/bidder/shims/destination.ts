// envelope/destination.ts in the browser. The CLI classifies addresses with the audited benzo-pczt binary, which a page
// cannot run; here a refund address is held to the manifest network's unified-address shape only. The signers still
// classify it with the binary when they open the envelope, and a bad address goes to the exception queue (refundable
// with the bid's owner key), so the browser check only stops typos early.
const SHAPE: Record<string, RegExp> = { test: /^utest1[0-9a-z]{80,}$/, main: /^u1[0-9a-z]{80,}$/ };
export function requireShieldedDestination(destination: string, network: string): void {
  if (!(SHAPE[network] ?? SHAPE.test).test(destination)) throw new Error(`refund address must be a ${network === "main" ? "u1" : "utest1"}… unified address from your wallet`);
}
export const isUnifiedOn = (d: string, network: string) => (SHAPE[network] ?? SHAPE.test).test(d);
export const isUnifiedOrchardOn = isUnifiedOn;
export function classifyDestination(): never { throw new Error("address classification needs the benzo-pczt binary"); }
export function classifyAddresses(): never { throw new Error("address classification needs the benzo-pczt binary"); }
export function unifiedReceivers(): never { throw new Error("address classification needs the benzo-pczt binary"); }
export function useClassifyCache(): void {}
