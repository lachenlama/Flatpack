import type { ReactNode } from "react";
import s from "./ui.module.css";

/** A Stock Token ticker chip (monospace text, never a logo). `<Chip>NVDA</Chip>` */
export function Chip({ children }: { children: ReactNode }) {
  return <span className={s.chip}>{children}</span>;
}

/** A row of ticker chips. */
export function TickerChips({ tickers, max }: { tickers: readonly string[]; max?: number }) {
  const shown = max ? tickers.slice(0, max) : tickers;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
      {shown.map((t) => (
        <Chip key={t}>{t}</Chip>
      ))}
      {max && tickers.length > max ? <Chip>+{tickers.length - max}</Chip> : null}
    </span>
  );
}
