import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { feeHarvesterAbi } from "../../shared/abi/index.ts";
import { execute, applySlippage, decodeError } from "../src/exec.ts";
import type { ExecClient, ExecConfig, ExecContext } from "../src/exec.ts";
import type { Action, Address, Hex } from "../src/types.ts";

const B1 = "0x00000000000000000000000000000000000000b1" as Address;
const B2 = "0x00000000000000000000000000000000000000b2" as Address;
const B3 = "0x00000000000000000000000000000000000000b3" as Address;
const T1 = "0x00000000000000000000000000000000000000a1" as Address;
const ACCOUNT = "0x00000000000000000000000000000000000000cc" as Address;
const HARVESTER = "0x00000000000000000000000000000000000000f1" as Address;
const VAULT = "0x00000000000000000000000000000000000000f2" as Address;
const WIF = 10n ** 18n;

const CFG: ExecConfig = { dryRun: false, minHarvestWif: 100n * WIF, slippageBps: 100n, deadlineSecs: 300n };

type Calls = { sims: any[]; writes: any[]; waits: Hex[] };

function revertError(errorName: string, args: unknown[]): Error {
  const data = encodeErrorResult({ abi: feeHarvesterAbi, errorName, args } as any);
  const inner = new ContractFunctionRevertedError({ abi: feeHarvesterAbi, data, functionName: "harvestFees" });
  return new BaseError("simulation failed", { cause: inner });
}

function fake(opts: {
  result?: (call: any) => unknown;
  simError?: (call: any, n: number) => Error | undefined;
  receiptStatus?: string;
}): { client: ExecClient; calls: Calls } {
  const calls: Calls = { sims: [], writes: [], waits: [] };
  const client: ExecClient = {
    async simulateContract(args) {
      calls.sims.push(args);
      const err = opts.simError?.(args, calls.sims.length);
      if (err) throw err;
      return { result: opts.result ? opts.result(args) : undefined, request: { ...args, __req: true } };
    },
    async writeContract(req) {
      calls.writes.push(req);
      return ("0x" + String(calls.writes.length).padStart(64, "0")) as Hex;
    },
    async waitForTransactionReceipt({ hash }) {
      calls.waits.push(hash);
      return { status: opts.receiptStatus ?? "success" };
    },
    async getBlock() {
      return { timestamp: 5000n };
    },
  };
  return { client, calls };
}

const ctx = (client: ExecClient): ExecContext => ({
  client,
  account: ACCOUNT,
  addresses: { FeeHarvester: HARVESTER, BackingVault: VAULT },
});

test("applySlippage boundaries (bigint)", () => {
  assert.equal(applySlippage(1000n * WIF, 0n), 1000n * WIF);
  assert.equal(applySlippage(1000n * WIF, 1000n), 900n * WIF);
  assert.equal(applySlippage(1000n * WIF, 100n), 990n * WIF);
  assert.equal(applySlippage(1n, 100n), 0n);
  assert.equal(applySlippage(10000n, 1n), 9999n);
});

test("harvestFees: simulates with minWifOut=1, sends with haircut and deadline", async () => {
  const { client, calls } = fake({ result: () => 1000n * WIF });
  const [r] = await execute([{ kind: "harvestFees", basket: B1 }], ctx(client), CFG);
  assert.equal(r.status, "ok");
  assert.equal(r.wifOut, 1000n * WIF);
  assert.equal(r.minWifOut, 990n * WIF);
  assert.equal(calls.sims[0].functionName, "harvestFees");
  assert.deepEqual(calls.sims[0].args, [B1, 1n, 5300n]);
  assert.deepEqual(calls.sims[1].args, [B1, 990n * WIF, 5300n]);
  assert.equal(calls.writes.length, 1);
  assert.deepEqual(calls.writes[0].args, [B1, 990n * WIF, 5300n]);
  assert.equal(calls.sims[0].account, ACCOUNT);
  assert.equal(calls.waits.length, 1);
  assert.match(r.txHash!, /^0x0+1$/);
});

test("minWifOut at slippage 0 and 1000 bps through execute", async () => {
  for (const [bps, expected] of [[0n, 1000n * WIF], [1000n, 900n * WIF]] as const) {
    const { client, calls } = fake({ result: () => 1000n * WIF });
    const [r] = await execute([{ kind: "harvestDividends", basket: B1 }], ctx(client), { ...CFG, slippageBps: bps });
    assert.equal(r.minWifOut, expected);
    assert.equal(calls.writes[0].args[1], expected);
  }
});

