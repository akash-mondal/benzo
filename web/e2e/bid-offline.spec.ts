// The bid page end to end with no chain: a real-shaped open round (e2e/lib/round.ts) is answered at the API layer, the
// page seals a bid with the shipped sealer bundle and the repo's own bid code in the browser, and the sealed record it
// sends is then checked in Node with the same rules the operator's admission and the signers apply.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openRound } from "./lib/round";
import { envelopeRecordValid, openEnvelope, settlementCommitment, verifyEnvelope } from "../../envelope/index";
import { memoBindsEnvelope, memoSealedBid, memoTlockCiphertext } from "../../settle/envelopes";
import { sealedBidShape } from "../../envelope/opening";
import { hash, verifyRecord } from "../../manifest/schema";

// The round as the gateway's detail route serves it (the bid page reads its mode, manifest and request from here).
const detail = (m: any, extra: Record<string, unknown> = {}) => ({ id: m.auction_id, mode: "uniform", state: "OPEN", lot: m.lot ?? null, lots: 1, supply: m.supply, C_zats: m.C_zats, T_submit: m.T_submit,
  T_freeze: m.T_freeze, R: m.drand.R, release: 0, leaf_count: 0, clearing_price_zats: null, settled: false, live: true, updated: 0, manifest: m, request: null, funding: null, ...extra });

test("seal a bid in the page; the record passes admission's rules and every signer opens the refund address", async ({ page, request }) => {
  const list = await (await request.get("/api/auctions")).json();
  const base = list.find((a: any) => a.mode === "uniform" && a.state === "SETTLED");
  const baseManifest = verifyRecord<any>((await (await request.get(`/api/auctions/${base.id}/packet`)).json()).manifest, (await (await request.get(`/api/auctions/${base.id}`)).json()).signer);
  const round = openRound(baseManifest), m = round.manifest, id = m.auction_id;
  const address = m.deposit_addresses[1], refund = m.deposit_addresses[2];
  const release = 1692803367 + (m.drand.R - 1) * 3;
  let submitted: any = null;

  await page.route("**/api/auctions", (r) => r.fulfill({ json: [{ id, mode: "uniform", state: "OPEN", lot: m.lot, lots: 1, supply: m.supply, C_zats: m.C_zats, T_submit: m.T_submit, T_freeze: m.T_freeze, R: m.drand.R, release, leaf_count: 0, clearing_price_zats: null, settled: false, live: true, updated: Math.floor(Date.now() / 1000) }] }));
  await page.route(`**/api/auctions/${id}`, (r) => r.fulfill({ json: detail(m) }));
  await page.route(`**/api/auctions/${id}/slot`, (r) => r.fulfill({ json: { address, slot: 1, held_until: m.T_submit } }));
  await page.route(`**/api/auctions/${id}/packet`, (r) => r.fulfill({ json: { manifest: round.packet, signer: round.signer } }));
  await page.route(`**/api/auctions/${id}/bids`, async (r) => { submitted = r.request().postDataJSON(); await r.fulfill({ status: 202, json: { status: "queued", detail: "waiting for the deposit's 10 confirmations" } }); });
  await page.route(`**/api/auctions/${id}/bids/*`, (r) => r.fulfill({ json: { status: "waiting", detail: "not admissible yet: deposit not unique or absent" } }));

  await page.goto(`/bid/?id=${id}`);
  await expect(page.getByTestId("ticket-title")).toHaveText("Offline test round");
  await page.getByTestId("bid-price").fill("450");
  await page.getByTestId("bid-refund").fill(refund);
  await page.getByTestId("bid-seal").click();
  await expect(page.getByTestId("bid-qr")).toBeVisible({ timeout: 60_000 });

  // The payment link pays exactly C to the slot's address, with the sealed bid as its memo.
  const uri = new URL(await page.getByTestId("bid-uri").getAttribute("href") as string);
  expect(uri.protocol).toBe("zcash:");
  expect(uri.pathname).toBe(address);
  expect(Number(uri.searchParams.get("amount"))).toBe(Number(m.C_zats) / 1e8);
  const memo = Buffer.from(uri.searchParams.get("memo")!, "base64url").toString("hex");

  // The bid key the page hands over.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bid-key").click()]);
  const key = JSON.parse(readFileSync((await dl.path())!, "utf8"));
  expect(key.auction_id).toBe(id);

  await page.getByTestId("bid-txid").fill("ab".repeat(32));
  await page.getByTestId("bid-send").click();
  await expect(page.getByTestId("bid-status")).toHaveAttribute("data-status", "waiting");

  // What reached the operator: the sealed record only.
  expect(Object.keys(submitted).sort()).toEqual(["address", "ciphertext_hash", "envelope_ct_hex", "envelope_hex", "owner_sig_hex", "txid"]);
  // Neither the refund address nor the plaintext order (it starts version byte + auction id; the price is a u64 at 33)
  // appears anywhere in what was sent: only the tlock ciphertext and the envelope sealed to the signers.
  const sent = JSON.stringify(submitted);
  expect(sent).not.toContain(refund);
  expect(sent).not.toContain(id);
  expect(sent).not.toContain((450).toString(16).padStart(16, "0"));
  expect(submitted.envelope_hex).toBe(memo);

  // Admission's rules (clear/auction-cli.ts admit) on the record.
  const parsed = memoSealedBid(submitted.envelope_hex)!;
  expect(parsed).not.toBeNull();
  const { ct, memo_tag } = memoTlockCiphertext(submitted.envelope_hex, m.drand.R);
  expect(sealedBidShape(ct, m.drand.R)).toEqual({ ok: true });
  expect(hash(Buffer.from(ct, "hex"))).toBe(submitted.ciphertext_hash);
  expect(envelopeRecordValid({ envelope_ct: submitted.envelope_ct_hex, owner_sig: submitted.owner_sig_hex }, m.envelope_keys)).toBe(true);
  expect(memoBindsEnvelope(memo_tag, submitted.envelope_ct_hex)).toBe(true);
  // The owner signature binds this auction, this ciphertext and this envelope, under the key in the bid key file.
  expect(verifyEnvelope(key.owner_public_hex, id, submitted.ciphertext_hash, submitted.envelope_ct_hex, submitted.owner_sig_hex)).toBe(true);
  expect(settlementCommitment(key.nonce_hex, submitted.envelope_ct_hex)).toBe(key.settlement_commitment_hex);
  // Each of the three signers opens the refund address with its own key; nobody else can.
  for (const k of round.envelopeKeys) expect(openEnvelope(submitted.envelope_ct_hex, k.private_hex, "test")).toBe(refund);
});

