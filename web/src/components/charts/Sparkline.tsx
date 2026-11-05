import s from "./charts.module.css";

/** Props of {@link Sparkline}. */
export interface SparklineProps {
  /** Values in time order (e.g. 7 daily index values). */
  values: readonly number[];
  width?: number;
  height?: number;
  /** Text label for the last value, e.g. "104.2" (also used in the aria-label). */
  lastLabel?: string;
  ariaLabel?: string;
}

/** Axis-free line in series-1 with an 8px+ last-point dot and label. Each point carries a native hover title with its value. */
export function Sparkline({ values, width = 96, height = 28, lastLabel, ariaLabel }: SparklineProps) {
  if (values.length < 2) return <span className="muted">{"–"}</span>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pad = 5;
  const px = (i: number): number => pad + (i / (values.length - 1)) * (width - pad * 2);
  const py = (v: number): number => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join("");
  const last = values[values.length - 1] as number;
  return (
    <span className={s.spark}>
      <svg className={s.sparkSvg} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel ?? `Trend, last ${lastLabel ?? last.toFixed(1)}`}>
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => (
          <circle key={i} cx={px(i)} cy={py(v)} r={6} fill="transparent">
            <title>{v.toFixed(1)}</title>
          </circle>
        ))}
        <circle cx={px(values.length - 1)} cy={py(last)} r={4} fill="var(--series-1)" />
      </svg>
      {lastLabel ? <span className={s.sparkLabel}>{lastLabel}</span> : null}
    </span>
  );
}
