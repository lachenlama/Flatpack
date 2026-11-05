/**
 * Headless createBasket as Hardhat account #4, built with the SAME helper the Assemble page uses (plan.ts buildCreateParams).
 * Funds #4 with WIF by impersonation, approves the FACTORY exactly, creates the third basket and asserts basketCount() == 3.
 *   RH_PORT=8547 node src/app/assemble/__e2e__/create-basket.ts
 */
import { parseEventLogs, type Abi, type Address } from "viem";
import { basketFactoryAbi } from "../../../../../shared/abi/index.ts";
import { buildCreateParams, checkWeights, evenWeights, type BasketInput } from "../plan.ts";
import { ACCOUNTS, dep, erc20, fundWif, network, publicClient, walletFor } from "./lib.ts";

const factory = dep.addresses.BasketFactory as Address;
const fail = (m: string): never => {
  throw new Error(`E2E FAIL: ${m}`);
};

const before = (await publicClient.readContract({ address: factory, abi: basketFactoryAbi, functionName: "basketCount" })) as bigint;
const stake = (await publicClient.readContract({ address: factory, abi: basketFactoryAbi, functionName: "minCuratorStake" })) as bigint;
console.log(`basketCount before: ${before}, minCuratorStake: ${stake}`);

await fundWif(ACCOUNTS.curator, stake * 2n);
const bal = (await publicClient.readContract({ address: network.tokens.WIF.address, abi: erc20, functionName: "balanceOf", args: [ACCOUNTS.curator] })) as bigint;
console.log(`#4 WIF balance: ${bal}`);

const tickers = ["NVDA", "MSFT", "AAPL"];
const w = checkWeights(evenWeights(tickers.length));
if (!w.ok) fail(w.message ?? "weights");
const input: BasketInput = {
  name: "Headless Three",
  symbol: "HEAD3",
  mode: "Reinvest",
  picks: tickers.map((t, i) => {
    const u = network.launchUniverse[t] ?? fail(`unknown ticker ${t}`);
    return { token: u.token, feed: u.feed, weightBps: w.bps[i] as number };
  }),
};
const params = await buildCreateParams(publicClient, input);
console.log("params:", JSON.stringify(params, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

const wallet = walletFor(ACCOUNTS.curator);
const ap = await wallet.writeContract({ address: network.tokens.WIF.address, abi: erc20, functionName: "approve", args: [factory, stake] });
await publicClient.waitForTransactionReceipt({ hash: ap });
const { request } = await publicClient.simulateContract({ account: ACCOUNTS.curator, address: factory, abi: basketFactoryAbi as Abi, functionName: "createBasket", args: [params, stake] });
const hash = await wallet.writeContract(request as never);
const rc = await publicClient.waitForTransactionReceipt({ hash });
if (rc.status !== "success") fail("createBasket reverted");
const ev = parseEventLogs({ abi: basketFactoryAbi, logs: rc.logs, eventName: "BasketCreated" })[0];
console.log("created basket", (ev?.args as { basket: Address }).basket, "curator", (ev?.args as { curator: Address }).curator);

const after = (await publicClient.readContract({ address: factory, abi: basketFactoryAbi, functionName: "basketCount" })) as bigint;
if (after !== 3n) fail(`basketCount ${after} != 3`);
console.log("basketCount() == 3  PASS");
