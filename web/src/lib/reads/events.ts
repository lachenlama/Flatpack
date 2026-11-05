import { getAbiItem, type Abi, type AbiEvent, type Address, type Hex } from "viem";
import {
  backingVaultAbi,
  basketFactoryAbi,
  feeHarvesterAbi,
  flatpackRouterAbi,
} from "../../../../shared/abi/index.ts";
import { cached } from "../cache.ts";
import { getPublicClient } from "../chain.ts";
import { getDeployment } from "../deployment.ts";

/** RPC limit: never ask for more than this many blocks in one getLogs call. */
export const LOG_CHUNK_BLOCKS = 9_000_000n;
const LOG_TTL_MS = 60_000;

/** A decoded log. `args` holds the event's named arguments (bigints for uint256). */
export interface EventLog<A extends Record<string, unknown> = Record<string, unknown>> {
  args: A;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

/**
 * Fetches all logs of one event from `fromBlock` to latest in chunks of {@link LOG_CHUNK_BLOCKS} blocks. Cached 60 seconds.
 * @param address emitting contract
 * @param abi ABI containing the event
 * @param eventName event name
 * @param args optional indexed-argument filter
 */
export function getEventLogs<A extends Record<string, unknown>>(
  address: Address,
  abi: Abi,
  eventName: string,
  args?: Record<string, unknown>,
  fromBlock: bigint = BigInt(getDeployment().blockNumber),
): Promise<EventLog<A>[]> {
  const key = `logs:${address}:${eventName}:${JSON.stringify(args ?? {}, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}:${fromBlock}`;
  return cached(key, LOG_TTL_MS, async () => {
    const client = getPublicClient();
    const event = getAbiItem({ abi, name: eventName }) as AbiEvent;
    const latest = await client.getBlockNumber();
    const out: EventLog<A>[] = [];
    for (let from = fromBlock; from <= latest; from += LOG_CHUNK_BLOCKS) {
      const to = from + LOG_CHUNK_BLOCKS - 1n < latest ? from + LOG_CHUNK_BLOCKS - 1n : latest;
      const logs = await client.getLogs({ address, event, args: args as never, fromBlock: from, toBlock: to });
      for (const l of logs as unknown as { args: A; blockNumber: bigint; transactionHash: Hex; logIndex: number }[]) {
        out.push({ args: l.args, blockNumber: l.blockNumber, transactionHash: l.transactionHash, logIndex: l.logIndex });
      }
    }
    return out;
  });
}

/** Block timestamps (unix seconds) for a set of block numbers, cached. */
export async function blockTimestamps(blocks: readonly bigint[]): Promise<Map<bigint, number>> {
  const client = getPublicClient();
  const unique = [...new Set(blocks)];
  const entries = await Promise.all(
    unique.map(async (n) => {
      const ts = await cached(`blockts:${n}`, 3_600_000, async () => Number((await client.getBlock({ blockNumber: n })).timestamp));
      return [n, ts] as const;
    }),
  );
  return new Map(entries);
}

// ---- typed event readers --------------------------------------------------------------------------------------------

export type FeesHarvestedArgs = {
  basket: Address; cycle: bigint; feeShares: bigint; wifOut: bigint; burned: bigint;
  toReferrers: bigint; toVaultBackers: bigint; toVaultCurator: bigint;
};
export type DividendsHarvestedArgs = { basket: Address; wifOut: bigint };
export type EpochSettledArgs = {
  basket: Address; settledAt: bigint; navLast: bigint; navNow: bigint; benchLast: bigint; benchNow: bigint;
  beat: boolean; releasedBackers: bigint; releasedCurator: bigint; burned: bigint;
};
export type BoughtArgs = {
  basket: Address; buyer: Address; receiver: Address; referrer: Address; shares: bigint; sharesOut: bigint; usdgSpent: bigint;
};
export type BasketCreatedArgs = {
  basket: Address; curator: Address; name: string; symbol: string; tokens: Address[]; rawUnits: bigint[]; mode: number; curatorStake: bigint;
};

/** `FeesHarvested` logs (optionally for one basket). */
export const feesHarvestedLogs = (basket?: Address) =>
  getEventLogs<FeesHarvestedArgs>(getDeployment().addresses.FeeHarvester, feeHarvesterAbi, "FeesHarvested", basket ? { basket } : undefined);
/** `DividendsHarvested` logs. */
export const dividendsHarvestedLogs = (basket?: Address) =>
  getEventLogs<DividendsHarvestedArgs>(getDeployment().addresses.FeeHarvester, feeHarvesterAbi, "DividendsHarvested", basket ? { basket } : undefined);
/** `EpochSettled` logs from the BackingVault. */
export const epochSettledLogs = (basket?: Address) =>
  getEventLogs<EpochSettledArgs>(getDeployment().addresses.BackingVault, backingVaultAbi, "EpochSettled", basket ? { basket } : undefined);
/** `Bought` logs from the router. */
export const boughtLogs = (basket?: Address) =>
  getEventLogs<BoughtArgs>(getDeployment().addresses.FlatpackRouter, flatpackRouterAbi, "Bought", basket ? { basket } : undefined);
/** `BasketCreated` logs from the factory. */
export const basketCreatedLogs = (basket?: Address) =>
  getEventLogs<BasketCreatedArgs>(getDeployment().addresses.BasketFactory, basketFactoryAbi, "BasketCreated", basket ? { basket } : undefined);

/** Creation block and time of a basket, if its BasketCreated log is found. */
export async function getBasketCreation(basket: Address): Promise<{ blockNumber: bigint; timestamp: number; transactionHash: Hex } | undefined> {
  const logs = await basketCreatedLogs(basket);
  const l = logs[0];
  if (!l) return undefined;
  const ts = (await blockTimestamps([l.blockNumber])).get(l.blockNumber);
  return ts === undefined ? undefined : { blockNumber: l.blockNumber, timestamp: ts, transactionHash: l.transactionHash };
}
