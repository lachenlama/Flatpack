// Chain snapshot. Round trips per tick: basketCount, then three Multicall3 batches
// (basket list; per-basket data; per-token data), because each step depends on the previous one.
import type { PublicClient } from "viem";
import {
  backingVaultAbi,
  basketAbi,
  basketFactoryAbi,
  feeHarvesterAbi,
  pausableTokenAbi,
  scaledUiAmountAbi,
} from "../../shared/abi/index.ts";
import { logEvent } from "./log.ts";
import type { Address, Addresses, BasketSnap, Snapshot, TokenSnap } from "./types.ts";

type Call = { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] };
type CallResult = { status: "success"; result: unknown } | { status: "failure"; error: Error };

async function batch(client: PublicClient, contracts: Call[]): Promise<CallResult[]> {
  if (contracts.length === 0) return [];
  // viem's multicall generics do not accept dynamically built call lists; the runtime shape is correct.
  const res = await (client as any).multicall({ contracts, allowFailure: true });
  return res as CallResult[];
}

export async function snapshot(
  client: PublicClient,
  addresses: Pick<Addresses, "BasketFactory" | "FeeHarvester" | "BackingVault">,
  keeper: Address | null,
): Promise<Snapshot> {
  const { BasketFactory: factory, FeeHarvester: harvester, BackingVault: vault } = addresses;

  const [count, block, keeperEth] = await Promise.all([
    client.readContract({ address: factory, abi: basketFactoryAbi, functionName: "basketCount" }) as Promise<bigint>,
    client.getBlock({ blockTag: "latest" }),
    keeper ? client.getBalance({ address: keeper }) : Promise.resolve(null),
  ]);

  // Step 1: basket list
  const listCalls: Call[] = [];
  for (let i = 0n; i < count; i++) {
    listCalls.push({ address: factory, abi: basketFactoryAbi, functionName: "basketAt", args: [i] });
  }
  const list = await batch(client, listCalls);
  const baskets: Address[] = [];
  list.forEach((r, i) => {
    if (r.status === "success") baskets.push(r.result as Address);
    else logEvent({ level: "warn", msg: "basketAt failed", index: i });
  });

  // Step 2: per-basket data
  const perBasket: Call[] = [];
  for (const b of baskets) {
    perBasket.push(
      { address: b, abi: basketAbi, functionName: "components" },
      { address: b, abi: basketAbi, functionName: "lastMultipliers" },
      { address: harvester, abi: feeHarvesterAbi, functionName: "pendingFeeShares", args: [b] },
      { address: vault, abi: backingVaultAbi, functionName: "nextSettleAt", args: [b] },
    );
  }
  const r2 = await batch(client, perBasket);

  type Partial = { basket: Address; tokens: Address[]; last: bigint[]; fees: bigint; next: bigint };
  const partials: Partial[] = [];
  baskets.forEach((basket, i) => {
    const [comps, last, fees, next] = r2.slice(i * 4, i * 4 + 4);
    if (comps.status !== "success" || last.status !== "success" || fees.status !== "success" || next.status !== "success") {
      logEvent({ level: "warn", msg: "basket read failed, skipping", basket });
      return;
    }
    const tokens = (comps.result as readonly [readonly Address[], readonly bigint[]])[0];
    partials.push({ basket, tokens: [...tokens], last: [...(last.result as readonly bigint[])], fees: fees.result as bigint, next: BigInt(next.result as bigint | number) });
  });

  // Step 3: per-token data (4 calls per token)
  const perToken: Call[] = [];
  for (const p of partials) {
    for (const t of p.tokens) {
      perToken.push(
        { address: t, abi: scaledUiAmountAbi, functionName: "uiMultiplier" },
        { address: t, abi: pausableTokenAbi, functionName: "paused" },
        { address: harvester, abi: feeHarvesterAbi, functionName: "pendingDividend", args: [p.basket, t] },
        { address: p.basket, abi: basketAbi, functionName: "owed", args: [harvester, t] },
      );
    }
  }
  const r3 = await batch(client, perToken);

  const out: BasketSnap[] = [];
  let cursor = 0;
  for (const p of partials) {
    const tokens: TokenSnap[] = [];
    let ok = true;
    p.tokens.forEach((token, i) => {
      const [ui, paused, div, owed] = r3.slice(cursor, cursor + 4);
      cursor += 4;
      const last = p.last[i];
      if (div.status !== "success" || owed.status !== "success" || last === undefined) {
        ok = false;
        return;
      }
      tokens.push({
        token,
        // A token without uiMultiplier() is treated as unchanged; a missing paused() means not paused.
        uiMultiplier: ui.status === "success" ? (ui.result as bigint) : last,
        lastMultiplier: last,
        paused: paused.status === "success" ? (paused.result as boolean) : false,
        pendingDividend: div.result as bigint,
        owed: owed.result as bigint,
      });
    });
    if (!ok) {
      logEvent({ level: "warn", msg: "token read failed, skipping basket", basket: p.basket });
      continue;
    }
    out.push({ basket: p.basket, tokens, pendingFeeShares: p.fees, nextSettleAt: p.next });
  }

  return { timestamp: block.timestamp, keeperEth, baskets: out };
}
