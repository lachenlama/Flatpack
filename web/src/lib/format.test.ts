import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EPOCH_ANCHOR,
  epochEnd,
  formatAmount,
  formatDuration,
  formatPercent,
  formatPts,
  formatUsdg,
  formatWif,
  indexTo100,
  shortAddress,
  timeToEpochEnd,
} from "./format.ts";

test("formatAmount: exact bigint formatting for 6 and 18 decimals", () => {
  assert.equal(formatUsdg(412_370_000n), "412.37");
  assert.equal(formatUsdg(1_234_567_890n), "1,234.57");
  assert.equal(formatUsdg(0n), "0.00");
  assert.equal(formatAmount(1_999_999n, 6, { maxFraction: 2 }), "2");
  assert.equal(formatWif(12_345n * 10n ** 18n + 5n * 10n ** 17n), "12,345.5");
  assert.equal(formatAmount(-1_500_000n, 6), "-1.5");
  assert.equal(formatAmount(1n, 18, { maxFraction: 4 }), "0");
  assert.equal(formatAmount(10n ** 18n, 18, { minFraction: 2 }), "1.00");
});

test("formatAmount: compact", () => {
  assert.equal(formatAmount(1_200_000n * 10n ** 18n, 18, { compact: true }), "1.20M");
  assert.equal(formatAmount(12_000n * 10n ** 18n, 18, { compact: true }), "12.00K");
  assert.equal(formatAmount(999n * 10n ** 18n, 18, { compact: true }), "999");
});

test("percent, pts, duration", () => {
  assert.equal(formatPercent(0.0123), "1.23%");
  assert.equal(formatPercent(1.5, { ratio: false, sign: true }), "+1.50%");
  assert.equal(formatPts(1.2), "+1.2 pts");
  assert.equal(formatPts(-0.4), "−0.4 pts");
  assert.equal(formatPts(0), "0.0 pts");
  assert.equal(formatDuration(3 * 86400 + 4 * 3600 + 5), "3d 4h");
  assert.equal(formatDuration(5000), "1h 23m");
  assert.equal(formatDuration(20), "<1m");
});

test("epoch maths use anchor 1794016800 and 7 days", () => {
  assert.equal(EPOCH_ANCHOR, 1794016800);
  assert.equal(epochEnd(0), EPOCH_ANCHOR);
  assert.equal(epochEnd(EPOCH_ANCHOR), EPOCH_ANCHOR + 604800);
  assert.equal(epochEnd(EPOCH_ANCHOR + 604799), EPOCH_ANCHOR + 604800);
  assert.equal(epochEnd(EPOCH_ANCHOR + 604800), EPOCH_ANCHOR + 2 * 604800);
  assert.equal(timeToEpochEnd(EPOCH_ANCHOR + 604800 - 60), 60);
});

test("indexTo100 and shortAddress", () => {
  assert.deepEqual(indexTo100([50, 100, 25]), [100, 200, 50]);
  assert.deepEqual(indexTo100([]), []);
  assert.deepEqual(indexTo100([0, 1]), []);
  assert.equal(shortAddress("0x1234567890abcdef1234567890abcdef12345678"), "0x1234…5678");
});
