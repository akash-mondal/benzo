// SPDX-License-Identifier: MIT
// Reviewer R repro — cross-auction drain via fee-on-transfer ERC20 (r-02 finding F5).
// BenzoEscrow.lock records `amount` without measuring what actually arrived, and release()
// pays lotCount * standardLot in nominal units from the POOLED token balance. With a
// fee-on-transfer token, an attacker auction underfunds the pool while its own signed
// allocation pays out nominal amounts, taking the difference from a victim auction.
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {BenzoEscrow} from "../src/BenzoEscrow.sol";

// 10% fee on every transfer — representative of real ERC20s (e.g. STA-class tokens).
contract FeeToken {
    string public name = "FeeToken";
    string public symbol = "FEE";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 v) external { balanceOf[to] += v; }
    function approve(address s, uint256 v) external returns (bool) { allowance[msg.sender][s] = v; return true; }
    function transfer(address to, uint256 v) external returns (bool) { return _move(msg.sender, to, v); }
    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        allowance[from][msg.sender] -= v;
        return _move(from, to, v);
    }
    function _move(address from, address to, uint256 v) internal returns (bool) {
        uint256 fee = v / 10;
        balanceOf[from] -= v;
        balanceOf[to] += v - fee;
        balanceOf[address(0xdead)] += fee;
        return true;
    }
}

contract FeeTokenDrainTest is Test {
    

    function _leaf(bytes32 aid, uint64 index, address asset, uint64 lots, address dest) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes("benzo-leaf-v1"), aid, index, bytes32(uint256(uint160(asset))), lots, uint8(1), abi.encodePacked(dest)));
    }

    function test_fee_on_transfer_token_drains_victim_auction() public {
        FeeToken token = new FeeToken();
        BenzoEscrow escrow = new BenzoEscrow();

        address victim = address(0xB0B);
        address attacker = address(0xA11CE);
        address attackerRecipient = address(0xBAD);
        uint256 k1 = 0x51;
        uint256 k2 = 0x52;
        uint256 k3 = 0x53;
        address[3] memory signers = [vm.addr(k1), vm.addr(k2), vm.addr(k3)];

        uint64 lockU = uint64(block.timestamp + 100);
        uint64 dead = uint64(block.timestamp + 200);

        // Post-fix: a fee-on-transfer token can never fund an auction — lock() measures the
        // received balance and refuses tokens that deliver less than the nominal `amount`
        // (pre-fix, this exact scenario drained 100 of the victim's tokens; see report red run).
        token.mint(victim, 1000);
        vm.startPrank(victim);
        token.approve(address(escrow), 1000);
        vm.expectRevert(BenzoEscrow.BadParameters.selector);
        escrow.lock{value: 0}(bytes32("B"), address(token), 1000, 100, lockU, dead, signers, payable(victim));
        vm.stopPrank();

        token.mint(attacker, 1000);
        vm.startPrank(attacker);
        token.approve(address(escrow), 1000);
        vm.expectRevert(BenzoEscrow.BadParameters.selector);
        escrow.lock{value: 0}(bytes32("A"), address(token), 1000, 100, lockU, dead, signers, payable(attacker));
        vm.stopPrank();

        // the regression gate: with no underfunded auction possible, pooled real balances always
        // cover every auction's nominal claims
        assertEq(token.balanceOf(address(escrow)), 0, "no underfunded auction can exist");
    }
}
