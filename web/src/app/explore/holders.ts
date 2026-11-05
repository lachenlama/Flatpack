import { zeroAddress } from "viem";

/** Counts addresses with a positive balance from ERC-20 Transfer logs, ignoring the zero address and `exclude` (lowercase). Pure. */
export function countHolders(logs: readonly { from: string; to: string; value: bigint }[], exclude: string[] = []): number {
  const bal = new Map<string, bigint>();
  for (const { from, to, value } of logs) {
    if (from !== zeroAddress) bal.set(from.toLowerCase(), (bal.get(from.toLowerCase()) ?? 0n) - value);
    if (to !== zeroAddress) bal.set(to.toLowerCase(), (bal.get(to.toLowerCase()) ?? 0n) + value);
  }
  for (const e of exclude) bal.delete(e.toLowerCase());
  let n = 0;
  for (const v of bal.values()) if (v > 0n) n++;
  return n;
}
