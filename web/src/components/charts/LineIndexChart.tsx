"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import s from "./charts.module.css";

/** One line of a {@link LineIndexChart}. Values are already indexed (100 at the start). */
export interface IndexSeries {
  id: string;
  /** Direct label and legend text, e.g. "Basket" / "SPY". */
  label: string;
  /** `series-1` is the basket, `series-2` the SPY benchmark. Chart colors only. */
  tone: "series-1" | "series-2";
  /** 2px dashed line (the benchmark). */
  dashed?: boolean;
  /** One value per entry in `times`; null/NaN = gap. */
  values: readonly (number | null)[];
}

/** Props of {@link LineIndexChart}. */
export interface LineIndexChartProps {
  /** Unix seconds, ascending, one per point. */
  times: readonly number[];
  /** 1 to 3 series sharing ONE axis (never dual axes). */
  series: readonly IndexSeries[];
  /** Screen-reader summary, e.g. "Basket vs SPY indexed to 100, up 4.2 versus up 1.1". */
  ariaLabel: string;
  /** SVG aspect height in viewBox units (default 300). */
  height?: number;
  /** Optional note appended to the table caption (e.g. "hypothetical"). */
  note?: string;
}

const W = 680;
const M = { top: 12, right: 112, bottom: 26, left: 44 };

const fmtDate = (t: number): string => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtDateLong = (t: number): string =>
  new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = Math.max(max - min, 0.5);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw) as number;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.999; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** Spread label y positions so they are at least `gap` apart, keeping order. */
function spreadLabels(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1] as { y: number; i: number };
    const cur = order[k] as { y: number; i: number };
    if (cur.y - prev.y < gap) cur.y = prev.y + gap;
  }
  const over = (order[order.length - 1]?.y ?? 0) - hi;
  if (over > 0) order.forEach((o) => (o.y = Math.max(lo, o.y - over)));
  const out = [...ys];
  order.forEach((o) => (out[o.i] = o.y));
  return out;
}

/**
 * Hand-built SVG line chart for indexed-to-100 series on a SINGLE axis (WP5-UX §5): recessive grid, 2px lines (benchmark dashed),
 * direct end labels with values, crosshair + tooltip (date, each value, gap in pts), arrow-key navigation, a legend and a
 * "View as table" toggle. Series colors are used for lines and dots only; all text is ink.
 */
