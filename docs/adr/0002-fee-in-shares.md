# ADR-0002: Fees are charged in basket shares, inside the Basket
- **Status:** Accepted
- **Date:** 2026-11-05

## Context
A fee taken in USDG by the router can be bypassed: buy the components elsewhere and call `mint` directly (FLATPACK-PLAN E10).

## Decision
`Basket.mint` and `Basket.redeem` send `shares * 30 / 10000` to the FeeHarvester as shares, on every path. The harvester is exempt, so that redeeming fee shares doesn't recurse. 10% of each fee can be attributed to a referrer.

## Consequences
- (+) The fee can't be bypassed, and the accounting is uniform and visible in events.
- (−) The harvester must redeem shares and sell N components, which means more swaps per harvest. This is bounded by keeper batching.
