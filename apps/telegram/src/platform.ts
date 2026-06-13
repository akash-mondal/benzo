import type { IBenzoPlatform, KVStorage, Keychain, Clipboard } from "@benzo/platform";
import { WasmProver, type ProverPort } from "@benzo/prover";

/**
 * Telegram surface adapter (IBenzoPlatform).
 * In-memory stubs are used here so the package builds; the real bindings
 * (see README) swap storage/keychain/clipboard for the telegram runtime.
 */
export class TelegramPlatform implements IBenzoPlatform {
  readonly name = "telegram";
  readonly prover: ProverPort = new WasmProver();
  private mem = new Map<string, string>();
  readonly storage: KVStorage = {
    get: async (k) => this.mem.get(k) ?? null,
    set: async (k, v) => void this.mem.set(k, v),
    remove: async (k) => void this.mem.delete(k),
  };
  private sec = new Map<string, string>();
  readonly keychain: Keychain = {
    getSecret: async (k) => this.sec.get(k) ?? null,
    setSecret: async (k, v) => void this.sec.set(k, v),
  };
  readonly clipboard: Clipboard = { read: async () => "", write: async () => {} };
  async openLink(url: string): Promise<void> { void url; /* TODO: telegram navigation */ }
}
