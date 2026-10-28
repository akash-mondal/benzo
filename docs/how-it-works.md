# How Benzo works

A round from the first sealed bid to the proof anyone can check, one layer at a time.

## A round, from first bid to proof

<p align="center"><img src="assets/lifecycle.svg" alt="A round in six steps: seal and pay, freeze, open at drand round R, clear, settle with 2 of 3 signers, verify." width="100%"></p>

A round has a deadline for bids (`T_submit`), a moment the set of bids is locked (`T_freeze`), and an opening round `R` on the drand beacon. Everything before `R` is sealed. Everything after is public maths that anyone can redo. The rest of this post takes the steps in order.

## 1. Sealing to a moment, not to a person

The usual way to keep a bid secret is to encrypt it to someone's key. That just moves the trust: whoever holds the key can open it early. Benzo encrypts to a **time** instead, using [drand](https://drand.love) and timelock encryption (tlock).

<p align="center"><img src="assets/tlock.svg" alt="tlock: the browser encrypts to drand round R; the key is drand's threshold signature on R, which only exists once round R is published." width="100%"></p>

drand's quicknet network publishes a value every 3 seconds. Each value is a BLS12-381 threshold signature on the round number, produced only when enough independent League of Entropy nodes sign together. tlock is identity-based encryption where the identity is a round number. The browser encrypts the order to "round R" using only drand's public key. The matching decryption key is drand's signature on R, which nobody has until R is published.

Two things follow:

- **There is no key to steal or leak before R.** Not on our server, not on a signer's, not anywhere. Opening a bid early means forging a drand signature, which takes a threshold of drand's operators colluding.
- **Every bid opens at once.** At R the signature is public, so the operator, the signers and every bidder can open every bid at the same instant. Nobody gets a head start.

The sealing runs in your browser ([`seal/src/main.ts`](../seal/src/main.ts)). It makes no network request: drand's chain parameters are pinned in the bundle.

## 2. A sealed bid, byte for byte

<p align="center"><img src="assets/bytes.svg" alt="The 128-byte order is tlock-encrypted and carried in a 512-byte memo: magic, length, ciphertext, envelope tag, zero padding." width="100%"></p>

The order is a fixed 128-byte record ([`envelope/bid.ts`](../envelope/bid.ts)):

- **Price and quantity:** the only fields a market reads.
- **Round or lot id:** binds the order to one round or one lot, so it can't be replayed elsewhere.
- **A random nonce.**
- **A one-time Ed25519 owner key:** lets you prove later that a bid is yours without saying so now.
- **A salted commitment to where your refund goes.**

tlock turns those 128 bytes into an age ciphertext of at most 487 bytes. That ciphertext goes into a Zcash memo with a fixed frame: a 5-byte header (`ff` + `BNZ` + version 2), a 2-byte length, the ciphertext, an 18-byte envelope tag, and zero padding to exactly 512 bytes.

Fixed sizes are the point. Every bid in every round produces a memo of the same length. Nothing about its length says anything about its price.

## 3. Paying a deposit that says nothing

<p align="center"><img src="assets/deposit.svg" alt="Three bids on chain: each a shielded payment of 200,000 zats to its own deposit address with a 512-byte sealed memo. The refund address travels in an envelope sealed to the three signers." width="100%"></p>

Each bid is a **shielded Zcash payment of a fixed deposit** (200,000 zats on the live site) to its own deposit address, with the sealed bid as the memo. Because the amount is the same for everyone, the deposit doesn't hint at the price. Because the payment is shielded, the chain doesn't show who sent it. Every deposit address belongs to the round's vault, a 2-of-3 key the three signers create for this round only (section 6).

Losers get the deposit back and winners pay out of it, so the system needs to know where to send money, without anyone learning it early. Your refund address goes into a **settlement envelope**, encrypted in your browser to the three signers' X25519 keys ([`envelope/index.ts`](../envelope/index.ts)):

- **The body:** your address, padded to a fixed length and encrypted with ChaCha20-Poly1305 under a random content key.
- **The key:** wrapped once per signer with libsodium's sealed box.
- **A key commitment:** stops a sender from giving different signers different addresses.

The envelope is published, and only the three signers can open it: they need your address to check the refunds they sign. The memo's 18-byte envelope tag is a hash prefix of this envelope, so nobody can swap your envelope for theirs.

## 4. Freezing the set before anyone can read it

Sealing stops early reading, but an operator could still cheat on **which** bids count: drop one, or slip one in after peeking at others. Benzo closes that door before `R`.

