// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BenzoEscrow} from "../src/BenzoEscrow.sol";

// R14 item 4 (Reviewer R F3): the `approval(auctionId, batchIndex)` view. Runs inside contracts/
// only and does not count toward the project E2E ceiling (design §7).
//
// Four questions (test-audit rule):
// 1. Behavior protected: every stored approval is publicly readable in full — allocationRoot,
//    resultHash, expiry, exists — so a verifier can tie the settled root to the published
//    `result.json` hash from contract state (design §7 "verify extensions", crosschain.md §10).
// 2. Credible regression: the getter returns swapped/zeroed fields (e.g. the root in the
//    resultHash slot) → "publish one result while settling another" is caught by nothing, since
//    the verifier compares against the wrong value and sees a match.
// 3. Why no existing test catches it: nothing reads `approval()` — `isApproved` returns only
//    `bool`, and root/resultHash/expiry were only ever in the `AttestationApproved` event (R F3).
// 4. No production seam: the test drives the shipped entry points (lock, submitAttestation) and
//    reads the exact view a real verifier calls.

contract ApprovalGetterTest is Test {
    bytes32 internal constant TYPEHASH = keccak256(
        "BenzoRelease(bytes32 auctionId,bytes32 resultHash,bytes32 allocationRoot,uint64 batchIndex,uint64 nonce,uint64 expiry)"
    );

    BenzoEscrow internal escrow;

    uint256 internal alicePk = uint256(keccak256("benzo-test-signer-alice"));
    uint256 internal bobPk = uint256(keccak256("benzo-test-signer-bob"));
    address internal alice;
    address internal bob;
    address payable internal seller = payable(makeAddr("seller"));
    address payable internal returnTo = payable(makeAddr("returnTo"));

    bytes32 internal constant auctionId = keccak256("approval-getter-auction");
    bytes32 internal constant resultHash = keccak256("published result.json bytes"); // the published result hash
    bytes32 internal constant allocationRoot = keccak256("attested allocation root");
    uint64 internal constant batchIndex = 7;
    uint64 internal constant nonce = 3;
    uint64 internal constant expiry = 0;

    function setUp() public {
        escrow = new BenzoEscrow();
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
    }

    function signRelease(BenzoEscrow.Release memory att, uint256[] memory pks) internal view returns (bytes[] memory sigs) {
        bytes32 structHash = keccak256(
            abi.encode(TYPEHASH, att.auctionId, att.resultHash, att.allocationRoot, att.batchIndex, att.nonce, att.expiry)
        );
        // EIP-712 digest recomputed independently of the contract
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        sigs = new bytes[](pks.length);
        for (uint256 i = 0; i < pks.length; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pks[i], digest);
            sigs[i] = abi.encodePacked(r, s, v);
        }
    }

    function submitOneBatch() internal returns (BenzoEscrow.Release memory att) {
        uint64 until = uint64(block.timestamp + 1 days);
        uint64 deadline = uint64(block.timestamp + 30 days);
        address[3] memory signers = [alice, bob, makeAddr("carol")];
        vm.deal(seller, 2 ether);
        vm.prank(seller);
        escrow.lock{value: 2 ether}(auctionId, address(0), 2 ether, 1 ether, until, deadline, signers, returnTo);
        att = BenzoEscrow.Release({
            auctionId: auctionId,
            resultHash: resultHash,
            allocationRoot: allocationRoot,
            batchIndex: batchIndex,
            nonce: nonce,
            expiry: deadline
        });
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = bobPk;
        escrow.submitAttestation(att, signRelease(att, pks));
    }

    // a batch nobody attested reads as absent with zero fields — never stale or partial values
    function test_approval_absent_batch_is_empty() public {
        submitOneBatch();
        (bytes32 root, bytes32 res, uint64 exp_, bool exists) = escrow.approval(auctionId, batchIndex + 1);
        assertEq(root, bytes32(0));
        assertEq(res, bytes32(0));
        assertEq(exp_, 0);
        assertFalse(exists);
    }

    // the stored approval is exposed exactly as attested: root, the attested result hash and the
    // release window, each asserted against its own independently chosen value (all distinct, so
    // any field swap fails) — this is the tie a verifier compares with the published result hash
    function test_approval_exposes_stored_fields() public {
        BenzoEscrow.Release memory att = submitOneBatch();
        (bytes32 root, bytes32 res, uint64 exp_, bool exists) = escrow.approval(auctionId, batchIndex);
        assertTrue(exists);
        assertEq(root, allocationRoot);
        assertEq(res, resultHash);
        assertEq(exp_, att.expiry);
        assertTrue(root != res); // the two 32-byte fields are distinct: a swap cannot pass
    }
}
