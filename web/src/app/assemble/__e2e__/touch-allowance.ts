/**
 * Fork-only quirk: reading a never-written storage slot of a mainnet contract fails when the upstream RPC no longer serves
 * state at the fork block ("historical state ... is not available" -> "Missing or invalid parameters"). The UI's allowance check
 * reads WIF.allowance(#3, factory), so write that slot once (approve 1 then 0). Not needed on a real chain.
 *   RH_PORT=8547 node src/app/assemble/__e2e__/touch-allowance.ts
 */
import type { Address } from "viem";
import { ACCOUNTS, dep, erc20, network, publicClient, walletFor } from "./lib.ts";

const wm = walletFor(ACCOUNTS.mock);
for (const v of [1n, 0n]) {
  const hash = await wm.writeContract({ address: network.tokens.WIF.address, abi: erc20, functionName: "approve", args: [dep.addresses.BasketFactory as Address, v] });
  await publicClient.waitForTransactionReceipt({ hash });
}
console.log("touched WIF.allowance(#3, factory)");