<p align="center"><img src="assets/freeze.svg" alt="Freeze: the admitted bids become the leaves of a Merkle tree; its root, leaf count, T_freeze and the drand chain that opens the bids are signed by the witnesses before round R." width="100%"></p>

A bid is admitted once its deposit has 10 confirmations and its memo checks out. At `T_freeze`, comfortably before `R`, the admitted bids become the leaves of a Merkle tree ([`clear/merkle.ts`](../clear/merkle.ts)). Each leaf hashes the ciphertext and the deposit that paid for it. The three witnesses sign a statement naming the root, the leaf count, the freeze time and the drand chain that opens the bids ([`witness/index.ts`](../witness/index.ts)).

From that point the set is fixed, and it was fixed while every bid was still unreadable. A witness refuses to sign a second root for the same round, and every witness has to sign, so one dishonest witness can't certify a second set.

What the root can't prove on its own is that every valid bid made it in: an operator could refuse a funded bid before freezing. It can't do so quietly or profitably. Right after the freeze, still before `R`, each bidder can prove their bid is in the root (`benzo receipt prove`), and the site shows it as counted. A deposit that was paid in time but left out is owed back in full: its owner key claims it from the vault, and the verifier requires every deposit the operator listed to be either in the set or refunded. The operator also can't pick whom to drop by price, because when it freezes it can't read any price.

We ran that attack on the live site: the operator dropped a paid bid, the bidder's own page caught it, and the signers refunded the deposit on the bidder's own claim ([evidence](evidence/left-out-bid/)).

## 5. Opening and clearing: six markets, one engine

At `R` anyone can fetch drand's signature, open every frozen bid and apply the market's rule. The rule is public and deterministic, so everyone gets the same fills, the same price and the same refunds.

<p align="center"><img src="assets/markets.svg" alt="Six markets on one engine: uniform auction, collection drop, token launch, buyback, RFQ and blind OTC, each a clearing rule in one registry." width="100%"></p>

Sealing, deposits, freezing and settlement don't know which market they serve. A market is one entry in [`clear/registry.ts`](../clear/registry.ts): an order layout, a clearing rule and a check on its result.

| Market | Who it's for |
|---|---|
| Uniform auction | selling several identical things at one fair price |
| Collection drop | numbered editions, without a race to mint |
| Token launch | a raise with no early-bird front-running |
| Buyback | a treasury buying back without telegraphing its price |
| RFQ | procurement where quotes shouldn't leak to rival dealers |
| Blind OTC | a block trade where neither side shows its hand |

Adding a market means writing a rule, not a new system.

On [benzo.space](https://benzo.space/collection/) the markets sell one demo collection, **Specters**, the way a collection on Zcash actually sells:

- **The mint** is a sealed uniform-price auction: the top bids win and every winner pays one clearing price. It's the format Zilkroad used to sell 8,000 zkSNARKs at 1.5 ZEC, except that here nobody, the operator included, can read a bid early, and anyone can check the result.
- **One-of-ones** go to the highest sealed bid, with no public bid ladder to snipe.
- **Floor buybacks** take holders' sealed asks, lowest first, so nobody front-runs the floor.
- **Private sales** (OTC) and **commissions** (RFQ) cover the rest.

The collection page shows the floor, the sales, the volume and the activity, all from rounds anyone can verify.

## 6. Settling with a key nobody holds alone

The deposits sit in a vault whose spending key is split three ways with FROST, a threshold Schnorr scheme for Zcash. The three signers create it together with a dealerless DKG, once per round. No machine ever holds the whole key. Any two can spend; one can't.

<p align="center"><img src="assets/settle.svg" alt="Settlement: the operator proposes an unsigned transaction; each signer independently opens the bids, re-runs clearing, opens refund envelopes, finds the deposits and checks every output; two of three sign one FROST spend." width="100%"></p>

The operator builds one unsigned Zcash transaction (a PCZT) that pays the winners and sellers and refunds everyone else. It can propose; it can't sign. Each signer then repeats the whole round on its own before it signs anything ([`settle/`](../settle/)):

1. Fetch drand's signature and open every frozen bid.
2. Re-run the market's clearing rule.
3. Open each refund envelope with its own key.
4. Find the deposits on chain itself.
5. Check every output, amount and fee in the proposed transaction against what it computed.

If anything differs, it refuses. Two signers that agree run one FROST signing session, and the vault's notes are spent in an ordinary-looking shielded transaction. If a round has to be called off (say drand never publishes `R`), `benzo cancel` refunds every deposit in full, through the same signers, without opening a single bid.
