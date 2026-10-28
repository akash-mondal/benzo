// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BenzoEscrow} from "../src/BenzoEscrow.sol";

// A partial release followed by the remainder must pay every recipient exactly once.
// On the pre-R9 contract the one-shot `release` consumed the whole (auction, batch) at the first,
// partial call, so the remainder was stranded (`BatchReplayed` on every retry). The R9 model
// (Solana's) stores the approved root once and lets `releaseApproved` crank any number
// of times against it.
//
// This file drives the release step through raw calls so it compiles and runs against BOTH the
// pre-R9 and the R9 contract build (the red/green pair: contracts/logs/r9-3-partial-{old-code,fixed}.out);
// everything asserted is read back from the chain.
contract PartialReleaseTest is Test {
    bytes32 internal constant TYPEHASH = keccak256(
        "BenzoRelease(bytes32 auctionId,bytes32 resultHash,bytes32 allocationRoot,uint64 batchIndex,uint64 nonce,uint64 expiry)"
    );
    bytes32 internal constant auctionId = keccak256("partial-release-auction");
    uint256 internal constant LOT = 1 ether;

    BenzoEscrow internal escrow;
    uint256 internal alicePk = uint256(keccak256("partial-signer-alice"));
    uint256 internal carolPk = uint256(keccak256("partial-signer-carol"));
    address payable internal seller = payable(makeAddr("seller"));
    address payable internal returnTo = payable(makeAddr("returnTo"));
    address internal recipientA = makeAddr("recipientA");
    address internal recipientB = makeAddr("recipientB");

    function setUp() public {
        escrow = new BenzoEscrow();
    }

    // One release step of `payouts` under whichever release API this contract build exposes:
    // releaseApproved against the stored approval, storing it first on the first crank —
    // or the pre-R9 one-shot release.
    function releaseStep(BenzoEscrow.Release memory att, bytes[] memory sigs, BenzoEscrow.Payout[] memory ps)
        internal
        returns (bool ok, bytes memory ret)
    {
        (ok, ret) = address(escrow).call(
            abi.encodeWithSignature("releaseApproved(bytes32,uint64,(uint64,uint64,uint8,bytes,uint64,bytes32[])[])", att.auctionId, att.batchIndex, ps)
        );
        if (ok) return (ok, ret);
        (ok, ret) = address(escrow).call(
            abi.encodeWithSignature("submitAttestation((bytes32,bytes32,bytes32,uint64,uint64,uint64),bytes[])", att, sigs)
        );
        if (ok) {
            return address(escrow).call(
                abi.encodeWithSignature("releaseApproved(bytes32,uint64,(uint64,uint64,uint8,bytes,uint64,bytes32[])[])", att.auctionId, att.batchIndex, ps)
            );
        }
        return address(escrow).call(
            abi.encodeWithSignature("release((bytes32,bytes32,bytes32,uint64,uint64,uint64),bytes[],(uint64,uint64,uint8,bytes,uint64,bytes32[])[])", att, sigs, ps)
        );
    }

    function test_partial_release_then_remainder() public {
        uint64 until = uint64(block.timestamp + 1 days);
        uint64 deadline = uint64(block.timestamp + 30 days);
        address[3] memory signers = [vm.addr(alicePk), makeAddr("bob"), vm.addr(carolPk)];
        vm.deal(seller, 2 * LOT);
        vm.prank(seller);
        escrow.lock{value: 2 * LOT}(auctionId, address(0), 2 * LOT, LOT, until, deadline, signers, returnTo);

        // the two leaves and their proofs, recomputed from the design §3 byte layout
        bytes32 l0 = keccak256(abi.encodePacked("benzo-leaf-v1", auctionId, uint64(0), bytes32(0), uint64(1), uint8(1), abi.encodePacked(recipientA)));
        bytes32 l1 = keccak256(abi.encodePacked("benzo-leaf-v1", auctionId, uint64(1), bytes32(0), uint64(1), uint8(1), abi.encodePacked(recipientB)));
        bytes32 treeRoot = l0 < l1 ? keccak256(abi.encodePacked(l0, l1)) : keccak256(abi.encodePacked(l1, l0));
        bytes32 root = keccak256(abi.encodePacked("benzo-root-v1", uint64(2), treeRoot));

        BenzoEscrow.Release memory att = BenzoEscrow.Release({
            auctionId: auctionId,
            resultHash: keccak256("result"),
            allocationRoot: root,
            batchIndex: 0,
            nonce: 0,
            expiry: deadline
        });
        // 2-of-3 over the EIP-712 digest, computed independently of the contract
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), keccak256(abi.encode(TYPEHASH, att.auctionId, att.resultHash, att.allocationRoot, att.batchIndex, att.nonce, att.expiry))));
        bytes[] memory sigs = new bytes[](2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);
        sigs[0] = abi.encodePacked(r, s, v);
        (v, r, s) = vm.sign(carolPk, digest);
        sigs[1] = abi.encodePacked(r, s, v);

        bytes32[] memory proof0 = new bytes32[](1);
        proof0[0] = l1;
        bytes32[] memory proof1 = new bytes32[](1);
        proof1[0] = l0;
        BenzoEscrow.Payout[] memory ps0 = new BenzoEscrow.Payout[](1);
        ps0[0] = BenzoEscrow.Payout(0, 1, 1, abi.encodePacked(recipientA), 2, proof0);
        BenzoEscrow.Payout[] memory ps1 = new BenzoEscrow.Payout[](1);
        ps1[0] = BenzoEscrow.Payout(1, 1, 1, abi.encodePacked(recipientB), 2, proof1);

        // 1. partial release: only leaf 0
        (bool ok1,) = releaseStep(att, sigs, ps0);
        assertTrue(ok1, "partial release refused");
        assertEq(recipientA.balance, LOT, "recipient A paid its lot");

        // 2. the remainder: leaf 1 from the same batch — must be payable after the partial release
        (bool ok2,) = releaseStep(att, sigs, ps1);
        assertTrue(ok2, "remainder refused after a partial release (the batch must stay payable)");
        assertEq(recipientB.balance, LOT, "recipient B paid its lot");
        assertEq(recipientA.balance, LOT, "recipient A paid exactly once");
        assertTrue(escrow.isPaid(auctionId, l0) && escrow.isPaid(auctionId, l1), "both leaves marked paid");
        assertEq(address(escrow).balance, 0, "escrow fully paid out");
    }
}
