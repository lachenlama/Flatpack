/**
 * Fork rehearsal (D-2): deploys the Ignition module on an EDR fork of Robinhood Chain mainnet (latest block),
 * runs the read-only smoke check and creates the Reinvest demo basket.   npx hardhat test nodejs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import FlatpackModule from "../../ignition/modules/Flatpack.ts";
import {
  addressesFromIgnition,
  expectedFromParameters,
  formatReport,
  smoke,
  type Hex,
  type ParameterValues,
  type SmokeClient,
} from "../../scripts/lib/smoke.ts";
import {
  createDemoBasket,
  type BasketSpec,
  type DemoContext,
  type DemoPublicClient,
  type DemoWalletClient,
} from "../../scripts/lib/demo.ts";
import type { Address } from "../../../shared/units.ts";

const here = dirname(fileURLToPath(import.meta.url));
const contractsDir = join(here, "..", "..");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

const transferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// one connection = one fork: both tests share the same chain state
const connection = await network.getOrCreate("robinhoodFork");

describe("Flatpack deployment on a mainnet fork", { timeout: 900_000 }, () => {
  const state: { addresses?: Record<string, string> } = {};
  let gasUsed = 0n;
  let txCount = 0;

  it("deploys the Ignition module, then smoke() reports 0 failures", async () => {

    const { ignition, viem } = connection;
    const publicClient = await viem.getPublicClient();
    const startBlock = await publicClient.getBlockNumber();

    const params = readJson<{ Flatpack: ParameterValues }>(join(contractsDir, "ignition", "parameters", "fork.json"));
    const deployed = await ignition.deploy(FlatpackModule, {
      parameters: join(contractsDir, "ignition", "parameters", "fork.json"),
      displayUi: false,
    });

    // gas accounting over every block mined by the deployment
    const endBlock = await publicClient.getBlockNumber();
    for (let n = startBlock + 1n; n <= endBlock; n++) {
      const block = await publicClient.getBlock({ blockNumber: n, includeTransactions: true });
      for (const tx of block.transactions) {
        const receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
        gasUsed += receipt.gasUsed;
        txCount++;
      }
    }
    console.log(`DEPLOY GAS: ${gasUsed} over ${txCount} transactions`);

    const addresses = {
      registry: deployed.registry.address,
      harvester: deployed.harvester.address,
      vault: deployed.vault.address,
      basketImpl: deployed.basketImpl.address,
      factory: deployed.factory.address,
      router: deployed.router.address,
    };
    state.addresses = addresses;
    // the module -> deployed_addresses mapping used by the CLI must agree with the in-memory result
    assert.deepEqual(
      addressesFromIgnition({
        "Flatpack#ComponentRegistry": addresses.registry,
        "Flatpack#FeeHarvester": addresses.harvester,
        "Flatpack#BackingVault": addresses.vault,
        "Flatpack#BasketImplementation": addresses.basketImpl,
        "Flatpack#BasketFactory": addresses.factory,
        "Flatpack#FlatpackRouter": addresses.router,
      }),
      addresses,
    );

    const report = await smoke(
      publicClient as unknown as SmokeClient,
      addresses,
      expectedFromParameters(params.Flatpack),
    );
    console.log(formatReport(report));
    assert.equal(report.failures, 0, formatReport(report));

    // wiring negative control: a wrong keeper expectation must fail (the check really reads the chain)
    const wrong = { ...expectedFromParameters(params.Flatpack), keeper: addresses.router as Hex };
    const bad = await smoke(publicClient as unknown as SmokeClient, addresses, wrong);
    assert.ok(bad.failures >= 1);
  });

  it("creates the Reinvest demo basket (curator staked with impersonated WIF)", async () => {
    const addresses = state.addresses;
    assert.ok(addresses, "deploy test must run first");

    const { viem, networkHelpers } = connection;
    const publicClient = await viem.getPublicClient();

    const config = readJson<{
      tokens: { USDG: { address: string }; WIF: { address: string } };
      uniswap: { v4PoolManager: string };
      launchUniverse: Record<string, { token: string; feed: string } | string>;
    }>(join(contractsDir, "..", "config", "mainnet-4663.json"));
    const spec = readJson<{ baskets: BasketSpec[] }>(join(contractsDir, "scripts", "demo-baskets.json")).baskets.find(
      (b) => b.mode === "Reinvest",
    );
    assert.ok(spec);

    const universe: DemoContext["universe"] = {};
    for (const [symbol, v] of Object.entries(config.launchUniverse)) {
      if (typeof v !== "string") universe[symbol] = { token: v.token as Address, feed: v.feed as Address };
    }
    const ctx: DemoContext = {
      factory: addresses.factory as Address,
      router: addresses.router as Address,
      wif: config.tokens.WIF.address as Address,
      usdg: config.tokens.USDG.address as Address,
      universe,
    };

    // the v4 PoolManager holds WIF: impersonate it and hand 2000 WIF to the curator
    const [, , curator] = await viem.getWalletClients();
    assert.ok(curator);
    const poolManager = config.uniswap.v4PoolManager as Address;
    await networkHelpers.impersonateAccount(poolManager);
    await networkHelpers.setBalance(poolManager, 10n ** 18n);
    const holder = await viem.getWalletClient(poolManager);
    const hash = await holder.writeContract({
      address: ctx.wif,
      abi: transferAbi,
      functionName: "transfer",
      args: [curator.account.address, 2000n * 10n ** 18n],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    await networkHelpers.stopImpersonatingAccount(poolManager);

    const created = await createDemoBasket(
      publicClient as unknown as DemoPublicClient,
      curator as unknown as DemoWalletClient,
      ctx,
      spec,
    );
    console.log(`demo basket "${created.name}" at ${created.basket}`);

    const factory = await viem.getContractAt("BasketFactory", addresses.factory as Address);
    assert.equal(await factory.read.basketCount(), 1n);
    assert.equal(await factory.read.isBasket([created.basket]), true);
    const sorted = [...created.tokens].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    assert.deepEqual(created.tokens, sorted);
    assert.ok(created.rawUnits.every((u) => u > 0n));
  });


});
