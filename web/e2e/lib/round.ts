// A real-shaped open round for the offline bid test: the newest settled round's signed manifest, re-made with a new id,
// a future window and round R, and three signer envelope keys whose private halves this test holds, re-signed with a
// fresh operator key by the repo's own signRecord. Nothing here touches a chain.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { generateEnvelopeKey } from "../../../envelope/index";
import { signRecord, validateManifest, QUICKNET } from "../../../manifest/schema";

export function openRound(baseManifest: any) {
  const keys = [generateEnvelopeKey(), generateEnvelopeKey(), generateEnvelopeKey()];
  const now = Math.floor(Date.now() / 1000), R = 1 + Math.ceil((now + 3600 - QUICKNET.genesis) / QUICKNET.period);
  const m = structuredClone(baseManifest);
  for (const k of ["witness_set_hash", "bond", "sealed_reserve", "reserve_return_ua_commitment", "seller_ua_commitment"]) delete m[k];
  Object.assign(m, { auction_id: randomBytes(32).toString("hex"), T_submit: now + 1800, T_freeze: now + 3000, envelope_keys: keys.map((k) => k.public_hex), lot: "Offline test round" });
  m.drand = { ...m.drand, R };
  validateManifest(m);
  const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const packet = signRecord(m, pem);
  return { manifest: m, packet, signer: packet.signer, envelopeKeys: keys };
}
