/**
 * Weights -> basket `rawUnits` (pure functions, shared by the deploy scripts, the keeper and the WP5 app).
 *
 * Convention: `rawUnits_i` is the amount of component i (18-decimal raw units) backing 1e18 basket shares.
 * With Chainlink prices at 8 decimals and a target share price in USD at 18 decimals:
 *   rawUnits_i = round(targetShareUsd18 * weightBps_i / 10000 * 1e8 / priceUsd8_i)
 */

/** A 0x-prefixed hex address. */
export type Address = `0x${string}`;

/** Inputs of {@link rawUnitsFor}. All three arrays are index-aligned. */
export interface RawUnitsInput {
  /** Component token addresses (any order, no duplicates). */
  tokens: readonly Address[];
  /** Weights in basis points. Must sum to 10000. */
  weightsBps: readonly number[];
  /** Chainlink USD prices with 8 decimals. Each must be > 0. */
  pricesUsd8: readonly bigint[];
  /** Target USD value of 1e18 shares, with 18 decimals (e.g. $100 = 100n * 10n ** 18n). */
  targetShareUsd18: bigint;
}

/** Result of {@link rawUnitsFor}: tokens sorted ascending by address, rawUnits aligned to them. */
export interface RawUnitsResult {
  tokens: Address[];
  rawUnits: bigint[];
}

const BPS = 10_000n;
const PRICE_SCALE = 10n ** 8n;

/** Integer division rounding half up (both operands positive). */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * Computes `rawUnits` per 1e18 shares from weights and prices, sorted ascending by token address
 * (the order `BasketFactory.createBasket` requires).
 * @throws if lengths differ, weights don't sum to 10000, a weight or price is <= 0, the target is <= 0,
 *         or the token list contains duplicates.
 */
export function rawUnitsFor(input: RawUnitsInput): RawUnitsResult {
  const { tokens, weightsBps, pricesUsd8, targetShareUsd18 } = input;
  const n = tokens.length;
  if (n === 0) throw new Error("rawUnitsFor: no tokens");
  if (weightsBps.length !== n || pricesUsd8.length !== n) throw new Error("rawUnitsFor: length mismatch");
  if (targetShareUsd18 <= 0n) throw new Error("rawUnitsFor: target share value must be > 0");

  let weightSum = 0;
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const token = tokens[i] as Address;
    const key = token.toLowerCase();
    if (seen.has(key)) throw new Error(`rawUnitsFor: duplicate token ${token}`);
    seen.add(key);
    const weight = weightsBps[i] as number;
    if (!Number.isInteger(weight) || weight <= 0) throw new Error(`rawUnitsFor: weight[${i}] must be a positive integer`);
    if ((pricesUsd8[i] as bigint) <= 0n) throw new Error(`rawUnitsFor: price[${i}] must be > 0`);
    weightSum += weight;
  }
  if (weightSum !== 10_000) throw new Error(`rawUnitsFor: weights sum to ${weightSum}, expected 10000`);

  const rows = tokens.map((token, i) => {
    const valueUsd18Times = targetShareUsd18 * BigInt(weightsBps[i] as number) * PRICE_SCALE;
    const units = divRoundHalfUp(valueUsd18Times, BPS * (pricesUsd8[i] as bigint));
    return { token, rawUnits: units > 0n ? units : 1n };
  });
  rows.sort((a, b) => (BigInt(a.token) < BigInt(b.token) ? -1 : 1));
  return { tokens: rows.map((r) => r.token), rawUnits: rows.map((r) => r.rawUnits) };
}

/**
 * USD value (18 decimals) of 1e18 shares backed by `rawUnits`, at the given 8-decimal prices.
 * Inverse of {@link rawUnitsFor}; used for display and tests.
 */
export function shareValueUsd18(rawUnits: readonly bigint[], pricesUsd8: readonly bigint[]): bigint {
  if (rawUnits.length !== pricesUsd8.length) throw new Error("shareValueUsd18: length mismatch");
  let total = 0n;
  for (let i = 0; i < rawUnits.length; i++) total += ((rawUnits[i] as bigint) * (pricesUsd8[i] as bigint)) / PRICE_SCALE;
  return total;
}
