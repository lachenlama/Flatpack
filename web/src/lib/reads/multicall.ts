import type { Abi, Address, PublicClient } from "viem";

/** A dynamically built contract call for {@link batch}. */
export interface Call {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

/** Result of one call in a batch. */
export type CallResult = { status: "success"; result: unknown } | { status: "failure"; error: Error };

type MulticallFn = (args: { contracts: readonly Call[]; allowFailure: true }) => Promise<CallResult[]>;

/**
 * One Multicall3 round trip with `allowFailure`. (viem's multicall generics do not accept dynamically built lists, so the
 * input is typed loosely here and results are narrowed by the caller.)
 */
export async function batch(client: PublicClient, contracts: Call[]): Promise<CallResult[]> {
  if (contracts.length === 0) return [];
  return (client.multicall as unknown as MulticallFn)({ contracts, allowFailure: true });
}

/** Returns the result of a successful call, else `undefined`. */
export function ok<T>(r: CallResult | undefined): T | undefined {
  return r && r.status === "success" ? (r.result as T) : undefined;
}
