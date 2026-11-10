import { ImageResponse } from "next/og";
import { formatPts, formatUsd, formatWif } from "../../../../lib/format.ts";
import { basketDetail } from "../../../../lib/reads/baskets.ts";
import { flywheelStats } from "../../../../lib/reads/flywheel.ts";

export const dynamic = "force-dynamic";

// Light-theme tokens from WP5-UX §3 (next/og cannot read CSS variables).
const C = { paper: "#f6f3ec", paper2: "#eeeae0", ink: "#121212", ink2: "#52514e", rule: "#d9d4c7", good: "#0ca30c", critical: "#d03b3b" };
const MONO = "ui-monospace, Menlo, Consolas, monospace";

/** 1200x630 share card: name, tickers, vs SPY this epoch, $WIF burned, FLATPACK wordmark. */
export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }): Promise<Response> {
  const { address } = await ctx.params;
  const [b, stats] = await Promise.all([basketDetail(address).catch(() => undefined), flywheelStats()]);
  if (!b) return new Response("Basket not found", { status: 404 });

  const e = b.epoch;
  // No emoji or exotic glyphs: next/og's default font lacks them and emoji would be fetched from a CDN.
  const vs = e ? `${formatPts(e.beatPts)} vs SPY this week (${e.beatPts >= 0 ? "beating" : "behind"})` :"vs SPY: first reading after the next settle";
  const vsColor = e ? (e.beatPts >= 0 ? C.good : C.critical) : C.ink2;
  const name = b.name.length > 34 ? `${b.name.slice(0, 33)}…` : b.name;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: C.paper, color: C.ink, padding: 64, border: `2px solid ${C.ink}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontFamily: MONO, fontSize: 34, fontWeight: 800, letterSpacing: 8 }}>FLATPACK</div>
          <div style={{ display: "flex", fontSize: 26, color: C.ink2 }}>{b.mode === "PayInWif" ? "Pays $WIF" : "Reinvest"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>{name}</div>
          <div style={{ display: "flex", flexWrap: "wrap", marginTop: 28 }}>
            {b.tickers.slice(0, 8).map((t) => (
              <div key={t} style={{ display: "flex", fontFamily: MONO, fontSize: 30, fontWeight: 700, padding: "6px 16px", border: `2px solid ${C.rule}`, borderRadius: 8, background: C.paper2, marginRight: 12, marginBottom: 12 }}>
                {t}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", marginTop: 12, fontSize: 38, fontWeight: 700, color: vsColor }}>{vs}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderTop: `2px solid ${C.rule}`, paddingTop: 24 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontFamily: MONO, fontSize: 44, fontWeight: 700 }}>{`${formatWif(stats.burnedWif, { maxFraction: 0 })} $WIF burned`}</div>
            <div style={{ display: "flex", fontSize: 24, color: C.ink2, marginTop: 6 }}>{`NAV ${formatUsd(b.navPerShareUsd)} per share · TVL ${formatUsd(b.tvlUsd, { compact: true })} · on Robinhood Chain`}</div>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: C.ink2, maxWidth: 360, textAlign: "right" }}>Not investment advice. Stock Tokens are not available to US persons.</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
