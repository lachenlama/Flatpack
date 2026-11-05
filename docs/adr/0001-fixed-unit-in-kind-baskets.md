# ADR-0001: Fixed-unit, in-kind baskets with an immutable composition
- **Status:** Accepted
- **Date:** 2026-11-05

## Context
Index products usually price mint and redeem with an oracle NAV and rebalance on a schedule. Stock Token feeds are 24/5 and stale over weekends, while AMMs trade 24/7. An oracle-priced mint would let anyone arbitrage the weekend gap against holders. Rebalancing needs a manager with discretion, which is both a security surface and a regulatory one.

## Decision
A share is defined by `rawUnits_i` per 1e18 shares, like an ETF creation unit. Mint is in kind (`ceil`), and redeem is pro rata in kind (`floor`). **No oracle is read on the mint or redeem path.** The composition can never change. A curator who wants different weights publishes a new basket.

## Consequences
- (+) The weekend gap, oracle manipulation and staleness can't misprice shares. The contract is small and holds no admin power.
- (+) There's no "manager", which strengthens the argument that a basket is a recipe rather than a managed fund (FLATPACK-PLAN E25).
- (−) Weights drift with prices (this is a feature: it's a buy-and-hold basket). "Rebalancing" means migrating to a new basket.
