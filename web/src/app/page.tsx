import Link from "next/link";
import { BasketCard } from "../components/BasketCard.tsx";
import { ButtonLink } from "../components/ui/Button.tsx";
import { EmptyState } from "../components/ui/EmptyState.tsx";
import { formatPercent, formatUsd } from "../lib/format.ts";
import { listBaskets } from "../lib/reads/baskets.ts";
import type { BasketSummary } from "../lib/reads/types.ts";
import s from "./page.module.css";

const STEPS = [
  { n: "01", title: "Assemble", text: "Pick 2 to 8 Stock Tokens and stake $WIF behind them." },
  { n: "02", title: "Share", text: "Post the basket link. Referral $WIF comes back to you." },
  { n: "03", title: "Buy", text: "One transaction in USDG. Redeem for the real tokens any time." },
  { n: "04", title: "Fees to $WIF", text: "Half is burned. The rest goes to the curator and backers when the basket beats SPY." },
];

type Part = { ticker: string; weightPct?: number };

/** Shown in the parts list when no basket exists yet. */
const EXAMPLE_PARTS: readonly Part[] = [
  { ticker: "NVDA", weightPct: 30 },
  { ticker: "TSLA", weightPct: 25 },
  { ticker: "AAPL", weightPct: 25 },
  { ticker: "AMZN", weightPct: 20 },
];

/** Beat-SPY ranking: baskets with an epoch reading first (best first), then by TVL. */
function topBaskets(all: BasketSummary[]): BasketSummary[] {
  return [...all]
    .sort((a, b) => (b.epoch?.beatPts ?? -Infinity) - (a.epoch?.beatPts ?? -Infinity) || b.tvlUsd - a.tvlUsd)
    .slice(0, 3);
}

/** Assembly-manual parts list: one row per component, ticker, dotted leader, weight. */
function PartsList({ basket }: { basket?: BasketSummary }) {
  const parts: readonly Part[] = basket
    ? basket.components.length > 0
      ? [...basket.components].sort((a, b) => b.weightPct - a.weightPct).map((c) => ({ ticker: c.ticker, weightPct: c.weightPct }))
      : basket.tickers.map((t) => ({ ticker: t }))
    : EXAMPLE_PARTS;
  return (
    <aside className={s.parts} aria-label={basket ? `Parts list for ${basket.name}` : "Example parts list"} data-testid="home-parts-list">
      <div className={s.partsKicker}>
        <span>Parts list</span>
        <span>{basket ? "Top basket" : "Example"}</span>
      </div>
      <h2 className={s.partsName}>{basket ? basket.name : "Example basket"}</h2>
      <p className={s.partsSub}>1 share contains</p>
      <ul className={s.partsRows}>
        {parts.map((p) => (
          <li key={p.ticker} className={s.partsRow}>
            <span className={s.partsTicker}>{p.ticker}</span>
            <span className={s.leader} aria-hidden="true" />
            {p.weightPct === undefined ? null : <span className={s.partsPct}>{formatPercent(p.weightPct, { ratio: false, digits: 1 })}</span>}
          </li>
        ))}
      </ul>
      <div className={s.partsFoot}>
        {basket ? (
          <>
            <span>
              NAV per share <span className="num">{basket.navValid ? formatUsd(basket.navPerShareUsd) : "n/a"}</span>
            </span>
            <Link href={`/b/${basket.address}`} className={s.more}>
              View basket
            </Link>
          </>
        ) : (
          <>
            <span>Weights are set by the curator.</span>
            <Link href="/assemble" className={s.more}>
              Assemble yours
            </Link>
          </>
        )}
      </div>
    </aside>
  );
}

export default async function HomePage() {
  const baskets = await listBaskets().catch(() => [] as BasketSummary[]);
  const top = topBaskets(baskets);
  return (
    <>
      <section className={s.hero}>
        <div className={s.heroText}>
          <h1>Build a basket of Stock Tokens.</h1>
          <p className={s.lede}>Share it. Earn $WIF when people buy it.</p>
          <div className={s.cta}>
            <ButtonLink href="/explore">Explore baskets</ButtonLink>
            <ButtonLink href="/assemble" variant="ghost">
              Assemble one
            </ButtonLink>
            <span className={s.onchain}>on Robinhood Chain</span>
          </div>
        </div>
        <PartsList basket={top[0]} />
      </section>

      <ol className={s.steps} aria-label="How it works">
        {STEPS.map((st) => (
          <li key={st.title} className={s.step}>
            <span className={s.stepNo} aria-hidden="true">
              {st.n}
            </span>
            <h3>{st.title}</h3>
            <p>{st.text}</p>
          </li>
        ))}
      </ol>

      <div className={s.kpiHead}>
        <h2>This week vs SPY</h2>
        <Link href="/explore" className={s.more}>
          Explore all
        </Link>
      </div>
      {top.length === 0 ? (
        <EmptyState title="No baskets yet" action={<ButtonLink href="/assemble">Assemble the first one</ButtonLink>}>
          Assemble the first one and earn $WIF from every buy.
        </EmptyState>
      ) : (
        <div className={s.cards}>
          {top.map((b) => (
            <BasketCard key={b.address} basket={b} />
          ))}
        </div>
      )}
    </>
  );
}
