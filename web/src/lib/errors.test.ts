import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeErrorResult } from "viem";
import { flatpackRouterAbi } from "../../../shared/abi/index.ts";
import { ERROR_MESSAGES, abiErrorNames, describeErrorData, messageForError } from "./errors.ts";

test("every custom error in shared/abi has a plain-English mapping", () => {
  const names = abiErrorNames();
  assert.ok(names.length > 50, `expected many errors, got ${names.length}`);
  const missing = names.filter((n) => ERROR_MESSAGES[n] === undefined);
  assert.deepEqual(missing, []);
});

test("no stale mappings for errors that are not in the ABI", () => {
  const names = new Set(abiErrorNames());
  assert.deepEqual(Object.keys(ERROR_MESSAGES).filter((k) => !names.has(k)), []);
});

test("describeErrorData decodes ExcessiveInput", () => {
  const data = encodeErrorResult({ abi: flatpackRouterAbi, errorName: "ExcessiveInput", args: [2n, 1n] });
  assert.equal(describeErrorData(data), "Price moved more than your slippage. Try again.");
});

test("describeErrorData decodes errors that are not in the called contract's ABI (vault error via router flow)", () => {
  assert.equal(describeErrorData("0x00000000"), undefined);
  assert.match(messageForError("TooEarly", [1n]), /epoch/);
  assert.match(messageForError("NotARealError"), /NotARealError/);
});
