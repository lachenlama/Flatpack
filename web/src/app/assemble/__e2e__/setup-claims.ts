/**
 * Makes the browser mock wallet (#3) a referrer with a CLOSED cycle, so /me has a real referral claim:
 * #0 buys shares of the 2nd basket with referrer = #3, then the keeper (run separately) harvests it.
 *   RH_PORT=8547 node src/app/assemble/__e2e__/setup-claims.ts
 */
import { parseAbi, type Abi, type Address } from "viem";
import { basketFactoryAbi, flatpackRouterAbi } from "../../../../../shared/abi/index.ts";
import { ACCOUNTS, dep, erc20, fundWif, network, publicClient, walletFor } from "./lib.ts";

const router = dep.addresses.FlatpackRouter as Address;
const factory = dep.addresses.BasketFactory as Address;
const basket = (await publicClient.readContract({ address: factory, abi: basketFactoryAbi, functionName: "basketAt", args: [1n] })) as Address;
const shares = 5n * 10n ** 18n;

// quoteBuy reverts with QuoteResult(usdgIn)
let quote = 0n;
try {
  await publicClient.simulateContract({ address: router, abi: flatpackRouterAbi as Abi, functionName: "quoteBuy", args: [basket, shares] });
} catch (e) {
  let cur: unknown = e;
  while (typeof cur === "object" && cur !== null) {
    const r = cur as { data?: { errorName?: string; args?: readonly unknown[] }; cause?: unknown };
    if (r.data?.errorName === "QuoteResult") quote = r.data.args?.[0] as bigint;
    cur = r.cause;
  }
}
if (quote === 0n) throw new Error("could not quote the buy");
const maxIn = (quote * 102n) / 100n;
const w = walletFor(ACCOUNTS.owner);
await publicClient.waitForTransactionReceipt({ hash: await w.writeContract({ address: network.tokens.USDG.address, abi: erc20, functionName: "approve", args: [router, maxIn] }) });
const deadline = (await publicClient.getBlock()).timestamp + 600n;
const hash = await w.writeContract({
  address: router,
  abi: flatpackRouterAbi as Abi,
  functionName: "buy",
  args: [{ basket, shares, maxUsdgIn: maxIn, receiver: ACCOUNTS.owner, referrer: ACCOUNTS.mock, deadline }],
});
const rc = await publicClient.waitForTransactionReceipt({ hash });
if (rc.status !== "success") throw new Error("buy reverted");
const pending = await publicClient.readContract({ address: dep.addresses.FeeHarvester as Address, abi: parseAbi(["function pendingFeeShares(address) view returns (uint256)"]), functionName: "pendingFeeShares", args: [basket] });
console.log(`bought ${shares} shares of ${basket} with referrer #3; pendingFeeShares=${pending}`);

// the browser flow stakes the 1000 WIF minimum: fund the mock wallet (#3) with 2000 WIF
await fundWif(ACCOUNTS.mock, 2000n * 10n ** 18n);
console.log("funded #3 (mock wallet) with 2000 WIF");

