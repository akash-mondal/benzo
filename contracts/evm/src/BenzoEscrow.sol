// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title BenzoEscrow — cross-chain escrow released only by 2-of-3 attested Benzo clearing results.
/// @notice Design: docs/design/crosschain.md §1–§3 (Track B, Phase 5 part 3).
///
/// Lifecycle:
///  - `lock`: the seller deposits the asset once per `auctionId`, before `T_submit` (`lockUntil`);
///    the signed manifest pins {chain, escrow address, asset, amount, deadline} and the per-auction
///    signer set (alice/bob/carol secp256k1 keys, rotating per auction).
///  - `release`: anyone (the crank) submits a release batch with 2-of-3 EIP-712 attestations over
///    the allocation root. Each payout proves its leaf against that root and is paid at most once;
///    a failing recipient is skipped and stays claimable by a later release (per-recipient paid
///    flags), so one failure never reverts the batch.
///  - `refund`: after `deadline` anyone returns the unspent remainder to the pinned return address.
///
/// Trust: the escrow never trusts the signers with custody safety — payments are capped by the
/// locked amount and keyed by leaf hash, so no set of attestations can pay more or twice.
///
/// What may appear on chain (design §0/§8): the escrow, the auction id, allocation leaves
/// (asset, lot count, destination) and attested roots. Never a Zcash txid, address, amount paid
/// or funding identifier.
contract BenzoEscrow {
    using SafeERC20 for IERC20;

    // ---- canonical cross-chain encodings (design §3; mirrored in crosschain/ TS and the Solana program) ----
    // leaf = keccak256("benzo-leaf-v1" ‖ auction_id(32) ‖ index(u64be) ‖ asset(32) ‖ lot_count(u64be)
    //                   ‖ destination_kind(u8) ‖ destination_bytes)
    // root = keccak256("benzo-root-v1" ‖ leaf_count(u64be) ‖ tree_root)   (leaf count committed in the root)
    // tree: sorted-pair keccak parents (OpenZeppelin MerkleProof convention).
    // Amounts are never in a leaf: payout = lot_count × standard_lot (design §3, lesson 6).
    string private constant LEAF_PREFIX = "benzo-leaf-v1";
    string private constant ROOT_PREFIX = "benzo-root-v1";

    // ---- attestation (design §1): "benzo-release-v1 ‖ chain_id ‖ escrow_address ‖ auction_id ‖
    //      result_hash ‖ allocation_root ‖ batch_index ‖ nonce ‖ expiry", as EIP-712 typed data
    //      whose domain binds chain_id + verifyingContract and whose name binds the version string.
    bytes32 private constant RELEASE_TYPEHASH = keccak256(
        "BenzoRelease(bytes32 auctionId,bytes32 resultHash,bytes32 allocationRoot,uint64 batchIndex,uint64 nonce,uint64 expiry)"
    );
    string private constant DOMAIN_NAME = "benzo-release-v1";
    string private constant DOMAIN_VERSION = "1";

    uint8 internal constant DEST_EVM_ADDRESS = 1; // 20-byte EVM address (design §4)

    struct Auction {
        address payable returnTo; // pinned refund address
        address asset;            // address(0) = native ether
        uint256 standardLot;      // payout = lotCount × standardLot
        uint256 locked;           // total deposited at lock
        uint256 paid;             // total released so far (cap for release + refund remainder)
        uint64 lockUntil;         // T_submit: lock() is refused after this time
        uint64 deadline;          // refund() is allowed strictly after this time
        address signer0;
        address signer1;
        address signer2;
        bool refunded;
        bool exists;
    }

    /// @dev The attested release message, exactly the design §1 fields.
    struct Release {
        bytes32 auctionId;
        bytes32 resultHash;
        bytes32 allocationRoot;
        uint64 batchIndex;
        uint64 nonce;
        uint64 expiry;
    }

    /// @dev One allocation leaf to pay: index/lotCount/destination re-derive the leaf, proven
    /// against the attested root with `leafCount` bound-checked (the Hyperbridge out-of-bounds lesson).
    struct Payout {
        uint64 index;
        uint64 lotCount;
        uint8 destinationKind;
        bytes destination;
        uint64 leafCount;
        bytes32[] proof;
    }

    mapping(bytes32 => Auction) private auctions;
    // replay refusal: each (auction_id, batch_index) is releasable once (design §1, lessons 1, 3)
    mapping(bytes32 => mapping(uint64 => bool)) private batchUsed;
    // per-recipient paid flags, keyed by leaf hash: a leaf is payable at most once (design §2.4)
    mapping(bytes32 => mapping(bytes32 => bool)) private paidLeaf;

    event Locked(bytes32 indexed auctionId, address indexed returnTo, address asset, uint256 amount, uint256 standardLot, uint64 lockUntil, uint64 deadline, address signer0, address signer1, address signer2);
    event BatchReleased(bytes32 indexed auctionId, uint64 indexed batchIndex, bytes32 allocationRoot, uint256 payouts);
    event PayoutPaid(bytes32 indexed auctionId, bytes32 indexed leafHash, address recipient, uint256 amount);
    event PayoutSkipped(bytes32 indexed auctionId, bytes32 indexed leafHash, uint8 reason); // 1=already paid 2=over cap
    event PayoutFailed(bytes32 indexed auctionId, bytes32 indexed leafHash, address recipient, uint256 amount); // transfer refused; stays claimable
    event Refunded(bytes32 indexed auctionId, address indexed returnTo, uint256 amount);

    error UnknownAuction();
    error AlreadyLocked();
    error LockClosed();
    error BadParameters();
    error AuctionRefunded();
    error Expired();
    error BatchReplayed();
    error Quorum();
    error BadDestination();
    error LeafBound();
    error NotInRoot();
    error BeforeDeadline();
    error AlreadyRefunded();
    error TransferFailed();

    /// @notice Lock the asset for one auction. One lock per auction id; refused after `lockUntil` (T_submit).
    /// @param signers the per-auction attestation signer set (design §1: keys rotate per auction).
    function lock(
        bytes32 auctionId,
        address asset,
        uint256 amount,
        uint256 standardLot,
        uint64 lockUntil,
        uint64 deadline,
        address[3] calldata signers,
        address payable returnTo
    ) external payable {
        if (standardLot == 0 || amount == 0 || amount % standardLot != 0) revert BadParameters();
        if (deadline < lockUntil) revert BadParameters();
        if (returnTo == address(0)) revert BadParameters();
        if (
            signers[0] == address(0) || signers[1] == address(0) || signers[2] == address(0) ||
            signers[0] == signers[1] || signers[0] == signers[2] || signers[1] == signers[2]
        ) revert BadParameters();
        Auction storage a = auctions[auctionId];
        if (a.exists) revert AlreadyLocked();
        if (block.timestamp > lockUntil) revert LockClosed();

        if (asset == address(0)) {
            if (msg.value != amount) revert BadParameters();
        } else {
            if (msg.value != 0) revert BadParameters();
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        }

        a.returnTo = returnTo;
        a.asset = asset;
        a.standardLot = standardLot;
        a.locked = amount;
        a.paid = 0;
        a.lockUntil = lockUntil;
        a.deadline = deadline;
        a.signer0 = signers[0];
        a.signer1 = signers[1];
        a.signer2 = signers[2];
        a.exists = true;
        emit Locked(auctionId, returnTo, asset, amount, standardLot, lockUntil, deadline, signers[0], signers[1], signers[2]);
    }

    /// @notice Release a batch of allocation payouts on 2-of-3 EIP-712 attestations of the root.
    /// @dev Batch-level validity reverts; per-payout failures (already paid, over cap, transfer
    /// refused) skip that payout only, so one failing recipient never reverts the batch and failed
    /// items stay claimable by a later release (design §2.4).
    function release(Release calldata att, bytes[] calldata sigs, Payout[] calldata payouts) external {
        Auction storage a = auctions[att.auctionId];
        if (!a.exists) revert UnknownAuction();
        if (a.refunded) revert AuctionRefunded();
        if (block.timestamp > att.expiry) revert Expired();

        bytes32 structHash = keccak256(
            abi.encode(RELEASE_TYPEHASH, att.auctionId, att.resultHash, att.allocationRoot, att.batchIndex, att.nonce, att.expiry)
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(domainSeparator(), structHash);
        if (!_hasQuorum(a, digest, sigs)) revert Quorum();

        if (batchUsed[att.auctionId][att.batchIndex]) revert BatchReplayed();
        batchUsed[att.auctionId][att.batchIndex] = true;

        for (uint256 i = 0; i < payouts.length; i++) {
            Payout calldata p = payouts[i];
            if (p.destinationKind != DEST_EVM_ADDRESS || p.destination.length != 20) revert BadDestination();
            if (p.index >= p.leafCount) revert LeafBound();
            bytes32 leaf = leafHash(att.auctionId, p.index, a.asset, p.lotCount, p.destinationKind, p.destination);
            bytes32 treeRoot = MerkleProof.processProof(p.proof, leaf);
            if (rootHash(p.leafCount, treeRoot) != att.allocationRoot) revert NotInRoot();
            if (paidLeaf[att.auctionId][leaf]) {
                emit PayoutSkipped(att.auctionId, leaf, 1);
                continue;
            }
            uint256 amount = p.lotCount * a.standardLot;
            if (a.paid + amount > a.locked) {
                emit PayoutSkipped(att.auctionId, leaf, 2);
                continue;
            }
            address recipient = address(bytes20(p.destination));
            if (_pay(a.asset, recipient, amount)) {
                paidLeaf[att.auctionId][leaf] = true;
                a.paid += amount;
                emit PayoutPaid(att.auctionId, leaf, recipient, amount);
            } else {
                emit PayoutFailed(att.auctionId, leaf, recipient, amount);
            }
        }
        emit BatchReleased(att.auctionId, att.batchIndex, att.allocationRoot, payouts.length);
    }

    /// @notice Anyone may refund the unspent remainder to the pinned return address after `deadline`.
    function refund(bytes32 auctionId) external {
        Auction storage a = auctions[auctionId];
        if (!a.exists) revert UnknownAuction();
        if (a.refunded) revert AlreadyRefunded();
        if (block.timestamp <= a.deadline) revert BeforeDeadline();
        a.refunded = true;
        uint256 remainder = a.locked - a.paid;
        if (remainder > 0 && !_pay(a.asset, a.returnTo, remainder)) revert TransferFailed();
        emit Refunded(auctionId, a.returnTo, remainder);
    }

    // ---- views (benzo xchain status; verify extensions check escrow state against the attested root) ----

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(DOMAIN_NAME)),
                keccak256(bytes(DOMAIN_VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    function leafHash(
        bytes32 auctionId,
        uint64 index,
        address asset,
        uint64 lotCount,
        uint8 destinationKind,
        bytes memory destination
    ) public pure returns (bytes32) {
        // asset is carried as bytes32 (EVM address left-padded) so all chains hash one layout
        return keccak256(
            abi.encodePacked(LEAF_PREFIX, auctionId, index, bytes32(uint256(uint160(asset))), lotCount, destinationKind, destination)
        );
    }

    function rootHash(uint64 leafCount, bytes32 treeRoot) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(ROOT_PREFIX, leafCount, treeRoot));
    }

    function auction(bytes32 auctionId)
        external
        view
        returns (
            address returnTo,
            address asset,
            uint256 standardLot,
            uint256 locked,
            uint256 paid,
            uint64 lockUntil,
            uint64 deadline,
            address signer0,
            address signer1,
            address signer2,
            bool refunded
        )
    {
        Auction storage a = auctions[auctionId];
        return (a.returnTo, a.asset, a.standardLot, a.locked, a.paid, a.lockUntil, a.deadline, a.signer0, a.signer1, a.signer2, a.refunded);
    }

    function isPaid(bytes32 auctionId, bytes32 leaf) external view returns (bool) {
        return paidLeaf[auctionId][leaf];
    }

    function isBatchUsed(bytes32 auctionId, uint64 batchIndex) external view returns (bool) {
        return batchUsed[auctionId][batchIndex];
    }

    // ---- internals ----

    /// @dev 2-of-3: at least two distinct signatures from the auction's signer set. Recovered
    /// addresses only — no ECDSA malleability (OZ ECDSA rejects high-s and invalid v).
    function _hasQuorum(Auction storage a, bytes32 digest, bytes[] calldata sigs) internal view returns (bool) {
        address first = address(0);
        uint256 count = 0;
        for (uint256 i = 0; i < sigs.length; i++) {
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sigs[i]);
            if (err != ECDSA.RecoverError.NoError) continue;
            if (signer != a.signer0 && signer != a.signer1 && signer != a.signer2) continue;
            if (first == address(0)) {
                first = signer;
                count = 1;
            } else if (signer != first) {
                return true;
            }
        }
        return false;
    }

    /// @dev Native: plain call, failure reported. ERC-20: OZ SafeERC20 behind an external self-call
    /// so a reverting transfer reports false instead of reverting the batch.
    function _pay(address asset, address to, uint256 amount) internal returns (bool) {
        if (asset == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            return ok;
        }
        try this.payToken(asset, to, amount) {
            return true;
        } catch {
            return false;
        }
    }

    /// @notice External helper for `_pay`; only callable by this contract.
    function payToken(address token, address to, uint256 amount) external {
        if (msg.sender != address(this)) revert BadParameters();
        IERC20(token).safeTransfer(to, amount);
    }
}
