import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMarketData, usSession } from "./prices.ts";

test("usSession: regular, extended, closed, weekend (ET)", () => {
  assert.equal(usSession(Date.parse("2026-11-04T15:00:00Z")), "open"); // Wed 10:00 ET
  assert.equal(usSession(Date.parse("2026-11-04T13:00:00Z")), "extended"); // Wed 08:00 ET
  assert.equal(usSession(Date.parse("2026-11-04T22:00:00Z")), "extended"); // Wed 17:00 ET
  assert.equal(usSession(Date.parse("2026-11-05T03:00:00Z")), "closed"); // Wed 22:00 ET
  assert.equal(usSession(Date.parse("2026-11-07T15:00:00Z")), "closed"); // Sat
});

test("mergeMarketData merges prices and assets by ticker", () => {
  const d = mergeMarketData(
    {
      quotes: [
        { tokenSymbol: "NVDA", deployments: [{ contractAddress: "0xAbC", chainId: 4663 }], tokenBid: "100", tokenAsk: "102", isTradingHalt: true, generatedAt: "2026-11-05T19:10:18Z" },
      ],
    },
    { assets: [{ tokenSymbol: "NVDA", currentMultiplier: "1.01", pendingMultiplier: "1.02", status: "ASSET_STATUS_ACTIVE" }] },
    Date.parse("2026-11-05T19:10:20Z"),
  );
  assert.equal(d.ok, true);
  const n = d.tokens.NVDA;
  assert.equal(n?.price, 101);
  assert.equal(n?.isTradingHalt, true);
  assert.equal(n?.pendingMultiplier, true);
  assert.deepEqual(n?.addresses, ["0xabc"]);
  assert.equal(d.asOf, Date.parse("2026-11-05T19:10:18Z"));
});

test("mergeMarketData with no upstream data is not ok", () => {
  assert.equal(mergeMarketData(null, null, 0).ok, false);
});
