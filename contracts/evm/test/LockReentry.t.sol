// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BenzoEscrow} from "../src/BenzoEscrow.sol";

// R9 item 4: `lock` must be nonReentrant and write its state before the external calls the
// fee-token delta check requires (a token callback must never observe an unwritten auction, nor
// re-enter `lock`). Red on the pre-fix contract, green after:
// contracts/logs/r9-4-lock-{old-code,fixed}.out.
contract ProbingLocker {
    BenzoEscrow public immutable escrow;
    bytes32 public probeAuction; // when set, balanceOf reverts unless this auction's state is written
    bytes public innerCalldata; // when set, transferFrom re-enters the escrow with it (once)
    uint256 public innerValue; // msg.value for the re-entrant call
    bool public busy;
    bool public reentryLanded;
    error StateNotWritten();

    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(BenzoEscrow e) {
        escrow = e;
    }

    function armProbe(bytes32 a) external {
        probeAuction = a;
    }

    function armReentry(bytes calldata data, uint256 value) external {
        innerCalldata = data;
        innerValue = value;
    }

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (!busy && innerCalldata.length > 0) {
            busy = true;
            (bool ok, ) = address(escrow).call{value: innerValue}(innerCalldata);
            reentryLanded = ok;
        }
        allowance[from][msg.sender] -= amount;
        balances[from] -= amount;
        balances[to] += amount;
        return true;
    }

    // The probe: the escrow's first external call in `lock` is `balanceOf` — the auction state
    // must already be written by then (effects before interactions). A view call cannot record,
    // so it REFUSES (and with it the lock under test) when the state is not yet written.
    function balanceOf(address who) public view returns (uint256) {
        if (probeAuction != bytes32(0)) {
            (bool ok, bytes memory ret) = address(escrow).staticcall(abi.encodeWithSignature("auction(bytes32)", probeAuction));
            require(ok && ret.length >= 11 * 32, "auction() unreadable");
            (address returnTo, , , , , , , , , , ) = abi.decode(
                ret, (address, address, uint256, uint256, uint256, uint64, uint64, address, address, address, bool)
            );
            if (returnTo == address(0)) revert StateNotWritten();
        }
        return balances[who];
    }
}

contract LockReentryTest is Test {
    bytes32 internal constant auctionA = keccak256("lock-reentry-A");
    bytes32 internal constant auctionB = keccak256("lock-reentry-B");
    uint256 internal constant LOT = 1 ether;

    BenzoEscrow internal escrow;
    ProbingLocker internal token;
    address payable internal seller = payable(makeAddr("seller"));
    address payable internal returnTo = payable(makeAddr("returnTo"));

    function setUp() public {
        escrow = new BenzoEscrow();
        token = new ProbingLocker(escrow);
    }

    function signers() internal returns (address[3] memory s) {
        s = [makeAddr("alice"), makeAddr("bob"), makeAddr("carol")];
    }

    /// The state write must precede every external call: the token's `balanceOf` — the escrow's
    /// first external call in `lock` — refuses unless the auction state is already written.
    /// On the pre-fix contract the probe reverts and the lock cannot land at all.
    function test_lock_effects_before_transfer() public {
        token.armProbe(auctionA);
        token.mint(seller, 2 * LOT);
        vm.startPrank(seller);
        token.approve(address(escrow), 2 * LOT);
        escrow.lock{value: 0}(auctionA, address(token), 2 * LOT, LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days), signers(), returnTo);
        vm.stopPrank();
        (address retTo, , , uint256 locked, , , , , , , ) = escrow.auction(auctionA);
        assertEq(retTo, returnTo, "state written before the token calls");
        assertEq(locked, 2 * LOT, "locked amount recorded");
    }

    /// `lock` must refuse re-entrancy: during the token's `transferFrom` the escrow is called to
    /// lock a second (native) auction — the inner lock must never land. (Native so the inner lock
    /// makes no token calls of its own and the outer delta check stays clean.)
    function test_lock_reentrancy_refused() public {
        address[3] memory s = signers();
        bytes memory inner = abi.encodeCall(
            BenzoEscrow.lock,
            (auctionB, address(0), uint256(1 ether), uint256(1 ether), uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days), s, returnTo)
        );
        token.armReentry(inner, 1 ether);
        vm.deal(address(token), 1 ether); // the inner lock sends value from the token contract

        token.mint(seller, 2 * LOT);
        vm.startPrank(seller);
        token.approve(address(escrow), 2 * LOT);
        escrow.lock{value: 0}(auctionA, address(token), 2 * LOT, LOT, uint64(block.timestamp + 1 days), uint64(block.timestamp + 30 days), s, returnTo);
        vm.stopPrank();

        assertFalse(token.reentryLanded(), "re-entrant lock must be refused");
        (, , , uint256 lockedA, , , , , , , ) = escrow.auction(auctionA);
        assertEq(lockedA, 2 * LOT, "outer lock intact");
        (, , , uint256 lockedB, , , , , , , ) = escrow.auction(auctionB);
        assertEq(lockedB, 0, "the re-entrant auction was never created");
    }
}
