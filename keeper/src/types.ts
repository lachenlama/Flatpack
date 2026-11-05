// Shared plain types. No runtime code, so plan.ts can stay pure.
export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type TokenSnap = {
  token: Address;
  /** Current ERC-8056 uiMultiplier of the token. */
  uiMultiplier: bigint;
  /** basket.lastMultipliers()[i] */
  lastMultiplier: bigint;
  /** token.paused(); false when the token has no paused() view. */
  paused: boolean;
  /** harvester.pendingDividend(basket, token) */
  pendingDividend: bigint;
  /** basket.owed(harvester, token) */
  owed: bigint;
};

export type BasketSnap = {
  basket: Address;
  tokens: TokenSnap[];
  /** harvester.pendingFeeShares(basket) */
  pendingFeeShares: bigint;
  /** vault.nextSettleAt(basket) (unix seconds) */
  nextSettleAt: bigint;
};

export type Snapshot = {
  /** Latest block timestamp (unix seconds). */
  timestamp: bigint;
  /** Keeper ETH balance in wei, or null when the keeper address is unknown (dry-run without a key). */
  keeperEth: bigint | null;
  baskets: BasketSnap[];
};

export type Action =
  | { kind: "sync"; basket: Address }
  | { kind: "harvestDividends"; basket: Address }
  | { kind: "harvestFees"; basket: Address }
  | { kind: "claimIOU"; basket: Address; token: Address }
  | { kind: "settle"; basket: Address };

export type Status = "ok" | "dry-run" | "below-threshold" | "skipped" | "failed";

export type Result = {
  action: Action;
  status: Status;
  txHash?: Hex;
  /** Simulated $WIF out (harvests). */
  wifOut?: bigint;
  /** The minWifOut that was (or would be) sent. */
  minWifOut?: bigint;
  reason?: string;
  error?: string;
};

export type Addresses = {
  ComponentRegistry: Address;
  FeeHarvester: Address;
  BackingVault: Address;
  Basket: Address;
  BasketFactory: Address;
  FlatpackRouter: Address;
};
