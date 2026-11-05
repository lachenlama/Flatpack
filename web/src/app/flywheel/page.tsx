import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { InfoTip } from "../../components/ui/Tooltip.tsx";
import { StatTile } from "../../components/ui/StatTile.tsx";
import { explorerTx } from "../../lib/chain.ts";
import { formatUsd, formatUtc, formatUsdg, formatWif } from "../../lib/format.ts";
import { listBaskets } from "../../lib/reads/baskets.ts";
import { EMPTY_FLYWHEEL, flywheelStats, type FlywheelEvent } from "../../lib/reads/flywheel.ts";
import type { BasketSummary } from "../../lib/reads/types.ts";
import { FlywheelDiagram } from "./FlywheelDiagram.tsx";
import s from "./flywheel.module.css";

export const metadata: Metadata = { title: "Flywheel: every $WIF flow, live" };

const KIND: Record<FlywheelEvent["kind"], string> = { harvest: "Fee harvest", dividends: "Dividend harvest", settle: "Weekly settle" };

function describe(e: FlywheelEvent): string {
  if (e.kind === "harvest") return `${formatWif(e.wif, { maxFraction: 2 })} $WIF bought, ${formatWif(e.burned ?? 0n, { maxFraction: 2 })} burned`;
  if (e.kind === "dividends") return `${formatWif(e.wif, { maxFraction: 2 })} $WIF streamed to holders`;
  return e.beat ? "Beat SPY: rewards released" : `Behind SPY: ${formatWif(e.wif, { maxFraction: 2 })} $WIF burned`;
}

export default async function FlywheelPage() {
  const [stats, baskets] = await Promise.all([flywheelStats(), listBaskets().catch(() => [] as BasketSummary[])]);
  const f = stats ?? EMPTY_FLYWHEEL;
  const names = new Map(baskets.map((b) => [b.address.toLowerCase(), b.name]));
  const w = (v: bigint): string => formatWif(v, { maxFraction: 0 });
  return (
    <>
      <section className={s.hero} aria-labelledby="burned">
        <p className={s.heroLabel} id="burned">
          Total $WIF burned
          <InfoTip content="Sum of FeesHarvested.burned (FeeHarvester) and EpochSettled.burned (BackingVault), read from Robinhood Chain events since deployment. Burned = sent to the dead address." />
        </p>
        <div className={s.heroNum} data-testid="burned-total">{formatWif(f.burnedWif, { maxFraction: 2 })}</div>
        <p className={s.heroSub}>
          {formatWif(f.wifBought, { maxFraction: 0 })} $WIF bought with fees so far, {formatWif(f.burnedAtHarvest, { maxFraction: 0 })} burned at harvest and {formatWif(f.burnedAtSettle, { maxFraction: 0 })} burned at settle.
        </p>
      </section>

      <div className={s.kpis}>
        <StatTile label="$WIF to curators" value={w(f.toCurators)} sub="allocated at harvest" source="Sum of FeesHarvested.toVaultCurator." />
        <StatTile label="$WIF to backers" value={w(f.toBackers)} sub="allocated at harvest" source="Sum of FeesHarvested.toVaultBackers." />
        <StatTile label="$WIF to referrers" value={w(f.toReferrers)} sub="claimable per cycle" source="Sum of FeesHarvested.toReferrers." />
        <StatTile label="Dividends paid in $WIF" value={w(f.dividendsPaid)} sub="to holders of Pays $WIF baskets" source="Sum of DividendsHarvested.wifOut." />
        <StatTile label="Basket TVL" value={formatUsd(f.tvlUsd, { compact: true })} sub={`${f.basketCount} baskets`} source="Sum over baskets of totalSupply x BackingVault.navOf (Chainlink prices)." />
        <StatTile label="Buy volume" value={`${formatUsdg(f.buyVolumeUsdg)} USDG`} sub={`${f.buyCount} buys`} source="Sum of FlatpackRouter Bought.usdgSpent." />
      </div>

      <h2 className={s.h2}>How the flywheel turns</h2>
      <Card>
        <FlywheelDiagram
          edges={{
            volume: `${formatUsdg(f.buyVolumeUsdg)} USDG`,
            bought: `${w(f.wifBought)} $WIF`,
            burn: `${w(f.burnedAtHarvest)} $WIF`,
            backers: `${w(f.toBackers)} $WIF`,
            curators: `${w(f.toCurators)} $WIF`,
            referrers: `${w(f.toReferrers)} $WIF`,
            dividends: `${w(f.dividendsPaid)} $WIF`,
            settleBurn: `${w(f.burnedAtSettle)} $WIF`,
            released: `${w(f.releasedBackers + f.releasedCurator)} $WIF`,
          }}
        />
        <p className="muted" style={{ fontSize: "0.88rem", margin: "12px 0 0" }}>
          Every number is summed from on-chain events. The split of each harvest is fixed in the FeeHarvester contract: half of all $WIF bought is burned, referrers are paid their share of the fees they brought in, and the remainder goes to backers and the curator in a 3:2 ratio (the 30% / 20% split; ADR-0004). Backer and curator rewards are only released when the basket beats SPY that week, and are burned otherwise. Nothing here is investment advice, and $WIF has no promise of value.
        </p>
      </Card>

      <h2 className={s.h2}>Latest 20 events</h2>
      {f.recent.length === 0 ? (
        <EmptyState title="No harvests yet">The first fee harvest or weekly settle will appear here with its transaction link.</EmptyState>
      ) : (
        <ol className={s.feed} aria-label="Latest harvests and settlements">
          {f.recent.map((e) => (
            <li key={`${e.transactionHash}-${e.kind}-${e.basket}`}>
              <Badge tone={e.kind === "settle" && !e.beat ? "warning" : "neutral"} icon={e.kind === "settle" ? "◐" : "🔥"}>{KIND[e.kind]}</Badge>
              <span>
                <Link href={`/b/${e.basket}`}>{names.get(e.basket.toLowerCase()) ?? e.basket.slice(0, 10)}</Link>: {describe(e)}
              </span>
              <span className="muted num">{e.timestamp ? formatUtc(e.timestamp, true) : `block ${e.blockNumber}`}</span>
              <a href={explorerTx(e.transactionHash)} target="_blank" rel="noreferrer">tx {e.transactionHash.slice(0, 10)}…</a>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
