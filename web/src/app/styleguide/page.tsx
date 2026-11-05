import type { Metadata } from "next";
import { BarList, LineIndexChart, Sparkline } from "../../components/charts/index.ts";
import {
  Address, Amount, Badge, BeatBadge, Button, Card, Chip, Countdown, EmptyState, InfoTip, ModeBadge, Skeleton, StatTile, TickerChips,
} from "../../components/ui/index.ts";
import { DemoTable } from "./DemoTable.tsx";
import { epochEnd } from "../../lib/format.ts";

export const metadata: Metadata = { title: "Styleguide", robots: { index: false } };

// Deterministic fixture series (no network): basket vs SPY over 30 days.
const DAY = 86400;
const END = 1_794_000_000;
const times = Array.from({ length: 31 }, (_, i) => END - (30 - i) * DAY);
const basket = times.map((_, i) => 100 + i * 0.28 + Math.sin(i / 2.2) * 1.6);
const spy = times.map((_, i) => 100 + i * 0.12 + Math.cos(i / 3) * 0.9);

const rows = [
  { id: "NVDA", w: 30.1, units: "0.0482" },
  { id: "MSFT", w: 25, units: "0.0263" },
  { id: "GOOGL", w: 20, units: "0.0706" },
  { id: "META", w: 15, units: "0.0249" },
  { id: "MU", w: 9.9, units: "0.1181" },
];

export default function StyleguidePage() {
  return (
    <div style={{ display: "grid", gap: 32 }}>
      <h1>Styleguide</h1>
      <p className="muted">Every design-system component with fixture data. Not linked from the app.</p>

      <Card title="Buttons">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Button>Primary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Card>

      <Card title="Chips, badges, status (icon + label)">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <TickerChips tickers={["NVDA", "MSFT", "GOOGL"]} />
          <Chip>SPY</Chip>
          <ModeBadge mode="Reinvest" />
          <ModeBadge mode="PayInWif" />
          <BeatBadge pts={1.2} label="+1.2 pts" />
          <BeatBadge pts={-0.4} label={"−0.4 pts"} />
          <Badge tone="warning">Markets closed</Badge>
          <Badge>Neutral</Badge>
        </div>
      </Card>

      <Card title="Stat tiles, amounts, address, countdown">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <StatTile label="$WIF burned" value="12,345" sub="2 harvests" source="Sum of FeesHarvested.burned." />
          <StatTile label="TVL" value="$1,893.83" />
        </div>
        <p>
          <Amount value={412_370_000n} decimals={6} symbol="USDG" /> {"·"} <Amount value={1_234_567n * 10n ** 15n} decimals={18} symbol="$WIF" /> {"·"}{" "}
          <Address address="0xFCc4Ba754Ae127396D3c6dCA507389b5A5b6EFAe" /> {"·"} epoch ends in <Countdown to={epochEnd(Math.floor(Date.now() / 1000))} />{" "}
          <InfoTip content="Tooltips also open on keyboard focus." />
        </p>
        <Skeleton width={160} height={20} />
      </Card>

      <Card title="NAV vs SPY (indexed to 100)">
        <LineIndexChart
          times={times}
          ariaLabel="Basket versus SPY, indexed to 100, over 30 days. Basket ends at 108 and SPY at 103."
          series={[
            { id: "basket", label: "Basket", tone: "series-1", values: basket },
            { id: "spy", label: "SPY", tone: "series-2", dashed: true, values: spy },
          ]}
        />
      </Card>

      <Card title="Holdings (per share)">
        <BarList items={rows.map((r) => ({ key: r.id, label: r.id, value: r.w, display: `${r.w}%`, sub: r.units }))} ariaLabel="Holdings" />
        <p>
          Sparkline: <Sparkline values={basket.slice(-7)} lastLabel={basket[basket.length - 1]?.toFixed(1)} />
        </p>
      </Card>

      <DemoTable />

      <EmptyState title="No baskets yet">Assemble the first one and earn $WIF from every buy.</EmptyState>
    </div>
  );
}
