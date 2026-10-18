// The three OrbStack signer hosts (Phase 5 part 1 §11): the harness's host-custody helpers now live in the PRODUCT
// (cli/hosts.ts, the `benzo hosts ...` commands), so the harness and the CLI run one copy. This file re-exports that
// module unchanged — the harness's orb/orbctl call sequences, timeouts and retries are byte-for-byte what they were.
export * from "../../cli/hosts";