export function LineIndexChart({ times, series, ariaLabel, height = 300, note }: LineIndexChartProps) {
  const uid = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const geo = useMemo(() => {
    const vals = series.flatMap((x) => x.values.filter((v): v is number => v !== null && Number.isFinite(v)));
    if (vals.length === 0 || times.length < 2) return null;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.12, 0.4);
    const ticks = niceTicks(lo - pad, hi + pad, 4);
    const yMin = Math.min(ticks[0] as number, lo - pad);
    const yMax = Math.max(ticks[ticks.length - 1] as number, hi + pad);
    const t0 = times[0] as number;
    const t1 = times[times.length - 1] as number;
    const iw = W - M.left - M.right;
    const ih = height - M.top - M.bottom;
    const x = (t: number): number => M.left + ((t - t0) / Math.max(t1 - t0, 1)) * iw;
    const y = (v: number): number => M.top + (1 - (v - yMin) / (yMax - yMin)) * ih;
    const xt = [0, 1, 2, 3, 4].map((k) => t0 + ((t1 - t0) * k) / 4);
    return { ticks, x, y, xt, ih, iw, t0, t1 };
  }, [series, times, height]);

  if (!geo) {
    return <div className="muted" role="img" aria-label={ariaLabel}>Not enough price history yet to draw a chart.</div>;
  }
  const { ticks, x, y, xt } = geo;

  const pathFor = (vals: readonly (number | null)[]): string => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(times[i] as number).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const lastIdx = (vals: readonly (number | null)[]): number => {
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null && Number.isFinite(vals[i])) return i;
    return -1;
  };
  const ends = series.map((sr) => {
    const i = lastIdx(sr.values);
    return { sr, i, v: i >= 0 ? (sr.values[i] as number) : null };
  });
  const labelYs = spreadLabels(
    ends.map((e) => (e.v === null ? 0 : y(e.v))),
    15,
    M.top + 6,
    height - M.bottom,
  );

  const moveTo = (clientX: number): void => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const t = geo.t0 + ((px - M.left) / geo.iw) * (geo.t1 - geo.t0);
    let best = 0;
    let bd = Infinity;
    times.forEach((tt, i) => {
      const d = Math.abs(tt - t);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>): void => {
    if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? times.length) - 1));
    else if (e.key === "ArrowRight") setHover((h) => Math.min(times.length - 1, (h ?? -1) + 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  const colorVar = (tone: IndexSeries["tone"]): string => `var(--${tone})`;
  const first = series[0];
  const second = series[1];
  const gapAt = (i: number): number | null => {
    const a = first?.values[i];
    const b = second?.values[i];
    return a != null && b != null ? a - b : null;
  };
  const hoverLeftPct = hover === null ? 0 : (x(times[hover] as number) / W) * 100;

  return (
    <div className={s.chart}>
      <div className={s.legend}>
        {series.map((sr) => (
          <span key={sr.id} className={s.legendItem}>
            <span className={`${s.swatch} ${sr.dashed ? s.swatchDashed : ""}`} style={{ color: colorVar(sr.tone) }} aria-hidden="true" />
            <span style={{ color: "var(--ink)" }}>{sr.label}</span>
          </span>
        ))}
        <button type="button" className={s.toggle} onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? "View as chart" : "View as table"}
        </button>
      </div>

      {table ? (
        <div className={s.tableWrap}>
          <table className={s.dataTable}>
            <caption className="visually-hidden">
              {ariaLabel}
              {note ? ` (${note})` : ""}
            </caption>
            <thead>
              <tr>
                <th scope="col">Date (UTC)</th>
                {series.map((sr) => (
                  <th scope="col" key={sr.id}>
                    {sr.label}
                  </th>
                ))}
                {second ? <th scope="col">Gap (pts)</th> : null}
              </tr>
            </thead>
            <tbody>
              {times.map((t, i) => (
                <tr key={t}>
                  <td>{fmtDateLong(t)}</td>
                  {series.map((sr) => (
                    <td key={sr.id}>{sr.values[i] == null ? "–" : (sr.values[i] as number).toFixed(1)}</td>
                  ))}
                  {second ? <td>{gapAt(i) === null ? "–" : (gapAt(i) as number).toFixed(1)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg
            ref={ref}
            className={s.svg}
            viewBox={`0 0 ${W} ${height}`}
            role="img"
            aria-label={ariaLabel}
            aria-describedby={`${uid}-help`}
            tabIndex={0}
            onPointerMove={(e: PointerEvent<SVGSVGElement>) => moveTo(e.clientX)}
            onPointerDown={(e: PointerEvent<SVGSVGElement>) => moveTo(e.clientX)}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
          >
            <desc id={`${uid}-help`}>Use left and right arrow keys to read values. A table view is available.</desc>
            {ticks.map((tv) => (
              <g key={tv}>
                <line className={s.grid} x1={M.left} x2={W - M.right} y1={y(tv)} y2={y(tv)} />
                <text className={s.axisText} x={M.left - 8} y={y(tv) + 4} textAnchor="end">
                  {tv.toFixed(Math.abs(tv - Math.round(tv)) < 1e-6 ? 0 : 1)}
                </text>
              </g>
            ))}
            {xt.map((t, k) => (
              <text key={k} className={s.axisText} x={x(t)} y={height - 6} textAnchor={k === 0 ? "start" : k === xt.length - 1 ? "end" : "middle"}>
                {fmtDate(t)}
              </text>
            ))}
            {series.map((sr) => (
              <path
                key={sr.id}
                d={pathFor(sr.values)}
                fill="none"
                stroke={colorVar(sr.tone)}
                strokeWidth={2}
                strokeDasharray={sr.dashed ? "6 4" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {ends.map((e, k) =>
              e.v === null ? null : (
                <g key={e.sr.id}>
                  <circle cx={x(times[e.i] as number)} cy={y(e.v)} r={4} fill={colorVar(e.sr.tone)} />
                  <text className={s.endLabel} x={x(times[e.i] as number) + 9} y={(labelYs[k] as number) + 4} fill="var(--ink)">
                    {e.sr.label} {e.v.toFixed(1)}
                  </text>
                </g>
              ),
            )}
            {hover !== null ? (
              <g>
                <line className={s.cross} x1={x(times[hover] as number)} x2={x(times[hover] as number)} y1={M.top} y2={height - M.bottom} />
                {series.map((sr) => {
                  const v = sr.values[hover];
                  return v == null ? null : (
                    <circle key={sr.id} cx={x(times[hover] as number)} cy={y(v)} r={4} fill="var(--paper)" stroke={colorVar(sr.tone)} strokeWidth={2} />
                  );
                })}
              </g>
            ) : null}
          </svg>
          {hover !== null ? (
            <div
              className={s.tooltip}
              role="status"
              style={{ left: `${Math.min(Math.max(hoverLeftPct, 18), 62)}%`, top: 40, transform: "translateX(-50%)" }}
            >
              <div className={s.tipDate}>{fmtDateLong(times[hover] as number)}</div>
              {series.map((sr) => (
                <div key={sr.id} className={s.tipRow}>
                  <span className={s.tipKey}>
                    <span className={`${s.swatch} ${sr.dashed ? s.swatchDashed : ""}`} style={{ color: colorVar(sr.tone), width: 14 }} aria-hidden="true" />
                    {sr.label}
                  </span>
                  <span className="num">{sr.values[hover] == null ? "–" : (sr.values[hover] as number).toFixed(1)}</span>
                </div>
              ))}
              {second && gapAt(hover) !== null ? (
                <div className={s.tipRow}>
                  <span>Gap</span>
                  <span className="num">
                    {(gapAt(hover) as number) >= 0 ? "+" : "−"}
                    {Math.abs(gapAt(hover) as number).toFixed(1)} pts
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
