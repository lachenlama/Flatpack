import type { ReactNode } from "react";
import type { BasketMode } from "../../lib/reads/types.ts";
import s from "./ui.module.css";

/** Status tone. Each tone has its own icon so status never relies on color alone. */
export type Tone = "good" | "critical" | "warning" | "neutral";

const ICONS: Record<Tone, string> = { good: "▲", critical: "▼", warning: "◐", neutral: "○" };

/** Props of {@link Badge}. */
export interface BadgeProps {
  tone?: Tone;
  /** Override the default icon for the tone. */
  icon?: string;
  /** The label is mandatory: icon + label, never color alone. */
  children: ReactNode;
}

/** A pill with an icon and a label. Status colors are applied only to the icon and the border. */
export function Badge({ tone = "neutral", icon, children }: BadgeProps) {
  return (
    <span className={`${s.badge} ${s[`tone_${tone}`] ?? ""}`}>
      <span className={s.icon} aria-hidden="true">
        {icon ?? ICONS[tone]}
      </span>
      {children}
    </span>
  );
}

/** Basket dividend mode badge: "Reinvest" or "Pays $WIF". */
export function ModeBadge({ mode }: { mode: BasketMode }) {
  return mode === "PayInWif" ? <Badge icon={"◆"}>Pays $WIF</Badge> : <Badge icon={"↻"}>Reinvest</Badge>;
}

/**
 * vs-SPY status: "▲ +1.2 pts vs SPY" / "▼ −0.8 pts vs SPY" / "● Even with SPY".
 * `label` is the signed points string (e.g. from `formatPts`); the icon carries the direction alongside the sign.
 */
export function BeatBadge({ pts, label }: { pts: number; label: string }) {
  if (Math.abs(pts) < 0.05) return <Badge tone="neutral" icon={"●"}>Even with SPY</Badge>;
  return <Badge tone={pts > 0 ? "good" : "critical"}>{label} vs SPY</Badge>;
}
