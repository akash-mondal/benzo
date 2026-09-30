// Serves the built sealer (seal/dist) on 127.0.0.1 and drives it in a Playwright page, recording every request and
// websocket event the page makes.
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { ROOT } from "./env";

export type NetEvent = { t: number; kind: string; method?: string; url: string };

export async function serveSealer(): Promise<{ url: string; close: () => void }> {
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript" };
  const server = http.createServer((req, res) => {
    const name = path.basename(new URL(req.url ?? "/", "http://x").pathname) || "index.html";
    try {
      const body = readFileSync(path.join(ROOT, "seal", "dist", name));
      res.writeHead(200, { "content-type": types[path.extname(name)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => server.close() };
}

export function recordNetwork(page: Page): NetEvent[] {
  const events: NetEvent[] = [];
  page.on("request", (r) => events.push({ t: Date.now(), kind: "request", method: r.method(), url: r.url() }));
  page.on("websocket", (ws) => {
    events.push({ t: Date.now(), kind: "websocket", url: ws.url() });
    ws.on("framesent", () => events.push({ t: Date.now(), kind: "ws-framesent", url: ws.url() }));
    ws.on("framereceived", () => events.push({ t: Date.now(), kind: "ws-framereceived", url: ws.url() }));
  });
  return events;
}

export type BidInput = { opening: string; auction: string; price: string; quantity: string; collateral: string; address: string };

// Types one bid and returns the page's envelope hex and URI, or its error text.
export async function sealBid(page: Page, bid: BidInput): Promise<{ envelope: string; uri: string; error: string }> {
  for (const [field, value] of Object.entries(bid)) await page.locator(`#${field}`).fill(value);
  await page.locator("#seal").click();
  await page.waitForFunction(() => document.getElementById("envelope")!.textContent || document.getElementById("error")!.textContent);
  const text = (id: string) => page.locator(`#${id}`).innerText();
  return { envelope: await text("envelope"), uri: await text("uri"), error: await text("error") };
}
