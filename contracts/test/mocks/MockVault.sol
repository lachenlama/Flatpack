// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IBasket} from "../../src/interfaces/IBasket.sol";

/// @notice Records `registerBasket` and `stakeFor` (pulling the $WIF like the real vault) for factory tests.
contract MockVault {
    IERC20 public immutable wif;

    address public lastBasket;
    address public lastCurator;
    uint256 public componentCountAtRegister;
    uint256 public registerCalls;
    uint256 public stakeCalls;
    address public stakeBasket;
    address public stakeAccount;
    uint256 public stakeAmount;
    uint256 public sequence;
    uint256 public registerSeq;
    uint256 public stakeSeq;
    mapping(address => uint256) public staked;

    constructor(address wif_) {
        wif = IERC20(wif_);
    }

    function registerBasket(address basket, address curator_) external {
        (address[] memory toks, ) = IBasket(basket).components();
        componentCountAtRegister = toks.length;
        lastBasket = basket;
        lastCurator = curator_;
        registerCalls++;
        registerSeq = ++sequence;
    }

    function stakeFor(address basket, address account, uint256 amount) external {
        wif.transferFrom(msg.sender, address(this), amount);
        stakeBasket = basket;
        stakeAccount = account;
        stakeAmount = amount;
        staked[account] += amount;
        stakeCalls++;
        stakeSeq = ++sequence;
    }
}
