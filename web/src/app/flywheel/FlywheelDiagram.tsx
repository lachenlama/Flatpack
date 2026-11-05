import type { ReactNode } from "react";
import s from "./flywheel.module.css";

/** Live numbers (already formatted) shown on the edges of the diagram. */
export interface DiagramEdges {
  volume: string;
  bought: string;
  burn: string;
  backers: string;
  curators: string;
  referrers: string;
  dividends: string;
  settleBurn: string;
  released: string;
}

function Node({ x, y, w = 150, h = 44, children }: { x: number; y: number; w?: number; h?: number; children: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} className={s.node} />
      <text x={x + w / 2} y={y + h / 2 + 5} textAnchor="middle" className={s.nodeText}>{children}</text>
    </g>
  );
}

function Edge({ d, label, lx, ly, anchor = "middle" }: { d: string; label: string; lx: number; ly: number; anchor?: "start" | "middle" | "end" }) {
  return (
    <g>
      <path d={d} className={s.edge} markerEnd="url(#arrow)" />
      <text x={lx} y={ly} textAnchor={anchor} className={s.edgeText}>{label}</text>
    </g>
  );
}

/**
 * The flywheel (plan 10.3) as inline SVG with live numbers on its edges. Ink on paper only (series colors are for charts).
 * Buyers pay fees in basket shares -> FeeHarvester sells them for $WIF -> burn / referrers / backers / curator;
 * Pays $WIF baskets stream dividends to holders; the weekly settle releases rewards or burns them.
 */
export function FlywheelDiagram({ edges }: { edges: DiagramEdges }) {
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox="0 0 800 380" role="img" aria-labelledby="fw-title fw-desc" className={s.svg}>
        <title id="fw-title">The $WIF flywheel</title>
        <desc id="fw-desc">
          Buyers spend {edges.volume}. Fees are sold for {edges.bought}. Of that, {edges.burn} is burned, {edges.referrers} goes to referrers, {edges.backers} to backers and {edges.curators} to curators. Holders of Pays $WIF baskets receive {edges.dividends} in dividends. At the weekly settle {edges.released} is released and {edges.settleBurn} is burned.
        </desc>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={s.arrowHead} />
          </marker>
        </defs>

        <Node x={10} y={150} w={140}>Buyers + baskets</Node>
        <Node x={250} y={150} w={160}>FeeHarvester</Node>
        <Node x={560} y={10} w={150}>Burn</Node>
        <Node x={560} y={90} w={150}>Referrers</Node>
        <Node x={560} y={170} w={150}>Backers (vault)</Node>
        <Node x={560} y={250} w={150}>Curators (vault)</Node>
        <Node x={250} y={310} w={160}>Holders (Pays $WIF)</Node>

        <Edge d="M150,172 L248,172" label={edges.volume} lx={199} ly={162} />
        <text x={199} y={194} textAnchor="middle" className={s.edgeSub}>buys</text>

        <Edge d="M410,160 C470,110 500,40 558,34" label={edges.burn} lx={500} ly={62} />
        <Edge d="M410,166 C470,140 500,120 558,112" label={edges.referrers} lx={494} ly={150} />
        <Edge d="M410,176 L558,192" label={edges.backers} lx={484} ly={196} />
        <Edge d="M410,186 C470,220 500,260 558,272" label={edges.curators} lx={490} ly={254} />

        <Edge d="M330,300 L330,198" label={edges.dividends} lx={338} ly={256} anchor="start" />
        <text x={338} y={270} className={s.edgeSub}>skim sold for $WIF</text>

        <Edge d="M80,194 C80,290 120,340 248,336" label={edges.bought} lx={30} ly={300} anchor="start" />
        <text x={30} y={314} className={s.edgeSub}>$WIF bought</text>

        <path d="M710,192 C770,192 770,290 710,272" className={s.edge} markerEnd="url(#arrow)" />
        <text x={774} y={232} textAnchor="end" className={s.edgeText}>{edges.released}</text>
        <text x={774} y={246} textAnchor="end" className={s.edgeSub}>released at settle</text>
        <text x={774} y={264} textAnchor="end" className={s.edgeText}>{edges.settleBurn}</text>
        <text x={774} y={278} textAnchor="end" className={s.edgeSub}>burned if behind SPY</text>
      </svg>
    </figure>
  );
}
