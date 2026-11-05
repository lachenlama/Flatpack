import type { Hex } from "viem";
import { cached } from "../cache.ts";
import { NETWORK } from "../chain.ts";
import { hasDeployment } from "../deployment.ts";
import { listBaskets } from "./baskets.ts";
import { basketCreatedLogs, blockTimestamps, boughtLogs, epochSettledLogs, feesHarvestedLogs } from "./events.ts";

/** A milestone in the live transaction log on /proof. */
export interface MilestoneTx {
  label: string;
  transactionHash: Hex;
  blockNumber: bigint;
  /** Unix seconds. */
  timestamp: number;
}

/** One Chainlink feed used by some basket, with freshness. */
export interface OracleRow {
  ticker: string;
  feed: string;
  priceUsd?: number;
  /** Unix seconds of the latest update. */
  updatedAt?: number;
}

/**
 * First basket, first buy, first harvest, first burn (from events). Missing milestones are omitted. Cached 60 seconds.
 */
export function milestoneTransactions(): Promise<MilestoneTx[]> {
  return cached("milestones", 60_000, async () => {
    if (!hasDeployment()) return [];
    try {
      const [created, buys, harvests, settles] = await Promise.all([basketCreatedLogs(), boughtLogs(), feesHarvestedLogs(), epochSettledLogs()]);
      const firstBurn = [
        ...harvests.filter((l) => l.args.burned > 0n).map((l) => ({ l, label: "First $WIF burn (fee harvest)" })),
        ...settles.filter((l) => l.args.burned > 0n).map((l) => ({ l, label: "First $WIF burn (weekly settle)" })),
      ].sort((a, b) => (a.l.blockNumber < b.l.blockNumber ? -1 : 1))[0];
      const picks = [
        created[0] && { label: "First basket created", l: created[0] },
        buys[0] && { label: "First buy", l: buys[0] },
        harvests[0] && { label: "First fee harvest", l: harvests[0] },
        firstBurn,
      ].filter((x): x is NonNullable<typeof x> => !!x) as { label: string; l: { blockNumber: bigint; transactionHash: Hex } }[];
      const ts = await blockTimestamps(picks.map((p) => p.l.blockNumber));
      return picks.map((p) => ({ label: p.label, transactionHash: p.l.transactionHash, blockNumber: p.l.blockNumber, timestamp: ts.get(p.l.blockNumber) ?? 0 }));
    } catch {
      return [];
    }
  });
}

/** Distinct Chainlink feeds across all baskets (plus the benchmark) with their freshness. */
export async function oracleRows(): Promise<OracleRow[]> {
  if (!hasDeployment()) return [];
  try {
    const baskets = await listBaskets();
    const seen = new Map<string, OracleRow>();
    for (const b of baskets) {
      for (const c of b.components) {
        if (!seen.has(c.feed.toLowerCase())) seen.set(c.feed.toLowerCase(), { ticker: c.ticker, feed: c.feed, priceUsd: c.priceUsd, updatedAt: c.feedUpdatedAt });
      }
    }
    return [...seen.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  } catch {
    return [];
  }
}

/**
 * Whether Blockscout reports the contract's source as verified. `null` = could not be determined (offline, or a local fork).
 * Cached 10 minutes.
 */
export function contractVerified(address: string): Promise<boolean | null> {
  return cached(`verified:${address.toLowerCase()}`, 600_000, async () => {
    try {
      const res = await fetch(`${NETWORK.explorer}/api/v2/smart-contracts/${address}`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
      if (!res.ok) return res.status === 404 ? false : null;
      const j = (await res.json()) as { is_verified?: boolean; is_fully_verified?: boolean; name?: string };
      return j.is_verified ?? j.is_fully_verified ?? (j.name ? true : null);
    } catch {
      return null;
    }
  });
}
