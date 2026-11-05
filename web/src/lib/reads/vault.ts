import type { Address } from "viem";
import { backingVaultAbi } from "../../../../shared/abi/index.ts";
import { getPublicClient } from "../chain.ts";
import { getDeployment } from "../deployment.ts";
import { batch, ok } from "./multicall.ts";
import type { VaultPosition, VaultState } from "./types.ts";

type StateTuple = {
  curator: Address; totalActive: bigint; totalWarming: bigint; settleCount: bigint | number; queuedBackers: bigint;
  queuedCurator: bigint; curatorClaimable: bigint; navLast: bigint; benchLast: bigint; lastSettledAt: bigint | number;
};
type PositionTuple = { active: bigint; warming: bigint; pendingUnstake: bigint; unlockAt: bigint | number; claimable: bigint };

/**
 * BackingVault state of one basket in a single multicall (uncached: call from server components with `revalidate`,
 * or from the client via wagmi after a transaction).
 * @returns undefined if the vault does not know the basket
 */
export async function vaultState(basket: Address): Promise<VaultState | undefined> {
  const vault = getDeployment().addresses.BackingVault;
  const r = await batch(getPublicClient(), [
    { address: vault, abi: backingVaultAbi, functionName: "basketState", args: [basket] },
    { address: vault, abi: backingVaultAbi, functionName: "nextSettleAt", args: [basket] },
    { address: vault, abi: backingVaultAbi, functionName: "curatorActive", args: [basket] },
  ]);
  const s = ok<StateTuple>(r[0]);
  if (!s) return undefined;
  return {
    basket,
    curator: s.curator,
    totalActive: s.totalActive,
    totalWarming: s.totalWarming,
    settleCount: Number(s.settleCount),
    queuedBackers: s.queuedBackers,
    queuedCurator: s.queuedCurator,
    curatorClaimable: s.curatorClaimable,
    navLast: s.navLast,
    benchLast: s.benchLast,
    lastSettledAt: Number(s.lastSettledAt),
    nextSettleAt: Number(ok<bigint | number>(r[1]) ?? 0),
    curatorActive: ok<boolean>(r[2]) ?? false,
  };
}

/** An account's backing position in a basket (stake, warm-up, pending unstake, claimable $WIF). */
export async function vaultPosition(basket: Address, account: Address): Promise<VaultPosition> {
  const vault = getDeployment().addresses.BackingVault;
  const [p, pending] = await Promise.all([
    getPublicClient().readContract({ address: vault, abi: backingVaultAbi, functionName: "position", args: [basket, account] }) as Promise<PositionTuple>,
    getPublicClient().readContract({ address: vault, abi: backingVaultAbi, functionName: "pendingRewards", args: [basket, account] }) as Promise<bigint>,
  ]);
  return {
    active: p.active,
    warming: p.warming,
    pendingUnstake: p.pendingUnstake,
    unlockAt: Number(p.unlockAt),
    claimable: pending > p.claimable ? pending : p.claimable,
  };
}
