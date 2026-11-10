"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Abi, Address } from "viem";
import { backingVaultAbi, basketAbi, feeHarvesterAbi } from "../../../../shared/abi/index.ts";
import { TxButton, type TxStep } from "../../components/tx/index.ts";
import { BeatBadge, Badge, ModeBadge } from "../../components/ui/Badge.tsx";
import { ButtonLink } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Table, type Column } from "../../components/ui/Table.tsx";
import { useConnection } from "wagmi";
import { getDeployment } from "../../lib/deployment.ts";
import { formatAmount, formatPts, formatShares, formatUsd, formatWif } from "../../lib/format.ts";
import type { ClaimDto, PortfolioDto, PositionDto } from "./data.ts";
import s from "./me.module.css";

type Sources = "dividends" | "backing" | "curator" | "referral" | "ious";

const COPY: Record<Sources, { title: string; why: string }> = {
  dividends: { title: "$WIF dividends", why: "From baskets you hold that pay dividends in $WIF." },
  backing: { title: "Backing rewards", why: "Your share when a basket you back beats SPY at the weekly settle." },
  curator: { title: "Curator rewards", why: "From baskets you published, released when they beat SPY." },
  referral: { title: "Referral $WIF", why: "A share of fees from baskets bought through your link." },
  ious: { title: "IOUs", why: "Owed for a Stock Token that was paused when you redeemed." },
};

const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** One-line total for a claim row: summed $WIF, or a count for IOUs (mixed tokens). */
function totalOf(source: Sources, items: ClaimDto[]): string {
  if (items.length === 0) return "—";
  if (source === "ious") return `${items.length} IOU${items.length > 1 ? "s" : ""}`;
  return `${fmtWif(items.reduce((a, c) => a + BigInt(c.amount), 0n).toString())} $WIF`;
}

const fmtWif = (v: string): string => formatWif(BigInt(v));

function stepsFor(source: Sources, items: ClaimDto[], account: Address): TxStep[] {
  const d = getDeployment().addresses;
  return items.map((c): TxStep => {
    const label = `${COPY[source].title}: ${c.name}`;
    switch (source) {
      case "dividends":
        return { id: `div-${c.basket}`, label, successTitle: "Dividends claimed", call: { address: c.basket, abi: basketAbi as Abi, functionName: "claimWifDividend", args: [account] } };
      case "backing":
        return { id: `back-${c.basket}`, label, successTitle: "Backing rewards claimed", call: { address: d.BackingVault, abi: backingVaultAbi as Abi, functionName: "claim", args: [c.basket, account] } };
      case "curator":
        return { id: `cur-${c.basket}`, label, successTitle: "Curator rewards claimed", call: { address: d.BackingVault, abi: backingVaultAbi as Abi, functionName: "claimCurator", args: [c.basket, account] } };
      case "referral":
        return { id: `ref-${c.basket}`, label, successTitle: "Referral $WIF claimed", call: { address: d.FeeHarvester, abi: feeHarvesterAbi as Abi, functionName: "claimReferral", args: [c.basket, (c.cycles ?? []).map(BigInt), account] } };
      case "ious":
        return { id: `iou-${c.basket}-${c.token}`, label, successTitle: `${c.ticker} IOU claimed`, call: { address: c.basket, abi: basketAbi as Abi, functionName: "claimIOU", args: [c.token, account] } };
    }
  });
}

const amountOf = (source: Sources, c: ClaimDto): string => (source === "ious" ? `${formatAmount(BigInt(c.amount), 18, { maxFraction: 6 })} ${c.ticker}` : `${fmtWif(c.amount)} $WIF`);

