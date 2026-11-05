# ADR-0004: Harvesting is keeper-gated. Recipients and splits are constants.
- **Status:** Accepted
- **Date:** 2026-11-05

## Context
$WIF has no oracle, and the WIF/ETH v4 pool holds about $105k plus a launchpad hook that takes a cut of swap output. A permissionless `harvest(minOut)` lets an attacker manipulate the pool, call with `minOut = 0`, and back-run, extracting the fee value (FLATPACK-PLAN E14).

## Decision
Only `keeper` may harvest, and it supplies `minWifOut` and `deadline`, computed offchain by simulation. The burn, referrer, backer and curator splits are compile-time constants, and the destinations are fixed.

## Consequences
- (+) A compromised keeper can only cause a bad fill on a single harvest. It can't steal anything.
- (−) Liveness depends on one bot. Unharvested fees are safe, just delayed (E23).
