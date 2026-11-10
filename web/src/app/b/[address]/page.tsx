import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAddress, isAddress } from "viem";
import { BarList } from "../../../components/charts/index.ts";
import { Badge, BeatBadge, ModeBadge } from "../../../components/ui/Badge.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Countdown } from "../../../components/ui/Countdown.tsx";
import { EmptyState } from "../../../components/ui/EmptyState.tsx";
import { InfoTip } from "../../../components/ui/Tooltip.tsx";
import { SITE_URL, explorerAddress, explorerTx } from "../../../lib/chain.ts";
import { formatPercent, formatPts, formatWif, shortAddress } from "../../../lib/format.ts";
import { getMarketData, type MarketData } from "../../../lib/prices.ts";
import { basketDetail, listBaskets } from "../../../lib/reads/baskets.ts";
import { blockTimestamps, dividendsHarvestedLogs, feesHarvestedLogs } from "../../../lib/reads/events.ts";
import { basketSeries, type BasketSeries } from "../../../lib/reads/series.ts";
import { vaultState } from "../../../lib/reads/vault.ts";
import { holderCount } from "../../explore/data.ts";
import { BackingCard } from "./BackingCard.tsx";
import { ChartPanel, type SeriesData } from "./ChartPanel.tsx";
import { PositionCard } from "./PositionCard.tsx";
import { ShareBar } from "./ShareBar.tsx";
import { TradePanel } from "./TradePanel.tsx";
import { corporateNotice, isMarketClosed } from "./states.ts";
import type { BasketView } from "./types.ts";
import { formatWhen } from "./when.ts";
import s from "./basket.module.css";

