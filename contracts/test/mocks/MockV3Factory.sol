// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Uniswap v3 factory stand-in with a settable `getPool` (symmetric in the token order).
contract MockV3Factory {
    mapping(address => mapping(address => mapping(uint24 => address))) private _pools;

    function setPool(address a, address b, uint24 fee, address pool) external {
        _pools[a][b][fee] = pool;
        _pools[b][a][fee] = pool;
    }

    function getPool(address a, address b, uint24 fee) external view returns (address) {
        return _pools[a][b][fee];
    }
}
