# ADR-0003: Pro-rata redeem with per-leg IOUs
- **Status:** Accepted
- **Date:** 2026-11-05

## Context
Stock Tokens are pausable (NVDA exposes `paused()`, verified onchain 2026-11-05). An all-or-nothing redeem would let one paused component freeze every holder's exit from every basket containing it. Tokens can also be sent to a basket directly (donations).

## Decision
Redeem pays `floor(effBal_i * net / supplyBefore)` per component, where `effBal = balance - totalOwed`. Each transfer is attempted independently (`SafeERC20.trySafeTransfer`, or an equivalent low-level call that treats a revert or a `false` return as failure). A failure records `owed[receiver][token]` and `totalOwed[token]`, claimable later through `claimIOU`.

## Consequences
- (+) INV-7: a single failing component never blocks an exit. Donations go to holders instead of getting stuck.
- (−) Holders may receive a partial basket during a pause, with the rest as an IOU. The UI must show this.
