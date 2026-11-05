// Executes planned actions one at a time: simulate -> (send -> wait). Each action is isolated in try/catch.
import { BaseError, ContractFunctionRevertedError } from "viem";
import { backingVaultAbi, basketAbi, feeHarvesterAbi } from "../../shared/abi/index.ts";
import type { Action, Address, Hex, Result } from "./types.ts";

/** The only client surface exec needs, so tests can pass a small fake. */
export type ExecClient = {
  simulateContract(args: any): Promise<{ result: unknown; request: any }>;
  writeContract(request: any): Promise<Hex>;
  waitForTransactionReceipt(args: { hash: Hex }): Promise<{ status: string }>;
  getBlock(args?: any): Promise<{ timestamp: bigint }>;
};

export type ExecContext = {
  client: ExecClient;
  /** The keeper account address (used as the simulation sender). */
  account: Address;
  addresses: { FeeHarvester: Address; BackingVault: Address };
};

export type ExecConfig = {
  dryRun: boolean;
  minHarvestWif: bigint;
  slippageBps: bigint;
  deadlineSecs: bigint;
};

/** Errors that mean "nothing to do right now": skipped, not failed. */
const BENIGN = new Set(["NothingToHarvest", "NothingOwed"]);

/** wifOut * (10000 - slippageBps) / 10000, bigint only. */
export function applySlippage(wifOut: bigint, slippageBps: bigint): bigint {
  return (wifOut * (10000n - slippageBps)) / 10000n;
}

export type DecodedError = { message: string; name?: string };

export function decodeError(e: unknown): DecodedError {
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name) {
        const args = (reverted.data?.args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : String(a)));
        return { name, message: `${name}(${args.join(", ")})` };
      }
      return { message: reverted.reason ?? reverted.shortMessage };
    }
    return { message: e.shortMessage };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { message: msg.slice(0, 300) };
}

type Call = { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] };

function callFor(a: Action, ctx: ExecContext, minWifOut: bigint, deadline: bigint): Call {
  const h = ctx.addresses.FeeHarvester;
  switch (a.kind) {
    case "sync":
      return { address: a.basket, abi: basketAbi, functionName: "sync", args: [] };
    case "settle":
      return { address: ctx.addresses.BackingVault, abi: backingVaultAbi, functionName: "settle", args: [a.basket] };
    case "claimIOU":
      return { address: h, abi: feeHarvesterAbi, functionName: "claimIOU", args: [a.basket, a.token] };
    case "harvestFees":
      return { address: h, abi: feeHarvesterAbi, functionName: "harvestFees", args: [a.basket, minWifOut, deadline] };
    case "harvestDividends":
      return { address: h, abi: feeHarvesterAbi, functionName: "harvestDividends", args: [a.basket, minWifOut, deadline] };
  }
}

async function send(ctx: ExecContext, call: Call, dryRun: boolean): Promise<{ txHash?: Hex; result: unknown }> {
  const sim = await ctx.client.simulateContract({ ...call, account: ctx.account });
  if (dryRun) return { result: sim.result };
  const txHash = await ctx.client.writeContract(sim.request);
  const receipt = await ctx.client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`transaction reverted onchain: ${txHash}`);
  return { txHash, result: sim.result };
}

async function runOne(a: Action, ctx: ExecContext, cfg: ExecConfig): Promise<Result> {
  if (a.kind !== "harvestFees" && a.kind !== "harvestDividends") {
    const { txHash } = await send(ctx, callFor(a, ctx, 0n, 0n), cfg.dryRun);
    return { action: a, status: cfg.dryRun ? "dry-run" : "ok", txHash };
  }

  // Harvest: simulate with minWifOut = 1 to learn wifOut, then send with the haircut.
  const block = await ctx.client.getBlock({ blockTag: "latest" });
  const deadline = block.timestamp + cfg.deadlineSecs;
  const sim = await ctx.client.simulateContract({ ...callFor(a, ctx, 1n, deadline), account: ctx.account });
  const wifOut = sim.result as bigint;

  if (a.kind === "harvestFees" && wifOut < cfg.minHarvestWif) {
    return { action: a, status: "below-threshold", wifOut, reason: `wifOut ${wifOut} < MIN_HARVEST_WIF ${cfg.minHarvestWif}` };
  }
  const minWifOut = applySlippage(wifOut, cfg.slippageBps);
  if (minWifOut === 0n) {
    return { action: a, status: "skipped", wifOut, minWifOut, reason: "minWifOut computes to 0" };
  }
  if (cfg.dryRun) return { action: a, status: "dry-run", wifOut, minWifOut };

  const txHash = await ctx.client.writeContract(
    (await ctx.client.simulateContract({ ...callFor(a, ctx, minWifOut, deadline), account: ctx.account })).request,
  );
  const receipt = await ctx.client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`transaction reverted onchain: ${txHash}`);
  return { action: a, status: "ok", txHash, wifOut, minWifOut };
}

export async function execute(actions: Action[], ctx: ExecContext, cfg: ExecConfig): Promise<Result[]> {
  const results: Result[] = [];
  for (const a of actions) {
    try {
      results.push(await runOne(a, ctx, cfg));
    } catch (e) {
      const d = decodeError(e);
      if (d.name && BENIGN.has(d.name)) {
        results.push({ action: a, status: "skipped", reason: d.message });
      } else {
        results.push({ action: a, status: "failed", error: d.message });
      }
    }
  }
  return results;
}
