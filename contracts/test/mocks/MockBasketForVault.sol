// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal basket stand-in for BackingVault tests: only `components()` is supported, and it is settable.
contract MockBasketForVault {
    address[] private _tokens;
    uint256[] private _rawUnits;
    bool public shouldRevert;

    error Reverting();

    function setComponents(address[] memory tokens, uint256[] memory rawUnits) external {
        _tokens = tokens;
        _rawUnits = rawUnits;
    }

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function components() external view returns (address[] memory, uint256[] memory) {
        if (shouldRevert) revert Reverting();
        return (_tokens, _rawUnits);
    }
}
