import type { Address } from "viem";

/** Dividend mode of a basket: reinvested in the basket, or skimmed and paid to holders in $WIF. */
export type BasketMode = "Reinvest" | "PayInWif";

/** One Stock Token inside a basket, with live oracle data. */
export interface ComponentInfo {
  token: Address;
  /** Ticker (from the launch universe, else the token's own `symbol()`). */
  ticker: string;
  /** Raw units (18 decimals) of the token backing 1e18 shares. */
  rawUnits: bigint;
  /** Units per ONE share as a decimal (rawUnits / 1e18). */
  unitsPerShare: number;
  /** Chainlink USD feed (8 decimals) from the registry. */
  feed: Address;
  /** Latest Chainlink answer in USD, if readable. */
  priceUsd?: number;
  /** Unix seconds of the latest feed update. */
  feedUpdatedAt?: number;
  /** ERC-8056 UI multiplier (18 decimals), 1e18 when the token has none. */
  uiMultiplier: bigint;
  /** True when the Stock Token (issuer) is paused: buys disabled, redeem pays an IOU. */
  paused: boolean;
  /** Share of one share's USD value, 0..100. */
  weightPct: number;
}

/** Live basket-vs-SPY performance since the last weekly settle. */
export interface EpochPerformance {
  /** Basket NAV change since the last settle, percent. */
  basketPct: number;
  /** SPY change since the last settle, percent. */
  benchPct: number;
  /** basketPct - benchPct, percentage points. */
  beatPts: number;
  beating: boolean;
}

/** Everything the list pages need about a basket. */
export interface BasketSummary {
  address: Address;
  name: string;
  symbol: string;
  curator: Address;
  mode: BasketMode;
  /** Shares outstanding (18 decimals). */
  totalSupply: bigint;
  /** USD value of ONE share (NAV), from BackingVault.navOf. */
  navPerShareUsd: number;
  /** False when a feed is stale/invalid so the vault could not compute NAV. */
  navValid: boolean;
  /** totalSupply x NAV in USD. */
  tvlUsd: number;
  components: ComponentInfo[];
  /** Tickers sorted as in the basket (by token address). */
  tickers: string[];
  /** $WIF staked behind the basket (active + warming), 18 decimals. */
  wifBacked: bigint;
  /** Unix seconds of the next weekly settle. */
  nextSettleAt: number;
  /** Unix seconds of the last settle (creation time when never settled). */
  lastSettledAt: number;
  /** Number of completed settles. */
  settleCount: number;
  /** Null until a NAV snapshot exists. */
  epoch: EpochPerformance | null;
}

/** {@link BasketSummary} plus event-derived facts. */
export interface BasketDetail extends BasketSummary {
  /** Block and time the basket was created (from BasketCreated), if found. */
  createdBlock?: bigint;
  createdAt?: number;
  /** Benchmark (SPY) current price, USD. */
  benchPriceUsd?: number;
  /** Benchmark feed address. */
  benchFeed?: Address;
}

/** On-chain backing state of one basket (BackingVault.basketState + extras). */
export interface VaultState {
  basket: Address;
  curator: Address;
  totalActive: bigint;
  totalWarming: bigint;
  settleCount: number;
  queuedBackers: bigint;
  queuedCurator: bigint;
  curatorClaimable: bigint;
  navLast: bigint;
  benchLast: bigint;
  lastSettledAt: number;
  nextSettleAt: number;
  curatorActive: boolean;
}

/** An account's stake in a basket's backing. */
export interface VaultPosition {
  active: bigint;
  /** Stake that starts earning at the next settle. */
  warming: bigint;
  pendingUnstake: bigint;
  /** Unix seconds when a requested unstake can be withdrawn (0 = none). */
  unlockAt: number;
  /** Claimable $WIF rewards (includes projected accrual). */
  claimable: bigint;
}