test("harvestFees below MIN_HARVEST_WIF is skipped without sending", async () => {
  const { client, calls } = fake({ result: () => 99n * WIF });
  const [r] = await execute([{ kind: "harvestFees", basket: B1 }], ctx(client), CFG);
  assert.equal(r.status, "below-threshold");
  assert.equal(r.wifOut, 99n * WIF);
  assert.equal(calls.writes.length, 0);
  // exactly at the threshold sends
  const f2 = fake({ result: () => 100n * WIF });
  const [r2] = await execute([{ kind: "harvestFees", basket: B1 }], ctx(f2.client), CFG);
  assert.equal(r2.status, "ok");
});

test("harvestDividends ignores the fee threshold", async () => {
  const { client, calls } = fake({ result: () => 5n * WIF });
  const [r] = await execute([{ kind: "harvestDividends", basket: B1 }], ctx(client), CFG);
  assert.equal(r.status, "ok");
  assert.equal(calls.writes.length, 1);
});

test("minWifOut that computes to 0 skips the harvest", async () => {
  const { client, calls } = fake({ result: () => 1n });
  const [r] = await execute([{ kind: "harvestDividends", basket: B1 }], ctx(client), CFG);
  assert.equal(r.status, "skipped");
  assert.equal(calls.writes.length, 0);
});

test("failure isolation: 2nd action reverts, 3rd still runs", async () => {
  const actions: Action[] = [
    { kind: "sync", basket: B1 },
    { kind: "settle", basket: B2 },
    { kind: "claimIOU", basket: B3, token: T1 },
  ];
  const { client, calls } = fake({
    simError: (call) => (call.functionName === "settle" ? revertError("InsufficientWifOut", [1n, 2n]) : undefined),
  });
  const rs = await execute(actions, ctx(client), CFG);
  assert.deepEqual(rs.map((r) => r.status), ["ok", "failed", "ok"]);
  assert.match(rs[1].error!, /InsufficientWifOut\(1, 2\)/);
  assert.equal(calls.writes.length, 2);
  assert.equal(calls.sims[0].address, B1);
  assert.equal(calls.sims[1].address, VAULT);
  assert.deepEqual(calls.sims[1].args, [B2]);
  assert.equal(calls.sims[2].address, HARVESTER);
  assert.deepEqual(calls.sims[2].args, [B3, T1]);
});

test("sequential: each receipt is awaited before the next send", async () => {
  const order: string[] = [];
  const client: ExecClient = {
    async simulateContract(a) { return { result: 0n, request: a }; },
    async writeContract(r) { order.push("send:" + r.address); return "0x01" as Hex; },
    async waitForTransactionReceipt() { order.push("wait"); return { status: "success" }; },
    async getBlock() { return { timestamp: 1n }; },
  };
  await execute([{ kind: "sync", basket: B1 }, { kind: "sync", basket: B2 }], ctx(client), CFG);
  assert.deepEqual(order, ["send:" + B1, "wait", "send:" + B2, "wait"]);
});

test("onchain revert (receipt status) is a failure", async () => {
  const { client } = fake({ receiptStatus: "reverted" });
  const [r] = await execute([{ kind: "sync", basket: B1 }], ctx(client), CFG);
  assert.equal(r.status, "failed");
});

test("dry-run simulates but never writes", async () => {
  const { client, calls } = fake({ result: () => 1000n * WIF });
  const actions: Action[] = [
    { kind: "sync", basket: B1 },
    { kind: "harvestFees", basket: B1 },
    { kind: "harvestDividends", basket: B2 },
    { kind: "settle", basket: B2 },
    { kind: "claimIOU", basket: B3, token: T1 },
  ];
  const rs = await execute(actions, ctx(client), { ...CFG, dryRun: true });
  assert.deepEqual(rs.map((r) => r.status), ["dry-run", "dry-run", "dry-run", "dry-run", "dry-run"]);
  assert.equal(rs[1].minWifOut, 990n * WIF);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.waits.length, 0);
  assert.ok(calls.sims.length >= 5);
});

test("custom-error decoding", () => {
  assert.deepEqual(decodeError(revertError("Expired", [])), { name: "Expired", message: "Expired()" });
  assert.equal(decodeError(revertError("InsufficientWifOut", [5n, 9n])).message, "InsufficientWifOut(5, 9)");
  assert.equal(decodeError(new Error("boom")).message, "boom");
});

test("benign NothingToHarvest is skipped, not failed", async () => {
  const { client } = fake({ simError: () => revertError("NothingToHarvest", []) });
  const [r] = await execute([{ kind: "harvestFees", basket: B1 }], ctx(client), CFG);
  assert.equal(r.status, "skipped");
  assert.match(r.reason!, /NothingToHarvest/);
});
