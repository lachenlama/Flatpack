// PURE planner: Snapshot -> Action[]. No viem, no I/O, no clock (time comes from the snapshot).
import type { Action, Snapshot } from "./types.ts";

export type PlanConfig = { minEth: bigint };

/** True when the keeper cannot afford harvests. Unknown balance (null) never triggers the guard. */
export function isLowGas(snapshot: Snapshot, cfg: PlanConfig): boolean {
  return snapshot.keeperEth !== null && snapshot.keeperEth < cfg.minEth;
}

/**
 * Per basket, in this order (WP4-DESIGN 3.3):
 *  1. sync, if any uiMultiplier != lastMultiplier (skipped when a harvest is planned: harvests sync themselves)
 *  2. harvestDividends, if any pendingDividend > 0
 *  3. claimIOU per unpaused token with owed > 0 (before harvestFees, so the tokens are sold this tick)
 *  4. harvestFees, if pendingFeeShares > 0 (the wifOut threshold is applied by exec after simulating)
 *  5. settle, if now >= nextSettleAt
 *  6. low gas: only sync and settle are planned.
 */
export function plan(snapshot: Snapshot, cfg: PlanConfig): Action[] {
  const lowGas = isLowGas(snapshot, cfg);
  const actions: Action[] = [];

  for (const b of snapshot.baskets) {
    const changed = b.tokens.some((t) => t.uiMultiplier !== t.lastMultiplier);
    const wantDividends = !lowGas && b.tokens.some((t) => t.pendingDividend > 0n);
    const wantFees = !lowGas && b.pendingFeeShares > 0n;
    const iouTokens = lowGas ? [] : b.tokens.filter((t) => t.owed > 0n && !t.paused);

    if (changed && !wantDividends && !wantFees) actions.push({ kind: "sync", basket: b.basket });
    if (wantDividends) actions.push({ kind: "harvestDividends", basket: b.basket });
    for (const t of iouTokens) actions.push({ kind: "claimIOU", basket: b.basket, token: t.token });
    if (wantFees) actions.push({ kind: "harvestFees", basket: b.basket });
    if (snapshot.timestamp >= b.nextSettleAt) actions.push({ kind: "settle", basket: b.basket });
  }
  return actions;
}
