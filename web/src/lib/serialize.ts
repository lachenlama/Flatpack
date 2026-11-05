/** JSON.stringify replacer that renders bigint as a decimal string (used by the public API). */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Serialises any value containing bigints to a JSON string. */
export function toJson(value: unknown, space?: number): string {
  return JSON.stringify(value, bigintReplacer, space);
}
