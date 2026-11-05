// Env + CLI parsing and validation. The private key is never logged or included in an error message.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEther, isAddress } from "viem";
import type { Address, Addresses, Hex } from "./types.ts";

export type Config = {
  rpcUrl: string;
  /** Required unless dryRun. Never log this. */
  privateKey: Hex | undefined;
  /** Optional address used to simulate/read balance in dry-run without a key. */
  keeperAddress: Address | undefined;
  dryRun: boolean;
  deploymentPath: string;
  minHarvestWif: bigint;
  slippageBps: bigint;
  minEth: bigint;
  deadlineSecs: bigint;
};

export type NetworkConfig = { chainId: number; rpc: string; explorer: string; multicall3: Address };

export const DEFAULT_MIN_HARVEST_WIF = 350_000_000_000_000_000_000n;
export const MAX_SLIPPAGE_BPS = 1000n;

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_NETWORK_FILE = resolve(here, "../../config/mainnet-4663.json");
export const DEFAULT_DEPLOYMENT_FILE = resolve(here, "../../shared/deployments/4663.json");

export class ConfigError extends Error {}

function nonEmpty(v: string | undefined): string | undefined {
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

function parseUint(name: string, raw: string | undefined, def: bigint): bigint {
  const v = nonEmpty(raw);
  if (v === undefined) return def;
  if (!/^\d+$/.test(v)) throw new ConfigError(`${name} must be a non-negative integer`);
  return BigInt(v);
}

export function parseConfig(env: Record<string, string | undefined>, argv: string[]): Config {
  const known = new Set(["--dry-run", "--once"]);
  for (const a of argv) if (!known.has(a)) throw new ConfigError(`unknown argument: ${a}`);
  const dryRun = argv.includes("--dry-run");

  const network = loadNetwork();
  const rpcUrl = nonEmpty(env.RPC_URL) ?? nonEmpty(env.RH_RPC_URL) ?? network.rpc;
  if (!/^https?:\/\//.test(rpcUrl)) throw new ConfigError("RPC_URL must be an http(s) URL");

  let privateKey: Hex | undefined;
  const rawKey = nonEmpty(env.KEEPER_PRIVATE_KEY);
  if (rawKey !== undefined) {
    const k = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new ConfigError("KEEPER_PRIVATE_KEY is not a 32-byte hex string");
    privateKey = k as Hex;
  } else if (!dryRun) {
    throw new ConfigError("KEEPER_PRIVATE_KEY is required unless --dry-run");
  }

  const rawAddr = nonEmpty(env.KEEPER_ADDRESS);
  if (rawAddr !== undefined && !isAddress(rawAddr, { strict: false })) {
    throw new ConfigError("KEEPER_ADDRESS is not an address");
  }

  const slippageBps = parseUint("SLIPPAGE_BPS", env.SLIPPAGE_BPS, 100n);
  if (slippageBps > MAX_SLIPPAGE_BPS) throw new ConfigError(`SLIPPAGE_BPS must be <= ${MAX_SLIPPAGE_BPS}`);

  const deadlineSecs = parseUint("DEADLINE_SECS", env.DEADLINE_SECS, 300n);
  if (deadlineSecs === 0n) throw new ConfigError("DEADLINE_SECS must be > 0");

  const minEthRaw = nonEmpty(env.MIN_ETH) ?? "0.0002";
  let minEth: bigint;
  try {
    if (!/^\d+(\.\d+)?$/.test(minEthRaw)) throw new Error("bad");
    minEth = parseEther(minEthRaw);
  } catch {
    throw new ConfigError("MIN_ETH must be a decimal ETH amount, e.g. 0.0002");
  }

  return {
    rpcUrl,
    privateKey,
    keeperAddress: rawAddr as Address | undefined,
    dryRun,
    deploymentPath: resolve(nonEmpty(env.DEPLOYMENT) ?? DEFAULT_DEPLOYMENT_FILE),
    minHarvestWif: parseUint("MIN_HARVEST_WIF", env.MIN_HARVEST_WIF, DEFAULT_MIN_HARVEST_WIF),
    slippageBps,
    minEth,
    deadlineSecs,
  };
}

export function loadNetwork(file: string = DEFAULT_NETWORK_FILE): NetworkConfig {
  const j = JSON.parse(readFileSync(file, "utf8"));
  if (typeof j.chainId !== "number" || typeof j.rpc !== "string" || !isAddress(j.multicall3, { strict: false })) {
    throw new ConfigError(`invalid network config: ${file}`);
  }
  return { chainId: j.chainId, rpc: j.rpc, explorer: j.explorer ?? "", multicall3: j.multicall3 as Address };
}

const ADDRESS_KEYS = [
  "ComponentRegistry",
  "FeeHarvester",
  "BackingVault",
  "Basket",
  "BasketFactory",
  "FlatpackRouter",
] as const;

export type Deployment = { chainId: number; deployedAt: string | number; blockNumber: number; addresses: Addresses };

/**
 * Expected shape of shared/deployments/<chainId>.json:
 * { "chainId": 4663, "deployedAt": "<ISO time>", "blockNumber": 123,
 *   "addresses": { ComponentRegistry, FeeHarvester, BackingVault, Basket, BasketFactory, FlatpackRouter } }
 */
export function validateDeployment(j: unknown, expectedChainId = 4663): Deployment {
  const o = j as Record<string, unknown> | null;
  if (o === null || typeof o !== "object") throw new ConfigError("deployment: not an object");
  if (o.chainId !== expectedChainId) throw new ConfigError(`deployment: chainId must be ${expectedChainId}`);
  if (typeof o.deployedAt !== "string" && typeof o.deployedAt !== "number") {
    throw new ConfigError("deployment: deployedAt missing");
  }
  if (typeof o.blockNumber !== "number" || !Number.isInteger(o.blockNumber) || o.blockNumber < 0) {
    throw new ConfigError("deployment: blockNumber must be a non-negative integer");
  }
  const a = o.addresses as Record<string, unknown> | null;
  if (a === null || typeof a !== "object") throw new ConfigError("deployment: addresses missing");
  for (const k of ADDRESS_KEYS) {
    if (typeof a[k] !== "string" || !isAddress(a[k] as string, { strict: false })) {
      throw new ConfigError(`deployment: addresses.${k} missing or not an address`);
    }
  }
  return o as unknown as Deployment;
}

export function loadDeployment(path: string, expectedChainId = 4663): Deployment {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(`deployment file not found: ${path}`);
  }
  return validateDeployment(JSON.parse(raw), expectedChainId);
}
