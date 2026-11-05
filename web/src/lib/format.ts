/** Pure formatting helpers. No imports from chain config so they are unit-testable under node:test. */

/** USDG has 6 decimals. */
export const USDG_DECIMALS = 6;
/** Basket shares, $WIF and Stock Tokens have 18 decimals. */
export const SHARE_DECIMALS = 18;
export const WIF_DECIMALS = 18;

/** Epoch anchor (BackingVault.EPOCH_ANCHOR): a Saturday 02:00 UTC. */
export const EPOCH_ANCHOR = 1794016800;
/** Epoch length in seconds (7 days). */
export const EPOCH_LENGTH = 604800;

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export interface AmountOptions {
  /** Max fraction digits shown (default 2). Rounds half up on the exact bigint. */
  maxFraction?: number;
  /** Min fraction digits (default 0). */
  minFraction?: number;
  /** Compact notation (1.2M, 3.4K) for values >= 10,000 (default false). */
  compact?: boolean;
}

/**
 * Formats a bigint token amount with its decimals, exactly (no float), e.g. `formatAmount(1234567n, 6)` -> "1.23".
 * Negative values are supported.
 */
export function formatAmount(value: bigint, decimals: number, opts: AmountOptions = {}): string {
  const { maxFraction = 2, minFraction = 0, compact = false } = opts;
  const neg = value < 0n;
  let v = neg ? -value : value;
  if (compact) {
    const n = Number(v) / 10 ** decimals;
    for (const [div, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
      if (n >= (suffix === "K" ? 1e4 : div)) {
        return `${neg ? "-" : ""}${(n / div).toFixed(Math.min(maxFraction, 2))}${suffix}`;
      }
    }
  }
  const scale = 10n ** BigInt(decimals);
  if (maxFraction < decimals) {
    const cut = 10n ** BigInt(decimals - maxFraction);
    v = ((v + cut / 2n) / cut) * cut;
  }
  const int = v / scale;
  let frac = (v % scale).toString().padStart(decimals, "0").slice(0, Math.max(maxFraction, 0));
  frac = frac.replace(/0+$/, "").padEnd(minFraction, "0");
  const s = `${group(int.toString())}${frac ? "." + frac : ""}`;
  return neg && v !== 0n ? `-${s}` : s;
}

/** USDG amount (6 decimals), e.g. "412.37". */
export const formatUsdg = (v: bigint, opts?: AmountOptions): string => formatAmount(v, USDG_DECIMALS, { minFraction: 2, ...opts });
/** $WIF amount (18 decimals). */
export const formatWif = (v: bigint, opts?: AmountOptions): string => formatAmount(v, WIF_DECIMALS, opts);
/** Share amount (18 decimals), up to 4 fraction digits. */
export const formatShares = (v: bigint, opts?: AmountOptions): string => formatAmount(v, SHARE_DECIMALS, { maxFraction: 4, ...opts });

/** 18-decimal USD bigint (e.g. NAV) -> JS number. Lossy beyond ~15 digits; for display and charts only. */
export const usd18ToNumber = (v: bigint): number => Number(v) / 1e18;

/** Dollars, e.g. "$1,234.50"; compact for large values when `compact`. */
export function formatUsd(n: number, opts: { compact?: boolean; fraction?: number } = {}): string {
  if (!Number.isFinite(n)) return "n/a";
  const { compact = false, fraction = 2 } = opts;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact && Math.abs(n) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: fraction,
    minimumFractionDigits: compact && Math.abs(n) >= 10_000 ? 0 : fraction,
  }).format(n);
}

/** Percentage from a ratio or percent value. `formatPercent(0.0123)` -> "1.23%" (ratio), pass `{ratio:false}` for 1.23. */
export function formatPercent(n: number, opts: { digits?: number; ratio?: boolean; sign?: boolean } = {}): string {
  const { digits = 2, ratio = true, sign = false } = opts;
  if (!Number.isFinite(n)) return "n/a";
  const p = ratio ? n * 100 : n;
  const s = p.toFixed(digits);
  return `${sign && p > 0 ? "+" : ""}${s}%`;
}

/** Percentage points with an explicit sign and the true minus sign, e.g. "+1.2 pts", "−0.4 pts". */
export function formatPts(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "n/a";
  const r = Number(n.toFixed(digits));
  const body = Math.abs(r).toFixed(digits);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${body} pts`;
}

/** "3d 4h", "4h 12m", "9m", "<1m". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

/** Unix seconds at which the epoch containing `now` ends (the next Saturday 02:00 UTC boundary). Matches BackingVault. */
export function epochEnd(nowSec: number): number {
  if (nowSec < EPOCH_ANCHOR) return EPOCH_ANCHOR;
  return EPOCH_ANCHOR + (Math.floor((nowSec - EPOCH_ANCHOR) / EPOCH_LENGTH) + 1) * EPOCH_LENGTH;
}

/** Seconds until the current epoch ends. */
export const timeToEpochEnd = (nowSec: number): number => epochEnd(nowSec) - nowSec;

/** "Sat 02:00 UTC" style label for a unix-seconds timestamp. */
export function formatUtc(sec: number, withDate = false): string {
  const d = new Date(sec * 1000);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const date = withDate ? ` ${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}` : "";
  return `${day}${date} ${hm} UTC`;
}

/** `0xabcd…ef12`. */
export function shortAddress(a: string, head = 6, tail = 4): string {
  return a.length <= head + tail + 2 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

/** Index a series to 100 at its first value. Returns [] for empty or a zero first value. */
export function indexTo100(values: readonly number[]): number[] {
  const first = values[0];
  if (first === undefined || first === 0) return [];
  return values.map((v) => (v / first) * 100);
}
