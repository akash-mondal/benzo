// SPDX-License-Identifier: MIT
// Reviewer R repro (r-02 finding F5), rewritten per crosschain §10 item 5: the real cross-auction
// POOLED drain, end to end. BenzoEscrow.lock must measure what actually arrived; release() pays
// lotCount * standardLot in nominal units from the pooled token balance, so a lock that funds the
// pool with less than its nominal `amount` lets its own signed allocation take the difference from
// a victim auction.
// 1. Behaviour protected: crosschain.md §2/§8 — no auction can be underfunded and consume a pooled
//    peer's funding (F5, docs/AUDITS.md assets allowlist).
// 2. Credible regression: lock() records nominal `amount` again (the measured-delta check removed
//    or weakened), so a fee-on-transfer holder's lock is accepted with only 90% delivered.
// 3. No existing test catches it: the previous version of this file asserted only that the locks
//    revert — no release, no victim, no drain measurement — so a regression that keeps the revert
//    message but breaks the accounting elsewhere, or removes the check entirely while tests still
//    expect it, is invisible at the drain itself.
// 4. No production seam: this drives the shipped BenzoEscrow at its public API (lock/release),
//    with two auctions sharing one token and the gate measured in token balances.
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {BenzoEscrow} from "../src/BenzoEscrow.sol";

// Holder-tax ERC20 (the STA/holder-tax class): transfers FROM taxed holders lose 10%. The
// attacker is taxed, so their 1000-nominal lock funds the pool with 900 — the r-02 scenario;
// the victim's transfers behave plainly, so their funding is exact and their payout can be
// asserted in full.
contract FeeToken {
    string public name = "FeeToken";
    string public symbol = "FEE";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public taxed;

    function setTaxed(address a, bool v) external { taxed[a] = v; }
    function mint(address to, uint256 v) external { balanceOf[to] += v; }
    function approve(address s, uint256 v) external returns (bool) { allowance[msg.sender][s] = v; return true; }
    function transfer(address to, uint256 v) external returns (bool) { return _move(msg.sender, to, v); }
    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        allowance[from][msg.sender] -= v;
        return _move(from, to, v);
    }
    function _move(address from, address to, uint256 v) internal returns (bool) {
        uint256 fee = taxed[from] ? v / 10 : 0;
        balanceOf[from] -= v;
        balanceOf[to] += v - fee;
        balanceOf[address(0xdead)] += fee;
        return true;
    }
}

