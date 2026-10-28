// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BenzoEscrow} from "../src/BenzoEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Benzo cross-chain escrow tests (docs/design/crosschain.md §7 step 1). These run inside
// contracts/ only and do not count toward the project E2E ceiling. The five
// behaviours under test: lock, release with 2-of-3 EIP-712, replay refusal, refund after
// deadline, per-recipient paid flags. Expected leaves/roots are recomputed here from the
// design §3 byte layout, independent of the contract's helpers.

contract TestERC20 is ERC20 {
    constructor() ERC20("Test Token", "TST") {}
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ToggleReceiver {
    bool public blocked = true;
    function setBlocked(bool v) external {
        blocked = v;
    }
    receive() external payable {
        require(!blocked, "blocked");
    }
}

/// @dev P0 re-entrancy attacker: on receiving a payout it calls back into `release` with a
/// second validly signed batch containing its own leaf (the double-payment scenario).
/// At most one re-entrant attempt per payment (the `busy` guard keeps the old-code run
/// deterministic instead of recursing); the outcome is recorded for the test to assert.
contract ReentrantRecipient {
    BenzoEscrow private immutable escrow;
    bytes private attackCalldata;
    bool private busy;
    bool public reentryLanded; // true iff the re-entrant releaseApproved() call returned success

    constructor(BenzoEscrow _escrow) {
        escrow = _escrow;
    }

    function arm(bytes calldata calldata_) external {
        attackCalldata = calldata_;
    }

    receive() external payable {
        if (busy) return;
        busy = true;
        (bool ok, ) = address(escrow).call(attackCalldata);
        reentryLanded = ok;
        busy = false;
    }
}

contract BenzoEscrowTest is Test {
    bytes32 internal constant TYPEHASH = keccak256(
        "BenzoRelease(bytes32 auctionId,bytes32 resultHash,bytes32 allocationRoot,uint64 batchIndex,uint64 nonce,uint64 expiry)"
    );

    BenzoEscrow internal escrow;
    TestERC20 internal token;

    // throwaway dev keys for the local tests only
    uint256 internal alicePk = uint256(keccak256("benzo-test-signer-alice"));
    uint256 internal bobPk = uint256(keccak256("benzo-test-signer-bob"));
    uint256 internal carolPk = uint256(keccak256("benzo-test-signer-carol"));
    address internal alice;
    address internal bob;
    address internal carol;

    address payable internal seller = payable(makeAddr("seller"));
    address payable internal returnTo = payable(makeAddr("returnTo"));
    address internal recipientA = makeAddr("recipientA");
    address internal recipientB = makeAddr("recipientB");
    ToggleReceiver internal toggling;

    bytes32 internal constant auctionId = keccak256("auction-1");
    uint256 internal constant LOT = 1 ether;

    function setUp() public {
        escrow = new BenzoEscrow();
        token = new TestERC20();
        toggling = new ToggleReceiver();
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        carol = vm.addr(carolPk);
    }

    // ---- helpers: canonical §3 encoding recomputed independently ----

    function mkLeaf(uint64 index, address asset, uint64 lotCount, uint8 kind, bytes memory dest) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "benzo-leaf-v1",
                auctionId,
                index,
                bytes32(uint256(uint160(asset))),
                lotCount,
                kind,
                dest
            )
        );
    }

    function pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function signRelease(BenzoEscrow.Release memory att, uint256[] memory pks) internal view returns (bytes[] memory sigs) {
        bytes32 structHash = keccak256(
            abi.encode(TYPEHASH, att.auctionId, att.resultHash, att.allocationRoot, att.batchIndex, att.nonce, att.expiry)
        );
        // EIP-712 digest: \x19\x01 ‖ domainSeparator ‖ structHash (computed independently of the contract)
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        sigs = new bytes[](pks.length);
        for (uint256 i = 0; i < pks.length; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pks[i], digest);
            sigs[i] = abi.encodePacked(r, s, v);
        }
    }

    function doLock(uint256 amount, uint64 lockUntil, uint64 deadline) internal {
        address[3] memory signers = [alice, bob, carol];
        vm.deal(seller, amount);
        vm.prank(seller);
        escrow.lock{value: amount}(auctionId, address(0), amount, LOT, lockUntil, deadline, signers, returnTo);
    }

    // the R9 release path (Solana's model): attest once (2-of-3 over the root), then crank the
    // payouts against the stored approval — crankable again for any remainder
    function releaseVia(BenzoEscrow.Release memory att, bytes[] memory sigs, BenzoEscrow.Payout[] memory ps) internal {
        escrow.submitAttestation(att, sigs);
        escrow.releaseApproved(att.auctionId, att.batchIndex, ps);
    }

    function twoPayouts(uint64 leafCount, bytes32[] memory proof)
        internal
        view
        returns (BenzoEscrow.Payout[] memory ps)
    {
        ps = new BenzoEscrow.Payout[](2);
        ps[0] = BenzoEscrow.Payout({
            index: 0,
            lotCount: 1,
            destinationKind: 1,
            destination: abi.encodePacked(recipientA),
            leafCount: leafCount,
            proof: proof
        });
        ps[1] = BenzoEscrow.Payout({
            index: 1,
            lotCount: 1,
            destinationKind: 1,
            destination: abi.encodePacked(recipientB),
            leafCount: leafCount,
            proof: proof
        });
    }

    // 1. lock
    function test_lock_native_records_state() public {
        uint64 until = uint64(block.timestamp + 1 days);
        doLock(2 * LOT, until, uint64(block.timestamp + 30 days));
        (
            address retTo,
            address asset,
            uint256 standardLot,
            uint256 locked,
            uint256 paid,
            ,
            ,
            address s0,
            address s1,
            address s2,
            bool refunded
        ) = escrow.auction(auctionId);
        assertEq(retTo, returnTo);
        assertEq(asset, address(0));
        assertEq(standardLot, LOT);
        assertEq(locked, 2 * LOT);
        assertEq(paid, 0);
        assertEq(s0, alice);
        assertEq(s1, bob);
        assertEq(s2, carol);
        assertFalse(refunded);
        assertEq(address(escrow).balance, 2 * LOT);
    }

    function test_lock_token_pulls_erc20() public {
        token.mint(seller, 2 * LOT);
        vm.startPrank(seller);
        token.approve(address(escrow), 2 * LOT);
        address[3] memory signers = [alice, bob, carol];
        escrow.lock(auctionId, address(token), 2 * LOT, LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days), signers, returnTo);
        vm.stopPrank();
        assertEq(token.balanceOf(address(escrow)), 2 * LOT);
        (, address asset,, uint256 locked,,,,,,,) = escrow.auction(auctionId);
        assertEq(asset, address(token));
        assertEq(locked, 2 * LOT);
    }

    function test_lock_refused_after_submit_time() public {
        vm.warp(block.timestamp + 10 days);
        vm.expectRevert(BenzoEscrow.LockClosed.selector);
        doLock(2 * LOT, uint64(block.timestamp - 1), uint64(block.timestamp + 30 days));
    }

    function test_lock_twice_refused() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        vm.expectRevert(BenzoEscrow.AlreadyLocked.selector);
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
    }

    // 2. release with 2-of-3 EIP-712
    function test_release_two_of_three_pays() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));

        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(recipientA));
        bytes32 l1 = mkLeaf(1, address(0), 1, 1, abi.encodePacked(recipientB));
        assertEq(l0, escrow.leafHash(auctionId, 0, address(0), 1, 1, abi.encodePacked(recipientA)), "canonical leaf layout");
        bytes32 treeRoot = pair(l0, l1);
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(2), treeRoot));
        assertEq(root, escrow.rootHash(2, treeRoot), "canonical root layout");

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = l1;

        BenzoEscrow.Release memory att = BenzoEscrow.Release({
            auctionId: auctionId,
            resultHash: keccak256("result-1"),
            allocationRoot: root,
            batchIndex: 0,
            nonce: 0,
            expiry: uint64(block.timestamp + 1 hours)
        });
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = carolPk;
        BenzoEscrow.Payout[] memory ps = twoPayouts(2, proof);
        // recipientA's proof must be its own sibling: rebuild per payout
        ps[0].proof = proof;
        ps[1].proof = new bytes32[](1);
        ps[1].proof[0] = l0;

        releaseVia(att, signRelease(att, pks), ps);

        assertEq(recipientA.balance, LOT);
        assertEq(recipientB.balance, LOT);
        assertTrue(escrow.isPaid(auctionId, l0));
        assertTrue(escrow.isPaid(auctionId, l1));
        assertTrue(escrow.isApproved(auctionId, 0));
        (, , , , uint256 paid, , , , , , ) = escrow.auction(auctionId);
        assertEq(paid, 2 * LOT);
    }

    function test_release_one_signature_refused() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(recipientA));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), l0));
        BenzoEscrow.Release memory att = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, uint64(block.timestamp + 1 hours));
        uint256[] memory pks = new uint256[](1);
        pks[0] = bobPk;
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        ps[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(recipientA), 1, new bytes32[](0));
        bytes[] memory sigs = signRelease(att, pks);
        vm.expectRevert(BenzoEscrow.Quorum.selector);
        escrow.submitAttestation(att, sigs);
    }

    function test_release_outsider_signatures_refused() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(recipientA));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), l0));
        BenzoEscrow.Release memory att = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, uint64(block.timestamp + 1 hours));
        uint256[] memory pks = new uint256[](2);
        pks[0] = uint256(keccak256("outsider-1"));
        pks[1] = uint256(keccak256("outsider-2"));
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        ps[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(recipientA), 1, new bytes32[](0));
        bytes[] memory sigs = signRelease(att, pks);
        vm.expectRevert(BenzoEscrow.Quorum.selector);
        escrow.submitAttestation(att, sigs);
    }

    function test_release_same_signer_twice_not_quorum() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(recipientA));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), l0));
        BenzoEscrow.Release memory att = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, uint64(block.timestamp + 1 hours));
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = alicePk;
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        ps[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(recipientA), 1, new bytes32[](0));
        bytes[] memory sigs = signRelease(att, pks);
        vm.expectRevert(BenzoEscrow.Quorum.selector);
        escrow.submitAttestation(att, sigs);
    }

    function test_release_expired_refused() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(recipientA));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), l0));
        BenzoEscrow.Release memory att = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, uint64(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 2 hours);
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = bobPk;
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        ps[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(recipientA), 1, new bytes32[](0));
        bytes[] memory sigs = signRelease(att, pks);
        vm.expectRevert(BenzoEscrow.Expired.selector);
        escrow.submitAttestation(att, sigs);
    }

    function test_release_leaf_not_in_root_refused() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(recipientA));
        bytes32 l1 = mkLeaf(1, address(0), 1, 1, abi.encodePacked(recipientB));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(2), pair(l0, l1)));
        BenzoEscrow.Release memory att = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, uint64(block.timestamp + 1 hours));
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = bobPk;
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        // wrong sibling: leaf 0 cannot prove against root of {l0,l1} with proof [l0]
        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = l0;
        ps[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(recipientA), 2, badProof);
        bytes[] memory sigs = signRelease(att, pks);
        escrow.submitAttestation(att, sigs);
        vm.expectRevert(BenzoEscrow.NotInRoot.selector);
        escrow.releaseApproved(att.auctionId, att.batchIndex, ps);
    }

    function test_release_leaf_index_bound_refused() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(recipientA));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), l0));
        BenzoEscrow.Release memory att = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, uint64(block.timestamp + 1 hours));
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = bobPk;
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        // leafCount=1 but index=1: out-of-bounds leaf index (Hyperbridge lesson)
        ps[0] = BenzoEscrow.Payout(1, 1, 1, abi.encodePacked(recipientA), 1, new bytes32[](0));
        bytes[] memory sigs = signRelease(att, pks);
        escrow.submitAttestation(att, sigs);
        vm.expectRevert(BenzoEscrow.LeafBound.selector);
        escrow.releaseApproved(att.auctionId, att.batchIndex, ps);
    }

    // 3. replay refusal
    function test_replay_batch_refused() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(recipientA));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), l0));
        BenzoEscrow.Release memory att = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, uint64(block.timestamp + 1 hours));
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = bobPk;
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        ps[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(recipientA), 1, new bytes32[](0));
        releaseVia(att, signRelease(att, pks), ps);
        assertEq(recipientA.balance, LOT);
        // identical attestation submitted again: refused even though the recipient flag is set
        bytes[] memory sigs = signRelease(att, pks);
        vm.expectRevert(BenzoEscrow.BatchReplayed.selector);
        escrow.submitAttestation(att, sigs);
    }

    // 4. refund after deadline
    function test_refund_after_deadline_returns_remainder() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        vm.warp(block.timestamp + 31 days);
        vm.prank(makeAddr("stranger"));
        escrow.refund(auctionId); // anyone
        assertEq(returnTo.balance, 2 * LOT);
        (, , , , , , , , , , bool refunded) = escrow.auction(auctionId);
        assertTrue(refunded);
    }

    function test_refund_before_deadline_refused() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        vm.expectRevert(BenzoEscrow.BeforeDeadline.selector);
        escrow.refund(auctionId);
    }

    // 5. expiry must fit inside the refund-free window
    function test_release_expiry_after_deadline_refused() public {
        uint64 until = uint64(block.timestamp + 1 days);
        uint64 dead = uint64(block.timestamp + 2 days);
        doLock(2 * LOT, until, dead);

        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(recipientA));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), l0));
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        ps[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(recipientA), 1, new bytes32[](0));

        // an attestation whose expiry outlives the deadline would make the refund window
        // (now > deadline) overlap the release window (now <= expiry): a refund racing the
        // release could capture attested payouts. Refused.
        BenzoEscrow.Release memory att = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, dead + 1);
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = bobPk;
        bytes[] memory sigs = signRelease(att, pks);
        vm.expectRevert(BenzoEscrow.BadParameters.selector);
        escrow.submitAttestation(att, sigs);
    }

    function test_refund_only_after_attested_window_closed() public {
        uint64 until = uint64(block.timestamp + 1 days);
        uint64 dead = uint64(block.timestamp + 2 days);
        doLock(2 * LOT, until, dead);

        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(recipientA));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), l0));
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        ps[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(recipientA), 1, new bytes32[](0));
        BenzoEscrow.Release memory att = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, dead);
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = bobPk;

        // an attested (approved) but unreleased batch cannot be refunded before its expiry:
        // refund needs now > deadline >= expiry, so the release window is shut by construction
        // before any refund can take the attested amount
        vm.expectRevert(BenzoEscrow.BeforeDeadline.selector);
        escrow.refund(auctionId);

        vm.warp(dead + 1); // now > deadline >= expiry: the attestation has expired
        bytes[] memory sigs = signRelease(att, pks);
        vm.expectRevert(BenzoEscrow.Expired.selector);
        escrow.submitAttestation(att, sigs);

        escrow.refund(auctionId);
        assertEq(returnTo.balance, 2 * LOT, "refund returns the unspent amount only after the attested window closed");
    }

    function test_refund_after_release_returns_only_remainder() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(recipientA));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), l0));
        BenzoEscrow.Release memory att = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, uint64(block.timestamp + 1 hours));
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = bobPk;
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        ps[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(recipientA), 1, new bytes32[](0));
        releaseVia(att, signRelease(att, pks), ps);
        vm.warp(block.timestamp + 31 days);
        escrow.refund(auctionId);
        assertEq(recipientA.balance, LOT);
        assertEq(returnTo.balance, LOT);
    }

    // 5. per-recipient paid flags: one failing recipient never reverts the batch,
    //    failed items stay claimable, nothing is paid twice
    function test_recipient_flags_skip_failures_and_block_double_pay() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));

        bytes32 l0 = mkLeaf(0, address(0), 1, 1, abi.encodePacked(address(toggling)));
        bytes32 l1 = mkLeaf(1, address(0), 1, 1, abi.encodePacked(recipientB));
        bytes32 treeRoot = pair(l0, l1);
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(2), treeRoot));

        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](2);
        bytes32[] memory proof0 = new bytes32[](1);
        proof0[0] = l1;
        bytes32[] memory proof1 = new bytes32[](1);
        proof1[0] = l0;
        ps[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(address(toggling)), 2, proof0);
        ps[1] = BenzoEscrow.Payout(1, 1, 1, abi.encodePacked(recipientB), 2, proof1);

        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = bobPk;

        // batch 0: toggling recipient reverts on receive; the batch must not revert
        BenzoEscrow.Release memory att0 = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, uint64(block.timestamp + 1 hours));
        releaseVia(att0, signRelease(att0, pks), ps);
        assertEq(address(toggling).balance, 0, "failing recipient unpaid");
        assertEq(recipientB.balance, LOT, "other recipient paid despite failure");
        assertFalse(escrow.isPaid(auctionId, l0), "failed payout stays claimable");
        assertTrue(escrow.isPaid(auctionId, l1));

        // batch 1 (new batch index): same leaves released again
        toggling.setBlocked(false);
        BenzoEscrow.Release memory att1 = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 1, 0, uint64(block.timestamp + 2 hours));
        releaseVia(att1, signRelease(att1, pks), ps);
        assertEq(address(toggling).balance, LOT, "failed item claimable by a later release");
        assertEq(recipientB.balance, LOT, "already-paid recipient not paid again");
        assertTrue(escrow.isPaid(auctionId, l0));

        (, , , , uint256 paid, , , , , , ) = escrow.auction(auctionId);
        assertEq(paid, 2 * LOT, "cap respected");
    }

    function test_release_cap_never_exceeds_lock() public {
        doLock(1 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        bytes32 l0 = mkLeaf(0, address(0), 2, 1, abi.encodePacked(recipientA)); // wants 2 lots, only 1 locked
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), l0));
        BenzoEscrow.Release memory att = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, uint64(block.timestamp + 1 hours));
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = bobPk;
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        ps[0] = BenzoEscrow.Payout(0, 2, 1, abi.encodePacked(recipientA), 1, new bytes32[](0));
        releaseVia(att, signRelease(att, pks), ps); // skipped, not paid
        assertEq(recipientA.balance, 0);
        (, , , , uint256 paid, , , , , , ) = escrow.auction(auctionId);
        assertEq(paid, 0);
    }

    // 6. re-entrant callback must not pay a recipient twice. The attacker's receive
    //    re-enters releaseApproved with a second validly approved batch (different batch index)
    //    carrying the same leaf; the attacker must end up paid exactly once and the re-entrant
    //    release must be refused.
    //    This test fails on the pre-fix code (contract/logs/p0-reentrancy-old-code.out).
    function test_reentrant_recipient_paid_exactly_once() public {
        doLock(2 * LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days));
        ReentrantRecipient attacker = new ReentrantRecipient(escrow);

        // one-leaf tree over the attacker's own leaf, in two valid batches (indices 0 and 1)
        bytes32 lA = mkLeaf(0, address(0), 1, 1, abi.encodePacked(address(attacker)));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), lA));
        BenzoEscrow.Payout[] memory ps = new BenzoEscrow.Payout[](1);
        ps[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(address(attacker)), 1, new bytes32[](0));
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = bobPk;

        BenzoEscrow.Release memory att0 = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 0, 0, uint64(block.timestamp + 1 hours));
        BenzoEscrow.Release memory att1 = BenzoEscrow.Release(auctionId, keccak256("result-1"), root, 1, 0, uint64(block.timestamp + 1 hours));
        // the re-entrant batch: approved (valid 2-of-3 signatures), its own leaf, next batch index
        escrow.submitAttestation(att1, signRelease(att1, pks));
        attacker.arm(abi.encodeCall(BenzoEscrow.releaseApproved, (auctionId, uint64(1), ps)));

        releaseVia(att0, signRelease(att0, pks), ps);

        assertEq(address(attacker).balance, LOT, "paid exactly once despite the re-entrant release");
        assertFalse(attacker.reentryLanded(), "re-entrant release refused");
        assertTrue(escrow.isPaid(auctionId, lA));
        (, , , , uint256 paid, , , , , , ) = escrow.auction(auctionId);
        assertEq(paid, LOT, "cap charged once");
    }
}
