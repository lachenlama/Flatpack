// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IBackingVault} from "../../src/interfaces/IBackingVault.sol";

/// @notice Stand-in for the BasketFactory: settable `isBasket` and `minCuratorStake`, and it can drive the
///         vault's factory-only `registerBasket` and the `stakeFor` call (pulling WIF from this contract).
contract MockFactoryForVault {
    mapping(address account => bool) public isBasket;
    uint256 public minCuratorStake;

    function setMinCuratorStake(uint256 amount) external {
        minCuratorStake = amount;
    }

    function setIsBasket(address basket, bool v) external {
        isBasket[basket] = v;
    }

    function registerBasket(IBackingVault vault, address basket, address curator) external {
        isBasket[basket] = true;
        vault.registerBasket(basket, curator);
    }

    /// @dev Pulls `amount` WIF from `payer` into this contract (payer must have approved it), then stakes for `account`.
    function stakeFor(
        IBackingVault vault,
        IERC20 wif,
        address basket,
        address account,
        address payer,
        uint256 amount
    ) external {
        wif.transferFrom(payer, address(this), amount);
        wif.approve(address(vault), amount);
        vault.stakeFor(basket, account, amount);
    }
}
