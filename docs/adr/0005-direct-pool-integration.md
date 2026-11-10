# ADR-0005: Swap directly against Uniswap pools, with no periphery routers
- **Status:** Accepted
- **Date:** 2026-11-05

## Context
On Robinhood Chain the Universal Router address is disputed (Uniswap/sdks#763), and no SwapRouter02 or QuoterV2 address is published. The v3 Factory (`0x1f7d7550…2efa`, verified from `pool.factory()`) and the v4 PoolManager (`0x8366a39c…0951`, verified from its `Initialize` logs) are certain.

## Decision
- The router and harvester call `IUniswapV3Pool.swap` directly and implement `uniswapV3SwapCallback`. The callback is authenticated against the pool address held in **transient storage** (set immediately before `swap`, checked and cleared in the callback).
- ETH→WIF goes through `IPoolManager.unlock` with our own `unlockCallback` (`msg.sender == poolManager`, and only while inside our own unlock), using the pool key from `config/mainnet-4663.json`. Import v4-core types from the official `Uniswap/v4-core` repo.
- Quotes come from simulating our own contracts (`quoteBuy` always reverts with the result).

## Consequences
- (+) Fewer external trust assumptions. The integration matches the chain exactly.
- (−) We own the swap code, so it must be fork-tested against the live pools.
