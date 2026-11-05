import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWeights, errorNameOf, evenWeights, fieldForError, pctToBps, unitsForInput, validateName, validateSymbol } from "./plan.ts";

const T = ["NVDA", "MSFT", "SPY"];

test("weights must total exactly 100%", () => {
  assert.equal(checkWeights(["50", "50"]).ok, true);
  assert.equal(checkWeights(["33.34", "33.33", "33.33"]).ok, true);
  const bad = checkWeights(["50", "40"]);
  assert.equal(bad.ok, false);
  assert.match(bad.message ?? "", /90%/);
  assert.equal(checkWeights(["100"]).ok, false); // too few
  assert.equal(checkWeights(["50", "abc"]).ok, false);
  assert.equal(checkWeights(["50", "0"]).ok, false);
  assert.equal(checkWeights(Array(9).fill("11.11")).ok, false); // too many
});

test("pctToBps accepts 2 decimals only", () => {
  assert.equal(pctToBps("12.5"), 1250);
  assert.equal(pctToBps("12.555"), undefined);
  assert.equal(pctToBps("-1"), undefined);
  assert.equal(pctToBps("101"), undefined);
});

test("evenWeights sums to 100", () => {
  for (const n of [2, 3, 5, 7, 8]) assert.equal(checkWeights(evenWeights(n)).ok, true, `n=${n}`);
});

test("banned terms and name/symbol length", () => {
  assert.ok(validateName("Robinhood Picks", T));
  assert.ok(validateName("The OFFICIAL basket", T));
  assert.ok(validateName("nvda", T)); // bare ticker
  assert.ok(validateName("ab", T)); // too short
  assert.ok(validateName("x".repeat(33), T)); // too long
  assert.equal(validateName("AI Picks & Shovels", T), undefined);
  assert.ok(validateSymbol("A", T));
  assert.ok(validateSymbol("ABCDEFGHIJK", T)); // 11
  assert.ok(validateSymbol("AI PICKS", T)); // space
  assert.ok(validateSymbol("MSFT", T));
  assert.ok(validateSymbol("OFFICIAL1", T));
  assert.equal(validateSymbol("AIPS", T), undefined);
});

test("factory errors map to fields", () => {
  assert.equal(fieldForError("BadName"), "name");
  assert.equal(fieldForError("BadSymbol"), "symbol");
  assert.equal(fieldForError("StakeTooLow"), "stake");
  assert.equal(fieldForError("ComponentDisabled"), "tokens");
  assert.equal(fieldForError("ZeroUnits"), "weights");
  assert.equal(fieldForError("CreatePaused"), "general");
  assert.equal(errorNameOf({ cause: { cause: { data: { errorName: "BadName" } } } }), "BadName");
});

test("units are sorted by address and positive", () => {
  const picks = [
    { token: "0x00000000000000000000000000000000000000bb", feed: "0x0000000000000000000000000000000000000001", weightBps: 6000 },
    { token: "0x00000000000000000000000000000000000000aa", feed: "0x0000000000000000000000000000000000000002", weightBps: 4000 },
  ] as const;
  const r = unitsForInput({ name: "x", symbol: "y", mode: "Reinvest", picks }, [100_00000000n, 200_00000000n]);
  assert.deepEqual(r.tokens, ["0x00000000000000000000000000000000000000aa", "0x00000000000000000000000000000000000000bb"]);
  // $100 share: 40% in aa at $200 (feed 2) = 0.2 units; 60% in bb at $100 (feed 1) = 0.6 units
  assert.deepEqual(r.rawUnits, [2n * 10n ** 17n, 6n * 10n ** 17n]);
});
