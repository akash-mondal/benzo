# Organizer forensics

As of 2026-09-30. Static source inspection and read-only public GET requests; no untrusted code executed, no wallet operations, bids, login challenges, or payments created. Primary site snapshots are current deployments, not authenticated September 15 archives. `confirmed` means the cited source directly contains the statement or code; operator statistics and user reports remain attributed claims, not independent chain audits. `deduced` means the conclusion follows from inspected evidence. Recommendations are separate.

## Factual reconstruction at a glance

The organizer's sale was publicly sealed, but the inspected frontend does not seal valuations from its operator. Registration transmits `{address, quantity, maxBidZec, ack}` to the operator API. This directly reveals the requested price and quantity before funding; shielded transfers protect against chain observers, not the recipient of that HTTP request. The deployed JS is dated September 21, so it is strong evidence of the preserved auction flow rather than an authenticated copy of the September 15 deployment. [Registration code, lines 1733–1742](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733>) · OF011–012, OG001.

| Stage | Reconstructed behavior | Evidence |
|---|---|---|
| Register | Choose shielded recipient, quantity, maximum ZEC per unit; server creates `ZR-BID-…` reference and a unique deposit address. | OF011–014 |
| Fund | Send requested collateral to returned address; recommended memo is the bid code, useful for wrong-address recovery. URI/QR carry payment instructions. Multiple deposits accumulate; partial funding can count fewer units. | OF013–014, OF018 |
| Cross-chain | Server quotes NEAR Intents using bid code, origin asset and source refund destination; swap converts to ZEC. Public source-chain amount remains visible. | OF006, OF019–020, OF039–040 |
| Stand/raise | Three confirmations in current API. Bid can be raised; original remains until increment counts; no lowering/cancellation. Funded raise changes tie priority. | OF016–018 |
| Close/clear | Advertised September 15–17, 16:00 UTC, 48 hours. Rank maximum prices; ties by deposit confirmation block and intra-block order. Fill 8,000 units, including partial final fills; every winner pays lowest winning price. | OF001–003, OF015, OF017 |
| Results/refund | September 17 reported 16,971 bids, 1.5 ZEC clearing, 25,305 ZEC submitted, 13,309 ZEC refunds. ZEC refunds go to bid-associated recipient regardless of origin currency. Swap failures refund on source chain. Current UI retains refunds below 0.0005 ZEC. | OF004, OF020, OF050, OF072 |
| Deliver/reveal | Client describes signed dust memo listing holder serials plus registry/anchored ledger. Organizer offered allocation lookup September 17 and trait reveal/market opening September 18. Public issuer/title-verification schema was not recovered. | OF007, OF021–022, OG004 |

