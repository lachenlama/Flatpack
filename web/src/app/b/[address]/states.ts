import { formatUsdg } from "../../../lib/format.ts";

/** Minimum shares per mint (Basket.MIN_MINT_SHARES). */
export const MIN_MINT_SHARES = 10n ** 12n;
/** A Chainlink feed older than this means the underlying market is closed (WP5-UX 4.3). */
export const STALE_FEED_SEC = 2 * 3600;

/** True when the session flag says closed or the oldest feed update is older than 2h. Pure. */
export function isMarketClosed(session: "open" | "extended" | "closed", oldestFeedUpdate: number | undefined, nowSec: number): boolean {
  return session === "closed" || (oldestFeedUpdate !== undefined && nowSec - oldestFeedUpdate > STALE_FEED_SEC);
}

/** Input of {@link buyBlockReason}. */
export interface BuyState {
  shares: bigint | undefined;
  halted: string[];
  paused: string[];
  navValid: boolean;
  quote: { state: "idle" | "loading" | "ok" | "error"; message?: string };
  maxIn: bigint | undefined;
  usdgBalance: bigint | undefined;
}

/** Why Buy is disabled, in plain English, or undefined when it can proceed. Halted and paused components block buying (never redeeming). Pure. */
export function buyBlockReason(s: BuyState): string | undefined {
  if (s.shares === undefined) return "Enter a number of shares.";
  if (s.shares < MIN_MINT_SHARES) return "The minimum is 0.000001 shares.";
  if (s.halted.length) return `${s.halted.join(", ")} halted. Buying is paused until trading resumes. Redeeming still works.`;
  if (s.paused.length) return `${s.paused.join(", ")} paused by the issuer. Buying is disabled. Redeeming still works.`;
  if (!s.navValid) return "A price feed is stale, so the basket cannot be priced right now.";
  if (s.quote.state === "loading") return "Getting a quote…";
  if (s.quote.state === "error") return s.quote.message ?? "No quote available.";
  if (s.quote.state !== "ok" || s.maxIn === undefined) return "Waiting for a quote.";
  if (s.usdgBalance !== undefined && s.usdgBalance < s.maxIn)
    return `You need up to ${formatUsdg(s.maxIn)} USDG (price plus slippage) but hold ${formatUsdg(s.usdgBalance)}.`;
  return undefined;
}

/** Redeem notice for issuer-paused components (their leg becomes an IOU). Empty when none. Pure. */
export function iouNotice(paused: string[]): string {
  return paused.map((t) => `${t} will arrive as an IOU, claim it later.`).join(" ");
}

/** Banner for components with a corporate action in flight. Empty when none. Pure. */
export function corporateNotice(tickers: string[]): string {
  return tickers.map((t) => `${t} split/dividend processing`).join("; ");
}