/** The portfolio: positions table, a "Claim everything" bar and one claim card per source. */
export function Portfolio({ queryAddress, initial }: { queryAddress?: Address; initial?: PortfolioDto }) {
  const { address: connected } = useConnection();
  const account = queryAddress ?? connected;
  const [data, setData] = useState<PortfolioDto | undefined>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (a: Address): Promise<void> => {
    setLoading(true);
    try {
      const r = await fetch(`/me/data?address=${a}`, { cache: "no-store" });
      const j = (await r.json()) as PortfolioDto & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Could not load the portfolio.");
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the portfolio.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!account) return;
    if (initial && initial.account.toLowerCase() === account.toLowerCase() && !data) setData(initial);
    else if (!data || data.account.toLowerCase() !== account.toLowerCase()) void load(account);
  }, [account, initial, data, load]);

  if (!account) {
    return <EmptyState title="Connect your wallet">Connect a wallet to see your baskets and everything you can claim. You can also open /me?address=0x… to look at any account.</EmptyState>;
  }
  const mine = Boolean(connected) && connected?.toLowerCase() === account.toLowerCase();
  const view = data && data.account.toLowerCase() === account.toLowerCase() ? data : undefined;

  const sources: Sources[] = ["dividends", "backing", "curator", "referral", "ious"];
  const columns: Column<PositionDto>[] = [
    { key: "basket", header: "Basket", sortValue: (p) => p.name, cell: (p) => <><Link href={`/b/${p.basket}`}>{p.name}</Link> <span className="muted mono">{p.symbol}</span></> },
    { key: "shares", header: "Shares", numeric: true, sortValue: (p) => Number(p.shares), cell: (p) => formatShares(BigInt(p.shares)) },
    { key: "value", header: "Value", numeric: true, sortValue: (p) => p.valueUsd, cell: (p) => formatUsd(p.valueUsd) },
    { key: "backed", header: "$WIF backed", numeric: true, sortValue: (p) => Number(p.backed), cell: (p) => (p.backed === "0" ? "–" : fmtWif(p.backed)) },
    { key: "vs", header: "vs SPY", sortValue: (p) => p.beatPts ?? -Infinity, cell: (p) => (p.beatPts === null ? <Badge>no reading yet</Badge> : <BeatBadge pts={p.beatPts} label={formatPts(p.beatPts)} />) },
    { key: "mode", header: "Dividends", cell: (p) => <ModeBadge mode={p.mode} /> },
  ];

  const allSteps = view && mine ? sources.flatMap((k) => stepsFor(k, view.claims[k], account)) : [];

  return (
    <div className={s.stack}>
      <p className={s.acct}>
        <span className="mono" title={account}>{shortAddr(account)}</span>
        {mine ? null : <span className={s.tag}>read-only</span>}
      </p>
      {error ? <p role="alert" className={s.err}>{"▼ "}{error}</p> : null}
      {!view ? <p className="muted" aria-busy="true">Loading from Robinhood Chain…</p> : null}

      {view ? (
        <>
          <section aria-labelledby="pos">
            <h2 id="pos">Positions</h2>
            {view.positions.length === 0 ? (
              <EmptyState title="No baskets yet" action={<ButtonLink href="/explore">Explore baskets</ButtonLink>}>
                When you buy a basket or back one with $WIF, it shows up here.
              </EmptyState>
            ) : (
              <Table columns={columns} rows={view.positions} rowKey={(p) => p.basket} caption="Your basket positions" defaultSort="value" />
            )}
          </section>

          <section aria-labelledby="claims">
            <div className={s.head}>
              <h2 id="claims">Claims</h2>
              {allSteps.length > 0 ? (
                <TxButton steps={allSteps} onSuccess={() => void load(account)}>{`Claim everything (${allSteps.length})`}</TxButton>
              ) : null}
            </div>
            {!mine && view ? <p className="muted">Connect this account's wallet to claim.</p> : null}
            <ul className={s.claims} data-testid="claim-cards">
              {sources.map((k) => {
                const items = view.claims[k];
                const has = items.length > 0;
                return (
                  <li key={k} className={has ? `${s.claim} ${s.claimOn}` : s.claim} data-testid={`claim-${k}`}>
                    <div className={s.claimMain}>
                      <span className={s.claimName}>{COPY[k].title}</span>
                      <span className={s.claimWhy}>{COPY[k].why}</span>
                    </div>
                    {has ? (
                      <span className={`num ${s.claimAmt}`}>{totalOf(k, items)}</span>
                    ) : (
                      <span className={`num ${s.claimNone}`}>
                        <span aria-hidden="true">—</span>
                        <span className="visually-hidden">Nothing to claim</span>
                      </span>
                    )}
                    {has ? (
                      <div className={s.claimDetail}>
                        <ul className={s.list}>
                          {items.map((c) => (
                            <li key={`${c.basket}-${c.token ?? ""}`}>
                              <Link href={`/b/${c.basket}`}>{c.name}</Link>
                              <span className="num">{amountOf(k, c)}</span>
                            </li>
                          ))}
                        </ul>
                        {mine ? <TxButton size="sm" steps={stepsFor(k, items, account)} onSuccess={() => void load(account)}>{`Claim ${COPY[k].title}`}</TxButton> : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {loading ? <p className="muted" aria-busy="true">Refreshing…</p> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