The historical schedule is supported by [saved organizer announcement](https://x.com/zksnarks_/status/2099891030652781036); rules and current payment behavior are supported by the [captured config](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-config-js-v-zr20260920a.js:1>) and [live auction API snapshot](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>). Detailed records below carry exact source lines and saved-post timestamps.

Three quantitative caveats matter. The current API has 3,423 funded records, while social results say 16,971 bids; quantity-weighted counting is plausible but unproven. The published totals differ by four ZEC from 8,000 × 1.5; dust is not a demonstrated explanation. Approximate API timestamps differ from advertised UTC times and appear tip-derived; fixed heights 3,484,406–3,486,706 are the captured authoritative fields, not proof of historical wall-clock execution. There is no independently verified per-bid results CSV or payment audit here. OF005, OF017, OG002–003.

### Current venues and what ownership means

| Venue | Sale and market behavior | Ownership/custody evidence | Operational pain |
|---|---|---|---|
| Zilkroad / zkSNARKs | Multi-unit uniform auction; today fixed asks, funded per-item offers, accept/decline/withdraw, transfers and bulk sweeps. API currently reports 5% royalty and 1,400 listings. | Signed-memo delivery and venue registry are described. Terms assert noncustodial chain-authoritative title, but the required independent ledger/backend proof was not recovered. | Congestion, rotating-address recovery, wrong/missing memo, fee-policy changes, analytics and collection-wide-offer requests. |
| ZecBit / Genesis / Bitfoots | Genesis mint and launchpad payment races; reserved funded offers, mobile memo OTP; 10-confirmation historic delivery. Bitfoots creator fee 10%. | Official custody page explicitly calls current holdings allocation-record commitments pending mainnet ZSAs. Ten demonstrated native assets are **testnet**, distinct from 3,333 catalog entries. Verifier says no assignment snapshot yet. | Wallet import compatibility, RPC outages, double acceptance/listing locks, paid-but-missing items; reported 3,000+ support cases and 475+ venue-side issues. |
| LASTWICK | One public ascending candle per Zcash block, roughly 75 seconds on average; prepaid table or direct memo bids, raffle every tenth. Current market supports funded offers/staking; 5% trading fee, half to stakers. | Public house payment address, server market state and stable pseudonymous owner catalog. No independently inspected native-asset or signed-title schema. | Stuck withdrawal refunds; needs announced launchpad candle, sealed and fixed-price modes. |
| ShieldBid | Shielded ZEC escrow-as-bid, uniform clearing and refunds; checked-in three-bid mainnet demo. | Spec expressly lets seller decrypt from first block and control escrow; asset delivery is out of scope. Generic CLI and demo contain important spec/verification gaps. | Provides a narrow payment demo, not operator blindness or venue settlement. |
| ZEC BLOCKS | Work claims plus application ownership events; direct-seller ZEC path, legacy signed-lock/transparent-output path and Base-USDC integration. | A concrete ownership overlay, not ZSA issuance. Client contains deliberately permanent public address-to-NFT bindings. | Recovery journals guard against repeat payment; API settlement and public linkage need separate review. |

Venue evidence: [Zilkroad market client](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2690>), [ZecBit custody/verifier snapshot](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:18>), [LASTWICK room code](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:374>), [ShieldBid spec at pinned commit](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L125), and [ZEC BLOCKS settlement code](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:2035>). OF023–078 provide individual substantiation.

The September 23 saved request for sales activity and bidding has no reliable reply target; it cannot be assigned confidently to Zilkroad. The organizer's September 23 video concerns royalty-funded buybacks. Separately, a September 21 user explicitly asked Zilkroad for analytics and collection-wide bids. Current code already has funded per-item bids. Treat these as different pieces of evidence, not a missing-bids narrative. OF051, OF066–069, OG006.


## Facts and evidence

### organizer auction

**OF001 · confirmed.** Organizer announced auction opening September 15 2026 at 16:00 UTC, 48-hour window, close September 17 12:00 ET / 16:00 UTC, 8,000 available units, top 8,000 bids win, every winner pays lowest winning price.

Sources: [saved-x-extract.jsonl:274](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:274>); [public source](https://x.com/zksnarks_/status/2099891030652781036).

**OF002 · confirmed.** Bidders chose quantity and maximum price per zkSNARK; winner surplus refunded, non-winning bids fully refunded.

Sources: [saved-x-extract.jsonl:272](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:272>); [public source](https://x.com/zksnarks_/status/2100262503120830539).

**OF003 · confirmed.** Existing bids could be reviewed or raised before closing; organizer warned to allow confirmation time and avoid final-hour changes.

Sources: [saved-x-extract.jsonl:270](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:270>); [public source](https://x.com/zksnarks_/status/2100518836978233375).

**OF004 · confirmed.** Official results published September 17 at 16:19 UTC: 16,971 bids, 8,000 allocations, 1.5 ZEC price, 25,305 ZEC submitted volume, 13,309 ZEC refunds due; automatic refunds promised within 24 hours.

Sources: [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799).

**OF005 · deduced.** At 8,000 units times 1.5 ZEC, gross sale proceeds are 12,000 ZEC. Published submitted volume minus refunds is 11,996 ZEC, leaving a 4 ZEC reconciliation difference; its cause is not established.

Sources: [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799).

**OF006 · confirmed.** Organizer integrated NEAR Intents so users could bid in other currencies converted automatically to ZEC.

Sources: [saved-x-extract.jsonl:273](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:273>); [public source](https://x.com/zksnarks_/status/2099903268369420714).

**OF007 · confirmed.** Organizer offered allocation lookup and reveal_zksnarks command September 17; said traits stayed hidden until market opening September 18.

Sources: [saved-x-extract.jsonl:32](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:32>); [public source](https://x.com/zksnarks_/status/2100641884594950283).

### marketplace operations

**OF008 · confirmed.** Organizer acknowledged heavy marketplace congestion September 19 01:47 UTC and announced increased capacity at 02:20 UTC.

Sources: [saved-x-extract.jsonl:29](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:29>); [public source](https://x.com/zksnarks_/status/2101126107550376319); [saved-x-extract.jsonl:28](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:28>); [public source](https://x.com/zksnarks_/status/2101134229811634285).

### marketplace recovery

**OF009 · confirmed.** Organizer shipped a login recovery fix September 21 for rotating shielded addresses, instructing users to recover their Bid Code.

Sources: [saved-x-extract.jsonl:278](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:278>); [public source](https://x.com/zksnarks_/status/2102039266750566615).

### marketplace

**OF010 · confirmed.** Zilkroad public marketplace instructions require a shielded recipient address, exact ZEC memo, payment before deadline, and Transaction Sent tracking; funded buy completes automatically, funded bid becomes seller-acceptable offer.

Sources: [https-zilkroad-com.html:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com.html:1>); [public source](https://zilkroad.com).

### Auction registration and operator visibility

**OF011 · confirmed.** submitBid sends {address, quantity, maxBidZec, ack} as plaintext JSON to POST /api/bids. The current deployed client encrypts none of those fields before transmission. The server returns a bid code only on HTTP 201.

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733–1755](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

**OF012 · deduced.** The operator can learn requested bid price, quantity and recipient address at registration, before funding or close. Shielded chain privacy does not conceal information explicitly supplied to the auction API.

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733–1742](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

### Auction funding and memo

**OF013 · confirmed.** The auction response supplies depositAddress, payAmountZec, payUri and optional transparent address; the UI labels the receive address unique to the bid. The shielded deposit memo is the bid code and is recommended for recovering a deposit sent to the wrong address.

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3295–3302](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3295>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3478–3482](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3478>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

**OF014 · confirmed.** A bid is specified as quantity and maximum ZEC per unit, up to 8 decimal places. Quantity cannot exceed supply. The current API overrides placeholder client minimum 0.25 with minimumBidZec 0.10000000.

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:1666–1677](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:1666>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:32–38](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:32>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction).

### Auction ranking and amendments

**OF015 · confirmed.** Published rules rank bids by maximum price; ties use confirmation block then order within that block, earlier first. A bid can partially fill when remaining supply is smaller than requested quantity, with balance refunded. These are declared rules; backend implementation was not publicly available.

Sources: [https-zilkroad-com-mint-config-js-v-zr20260920a.js:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-config-js-v-zr20260920a.js:1>); [public source](https://zilkroad.com/mint/config.js?v=zr20260920a).

**OF016 · confirmed.** The deployed client raises via POST /api/bids/{code}/raise with {quantity,maxBidZec}. UI says a funded raise moves its tie position to the funding block; original bid stands until the increment is counted; raising cannot be undone, lowered or cancelled.

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:2308](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:2308>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3408–3410](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3408>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-config-js-v-zr20260920a.js:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-config-js-v-zr20260920a.js:1>); [public source](https://zilkroad.com/mint/config.js?v=zr20260920a).

### Auction confirmations and timing

**OF017 · confirmed.** Live API sets openHeight 3484406, closeHeight 3486706, three required confirmations, result window 24h, refund window 48h and refundDustZec 0.00050000. These current config values differ from social announcements promising refunds in 24h.

Sources: [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction); [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799).

**OF018 · confirmed.** The client distinguishes seen/unconfirmed, partially funded, funded, pending raise, failed swap and void at close. It says multiple deposits add up; partially funded bids can stand for floor(countedZec / maxBidZec) units; do not pay again while a deposit confirms.

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3374–3410](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3374>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

### Cross-chain funding and privacy

**OF019 · confirmed.** The official auction config warns that paying with another coin publishes the bid amount. It offers an alternative: swap into the bidder own Zcash wallet, shield funds, then bid. This contradicts descriptions that imply the entire cross-chain bid path is invisible.

Sources: [https-zilkroad-com-mint-config-js-v-zr20260920a.js:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-config-js-v-zr20260920a.js:1>); [public source](https://zilkroad.com/mint/config.js?v=zr20260920a).

**OF020 · confirmed.** A bridge quote request supplies bid code, originAsset and source-chain refundTo. Auction refunds go in ZEC to the supplied shielded recipient address; bridge failures return source assets on their original chain because they never became auction bids.

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3885](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3885>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-config-js-v-zr20260920a.js:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-config-js-v-zr20260920a.js:1>); [public source](https://zilkroad.com/mint/config.js?v=zr20260920a).

**OF039 · reported.** crypto.news reports Aurora routed just over $19M via 1,718 swaps, over half of submitted auction volume by value; USDC was 27% and ETH 21% of routed volume. Swap count is not bid count or completed sale count.

Sources: [https-crypto-news-aurora-intents-routed-19m-into-zcash-nft-auction.html:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-crypto-news-aurora-intents-routed-19m-into-zcash-nft-auction.html:1>); [public source](https://crypto.news/aurora-intents-routed-19m-into-zcash-nft-auction/).

**OF040 · reported.** Aurora CEO explained quoted minimum ZEC output and source spend ceiling approved before signing, solver competition, failure rather than worse execution, and source-chain refunds. Source transfers remain public; contract, bridge and liquidity-provider dependencies remain.

Sources: [https-crypto-news-aurora-intents-routed-19m-into-zcash-nft-auction.html:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-crypto-news-aurora-intents-routed-19m-into-zcash-nft-auction.html:1>); [public source](https://crypto.news/aurora-intents-routed-19m-into-zcash-nft-auction/).

### Results and ownership delivery

**OF021 · deduced.** API publishes seed commitment, seed preimage, close-block hash, settlement seed, results CSV hash, Snarklist hashes and delivery/reveal timestamps. rulesHash and rulesAnchorTxid are null. Published commitments alone do not prove bid-set completeness or correct clearing.

Sources: [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction).

**OF022 · confirmed.** The client describes delivery as one signed memo dust transaction per holder, listing owned serials, backed by a registry and Zcash-anchored ledger. It reads bid result {filledQuantity,chargedZec,refundZec,dustRetainedZec,rankIndex} from the server, not a native NFT smart contract.

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3348–3352](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3348>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

### Marketplace offers and settlement

**OF023 · confirmed.** Secondary offers send {token,bidderAddress,amountZec} to POST /api/market/offers and publish standing bid amounts. An offer must beat the standing bid under the UI guard unless updating an existing offer; it is a funded purchase the holder can accept at any time.

Sources: [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2830–2843](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2830>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1330–1335](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1330>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e).

**OF024 · confirmed.** The secondary ZEC payment panel instructs exact amount, deposit address and memo equal to the payment code. This differs from the auction unique-address panel where the memo is recommended.

Sources: [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2386](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2386>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3482](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3482>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

**OF025 · confirmed.** Withdrawal uses POST /api/market/offers/{code}/withdraw; the client accepts awaiting_deposit and active offers but refuses already accepted/completed/declined offers. Seller accept re-reads best offer and posts minAmountZec to prevent a lower-than-shown sale.

Sources: [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2880–2900](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2880>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2968–2981](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2968>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e).

**OF028 · confirmed.** Sellers can list/change/cancel asking price, accept or decline bids, and transfer unlisted items if wallet.canTransfer is true. Acceptance keeps other open bids for the new holder. Decline queues paid-bid refunds; partial/unconfirmed offers remain open.

Sources: [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1315–1345](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1315>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2790](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2790>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e).

### Marketplace recovery

**OF026 · confirmed.** Login starts by shielded address or bid/order/sweep code, then completes with challengeId and memo-delivered OTP. This is proof of ability to decrypt a memo sent to a known address, not recovery by merely pasting a fresh rotated address.

Sources: [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1888–1938](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1888>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [saved-x-extract.jsonl:278](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:278>); [public source](https://x.com/zksnarks_/status/2102039266750566615).

**OF079 · confirmed.** Auction-result client POSTs only {address} to /api/auction/wallet and renders returned serials/traits. That function supplies no signature or OTP. This establishes an address-based lookup surface in the client, not proof of which unauthenticated requests the unpublished server permits; no other holder address was probed.

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:4746–4778](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:4746>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

### Marketplace fees

**OF027 · confirmed.** HTML FAQ still says every sale pays 5% royalty, whereas client fetches royaltyBps dynamically from /api/market/listings and calculates seller proceeds. The live fee must be checked against API rather than assumed from static copy.

Sources: [https-zilkroad-com.html:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com.html:1>); [public source](https://zilkroad.com); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2922–2937](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2922>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e).

**OF036 · confirmed.** The live listings API reports royaltyBps 500 (5%) and 1,400 listings in this snapshot, corroborating the static FAQ. A September 20 community post claimed fees were being removed; that historical assertion cannot establish today fee configuration.

Sources: [https-zilkroad-com-api-market-listings.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-market-listings.json:1>); [public source](https://zilkroad.com/api/market/listings); [saved-x-extract.jsonl:98](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:98>); [public source](https://x.com/just4rxxy/status/2101550059162620233).

### Marketplace public snapshot

**OF029 · confirmed.** At the captured API update 2026-09-30T08:57:22.916Z: floor 0.678 ZEC, minimum offer 0.3395 ZEC, 55 reported sales and 45.9323 ZEC volume in 24h; 4,410 total reported sales and 5,837.16387299 ZEC total volume. Operator-reported and mutable; not independently chain-audited.

Sources: [https-zilkroad-com-api-market-stats.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-market-stats.json:1>); [public source](https://zilkroad.com/api/market/stats).

### User reports and operator operations

**OF030 · confirmed.** A user reports accidentally sending 0.3 ZEC to Zilkroad without a memo; after supplying the memo, the money was returned. Organizer replied Returned. This is an attributed successful manual-recovery report.

Sources: [saved-x-extract.jsonl:180](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:180>); [public source](https://x.com/umbasxbt/status/2104273825256882331).

**OF031 · confirmed.** ZecBit said its September 8 rebuilt offers are backed by reserved ZEC, prevent double payments, move Pending on broadcast, track confirmations live, become active after confirmation, and refund cancellation less network fees.

Sources: [saved-x-extract.jsonl:198](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:198>); [public source](https://x.com/zec_bit/status/2097331067489227106).

**OF032 · confirmed.** ZecBit reported on September 27 that it reviewed over 3,000 support cases, resolved over 475 ZecBit-side issues, and completed associated refunds and NFT airdrops. It cited wallet integrations, RPC interruptions, delayed confirmations and marketplace issues; paid-order support remained open.

Sources: [saved-x-extract.jsonl:51](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:51>); [public source](https://x.com/zec_bit/status/2104316752201187461).

**OF033 · confirmed.** A ZecBit user says a failed paid transaction remained unresolved despite supplying TXIDs and wallet details, then was fully refunded and received an NFT after founder review. The user prioritized refunds and unresolved cases over new features.

Sources: [saved-x-extract.jsonl:36](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:36>); [public source](https://x.com/NafterG/status/2104319488594457018).

**OF034 · confirmed.** LASTWICK acknowledged September 24 that post-auction withdrawal requests had been stuck; said the fix sent waiting payments and remaining table funds could be withdrawn to the bidding wallet.

Sources: [saved-x-extract.jsonl:325](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:325>); [public source](https://x.com/wickonzec/status/2103140814360633807).

### LASTWICK product direction

**OF035 · confirmed.** LASTWICK announced 999/999 completion September 23, planned airdrop to paddle addresses, marketplace, half of trading fees for stakers, and launchpad modes: candle auction, sealed auction with unsuccessful-bid returns, and fixed-price mint.

Sources: [saved-x-extract.jsonl:328](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:328>); [public source](https://x.com/wickonzec/status/2102750638782263803).

**OF049 · confirmed.** LASTWICK current public house API exposes unified deposit address, payKinds table/direct, one burn block, 0.001 ZEC minimum step, raffleEvery 10, startHeight 3492440, and 999 settled lots. Viewing key is null. This records the house deposit address without creating any payment.

Sources: [https-bid-lastwick-xyz-api-state.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-api-state.json:1>); [public source](https://bid.lastwick.xyz/api/state).

### Marketplace ownership and custody

**OF037 · confirmed.** Zilkroad terms claim direct wallet-to-wallet settlement, no escrow, no ability to move assets or funds, chain-authoritative ownership and survival if the site disappears. Those are site assertions; inspected client checkout actually creates server orders/offers, accepts deposits, and queues refunds. Backend and independent asset-transfer proofs were not available to establish the custody claim.

Sources: [https-zilkroad-com.html:439–464](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com.html:439>); [public source](https://zilkroad.com); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2841](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2841>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

**OF038 · confirmed.** Zilkroad public token API exposes serial, image, traits, rarity, ask, bid, reservation and last-sale data; sample token owner and bidder are null. Browser receives a public catalog, while private holdings are managed through authenticated marketplace APIs.

Sources: [https-zilkroad-com-api-market-tokens.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-market-tokens.json:1>); [public source](https://zilkroad.com/api/market/tokens); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1922](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1922>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e).

**OF075 · reported.** ZScan explicitly labels zkSNARK ownership as marketplace records and says it cannot verify ownership. The Onchain Diary September 19 analysis reaches a similar server-index conclusion. This corroborates the registry reading but is not an independent audit of the unpublished backend or anchored ledger.

Sources: [exa-other-sales.md:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-other-sales.md:1>); [public source](https://zscan.cash/collection/zksnarks); [exa-news-ownership.md:60](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-news-ownership.md:60>); [public source](https://theonchaindiary.com/articles/zksnarks-auction-what-bidders-bought/).

### News corroboration and discrepancies

**OF041 · confirmed.** CryptoBriefing September 17 corroborates 48h sale ending 12:00 ET September 17 and uniform 1.5 ZEC clearing. AirdropAlert says results landed September 18, contradicted by the saved organizer results post timestamp September 17 16:19 UTC. Prefer the organizer timestamp.

Sources: [exa-news-ownership.md:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-news-ownership.md:1>); [public source](https://cryptobriefing.com/zksnarks-auction-clears-zcash-blind-bids/); [https-airdropalert-com-blogs-zksnarks-nft-zcash-blind-auction.html:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-airdropalert-com-blogs-zksnarks-nft-zcash-blind-auction.html:1>); [public source](https://airdropalert.com/blogs/zksnarks-nft-zcash-blind-auction/); [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799).

**OF042 · reported.** CoinQm repeats the Aurora routing figures and distinguishes swapped value from bids or NFT purchases; it adds that 1,000 units were early Snarklist allocation and 1,000 were reserved for grants, contributors, artists and team. It is secondary coverage, not an independent payment audit.

Sources: [https-en-coinqm-com-news-319493-html.html:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-en-coinqm-com-news-319493-html.html:1>); [public source](https://en.coinqm.com/news/319493.html).

### LASTWICK candle mechanism

**OF043 · confirmed.** LASTWICK sells one Ember per Zcash block; the highest standing bid wins when next block arrives. About 75 seconds is an average, not a fixed 75-second timer or a retrospectively randomized endpoint.

Sources: [https-lastwick-xyz.html:316](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-lastwick-xyz.html:316>); [public source](https://lastwick.xyz); [https-bid-lastwick-xyz-room-js-v-140c653867.js:122–125](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:122>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867).

**OF044 · confirmed.** LASTWICK supports prepaid table balances for instant API bids and direct wallet payments. Table bid posts plaintext zec; direct bid sends shielded payment with memo LASTWICK BID <paddle> <lotId> then posts amount and txid. Amounts and bidder pseudonyms are in the public live room.

Sources: [https-bid-lastwick-xyz-room-js-v-140c653867.js:410–426](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:410>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867); [https-bid-lastwick-xyz-room-js-v-140c653867.js:118–123](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:118>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867).

**OF045 · confirmed.** Table funding uses shielded payment memo LASTWICK PADDLE <paddle>. Outbid table funds return immediately; direct payments received too late or outbid credit the table after confirmation. Manual funding uses ZIP-321 URI with base64url memo.

Sources: [https-bid-lastwick-xyz-room-js-v-140c653867.js:374–381](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:374>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867); [https-bid-lastwick-xyz-room-js-v-140c653867.js:715–726](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:715>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867); [https-bid-lastwick-xyz-room-js-v-140c653867.js:762](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:762>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867).

**OF046 · confirmed.** Every tenth candle is a whitelist raffle; turning candles earns tickets and unspent tickets carry forward. If no one bids, a wick-turner may receive a free candle. Captured API includes raffle winners drawnBy drand, revealed secrets and outBlock hashes; backend randomness verification is uninspected.

Sources: [https-lastwick-xyz.html:369–371](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-lastwick-xyz.html:369>); [public source](https://lastwick.xyz); [https-bid-lastwick-xyz-api-state.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-api-state.json:1>); [public source](https://bid.lastwick.xyz/api/state).

### LASTWICK marketplace

**OF047 · confirmed.** Market client supports list, unlist, buy, funded offer, withdraw offer, accept, stake, unstake and reward claim. Server returns payment instructions; state change follows payment confirmation. Buyer pays the house; late or short buy payments are refunded. Custody-free wording in code comments does not establish trustless settlement.

Sources: [https-market-lastwick-xyz-market-js-v-c48fcc27fd.js:212–248](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-market-js-v-c48fcc27fd.js:212>); [public source](https://market.lastwick.xyz/market.js?v=c48fcc27fd); [https-market-lastwick-xyz-market-js-v-c48fcc27fd.js:256–315](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-market-js-v-c48fcc27fd.js:256>); [public source](https://market.lastwick.xyz/market.js?v=c48fcc27fd).

**OF048 · confirmed.** Public API snapshot: supply 999, owners 199, 114 listed, 14 sales, volume 3234000 zatoshi (0.03234 ZEC), feeBp 500 (5%), rewardBp 5000 (50%), actionFee 30000 zatoshi (0.0003 ZEC), reserveMs 1200000 (20 min), minPayout 1000000 zatoshi (0.01 ZEC). Catalog exposes stable pseudonymous owner IDs; Zcash shielding does not hide that application ownership graph.

Sources: [https-market-lastwick-xyz-api-state.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-api-state.json:1>); [public source](https://market.lastwick.xyz/api/state); [https-market-lastwick-xyz-api-catalogue.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-api-catalogue.json:1>); [public source](https://market.lastwick.xyz/api/catalogue).

### Refund completion and fee timeline

**OF050 · reported.** Official REFUNDS_COMPLETE post says all 13,309 ZEC were sent automatically to bid-associated Zcash addresses, nothing to claim. This confirms the operator report of completion, not independent verification of every recipient.

Sources: [saved-x-official-extract.jsonl:3](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:3>); [public source](https://x.com/zksnarks_/status/2100739280423326156).

**OF051 · confirmed.** On September 19 the organizer explicitly announced 0% zkSNARK royalties and 0% marketplace fees, with accrued royalties pledged to builder grants. On September 23 Zilkroad posted a video depicting requests to restore royalties and fund buybacks; today API reports 5%. These dated records show policy evolution rather than a reliable permanent 0% fee.

Sources: [saved-x-official-extract.jsonl:2](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:2>); [public source](https://x.com/zksnarks_/status/2101321484366917895); [sep23-zilkroad-update.mp4:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/sep23-zilkroad-update.mp4:1>); [public source](https://x.com/zilkroad_/status/2102878005479845940); [sep23-zilkroad-update-frames.png:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/sep23-zilkroad-update-frames.png:1>); [https-zilkroad-com-api-market-listings.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-market-listings.json:1>); [public source](https://zilkroad.com/api/market/listings).

### ZecBit asset model

**OF052 · confirmed.** ZecBit custody disclosure says payments briefly pass through venue-controlled addresses, one per trade, about a block. Until mainnet ZSA activation, holdings are commitments in allocation records; unauthorized changes are detectable rather than consensus-impossible. Royalties are venue-applied, and unmatched memoless shielded deposits cannot be returned without additional information.

Sources: [exa-zecbit-custody-forum.json.md:18–50](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:18>); [public source](https://zecbit.net/custody).

**OF053 · reported.** The grant documents ten finalized supply-one assets on the public ZSA testnet, txid 611ddfd4459e813b86b935fc05217f929e29c37cdc96ba8f23fc647e30c26317 at height 251. Minimal descriptors are zmd1|zecbit-genesis|<index>; full form adds CID/content hash. Maintainer clarified metadata integrity does not authenticate issuer and mainnet identity preservation is not guaranteed while ZIPs remain Draft.

Sources: [https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:406–413](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:406>); [public source](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/409); [https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409-comments.json.md:54–56](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409-comments.json.md:54>); [public source](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/409).

**OF054 · reported.** Grant describes incoming-viewing-key trial decryption, memo-tag payment matching, confirmation/reorg-safe reconciliation and unmatched-payment review; signature-based authentication was working with Noir. These are applicant claims and intended open-source deliverables, not inspected released backend source.

Sources: [https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:115–157](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:115>); [public source](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/409).

**OF055 · confirmed.** ZecBit verifier describes anchored assignment summaries and portable holder certificates for independence from the venue, but currently states no snapshot has been published. Its issuance demonstration proves testnet asset identity; it does not establish a mainnet native NFT or current ownership.

Sources: [exa-zecbit-custody-forum.json.md:85–117](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:85>); [public source](https://zecbit.net/verify).

### ZecBit product and Genesis

**OF056 · confirmed.** Captured homepage labels Genesis supply 3,333 but only ten on-chain items and network ZSA; grant separately identifies ten testnet assets. Catalog supply and actual on-chain issuance must be kept separate.

Sources: [https-zecbit-net.html:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecbit-net.html:1>); [public source](https://zecbit.net); [https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:406–409](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:406>); [public source](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/409).

**OF057 · confirmed.** September 23 ZecBit mobile flow uses Sign in with a code without Noir extension. Secondary listings are not reserved: first confirmed payment wins, later payments refund. First offer/bid deposit must be at least 0.01 ZEC; under-minimum deposits refund. No deposit seen within 20 minutes after I have sent it removes the bid; later arrivals refund.

Sources: [saved-x-sep23-requests.jsonl:3](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:3>); [public source](https://x.com/zec_bit/status/2102729343776497794); [saved-x-sep23-requests.jsonl:4](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:4>); [public source](https://x.com/zec_bit/status/2102729379642245357); [saved-x-sep23-requests.jsonl:5](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:5>); [public source](https://x.com/zec_bit/status/2102729383446221048).

**OF058 · confirmed.** September 23 ZecBit announced mint fee reduced to 0.00123 ZEC and rebuilt mint flow for speed/cost. Earlier official posts asked minters to keep $10+ for issuance/network fees; reported free Genesis mint was not zero-cost participation.

Sources: [saved-x-official-extract.jsonl:18](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:18>); [public source](https://x.com/zec_bit/status/2102752342286418116); [saved-x-official-extract.jsonl:45](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:45>); [public source](https://x.com/zec_bit/status/2095478478070030808).

**OF059 · reported.** ZecBit September 4 marketplace 1.1 update reported buyer race fixes, listing unlock fixes, account security, refund security, multi-address support, double-accept prevention and repayments to sellers whose item moved without payment.

Sources: [saved-x-official-extract.jsonl:35](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:35>); [public source](https://x.com/zec_bit/status/2095935132557324416).

**OF070 · confirmed.** Genesis announced September 3 GTD 20:00 UTC, WL 20:30 UTC, 1 per wallet, desktop Noir launch and 10-confirmation delivery (~12 min). A two-hour delay was attributed to 12/24-word import compatibility; eligibility could move to an approved new u1 address. This was an account-and-payment mint, distinct from sealed-price clearing.

Sources: [saved-x-official-extract.jsonl:43](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:43>); [public source](https://x.com/zec_bit/status/2095598808814031309); [saved-x-official-extract.jsonl:44](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:44>); [public source](https://x.com/zec_bit/status/2095571400132108340).

**OF071 · confirmed.** September 15 Launchpad V2 announcement says reservation begins only when backend detects payment, then waits ten confirmations; final-item races choose earliest valid payment and refund later ones. Historical reservation policy changed, so September 3 guidance should not be assumed current.

Sources: [saved-x-official-extract.jsonl:25](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:25>); [public source](https://x.com/zec_bit/status/2099933446818951317).

### ZecBit funding context

**OF060 · confirmed.** ZCG September 4 committee response declined the ZecBit grant proposal. No mainnet activation or native asset deployment follows from the grant application.

Sources: [exa-zecbit-custody-forum.json.md:67–70](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:67>); [public source](https://forum.zcashcommunity.com/t/grant-proposal-zecbit-nft-infrastructure-for-zcash-shielded-assets/57280/61).

### ShieldBid code and trust model

**OF061 · confirmed.** ShieldBid v0.2 spec defines shielded transfer amount as fully escrowed bid to seller UA, uniform lowest-winning price, deadline-height filtering and shielded refunds; memo is optional decoration. Seller controls escrow and can decrypt bids from first block; asset settlement is explicitly out of scope.

Sources: [SPEC.md:10–35](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:10>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L10); [SPEC.md:125–143](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:125>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L125).

**OF062 · reported.** Repository reports three-bid mainnet demo closed September 28 height 3499452, two slots, 0.003 reserve, bids 0.012/0.009/0.004 and clearing 0.009 ZEC. Report and receipts are checked-in author evidence, not an independent chain verification performed here.

Sources: [DEMO_01_REPORT.md:7–23](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/DEMO_01_REPORT.md:7>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/DEMO_01_REPORT.md#L7).

**OF063 · confirmed.** Generic ShieldBid CLI still parses bid amounts from memos and commits memo hashes, unlike v0.2 escrow-as-bid spec. Deadline filtering only happens if both cutoff and note height are present; reveal does not require commitment file. Static code inspection establishes this implementation/spec mismatch.

Sources: [shieldbid.py:195–208](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/shieldbid.py:195>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/shieldbid.py#L195); [shieldbid.py:221–242](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/shieldbid.py:221>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/shieldbid.py#L221).

**OF064 · deduced.** ShieldBid demo close ranks local ledger bids after reading wallet totals; it does not authenticate each ledger amount against received notes in that function. Refund destinations are bidder-label-selected account 2 or a private supplied buyer address. Shielded recipient cannot generally recover sender address from a note.

Sources: [demo_01_run.py:188–205](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/demo_01_run.py:188>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/demo_01_run.py#L188); [demo_01_run.py:115–125](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/demo_01_run.py:115>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/demo_01_run.py#L115); [demo_01_run.py:257–273](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/demo_01_run.py:257>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/demo_01_run.py#L257).

**OF065 · reported.** ShieldBid demo reports wallet engine returned null Orchard memos and required account sync between successive outbound payments. These are specific engine observations, not limitations of the Zcash encrypted-memo protocol itself.

Sources: [DEMO_01_REPORT.md:59–67](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/DEMO_01_REPORT.md:59>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/DEMO_01_REPORT.md#L59).

### Bid-feature requests

**OF066 · confirmed.** September 23 saved user post requests a visible sales-activity tab and a bidding feature. Its saved public-mirror record has no reply target, so attributing that exact request to Zilkroad specifically is unproven.

Sources: [saved-x-sep23-requests.jsonl:28](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:28>); [public source](https://x.com/LiteT0NY/status/2102794337675345989).

**OF067 · confirmed.** September 21 user explicitly requested Zilkroad analytics, floor/depth/listing/holder history, sorting sale listings by creation time and collection-wide bids. These are user desires rather than commitments or evidence that all are still absent.

Sources: [saved-x-extract.jsonl:158](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:158>); [public source](https://x.com/pnlmaxxing/status/2102106843971506498).

**OF068 · deduced.** Current Zilkroad secondary bidding already supports funded per-item offers, withdrawal, seller acceptance and decline. A historical bid-feature request is not evidence that today marketplace lacks bids. Collection-wide sealed launch auctions and ordinary visible per-item offers are different features.

Sources: [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2830–2900](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2830>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [saved-x-sep23-requests.jsonl:28](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:28>); [public source](https://x.com/LiteT0NY/status/2102794337675345989).

**OF069 · reported.** September 23 users asked for paid-but-missing-item refunds and faster site capacity; another asked to add collections to ZecBit. These posts establish support and integration demand, not proof every allegation is accurate.

Sources: [saved-x-sep23-requests.jsonl:61](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:61>); [public source](https://x.com/friendtechLFG/status/2102729996057858269); [saved-x-sep23-requests.jsonl:60](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:60>); [public source](https://x.com/shahriyar1798/status/2102746227297435856); [resume-mirror-round2-nft-features-02.json:1](</Users/akshmnd/Dev Projects/zcash/research/raw/zcash-x-pulse/resume-mirror-round2-nft-features-02.json:1>); [public source](https://x.com/Zecoshi/status/2102863847279247391).

### Auction refund dust

**OF072 · confirmed.** The deployed auction explicitly retains refunds below 0.0005 ZEC, sends refunds in batches and says fees on us. Therefore full-refund wording has a documented dust exception. The observed 4 ZEC aggregate arithmetic gap cannot be conclusively attributed to dust without per-bid reconciliation.

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:4899](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:4899>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction).

### Other sale mechanisms

**OF073 · confirmed.** Bitfoots on ZecBit shows 303 items, 10% creator fee, funded offers and fixed asks; snapshot reports 87 listings, 162 sales and 16.38 ZEC venue-settled volume. Its on-chain label does not by itself identify mainnet native issuance; ZecBit custody disclosure defines current allocation-record holdings.

Sources: [exa-other-sales.md:280](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-other-sales.md:280>); [public source](https://zecbit.net/collection/bitfoots); [exa-zecbit-custody-forum.json.md:44](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:44>); [public source](https://zecbit.net/custody).

**OF074 · reported.** ZEC BLOCKS site describes ZB-1 as an application protocol whose ownership is reconstructed from anchored Zcash events and signed listing intents. It offers SHA-256 work claims, native ZEC direct-seller checkout and ZB-20 ZECS trading with either native ZEC or Base USDC settlement. These are declared overlay mechanisms, not evidence of ZSA deployment.

Sources: [exa-other-sales.md:417](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-other-sales.md:417>); [public source](https://zecblocks.xyz).

**OF077 · confirmed.** ZEC BLOCKS client parses ZB1 CLAIM/TRANSFER/ATOMIC_LOCK memo events into application ownership, verifies seller signatures and a deterministic transparent lock anchor, and verifies exact transparent seller/fee outputs for its legacy atomic path. Its current direct-buy path signs an API reservation, sends a shielded-source payment to the returned seller address, persists recovery data and submits txid to the backend. These are distinct settlement paths; atomic terminology alone does not establish consensus-enforced NFT delivery.

Sources: [https-zecblocks-xyz-script.js:1113](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:1113>); [public source](https://zecblocks.xyz/script.js?v=marketplace-claim-progress-removed); [https-zecblocks-xyz-script.js:3140–3220](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:3140>); [https-zecblocks-xyz-script.js:2035–2092](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:2035>).

**OF078 · deduced.** ZEC BLOCKS receiving-address identity module validates mainnet t1 addresses and verifies signatures from both address and NFT keys over an explicitly public, permanent address-to-owner link. Its listing-fee path uses transparent funding for 0.0002 ZEC plus network fee. This is a concrete ownership-overlay example with deliberate public linkage.

**Judgment:** Do not copy this permanent public identity binding unchanged into an auction claiming participant privacy.

Sources: [https-zecblocks-xyz-address-identity.js:16–53](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-address-identity.js:16>); [public source](https://zecblocks.xyz/address-identity.js?v=simple-transactions); [https-zecblocks-xyz-script.js:1830–1839](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:1830>).

### Auction volume and capacity

**OF076 · deduced.** Using the public 16,971-bid count over 48h gives 353.56 bids/hour and 0.09821 bids/second average; at 75 seconds per block, about 7.37 bid units per block. This is an arithmetic planning baseline, not a measured request rate, unique bidder count, or transaction count.

Sources: [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799); [saved-x-extract.jsonl:274](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:274>); [public source](https://x.com/zksnarks_/status/2099891030652781036).

### Funding addresses

**OF080 · confirmed.** LASTWICK public auction house.address and marketplace house.address are the same unified address: [redacted address 10c4e8763c]. Zilkroad current auction config depositAddr is null; each bid registration response supplies its own depositAddress. A historical per-bid address was not recovered, and no new bid was created to obtain one.

Sources: [https-bid-lastwick-xyz-api-state.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-api-state.json:1>); [public source](https://bid.lastwick.xyz/api/state); [https-market-lastwick-xyz-api-state.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-api-state.json:1>); [public source](https://market.lastwick.xyz/api/state); [https-zilkroad-com-mint-config-js-v-zr20260920a.js:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-config-js-v-zr20260920a.js:1>); [public source](https://zilkroad.com/mint/config.js?v=zr20260920a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3295–3302](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3295>).

### Marketplace analytics code

**OF081 · confirmed.** Third-party zilkfloor code consumes Zilkroad public token and sales APIs, distinguishing ask buys from accepted offers. Its author excludes offers from price metrics because they believe some are account transfers at token amounts. This is an analytics heuristic and attributed author concern, not proof that a particular reported sale is wash trading.

Sources: [zilkfloor.py:51–65](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/zilkfloor/zilkfloor.py:51>); [public source](https://github.com/aokadam/zilkfloor/blob/762292f888be0f3e45980c4739f7631f0e95f7c7/zilkfloor.py#L51); [zilkfloor.py:261–288](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/zilkfloor/zilkfloor.py:261>); [public source](https://github.com/aokadam/zilkfloor/blob/762292f888be0f3e45980c4739f7631f0e95f7c7/zilkfloor.py#L261).

## Unresolved evidence and contradictions

### Historical deployment evidence

**OG001 · unresolved.** Current auction JS versions are September 20/21 and marketplace JS September 28. They establish current behavior plus preserved rules, but cannot prove identical registration code ran September 15–17. Exact historical operator access is strongly supported by current plaintext flow and escrow model; historical backend logs/source would complete proof.

Sources: [https-zilkroad-com-auction.html:6106–6113](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-auction.html:6106>); [public source](https://zilkroad.com/auction); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733–1742](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

### Count and balance reconciliation

**OG002 · unresolved.** 16,971 social bids versus 3,423 current API funded records is unresolved. Quantity-weighted unit bids may explain it; neither figure proves 16,971 distinct people or deposits. 25,305 minus 13,309 equals 11,996 ZEC, four less than the 12,000 ZEC allocation total. Require original results data and payment ledger to reconcile.

Sources: [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799); [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction).

### Timing and commitments

**OG003 · unresolved.** API heights are stronger cutoff evidence than approximate wall clock. Current opensAtApprox/closesAtApprox around 17:29/17:24 UTC differ from 16:00 announcements and are recalculated from live tip. Seed preimage contains rehearsal; rules hash/anchor are null. Do not invent their historical meaning or claim an independently audited close.

Sources: [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction); [saved-x-extract.jsonl:274](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:274>); [public source](https://x.com/zksnarks_/status/2099891030652781036).

### Asset and settlement proofs

**OG004 · unresolved.** No Zilkroad issuer-signature memo schema, independently rebuildable title ledger, marketplace custody backend, bid-set-completeness proof or winning/losing payment audit was recovered. Signed dust receipts and site non-custodial assertions do not imply consensus-enforced mainnet NFT transfer. An application overlay remains possible and must be documented.

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com.html:439–464](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com.html:439>); [public source](https://zilkroad.com).

### Evidence access limits

**OG005 · unresolved.** ZecBit site bundles/docs and /api/custody returned HTTP 429; old zecbit.io whitepaper URL returned 402. Exa recovered public custody/verifier text. GitHub Zecbit-dev public repository list was empty. No untrusted source was executed; absent server source and rate-limited files are evidence limits, not findings of misbehavior.

Sources: [exa-zecbit-custody-forum.json.md:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:1>); [public source](https://zecbit.net/custody); [https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:400](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:400>); [public source](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/409).

### September 23 request attribution

**OG006 · unresolved.** Saved September 23 bid-feature request lacks reply context; targeted originals and X search did not recover a reliable target. Zilkroad September 23 WE HEARD YOU video is about royalty-funded buybacks, not a bid-feature launch. Preserve the generic request and separately sourced current bidding capability.

Sources: [saved-x-bid-feature-context.jsonl:2](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-bid-feature-context.jsonl:2>); [public source](https://x.com/LiteT0NY/status/2102794337675345989); [sep23-zilkroad-update-frames.png:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/sep23-zilkroad-update-frames.png:1>); [public source](https://x.com/zilkroad_/status/2102878005479845940).

## Adoption requirements and design judgments

These are design judgments derived from the facts, not observed venue commitments. P0 means required for the proposed pilot/privacy claim; P1 is an optional extension. No venue has agreed to adopt the product.

**Recommended wedge:** run one operator-blind multi-unit collection launch that delivers into an existing venue's ownership records. Keep the successful Zilkroad price format, offer LASTWICK its already announced sealed-sale mode, and supply ZecBit a payment/allocation adapter. A new generic marketplace is a larger integration burden.

| Pain or opportunity | What operator blindness fixes | Additional work required |
|---|---|---|
| Operator knows maximum valuations before close | Removes API/recipient early price access if the cryptographic and collateral design actually conceal it. | Keys, funding amounts, quantity, admission integrity, cross-chain timing and logs must all fit the declared threat model. |
| Bidder cannot audit allocation | Reduces operator ability to react to observed demand, but does not prove fair clearing. | Admission receipts, frozen rules, verifiable eligible set, correct clearing and payment reconciliation. |
| Paid but missing item; losing bid stuck | No direct fix. | Venue title adapter, safe settlement, durable refund jobs and private support receipts. |
| Rotating addresses, mobile/no Noir extension, missing memo | No direct fix. | Receipt recovery, mobile OTP, exact URI/memo and authenticated refund destination. |
| Cross-chain participation brought substantial volume | Allows broader funding while keeping valuation private only if funding linkage is handled. | Separate prefunding and auction states, amount/timing protection and accurate source-chain privacy disclosure. |
| High-volume sale and close-time surge | No direct capacity improvement. | 17,000-envelope/deposit rehearsal, burst measurements, checkpointing, reorg and restart tests. |
| Analytics and collection-wide offers | Aggregate outcomes can satisfy some demand after close. | Keep visible secondary offers separate; avoid permanent bidder/holder graphs. |

**Next-week adoption gates:** demonstrate that the operator cannot open or infer protected bids before close; complete a real adapter-backed winner delivery and loser refund; recover a mobile/rotated-address account; survive a process restart and late payment; then rehearse the conservative 17,000-deposit workload. If any gate is missing, describe the build as a pilot with that limitation rather than a production replacement.

**Trust that remains:** on current mainnet venues, auction privacy does not turn application allocation records into consensus-enforced NFTs, make a receiver unable to steal escrow, force a seller to deliver, prevent censorship, or exclude funded shill bids. Those need distinct mechanisms or explicit venue trust. The release design must also explain early-key access and collusion; threshold signing alone is not timed bid decryption.

The detailed requirements below include evidence, priority and reviewable acceptance criteria for each gate.


### Privacy and trust boundary

**OR001 · recommendation.** Register encrypted bid envelopes and opaque receipt identifiers; never send plaintext maximum price or quantity to the operator before close.

**Judgment:** This is the clearest differentiator from Zilkroad and ShieldBid: it removes privileged early price access. Encrypting only the chain memo leaves the existing plaintext API leak intact.

**Acceptance:** Capture browser traffic and inspect API storage, error reports, analytics, backups and admin screens during an open auction; none can recover bid price/quantity. Publish the envelope format and who can decrypt when.

**Priority:** P0

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733–1755](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733–1742](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [SPEC.md:10–35](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:10>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L10); [SPEC.md:125–143](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:125>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L125).

**OR002 · recommendation.** Hide information conveyed by funding amounts as well as the encrypted envelope. State explicitly which collateral values the receiving wallet can decrypt.

**Judgment:** Escrowing quantity times maximum price to an operator-viewable address reveals a strong bid constraint, and the exact bid when quantity is known. A uniform collateral class, independently held collateral, or a demonstrated cryptographic construction needs evaluation; memo encryption alone is insufficient.

**Acceptance:** Demonstrate two different valid bids with indistinguishable operator-visible funding under the chosen design. If collateral buckets reveal bounds, document those bounds and decide whether they satisfy the hackathon privacy claim before launch.

**Priority:** P0

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3295–3302](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3295>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3478–3482](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3478>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:1666–1677](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:1666>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:32–38](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:32>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction); [https-zilkroad-com-mint-config-js-v-zr20260920a.js:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-config-js-v-zr20260920a.js:1>); [public source](https://zilkroad.com/mint/config.js?v=zr20260920a); [SPEC.md:10–35](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:10>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L10); [SPEC.md:125–143](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:125>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L125).

**OR003 · recommendation.** Make early decryption impossible within the declared adversary model, including operator access to release keys, trustee collusion, recovery copies and frontend updates.

**Judgment:** A scheduled server reveal or a key held by the operator is an operational promise. FROST signing does not by itself provide bid encryption or a timed key release. Any threshold-decryption design needs its own scheme and stated collusion assumption.

**Acceptance:** Document the key-generation/release protocol and minimum corrupt parties required to open early. Test early-opening attempts and failure of a release participant; label any emergency override that weakens the claim.

**Priority:** P0

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733–1742](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [SPEC.md:10–35](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:10>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L10); [SPEC.md:125–143](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:125>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L125); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com.html:439–464](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com.html:439>); [public source](https://zilkroad.com).

**OR004 · recommendation.** Offer cross-chain prefunding into the user shielded wallet, followed by the auction funding process; show the privacy consequences of direct Intents funding.

**Judgment:** Cross-chain accessibility is necessary for adoption, but direct public source payments tied to exact bid collateral compromise the strongest privacy promise. Prefunding must also avoid obvious timing and amount matching; merely inserting a shielded hop is not a proof of unlinkability.

**Acceptance:** Separate swap receipt/refund state from auction receipt/refund state, support source-chain swap failures, and demonstrate the chosen amount/timing protection. Marketing describes public origin-chain data accurately.

**Priority:** P0

Sources: [saved-x-extract.jsonl:273](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:273>); [public source](https://x.com/zksnarks_/status/2099903268369420714); [https-zilkroad-com-mint-config-js-v-zr20260920a.js:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-config-js-v-zr20260920a.js:1>); [public source](https://zilkroad.com/mint/config.js?v=zr20260920a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3885](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3885>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-crypto-news-aurora-intents-routed-19m-into-zcash-nft-auction.html:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-crypto-news-aurora-intents-routed-19m-into-zcash-nft-auction.html:1>); [public source](https://crypto.news/aurora-intents-routed-19m-into-zcash-nft-auction/).

**OR024 · recommendation.** Limit analytics and identity linkage to the minimum needed for the chosen sale; offer aggregate activity without exporting a participant ownership graph.

**Judgment:** Wallet-level shielding is undermined by API identity, public bidder pseudonyms, permanent address bindings and exact deposit/result timing. There is a real user demand for market analytics, but it does not justify exposing sealed demand or refund addresses.

**Acceptance:** Document what operator, public, support staff and funding provider each learn before/after close. Audit IP/session logs, referrer tags, receipt-code URLs and result lookups; avoid public bidder-to-refund linkage and stable cross-auction identifiers unless opted into.

**Priority:** P0

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733–1742](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:1733>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-api-market-tokens.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-market-tokens.json:1>); [public source](https://zilkroad.com/api/market/tokens); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1922](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1922>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-bid-lastwick-xyz-room-js-v-140c653867.js:410–426](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:410>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867); [https-bid-lastwick-xyz-room-js-v-140c653867.js:118–123](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:118>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867); [https-market-lastwick-xyz-api-state.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-api-state.json:1>); [public source](https://market.lastwick.xyz/api/state); [https-market-lastwick-xyz-api-catalogue.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-api-catalogue.json:1>); [public source](https://market.lastwick.xyz/api/catalogue); [saved-x-extract.jsonl:158](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:158>); [public source](https://x.com/pnlmaxxing/status/2102106843971506498); [https-zecblocks-xyz-address-identity.js:16–53](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-address-identity.js:16>); [public source](https://zecblocks.xyz/address-identity.js?v=simple-transactions); [https-zecblocks-xyz-script.js:1830–1839](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:1830>).

### Auction rules and auditability

**OR005 · recommendation.** Preserve multi-unit uniform-price clearing with configurable supply, reserve, integer-zatoshi prices, deterministic ties and partial fills.

**Judgment:** Zilkroad can adopt this without changing its successful sale format. Seal both maximum price and quantity until the declared reveal; do not assume every receipt represents one unit.

**Acceptance:** Worked fixtures cover zero demand, undersubscription, reserve failures, equal prices, partially filled final bid and refunds. Publish the precise tie rule before accepting bids, including whether deposit ordering metadata is visible.

**Priority:** P0

Sources: [saved-x-extract.jsonl:274](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:274>); [public source](https://x.com/zksnarks_/status/2099891030652781036); [saved-x-extract.jsonl:272](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:272>); [public source](https://x.com/zksnarks_/status/2100262503120830539); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:1666–1677](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:1666>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:32–38](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:32>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction); [https-zilkroad-com-mint-config-js-v-zr20260920a.js:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-config-js-v-zr20260920a.js:1>); [public source](https://zilkroad.com/mint/config.js?v=zr20260920a); [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799).

**OR006 · recommendation.** Freeze opening/closing heights, confirmation policy and amendment rules in a versioned auction manifest before launch.

**Judgment:** Block height is a better authoritative cutoff than a drifting wall-clock estimate. Different products currently use one block, three confirmations or ten confirmations; they cannot share an unexplained timer.

**Acceptance:** Specify whether inclusion height or matured confirmation height controls eligibility, how reorgs affect close, and how late funds refund. Display both fixed heights and estimated time, with pending-payment warnings.

**Priority:** P0

Sources: [saved-x-extract.jsonl:270](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:270>); [public source](https://x.com/zksnarks_/status/2100518836978233375); [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction); [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799); [https-lastwick-xyz.html:316](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-lastwick-xyz.html:316>); [public source](https://lastwick.xyz); [https-bid-lastwick-xyz-room-js-v-140c653867.js:122–125](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:122>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867); [saved-x-official-extract.jsonl:43](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:43>); [public source](https://x.com/zec_bit/status/2095598808814031309); [saved-x-official-extract.jsonl:44](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:44>); [public source](https://x.com/zec_bit/status/2095571400132108340); [saved-x-extract.jsonl:274](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:274>); [public source](https://x.com/zksnarks_/status/2099891030652781036).

**OR007 · recommendation.** Support authenticated bid raises while preserving the original valid bid until its replacement and extra collateral become eligible.

**Judgment:** This matches organizer behavior and avoids destroying a funded position when a raise or swap fails. Replacement and tie-priority semantics must be explicit rather than inferred from receipt order.

**Acceptance:** A single receipt lineage prevents double counting; unfunded, partially funded, late and reorged raises leave the correct original bid in force. Refund calculations include every deposit once.

**Priority:** P0

Sources: [saved-x-extract.jsonl:270](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:270>); [public source](https://x.com/zksnarks_/status/2100518836978233375); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:2308](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:2308>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3408–3410](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3408>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-config-js-v-zr20260920a.js:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-config-js-v-zr20260920a.js:1>); [public source](https://zilkroad.com/mint/config.js?v=zr20260920a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3374–3410](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3374>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

**OR008 · recommendation.** Issue bidder-verifiable admission receipts, commit the eligible envelope set before opening it, and provide a dispute path for omitted funded bids.

**Judgment:** A hash of a server-produced CSV proves neither completeness nor eligibility. Operator blindness still permits censorship or fabricated entries unless admission and collateral evidence are independently checkable.

**Acceptance:** Each bidder can prove receipt inclusion without exposing price before close. Published records bind auction ID, manifest, envelope commitment, eligibility and amendment lineage. Define who checks funding and how synthetic bids are excluded.

**Priority:** P0

Sources: [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction); [shieldbid.py:195–208](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/shieldbid.py:195>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/shieldbid.py#L195); [shieldbid.py:221–242](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/shieldbid.py:221>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/shieldbid.py#L221); [demo_01_run.py:188–205](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/demo_01_run.py:188>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/demo_01_run.py#L188); [demo_01_run.py:115–125](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/demo_01_run.py:115>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/demo_01_run.py#L115); [demo_01_run.py:257–273](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/demo_01_run.py:257>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/demo_01_run.py#L257); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com.html:439–464](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com.html:439>); [public source](https://zilkroad.com).

**OR009 · recommendation.** Make clearing and refund totals independently checkable while minimizing disclosure of individual losing prices and identities.

**Judgment:** The useful output is correct allocation and payment, not permanent publication of every private valuation. Start with the narrowest verifiable transcript the implemented mechanism supports; distinguish independent recalculation from a cryptographic proof.

**Acceptance:** Verification establishes eligible supply/demand, clearing, per-receipt allocation and conservation. Disclose exactly which prices become public after close. Explain discrepancies such as the observed four-ZEC aggregate gap using itemized amounts rather than speculation.

**Priority:** P0

Sources: [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799); [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:4899](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:4899>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

### Asset delivery and integration

**OR010 · recommendation.** Support present-day collection adapters: Zilkroad serial registry and signed holder receipts, ZecBit allocation records, and LASTWICK Ember/paddle ownership.

**Judgment:** The first customer needs its existing asset representation delivered correctly. Treat native testnet ZSAs as a separate adapter; a successful ZEC transfer does not create a mainnet NFT or enforce delivery.

**Acceptance:** For each adapter specify issuer authorization, title source, sale lock, allocation operation, delivery proof, retry and dispute path. A winning receipt can be mapped to a delivered item without revealing all bidder addresses publicly.

**Priority:** P0

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3348–3352](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3348>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [exa-zecbit-custody-forum.json.md:18–50](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:18>); [public source](https://zecbit.net/custody); [https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:406–413](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:406>); [public source](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/409); [https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409-comments.json.md:54–56](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409-comments.json.md:54>); [public source](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/409); [exa-zecbit-custody-forum.json.md:85–117](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:85>); [public source](https://zecbit.net/verify); [https-market-lastwick-xyz-api-state.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-api-state.json:1>); [public source](https://market.lastwick.xyz/api/state); [https-market-lastwick-xyz-api-catalogue.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-api-catalogue.json:1>); [public source](https://market.lastwick.xyz/api/catalogue); [https-zilkroad-com.html:439–464](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com.html:439>); [public source](https://zilkroad.com).

**OR011 · recommendation.** Publish the actual custody and delivery guarantees and isolate bid confidentiality from escrow and seller-performance guarantees.

**Judgment:** An operator-blind auction fixes early valuation access; it does not automatically prevent the receiver from withholding funds, changing a registry, failing delivery or arranging shill demand. Do not inherit noncustodial language without validating the adapter.

**Acceptance:** A participant can identify every party able to spend collateral, change title or stop refunds. Demonstrate payout-versus-allocation failure handling; avoid atomic or trustless claims unsupported by the implemented settlement path.

**Priority:** P0

Sources: [https-zilkroad-com.html:439–464](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com.html:439>); [public source](https://zilkroad.com); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2841](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2841>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [exa-zecbit-custody-forum.json.md:18–50](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:18>); [public source](https://zecbit.net/custody); [saved-x-official-extract.jsonl:35](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:35>); [public source](https://x.com/zec_bit/status/2095935132557324416); [SPEC.md:10–35](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:10>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L10); [SPEC.md:125–143](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:125>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L125); [https-zecblocks-xyz-script.js:1113](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:1113>); [public source](https://zecblocks.xyz/script.js?v=marketplace-claim-progress-removed); [https-zecblocks-xyz-script.js:3140–3220](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:3140>); [https-zecblocks-xyz-script.js:2035–2092](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:2035>).

**OR012 · recommendation.** Provide a small launchpad integration surface rather than require replacement of each existing marketplace.

**Judgment:** The best next-week pilot is one new collection sale using the venue existing holdings and checkout surfaces. LASTWICK already announced sealed launchpad demand; ZecBit already revised minting and payment detection.

**Acceptance:** Document create-auction, submit-envelope, admission-status, close-result, deliver-allocation and refund-status interfaces. Venue can configure supply/fees and import its collection identifiers in a sandbox without giving the auction plaintext bids.

**Priority:** P0

Sources: [saved-x-extract.jsonl:328](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:328>); [public source](https://x.com/wickonzec/status/2102750638782263803); [saved-x-sep23-requests.jsonl:3](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:3>); [public source](https://x.com/zec_bit/status/2102729343776497794); [saved-x-sep23-requests.jsonl:4](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:4>); [public source](https://x.com/zec_bit/status/2102729379642245357); [saved-x-sep23-requests.jsonl:5](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:5>); [public source](https://x.com/zec_bit/status/2102729383446221048); [saved-x-official-extract.jsonl:25](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:25>); [public source](https://x.com/zec_bit/status/2099933446818951317); [saved-x-sep23-requests.jsonl:61](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:61>); [public source](https://x.com/friendtechLFG/status/2102729996057858269); [saved-x-sep23-requests.jsonl:60](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:60>); [public source](https://x.com/shahriyar1798/status/2102746227297435856); [resume-mirror-round2-nft-features-02.json:1](</Users/akshmnd/Dev Projects/zcash/research/raw/zcash-x-pulse/resume-mirror-round2-nft-features-02.json:1>); [public source](https://x.com/Zecoshi/status/2102863847279247391).

**OR013 · recommendation.** Bind collection identity, serial ranges, supply and metadata commitments in the sale manifest and receipts.

**Judgment:** Stable descriptors and issuer authentication solve different problems. Keep ZecBit zmd1/testnet asset identity, CID/content integrity and current mainnet holder records separate; never promise automatic testnet-to-mainnet identity preservation.

**Acceptance:** A verifier detects wrong collection, duplicate serial, changed content hash and unauthorized issuer. Export enough assignment history for holder verification; declare any unavailable public snapshot.

**Priority:** P0

Sources: [https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:406–413](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:406>); [public source](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/409); [https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409-comments.json.md:54–56](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409-comments.json.md:54>); [public source](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/409); [exa-zecbit-custody-forum.json.md:85–117](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:85>); [public source](https://zecbit.net/verify); [https-zecbit-net.html:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecbit-net.html:1>); [public source](https://zecbit.net); [https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:406–409](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-api-github-com-repos-zcashcommunitygrants-zcashcommunitygrants-issues-409.json.md:406>); [public source](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/409); [exa-other-sales.md:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-other-sales.md:1>); [public source](https://zscan.cash/collection/zksnarks); [exa-news-ownership.md:60](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-news-ownership.md:60>); [public source](https://theonchaindiary.com/articles/zksnarks-auction-what-bidders-bought/).

### Payments, refunds and recovery

**OR014 · recommendation.** Require an authenticated explicit shielded refund/receipt destination and publish a short, versioned memo/code format.

**Judgment:** Shielded payment receipt does not reveal the sender address. Wrong-address or missing-memo recovery must not depend on inventing it. Unique diversified deposit addresses can reduce matching errors if supported, but do not supply bid encryption.

**Acceptance:** ZIP-321 URI and QR carry exact amount, network and memo; format fits the 512-byte memo budget with room for authentication/versioning. Test truncated/wrong/missing memo, duplicate payment, rotated address and exchange-origin funding; never refund solely on an unverified public TXID.

**Priority:** P0

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3295–3302](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3295>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3478–3482](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3478>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2386](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2386>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3482](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3482>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [saved-x-extract.jsonl:180](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:180>); [public source](https://x.com/umbasxbt/status/2104273825256882331); [exa-zecbit-custody-forum.json.md:18–50](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:18>); [public source](https://zecbit.net/custody); [demo_01_run.py:188–205](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/demo_01_run.py:188>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/demo_01_run.py#L188); [demo_01_run.py:115–125](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/demo_01_run.py:115>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/demo_01_run.py#L115); [demo_01_run.py:257–273](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/tools/demo_01_run.py:257>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/tools/demo_01_run.py#L257).

**OR015 · recommendation.** Offer address-independent receipt recovery and mobile memo-OTP authentication alongside supported wallet signing.

**Judgment:** Rotating-address login failures and Noir import friction already caused operational problems. Keep a recoverable receipt/code, and do not require users to import a seed into an auction app.

**Acceptance:** A user can recover through the original receipt and prove control of its destination from a mobile wallet. Recovery is rate-limited and does not reveal another user holdings or permit refund-address takeover.

**Priority:** P0

Sources: [saved-x-extract.jsonl:278](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:278>); [public source](https://x.com/zksnarks_/status/2102039266750566615); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1888–1938](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1888>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [saved-x-extract.jsonl:278](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:278>); [public source](https://x.com/zksnarks_/status/2102039266750566615); [saved-x-sep23-requests.jsonl:3](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:3>); [public source](https://x.com/zec_bit/status/2102729343776497794); [saved-x-sep23-requests.jsonl:4](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:4>); [public source](https://x.com/zec_bit/status/2102729379642245357); [saved-x-sep23-requests.jsonl:5](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:5>); [public source](https://x.com/zec_bit/status/2102729383446221048); [saved-x-official-extract.jsonl:43](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:43>); [public source](https://x.com/zec_bit/status/2095598808814031309); [saved-x-official-extract.jsonl:44](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:44>); [public source](https://x.com/zec_bit/status/2095571400132108340).

**OR016 · recommendation.** Use idempotent payment and settlement state machines with explicit seen, confirmed, eligible, allocated, paid, refunded and exception states.

**Judgment:** RPC outages, double acceptance, item-without-payment failures and payment-unknown states are larger adoption risks than clearing arithmetic. Browser retry or restart must never ask for a second deposit merely because a receipt is delayed.

**Acceptance:** Fault injection covers process restart, duplicate webhook/scan, dropped RPC, reorg, concurrent seller acceptance and partial deposits. Every note, allocation and payout has one authoritative lineage, with safe rescan and checkpoint behavior.

**Priority:** P0

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3374–3410](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3374>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [saved-x-extract.jsonl:198](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:198>); [public source](https://x.com/zec_bit/status/2097331067489227106); [saved-x-extract.jsonl:51](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:51>); [public source](https://x.com/zec_bit/status/2104316752201187461); [saved-x-official-extract.jsonl:35](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:35>); [public source](https://x.com/zec_bit/status/2095935132557324416); [DEMO_01_REPORT.md:59–67](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/DEMO_01_REPORT.md:59>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/DEMO_01_REPORT.md#L59); [https-zecblocks-xyz-script.js:1113](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:1113>); [public source](https://zecblocks.xyz/script.js?v=marketplace-claim-progress-removed); [https-zecblocks-xyz-script.js:3140–3220](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:3140>); [https-zecblocks-xyz-script.js:2035–2092](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zecblocks-xyz-script.js:2035>).

**OR017 · recommendation.** Refund losing, excess, late, duplicate and failed-allocation funds automatically with visible queue progress and resumable batches.

**Judgment:** Refund reliability directly addresses ZecBit and LASTWICK support failures; encryption alone does not. Keep bridge source-chain refunds separate from ZEC auction refunds.

**Acceptance:** Demonstrate restart-safe refunds, duplicate-send prevention, explicit network-fee payer and reconciled input/seller/refund/dust totals. Configure an honest service target and escalation process; do not silently apply a dust exception to a full-refund promise.

**Priority:** P0

Sources: [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799); [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction); [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3885](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3885>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-config-js-v-zr20260920a.js:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-config-js-v-zr20260920a.js:1>); [public source](https://zilkroad.com/mint/config.js?v=zr20260920a); [saved-x-extract.jsonl:51](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:51>); [public source](https://x.com/zec_bit/status/2104316752201187461); [saved-x-extract.jsonl:325](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:325>); [public source](https://x.com/wickonzec/status/2103140814360633807); [saved-x-official-extract.jsonl:3](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:3>); [public source](https://x.com/zksnarks_/status/2100739280423326156); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:4899](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:4899>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a).

**OR018 · recommendation.** Provide private support receipts and a searchable exception queue for unmatched deposits and paid-but-undelivered items.

**Judgment:** ZecBit reported more than 3,000 cases and 475 venue-side issues. Operators need a precise recovery trail while support staff remain unable to see sealed prices before close.

**Acceptance:** Support can diagnose payment state using a scoped receipt without full viewing/spending keys or a public address dump. Paid cases have ownership, status, resolution evidence and an escalation deadline.

**Priority:** P0

Sources: [saved-x-extract.jsonl:180](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:180>); [public source](https://x.com/umbasxbt/status/2104273825256882331); [saved-x-extract.jsonl:51](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:51>); [public source](https://x.com/zec_bit/status/2104316752201187461); [saved-x-extract.jsonl:36](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:36>); [public source](https://x.com/NafterG/status/2104319488594457018); [saved-x-extract.jsonl:325](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:325>); [public source](https://x.com/wickonzec/status/2103140814360633807); [saved-x-sep23-requests.jsonl:61](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:61>); [public source](https://x.com/friendtechLFG/status/2102729996057858269); [saved-x-sep23-requests.jsonl:60](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:60>); [public source](https://x.com/shahriyar1798/status/2102746227297435856); [resume-mirror-round2-nft-features-02.json:1](</Users/akshmnd/Dev Projects/zcash/research/raw/zcash-x-pulse/resume-mirror-round2-nft-features-02.json:1>); [public source](https://x.com/Zecoshi/status/2102863847279247391).

### Fees and marketplace compatibility

**OR019 · recommendation.** Version all royalty, platform, mint, swap, network and retained-dust charges per auction and show proceeds/refunds before payment.

**Judgment:** Zilkroad moved from zero-fee announcements to a five-percent API snapshot, and the venues have different mint/action/creator fees. Fee changes must not alter an already funded sealed bid.

**Acceptance:** Manifest locks effective fee basis points and charge order. Receipts itemize gross clearing charge, venue/creator fees, network fee payer and dust. UI reads the same versioned rules used by settlement.

**Priority:** P0

Sources: [https-zilkroad-com.html:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com.html:1>); [public source](https://zilkroad.com); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2922–2937](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2922>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-api-market-listings.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-market-listings.json:1>); [public source](https://zilkroad.com/api/market/listings); [saved-x-extract.jsonl:98](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:98>); [public source](https://x.com/just4rxxy/status/2101550059162620233); [https-market-lastwick-xyz-api-state.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-api-state.json:1>); [public source](https://market.lastwick.xyz/api/state); [https-market-lastwick-xyz-api-catalogue.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-api-catalogue.json:1>); [public source](https://market.lastwick.xyz/api/catalogue); [saved-x-official-extract.jsonl:2](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:2>); [public source](https://x.com/zksnarks_/status/2101321484366917895); [sep23-zilkroad-update.mp4:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/sep23-zilkroad-update.mp4:1>); [public source](https://x.com/zilkroad_/status/2102878005479845940); [sep23-zilkroad-update-frames.png:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/sep23-zilkroad-update-frames.png:1>); [saved-x-official-extract.jsonl:18](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:18>); [public source](https://x.com/zec_bit/status/2102752342286418116); [saved-x-official-extract.jsonl:45](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-official-extract.jsonl:45>); [public source](https://x.com/zec_bit/status/2095478478070030808); [exa-other-sales.md:280](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-other-sales.md:280>); [public source](https://zecbit.net/collection/bitfoots); [exa-zecbit-custody-forum.json.md:44](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/exa-zecbit-custody-forum.json.md:44>); [public source](https://zecbit.net/custody); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:4899](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:4899>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction).

**OR020 · recommendation.** Preserve existing public per-item offers, seller acceptance and withdrawal; make collection-wide offers an optional extension.

**Judgment:** Current Zilkroad already has bids. The strongest new feature is operator-blind primary allocation, with collection-wide buying as a separately scoped user request. Prevent an ordinary visible offer panel from disclosing a sealed-auction valuation.

**Acceptance:** Venue can link delivered assets into its existing offer flow. Collection-wide offers, if included, cap funded quantity and prevent one balance buying several items concurrently.

**Priority:** P1

Sources: [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2830–2843](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2830>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1330–1335](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1330>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2880–2900](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2880>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2968–2981](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2968>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1315–1345](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:1315>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2790](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2790>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [saved-x-extract.jsonl:158](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:158>); [public source](https://x.com/pnlmaxxing/status/2102106843971506498); [https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2830–2900](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-market-zilkroad-v2-js-v-zr20260928e.js:2830>); [public source](https://zilkroad.com/market/zilkroad/v2.js?v=zr20260928e); [saved-x-sep23-requests.jsonl:28](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-sep23-requests.jsonl:28>); [public source](https://x.com/LiteT0NY/status/2102794337675345989).

**OR021 · recommendation.** Use sealed launch auctions for LASTWICK new collections while allowing the existing public candle mode to remain a separate product.

**Judgment:** LASTWICK live ascending candles deliberately expose prices and close with the next block. Retrofitting them with several confirmations would change the mechanic; its announced sealed-sale mode is the appropriate integration target.

**Acceptance:** Launcher labels sale mode and deadlines clearly, handles no-bid/reserve cases and losing-bid returns, and preserves each collection fee/reward policy without mixing raffle/table balances with sealed collateral.

**Priority:** P0

Sources: [saved-x-extract.jsonl:328](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:328>); [public source](https://x.com/wickonzec/status/2102750638782263803); [https-lastwick-xyz.html:316](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-lastwick-xyz.html:316>); [public source](https://lastwick.xyz); [https-bid-lastwick-xyz-room-js-v-140c653867.js:122–125](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:122>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867); [https-bid-lastwick-xyz-room-js-v-140c653867.js:410–426](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:410>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867); [https-bid-lastwick-xyz-room-js-v-140c653867.js:118–123](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-room-js-v-140c653867.js:118>); [public source](https://bid.lastwick.xyz/room.js?v=140c653867); [https-lastwick-xyz.html:369–371](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-lastwick-xyz.html:369>); [public source](https://lastwick.xyz); [https-bid-lastwick-xyz-api-state.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-bid-lastwick-xyz-api-state.json:1>); [public source](https://bid.lastwick.xyz/api/state); [https-market-lastwick-xyz-api-state.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-api-state.json:1>); [public source](https://market.lastwick.xyz/api/state); [https-market-lastwick-xyz-api-catalogue.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-market-lastwick-xyz-api-catalogue.json:1>); [public source](https://market.lastwick.xyz/api/catalogue).

### Capacity and launch readiness

**OR022 · recommendation.** Exercise at least 17,000 bid envelopes and a conservative 17,000-deposit scenario in a 48-hour rehearsal, with concentrated close-time arrivals.

**Judgment:** The reported average is modest; burst scanning, proof work, wallet proving and refund batches are the practical risks. Distinguish unit bids, records, deposits, swaps and participants rather than advertising unverified scale.

**Acceptance:** Measure sustained and burst ingestion, lag to eligibility, close duration and refund completion, plus restarted/reorged runs. Report actual hardware and bottlenecks. Use both multi-unit and one-unit workloads; specify an explicit burst multiplier as a test choice, not an observed fact.

**Priority:** P0

Sources: [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799); [saved-x-extract.jsonl:29](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:29>); [public source](https://x.com/zksnarks_/status/2101126107550376319); [saved-x-extract.jsonl:28](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:28>); [public source](https://x.com/zksnarks_/status/2101134229811634285); [https-zilkroad-com-api-auction.json:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-api-auction.json:1>); [public source](https://zilkroad.com/api/auction); [saved-x-extract.jsonl:33](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:33>); [public source](https://x.com/zksnarks_/status/2100620785651941799); [https-crypto-news-aurora-intents-routed-19m-into-zcash-nft-auction.html:1](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-crypto-news-aurora-intents-routed-19m-into-zcash-nft-auction.html:1>); [public source](https://crypto.news/aurora-intents-routed-19m-into-zcash-nft-auction/); [saved-x-extract.jsonl:274](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:274>); [public source](https://x.com/zksnarks_/status/2099891030652781036).

**OR023 · recommendation.** Build a venue-ready pilot around verified privacy, reliable refund/delivery and a single working collection adapter before expanding auction modes.

**Judgment:** For next-week adoption, the gate is a complete small sale that a real venue can operate, then a capacity rehearsal. Do not promise production readiness from a three-bid payment demo whose asset settlement is out of scope.

**Acceptance:** Pilot demonstrates winner delivery, loser/excess refunds, mobile recovery, failed swap, pending raise and restart recovery. Privacy review attempts early decryption; venue reviews manifest and custody disclosures; scale evidence follows before a public high-volume launch.

**Priority:** P0

Sources: [https-zilkroad-com-mint-app-js-v-zr20260921a.js:3348–3352](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:3348>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com-mint-app-js-v-zr20260921a.js:5538>); [public source](https://zilkroad.com/mint/app.js?v=zr20260921a); [saved-x-extract.jsonl:51](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:51>); [public source](https://x.com/zec_bit/status/2104316752201187461); [saved-x-extract.jsonl:328](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/saved-x-extract.jsonl:328>); [public source](https://x.com/wickonzec/status/2102750638782263803); [SPEC.md:10–35](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:10>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L10); [SPEC.md:125–143](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/SPEC.md:125>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/SPEC.md#L125); [DEMO_01_REPORT.md:7–23](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/code/shieldbid/docs/DEMO_01_REPORT.md:7>); [public source](https://github.com/Jacksoxx/shieldbid/blob/1c37ab0f769637c90be5f128d030c9e4cd972b99/docs/DEMO_01_REPORT.md#L7); [https-zilkroad-com.html:439–464](</Users/akshmnd/Dev Projects/zcash/research/auction/organizer-forensics-evidence/https-zilkroad-com.html:439>); [public source](https://zilkroad.com).

## Machine-readable evidence

The JSONL contains 111 independently addressable records. Raw snapshots and the deduplicated saved-X extract live in `organizer-forensics-evidence/`.
