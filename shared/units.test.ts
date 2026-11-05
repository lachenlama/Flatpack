import { test } from "node:test";
import assert from "node:assert/strict";
import { rawUnitsFor, shareValueUsd18, type Address } from "./units.ts";

const A: Address = "0x0000000000000000000000000000000000000003";
const B: Address = "0x00000000000000000000000000000000000000Aa";
const C: Address = "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF";
const E18 = 10n ** 18n;

test("sorts ascending by address and keeps pairing", () => {
  const r = rawUnitsFor({
    tokens: [C, A, B],
    weightsBps: [5000, 3000, 2000],
    pricesUsd8: [200n * 10n ** 8n, 100n * 10n ** 8n, 50n * 10n ** 8n],
    targetShareUsd18: 100n * E18,
  });
  assert.deepEqual(r.tokens, [A, B, C]);
  // A: $30 / $100 = 0.3 ; B: $20 / $50 = 0.4 ; C: $50 / $200 = 0.25
  assert.deepEqual(r.rawUnits, [3n * E18 / 10n, 4n * E18 / 10n, 25n * E18 / 100n]);
});

test("share value is within 0.01% of target", () => {
  const prices = [18_734_512_345n, 41_298_000n, 52_113_777_001n, 9_999_999n];
  const tokens: Address[] = [
    "0x0000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000004",
    "0x0000000000000000000000000000000000000008",
  ];
  const target = 137n * E18 + 12345n;
  const r = rawUnitsFor({ tokens, weightsBps: [4000, 3000, 2000, 1000], pricesUsd8: prices, targetShareUsd18: target });
  const value = shareValueUsd18(r.rawUnits, prices);
  const diff = value > target ? value - target : target - value;
  assert.ok(diff * 10_000n <= target, `diff ${diff} too large`);
});

test("rounds half up", () => {
  // 1 USD * 50% / price 2 USD = 0.25e18 exactly; use a price giving a .5 remainder:
  // target 1 wei-USD18 * 5000bps * 1e8 / (1e4 * price) = 5e11 / (1e4 * price)... craft: price 4e8 => 5e11/4e12 = 0.125 -> 0 -> min 1
  const r = rawUnitsFor({
    tokens: [A, B],
    weightsBps: [5000, 5000],
    pricesUsd8: [4n * 10n ** 8n, 8n * 10n ** 8n],
    targetShareUsd18: 3n, // 3*5000*1e8/(1e4*4e8)=0.375 -> 0 -> min 1 ; 3*5000*1e8/(1e4*8e8)=0.1875 -> 1
  });
  assert.deepEqual(r.rawUnits, [1n, 1n]);
  const h = rawUnitsFor({
    tokens: [A, B],
    weightsBps: [5000, 5000],
    pricesUsd8: [10n ** 8n, 10n ** 8n],
    targetShareUsd18: 3n, // 3*5000/1e4 = 1.5 -> 2
  });
  assert.deepEqual(h.rawUnits, [2n, 2n]);
});

test("never returns zero units", () => {
  const r = rawUnitsFor({
    tokens: [A, B],
    weightsBps: [9999, 1],
    pricesUsd8: [10n ** 8n, 10n ** 12n],
    targetShareUsd18: 1000n,
  });
  assert.ok(r.rawUnits.every((u) => u > 0n));
});

test("throws when weights do not sum to 10000", () => {
  assert.throws(
    () => rawUnitsFor({ tokens: [A, B], weightsBps: [5000, 4999], pricesUsd8: [1n, 1n], targetShareUsd18: E18 }),
    /sum/,
  );
});

test("throws on non-positive price", () => {
  assert.throws(
    () => rawUnitsFor({ tokens: [A, B], weightsBps: [5000, 5000], pricesUsd8: [1n, 0n], targetShareUsd18: E18 }),
    /price/,
  );
  assert.throws(
    () => rawUnitsFor({ tokens: [A, B], weightsBps: [5000, 5000], pricesUsd8: [1n, -5n], targetShareUsd18: E18 }),
    /price/,
  );
});

test("throws on duplicates (case-insensitive)", () => {
  assert.throws(
    () =>
      rawUnitsFor({
        tokens: [B, "0x00000000000000000000000000000000000000aa"],
        weightsBps: [5000, 5000],
        pricesUsd8: [1n, 1n],
        targetShareUsd18: E18,
      }),
    /duplicate/,
  );
});

test("throws on length mismatch, empty input and zero target", () => {
  assert.throws(() => rawUnitsFor({ tokens: [A, B], weightsBps: [10000], pricesUsd8: [1n, 1n], targetShareUsd18: E18 }), /length/);
  assert.throws(() => rawUnitsFor({ tokens: [], weightsBps: [], pricesUsd8: [], targetShareUsd18: E18 }), /no tokens/);
  assert.throws(() => rawUnitsFor({ tokens: [A], weightsBps: [10000], pricesUsd8: [1n], targetShareUsd18: 0n }), /target/);
});
