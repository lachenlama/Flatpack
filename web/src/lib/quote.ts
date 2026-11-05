import type { Address } from "viem";
import { flatpackRouterAbi } from "../../../shared/abi/index.ts";
import { getPublicClient } from "./chain.ts";
import { getDeployment } from "./deployment.ts";
import { quoteFromError } from "./errors.ts";

/**
 * Quotes a buy: simulates `FlatpackRouter.quoteBuy(basket, shares)`, which ALWAYS reverts with `QuoteResult(usdgIn)`, and decodes it.
 * @param basket basket address
 * @param shares shares to buy, 18 decimals
 * @returns USDG (6 decimals) the swaps would cost right now, BEFORE slippage. Add your slippage to get `maxUsdgIn`.
 * @throws a decoded-able viem error when the quote fails for another reason (use `describeError`)
 */
export async function quoteBuyUsdg(basket: Address, shares: bigint, account?: Address): Promise<bigint> {
  try {
    await getPublicClient().simulateContract({
      account,
      address: getDeployment().addresses.FlatpackRouter,
      abi: flatpackRouterAbi,
      functionName: "quoteBuy",
      args: [basket, shares],
    });
  } catch (err) {
    const q = quoteFromError(err);
    if (q !== undefined) return q;
    throw err;
  }
  throw new Error("quoteBuy did not revert with QuoteResult");
}

/** Adds a slippage tolerance in basis points to a quote: `maxUsdgIn = quote * (10000 + bps) / 10000` (rounded up). */
export function withSlippage(usdgIn: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.round(slippageBps));
  return (usdgIn * (10_000n + bps) + 9_999n) / 10_000n;
}
