import type { Address, Hex } from "viem";
import { cached } from "../cache.ts";
import { hasDeployment } from "../deployment.ts";
import { listBaskets } from "./baskets.ts";
import {
  blockTimestamps,
  boughtLogs,
  dividendsHarvestedLogs,
  epochSettledLogs,
  feesHarvestedLogs,
} from "./events.ts";

/** One harvest or settlement for the live feed. */
export interface FlywheelEvent {
  kind: "harvest" | "dividends" | "settle";
  basket: Address;
  blockNumber: bigint;
  transactionHash: Hex;
  /** Unix seconds. */
  timestamp: number;
  /** Harvest: $WIF out. Dividends: $WIF out. Settle: $WIF burned. */
  wif: bigint;
  /** Harvest: burned part. Settle: true when the basket beat SPY. */
  burned?: bigint;
  beat?: boolean;
}

/** Totals of the $WIF flywheel, all derived from logs since the deployment block (no indexer). All $WIF values 18 decimals. */
export interface FlywheelStats {
  /** FeesHarvested.burned + EpochSettled.burned. THE headline number. */
  burnedWif: bigint;
  /** Burned at harvest only. */
  burnedAtHarvest: bigint;
  /** Burned at weekly settle only (backing rewards of baskets that fell behind SPY). */
  burnedAtSettle: bigint;
  /** $WIF bought with fees: FeesHarvested.wifOut + DividendsHarvested.wifOut. */
  wifBought: bigint;
  /** Allocated to curators at harvest (toVaultCurator). */
  toCurators: bigint;
  /** Allocated to $WIF backers at harvest (toVaultBackers). */
  toBackers: bigint;
  /** Allocated to referrers (toReferrers). */
  toReferrers: bigint;
  /** $WIF streamed to holders of Pays $WIF baskets (DividendsHarvested.wifOut). */
  dividendsPaid: bigint;
  /** Released to backers/curators by winning settles. */
  releasedBackers: bigint;
  releasedCurator: bigint;
  /** Sum of Bought.usdgSpent (6 decimals). */
  buyVolumeUsdg: bigint;
  buyCount: number;
  harvestCount: number;
  settleCount: number;
  basketCount: number;
  /** Sum of basket TVL, USD. */
  tvlUsd: number;
  /** Latest 20 harvests/dividends/settles, newest first. */
  recent: FlywheelEvent[];
}

const EMPTY: FlywheelStats = {
  burnedWif: 0n, burnedAtHarvest: 0n, burnedAtSettle: 0n, wifBought: 0n, toCurators: 0n, toBackers: 0n, toReferrers: 0n,
  dividendsPaid: 0n, releasedBackers: 0n, releasedCurator: 0n, buyVolumeUsdg: 0n, buyCount: 0, harvestCount: 0, settleCount: 0,
  basketCount: 0, tvlUsd: 0, recent: [],
};

/** Totals when no deployment/RPC is available (all zero). */
export const EMPTY_FLYWHEEL: FlywheelStats = EMPTY;

const sum = <T>(xs: readonly T[], f: (x: T) => bigint): bigint => xs.reduce((s, x) => s + f(x), 0n);

/**
 * Flywheel totals from `FeesHarvested`, `EpochSettled`, `DividendsHarvested` and `Bought` logs, plus basket TVL.
 * Cached 60 seconds (logs) / 15 seconds (baskets). Never throws: returns zeros if the deployment or RPC is unavailable.
 */
export function flywheelStats(): Promise<FlywheelStats> {
  return cached("flywheelStats", 15_000, async () => {
    if (!hasDeployment()) return EMPTY;
    try {
      const [fees, divs, settles, buys, baskets] = await Promise.all([
        feesHarvestedLogs(), dividendsHarvestedLogs(), epochSettledLogs(), boughtLogs(), listBaskets(),
      ]);
      const raw = [
        ...fees.map((l) => ({ kind: "harvest" as const, l, basket: l.args.basket, wif: l.args.wifOut, burned: l.args.burned })),
        ...divs.map((l) => ({ kind: "dividends" as const, l, basket: l.args.basket, wif: l.args.wifOut, burned: undefined })),
        ...settles.map((l) => ({ kind: "settle" as const, l, basket: l.args.basket, wif: l.args.burned, burned: undefined, beat: l.args.beat })),
      ]
        .sort((a, b) => (a.l.blockNumber === b.l.blockNumber ? b.l.logIndex - a.l.logIndex : a.l.blockNumber > b.l.blockNumber ? -1 : 1))
        .slice(0, 20);
      const ts = await blockTimestamps(raw.map((r) => r.l.blockNumber));
      const recent: FlywheelEvent[] = raw.map((r) => ({
        kind: r.kind,
        basket: r.basket,
        blockNumber: r.l.blockNumber,
        transactionHash: r.l.transactionHash,
        timestamp: ts.get(r.l.blockNumber) ?? 0,
        wif: r.wif,
        burned: r.burned,
        beat: "beat" in r ? r.beat : undefined,
      }));
      const burnedAtHarvest = sum(fees, (l) => l.args.burned);
      const burnedAtSettle = sum(settles, (l) => l.args.burned);
      return {
        burnedWif: burnedAtHarvest + burnedAtSettle,
        burnedAtHarvest,
        burnedAtSettle,
        wifBought: sum(fees, (l) => l.args.wifOut) + sum(divs, (l) => l.args.wifOut),
        toCurators: sum(fees, (l) => l.args.toVaultCurator),
        toBackers: sum(fees, (l) => l.args.toVaultBackers),
        toReferrers: sum(fees, (l) => l.args.toReferrers),
        dividendsPaid: sum(divs, (l) => l.args.wifOut),
        releasedBackers: sum(settles, (l) => l.args.releasedBackers),
        releasedCurator: sum(settles, (l) => l.args.releasedCurator),
        buyVolumeUsdg: sum(buys, (l) => l.args.usdgSpent),
        buyCount: buys.length,
        harvestCount: fees.length,
        settleCount: settles.length,
        basketCount: baskets.length,
        tvlUsd: baskets.reduce((s, b) => s + b.tvlUsd, 0),
        recent,
      };
    } catch {
      return EMPTY;
    }
  });
}
