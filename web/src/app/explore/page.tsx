import type { Metadata } from "next";
import { ButtonLink } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { listBaskets } from "../../lib/reads/baskets.ts";
import { basketSeries } from "../../lib/reads/series.ts";
import type { BasketSummary } from "../../lib/reads/types.ts";
import { holderCount } from "./data.ts";
import { ExploreView, type ExploreRow } from "./ExploreView.tsx";
import s from "./explore.module.css";

export const metadata: Metadata = {
  title: "Explore baskets",
  description: "Every Flatpack basket of Stock Tokens on Robinhood Chain, ranked by performance vs SPY this epoch.",
};

/** Last up-to-7 daily index values + total change since the first point (percent). */
async function sparkFor(address: BasketSummary["address"]): Promise<{ spark: number[]; sincePct: number | null }> {
  try {
    const launch = await basketSeries(address, "launch");
    const pts = launch?.points ?? [];
    if (pts.length < 2) return { spark: [], sincePct: null };
    const last = pts[pts.length - 1]!;
    return { spark: pts.slice(-7).map((p) => p.basket), sincePct: last.basket - 100 };
  } catch {
    return { spark: [], sincePct: null };
  }
}

export default async function ExplorePage() {
  let baskets: BasketSummary[] = [];
  let failed = false;
  try {
    baskets = await listBaskets();
  } catch {
    failed = true;
  }

  const rows: ExploreRow[] = await Promise.all(
    baskets.map(async (b, i) => {
      const [sp, holders] = await Promise.all([sparkFor(b.address), holderCount(b.address)]);
      return {
        address: b.address,
        name: b.name,
        tickers: b.tickers,
        mode: b.mode,
        beatPts: b.epoch ? b.epoch.beatPts : null,
        sincePct: sp.sincePct,
        spark: sp.spark,
        tvlUsd: b.tvlUsd,
        wifBacked: Number(b.wifBacked / 10n ** 14n) / 1e4,
        holders: holders ?? null,
        order: i,
      };
    }),
  );

  return (
    <>
      <div className={s.head}>
        <div>
          <h1>Explore baskets</h1>
          <p className="muted">
            Baskets of Stock Tokens on Robinhood Chain. Each week a basket that beats SPY releases rewards to its backers and curator.
          </p>
        </div>
        <ButtonLink href="/assemble" variant="ghost">
          Assemble a basket
        </ButtonLink>
      </div>
      {failed ? (
        <EmptyState title="Can't read baskets right now">The chain RPC did not answer. Try again in a moment.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="No baskets yet" action={<ButtonLink href="/assemble">Assemble the first one</ButtonLink>}>
          No baskets yet. Assemble the first one and earn $WIF from every buy.
        </EmptyState>
      ) : (
        <ExploreView rows={rows} />
      )}
    </>
  );
}