type Props = { params: Promise<{ address: string }>; searchParams: Promise<{ ref?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  const b = isAddress(address) ? await basketDetail(address).catch(() => undefined) : undefined;
  if (!b) return { title: "Basket" };
  const title = `${b.name} on Flatpack`;
  const description = `${b.tickers.join(", ")}: a basket of Stock Tokens on Robinhood Chain. Performance vs SPY, not investment advice.`;
  const image = `${SITE_URL}/api/og/${b.address}`;
  return {
    title: b.name,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

const toSeries = (r: BasketSeries | undefined): SeriesData | null =>
  r && r.points.length >= 2 ? { times: r.points.map((p) => p.t), basket: r.points.map((p) => p.basket), spy: r.points.map((p) => p.spy) } : null;

/** Next's notFound() throws a tagged error; do not swallow it in a catch. */
const isNotFoundError = (e: unknown): boolean => typeof e === "object" && e !== null && String((e as { digest?: unknown }).digest ?? "").startsWith("NEXT_HTTP_ERROR_FALLBACK");

const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

/** Loads both chart series and renders the panel; wrapped in <Suspense> so a slow RPC never blocks the page. */
async function ChartSection({ address }: { address: `0x${string}` }) {
  const [launch, recipe] = await Promise.all([safe(basketSeries(address, "launch"), undefined), safe(basketSeries(address, "recipe"), undefined)]);
  return <ChartPanel launch={toSeries(launch)} recipe={toSeries(recipe)} />;
}

export default async function BasketPage({ params, searchParams }: Props) {
  const { address: raw } = await params;
  const sp = await searchParams;
  if (!isAddress(raw)) notFound();
  const address = getAddress(raw);
  const refParam = Array.isArray(sp.ref) ? sp.ref[0] : sp.ref;
  const ref = refParam && isAddress(refParam) ? getAddress(refParam) : undefined;

  let b;
  try {
    // basketDetail throws for an address that is not a basket, so check membership first (unknown address = 404).
    const known = await listBaskets();
    if (!known.some((k) => k.address.toLowerCase() === address.toLowerCase())) notFound();
    b = await basketDetail(address);
  } catch (err) {
    if (isNotFoundError(err)) throw err;
    return (
      <EmptyState title="Can't read this basket right now">The chain RPC did not answer, or no deployment is configured. Try again in a moment.</EmptyState>
    );
  }
  if (!b) notFound();

  const empty: MarketData = { ok: false, session: "closed", tokens: {} };
  // The two price-history series are NOT awaited here: they take ~20 sequential RPC round trips per feed, so they stream in
  // behind a Suspense boundary (see ChartSection) and the rest of the page, including Buy, is interactive straight away.
  const [market, vault, fees, divs, holders] = await Promise.all([
    safe(getMarketData(), empty),
    safe(vaultState(address), undefined),
    safe(feesHarvestedLogs(address), []),
    safe(dividendsHarvestedLogs(address), []),
    holderCount(address),
  ]);

  const nowSec = Math.floor(Date.now() / 1000);
  const updated = b.components.map((c) => c.feedUpdatedAt).filter((x): x is number => x !== undefined);
  const oldest = updated.length ? Math.min(...updated) : undefined;
  const marketClosed = isMarketClosed(market.session, oldest, nowSec);

  const comps = b.components.map((c) => {
    const m = market.tokens[c.ticker];
    return {
      token: c.token,
      ticker: c.ticker,
      paused: c.paused,
      halted: m?.isTradingHalt ?? false,
      corporate: m?.pendingMultiplier ?? false,
    };
  });
  const view: BasketView = {
    address,
    name: b.name,
    mode: b.mode,
    navPerShareUsd: b.navPerShareUsd,
    navValid: b.navValid,
    comps,
    marketClosed,
    nextSettleAt: b.nextSettleAt,
    ref,
  };

  // $WIF from this basket
  const sum = (f: (x: (typeof fees)[number]["args"]) => bigint): bigint => fees.reduce((a, l) => a + f(l.args), 0n);
  const burned = sum((x) => x.burned);
  const toCurator = sum((x) => x.toVaultCurator);
  const toBackers = sum((x) => x.toVaultBackers);
  const toReferrers = sum((x) => x.toReferrers);
  const dividends = divs.reduce((a, l) => a + l.args.wifOut, 0n);
  const recent = [...fees].sort((a, c) => Number(c.blockNumber - a.blockNumber)).slice(0, 5);
  const stamps = recent.length ? await safe(blockTimestamps(recent.map((l) => l.blockNumber)), new Map<bigint, number>()) : new Map<bigint, number>();

  const e = b.epoch;
  const sessionBadge =
    market.session === "open" ? (
      <Badge tone="good" icon={"●"}>Markets open</Badge>
    ) : market.session === "extended" ? (
      <Badge tone="warning" icon={"◐"}>Extended hours</Badge>
    ) : (
      <Badge tone="neutral" icon={"○"}>Markets closed</Badge>
    );

  const usd = (n: number): string => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  return (
    <>
      <div className={s.top}>
        <div>
          <div className={s.title}>
            <h1>{b.name}</h1>
            <ModeBadge mode={b.mode} />
          </div>
          <p className={s.byline}>
            by{" "}
            <a className="mono" href={explorerAddress(b.curator)} target="_blank" rel="noopener noreferrer" title={`${b.curator} on the explorer`}>
              {shortAddress(b.curator)}
            </a>
          </p>
          <dl className={s.stats}>
            <div>
              <dt>Holders</dt>
              <dd className="num" data-testid="holders">{holders === undefined ? "n/a" : holders}</dd>
            </div>
            <div>
              <dt>TVL</dt>
              <dd className="num" data-testid="tvl">{usd(b.tvlUsd)}</dd>
            </div>
            <div>
              <dt>NAV/share</dt>
              <dd className="num">{b.navValid ? usd(b.navPerShareUsd) : "n/a"}</dd>
            </div>
          </dl>
          <div className={s.market} data-testid="market-status">
            {sessionBadge}
            <span>
              Prices as of {oldest !== undefined ? <span className="num">{formatWhen(oldest)}</span> : "n/a"} (Chainlink){" "}
              <InfoTip content="Stock Token prices come from Chainlink feeds, which only update while US markets trade. Market-session and trading-halt flags come from the public Stock Token price API documented for Robinhood Chain." />
            </span>
          </div>
          {b.mode === "PayInWif" ? <p className={`muted ${s.small}`} style={{ margin: "8px 0 0" }}>Dividends paid to holders in $WIF.</p> : null}
        </div>
        <ShareBar address={address} name={b.name} />
      </div>

      {comps.some((c) => c.corporate) ? (
        <div className={s.notice} role="status">
          {corporateNotice(comps.filter((c) => c.corporate).map((c) => c.ticker))}.
        </div>
      ) : null}

      <div className={`${s.grid} ${s.main}`}>
        <div className={`${s.stack} ${s.side}`}>
          <TradePanel view={view} />
          <PositionCard view={view} />
        </div>

        <div className={`${s.stack} ${s.left}`}>
          <Suspense
            fallback={
              <Card title="NAV vs SPY (indexed to 100)" className={s.chartCard}>
                <p className="muted" role="status">Loading price history from Chainlink…</p>
              </Card>
            }
          >
            <ChartSection address={address} />
          </Suspense>
          <Card title="Holdings (per share)">
            <BarList
              ariaLabel="Basket holdings by weight"
              items={b.components.map((c) => {
                const m = market.tokens[c.ticker];
                const age = c.feedUpdatedAt ? `${Math.max(0, Math.round((nowSec - c.feedUpdatedAt) / 60))} min ago` : "unknown";
                return {
                  key: c.token,
                  label: c.ticker,
                  value: c.weightPct,
                  display: `${c.weightPct.toFixed(1)}%`,
                  sub: ` ${c.unitsPerShare.toFixed(4)}${c.paused ? " paused" : m?.isTradingHalt ? " halted" : ""}`,
                  detail: `${c.ticker}: ${c.priceUsd !== undefined ? `$${c.priceUsd.toFixed(2)}` : "no price"}, feed updated ${age}, multiplier ${(Number(c.uiMultiplier) / 1e18).toFixed(4)}`,
                };
              })}
            />
            <p className={`muted ${s.small}`}>Each share holds these Stock Tokens directly. Weight is share of USD value at Chainlink prices.</p>
          </Card>
        </div>
      </div>

      <div className={`${s.grid} ${s.three}`}>
        <Card title="This week vs SPY">
          <p className={s.settle}>
            Settles <span className="num">{formatWhen(b.nextSettleAt)}</span> · in <Countdown to={b.nextSettleAt} done="due now" />
          </p>
          {e ? (
            <>
              <div className={s.row}>
                <span>Basket</span>
                <span className="num">{formatPercent(e.basketPct, { sign: true })}</span>
              </div>
              <div className={s.row}>
                <span>SPY</span>
                <span className="num">{formatPercent(e.benchPct, { sign: true })}</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <BeatBadge pts={e.beatPts} label={formatPts(e.beatPts)} />
              </div>
              <p className={`muted ${s.small}`} style={{ marginTop: 8 }}>
                {Math.abs(e.beatPts) < 0.05
                  ? "Level with SPY right now; the settle decides whether the week's queued $WIF rewards are released or burned."
                  : e.beating
                  ? "Beating SPY right now: if it holds at the settle, the week's queued $WIF rewards are released to backers and the curator."
                  : "Behind SPY right now: if it stays behind at the settle, the week's queued $WIF rewards are burned."}
              </p>
            </>
          ) : (
            <p className={`muted ${s.small}`}>No reading yet. The first one appears after the next price update.</p>
          )}
        </Card>

        <BackingCard view={view} backed={b.wifBacked} warmingTotal={vault?.totalWarming ?? 0n} />

        <Card title="$WIF from this basket">
          <div className={s.row}>
            <span>Burned</span>
            <span className="num">{formatWif(burned, { maxFraction: 0 })}</span>
          </div>
          <div className={s.row}>
            <span>To curator</span>
            <span className="num">{formatWif(toCurator, { maxFraction: 0 })}</span>
          </div>
          <div className={s.row}>
            <span>To backers</span>
            <span className="num">{formatWif(toBackers, { maxFraction: 0 })}</span>
          </div>
          <div className={s.row}>
            <span>To referrers</span>
            <span className="num">{formatWif(toReferrers, { maxFraction: 0 })}</span>
          </div>
          <div className={s.row}>
            <span>Paid as dividends</span>
            <span className="num">{formatWif(dividends, { maxFraction: 0 })}</span>
          </div>
          <h4 className={s.subhead}>Recent harvests</h4>
          {recent.length === 0 ? (
            <p className={`muted ${s.small}`}>No fees harvested yet. The keeper turns buy fees into $WIF each cycle.</p>
          ) : (
            <ul className={s.harvests}>
              {recent.map((l) => {
                const at = stamps.get(l.blockNumber);
                return (
                  <li key={`${l.transactionHash}-${l.logIndex}`}>
                    <span className={s.harvestWhen}>{at ? formatWhen(at) : `block ${l.blockNumber}`}</span>
                    <span className="num">{formatWif(l.args.wifOut, { maxFraction: 0 })} $WIF</span>
                    <a
                      href={explorerTx(l.transactionHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View harvest transaction ${shortAddress(l.transactionHash)} on the explorer`}
                    >
                      View
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <p className={s.legal}>
        Basket contract{" "}
        <a href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" className="mono">
          {shortAddress(address)}
        </a>
      </p>
    </>
  );
}
