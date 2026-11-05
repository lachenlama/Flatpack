import { createPublicClient, defineChain, http, type Address, type PublicClient } from "viem";
import network from "../../../config/mainnet-4663.json";

type UniverseEntry = { token: string; feed: string; v3Fee: number };

/** Static network facts from config/mainnet-4663.json. */
export const NETWORK = {
  chainId: network.chainId as 4663,
  rpc: network.rpc,
  explorer: network.explorer.replace(/\/$/, ""),
  multicall3: network.multicall3 as Address,
  usdg: { address: network.tokens.USDG.address as Address, decimals: network.tokens.USDG.decimals },
  wif: { address: network.tokens.WIF.address as Address, decimals: network.tokens.WIF.decimals },
  weth: network.tokens.WETH.address as Address,
  benchmark: network.benchmark,
} as const;

/** Ticker -> { token, feed, v3Fee } for the launch universe (SPY included). */
export const LAUNCH_UNIVERSE: Readonly<Record<string, UniverseEntry>> = Object.fromEntries(
  Object.entries(network.launchUniverse).filter(([k, v]) => !k.startsWith("_") && typeof v === "object"),
) as Record<string, UniverseEntry>;

/** Lowercase token address -> ticker, for the launch universe. */
export const TICKER_BY_TOKEN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LAUNCH_UNIVERSE).map(([ticker, v]) => [v.token.toLowerCase(), ticker]),
);

/** RPC endpoint (NEXT_PUBLIC_RPC_URL, default the public Robinhood Chain RPC). */
export const RPC_URL: string = process.env.NEXT_PUBLIC_RPC_URL || network.rpc;

/** Robinhood Chain (id 4663) as a viem/wagmi chain. */
export const robinhoodChain = defineChain({
  id: NETWORK.chainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Blockscout", url: NETWORK.explorer } },
  contracts: { multicall3: { address: NETWORK.multicall3 } },
});

let client: PublicClient | undefined;
/** Shared viem public client (multicall batching on, 3 retries). Safe on server and client. */
export function getPublicClient(): PublicClient {
  client ??= createPublicClient({
    chain: robinhoodChain,
    transport: http(RPC_URL, { retryCount: 3, retryDelay: 300, timeout: 20_000 }),
    batch: { multicall: true },
  }) as PublicClient;
  return client;
}

/** Blockscout URL of a transaction. */
export const explorerTx = (hash: string): string => `${NETWORK.explorer}/tx/${hash}`;
/** Blockscout URL of an address. */
export const explorerAddress = (address: string): string => `${NETWORK.explorer}/address/${address}`;

/** Public site origin (for share links and OG images). */
export const SITE_URL: string = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
/** GitHub repo URL used for ADR links on /proof. */
export const REPO_URL: string = (process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/OWNER/flatpack").replace(/\/$/, "");
