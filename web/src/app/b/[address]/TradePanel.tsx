"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Card } from "../../../components/ui/Card.tsx";
import { BuyPanel } from "./BuyPanel.tsx";
import { RedeemPanel } from "./RedeemPanel.tsx";
import type { BasketView } from "./types.ts";
import s from "./basket.module.css";

type Tab = "buy" | "redeem";
const TABS: { id: Tab; label: string }[] = [
  { id: "buy", label: "Buy" },
  { id: "redeem", label: "Redeem" },
];

/** One panel, two tabs: Buy (default) and Redeem in kind. Both stay mounted so typed amounts survive a tab switch. */
export function TradePanel({ view }: { view: BasketView }) {
  const [tab, setTab] = useState<Tab>("buy");
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ buy: null, redeem: null });

  const onKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next: Tab = e.key === "Home" ? "buy" : e.key === "End" ? "redeem" : tab === "buy" ? "redeem" : "buy";
    setTab(next);
    refs.current[next]?.focus();
  };

  return (
    <Card className={s.trade}>
      <div className={s.tabs} role="tablist" aria-label="Buy or redeem">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`trade-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`trade-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={onKey}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="trade-panel-buy" aria-labelledby="trade-tab-buy" hidden={tab !== "buy"}>
        <BuyPanel view={view} />
      </div>
      <div role="tabpanel" id="trade-panel-redeem" aria-labelledby="trade-tab-redeem" hidden={tab !== "redeem"}>
        <RedeemPanel view={view} />
      </div>
    </Card>
  );
}
