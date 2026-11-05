// CLI entry: node src/tick.ts [--dry-run] [--once]
import { ConfigError, loadDeployment, loadNetwork, parseConfig } from "./config.ts";
import { makeClients } from "./chain.ts";
import { snapshot } from "./read.ts";
import { isLowGas, plan } from "./plan.ts";
import { execute } from "./exec.ts";
import type { ExecClient } from "./exec.ts";
import { logEvent, logResult, writeSummary } from "./log.ts";
import { feeHarvesterAbi } from "../../shared/abi/index.ts";
import type { Address, Result } from "./types.ts";

async function main(): Promise<number> {
  const cfg = parseConfig(process.env, process.argv.slice(2));
  const net = loadNetwork();
  const deployment = loadDeployment(cfg.deploymentPath, net.chainId);
  const addresses = deployment.addresses;
  const { publicClient, walletClient, account } = makeClients(cfg, net);

  // Keeper address: from the key, else KEEPER_ADDRESS, else (dry-run only) the harvester's configured keeper.
  let keeper: Address | null = account?.address ?? cfg.keeperAddress ?? null;
  if (keeper === null) {
    keeper = (await publicClient.readContract({
      address: addresses.FeeHarvester,
      abi: feeHarvesterAbi,
      functionName: "keeper",
    })) as Address;
  }

  const snap = await snapshot(publicClient, addresses, keeper);
  const actions = plan(snap, cfg);
  const lowGas = isLowGas(snap, cfg);
  logEvent({
    msg: "plan",
    dryRun: cfg.dryRun,
    baskets: snap.baskets.length,
    actions: actions.map((a) => ({ kind: a.kind, basket: a.basket, token: "token" in a ? a.token : undefined })),
    keeper,
    keeperEth: snap.keeperEth,
  });
  if (lowGas) logEvent({ level: "warn", msg: "LOW_GAS", keeperEth: snap.keeperEth, minEth: cfg.minEth });

  const client: ExecClient = {
    simulateContract: (a) => publicClient.simulateContract(a),
    writeContract: (r) => {
      if (!walletClient) throw new Error("no wallet client (dry-run)");
      return walletClient.writeContract(r);
    },
    waitForTransactionReceipt: (a) => publicClient.waitForTransactionReceipt(a),
    getBlock: (a) => publicClient.getBlock(a),
  };

  const results: Result[] = await execute(actions, { client, account: keeper, addresses }, cfg);
  for (const r of results) logResult(r);

  const failed = results.filter((r) => r.status === "failed").length;
  writeSummary(
    results,
    `${cfg.dryRun ? "DRY RUN. " : ""}${snap.baskets.length} basket(s), ${actions.length} action(s), ${failed} failed.${lowGas ? " LOW_GAS: keeper ETH below MIN_ETH." : ""}`,
  );
  return failed > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    // Config errors are safe to print (they never contain secrets). Others: message only.
    const msg = e instanceof ConfigError ? e.message : e instanceof Error ? (e as Error & { shortMessage?: string }).shortMessage ?? e.message : "unknown error";
    logEvent({ level: "error", msg: "tick aborted", error: msg.slice(0, 500) });
    process.exit(1);
  },
);
