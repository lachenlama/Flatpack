/**
 * Assemble: pure validation and parameter building (shared by the page, the unit tests and the headless e2e script).
 * No React, no Next imports: runs under `node --test` and plain Node.
 */
import { parseAbi, type Address } from "viem";
import { rawUnitsFor } from "../../../../shared/units.ts";

export const MIN_TOKENS = 2;
export const MAX_TOKENS = 8;
export const NAME_MIN = 3;
export const NAME_MAX = 32; // BasketFactory MAX_NAME_BYTES
export const SYMBOL_MIN = 2;
export const SYMBOL_MAX = 10; // the contract allows 11 bytes; the UI keeps to the documented 2..10 letters/digits
/** One share is built to be worth about this many USD at creation. */
export const TARGET_SHARE_USD = 100;
export const TARGET_SHARE_USD18 = BigInt(TARGET_SHARE_USD) * 10n ** 18n;

/** Words a basket name or symbol may not contain (trademark / impersonation). A bare ticker is also refused. */
export const BANNED_TERMS = ["robinhood", "official"] as const;

/** Fields an error can belong to. */
export type Field = "tokens" | "weights" | "name" | "symbol" | "stake" | "general";

/** Name check. @returns an error message, or undefined when fine. */
export function validateName(name: string, tickers: readonly string[] = []): string | undefined {
  const t = name.trim();
  if (t.length < NAME_MIN) return `Use at least ${NAME_MIN} characters.`;
  if (new TextEncoder().encode(t).length > NAME_MAX) return `Use at most ${NAME_MAX} characters.`;
  const low = t.toLowerCase();
  const banned = BANNED_TERMS.find((w) => low.includes(w));
  if (banned) return `"${banned}" is a reserved word. Pick another name.`;
  if (tickers.some((x) => x.toLowerCase() === low)) return "A ticker on its own is not a name. Describe your idea instead.";
  return undefined;
}

/** Symbol check (letters and digits, 2..10, no reserved words, not a bare ticker). */
export function validateSymbol(symbol: string, tickers: readonly string[] = []): string | undefined {
  const t = symbol.trim();
  if (!/^[A-Za-z0-9]+$/.test(t)) return "Use letters and digits only.";
  if (t.length < SYMBOL_MIN) return `Use at least ${SYMBOL_MIN} characters.`;
  if (t.length > SYMBOL_MAX) return `Use at most ${SYMBOL_MAX} characters.`;
  const low = t.toLowerCase();
  if (BANNED_TERMS.some((w) => low.includes(w))) return "That symbol contains a reserved word.";
  if (tickers.some((x) => x.toLowerCase() === low)) return "A ticker on its own is not a symbol. Make one up for your basket.";
  return undefined;
}

/** Parses a percent input ("12.5") into basis points; undefined when not a number with at most 2 decimals, or <= 0. */
export function pctToBps(input: string): number | undefined {
  const t = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const bps = Math.round(Number(t) * 100);
  return bps > 0 && bps <= 10_000 ? bps : undefined;
}

/** Result of {@link checkWeights}. */
export interface WeightCheck {
  ok: boolean;
  sumBps: number;
  /** Weights in bps, index-aligned with the input; undefined entries are invalid. */
  bps: (number | undefined)[];
  message?: string;
}

/** Weight inputs (percent strings) must be 2..8 valid positive numbers that sum to exactly 100%. */
export function checkWeights(percentInputs: readonly string[]): WeightCheck {
  const bps = percentInputs.map(pctToBps);
  const sumBps = bps.reduce<number>((s, b) => s + (b ?? 0), 0);
  if (percentInputs.length < MIN_TOKENS) return { ok: false, sumBps, bps, message: `Pick at least ${MIN_TOKENS} Stock Tokens.` };
  if (percentInputs.length > MAX_TOKENS) return { ok: false, sumBps, bps, message: `Pick at most ${MAX_TOKENS} Stock Tokens.` };
  if (bps.some((b) => b === undefined)) return { ok: false, sumBps, bps, message: "Every weight must be a number above 0 (up to 2 decimals)." };
  if (sumBps !== 10_000) return { ok: false, sumBps, bps, message: `Weights add up to ${sumBps / 100}%. They must total exactly 100%.` };
  return { ok: true, sumBps, bps };
}

