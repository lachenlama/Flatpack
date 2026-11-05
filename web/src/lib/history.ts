import { parseAbi, type Address, type PublicClient } from "viem";

/**
 * Daily index series (basket vs SPY, both indexed to 100) from Chainlink round history.
 *
 * Chainlink aggregators expose rounds by id, not by time, so we bisect the round id for each target timestamp
 * (all targets x all feeds in lock-step, one multicall per bisection step) instead of walking back round by round.
 */

/** One round as returned by AggregatorV3.getRoundData (answer has 8 decimals for the Robinhood Chain USD feeds). */
export interface Round {
  answer: bigint;
  updatedAt: number;
}

const FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const AGG_MASK = (1n << 64n) - 1n;
/** Split a Chainlink roundId into (phaseId, aggregatorRound). */
export const splitRoundId = (id: bigint): { phase: bigint; round: bigint } => ({ phase: id >> 64n, round: id & AGG_MASK });
/** Inverse of {@link splitRoundId}. */
export const joinRoundId = (phase: bigint, round: bigint): bigint => (phase << 64n) | round;

/** Probes a batch of round ids. `null` = the round does not exist (before the feed's first round in this phase). */
export type ProbeBatch = (rounds: bigint[]) => Promise<(Round | null)[]>;

/**
 * For each target time, finds the LAST round (within [lo, hi]) with `updatedAt <= target`, bisecting all targets together.
 * Rounds that do not exist are treated as "older than the target". Returns null where even the lowest round is newer than the
 * target or does not exist (no price yet).
 * @param targets unix seconds
 * @param lo lowest aggregator round to consider
 * @param hi highest aggregator round (the latest)
 */
export async function bisectRounds(targets: readonly number[], lo: bigint, hi: bigint, probe: ProbeBatch): Promise<(Round | null)[]> {
  const lows = targets.map(() => lo);
  const highs = targets.map(() => hi);
  while (true) {
    const active = targets.map((_, i) => i).filter((i) => (lows[i] as bigint) < (highs[i] as bigint));
    if (active.length === 0) break;
    // upper-mid so that lo = mid always progresses
    const mids = active.map((i) => ((lows[i] as bigint) + (highs[i] as bigint) + 1n) / 2n);
    const res = await probe(mids);
    active.forEach((i, k) => {
      const r = res[k];
      const mid = mids[k] as bigint;
      if (r === null || r === undefined || r.updatedAt <= (targets[i] as number)) lows[i] = mid;
      else highs[i] = mid - 1n;
    });
  }
  const final = await probe(lows);
  return final.map((r, i) => (r && r.updatedAt <= (targets[i] as number) ? r : null));
}

/** Day-end sample timestamps (21:00 UTC, after the US close) covering [sinceSec, nowSec], at most `maxPoints`, ending with nowSec. */
export function sampleTimes(sinceSec: number, nowSec: number, maxPoints = 60): number[] {
  const DAY = 86400;
  const out: number[] = [];
  const firstDay = Math.floor(sinceSec / DAY) * DAY + 21 * 3600;
  for (let t = firstDay; t < nowSec; t += DAY) if (t >= sinceSec) out.push(t);
  out.push(nowSec);
  if (out.length <= maxPoints) return out;
  const step = Math.ceil(out.length / maxPoints);
  const thinned = out.filter((_, i) => i % step === 0);
  if (thinned[thinned.length - 1] !== nowSec) thinned.push(nowSec);
  return thinned;
}

/** A price at 8 decimals as a JS number. */
export const price8 = (answer: bigint): number => Number(answer) / 1e8;

export interface IndexPoint {
  /** unix seconds */
  t: number;
  /** basket indexed to 100 at the first point */
  basket: number;
  /** benchmark indexed to 100 at the first point */
  spy: number;
}

/**
 * Builds the indexed series. A basket's value at time t is sum(rawUnits_i / 1e18 * price_i(t)).
 * Points where any price is missing are dropped; both lines are indexed to 100 at the first remaining point.
 * @param times sample times
 * @param rawUnits per component, raw units per 1e18 shares (as in Basket.components())
 * @param componentPrices [component][time] USD prices (NaN/undefined = missing)
 * @param benchPrices [time] benchmark USD prices
 */
export function buildIndexSeries(
  times: readonly number[],
  rawUnits: readonly bigint[],
  componentPrices: readonly (readonly (number | undefined)[])[],
  benchPrices: readonly (number | undefined)[],
): IndexPoint[] {
  const pts: { t: number; value: number; bench: number }[] = [];
  times.forEach((t, k) => {
    let value = 0;
    for (let i = 0; i < rawUnits.length; i++) {
      const p = componentPrices[i]?.[k];
      if (p === undefined || !Number.isFinite(p) || p <= 0) return;
      value += (Number(rawUnits[i]) / 1e18) * p;
    }
    const b = benchPrices[k];
    if (b === undefined || !Number.isFinite(b) || b <= 0) return;
    pts.push({ t, value, bench: b });
  });
  const first = pts[0];
  if (!first) return [];
  return pts.map((p) => ({ t: p.t, basket: (p.value / first.value) * 100, spy: (p.bench / first.bench) * 100 }));
}

/** Loads a feed's latest round and a probe function bound to its current phase. */
async function feedProbe(client: PublicClient, feed: Address): Promise<{ latest: Round & { id: bigint }; probe: ProbeBatch; phase: bigint; hi: bigint }> {
  const [roundId, answer, , updatedAt] = await client.readContract({ address: feed, abi: FEED_ABI, functionName: "latestRoundData" });
  const { phase, round } = splitRoundId(roundId);
  const probe: ProbeBatch = async (rounds) => {
    const res = await client.multicall({
      allowFailure: true,
      contracts: rounds.map((r) => ({ address: feed, abi: FEED_ABI, functionName: "getRoundData", args: [joinRoundId(phase, r)] }) as const),
    });
    return res.map((x) => (x.status === "success" ? { answer: x.result[1], updatedAt: Number(x.result[3]) } : null));
  };
  return { latest: { id: roundId, answer, updatedAt: Number(updatedAt) }, probe, phase, hi: round };
}

/** Prices of one feed at each sample time (undefined where the feed had no round yet). */
export async function feedPricesAt(client: PublicClient, feed: Address, times: readonly number[]): Promise<(number | undefined)[]> {
  const { latest, probe, hi } = await feedProbe(client, feed);
  const lo = hi > (1n << 20n) ? hi - (1n << 20n) : 1n;
  const rounds = await bisectRounds(times, lo, hi, probe);
  return rounds.map((r, i) => (r ? price8(r.answer) : times[i] !== undefined && (times[i] as number) >= latest.updatedAt ? price8(latest.answer) : undefined));
}

/** Inputs for {@link loadIndexSeries}. */
export interface HistoryInput {
  /** Component price feeds, aligned with `rawUnits`. */
  feeds: readonly Address[];
  rawUnits: readonly bigint[];
  benchFeed: Address;
  /** Start of the series, unix seconds (basket creation, or now - 30 days for a hypothetical recipe). */
  sinceSec: number;
  nowSec: number;
}

/** Fetches Chainlink history and returns the indexed basket-vs-SPY series. */
export async function loadIndexSeries(client: PublicClient, input: HistoryInput): Promise<IndexPoint[]> {
  const times = sampleTimes(input.sinceSec, input.nowSec);
  const [comp, bench] = await Promise.all([
    Promise.all(input.feeds.map((f) => feedPricesAt(client, f, times))),
    feedPricesAt(client, input.benchFeed, times),
  ]);
  return buildIndexSeries(times, input.rawUnits, comp, bench);
}
