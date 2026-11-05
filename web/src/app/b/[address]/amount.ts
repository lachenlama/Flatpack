import { parseUnits } from "viem";

/** Parses a user-typed decimal string into base units; undefined when empty, malformed or too precise. Pure. */
export function parseAmount(text: string, decimals: number): bigint | undefined {
  const t = text.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return undefined;
  try {
    return parseUnits(t, decimals);
  } catch {
    return undefined;
  }
}

