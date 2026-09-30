# OpenZeppelin confidential contracts / ERC-7984

Owner: `auc-doss-fhe`. Static read-only review, 2026-09-30. Repository https://github.com/OpenZeppelin/openzeppelin-confidential-contracts, commit `e6883b1c398fa4c037d2abcc811f7b4ded9b9410`. Paths/lines relative to `/tmp/zecathon-code/auc-doss-fhe/OpenZeppelin--openzeppelin-confidential-contracts/`. No untrusted code or tests executed.

## Facts and inspected scope

Official library, EVM/Zama, no event placement. Current checkout has ERC-7984 tokens, wrappers, hooks, vesting and utilities. Search of tracked source/docs found **no auction implementation**; `docs/modules/ROOT/pages/index.adoc:3` mentions auctions as a possible use case. This dossier covers the real confidential escrow/payment primitive used by auction examples, not an invented OZ auction. Versioned audit PDFs exist in `audits/`, but this review neither reads their findings nor certifies current HEAD. No browser UI, standalone clearing algorithm or auction deadlines supplied.

`T` = `contracts/token/ERC7984/ERC7984.sol`; `W` = `contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol`.

## Token lifecycle / exact auction funding flow

1. Bidder acquires confidential balance. Wrapper wrap(to, public ERC20 amount) exchanges at integer rate (`W:87-101`, `258-261`).
2. Holder calls setOperator(auction, expiry); self is always operator, permission expires by public timestamp (`T:102-111`, `237-240`). Permission permits initiating transfers and receives transient ACL on transferred amount (`130-148`). This is broad operator authority, not a bid amount allowance.
3. Auction verifies external ciphertext proof and gives token access, then confidentialTransferFrom moves requested encrypted amount only if balance sufficient. `_update` uses FHESafeMath.tryDecrease and select(success,amount,0) (`T:329-336`). **Not partial fill**: insufficient transfer succeeds with encrypted zero.
4. Auction must persist actual transferred handle/ACL, compare actual amount, and ledger zero case. Recipient, sender and token are allowed transferred amount; each account sees its own balance (`T:329-352`).
5. Refund/payout uses confidentialTransfer and must check/consume actual return under application policy (`T:123-126`). For public exit, unwrap burns and makes burned amount public, then finalize verifies exact unwrap handle and sends underlying (`W:125-145`, `267-288`).

State is encrypted balances/supply, public holder/operator-expiry map, metadata and transfer handles. Optional disclose request requires caller handle authorization; final disclosure signature binds exact handle (`T:202-228`). No bid commitment, result/winner, item escrow or reserve exists in library.

## Algorithm, escrow/refund semantics and anti-griefing

```text
(success,newFromBalance)=tryDecrease(fromBalance,requested)
actual=select(success,requested,0)
toBalance += actual
allow actual to sender,recipient,token; emit public endpoints + actual handle
```

No ties, multi-unit auction or pro-rata; token transfers are integer uint64 unit movements. ConfidentialTransferAndCall uses encrypted receiver acceptance, then attempted refund and actual=sent-refund (`T:278-293`). **Refund is best-effort**: receiver can spend/burn during hook so refund moves zero; library explicitly documents it (`270-276`). Do not equate encrypted false with guaranteed rollback. Token receiver hooks and extension restrictions introduce trust/control boundaries. No bid bonds, non-reveal penalties, deadlines or bidder spam controls here.

## Privacy boundaries and leaks

Encryption protects amounts from ordinary public observers, **not endpoints**: ConfidentialTransfer emits from/to/handle (`T:352`); OperatorSet emits holder/operator/expiry (`240`). Sender/recipient know actual amount (`349-350`), operator receives transient access for initiated transfer (`137-148`). Auction contract may hold ACL without giving its EOA owner that ACL; administrator is not automatically a decryptor, but application code may grant it.

Anyone with permitted transferred/balance handle can intentionally request its public disclosure (`T:202-209`). Counterparty privacy is therefore not irrevocable. Wrap input and Wrap event publish underlying amount (`W:93`, `261`); unwrap makes actual burned amount decryptable (`278`) and publishes exit cleartext (`145`). Just-in-time wrapping equal to bid links public funding to private bid. No component hides network timing, wallet identity or the public↔confidential boundary.

## UI / UX

No application screens in this library. Interface provides balance handle, operator approval/revocation, transfer, disclosure and wrap/unwrap. Auction UX should name actual funded deposit and expose operator expiry, zero-transfer success, decryption pending and refund state. Wrapper exits require a second proof transaction, an operational delay absent from plain ERC20 transfers. Those capabilities are code facts, screen suggestions are judgments.

## Judgment and Zcash mapping

**STEAL:** actual-transfer versus requested distinction, exact handle signature binding, expiring permissions, typed disclosure requests, outcome-independent zero operation for privacy where solvency is separately enforced.

**AVOID:** declaring success from transaction receipt alone, unbound ledger credit, best-effort callback refund as atomic escrow, public funding equal to bid, treating endpoint privacy as amount privacy.

Zcash notes already hide payment amounts/endpoints from chain observers under shielded use, but incoming viewing keys reveal received amounts/memos. There is no ERC-7984-style encrypted mutable balance arithmetic or programmable token hook. FROST is spend threshold authorization, not an encrypted comparison network or viewing-key threshold. Use fixed collateral notes and client-encrypted bid envelopes; an independent FHE/MPC committee computes and proves agreed outputs. PCZT assembles refund/change/payout, with signers checking conservation and authorized result exactly once. A memo receipt can bind auction id, ciphertext hash and settlement entitlement. NEAR Intents/public bridges are boundary metadata and must not be marketed as private by virtue of eventual shielded ZEC.
