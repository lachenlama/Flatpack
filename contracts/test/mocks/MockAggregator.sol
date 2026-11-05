// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3} from "../../src/interfaces/external/IExternal.sol";

/// @notice Settable Chainlink AggregatorV3 with 8 decimals.
contract MockAggregator is IAggregatorV3 {
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;

    constructor(int256 answer_) {
        set(answer_, block.timestamp);
    }

    function set(int256 answer_, uint256 updatedAt_) public {
        answer = answer_;
        updatedAt = updatedAt_;
        roundId++;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}
