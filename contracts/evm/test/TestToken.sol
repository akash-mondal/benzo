// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestToken — plain ERC-20 fixture for cross-chain testnet runs (design §7 step 5).
/// @notice Test-only: deployed on Ethereum Sepolia so `benzo xchain lock --asset` can run the
/// lock → attest → release → refund cycle against a minted token. It is a bare OpenZeppelin
/// `ERC20` (audited base) with an open `mint` — fine for a demo token, never custody. It obeys
/// the escrow's assets allowlist (docs/AUDITS.md): plain ERC-20, no fee, no rebase, no hooks.
contract TestToken is ERC20 {
    constructor() ERC20("Benzo Test Token", "BNT") {
        _mint(msg.sender, 1_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
