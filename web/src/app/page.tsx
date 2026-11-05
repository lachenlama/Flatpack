import Link from "next/link";
import { BasketCard } from "../components/BasketCard.tsx";
import { ButtonLink } from "../components/ui/Button.tsx";
import { EmptyState } from "../components/ui/EmptyState.tsx";
import { StatTile } from "../components/ui/StatTile.tsx";
import { formatUsd, formatWif } from "../lib/format.ts";
import { listBaskets } from "../lib/reads/baskets.ts";
import { EMPTY_FLYWHEEL, flywheelStats } from "../lib/reads/flywheel.ts";
import type { BasketSummary } from "../lib/reads/types.ts";
import s from "./page.module.css";

const STEPS = [
  { n: "①", title: "Assemble", text: "Pick 2 to 8 Stock Tokens and set weights. Stake $WIF behind your thesis." },
  { n: "②", title: "Share", text: "Publish your basket and share its card on X with your referral link." },
  { n: "③", title: "Buy in one tx", text: "Anyone buys the whole basket with USDG in one transaction. Redeem in kind, any time." },
  { n: "④", title: "Fees → $WIF", text: "Every fee buys $WIF: half is burned, the rest rewards curators, backers and referrers." },
];

/** Beat-SPY ranking: baskets with an epoch reading first (best first), then by TVL. */
function topBaskets(all: BasketSummary[]): BasketSummary[] {
  return [...all]
    .sort((a, b) => (b.epoch?.beatPts ?? -Infinity) - (a.epoch?.beatPts ?? -Infinity) || b.tvlUsd - a.tvlUsd)
    .slice(0, 3);
}

export default async function HomePage() {
  const [stats, baskets] = await Promise.all([flywheelStats(), listBaskets().catch(() => [] as BasketSummary[])]);
  const f = stats ?? EMPTY_FLYWHEEL;
  const top = topBaskets(baskets);
  return (
    <>
      <section className={s.hero}>
        <h1>Build a basket of Stock Tokens.</h1>
        <p className={s.lede}>Share it. Earn $WIF when people buy it.</p>
        <div className={s.cta}>
          <ButtonLink href="/explore">Explore baskets</ButtonLink>
          <ButtonLink href="/assemble" variant="ghost">
            Assemble one
          </ButtonLink>
          <span className={s.onchain}>on Robinhood Chain</span>
        </div>
      </section>

      <ol className={s.steps} aria-label="How it works">
        {STEPS.map((st) => (
          <li key={st.title} className={s.step}>
            <span className={s.num} aria-hidden="true">
              {st.n}
            </span>
            <h3>{st.title}</h3>
            <p>{st.text}</p>
          </li>
        ))}
      </ol>

      <div className={s.kpiHead}>
        <h2>The flywheel, live</h2>
        <span className="muted">Read from Robinhood Chain events, no indexer</span>
      </div>
      <div className={s.kpis}>
        <StatTile
          label="$WIF burned"
          value={formatWif(f.burnedWif, { maxFraction: 0 })}
          sub={`${f.harvestCount} harvests, ${f.settleCount} settles`}
          source="Sum of FeesHarvested.burned (FeeHarvester) and EpochSettled.burned (BackingVault), since deployment."
        />
        <StatTile
          label="$WIF to curators"
          value={formatWif(f.toCurators, { maxFraction: 0 })}
          sub="allocated at harvest"
          source="Sum of FeesHarvested.toVaultCurator. Released to curators when their basket beats SPY at the weekly settle."
        />
        <StatTile
          label="Basket TVL"
          value={formatUsd(f.tvlUsd, { compact: true })}
          sub={`${f.buyCount} buys`}
          source="Sum over baskets of totalSupply x BackingVault.navOf (Chainlink prices)."
        />
        <StatTile label="Baskets" value={String(baskets.length || f.basketCount)} source="BasketFactory.basketCount()." />
      </div>

      <div className={s.kpiHead}>
        <h2>Top this week (Beat-SPY)</h2>
        <Link href="/explore">Explore all {"→"}</Link>
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
