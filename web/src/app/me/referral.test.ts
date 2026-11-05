import assert from "node:assert/strict";
import { test } from "node:test";
import { closedCycles, selectClaimableCycles } from "./referral.ts";

test("only closed cycles are scanned", () => {
  assert.deepEqual(closedCycles(0), []);
  assert.deepEqual(closedCycles(1), [0]);
  assert.deepEqual(closedCycles(4), [0, 1, 2, 3]);
  assert.deepEqual(closedCycles(300, 3), [297, 298, 299]);
});

test("claims only unclaimed cycles with a positive amount", () => {
  const r = selectClaimableCycles([
    { cycle: 0, shares: 5n, claimableWif: 100n, claimed: false },
    { cycle: 1, shares: 5n, claimableWif: 50n, claimed: true },
    { cycle: 2, shares: 0n, claimableWif: 0n, claimed: false },
    { cycle: 3, shares: 1n, claimableWif: 7n, claimed: false },
  ]);
  assert.deepEqual(r.cycles, [0, 3]);
  assert.equal(r.total, 107n);
  assert.deepEqual(selectClaimableCycles([]), { cycles: [], total: 0n });
});
