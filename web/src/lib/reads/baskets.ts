import { getAddress, parseAbi, type Address } from "viem";
import {
  aggregatorV3Abi,
  backingVaultAbi,
  basketAbi,
  basketFactoryAbi,
  componentRegistryAbi,
  pausableTokenAbi,
  scaledUiAmountAbi,
} from "../../../../shared/abi/index.ts";
import { cached } from "../cache.ts";
import { TICKER_BY_TOKEN, getPublicClient } from "../chain.ts";
import { getDeployment } from "../deployment.ts";
import { batch, ok } from "./multicall.ts";
import { getBasketCreation } from "./events.ts";
import type { BasketDetail, BasketMode, BasketSummary, ComponentInfo, EpochPerformance } from "./types.ts";

const erc20SymbolAbi = parseAbi(["function symbol() view returns (string)"]);
const ONE = 10n ** 18n;

type RoundTuple = readonly [bigint, bigint, bigint, bigint, bigint];
type BasketStateTuple = {
  curator: Address;
  totalActive: bigint;
  totalWarming: bigint;
  settleCount: bigint | number;
  navLast: bigint;
  benchLast: bigint;
  lastSettledAt: bigint | number;
};

interface Feed {
  price?: number;
  updatedAt?: number;
}

/** Everything fetched in 5 multicall batches for a set of baskets. */
async function loadBaskets(addresses: Address[]): Promise<{ baskets: BasketDetail[]; benchFeed?: Address; benchPrice?: number }> {
  const client = getPublicClient();
  const { BackingVault: vault, ComponentRegistry: registry } = getDeployment().addresses;

  // batch A: per-basket data + registry benchmark
  const perBasket = addresses.flatMap((b) => [
    { address: b, abi: basketAbi, functionName: "name" },
    { address: b, abi: basketAbi, functionName: "symbol" },
    { address: b, abi: basketAbi, functionName: "curator" },
    { address: b, abi: basketAbi, functionName: "mode" },
    { address: b, abi: basketAbi, functionName: "totalSupply" },
    { address: b, abi: basketAbi, functionName: "components" },
    { address: vault, abi: backingVaultAbi, functionName: "navOf", args: [b] },
    { address: vault, abi: backingVaultAbi, functionName: "basketState", args: [b] },
    { address: vault, abi: backingVaultAbi, functionName: "nextSettleAt", args: [b] },
  ]);
  const A = 9;
  const ra = await batch(client, [{ address: registry, abi: componentRegistryAbi, functionName: "benchmark" }, ...perBasket]);
  const bench = ok<Address>(ra[0]);

  type Raw = {
    address: Address; name: string; symbol: string; curator: Address; mode: BasketMode; totalSupply: bigint;
    tokens: Address[]; rawUnits: bigint[]; nav: bigint; navValid: boolean; state: BasketStateTuple; nextSettleAt: number;
  };
  const raws: Raw[] = [];
  addresses.forEach((address, i) => {
    const r = ra.slice(1 + i * A, 1 + (i + 1) * A);
    const comps = ok<readonly [readonly Address[], readonly bigint[]]>(r[5]);
    const nav = ok<readonly [bigint, boolean]>(r[6]);
    const state = ok<BasketStateTuple>(r[7]);
    const name = ok<string>(r[0]);
    if (!comps || !state || name === undefined) return;
    raws.push({
      address,
      name,
      symbol: ok<string>(r[1]) ?? "",
      curator: ok<Address>(r[2]) ?? state.curator,
      mode: Number(ok<number>(r[3]) ?? 0) === 1 ? "PayInWif" : "Reinvest",
      totalSupply: ok<bigint>(r[4]) ?? 0n,
      tokens: [...comps[0]],
      rawUnits: [...comps[1]],
      nav: nav?.[0] ?? 0n,
      navValid: nav?.[1] ?? false,
      state,
      nextSettleAt: Number(ok<bigint | number>(r[8]) ?? 0),
    });
  });

  // batch B: per unique token (registry feed, multiplier, paused, symbol) + bench component
  const tokens = [...new Set(raws.flatMap((r) => r.tokens.map((t) => t.toLowerCase())))] as Address[];
  const rb = await batch(client, [
    ...(bench ? [{ address: registry, abi: componentRegistryAbi, functionName: "component", args: [bench] }] : []),
    ...tokens.flatMap((t) => [
      { address: registry, abi: componentRegistryAbi, functionName: "component", args: [t] },
      { address: t, abi: scaledUiAmountAbi, functionName: "uiMultiplier" },
      { address: t, abi: pausableTokenAbi, functionName: "paused" },
      // Only unknown tokens need an onchain symbol (the launch universe is mapped in config). On the rehearsal fork a
      // symbol() call on a Stock Token makes EDR fail the whole aggregate call, so we avoid it when we can.
      TICKER_BY_TOKEN[t.toLowerCase()]
        ? { address: t, abi: pausableTokenAbi, functionName: "paused" }
        : { address: t, abi: erc20SymbolAbi, functionName: "symbol" },
    ]),
  ]);
  const off = bench ? 1 : 0;
  const benchFeed = bench ? ok<{ priceFeed: Address }>(rb[0])?.priceFeed : undefined;
  const tokenInfo = new Map<string, { feed: Address; mult: bigint; paused: boolean; symbol?: string }>();
  tokens.forEach((t, i) => {
    const r = rb.slice(off + i * 4, off + (i + 1) * 4);
    tokenInfo.set(t, {
      feed: ok<{ priceFeed: Address }>(r[0])?.priceFeed ?? ("0x0000000000000000000000000000000000000000" as Address),
      mult: ok<bigint>(r[1]) ?? ONE,
      paused: ok<boolean>(r[2]) ?? false,
      symbol: TICKER_BY_TOKEN[t] ? undefined : ok<string>(r[3]),
    });
  });

  // batch C: feeds
  const feeds = [...new Set([...tokenInfo.values()].map((v) => v.feed.toLowerCase()).concat(benchFeed ? [benchFeed.toLowerCase()] : []))] as Address[];
  const rc = await batch(client, feeds.map((f) => ({ address: f, abi: aggregatorV3Abi, functionName: "latestRoundData" })));
  const feedData = new Map<string, Feed>();
  feeds.forEach((f, i) => {
    const t = ok<RoundTuple>(rc[i]);
    feedData.set(f, t && t[1] > 0n ? { price: Number(t[1]) / 1e8, updatedAt: Number(t[3]) } : {});
  });
  const benchPrice = benchFeed ? feedData.get(benchFeed.toLowerCase())?.price : undefined;

  const baskets: BasketDetail[] = raws.map((r) => {
    const comps: ComponentInfo[] = r.tokens.map((token, i) => {
      const info = tokenInfo.get(token.toLowerCase());
      const f = info ? feedData.get(info.feed.toLowerCase()) : undefined;
      const rawUnits = r.rawUnits[i] ?? 0n;
      return {
        token,
        ticker: TICKER_BY_TOKEN[token.toLowerCase()] ?? info?.symbol ?? token.slice(0, 8),
        rawUnits,
        unitsPerShare: Number(rawUnits) / 1e18,
        feed: info?.feed ?? ("0x0000000000000000000000000000000000000000" as Address),
        priceUsd: f?.price,
        feedUpdatedAt: f?.updatedAt,
        uiMultiplier: info?.mult ?? ONE,
        paused: info?.paused ?? false,
        weightPct: 0,
      };
    });
    const total = comps.reduce((s, c) => s + c.unitsPerShare * (c.priceUsd ?? 0), 0);
    for (const c of comps) c.weightPct = total > 0 ? ((c.unitsPerShare * (c.priceUsd ?? 0)) / total) * 100 : 0;

    const navLast = r.state.navLast;
    const benchLast = r.state.benchLast;
    let epoch: EpochPerformance | null = null;
    if (navLast > 0n && benchLast > 0n && r.navValid && benchPrice !== undefined) {
      const basketPct = (Number(r.nav) / Number(navLast) - 1) * 100;
      const benchPct = (benchPrice / (Number(benchLast) / 1e8) - 1) * 100;
      epoch = { basketPct, benchPct, beatPts: basketPct - benchPct, beating: basketPct > benchPct };
    }
    return {
      address: r.address,
      name: r.name,
      symbol: r.symbol,
      curator: r.curator,
      mode: r.mode,
      totalSupply: r.totalSupply,
      navPerShareUsd: Number(r.nav) / 1e18,
      navValid: r.navValid,
      tvlUsd: Number((r.totalSupply * r.nav) / ONE) / 1e18,
      components: comps,
      tickers: comps.map((c) => c.ticker),
      wifBacked: r.state.totalActive + r.state.totalWarming,
      nextSettleAt: r.nextSettleAt,
      lastSettledAt: Number(r.state.lastSettledAt),
      settleCount: Number(r.state.settleCount),
      epoch,
      benchFeed,
      benchPriceUsd: benchPrice,
    };
  });
  return { baskets, benchFeed, benchPrice };
}

