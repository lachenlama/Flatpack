# ADR-0009: Stonkbrokers Pair Tokens stay out of the core
- **Status:** Accepted
- **Date:** 2026-11-05

## Context
Live Pair Tokens (factory `0x282c4815…5B38`) wrap a full-range LP in a hookless 1% v4 pool, with 10% of compounded fees going to $STONKBROKER buybacks. The Pair Token *hook* is listed as "coming soon / not deployed" on hookr.fun.

## Decision
Not used as components, and not on the redeem path. A "List on WIF" Pair Token, or our own FlatpackHook, are stretch goals after the core ships (FLATPACK-PLAN §8).

## Consequences
- (+) No unaudited third-party contract on the principal path, and no value leaking out of $WIF.
