# ADR-0007: Beat-SPY uses a unit-based NAV, and oracles gate rewards only
- **Status:** Accepted
- **Date:** 2026-11-05

## Context
Curator and backer rewards are released only if the basket beats SPY over a weekly epoch. A balance-based NAV could be inflated by donating tokens to the basket just before settlement.

## Decision
- NAV per 1e18 shares = `Σ rawUnits_i × answer_i × 1e10 / 1e18` (18-decimal USD). Chainlink answers already include the multiplier.
- Epoch boundaries are `1794016800 + k × 7 days` (Saturday 02:00 UTC, after the 24/5 feeds freeze).
- Any invalid feed (`answer <= 0`, `updatedAt == 0`, or more than 4 days old) burns the queued rewards (fail-safe).
- Oracles never touch principal.

## Consequences
- (+) Donation-proof and oracle-failure-safe. The burn is the default.
- (−) PayInWif baskets measure performance without the dividends they paid out. That's slightly conservative and documented.
- (−) There's no L2 sequencer-uptime feed on this chain. This is accepted because only rewards depend on oracles.
