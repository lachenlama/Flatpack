import type { ReactNode } from "react";
import s from "./ui.module.css";

/** Loading placeholder block. `<Skeleton width={120} height={24} />` */
export function Skeleton({ width = "100%", height = 16 }: { width?: number | string; height?: number | string }) {
  return <span className={s.skeleton} style={{ width, height }} aria-hidden="true" />;
}

/** Wrapper for a route loading state: announces "Loading" once, hides the placeholder blocks from assistive tech. */
export function SkeletonPage({ label = "Loading", children }: { label?: string; children: ReactNode }) {
  return (
    <div className={s.skelPage} role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}

/** Page title bar + one muted line, as every route starts with an h1 and a lede. */
export function SkeletonHead({ titleWidth = "38%" }: { titleWidth?: number | string }) {
  return (
    <div className={s.skelHead}>
      <Skeleton width={titleWidth} height={36} />
      <Skeleton width="56%" height={16} />
    </div>
  );
}

/** A paper card with a title bar and `lines` text lines (the last one shorter), or a tall `height` block (chart area). */
export function SkeletonCard({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <div className={`${s.card} ${s.skelCard}`}>
      <Skeleton width="34%" height={16} />
      {height ? <Skeleton height={height} /> : Array.from({ length: lines }, (_, i) => <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} height={14} />)}
    </div>
  );
}

/** A grid of KPI-tile placeholders. */
export function SkeletonTiles({ count = 3 }: { count?: number }) {
  return (
    <div className={s.skelTiles}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={s.tile}>
          <Skeleton width="50%" height={14} />
          <div style={{ height: 10 }} />
          <Skeleton width="70%" height={28} />
        </div>
      ))}
    </div>
  );
}

/** Ruled table placeholder: `rows` rows of a wide name cell followed by `cols` short cells. */
export function SkeletonRows({ rows = 6, cols = 3 }: { rows?: number; cols?: number }) {
  return (
    <div className={s.skelRows}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={s.skelRow}>
          <div className={s.skelFill}>
            <Skeleton width="42%" height={16} />
          </div>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} width={64} height={14} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Two-column layout used on the basket page: wide main area and a narrow side column (stacks on mobile). */
export function SkeletonSplit({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className={s.skelGridWide}>
      <div className={s.skelPage}>{main}</div>
      <div className={s.skelPage}>{side}</div>
    </div>
  );
}
