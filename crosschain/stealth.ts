// ERC-5564 stealth delivery (docs/design/crosschain.md §4, §7 step 4).
//
// The winner's settlement envelope `deliver` (docs/PHASE-5.md R19: `{chain, kind, to, elgamal?}`) carries
// its ERC-6538 stealth meta-address. Delivery derives ONE fresh stealth address per settlement from that
// meta-address with the pinned ScopeLift SDK (`@scopelift/stealth-address-sdk`), the escrow pays the allocation there,
// the release flow adds the tiny native gas stipend (design §4 lesson 6: the winner never funds the fresh
// address from a known wallet), and the payment is announced on the canonical ERC-5564 Announcer so the
// winner finds it with its viewing key alone. What is public on chain (design §4): the escrow, the amount
// and a one-time address — never the winner's meta-address or identity.
//
// The Announcer and Registry are the canonical ScopeLift deployments (same addresses on every chain,
// design §4: "canonical Announcer and Registry"): on local chains they are deployed from the canonical
// bytecode bundled in the pinned SDK; on Ethereum Sepolia they are the canonical addresses themselves.
import {
  generateRandomStealthMetaAddress,
  generateStealthAddress,
  computeStealthKey,
  checkStealthAddress,
  getAnnouncementsForUser,
  prepareAnnounce,
  prepareRegisterKeys,
  buildMetadataForETH,
  buildMetadataForERC20,
  ERC5564_CONTRACT_ADDRESS,
  ERC6538_CONTRACT_ADDRESS,
  ERC5564_BYTECODE,
  ERC6538_BYTECODE,
  ERC5564AnnouncerAbi,
  ERC6538RegistryAbi,
  VALID_SCHEME_ID,
  type EthAddress,
  type GenerateStealthAddressReturnType,
  type AnnouncementLog,
} from "@scopelift/stealth-address-sdk";
import { createHash } from "node:crypto";

export const SCHEME_ID = VALID_SCHEME_ID.SCHEME_ID_1; // secp256k1 (EIP-5564 scheme 1)
export const CANONICAL_ERC5564_ANNOUNCER = ERC5564_CONTRACT_ADDRESS;
export const CANONICAL_ERC6538_REGISTRY = ERC6538_CONTRACT_ADDRESS;
export const CANONICAL_ERC5564_BYTECODE = ERC5564_BYTECODE;
export const CANONICAL_ERC6538_BYTECODE = ERC6538_BYTECODE;
export const ANNOUNCER_ABI = ERC5564AnnouncerAbi;
export const REGISTRY_ABI = ERC6538RegistryAbi;

// The viem public client the SDK's actions read chain state through (its `ClientParams`).
export type ClientParams = { publicClient: unknown };

export type StealthKeys = {
  stealthMetaAddress: `0x${string}`; // raw meta-address (spending pub ‖ viewing pub)
  stealthMetaAddressURI: string; // "st:eth:<meta>" form the SDK takes
  spendingPublicKey: `0x${string}`;
  viewingPublicKey: `0x${string}`;
  spendingPrivateKey: `0x${string}`; // winner-side secret; never leaves the winner's client
  viewingPrivateKey: `0x${string}`;
};

export type StealthDelivery = GenerateStealthAddressReturnType & {
  metadata: `0x${string}`; // ERC-5564 announcement metadata (view tag + asset + amount)
};

// Winner side: one meta-address per winner (rotating per auction is the winner's choice; ERC-6538
// registration binds it to its account if it wants discoverability there).
export function generateStealthMetaAddress(): StealthKeys {
  return generateRandomStealthMetaAddress() as StealthKeys;
}

// The winner's envelope `deliver` (docs/PHASE-5.md R19: `{chain:"evm", kind:"stealth", to:<meta-address>}`)
// carries its ERC-6538 stealth meta-address. Accepts the raw 0x meta-address or the "st:eth:" URI and
// returns the URI the SDK takes; anything else is refused (the field crosses a trust boundary — it comes
// out of an opened envelope, and `envelope/deliver.ts` `requireDeliver` checks it first).
export function deliverMetaAddressURI(deliver: { chain: string; kind: string; to: string }): string {
  if (!deliver || deliver.kind !== "stealth" || typeof deliver.to !== "string") {
    throw new Error(`not an evm/stealth deliver: ${JSON.stringify(deliver)}`);
  }
  const b = deliver.to.trim();
  const uri = b.startsWith("st:") ? b : `st:eth:${b}`;
  // two 33-byte compressed secp256k1 public keys (spending ‖ viewing) = 66 bytes
  if (!/^st:eth:0x[0-9a-fA-F]{132}$/.test(uri)) throw new Error(`not a secp256k1 stealth meta-address: ${deliver.to}`);
  return uri;
}

