# ADR-0006: Detect cash dividends trustlessly by the multiplier step (at most 3%)
- **Status:** Accepted
- **Date:** 2026-11-05

## Context
Stock Tokens use ERC-8056: cash dividends AND splits both change `uiMultiplier`. The corporate-actions API labels them, but it's offchain. Real examples: the SOXX 3:1 forward split (processing 2026-11-05) versus the AAPL $0.27 cash dividend (2026-11-16, about 0.1%).

## Decision
In `PayInWif` mode, an increase with `old < new <= old * 1.03` is treated as a cash dividend: `rawUnits_i <- ceil(rawUnits_i * old / new)`, and the excess above full backing is skimmed to the harvester. Any other change (a split of 2x or more, a reverse split, any decrease) only re-baselines `lastMultiplier`. `Reinvest` mode never skims.

## Consequences
- (+) No trusted party is involved. Quarterly dividend yields above 3% are vanishingly rare in the launch universe.
- (−) A rare dividend above 3% is reinvested instead of paid in $WIF (fail-safe: holders keep the value).
