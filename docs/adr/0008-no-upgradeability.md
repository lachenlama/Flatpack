# ADR-0008: No upgradeability, and admin powers limited to non-custodial parameters
- **Status:** Accepted
- **Date:** 2026-11-05

## Context
Judges include a security reviewer. Upgradeable proxies add the largest single trust assumption to any DeFi system.

## Decision
No proxies. Baskets are EIP-1167 clones of an immutable implementation. `Ownable2Step` owners can only:
1. change the component allowlist (it affects new baskets and router buys only),
2. set the keeper,
3. set `minCuratorStake`,
4. pause basket *creation*.

The vault and harvester take the factory and harvester addresses through **one-time** setters (they revert once set).

## Consequences
- (+) Users never need to trust a future code change.
- (−) A bug found after the Nov 12 lock is fixed by deploying v2 alongside, while v1 holders keep redeeming.
