/** Referral claim planning (pure; unit-tested). `FeeHarvester.claimReferral` only accepts CLOSED cycles that are unclaimed. */

/** One `referralOf(basket, cycle, account)` reading. */
export interface CycleReading {
  cycle: number;
  /** Fee-share weight the account holds in the cycle. */
  shares: bigint;
  claimableWif: bigint;
  claimed: boolean;
}

/** The closed cycles to scan: 0 .. currentCycle-1 (the current cycle is still open). Capped to the newest `max`. */
export function closedCycles(currentCycle: number, max = 100): number[] {
  const out: number[] = [];
  for (let c = Math.max(0, currentCycle - max); c < currentCycle; c++) out.push(c);
  return out;
}

/** Picks the cycles worth claiming: not yet claimed and with a positive claimable amount. */
export function selectClaimableCycles(readings: readonly CycleReading[]): { cycles: number[]; total: bigint } {
  const picked = readings.filter((r) => !r.claimed && r.claimableWif > 0n);
  return { cycles: picked.map((r) => r.cycle), total: picked.reduce((s, r) => s + r.claimableWif, 0n) };
}
