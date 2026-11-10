/**
 * Creates the demo baskets from scripts/demo-baskets.json on the connected network.
 *   npx hardhat run scripts/demo-baskets.ts --network robinhood -- [--buy <usdg>] [--only <symbol>]
 * Hardhat 3 rejects extra flags, so use env vars instead: DEMO_ONLY=<symbol> DEMO_BUY=<usdg> npm run demo:baskets. Env: FLATPACK_DEPLOYMENT (default ../shared/deployments/4663.json).
 * The curator is the network's first account and must hold at least `minCuratorStake` WIF per basket
 * (and USDG for --buy).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { parseUnits } from "viem";
import {
  createDemoBasket,
  type BasketSpec,
  type DemoContext,
  type DemoPublicClient,
  type DemoWalletClient,
} from "./lib/demo.ts";
import type { Address } from "../../shared/units.ts";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "..", "..", "config", "mainnet-4663.json"), "utf8")) as {
  tokens: { USDG: { address: string }; WIF: { address: string } };
  launchUniverse: Record<string, { token: string; feed: string } | string>;
};
const deploymentPath = process.env.FLATPACK_DEPLOYMENT ?? join(here, "..", "..", "shared", "deployments", "4663.json");
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as { addresses: Record<string, string> };
const specs = (JSON.parse(readFileSync(join(here, "demo-baskets.json"), "utf8")) as { baskets: BasketSpec[] }).baskets;

const universe: DemoContext["universe"] = {};
for (const [symbol, v] of Object.entries(config.launchUniverse)) {
  if (typeof v !== "string") universe[symbol] = { token: v.token as Address, feed: v.feed as Address };
}
const ctx: DemoContext = {
  factory: deployment.addresses.BasketFactory as Address,
  router: deployment.addresses.FlatpackRouter as Address,
  wif: config.tokens.WIF.address as Address,
  usdg: config.tokens.USDG.address as Address,
  universe,
};

const connection = await network.getOrCreate();
const publicClient = (await connection.viem.getPublicClient()) as unknown as DemoPublicClient;
const [wallet] = await connection.viem.getWalletClients();
if (wallet === undefined) throw new Error("no wallet client (is DEPLOYER_PRIVATE_KEY set in the keystore?)");
const buyArg = argValue("--buy") ?? process.env.DEMO_BUY;
const buy = buyArg === undefined ? undefined : parseUnits(buyArg, 6);
const only = argValue("--only") ?? process.env.DEMO_ONLY;

for (const spec of specs.filter((s) => only === undefined || s.symbol === only)) {
  const r = await createDemoBasket(publicClient, wallet as unknown as DemoWalletClient, ctx, spec, buy);
  console.log(`${r.name} (${r.symbol}) -> ${r.basket}`);
  if (r.bought) console.log(`  bought ${r.bought.shares} shares for ${r.bought.usdgSpent} USDG base units`);
}
