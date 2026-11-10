import { isAddress, type Address } from "viem";

/** Names of the contracts in display order. */
export const CONTRACT_NAMES = [
  "BasketFactory",
  "FlatpackRouter",
  "BackingVault",
  "FeeHarvester",
  "ComponentRegistry",
  "BasketImplementation",
] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];

/** Shape of shared/deployments/<name>.json (as written by contracts/scripts/export-deployment.ts). */
export interface Deployment {
  chainId: number;
  deployedAt: string | number;
  /** Block the deployment started at: the start of every `getLogs` scan. */
  blockNumber: number;
  addresses: Record<ContractName, Address>;
}

export class DeploymentError extends Error {}

/**
 * Validates a parsed deployment JSON. `BasketImplementation` falls back to the legacy `Basket` key.
 * @throws DeploymentError on any missing/invalid field.
 */
export function validateDeployment(json: unknown, expectedChainId = 4663): Deployment {
  const o = json as Record<string, unknown> | null;
  if (o === null || typeof o !== "object") throw new DeploymentError("deployment: not an object");
  if (o.chainId !== expectedChainId) throw new DeploymentError(`deployment: chainId must be ${expectedChainId}`);
  if (typeof o.deployedAt !== "string" && typeof o.deployedAt !== "number") throw new DeploymentError("deployment: deployedAt missing");
  if (typeof o.blockNumber !== "number" || !Number.isInteger(o.blockNumber) || o.blockNumber < 0) {
    throw new DeploymentError("deployment: blockNumber must be a non-negative integer");
  }
  const a = o.addresses as Record<string, unknown> | null;
  if (a === null || typeof a !== "object") throw new DeploymentError("deployment: addresses missing");
  const out = {} as Record<ContractName, Address>;
  for (const k of CONTRACT_NAMES) {
    const v = a[k] ?? (k === "BasketImplementation" ? a.Basket : undefined);
    if (typeof v !== "string" || !isAddress(v, { strict: false })) {
      throw new DeploymentError(`deployment: addresses.${k} missing or not an address`);
    }
    out[k] = v as Address;
  }
  return { chainId: o.chainId, deployedAt: o.deployedAt, blockNumber: o.blockNumber, addresses: out };
}

/** Parses + validates raw JSON text. */
export function parseDeployment(raw: string | undefined, expectedChainId = 4663): Deployment {
  if (!raw) {
    throw new DeploymentError(
      "No deployment loaded. Set NEXT_PUBLIC_DEPLOYMENT to a file name in shared/deployments/ (4663 or rehearsal) before `next build`.",
    );
  }
  return validateDeployment(JSON.parse(raw), expectedChainId);
}

let cached: Deployment | undefined;
/** The active deployment (inlined at build time by next.config.ts). Throws DeploymentError if none. */
export function getDeployment(): Deployment {
  cached ??= parseDeployment(process.env.NEXT_PUBLIC_DEPLOYMENT_JSON);
  return cached;
}

/** True when a deployment file was found at build time. */
export function hasDeployment(): boolean {
  try {
    getDeployment();
    return true;
  } catch {
    return false;
  }
}

/** Name of the active deployment ("4663" | "rehearsal"). */
export const DEPLOYMENT_NAME: string = process.env.NEXT_PUBLIC_DEPLOYMENT_NAME || "4663";
