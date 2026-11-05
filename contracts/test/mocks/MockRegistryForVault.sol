// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IComponentRegistry} from "../../src/interfaces/IComponentRegistry.sol";

/// @notice Settable stand-in for the registry's `component()` and `benchmark()` views.
contract MockRegistryForVault {
    mapping(address token => address feed) public feedOf;
    address public benchmark;

    function setFeed(address token, address feed) external {
        feedOf[token] = feed;
    }

    function setBenchmark(address token) external {
        benchmark = token;
    }

    function component(address token) external view returns (IComponentRegistry.Component memory c) {
        c.priceFeed = feedOf[token];
        c.enabled = feedOf[token] != address(0);
        c.v3Fee = 500;
    }
}