test("the bid page refuses a bad price and a malformed refund address before anything is sealed", async ({ page, request }) => {
  const list = await (await request.get("/api/auctions")).json();
  const base = list.find((a: any) => a.mode === "uniform" && a.state === "SETTLED");
  const round = openRound(verifyRecord<any>((await (await request.get(`/api/auctions/${base.id}/packet`)).json()).manifest, (await (await request.get(`/api/auctions/${base.id}`)).json()).signer));
  const m = round.manifest, id = m.auction_id;
  await page.route("**/api/auctions", (r) => r.fulfill({ json: [{ id, mode: "uniform", state: "OPEN", lot: m.lot, lots: 1, supply: 1, C_zats: m.C_zats, T_submit: m.T_submit, T_freeze: m.T_freeze, R: m.drand.R, release: 0, leaf_count: 0, clearing_price_zats: null, settled: false, live: true, updated: 0 }] }));
  await page.route(`**/api/auctions/${id}`, (r) => r.fulfill({ json: detail(m) }));
  await page.route(`**/api/auctions/${id}/slot`, (r) => r.fulfill({ json: { address: m.deposit_addresses[0], slot: 0, held_until: m.T_submit } }));
  await page.route(`**/api/auctions/${id}/packet`, (r) => r.fulfill({ json: { manifest: round.packet, signer: round.signer } }));
  await page.goto(`/bid/?id=${id}`);
  await page.getByTestId("bid-price").fill(String(Number(m.B_max_zats) + 10));
  await page.getByTestId("bid-refund").fill(m.deposit_addresses[2]);
  await page.getByTestId("bid-seal").click();
  await expect(page.getByTestId("bid-error")).toContainText("price must be between");
  await page.getByTestId("bid-price").fill("450");
  await page.getByTestId("bid-refund").fill("t1notashieldedaddress");
  await page.getByTestId("bid-seal").click();
  await expect(page.getByTestId("bid-error")).toContainText("shielded testnet address");
});

test("an RFQ round takes bids only from its invited dealers: a stranger sees that, a dealer bids under its own key", async ({ page, request }) => {
  const list = await (await request.get("/api/auctions")).json();
  const base = list.find((a: any) => a.mode === "uniform" && a.state === "SETTLED");
  const round = openRound(verifyRecord<any>((await (await request.get(`/api/auctions/${base.id}/packet`)).json()).manifest, (await (await request.get(`/api/auctions/${base.id}`)).json()).signer));
  const m = round.manifest, id = m.auction_id, rid = "0123456789abcdef";
  await page.route("**/api/auctions", (r) => r.fulfill({ json: [{ ...detail(m, { mode: "rfq" }), manifest: undefined }] }));
  await page.route(`**/api/auctions/${id}`, (r) => r.fulfill({ json: detail(m, { mode: "rfq", request: rid }) }));
  await page.goto(`/bid/?id=${id}`);
  await expect(page.getByTestId("bid-parties-only")).toBeVisible();
  await expect(page.getByTestId("bid-form")).toHaveCount(0);
  await page.evaluate((r) => localStorage.setItem("benzo:parties", JSON.stringify([{ rid: r, label: "Dealer 2", private_hex: "11".repeat(32), public_hex: "22".repeat(32) }])), rid);
  await page.reload();
  await expect(page.getByTestId("bid-party")).toContainText("Dealer 2");
  await expect(page.getByText("Your quote")).toBeVisible();
});
