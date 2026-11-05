import type { Address } from "viem";
import { aggregatorV3Abi, basketFactoryAbi, componentRegistryAbi } from "../../../../shared/abi/index.ts";
import { LAUNCH_UNIVERSE, getPublicClient } from "../../lib/chain.ts";
import { getDeployment } from "../../lib/deployment.ts";
import { batch, ok } from "../../lib/reads/multicall.ts";

/** A token the curator may pick: enabled in the ComponentRegistry, with live feed data. Serializable (no bigint). */
export interface PickableToken {
  ticker: string;
  token: Address;
  feed: Address;
  priceUsd?: number;
  /** Unix seconds of the last Chainlink update. */
  feedUpdatedAt?: number;
}

/** Server-side data of the Assemble page. */
export interface AssembleData {
  tokens: PickableToken[];
  /** minCuratorStake as a decimal string (18-decimals $WIF raw units). */
  minStake: string;
  createPaused: boolean;
}

type Comp = { enabled: boolean; priceFeed: Address };
type Round = readonly [bigint, bigint, bigint, bigint, bigint];

/** Enabled registry components (from the launch universe) + factory settings, in two multicall round trips. */
export async function loadAssembleData(): Promise<AssembleData> {
  const dep = getDeployment().addresses;
  const client = getPublicClient();
  const entries = Object.entries(LAUNCH_UNIVERSE);
  const a = await batch(client, [
    { address: dep.BasketFactory, abi: basketFactoryAbi, functionName: "minCuratorStake" },
    { address: dep.BasketFactory, abi: basketFactoryAbi, functionName: "createPaused" },
    ...entries.map(([, u]) => ({ address: dep.ComponentRegistry, abi: componentRegistryAbi, functionName: "component", args: [u.token] })),
  ]);
  const enabled = entries
    .map(([ticker, u], i) => ({ ticker, token: u.token as Address, comp: ok<Comp>(a[2 + i]) }))
    .filter((e) => e.comp?.enabled && e.comp.priceFeed);
  const rounds = await batch(
    client,
    enabled.map((e) => ({ address: (e.comp as Comp).priceFeed, abi: aggregatorV3Abi, functionName: "latestRoundData" })),
  );
  const tokens: PickableToken[] = enabled.map((e, i) => {
    const r = ok<Round>(rounds[i]);
    return {
      ticker: e.ticker,
      token: e.token,
      feed: (e.comp as Comp).priceFeed,
      priceUsd: r && r[1] > 0n ? Number(r[1]) / 1e8 : undefined,
      feedUpdatedAt: r ? Number(r[3]) : undefined,
    };
  });
  tokens.sort((x, y) => x.ticker.localeCompare(y.ticker));
  return {
    tokens,
    minStake: (ok<bigint>(a[0]) ?? 0n).toString(),
    createPaused: ok<boolean>(a[1]) ?? false,
  };
}
