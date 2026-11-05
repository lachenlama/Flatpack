import type { Address } from "viem";
import type { BasketMode } from "../../../lib/reads/types.ts";

/** One component as the client panels need it (serialisable). */
export interface CompView {
  token: Address;
  ticker: string;
  /** Issuer-paused Stock Token: buys disabled, redeem pays an IOU. */
  paused: boolean;
  /** Trading halt (Robinhood): buys disabled, redeem stays enabled. */
  halted: boolean;
  /** Split/dividend multiplier change in flight. */
  corporate: boolean;
}

/** Everything the client panels of the basket page receive from the server page. */
export interface BasketView {
  address: Address;
  name: string;
  mode: BasketMode;
  navPerShareUsd: number;
  navValid: boolean;
  comps: CompView[];
  /** Session closed or a feed older than 2h. */
  marketClosed: boolean;
  nextSettleAt: number;
  /** Optional referrer from `?ref=0x...` (validated address). */
  ref?: Address;
}
