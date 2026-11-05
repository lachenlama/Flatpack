import assert from "node:assert/strict";
import { test } from "node:test";
import { countHolders } from "./holders.ts";

const Z = "0x0000000000000000000000000000000000000000";
const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const H = "0x00000000000000000000000000000000000000cc";

test("countHolders: mint, transfer, burn, excluded harvester", () => {
  const logs = [
    { from: Z, to: A, value: 10n },
    { from: Z, to: H, value: 1n }, // fee shares
    { from: A, to: B, value: 4n },
    { from: B, to: Z, value: 4n }, // B redeems everything
  ];
  assert.equal(countHolders(logs, [H]), 1);
  assert.equal(countHolders(logs), 2);
  assert.equal(countHolders([]), 0);
});
