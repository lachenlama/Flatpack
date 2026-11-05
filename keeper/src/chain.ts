import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config, NetworkConfig } from "./config.ts";

export function robinhoodChain(net: NetworkConfig, rpcUrl: string) {
  return defineChain({
    id: net.chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: net.explorer ? { default: { name: "Blockscout", url: net.explorer } } : undefined,
    contracts: { multicall3: { address: net.multicall3 } },
  });
}

/** Transport: 3 retries with exponential backoff (base 300ms). */
export function makeClients(cfg: Config, net: NetworkConfig) {
  const chain = robinhoodChain(net, cfg.rpcUrl);
  const transport = http(cfg.rpcUrl, { retryCount: 3, retryDelay: 300, timeout: 20_000 });
  const publicClient = createPublicClient({ chain, transport });
  const account = cfg.privateKey ? privateKeyToAccount(cfg.privateKey) : undefined;
  const walletClient = account ? createWalletClient({ chain, transport, account }) : undefined;
  return { chain, publicClient, walletClient, account };
}