async function listAddresses(): Promise<Address[]> {
  const client = getPublicClient();
  const factory = getDeployment().addresses.BasketFactory;
  const count = (await client.readContract({ address: factory, abi: basketFactoryAbi, functionName: "basketCount" })) as bigint;
  const res = await batch(
    client,
    Array.from({ length: Number(count) }, (_, i) => ({ address: factory, abi: basketFactoryAbi, functionName: "basketAt", args: [BigInt(i)] })),
  );
  return res.flatMap((r) => (r.status === "success" ? [r.result as Address] : []));
}

/**
 * All baskets with names, tokens, NAV, TVL, $WIF backed and live epoch performance vs SPY.
 * Server-side (multicall, 5 round trips); cached 15 seconds. Order: factory order (oldest first).
 */
export function listBaskets(): Promise<BasketSummary[]> {
  return cached("listBaskets", 15_000, async () => {
    const addrs = await listAddresses();
    return (await loadBaskets(addrs)).baskets;
  });
}

/**
 * One basket in full (summary + creation time + benchmark price). Cached 15 seconds per address.
 * @returns undefined when the address is not a basket of this factory
 */
export function basketDetail(address: string): Promise<BasketDetail | undefined> {
  let a: Address;
  try {
    a = getAddress(address);
  } catch {
    return Promise.resolve(undefined);
  }
  return cached(`basketDetail:${a}`, 15_000, async () => {
    const client = getPublicClient();
    const factory = getDeployment().addresses.BasketFactory;
    const isBasket = (await client.readContract({ address: factory, abi: basketFactoryAbi, functionName: "isBasket", args: [a] })) as boolean;
    if (!isBasket) return undefined;
    const [{ baskets }, created] = await Promise.all([loadBaskets([a]), getBasketCreation(a)]);
    const b = baskets[0];
    if (!b) return undefined;
    return { ...b, createdBlock: created?.blockNumber, createdAt: created?.timestamp };
  });
}
