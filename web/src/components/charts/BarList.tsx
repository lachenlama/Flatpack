import s from "./charts.module.css";

/** One row of a {@link BarList}. */
export interface BarItem {
  key: string;
  /** Left label (ticker). */
  label: string;
  /** Bar length driver (any non-negative number; scaled to the max). */
  value: number;
  /** Right-hand text, e.g. "30.1%". */
  display: string;
  /** Muted text after `display`, e.g. "0.0482". */
  sub?: string;
  /** Hover details as plain text (price, feed age, multiplier); shown as the row title. */
  detail?: string;
}

/**
 * Sorted horizontal bar list, ONE hue (series-1), 2px gap, 4px rounded data ends (WP5-UX §5). Text-first: label and value are
 * always present as text, so it reads without color. Rows are sorted descending by `value` unless `sorted={false}`.
 */
export function BarList({ items, sorted = true, ariaLabel }: { items: readonly BarItem[]; sorted?: boolean; ariaLabel?: string }) {
  const rows = sorted ? [...items].sort((a, b) => b.value - a.value) : items;
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul className={s.bars} aria-label={ariaLabel}>
      {rows.map((r) => (
        <li className={s.barRow} key={r.key} title={r.detail}>
          <span className={s.barLabel}>{r.label}</span>
          <span className={s.barTrack} aria-hidden="true">
            <div className={s.barFill} style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className={s.barValue}>
            {r.display}
            {r.sub ? <span className={s.barSub}>{r.sub}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
