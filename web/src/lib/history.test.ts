import { test } from "node:test";
import assert from "node:assert/strict";
import { bisectRounds, buildIndexSeries, joinRoundId, sampleTimes, splitRoundId, type ProbeBatch, type Round } from "./history.ts";

// Fixture feed: rounds 1..100, round r updated at t = 1000 + r*100, answer = 100e8 + r*1e8
const fixture = (r: bigint): Round | null =>
  r < 1n || r > 100n ? null : { answer: 100n * 10n ** 8n + r * 10n ** 8n, updatedAt: 1000 + Number(r) * 100 };

test("roundId split/join", () => {
  const id = joinRoundId(3n, 12345n);
  assert.deepEqual(splitRoundId(id), { phase: 3n, round: 12345n });
});

test("bisectRounds finds the last round at or before each target", async () => {
  let calls = 0;
  const probe: ProbeBatch = async (rounds) => {
    calls++;
    return rounds.map(fixture);
  };
  const res = await bisectRounds([1000 + 50 * 100, 1000 + 50 * 100 + 99, 999, 5000 + 99999], 1n, 100n, probe);
  assert.equal(res[0]?.updatedAt, 6000); // exactly round 50
  assert.equal(res[1]?.updatedAt, 6000); // between 50 and 51 -> 50
  assert.equal(res[2], null); // before the first round
  assert.equal(res[3]?.updatedAt, 11000); // after the latest -> round 100
  assert.ok(calls <= 9, `bisection should be logarithmic, took ${calls} probes`);
});

test("bisectRounds treats missing rounds below the phase start as old", async () => {
  // feed only has rounds 40..100
  const probe: ProbeBatch = async (rounds) => rounds.map((r) => (r < 40n ? null : fixture(r)));
  const res = await bisectRounds([1000 + 45 * 100], 1n, 100n, probe);
  assert.equal(res[0]?.updatedAt, 5500);
  const none = await bisectRounds([1000 + 10 * 100], 1n, 100n, probe);
  assert.equal(none[0], null);
});

test("sampleTimes: day-end samples ending at now, capped", () => {
  const DAY = 86400;
  const now = 100 * DAY + 5000;
  const t = sampleTimes(now - 3 * DAY, now);
  assert.equal(t[t.length - 1], now);
  assert.ok(t.length >= 3 && t.length <= 5);
  assert.ok(t.every((x, i) => i === 0 || x > (t[i - 1] as number)));
  assert.ok(sampleTimes(0, 500 * DAY, 60).length <= 62);
});

test("buildIndexSeries indexes basket and benchmark to 100 and drops missing points", () => {
  const units = [2n * 10n ** 18n, 1n * 10n ** 18n]; // 2 of A, 1 of B per share
  const times = [10, 20, 30, 40];
  const a = [10, 11, undefined, 20];
  const b = [100, 100, 100, 120];
  const spy = [400, 404, 408, 440];
  const s = buildIndexSeries(times, units, [a, b], spy);
  assert.equal(s.length, 3); // t=30 dropped
  assert.equal(s[0]?.basket, 100);
  assert.equal(s[0]?.spy, 100);
  // value0 = 2*10+100 = 120 ; value1 = 2*11+100 = 122 ; value3 = 2*20+120 = 160
  assert.ok(Math.abs((s[1]?.basket ?? 0) - (122 / 120) * 100) < 1e-9);
  assert.ok(Math.abs((s[2]?.basket ?? 0) - (160 / 120) * 100) < 1e-9);
  assert.ok(Math.abs((s[2]?.spy ?? 0) - 110) < 1e-9);
});

test("buildIndexSeries returns [] with no complete points", () => {
  assert.deepEqual(buildIndexSeries([1], [10n ** 18n], [[undefined]], [1]), []);
});
