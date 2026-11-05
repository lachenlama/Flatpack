/**
 * Shared helpers for the deploy-day rehearsal (WP4c). Everything here talks to the LOCAL fork node only
 * (default http://127.0.0.1:8545); the keys are the public Hardhat test keys and must never touch a real network.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type Address = `0x${string}`;

export const RPC_URL = process.env.REHEARSAL_RPC ?? `http://127.0.0.1:${process.env.RH_PORT ?? "8545"}`;
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(RPC_URL)) {
  throw new Error(`refusing to run the rehearsal against a non-local RPC: ${RPC_URL}`);
}

/** Hardhat default test accounts #0 (owner/deployer/curator/buyer), #1 (keeper), #2 (referrer). PUBLIC KEYS. */
export const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  keeper: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  referrer: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
} as const;
export const owner = privateKeyToAccount(KEYS.owner);
export const keeper = privateKeyToAccount(KEYS.keeper);
export const referrer = privateKeyToAccount(KEYS.referrer);

export const DEAD: Address = "0x000000000000000000000000000000000000dEaD";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..", "..");

export const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain (local fork)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
export const walletFor = (account: ReturnType<typeof privateKeyToAccount> | Address) =>
  createWalletClient({ chain, transport: http(RPC_URL), account });

export interface NetworkJson {
  chainId: number;
  tokens: { USDG: { address: Address }; WIF: { address: Address } };
  uniswap: { v4PoolManager: Address; usdgWethPool: { address: Address } };
  launchUniverse: Record<string, { token: Address; feed: Address } | string>;
}
export const networkConfig = JSON.parse(
  readFileSync(join(repoRoot, "config", "mainnet-4663.json"), "utf8"),
) as NetworkJson;

export interface DeploymentJson {
  chainId: number;
  blockNumber: number;
  addresses: Record<string, Address>;
}
export function loadDeployment(): DeploymentJson {
  const path = process.env.DEPLOYMENT ?? join(repoRoot, "shared", "deployments", "rehearsal.json");
  return JSON.parse(readFileSync(path, "utf8")) as DeploymentJson;
}

/** Raw JSON-RPC (hardhat_*, evm_* methods that viem does not type). */
export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
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
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const satisfies Abi;

export const balanceOf = (token: Address, who: Address): Promise<bigint> =>
  publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

/** Moves `amount` of `token` from `holder` (impersonated, topped up with gas ETH) to `to`. */
export async function fundFrom(token: Address, holder: Address, to: Address, amount: bigint): Promise<`0x${string}`> {
  await rpc("hardhat_setBalance", [holder, "0x56BC75E2D63100000"]); // 100 ETH
  await rpc("hardhat_impersonateAccount", [holder]);
  try {
    const hash = await walletFor(holder).writeContract({
      address: token,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, amount],
    });
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`transfer from ${holder} reverted`);
    return hash;
  } finally {
    await rpc("hardhat_stopImpersonatingAccount", [holder]);
  }
}

const STATE = process.env.REHEARSAL_STATE ?? "/tmp/flatpack-rehearsal/state.json";
export function loadState(): Record<string, any> {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
}
export function saveState(patch: Record<string, unknown>): void {
  mkdirSync(dirname(STATE), { recursive: true });
  const next = { ...loadState(), ...patch };
  writeFileSync(STATE, JSON.stringify(next, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 2));
}
/** State values written by saveState: bigints are stored as "123n". */
export const big = (v: unknown): bigint => BigInt(String(v).replace(/n$/, ""));

export const fmt = (v: bigint, dec = 18): string => {
  const s = v.toString().padStart(dec + 1, "0");
  return `${s.slice(0, -dec)}.${s.slice(-dec).slice(0, 6)}`;
};

let failures = 0;
export function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
}
export function finish(): never {
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
