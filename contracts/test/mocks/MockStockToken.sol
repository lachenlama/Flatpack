// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IScaledUIAmount, IPausableToken} from "../../src/interfaces/external/IExternal.sol";

/// @notice Mimics a Robinhood Stock Token: 18 decimals, ERC-8056 multiplier, pausable.
/// @dev setPaused(true): transfer and transferFrom REVERT.
///      setReturnFalse(true): transfer and transferFrom return false without moving funds (non-standard failure mode).
contract MockStockToken is ERC20, IScaledUIAmount, IPausableToken {
    uint256 public uiMultiplier = 1e18;
    bool public paused;
    bool public returnFalse;

    error TokenPaused();

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setMultiplier(uint256 m) external {
        uiMultiplier = m;
    }

    function setPaused(bool p) external {
        paused = p;
    }

    function setReturnFalse(bool r) external {
        returnFalse = r;
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return (balanceOf(account) * uiMultiplier) / 1e18;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (paused) revert TokenPaused();
        if (returnFalse) return false;
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (paused) revert TokenPaused();
        if (returnFalse) return false;
        return super.transferFrom(from, to, value);
    }
}
