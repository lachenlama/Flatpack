import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, validateDeployment, ConfigError, DEFAULT_MIN_HARVEST_WIF } from "../src/config.ts";

const KEY = "0x" + "11".repeat(32);

test("defaults", () => {
  const c = parseConfig({ KEEPER_PRIVATE_KEY: KEY }, []);
  assert.equal(c.rpcUrl, "https://rpc.mainnet.chain.robinhood.com");
  assert.equal(c.slippageBps, 100n);
  assert.equal(c.minEth, 200_000_000_000_000n);
  assert.equal(c.deadlineSecs, 300n);
  assert.equal(c.minHarvestWif, DEFAULT_MIN_HARVEST_WIF);
  assert.equal(c.minHarvestWif, 350000000000000000000n);
  assert.equal(c.dryRun, false);
  assert.match(c.deploymentPath, /shared[\\/]deployments[\\/]4663\.json$/);
});

test("key required unless dry-run; empty strings count as unset", () => {
  assert.throws(() => parseConfig({}, []), ConfigError);
  assert.throws(() => parseConfig({ KEEPER_PRIVATE_KEY: "" }, ["--once"]), ConfigError);
  const c = parseConfig({}, ["--dry-run"]);
  assert.equal(c.dryRun, true);
  assert.equal(c.privateKey, undefined);
});

test("overrides parse", () => {
  const c = parseConfig(
    {
      KEEPER_PRIVATE_KEY: KEY.slice(2),
      RPC_URL: "https://example.org/rpc",
      SLIPPAGE_BPS: "250",
      MIN_ETH: "0.01",
      MIN_HARVEST_WIF: "5",
      DEADLINE_SECS: "60",
      DEPLOYMENT: "/tmp/d.json",
    },
    [],
  );
  assert.equal(c.privateKey, KEY);
  assert.equal(c.rpcUrl, "https://example.org/rpc");
  assert.equal(c.slippageBps, 250n);
  assert.equal(c.minEth, 10n ** 16n);
  assert.equal(c.minHarvestWif, 5n);
  assert.equal(c.deadlineSecs, 60n);
});

test("RH_RPC_URL is used when RPC_URL is empty", () => {
  const c = parseConfig({ KEEPER_PRIVATE_KEY: KEY, RPC_URL: "", RH_RPC_URL: "https://x.test" }, []);
  assert.equal(c.rpcUrl, "https://x.test");
});

test("validation errors", () => {
  assert.equal(parseConfig({ KEEPER_PRIVATE_KEY: KEY, SLIPPAGE_BPS: "1000" }, []).slippageBps, 1000n);
  for (const env of [
    { SLIPPAGE_BPS: "1001" },
    { SLIPPAGE_BPS: "-1" },
    { SLIPPAGE_BPS: "1.5" },
    { MIN_ETH: "abc" },
    { MIN_HARVEST_WIF: "1e18" },
    { DEADLINE_SECS: "0" },
    { RPC_URL: "ftp://x" },
    { KEEPER_ADDRESS: "nope" },
  ]) {
    assert.throws(() => parseConfig({ KEEPER_PRIVATE_KEY: KEY, ...env }, []), ConfigError, JSON.stringify(env));
  }
  assert.throws(() => parseConfig({ KEEPER_PRIVATE_KEY: KEY }, ["--bogus"]), ConfigError);
});

test("a bad private key error never contains the key", () => {
  const bad = "0xdeadbeef-secret-material";
  try {
    parseConfig({ KEEPER_PRIVATE_KEY: bad }, []);
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.doesNotMatch(e.message, /deadbeef|secret/);
  }
});

const A = "0x" + "ab".repeat(20);
const good = {
  chainId: 4663,
  deployedAt: "2026-11-06T00:00:00Z",
  blockNumber: 1,
  addresses: { ComponentRegistry: A, FeeHarvester: A, BackingVault: A, Basket: A, BasketFactory: A, FlatpackRouter: A },
};

test("deployment validation", () => {
  assert.doesNotThrow(() => validateDeployment(good));
  assert.throws(() => validateDeployment({ ...good, chainId: 1 }), ConfigError);
  assert.throws(() => validateDeployment({ ...good, blockNumber: "x" }), ConfigError);
  assert.throws(() => validateDeployment({ ...good, addresses: { ...good.addresses, FeeHarvester: "0x1" } }), ConfigError);
  const { BackingVault: _drop, ...rest } = good.addresses;
  assert.throws(() => validateDeployment({ ...good, addresses: rest }), ConfigError);
  assert.throws(() => validateDeployment(null), ConfigError);
});
