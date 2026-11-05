import type { Address } from "viem";
import { cached } from "../cache.ts";
import { getPublicClient } from "../chain.ts";
import { loadIndexSeries, type IndexPoint } from "../history.ts";
import { basketDetail } from "./baskets.ts";

/** "launch" = since the basket was created; "recipe" = the same units over the last 30 days (HYPOTHETICAL backtest). */
export type SeriesRange = "launch" | "recipe";

/** Result of {@link basketSeries}. */
export interface BasketSeries {
  range: SeriesRange;
  /** True for the 30-day recipe: label it "hypothetical" in the UI. */
  hypothetical: boolean;
  points: IndexPoint[];
}

const DAY = 86400;

/**
 * Daily basket-vs-SPY series, both indexed to 100 at the start, built from Chainlink round history. Cached 10 minutes.
 * @returns undefined if the basket is unknown
 */
export function basketSeries(address: Address, range: SeriesRange): Promise<BasketSeries | undefined> {
  return cached(`series:${address.toLowerCase()}:${range}`, 600_000, async () => {
    const b = await basketDetail(address);
    if (!b || !b.benchFeed) return undefined;
    const nowSec = Math.floor(Date.now() / 1000);
    const sinceSec = range === "recipe" ? nowSec - 30 * DAY : Math.min(b.createdAt ?? nowSec - 30 * DAY, nowSec - 3600);
    const points = await loadIndexSeries(getPublicClient(), {
      feeds: b.components.map((c) => c.feed),
      rawUnits: b.components.map((c) => c.rawUnits),
      benchFeed: b.benchFeed,
      sinceSec,
      nowSec,
    });
    return { range, hypothetical: range === "recipe", points };
  });
}
