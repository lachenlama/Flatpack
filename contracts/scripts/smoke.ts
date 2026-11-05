/**
 * CLI smoke check (reads only): node scripts/smoke.ts [--params ignition/parameters/mainnet.json]
 *   [--addresses ignition/deployments/chain-4663/deployed_addresses.json]
 * RPC: $RH_RPC_URL (default: the public Robinhood Chain RPC). Exits 1 on any failed check.
 * Plain viem on purpose: reading needs no deployer key, so no keystore prompt (unlike `--network robinhood`).
 */
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, http } from "viem";
import {
  addressesFromIgnition,
  expectedFromParameters,
  formatReport,
  smoke,
  type ParameterValues,
} from "./lib/smoke.ts";

function argValue(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

async function main(): Promise<void> {
  const rpc = process.env.RH_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
  const paramsPath = argValue("--params", "ignition/parameters/mainnet.json");
  const addressesPath = argValue("--addresses", "ignition/deployments/chain-4663/deployed_addresses.json");
  const params = (JSON.parse(readFileSync(paramsPath, "utf8")) as { Flatpack: ParameterValues }).Flatpack;
  const deployed = JSON.parse(readFileSync(addressesPath, "utf8")) as Record<string, string>;

  const chain = defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const client = createPublicClient({ chain, transport: http(rpc) });
  const report = await smoke(client, addressesFromIgnition(deployed), expectedFromParameters(params));
  console.log(formatReport(report));
  if (report.failures > 0) process.exit(1);
}

await main();
