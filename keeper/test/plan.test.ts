import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plan, isLowGas } from "../src/plan.ts";
import type { Address, BasketSnap, Snapshot, TokenSnap } from "../src/types.ts";

const B1 = "0x00000000000000000000000000000000000000b1" as Address;
const B2 = "0x00000000000000000000000000000000000000b2" as Address;
const T1 = "0x00000000000000000000000000000000000000a1" as Address;
const T2 = "0x00000000000000000000000000000000000000a2" as Address;
const NOW = 1_000_000n;
const CFG = { minEth: 200_000_000_000_000n };

function tok(token: Address, o: Partial<TokenSnap> = {}): TokenSnap {
  return { token, uiMultiplier: 10n ** 18n, lastMultiplier: 10n ** 18n, paused: false, pendingDividend: 0n, owed: 0n, ...o };
}
function bsk(basket: Address, o: Partial<BasketSnap> = {}): BasketSnap {
  return { basket, tokens: [tok(T1), tok(T2)], pendingFeeShares: 0n, nextSettleAt: NOW + 1000n, ...o };
}
function snap(baskets: BasketSnap[], o: Partial<Snapshot> = {}): Snapshot {
  return { timestamp: NOW, keeperEth: 10n ** 18n, baskets, ...o };
}

test("idle: no actions", () => {
  assert.deepEqual(plan(snap([bsk(B1), bsk(B2)]), CFG), []);
  assert.deepEqual(plan(snap([]), CFG), []);
});

test("rule 1: multiplier change -> sync", () => {
  const s = snap([bsk(B1, { tokens: [tok(T1, { uiMultiplier: 2n * 10n ** 18n }), tok(T2)] })]);
  assert.deepEqual(plan(s, CFG), [{ kind: "sync", basket: B1 }]);
});

test("rule 1: sync skipped when a dividend harvest is planned", () => {
  const s = snap([bsk(B1, { tokens: [tok(T1, { uiMultiplier: 2n, pendingDividend: 5n }), tok(T2)] })]);
  assert.deepEqual(plan(s, CFG), [{ kind: "harvestDividends", basket: B1 }]);
});

test("rule 1: sync skipped when a fee harvest is planned", () => {
  const s = snap([bsk(B1, { pendingFeeShares: 1n, tokens: [tok(T1, { uiMultiplier: 2n }), tok(T2)] })]);
  assert.deepEqual(plan(s, CFG), [{ kind: "harvestFees", basket: B1 }]);
});

test("rule 2: pending dividend -> harvestDividends", () => {
  const s = snap([bsk(B1, { tokens: [tok(T1), tok(T2, { pendingDividend: 1n })] })]);
  assert.deepEqual(plan(s, CFG), [{ kind: "harvestDividends", basket: B1 }]);
});

test("rule 3: pending fee shares -> harvestFees", () => {
  assert.deepEqual(plan(snap([bsk(B1, { pendingFeeShares: 7n })]), CFG), [{ kind: "harvestFees", basket: B1 }]);
});

test("rule 4: owed IOU on unpaused token -> claimIOU", () => {
  const s = snap([bsk(B1, { tokens: [tok(T1, { owed: 9n }), tok(T2)] })]);
  assert.deepEqual(plan(s, CFG), [{ kind: "claimIOU", basket: B1, token: T1 }]);
});

test("rule 4: paused token IOU is skipped", () => {
  const s = snap([bsk(B1, { tokens: [tok(T1, { owed: 9n, paused: true }), tok(T2, { owed: 3n })] })]);
  assert.deepEqual(plan(s, CFG), [{ kind: "claimIOU", basket: B1, token: T2 }]);
});

test("rule 5: settle when now >= nextSettleAt (boundary inclusive)", () => {
  assert.deepEqual(plan(snap([bsk(B1, { nextSettleAt: NOW })]), CFG), [{ kind: "settle", basket: B1 }]);
  assert.deepEqual(plan(snap([bsk(B1, { nextSettleAt: NOW - 1n })]), CFG), [{ kind: "settle", basket: B1 }]);
  assert.deepEqual(plan(snap([bsk(B1, { nextSettleAt: NOW + 1n })]), CFG), []);
});

test("ordering: dividends, IOU claims, fees, settle; per basket in snapshot order", () => {
  const s = snap([
    bsk(B1, {
      pendingFeeShares: 1n,
      nextSettleAt: 0n,
      tokens: [tok(T1, { owed: 1n, pendingDividend: 1n }), tok(T2, { owed: 1n })],
    }),
    bsk(B2, { tokens: [tok(T1, { uiMultiplier: 5n }), tok(T2)], nextSettleAt: 0n }),
  ]);
  assert.deepEqual(plan(s, CFG), [
    { kind: "harvestDividends", basket: B1 },
    { kind: "claimIOU", basket: B1, token: T1 },
    { kind: "claimIOU", basket: B1, token: T2 },
    { kind: "harvestFees", basket: B1 },
    { kind: "settle", basket: B1 },
    { kind: "sync", basket: B2 },
    { kind: "settle", basket: B2 },
  ]);
});

test("rule 6: low gas plans only sync and settle", () => {
  const s = snap(
    [
      bsk(B1, { pendingFeeShares: 1n, nextSettleAt: 0n, tokens: [tok(T1, { owed: 1n, pendingDividend: 1n, uiMultiplier: 3n }), tok(T2)] }),
    ],
    { keeperEth: CFG.minEth - 1n },
  );
  assert.equal(isLowGas(s, CFG), true);
  assert.deepEqual(plan(s, CFG), [
    { kind: "sync", basket: B1 },
    { kind: "settle", basket: B1 },
  ]);
});

test("low gas guard: exactly MIN_ETH is fine; unknown balance never triggers", () => {
  const b = bsk(B1, { pendingFeeShares: 1n });
  assert.deepEqual(plan(snap([b], { keeperEth: CFG.minEth }), CFG), [{ kind: "harvestFees", basket: B1 }]);
  assert.deepEqual(plan(snap([b], { keeperEth: null }), CFG), [{ kind: "harvestFees", basket: B1 }]);
});

test("plan.ts is pure: imports no viem and no I/O modules", () => {
  const src = readFileSync(new URL("../src/plan.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from\s+["'](viem|node:)/);
});
