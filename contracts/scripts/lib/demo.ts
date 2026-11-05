/**
 * Demo-basket creation (D-7): weights -> rawUnits from live Chainlink prices, approve + stake WIF through the
 * factory, optionally buy a first share through the router. Used by scripts/demo-baskets.ts and the fork test.
 */
import { parseEventLogs, type Abi } from "viem";
import { aggregatorV3Abi, basketFactoryAbi, flatpackRouterAbi } from "../../../shared/abi/index.ts";
import { rawUnitsFor, type Address } from "../../../shared/units.ts";

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** One basket of demo-baskets.json. */
export interface BasketSpec {
  name: string;
  symbol: string;
  mode: "Reinvest" | "PayInWif";
  targetShareUsd: number;
  /** Percent per launch symbol; must sum to 100. */
  weights: Record<string, number>;
}

/** Minimal client surface (structural, so hardhat's viem clients fit after a cast). */
export interface DemoPublicClient {
  readContract(args: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
  simulateContract(args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    account?: Address;
  }): Promise<unknown>;
  waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{
    status: string;
    logs: readonly { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }[];
  }>;
}

/** Minimal wallet surface. */
export interface DemoWalletClient {
  account: { address: Address };
  writeContract(args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<`0x${string}`>;
}

/** Addresses the demo needs. */
export interface DemoContext {
  factory: Address;
  router: Address;
  wif: Address;
  usdg: Address;
  /** symbol -> {token, feed} from config launchUniverse */
  universe: Record<string, { token: Address; feed: Address }>;
}

/** Result of creating one demo basket. */
export interface CreatedBasket {
  name: string;
  symbol: string;
  basket: Address;
  tokens: Address[];
  rawUnits: bigint[];
  shareValueUsd18: bigint;
  bought?: { shares: bigint; usdgSpent: bigint };
}

/** Reads live Chainlink prices (8 decimals) for the given feeds; throws on a non-positive answer. */
export async function readPrices(client: DemoPublicClient, feeds: readonly Address[]): Promise<bigint[]> {
  const prices: bigint[] = [];
  for (const feed of feeds) {
    const round = (await client.readContract({
      address: feed,
      abi: aggregatorV3Abi as Abi,
      functionName: "latestRoundData",
    })) as readonly [bigint, bigint, bigint, bigint, bigint];
    if (round[1] <= 0n) throw new Error(`feed ${feed} returned a non-positive price`);
    prices.push(round[1]);
  }
  return prices;
}

/** Converts a spec to factory inputs (tokens sorted ascending) using live prices. */
export async function planBasket(
  client: DemoPublicClient,
  ctx: DemoContext,
  spec: BasketSpec,
): Promise<{ tokens: Address[]; rawUnits: bigint[]; targetShareUsd18: bigint }> {
  const symbols = Object.keys(spec.weights);
  const infos = symbols.map((s) => {
    const info = ctx.universe[s];
    if (info === undefined) throw new Error(`unknown symbol ${s} in basket "${spec.name}"`);
    return info;
  });
  const prices = await readPrices(
    client,
    infos.map((i) => i.feed),
  );
  const targetShareUsd18 = BigInt(Math.round(spec.targetShareUsd * 1e6)) * 10n ** 12n;
  const { tokens, rawUnits } = rawUnitsFor({
    tokens: infos.map((i) => i.token),
    weightsBps: symbols.map((s) => (spec.weights[s] as number) * 100),
    pricesUsd8: prices,
    targetShareUsd18,
  });
  return { tokens, rawUnits, targetShareUsd18 };
}

function quoteFromError(e: unknown): bigint {
  // viem wraps a custom-error revert; walk the cause chain for QuoteResult(usdgIn)
  let cur: unknown = e;
  while (typeof cur === "object" && cur !== null) {
    const rec = cur as { data?: { errorName?: string; args?: readonly unknown[] }; cause?: unknown };
    if (rec.data?.errorName === "QuoteResult" && typeof rec.data.args?.[0] === "bigint") return rec.data.args[0];
    cur = rec.cause;
  }
  throw e;
}

/** Returns the router's USDG quote (6 decimals) for `shares` of `basket` (quoteBuy reverts with the result). */
export async function quoteBuy(
  client: DemoPublicClient,
  router: Address,
  basket: Address,
  shares: bigint,
): Promise<bigint> {
  try {
    await client.simulateContract({
      address: router,
      abi: flatpackRouterAbi as Abi,
      functionName: "quoteBuy",
      args: [basket, shares],
    });
  } catch (e) {
    return quoteFromError(e);
  }
  throw new Error("quoteBuy did not revert with QuoteResult");
}

/**
 * Creates one demo basket from `wallet` (the curator): approves WIF to the factory, calls `createBasket`
 * (the factory stakes `minCuratorStake` WIF into the vault), and optionally buys with a USDG budget.
 * @param buyUsdg budget in USDG base units (6 decimals); 0n or undefined to skip the buy
 */
export async function createDemoBasket(
  client: DemoPublicClient,
  wallet: DemoWalletClient,
  ctx: DemoContext,
  spec: BasketSpec,
  buyUsdg?: bigint,
): Promise<CreatedBasket> {
  const plan = await planBasket(client, ctx, spec);
  const stake = (await client.readContract({
    address: ctx.factory,
    abi: basketFactoryAbi as Abi,
    functionName: "minCuratorStake",
  })) as bigint;
  const me = wallet.account.address;
  const balance = (await client.readContract({
    address: ctx.wif,
    abi: erc20Abi as Abi,
    functionName: "balanceOf",
    args: [me],
  })) as bigint;
  if (balance < stake) throw new Error(`curator ${me} holds ${balance} WIF base units, needs ${stake} to stake`);

  const send = async (address: Address, abi: Abi, functionName: string, args: readonly unknown[]) => {
    const hash = await wallet.writeContract({ address, abi, functionName, args });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
    return receipt;
  };

  await send(ctx.wif, erc20Abi as Abi, "approve", [ctx.factory, stake]);
  const receipt = await send(ctx.factory, basketFactoryAbi as Abi, "createBasket", [
    {
      name: spec.name,
      symbol: spec.symbol,
      tokens: plan.tokens,
      rawUnits: plan.rawUnits,
      mode: spec.mode === "Reinvest" ? 0 : 1,
    },
    stake,
  ]);
  const created = parseEventLogs({ abi: basketFactoryAbi, logs: receipt.logs as never, eventName: "BasketCreated" });
  const first = created[0];
  if (first === undefined) throw new Error("BasketCreated event not found");
  const basket = first.args.basket as Address;
  const result: CreatedBasket = {
    name: spec.name,
    symbol: spec.symbol,
    basket,
    tokens: plan.tokens,
    rawUnits: plan.rawUnits,
    shareValueUsd18: plan.targetShareUsd18,
  };

  if (buyUsdg !== undefined && buyUsdg > 0n) {
    // gross shares so that the quote stays well inside the budget: 95% of budget / share price
    const budget18 = buyUsdg * 10n ** 12n;
    const shares = (budget18 * 10n ** 18n * 95n) / (plan.targetShareUsd18 * 100n);
    const quote = await quoteBuy(client, ctx.router, basket, shares);
    const maxIn = (quote * 101n) / 100n; // +1% slippage
    if (maxIn > buyUsdg) throw new Error(`quote ${quote} (+1%) exceeds the --buy budget ${buyUsdg}`);
    await send(ctx.usdg, erc20Abi as Abi, "approve", [ctx.router, maxIn]);
    const bought = await send(ctx.router, flatpackRouterAbi as Abi, "buy", [
      {
        basket,
        shares,
        maxUsdgIn: maxIn,
        receiver: me,
        referrer: "0x0000000000000000000000000000000000000000",
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      },
    ]);
    const ev = parseEventLogs({ abi: flatpackRouterAbi, logs: bought.logs as never, eventName: "Bought" })[0];
    result.bought = { shares: ev?.args.sharesOut ?? shares, usdgSpent: ev?.args.usdgSpent ?? quote };
  }
  return result;
}
