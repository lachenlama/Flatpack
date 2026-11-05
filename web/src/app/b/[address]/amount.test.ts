import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAmount } from "./amount.ts";

test("parseAmount parses decimals and rejects junk", () => {
  assert.equal(parseAmount("1", 18), 10n ** 18n);
  assert.equal(parseAmount("0.5", 6), 500_000n);
  assert.equal(parseAmount(" 2.25 ", 18), 2_250_000_000_000_000_000n);
  assert.equal(parseAmount("", 18), undefined);
  assert.equal(parseAmount(".", 18), undefined);
  assert.equal(parseAmount("1e3", 18), undefined);
  assert.equal(parseAmount("-1", 18), undefined);
  assert.equal(parseAmount("abc", 18), undefined);
});
