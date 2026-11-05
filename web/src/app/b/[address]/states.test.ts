import assert from "node:assert/strict";
import { test } from "node:test";
import { buyBlockReason, corporateNotice, iouNotice, isMarketClosed, MIN_MINT_SHARES, type BuyState } from "./states.ts";

const ok: BuyState = {
  shares: 10n ** 18n,
  halted: [],
  paused: [],
  navValid: true,
  quote: { state: "ok" },
  maxIn: 100_000_000n,
  usdgBalance: 500_000_000n,
};

test("market closed: session flag or a feed older than 2h", () => {
  assert.equal(isMarketClosed("open", 1000, 1000 + 3600), false);
  assert.equal(isMarketClosed("open", 1000, 1000 + 7201), true);
  assert.equal(isMarketClosed("closed", undefined, 0), true);
  assert.equal(isMarketClosed("extended", undefined, 0), false);
});

test("buy is enabled when everything is fine", () => {
  assert.equal(buyBlockReason(ok), undefined);
});

test("trading halt and issuer pause disable buy, naming the ticker", () => {
  assert.match(buyBlockReason({ ...ok, halted: ["NVDA"] }) ?? "", /NVDA halted/);
  assert.match(buyBlockReason({ ...ok, paused: ["MSFT"] }) ?? "", /MSFT paused by the issuer/);
  assert.match(buyBlockReason({ ...ok, halted: ["NVDA"] }) ?? "", /Redeeming still works/);
});

test("input, quote and balance states", () => {
  assert.match(buyBlockReason({ ...ok, shares: undefined }) ?? "", /Enter a number/);
  assert.match(buyBlockReason({ ...ok, shares: MIN_MINT_SHARES - 1n }) ?? "", /minimum/);
  assert.match(buyBlockReason({ ...ok, navValid: false }) ?? "", /stale/);
  assert.match(buyBlockReason({ ...ok, quote: { state: "loading" } }) ?? "", /quote/);
  assert.equal(buyBlockReason({ ...ok, quote: { state: "error", message: "Price moved." } }), "Price moved.");
  assert.match(buyBlockReason({ ...ok, usdgBalance: 0n }) ?? "", /You need up to 100.00 USDG/);
});

test("IOU and corporate-action copy", () => {
  assert.equal(iouNotice(["MSFT"]), "MSFT will arrive as an IOU, claim it later.");
  assert.equal(iouNotice([]), "");
  assert.equal(corporateNotice(["AAPL", "NVDA"]), "AAPL split/dividend processing; NVDA split/dividend processing");
});
