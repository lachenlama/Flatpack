"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Badge, BeatBadge, ModeBadge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { TickerChips } from "../../components/ui/Chip.tsx";
import { Sparkline } from "../../components/charts/index.ts";
import { formatPercent, formatPts, formatUsd } from "../../lib/format.ts";
import type { BasketMode } from "../../lib/reads/types.ts";
import s from "./explore.module.css";

/** Plain, serialisable leaderboard row (built on the server). */
export interface ExploreRow {
  address: string;
  name: string;
  tickers: string[];
  mode: BasketMode;
  /** Basket minus SPY this epoch, percentage points; null before the first reading. */
  beatPts: number | null;
  /** Percent change since launch; null when history is unavailable. */
  sincePct: number | null;
  /** Up to 7 daily index values (100 = launch). */
  spark: number[];
  tvlUsd: number;
  /** $WIF staked behind the basket, whole tokens. */
  wifBacked: number;
  holders: number | null;
  /** Factory order (higher = newer). */
  order: number;
}

type SortKey = "beat" | "wif" | "tvl" | "newest";
const SORTS: { key: SortKey; label: string; value: (r: ExploreRow) => number }[] = [
  { key: "beat", label: "vs SPY this week", value: (r) => r.beatPts ?? -Infinity },
  { key: "wif", label: "$WIF backed", value: (r) => r.wifBacked },
  { key: "tvl", label: "TVL", value: (r) => r.tvlUsd },
  { key: "newest", label: "Newest", value: (r) => r.order },
];

const wifText = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function Beat({ pts }: { pts: number | null }) {
  return pts === null ? <Badge>no reading yet</Badge> : <BeatBadge pts={pts} label={formatPts(pts)} />;
}
const since = (p: number | null): string => (p === null ? "n/a" : formatPercent(p, { sign: true }));

interface Column {
  key: string;
  header: string;
  cell: (r: ExploreRow) => ReactNode;
  sortValue: (r: ExploreRow) => number | string;
  numeric?: boolean;
}

/** Explore leaderboard: sortable table on desktop, sortable cards on mobile. */
export function ExploreView({ rows }: { rows: ExploreRow[] }) {
  const [sort, setSort] = useState<SortKey>("beat");
  const cards = useMemo(() => {
    const f = SORTS.find((x) => x.key === sort)!.value;
    return [...rows].sort((a, b) => f(b) - f(a));
  }, [rows, sort]);

  const router = useRouter();
  const [tsort, setTsort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "beat", dir: "desc" });

  const columns: Column[] = [
    {
      key: "name",
      header: "Basket",
      cell: (r) => (
        <div className={s.nameCell}>
          <Link href={`/b/${r.address}`} className={s.rowLink}>{r.name}</Link>
          <TickerChips tickers={r.tickers} max={6} />
        </div>
      ),
      sortValue: (r) => r.name.toLowerCase(),
    },
    { key: "beat", header: "vs SPY this week", cell: (r) => <Beat pts={r.beatPts} />, sortValue: (r) => r.beatPts ?? -1e9 },
    {
      key: "since",
      header: "Since launch",
      numeric: true,
      cell: (r) =>
        r.spark.length >= 2 ? (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <Sparkline values={r.spark} lastLabel={r.spark[r.spark.length - 1]!.toFixed(1)} ariaLabel={`Index, last 7 days, ${since(r.sincePct)} since launch`} />
            <span>{since(r.sincePct)}</span>
          </span>
        ) : (
          <span className="muted">{since(r.sincePct)}</span>
        ),
      sortValue: (r) => r.sincePct ?? -1e9,
    },
    { key: "tvl", header: "TVL", numeric: true, cell: (r) => formatUsd(r.tvlUsd, { compact: true }), sortValue: (r) => r.tvlUsd },
    { key: "wif", header: "$WIF backed", numeric: true, cell: (r) => wifText(r.wifBacked), sortValue: (r) => r.wifBacked },
    { key: "holders", header: "Holders", numeric: true, cell: (r) => (r.holders === null ? "n/a" : String(r.holders)), sortValue: (r) => r.holders ?? -1 },
    { key: "mode", header: "Dividends", cell: (r) => <ModeBadge mode={r.mode} />, sortValue: (r) => r.mode },
  ];

  const sortedRows = useMemo(() => {
    const col = columns.find((c) => c.key === tsort.key);
    if (!col) return rows;
    const sign = tsort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.sortValue(a);
      const y = col.sortValue(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sign;
    });
  }, [rows, tsort]);

  const openRow = (e: React.MouseEvent, address: string): void => {
    if ((e.target as HTMLElement).closest("a, button")) return; // the link handles its own click
    router.push(`/b/${address}`);
  };

  return (
    <>
      <div className={s.tools}>
        <label htmlFor="explore-sort">Sort by</label>
        <select id="explore-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className={s.desktop}>
        <p className={s.explainer}>Ranked by performance against SPY this week. Resets Saturday 02:00 UTC.</p>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <caption className="visually-hidden">
              Baskets ranked by performance versus SPY this week (resets every Saturday 02:00 UTC). Performance since launch is past performance, not a forecast.
            </caption>
            <thead>
              <tr>
                {columns.map((c) => {
                  const active = tsort.key === c.key;
                  return (
                    <th key={c.key} scope="col" className={c.numeric ? s.right : undefined} aria-sort={active ? (tsort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button
                        type="button"
                        className={s.sortBtn}
                        onClick={() => setTsort({ key: c.key, dir: active && tsort.dir === "desc" ? "asc" : "desc" })}
                      >
                        {c.header}
                        <span className={active ? s.arrowOn : s.arrow} aria-hidden="true">{active ? (tsort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.address} className={s.row} onClick={(e) => openRow(e, r.address)}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.numeric ? `${s.right} num` : undefined}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={s.fine}>Since launch is past performance, not a forecast.</p>
      </div>

      <div className={s.mobile} aria-label="Baskets">
        {cards.map((r) => (
          <Link key={r.address} href={`/b/${r.address}`} className={s.cardLink}>
            <Card as="article">
              <div className={s.cardTop}>
                <span className={s.cardName}>{r.name}</span>
                <ModeBadge mode={r.mode} />
              </div>
              <TickerChips tickers={r.tickers} max={6} />
              <div className={s.cardRow}>
                <span>vs SPY this week</span>
                <Beat pts={r.beatPts} />
              </div>
              <div className={s.cardRow}>
                <span>Since launch</span>
                {r.spark.length >= 2 ? (
                  <Sparkline values={r.spark} lastLabel={since(r.sincePct)} ariaLabel={`Index, last 7 days, ${since(r.sincePct)} since launch`} />
                ) : (
                  <span className="num">{since(r.sincePct)}</span>
                )}
              </div>
              <div className={s.cardRow}>
                <span>
                  TVL <span className="num">{formatUsd(r.tvlUsd, { compact: true })}</span>
                </span>
                <span>
                  $WIF backed <span className="num">{wifText(r.wifBacked)}</span>
                </span>
                <span>
                  Holders <span className="num">{r.holders ?? "n/a"}</span>
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
