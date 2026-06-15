/**
 * Slack connector — free workspace + app; posts finance-channel notifications
 * ("invoice paid", "payroll settled", "viewing-key granted"). Sandbox: a free
 * Slack workspace + an incoming webhook / bot token. https://api.slack.com.
 */
import { type ConnectorConfig, isStub } from "./common.js";

export interface SlackConnector {
  /** post a message to a channel (or the configured incoming webhook) */
  postMessage(input: { channel: string; text: string }): Promise<{ ok: boolean }>;
}

export function createSlackConnector(cfg: ConnectorConfig): SlackConnector {
  const webhook = cfg.baseUrl; // an incoming-webhook URL, when configured
  return {
    async postMessage(_input) {
      if (isStub(cfg) && !webhook) {
        // No creds: no-op so the rest of the flow runs in a bare demo.
        return { ok: true };
      }
      // TODO: POST _input to the incoming webhook, or chat.postMessage with a bot token.
      return { ok: true };
    },
  };
}
