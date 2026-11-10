import Link from "next/link";
import { formatPts, formatUsd } from "../lib/format.ts";
import type { BasketSummary } from "../lib/reads/types.ts";
import { BeatBadge, Badge, ModeBadge } from "./ui/Badge.tsx";
import { Card } from "./ui/Card.tsx";
import { TickerChips } from "./ui/Chip.tsx";
import s from "../app/page.module.css";

/**
 * Compact basket card (name, mode badge, ticker chips, this week vs SPY with icon + label, NAV per share and TVL). Links to `/b/[address]`.
 * Server-component friendly.
 */
export function BasketCard({ basket }: { basket: BasketSummary }) {
  const e = basket.epoch;
  return (
    <Link href={`/b/${basket.address}`} className={s.basket}>
      <Card as="article">
        <div className={s.basketTop}>
          <span className={s.basketName}>{basket.name}</span>
          <ModeBadge mode={basket.mode} />
        </div>
        <TickerChips tickers={basket.tickers} max={6} />
        <div className={s.meta}>
          <span>This week</span>
          {e ? <BeatBadge pts={e.beatPts} label={formatPts(e.beatPts)} /> : <Badge>no reading yet</Badge>}
        </div>
        <div className={s.meta}>
          <span>
            NAV <span className="num">{formatUsd(basket.navPerShareUsd)}</span>
          </span>
          <span>
            TVL <span className="num">{formatUsd(basket.tvlUsd, { compact: true })}</span>
          </span>
        </div>
      </Card>
    </Link>
  );
}