/** Splits 100% as evenly as possible across n tokens (remainder to the first ones). */
export function evenWeights(n: number): string[] {
  if (n <= 0) return [];
  const base = Math.floor(10_000 / n);
  const extra = 10_000 - base * n;
  return Array.from({ length: n }, (_, i) => ((base + (i < extra ? 1 : 0)) / 100).toString());
}

/** Maps a factory/vault/ERC-20 custom-error name to the form field it concerns. */
export function fieldForError(errorName: string | undefined): Field {
  switch (errorName) {
    case "TooFewComponents":
    case "TooManyComponents":
    case "ComponentDisabled":
    case "NotAscending":
    case "BadLength":
      return "tokens";
    case "ZeroUnits":
      return "weights";
    case "BadName":
      return "name";
    case "BadSymbol":
      return "symbol";
    case "StakeTooLow":
    case "ERC20InsufficientBalance":
    case "ERC20InsufficientAllowance":
      return "stake";
    default:
      return "general";
  }
}

/** Walks a viem error's cause chain for a decoded custom-error name. */
export function errorNameOf(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 10 && typeof cur === "object" && cur !== null; i++) {
    const rec = cur as { data?: { errorName?: string }; errorName?: string; cause?: unknown };
    if (rec.data?.errorName) return rec.data.errorName;
    if (rec.errorName) return rec.errorName;
    cur = rec.cause;
  }
  return undefined;
}

const aggregatorLite = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

/** Reads Chainlink answers (8 decimals) for the feeds with any viem-like client; throws on a non-positive answer. */
export async function readFeedPrices(client: unknown, feeds: readonly Address[]): Promise<bigint[]> {
  const c = client as { readContract(a: unknown): Promise<unknown> };
  const out: bigint[] = [];
  for (const feed of feeds) {
    const r = (await c.readContract({ address: feed, abi: aggregatorLite, functionName: "latestRoundData" })) as readonly [bigint, bigint, bigint, bigint, bigint];
    if (r[1] <= 0n) throw new Error(`The price feed for a selected token returned no price (${feed}).`);
    out.push(r[1]);
  }
  return out;
}

/** What the form collects. */
export interface BasketInput {
  name: string;
  symbol: string;
  mode: "Reinvest" | "PayInWif";
  /** Selected tokens with their Chainlink feed and weight in bps (sum 10000). */
  picks: readonly { token: Address; feed: Address; weightBps: number }[];
}

/** createBasket params exactly as the factory wants them (tokens ascending by address). */
export interface CreateParams {
  name: string;
  symbol: string;
  tokens: Address[];
  rawUnits: bigint[];
  mode: 0 | 1;
}

/** Converts weights to units per share at the given prices, sorted ascending by address. */
export function unitsForInput(input: BasketInput, pricesUsd8: readonly bigint[]): { tokens: Address[]; rawUnits: bigint[] } {
  return rawUnitsFor({
    tokens: input.picks.map((p) => p.token),
    weightsBps: input.picks.map((p) => p.weightBps),
    pricesUsd8,
    targetShareUsd18: TARGET_SHARE_USD18,
  });
}

/** Builds the createBasket params from FRESH on-chain prices (the UI calls this at publish time; so does the e2e script). */
export async function buildCreateParams(client: unknown, input: BasketInput): Promise<CreateParams> {
  const prices = await readFeedPrices(client, input.picks.map((p) => p.feed));
  const { tokens, rawUnits } = unitsForInput(input, prices);
  return { name: input.name.trim(), symbol: input.symbol.trim(), tokens, rawUnits, mode: input.mode === "PayInWif" ? 1 : 0 };
}
