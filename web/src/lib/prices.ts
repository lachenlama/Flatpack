import { cached } from "./cache.ts";

/** Trading session of US equities (the underlying markets of Stock Tokens). */
export type MarketSession = "open" | "extended" | "closed";

/** One Stock Token as seen by Robinhood's public price/asset endpoints. */
export interface TokenMarket {
  ticker: string;
  /** Lowercase contract addresses on Robinhood Chain. */
  addresses: string[];
  /** Mid of token bid/ask in USD (per Stock Token incl. multiplier), if quoted. */
  price?: number;
  isTradingHalt: boolean;
  /** `currentMultiplier` as a decimal string, e.g. "1.0011". */
  multiplier?: string;
  /** True when a multiplier change is scheduled (corporate action in flight). */
  pendingMultiplier: boolean;
  /** Asset status, e.g. ASSET_STATUS_ACTIVE. */
  status?: string;
  /** ISO time the quote was generated. */
  generatedAt?: string;
}

/** Result of {@link getMarketData}. Never throws: `ok:false` means the upstream was unreachable. */
export interface MarketData {
  ok: boolean;
  session: MarketSession;
  /** Unix ms of the newest quote, if any. */
  asOf?: number;
  /** Keyed by upper-case ticker. */
  tokens: Record<string, TokenMarket>;
}

const BASE = "https://api.robinhood.com/rhj";
const TTL_MS = 15_000;

interface RawQuote {
  tokenSymbol?: string;
  deployments?: { contractAddress?: string; chainId?: number }[];
  tokenBid?: string;
  tokenAsk?: string;
  isTradingHalt?: boolean;
  generatedAt?: string;
}
interface RawAsset {
  tokenSymbol?: string;
  currentMultiplier?: string;
  pendingMultiplier?: string;
  status?: string;
  deployments?: { contractAddress?: string; chainId?: number }[];
}

/**
 * US equity session from the clock (ET). Regular 09:30-16:00, extended 04:00-09:30 and 16:00-20:00 on weekdays
 * (Robinhood also trades overnight; we label that "closed" for the buy warning). Exchange holidays are not modelled.
 * @param nowMs unix milliseconds
 */
export function usSession(nowMs: number): MarketSession {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return "closed";
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  if (mins >= 570 && mins < 960) return "open";
  if ((mins >= 240 && mins < 570) || (mins >= 960 && mins < 1200)) return "extended";
  return "closed";
}

/** Parses the two upstream payloads into {@link MarketData}. Pure; exported for tests. */
export function mergeMarketData(prices: { quotes?: RawQuote[] } | null, assets: { assets?: RawAsset[] } | null, nowMs: number): MarketData {
  const tokens: Record<string, TokenMarket> = {};
  let asOf: number | undefined;
  const chainAddrs = (d: RawQuote["deployments"]): string[] =>
    (d ?? []).filter((x) => x.chainId === 4663 && x.contractAddress).map((x) => (x.contractAddress as string).toLowerCase());
  for (const q of prices?.quotes ?? []) {
    if (!q.tokenSymbol) continue;
    const bid = Number(q.tokenBid);
    const ask = Number(q.tokenAsk);
    const t: TokenMarket = {
      ticker: q.tokenSymbol.toUpperCase(),
      addresses: chainAddrs(q.deployments),
      isTradingHalt: q.isTradingHalt === true,
      pendingMultiplier: false,
      generatedAt: q.generatedAt,
    };
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) t.price = (bid + ask) / 2;
    tokens[t.ticker] = t;
    const ts = q.generatedAt ? Date.parse(q.generatedAt) : NaN;
    if (Number.isFinite(ts) && (asOf === undefined || ts > asOf)) asOf = ts;
  }
  for (const a of assets?.assets ?? []) {
    if (!a.tokenSymbol) continue;
    const key = a.tokenSymbol.toUpperCase();
    const t = tokens[key] ?? (tokens[key] = { ticker: key, addresses: chainAddrs(a.deployments), isTradingHalt: false, pendingMultiplier: false });
    t.multiplier = a.currentMultiplier || undefined;
    t.pendingMultiplier = !!a.pendingMultiplier;
    t.status = a.status;
  }
  return { ok: Object.keys(tokens).length > 0, session: usSession(nowMs), asOf, tokens };
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Server-side proxy of api.robinhood.com/rhj/prices and /assets, cached 15 seconds. Provides the market session,
 * trading-halt flags, multipliers and pending corporate actions. Never throws.
 */
export function getMarketData(): Promise<MarketData> {
  return cached("market-data", TTL_MS, async () => {
    const [prices, assets] = await Promise.all([getJson<{ quotes?: RawQuote[] }>("/prices"), getJson<{ assets?: RawAsset[] }>("/assets")]);
    return mergeMarketData(prices, assets, Date.now());
  });
}
