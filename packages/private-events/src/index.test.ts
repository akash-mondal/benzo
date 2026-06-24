import { describe, expect, it } from "vitest";
import {
  buildAnchor,
  buildAuditPacket,
  createPrivateEvent,
  decryptPrivateEvent,
  deriveEventKey,
  merkleRoot,
  verifyHashChain,
  verifyMerkleProof,
} from "./index.js";

describe("private events", () => {
  const key = deriveEventKey("test org secret");

  it("encrypts payloads and keeps plaintext out of the envelope", () => {
    const event = createPrivateEvent(
      {
        orgId: "org_acme",
        type: "invoice.created",
        subjectId: "inv_1",
        schema: "invoice.v1",
        publicMeta: { source: "wallet" },
        payload: {
          description: "Design work, June",
          amount: "42000000000",
          counterpartyName: "Grace Hopper",
        },
        occurredAt: "2026-06-24T00:00:00.000Z",
      },
      { key, id: "pe_test" },
    );
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("Design work");
    expect(serialized).not.toContain("42000000000");
    expect(serialized).not.toContain("Grace Hopper");
    expect(decryptPrivateEvent(event, key).payload).toMatchObject({ amount: "42000000000" });
  });

  it("rejects sensitive public metadata", () => {
    expect(() =>
      createPrivateEvent(
        {
          orgId: "org_acme",
          type: "invoice.created",
          subjectId: "inv_1",
          schema: "invoice.v1",
          publicMeta: { amount: "42000000000" },
          payload: { amount: "42000000000" },
        },
        { key },
      ),
    ).toThrow(/sensitive key/);
  });

  it("detects tampering in the hash chain and decrypt AAD", () => {
    const one = createPrivateEvent(
      { orgId: "org_acme", type: "invoice.created", subjectId: "inv_1", schema: "invoice.v1", payload: { amount: "1" } },
      { key, id: "pe_1" },
    );
    const two = createPrivateEvent(
      { orgId: "org_acme", type: "invoice.paid", subjectId: "inv_1", schema: "invoice.v1", payload: { txHash: "abc" } },
      { key, prevHash: one.hash, id: "pe_2" },
    );
    expect(verifyHashChain([one, two])).toEqual({ ok: true, headHash: two.hash });
    const tampered = { ...two, publicMeta: { leaked: "nope" } };
    expect(verifyHashChain([one, tampered]).ok).toBe(false);
    expect(() => decryptPrivateEvent(tampered, key)).toThrow(/AAD/);
  });

  it("builds auditable anchors and inclusion proofs", () => {
    const events = [
      createPrivateEvent({ orgId: "org_acme", type: "invoice.created", subjectId: "inv_1", schema: "invoice.v1", payload: { amount: "1" } }, { key, id: "pe_1" }),
      createPrivateEvent({ orgId: "org_acme", type: "payment.settled", subjectId: "po_1", schema: "payment.v1", payload: { txHash: "tx" } }, { key, id: "pe_2" }),
    ];
    events[1] = createPrivateEvent(
      { orgId: "org_acme", type: "payment.settled", subjectId: "po_1", schema: "payment.v1", payload: { txHash: "tx" } },
      { key, prevHash: events[0].hash, id: "pe_2" },
    );
    const root = merkleRoot(events.map((e) => e.hash));
    const anchor = buildAnchor("org_acme", events, "tx_anchor");
    expect(anchor.merkleRoot).toBe(root);
    const packet = buildAuditPacket({ orgId: "org_acme", events, anchor, scope: { label: "payments", eventTypes: ["payment.settled"] } });
    expect(packet.envelopes).toHaveLength(1);
    expect(verifyMerkleProof(packet.inclusionProofs[0], root)).toBe(true);
  });
});
