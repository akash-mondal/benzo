/**
 * Shared shape for third-party SANDBOX connectors. Every connector is built for
 * a provider's self-serve public sandbox (no sales call). Until creds are
 * supplied the methods return realistic stub shapes so the BFF + UI integrate
 * against a stable contract; wiring the real sandbox fetch is a marked TODO per
 * method.
 */

export interface ConnectorConfig {
  /** sandbox API key / access token (self-serve) */
  apiKey?: string;
  /** override base URL (defaults to the provider's sandbox host) */
  baseUrl?: string;
  /** always true for the MVP — points at the provider's sandbox/test env */
  sandbox: boolean;
}

/** True when no credential is configured yet (operate in stub mode). */
export function isStub(cfg: ConnectorConfig): boolean {
  return !cfg.apiKey;
}

/** A connected external object reference (non-secret). */
export interface ExternalRef {
  provider: string;
  externalId: string;
  kind: string;
}
