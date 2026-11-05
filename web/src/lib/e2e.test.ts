import { test } from "node:test";
import assert from "node:assert/strict";
import { e2eEnabled } from "./e2e.ts";

test("e2e mock wallet is off unless NEXT_PUBLIC_E2E=1", () => {
  assert.equal(e2eEnabled("https://rpc.mainnet.chain.robinhood.com", undefined), false);
  assert.equal(e2eEnabled("http://127.0.0.1:8545", "0"), false);
});

test("e2e mock wallet needs a local RPC and a localhost origin", () => {
  assert.equal(e2eEnabled("http://127.0.0.1:8545", "1"), true);
  assert.equal(e2eEnabled("http://localhost:8547/", "1", "localhost"), true);
  assert.throws(() => e2eEnabled("https://rpc.mainnet.chain.robinhood.com", "1"), /local RPC/);
  assert.throws(() => e2eEnabled("http://127.0.0.1.evil.com", "1"), /local RPC/);
  assert.throws(() => e2eEnabled("http://127.0.0.1:8545", "1", "flatpack.xyz"), /localhost/);
});
