import type { ReactNode } from "react";
import { InfoTip } from "./Tooltip.tsx";
import s from "./ui.module.css";

/** Props of {@link StatTile}. */
export interface StatTileProps {
  label: string;
  /** The number (ink, monospace tabular). */
  value: ReactNode;
  /** Muted line under the number. */
  sub?: ReactNode;
  /** Source tooltip: "Every number has a source tooltip". */
  source?: ReactNode;
}

/** A KPI tile: muted label, big mono number, optional sub line and source tooltip. */
export function StatTile({ label, value, sub, source }: StatTileProps) {
  return (
    <div className={s.tile}>
      <div className={s.tileLabel}>
        {label}
        {source ? <InfoTip content={source} /> : null}
      </div>
      <div className={s.tileValue}>{value}</div>
      {sub ? <div className={s.tileSub}>{sub}</div> : null}
    </div>
  );
}
