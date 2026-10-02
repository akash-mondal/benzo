// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BenzoEscrow} from "../src/BenzoEscrow.sol";

// R-review repro: can release() be re-entered from a malicious recipient so that one
// allocation leaf is paid twice (and other auctions' funds drained)?

contract Reenterer {
    BenzoEscrow public immutable escrow;
    bool public armed;
    bytes public att2;
    bytes public sigs2;
    bytes public payouts2;
    uint256 public reentries;

    constructor(BenzoEscrow e) {
        escrow = e;
    }

    function arm(bytes calldata a, bytes calldata s, bytes calldata p) external {
        att2 = a;
        sigs2 = s;
        payouts2 = p;
        armed = true;
    }

    receive() external payable {
        if (armed) {
            armed = false;
            reentries++;
            (
                BenzoEscrow.Release memory att,
                bytes[] memory sigs,
                BenzoEscrow.Payout[] memory payouts
            ) = abi.decode(att2, (BenzoEscrow.Release, bytes[], BenzoEscrow.Payout[]));
            escrow.release(att, sigs, payouts);
        }
    }
}

contract ReentrancyReproTest is Test {
    bytes32 internal constant TYPEHASH = keccak256(
        "BenzoRelease(bytes32 auctionId,bytes32 resultHash,bytes32 allocationRoot,uint64 batchIndex,uint64 nonce,uint64 expiry)"
    );

    BenzoEscrow internal escrow;
    Reenterer internal attacker;

    uint256 internal alicePk = uint256(keccak256("benzo-test-signer-alice"));
    uint256 internal bobPk = uint256(keccak256("benzo-test-signer-bob"));
    uint256 internal carolPk = uint256(keccak256("benzo-test-signer-carol"));
    address internal alice;
    address internal bob;
    address internal carol;

    address payable internal seller = payable(makeAddr("seller"));
    address payable internal returnTo = payable(makeAddr("returnTo"));
    address payable internal victimReturn = payable(makeAddr("victimReturn"));

    bytes32 internal constant auctionA = keccak256("auction-A");
    bytes32 internal constant auctionB = keccak256("auction-B");
    uint256 internal constant LOT = 1 ether;

    function setUp() public {
        escrow = new BenzoEscrow();
        attacker = new Reenterer(escrow);
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        carol = vm.addr(carolPk);
    }

    function mkLeaf(bytes32 auction, uint64 index, uint64 lotCount, address dest) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "benzo-leaf-v1",
                auction,
                index,
                bytes32(uint256(uint160(address(0)))),
                lotCount,
                uint8(1),
                abi.encodePacked(dest)
            )
        );
    }

    function rootOf(bytes32 leaf) internal pure returns (bytes32) {
        // single-leaf tree: treeRoot = leaf
        return keccak256(abi.encodePacked("benzo-root-v1", uint64(1), leaf));
    }

    function signRelease(bytes32 auction, bytes32 resultHash, bytes32 root, uint64 batchIndex, uint64 nonce, uint64 expiry)
        internal
        view
        returns (bytes[] memory sigs)
    {
        bytes32 structHash = keccak256(
            abi.encode(TYPEHASH, auction, resultHash, root, batchIndex, nonce, expiry)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        uint256[3] memory pks = [alicePk, bobPk, carolPk];
        sigs = new bytes[](2);
        for (uint256 i = 0; i < 2; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pks[i], digest);
            sigs[i] = abi.encodePacked(r, s, v);
        }
    }

    function doLock(bytes32 auction, uint256 amount) internal {
        doLock(auction, amount, returnTo);
    }

    function doLock(bytes32 auction, uint256 amount, address payable ret) internal {
        address[3] memory signers = [alice, bob, carol];
        vm.deal(seller, amount);
        vm.prank(seller);
        escrow.lock{value: amount}(auction, address(0), amount, LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 2 days), signers, ret);
    }

    function mkPayout(uint64 lotCount, address dest) internal pure returns (BenzoEscrow.Payout[] memory ps) {
        ps = new BenzoEscrow.Payout[](1);
        bytes32[] memory proof = new bytes32[](0);
        ps[0] = BenzoEscrow.Payout({
            index: 0,
            lotCount: lotCount,
            destinationKind: 1,
            destination: abi.encodePacked(dest),
            leafCount: 1,
            proof: proof
        });
    }

    function encodeAtt(BenzoEscrow.Release memory att, bytes[] memory sigs, BenzoEscrow.Payout[] memory ps)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(att, sigs, ps);
    }

    /// CONFIRMED-scenario 1: one leaf (worth 2 ETH) is paid TWICE — 4 ETH out for a 2 ETH allocation.
    function test_double_pay_same_leaf_via_reentrancy() public {
        doLock(auctionA, 4 ether);

        bytes32 leaf = mkLeaf(auctionA, 0, 2, address(attacker));
        bytes32 root = rootOf(leaf);

        BenzoEscrow.Release memory att1 = BenzoEscrow.Release({
            auctionId: auctionA,
            resultHash: keccak256("result-1"),
            allocationRoot: root,
            batchIndex: 0,
            nonce: 0,
            expiry: uint64(block.timestamp + 1 days)
        });
        BenzoEscrow.Release memory att2 = BenzoEscrow.Release({
            auctionId: auctionA,
            resultHash: keccak256("result-2"), // signers sign a second batch containing the SAME leaf
            allocationRoot: root,
            batchIndex: 1,
            nonce: 1,
            expiry: uint64(block.timestamp + 1 days)
        });

        bytes[] memory sigs1 = signRelease(auctionA, att1.resultHash, root, 0, 0, att1.expiry);
        bytes[] memory sigs2 = signRelease(auctionA, att2.resultHash, root, 1, 1, att2.expiry);
        BenzoEscrow.Payout[] memory ps = mkPayout(2, address(attacker));

        attacker.arm(encodeAtt(att2, sigs2, ps), "", "");

        uint256 before = address(attacker).balance;
        escrow.release(att1, sigs1, ps);
        uint256 got = address(attacker).balance - before;

        emit log_named_uint("attacker received (wei)", got);
        emit log_named_uint("leaf allocation (wei)", 2 ether);
        assertLe(got, 2 ether, "REGRESSION: one leaf worth 2 ETH must never pay more than 2 ETH");
        // state must stay consistent: paid <= locked, so refund can complete
        (,,,, uint256 paid,,,,,,) = escrow.auction(auctionA);
        assertLe(paid, 2 ether, "paid accounting never exceeds locked");
        vm.warp(block.timestamp + 3 days);
        escrow.refund(auctionA); // must not brick
    }

    /// CONFIRMED-scenario 2: double-pay drains ANOTHER auction's escrowed funds and bricks refund
    /// via `locked - paid` underflow.
    function test_cross_auction_drain_and_refund_bricked() public {
        doLock(auctionA, 2 ether); // attacker's auction: leaf worth 2 ETH
        doLock(auctionB, 3 ether, victimReturn); // victim seller's auction

        bytes32 leaf = mkLeaf(auctionA, 0, 2, address(attacker));
        bytes32 root = rootOf(leaf);

        BenzoEscrow.Release memory att1 = BenzoEscrow.Release(auctionA, keccak256("r1"), root, 0, 0, uint64(block.timestamp + 1 days));
        BenzoEscrow.Release memory att2 = BenzoEscrow.Release(auctionA, keccak256("r2"), root, 1, 1, uint64(block.timestamp + 1 days));
        bytes[] memory sigs1 = signRelease(auctionA, att1.resultHash, root, 0, 0, att1.expiry);
        bytes[] memory sigs2 = signRelease(auctionA, att2.resultHash, root, 1, 1, att2.expiry);
        BenzoEscrow.Payout[] memory ps = mkPayout(2, address(attacker));

        attacker.arm(encodeAtt(att2, sigs2, ps), "", "");

        uint256 before = address(attacker).balance;
        escrow.release(att1, sigs1, ps);
        uint256 got = address(attacker).balance - before;
        emit log_named_uint("attacker drained (wei)", got);
        assertLe(got, 2 ether, "REGRESSION: cannot touch victim auction B funds");

        // contract must still hold at least the whole of auction B
        assertGe(address(escrow).balance, 3 ether, "auction B funds intact");

        // both refunds must complete; victim seller is made whole
        vm.warp(block.timestamp + 3 days);
        escrow.refund(auctionA);
        escrow.refund(auctionB);
        assertEq(victimReturn.balance, 3 ether, "victim auction B fully refunded");
    }

    /// Control: without re-entrancy (EOA recipient) the same two attestations cannot double-pay.
    function test_control_no_reentry_single_pay() public {
        doLock(auctionA, 4 ether);
        address payable eoa = payable(makeAddr("eoa"));
        bytes32 leaf = mkLeaf(auctionA, 0, 2, address(eoa));
        bytes32 root = rootOf(leaf);

        BenzoEscrow.Release memory att1 = BenzoEscrow.Release(auctionA, keccak256("r1"), root, 0, 0, uint64(block.timestamp + 1 days));
        BenzoEscrow.Release memory att2 = BenzoEscrow.Release(auctionA, keccak256("r2"), root, 1, 1, uint64(block.timestamp + 1 days));
        bytes[] memory sigs1 = signRelease(auctionA, att1.resultHash, root, 0, 0, att1.expiry);
        bytes[] memory sigs2 = signRelease(auctionA, att2.resultHash, root, 1, 1, att2.expiry);
        BenzoEscrow.Payout[] memory ps = mkPayout(2, address(eoa));

        escrow.release(att1, sigs1, ps);
        uint256 afterFirst = eoa.balance;
        escrow.release(att2, sigs2, ps); // same leaf again → skipped
        emit log_named_uint("EOA got total (wei)", eoa.balance);
        assertEq(eoa.balance, 2 ether, "flag blocks second pay");
        assertEq(eoa.balance, afterFirst);
    }
}