contract FeeTokenDrainTest is Test {
    bytes32 internal constant TYPEHASH = keccak256(
        "BenzoRelease(bytes32 auctionId,bytes32 resultHash,bytes32 allocationRoot,uint64 batchIndex,uint64 nonce,uint64 expiry)"
    );

    BenzoEscrow internal escrow;
    FeeToken internal token;

    // throwaway dev keys for the local tests only
    uint256 internal alicePk = uint256(keccak256("benzo-test-signer-alice"));
    uint256 internal bobPk = uint256(keccak256("benzo-test-signer-bob"));
    uint256 internal carolPk = uint256(keccak256("benzo-test-signer-carol"));
    address internal alice;
    address internal bob;
    address internal carol;

    bytes32 internal constant auctionA = keccak256("attacker-auction");
    bytes32 internal constant auctionB = keccak256("victim-auction");
    uint256 internal constant LOT = 100; // nominal units per lot

    address internal victim = address(0xB0B);
    address internal attacker = address(0xA11CE);
    address internal attackerRecipient = address(0xBAD);
    address internal victimRecipient = makeAddr("victimRecipient");
    address payable internal attackerReturn = payable(makeAddr("attackerReturn"));
    address payable internal victimReturn = payable(makeAddr("victimReturn"));

    function setUp() public {
        escrow = new BenzoEscrow();
        token = new FeeToken();
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        carol = vm.addr(carolPk);
    }

    // canonical §3 leaf, recomputed independently of the contract
    function _leaf(bytes32 aid, uint64 index, address asset, uint64 lots, address dest) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes("benzo-leaf-v1"), aid, index, bytes32(uint256(uint160(asset))), lots, uint8(1), abi.encodePacked(dest)));
    }

    function _sign2(BenzoEscrow.Release memory att) internal view returns (bytes[] memory sigs) {
        bytes32 structHash = keccak256(
            abi.encode(TYPEHASH, att.auctionId, att.resultHash, att.allocationRoot, att.batchIndex, att.nonce, att.expiry)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        sigs = new bytes[](2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);
        sigs[0] = abi.encodePacked(r, s, v);
        (v, r, s) = vm.sign(bobPk, digest);
        sigs[1] = abi.encodePacked(r, s, v);
    }

    function _singlePayout(uint64 lots, address dest) internal pure returns (BenzoEscrow.Payout[] memory ps) {
        ps = new BenzoEscrow.Payout[](1);
        ps[0] = BenzoEscrow.Payout(0, lots, 1, abi.encodePacked(dest), 1, new bytes32[](0));
    }

    /// The named pooled-drain scenario, end to end: two auctions share one fee token. On the
    /// pre-fix contract the attacker's underfunded lock is accepted (locked 1000 for 900 real),
    /// their self-signed 1000-nominal release eats the victim's funding from the pool, and the
    /// victim's payout can never complete. On the fixed contract the attacker's lock is refused
    /// (the received delta != amount) and the victim's recipient is paid in full from the pool.
    function test_fee_on_transfer_token_drains_victim_auction() public {
        address[3] memory signers = [alice, bob, carol];
        uint64 lockU = uint64(block.timestamp + 100);
        uint64 dead = uint64(block.timestamp + 200);

        // victim auction B: plain funding — 1000 nominal puts 1000 real in the pool
        token.mint(victim, 1000);
        vm.startPrank(victim);
        token.approve(address(escrow), 1000);
        escrow.lock{value: 0}(auctionB, address(token), 1000, LOT, lockU, dead, signers, victimReturn);
        vm.stopPrank();

        // attacker auction A: taxed holder — 1000 nominal puts 900 real in the pool (r-02 F5)
        token.setTaxed(attacker, true);
        token.mint(attacker, 1000);
        vm.startPrank(attacker);
        token.approve(address(escrow), 1000);
        (bool locked, ) = address(escrow).call(abi.encodeCall(
            BenzoEscrow.lock, (auctionA, address(token), uint256(1000), LOT, lockU, dead, signers, attackerReturn)
        ));
        if (locked) {
            // the attacker chose their own signer set at lock: they sign their own allocation
            // root — one leaf of 10 lots = 1000 nominal to themselves — and release it from the
            // pooled balance
            bytes32 leafA = _leaf(auctionA, 0, address(token), 10, attackerRecipient);
            bytes32 rootA = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), leafA));
            BenzoEscrow.Release memory attA = BenzoEscrow.Release(auctionA, keccak256("attacker-result"), rootA, 0, 0, dead);
            escrow.release(attA, _sign2(attA), _singlePayout(10, attackerRecipient));
        }
        vm.stopPrank();

        // the victim's own attested allocation: one leaf of 10 lots = 1000 nominal to their
        // recipient; a per-recipient failure must never be silent here — the recipient must be
        // paid in full from the pool
        bytes32 leafB = _leaf(auctionB, 0, address(token), 10, victimRecipient);
        bytes32 rootB = keccak256(abi.encodePacked("benzo-root-v1", uint64(1), leafB));
        BenzoEscrow.Release memory attB = BenzoEscrow.Release(auctionB, keccak256("victim-result"), rootB, 0, 0, dead);
        escrow.release(attB, _sign2(attB), _singlePayout(10, victimRecipient));

        // THE GATE — the victim stays whole: their recipient is paid in full from the pooled
        // balance. Pre-fix, the attacker's nominal payout consumed the victim's funding (the
        // message prints the measured drain).
        assertEq(
            token.balanceOf(victimRecipient),
            1000,
            string.concat(
                "victim's recipient must be paid in full from the pool (measured: attacker recipient ",
                vm.toString(token.balanceOf(attackerRecipient)),
                ", escrow pool ",
                vm.toString(token.balanceOf(address(escrow))),
                ")"
            )
        );
    }

    /// The lock-time revert the delta check provides (kept from the original repro): a holder-tax
    /// transfer that delivers less than the nominal `amount` can never create an auction.
    function test_lock_refuses_fee_on_transfer_token() public {
        address[3] memory signers = [alice, bob, carol];
        uint64 lockU = uint64(block.timestamp + 100);
        uint64 dead = uint64(block.timestamp + 200);
        token.setTaxed(attacker, true);
        token.mint(attacker, 1000);
        vm.startPrank(attacker);
        token.approve(address(escrow), 1000);
        vm.expectRevert(BenzoEscrow.BadParameters.selector);
        escrow.lock{value: 0}(auctionA, address(token), 1000, LOT, lockU, dead, signers, attackerReturn);
        vm.stopPrank();
        assertEq(token.balanceOf(address(escrow)), 0, "an underfunded auction can never be created");
    }
}
