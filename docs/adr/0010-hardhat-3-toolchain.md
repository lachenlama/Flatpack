# ADR-0010: Hardhat 3 as the toolchain
- **Status:** Accepted (replaces the initial Foundry setup, at the owner's preference)
- **Date:** 2026-11-05

## Context
The owner prefers Hardhat. The test plan relies on forge-std-style unit, fuzz, invariant and mainnet-fork tests. The keeper bot and the app are TypeScript and viem.

## Decision
Hardhat 3 (v3.21+):
- **Solidity tests** using forge-std `Test` and `vm` cheatcodes, including fuzz (`test.solidity.fuzz`) and invariant tests (`test.solidity.invariant`), and forking through `test.solidity.forking.rpcEndpoints`.
- **Coverage** via `hardhat test solidity --coverage`.
- **Deployments** with Hardhat Ignition modules, and **scripts** with `@nomicfoundation/hardhat-toolbox-viem`.
- **Dependencies** from npm. Formatting with Prettier and prettier-plugin-solidity.
- Robinhood Chain networks are declared with `chainType: "generic"`, because it's an Arbitrum Orbit chain.

## Consequences
- (+) One TypeScript toolchain for contracts, deploys, keeper and app, with shared ABIs and types.
- (+) The Solidity tests stay Foundry-compatible, so they could run under Foundry later without rewriting.
- (−) Hardhat fork tests may be slower than anvil. Fork tests are filtered by name (`_F_`) and run on demand.
- (−) There's no built-in gas report for Solidity tests that we rely on. Gas is measured in dedicated tests.
