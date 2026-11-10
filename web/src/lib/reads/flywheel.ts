import { cached } from "../cache.ts";
import { hasDeployment } from "../deployment.ts";
import { epochSettledLogs, feesHarvestedLogs } from "./events.ts";

/** The  burn total shown in the header counter and on the share card, derived from logs since the deployment block (no indexer). */
export interface FlywheelStats {
  /** FeesHarvested.burned + EpochSettled.burned, 18 decimals. */
  burnedWif: bigint;
}

const EMPTY: FlywheelStats = { burnedWif: 0n };

const sum = <T>(xs: readonly T[], f: (x: T) => bigint): bigint => xs.reduce((s, x) => s + f(x), 0n);

/**
 * Total  burned by Flatpack fees, from  and  logs. Cached 15 seconds.
 * Never throws: returns zero if the deployment or RPC is unavailable.
 */
export function flywheelStats(): Promise<FlywheelStats> {
  return cached("flywheelStats", 15_000, async () => {
    if (!hasDeployment()) return EMPTY;
    try {
      const [fees, settles] = await Promise.all([feesHarvestedLogs(), epochSettledLogs()]);
      return { burnedWif: sum(fees, (l) => l.args.burned) + sum(settles, (l) => l.args.burned) };
    } catch {
      return EMPTY;
    }
  });
}
