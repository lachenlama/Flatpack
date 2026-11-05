/**
 * Shared helpers of the headless e2e scripts (LOCAL fork node only: hardhat accounts are unlocked, the node signs).
 * Run from web/ with WSL Node 24: `RH_PORT=8547 DEPLOYMENT=rehearsal-8547 node src/app/assemble/__e2e__/<script>.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Address } from "viem";

export const PORT = process.env.RH_PORT ?? "8547";
export const RPC_URL = `http://127.0.0.1:${PORT}`;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(RPC_URL)) throw new Error("local node only");
export const DEPLOYMENT = process.env.DEPLOYMENT ?? `rehearsal-${PORT}`;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..", "..");
export const dep = JSON.parse(readFileSync(join(root, "shared", "deployments", `${DEPLOYMENT}.json`), "utf8")) as {
  addresses: Record<string, Address>;
};
export const network = JSON.parse(readFileSync(join(root, "config", "mainnet-4663.json"), "utf8")) as {
  tokens: { WIF: { address: Address }; USDG: { address: Address } };
  uniswap: { v4PoolManager: Address };
  launchUniverse: Record<string, { token: Address; feed: Address }>;
};

/** Hardhat default accounts (public). */
export const ACCOUNTS = {
  owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  keeper: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  referrer: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  mock: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // #3, the browser mock wallet
  curator: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", // #4, the headless curator
} as const satisfies Record<string, Address>;

export const chain = defineChain({
  id: 4663,
  name: "local fork",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
export const walletFor = (account: Address) => createWalletClient({ chain, transport: http(RPC_URL), account });

export const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** JSON-RPC to the local node. */
export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}

/** Gives `to` `amount` WIF by impersonating the v4 PoolManager (which holds WIF), like the rehearsal does. */
export async function fundWif(to: Address, amount: bigint): Promise<void> {
  const holder = network.uniswap.v4PoolManager;
  await rpc("hardhat_setBalance", [holder, "0x56BC75E2D63100000"]);
  await rpc("hardhat_impersonateAccount", [holder]);
  try {
    const hash = await walletFor(holder).writeContract({ address: network.tokens.WIF.address, abi: erc20, functionName: "transfer", args: [to, amount] });
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("WIF funding transfer reverted");
  } finally {
    await rpc("hardhat_stopImpersonatingAccount", [holder]);
  }
}
