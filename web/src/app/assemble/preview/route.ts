import { NextResponse } from "next/server";
import type { Address } from "viem";
import { cached } from "../../../lib/cache.ts";
import { LAUNCH_UNIVERSE, getPublicClient } from "../../../lib/chain.ts";
import { loadIndexSeries } from "../../../lib/history.ts";
import { checkWeights, readFeedPrices, unitsForInput } from "../plan.ts";

export const dynamic = "force-dynamic";

const DAY = 86400;

/**
 * GET /assemble/preview?w=NVDA:30,MSFT:70 : the 30-day HYPOTHETICAL recipe backtest (same units over the last 30 days, both
 * indexed to 100) plus the units per share. Uses WP5a history.ts (Chainlink round history). Cached 10 minutes per recipe.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const w = new URL(req.url).searchParams.get("w") ?? "";
  const parts = w.split(",").filter(Boolean).map((p) => p.split(":") as [string, string]);
  const picks = parts.map(([ticker, pct]) => ({ ticker: ticker ?? "", pct: pct ?? "" }));
  const check = checkWeights(picks.map((p) => p.pct));
  const universe = picks.map((p) => LAUNCH_UNIVERSE[p.ticker]);
  if (!check.ok || universe.some((u) => !u) || new Set(picks.map((p) => p.ticker)).size !== picks.length) {
    return NextResponse.json({ error: check.message ?? "Unknown or repeated token." }, { status: 400 });
  }
  const key = `preview:${picks.map((p) => `${p.ticker}:${check.bps[picks.indexOf(p)]}`).join(",")}`;
  try {
    const body = await cached(key, 600_000, async () => {
      const client = getPublicClient();
      const feeds = universe.map((u) => (u as { feed: string }).feed as Address);
      const prices = await readFeedPrices(client, feeds);
      const input = {
        name: "x",
        symbol: "x",
        mode: "Reinvest" as const,
        picks: picks.map((p, i) => ({
          token: (universe[i] as { token: string }).token as Address,
          feed: feeds[i] as Address,
          weightBps: check.bps[i] as number,
        })),
      };
      const { tokens, rawUnits } = unitsForInput(input, prices);
      // loadIndexSeries wants units aligned with feeds: re-align by token
      const feedByToken = new Map(input.picks.map((p) => [p.token.toLowerCase(), p.feed]));
      const nowSec = Math.floor(Date.now() / 1000);
      const points = await loadIndexSeries(client, {
        feeds: tokens.map((t) => feedByToken.get(t.toLowerCase()) as Address),
        rawUnits,
        benchFeed: LAUNCH_UNIVERSE.SPY?.feed as Address,
        sinceSec: nowSec - 30 * DAY,
        nowSec,
      });
      const units = tokens.map((t, i) => {
        const pick = picks.find((_, j) => (universe[j] as { token: string }).token.toLowerCase() === t.toLowerCase());
        return { ticker: pick?.ticker ?? t, token: t, rawUnits: (rawUnits[i] as bigint).toString() };
      });
      return { hypothetical: true, points, units };
    });
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Preview unavailable." }, { status: 502 });
  }
}