// R19 item 2: every signer derives the leaf's destination from its own opening of the winner's envelope,
// so the one-time stealth address must be signer-reproducible. The ephemeral private key is a SHA-256
// KDF over the agreed `SHA-256(deliver)` and the settlement coordinates (custom construction, documented
// in docs/AUDITS.md); all curve work and the ERC-5564 derivation itself stay in the pinned ScopeLift SDK.
// One fresh address per (settlement, leaf): different auctions/batches/leaves never reuse an address.
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export function stealthEphemeralPrivateKey(deliverSha256Hex: string, auctionId: Uint8Array, batchIndex: number, leafIndex: number): Uint8Array {
  const be64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
  const digest = createHash("sha256")
    .update(Buffer.from("benzo-stealth-eph-v1"))
    .update(Buffer.from(deliverSha256Hex.replace(/^0x/, ""), "hex"))
    .update(Buffer.from(auctionId)).update(be64(batchIndex)).update(be64(leafIndex))
    .digest();
  const k = BigInt("0x" + digest.toString("hex"));
  if (k === 0n || k >= SECP256K1_N) throw new Error("stealth ephemeral key out of range"); // ~2^-128
  return new Uint8Array(digest);
}

export function deriveSettlementStealthAddress(
  deliver: { chain: string; kind: string; to: string },
  ctx: { deliverSha256Hex: string; auctionId: Uint8Array; batchIndex: number; leafIndex: number; amountWei: bigint },
): { stealthAddress: `0x${string}`; ephemeralPublicKey: `0x${string}`; viewTag: `0x${string}`; metadata: `0x${string}` } {
  const { stealthAddress, ephemeralPublicKey, viewTag } = generateStealthAddress({
    stealthMetaAddressURI: deliverMetaAddressURI(deliver),
    schemeId: SCHEME_ID,
    ephemeralPrivateKey: stealthEphemeralPrivateKey(ctx.deliverSha256Hex, ctx.auctionId, ctx.batchIndex, ctx.leafIndex),
  });
  // the ERC-5564 announcement metadata the release crank publishes on the canonical Announcer:
  // view tag + the delivered amount (public on chain by design §4 — the recipient stays hidden)
  const metadata = buildMetadataForETH({ viewTag, amount: ctx.amountWei });
  return { stealthAddress, ephemeralPublicKey, viewTag, metadata };
}

// Delivery side (the signer builds this from the opened envelope; one fresh address per settlement):
// derive the one-time stealth address and the announcement metadata that names the delivered amount.
// `asset` is the ERC-20 address, or null for the native asset.
export function deriveStealthDelivery(
  meta: { stealthMetaAddressURI: string },
  payment: { asset: `0x${string}` | null; amountWei: bigint },
): StealthDelivery {
  const { stealthAddress, ephemeralPublicKey, viewTag } = generateStealthAddress({
    stealthMetaAddressURI: meta.stealthMetaAddressURI,
    schemeId: SCHEME_ID,
  });
  const metadata = payment.asset === null
    ? buildMetadataForETH({ viewTag, amount: payment.amountWei })
    : buildMetadataForERC20({ viewTag, tokenAddress: payment.asset, amount: payment.amountWei });
  return { stealthAddress, ephemeralPublicKey, viewTag, metadata };
}

// The canonical Announcer call that makes the payment discoverable (EIP-5564 `announce`).
export function prepareAnnouncement(
  clientParams: ClientParams,
  account: EthAddress,
  announcer: EthAddress,
  delivery: Pick<StealthDelivery, "stealthAddress" | "ephemeralPublicKey" | "metadata">,
): Promise<{ to: `0x${string}`; account: `0x${string}`; data: `0x${string}`; value?: bigint }> {
  return prepareAnnounce({
    account,
    ERC5564Address: announcer,
    clientParams: clientParams as never,
    args: { schemeId: SCHEME_ID, stealthAddress: delivery.stealthAddress, ephemeralPublicKey: delivery.ephemeralPublicKey, metadata: delivery.metadata },
  });
}

