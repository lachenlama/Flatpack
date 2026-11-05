# ADR-0012: A stateless keeper, run as a GitHub Actions cron
- **Status:** Accepted
- **Date:** 2026-11-05

## Context
Someone must call `harvestFees` and `harvestDividends` (keeper-only, ADR-0004), plus the permissionless `sync`, `claimIOU` and `settle`, until the final closes on Nov 16. There's no budget for a server. Missing a run is safe by design: fees wait.

## Decision
- **Stateless ticks:** each run snapshots chain state in one Multicall3 call, computes actions with a **pure** planner, then simulates and sends them one at a time. There's no database.
- **Hosting:** `.github/workflows/keeper.yml` on `*/15 * * * *` plus `workflow_dispatch`, with `concurrency: keeper`. Secret: `KEEPER_PRIVATE_KEY` (a dedicated hot wallet holding only gas ETH).
- **Runtime:** Node 24 with native TypeScript type stripping, so there's no build step. The only dependency is viem.
- `minWifOut` = simulated output × (1 − `SLIPPAGE_BPS`). It's never 0.

## Consequences
- (+) Free, no server, auditable logs, and trivially re-runnable by hand (`npm run keeper -- --once`).
- (+) The pure planner is fully unit-testable without a chain.
- (−) GitHub may delay or skip scheduled runs under load. That's acceptable at weekly-epoch granularity, and manual dispatch is the fallback.
- (−) Scheduled workflows are disabled after 60 days of repo inactivity. That's irrelevant within the event.
