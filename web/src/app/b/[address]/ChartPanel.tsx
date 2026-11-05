"use client";

import { useState } from "react";
import { LineIndexChart } from "../../../components/charts/index.ts";
import { Card } from "../../../components/ui/Card.tsx";
import s from "./basket.module.css";

/** Plain series (times + two indexed lines). */
export interface SeriesData {
  times: number[];
  basket: number[];
  spy: number[];
}

/** NAV vs SPY, both indexed to 100, with a Since launch / 30d recipe (hypothetical) toggle. */
export function ChartPanel({ launch, recipe }: { launch: SeriesData | null; recipe: SeriesData | null }) {
  const [range, setRange] = useState<"launch" | "recipe">("launch");
  const data = range === "launch" ? launch : recipe;
  const last = (a: number[] | undefined): number | undefined => (a && a.length ? a[a.length - 1] : undefined);
  const b = last(data?.basket);
  const sp = last(data?.spy);
  return (
    <Card title="NAV vs SPY (indexed to 100)">
      <div className={s.seg} role="group" aria-label="Chart range">
        <button type="button" aria-pressed={range === "launch"} onClick={() => setRange("launch")}>
          Since launch
        </button>
        <button type="button" aria-pressed={range === "recipe"} onClick={() => setRange("recipe")}>
          30d recipe (hypothetical)
        </button>
      </div>
      {data && data.times.length >= 2 ? (
        <LineIndexChart
          times={data.times}
          series={[
            { id: "basket", label: "Basket", tone: "series-1", values: data.basket },
            { id: "spy", label: "SPY", tone: "series-2", dashed: true, values: data.spy },
          ]}
          ariaLabel={`Basket versus SPY indexed to 100, ${range === "recipe" ? "hypothetical 30 day backtest" : "since launch"}: basket ${b?.toFixed(1) ?? "n/a"}, SPY ${sp?.toFixed(1) ?? "n/a"}`}
          note={range === "recipe" ? "hypothetical" : undefined}
        />
      ) : (
        <p className="muted">
          {range === "launch"
            ? "Not enough price history since launch to draw a line yet. Check back after the next Chainlink updates."
            : "Price history for the 30-day recipe is unavailable right now."}
        </p>
      )}
      {range === "recipe" ? (
        <p className={`muted ${s.small}`}>
          Hypothetical: today&apos;s recipe replayed over the last 30 days with Chainlink prices. It is not this basket&apos;s actual history and
          says nothing about the future.
        </p>
      ) : (
        <p className={`muted ${s.small}`}>Past performance since launch, from Chainlink prices. Not a forecast.</p>
      )}
    </Card>
  );
}