// The winner's ERC-6538 registration (optional; only for account-level discoverability).
export function prepareRegistration(
  clientParams: ClientParams,
  account: EthAddress,
  registry: EthAddress,
  keys: Pick<StealthKeys, "stealthMetaAddress">,
): Promise<{ to: `0x${string}`; account: `0x${string}`; data: `0x${string}`; value?: bigint }> {
  return prepareRegisterKeys({ account, ERC6538Address: registry, clientParams: clientParams as never, schemeId: SCHEME_ID, stealthMetaAddress: keys.stealthMetaAddress });
}

// Winner side: find this winner's deliveries by scanning announcements with the viewing key (the view
// tag filters first), then prove each candidate really is its own and recover the spending key that
// controls the one-time address.
export async function scanDeliveries(
  clientParams: { publicClient: unknown },
  announcer: EthAddress,
  keys: Pick<StealthKeys, "spendingPublicKey" | "viewingPrivateKey">,
  range: { fromBlock?: bigint | "earliest"; toBlock?: bigint | "latest" },
): Promise<{ announcement: AnnouncementLog; stealthAddress: `0x${string}` }[]> {
  // Beta-SDK defect (recorded in docs/AUDITS.md): the pinned 1.0.0-beta.5 `getAnnouncements` filters
  // logs through viem's positional-array args form, which matches nothing on pinned viem 2.57.1
  // (named-object args match fine — raw getLogs finds the very events it misses). Fetch the logs
  // here with the named-args form; everything cryptographic — getAnnouncementsForUser's
  // checkStealthAddress filter and computeStealthKey — stays in the pinned SDK.
  const ev = ANNOUNCER_ABI.find((i: any) => i.type === "event" && i.name === "Announcement");
  const publicClient = clientParams.publicClient as any;
  const endBlock = range.toBlock === undefined || range.toBlock === "latest"
    ? BigInt(await publicClient.getBlockNumber()) : BigInt(range.toBlock);
  let startBlock = range.fromBlock === undefined || range.fromBlock === "earliest" ? 0n : BigInt(range.fromBlock);
  // public Sepolia endpoints refuse wide log ranges ("exceed maximum block range: 50000") — fetch in
  // bounded chunks, the same reason the SDK wraps its (broken-args) fetcher in fetchLogsInChunks.
  const CHUNK = 20000n;
  const logs: any[] = [];
  for (let start = startBlock; start <= endBlock; start += CHUNK) {
    const end = endBlock < start + CHUNK - 1n ? endBlock : start + CHUNK - 1n;
    logs.push(...await publicClient.getLogs({
      address: announcer, event: ev,
      args: { schemeId: BigInt(SCHEME_ID) },
      fromBlock: start, toBlock: end,
    }));
  }
  const announcements = logs.map((log: any) => ({
    schemeId: log.args.schemeId, stealthAddress: log.args.stealthAddress, caller: log.args.caller,
    ephemeralPubKey: log.args.ephemeralPubKey, metadata: log.args.metadata, ...log,
  })) as AnnouncementLog[];
  const mine = await getAnnouncementsForUser({
    announcements,
    spendingPublicKey: keys.spendingPublicKey,
    viewingPrivateKey: keys.viewingPrivateKey,
  });
  return mine.map((announcement) => {
    const verified = checkStealthAddress({
      userStealthAddress: announcement.stealthAddress,
      viewTag: `0x${announcement.metadata.slice(2, 4)}`,
      ephemeralPublicKey: announcement.ephemeralPubKey,
      spendingPublicKey: keys.spendingPublicKey,
      viewingPrivateKey: keys.viewingPrivateKey,
      schemeId: SCHEME_ID,
    });
    if (!verified) throw new Error(`announcement ${announcement.transactionHash} is not this winner's`);
    return { announcement, stealthAddress: announcement.stealthAddress };
  });
}

// The full winner-side recovery of one delivery: the stealth private key that controls the announced
// one-time address (only the holder of the meta-address keys can compute it).
export function recoverStealthKey(
  keys: Pick<StealthKeys, "spendingPrivateKey" | "viewingPrivateKey">,
  announcement: Pick<AnnouncementLog, "ephemeralPubKey">,
): `0x${string}` {
  return computeStealthKey({
    ephemeralPublicKey: announcement.ephemeralPubKey,
    schemeId: SCHEME_ID,
    spendingPrivateKey: keys.spendingPrivateKey,
    viewingPrivateKey: keys.viewingPrivateKey,
  }) as `0x${string}`;
}
