// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Records the basket callbacks and can act as the harvester (mint, redeem, notify, claim) via `exec`.
contract MockHarvester {
    struct FeeCall {
        address basket;
        address referrer;
        uint256 shares;
    }

    struct SkimCall {
        address basket;
        address token;
        uint256 amount;
    }

    FeeCall[] public feeCalls;
    SkimCall[] public skimCalls;
    uint256 public totalFeeShares;
    bool public revertOnFee;

    error Boom();

    function setRevertOnFee(bool r) external {
        revertOnFee = r;
    }

    function feeCallCount() external view returns (uint256) {
        return feeCalls.length;
    }

    function skimCallCount() external view returns (uint256) {
        return skimCalls.length;
    }

    function onFeeShares(address referrer, uint256 shares) external {
        if (revertOnFee) revert Boom();
        feeCalls.push(FeeCall(msg.sender, referrer, shares));
        totalFeeShares += shares;
    }

    function onDividendSkim(address token, uint256 amount) external {
        skimCalls.push(SkimCall(msg.sender, token, amount));
    }

    /// @notice Calls `target` with `data` as this contract (the harvester), bubbling reverts.
    function exec(address target, bytes calldata data) external returns (bytes memory ret) {
        bool ok;
        (ok, ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    function approve(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }
}
