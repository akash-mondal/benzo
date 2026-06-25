import { describe, it, expect, beforeEach } from "vitest";

// localStorage shim (the wallet unit tests run in a node env without one).
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

import { getLockSettings, setLockSettings, shouldLockOnOpen, shouldLockOnSend } from "./lock.js";

describe("app lock settings (C4 - Security Lock)", () => {
  beforeEach(() => mem.clear());

  it("defaults to both locks off", () => {
    expect(getLockSettings()).toEqual({ onOpen: false, onSend: false });
  });

  it("persists each toggle independently", () => {
    setLockSettings({ onOpen: true, onSend: false });
    expect(getLockSettings()).toEqual({ onOpen: true, onSend: false });
    setLockSettings({ onOpen: false, onSend: true });
    expect(getLockSettings()).toEqual({ onOpen: false, onSend: true });
  });

  it("coerces malformed storage back to a safe default", () => {
    mem.set("benzo.lock.v1", "{not json");
    expect(getLockSettings()).toEqual({ onOpen: false, onSend: false });
  });

  it("FAIL-SAFE: never gates when there is no authenticator, even with both toggles on", () => {
    // No passkey registered + no WebAuthn (node env) => lockCapable() is false,
    // so a stale/forced "on" setting must NOT lock the user out of their money.
    setLockSettings({ onOpen: true, onSend: true });
    expect(shouldLockOnOpen()).toBe(false);
    expect(shouldLockOnSend()).toBe(false);
  });
});
