/**
 * Writes shared/deployments/<chainId>.json from Ignition's deployment record:
 *   ignition/deployments/chain-<id>/deployed_addresses.json  -> addresses
 *   ignition/deployments/chain-<id>/journal.jsonl            -> first block with a confirmed deploy transaction
 * Usage: node scripts/export-deployment.ts [--chain 4663] [--deployment-id <id>] [--out <name>]
 * (rehearsal: --deployment-id rehearsal --out rehearsal -> shared/deployments/rehearsal.json)
 * The keeper (WP4b) and the app (WP5) read the output. `blockNumber` is the start block for event indexing.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The exported file format. */
export interface DeploymentFile {
  chainId: number;
  deployedAt: string;
  blockNumber: number;
  addresses: Record<string, string>;
}

/** Strips the `Flatpack#` module prefix from Ignition's future ids. */
export function cleanAddresses(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) out[key.includes("#") ? key.split("#")[1] ?? key : key] = value;
  // the keeper (config.ts) and the app look the Basket implementation up as `Basket`; Ignition calls it BasketImplementation
  if (out.Basket === undefined && out.BasketImplementation !== undefined) out.Basket = out.BasketImplementation;
  return out;
}

/** Finds the lowest block number among confirmed transactions in an Ignition journal (JSON lines). */
export function firstBlockFromJournal(journal: string): number {
  let min = Number.POSITIVE_INFINITY;
  for (const line of journal.split("\n")) {
    if (line.trim() === "") continue;
    const entry = JSON.parse(line) as { type?: string; receipt?: { blockNumber?: number | string } };
    if (entry.type !== "TRANSACTION_CONFIRM" || entry.receipt?.blockNumber === undefined) continue;
    const n = Number(entry.receipt.blockNumber);
    if (Number.isFinite(n) && n < min) min = n;
  }
  if (!Number.isFinite(min)) throw new Error("no TRANSACTION_CONFIRM entry with a block number in the journal");
  return min;
}

function main(): void {
  const argValue = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const chainId = Number(argValue("--chain") ?? 4663);
  const here = dirname(fileURLToPath(import.meta.url));
  // --deployment-id <id>: Ignition deployment id (default chain-<chainId>); --out <name>: shared/deployments/<name>.json
  // (rehearsal: --deployment-id rehearsal --out rehearsal; 4663.json stays reserved for the real mainnet deploy)
  const dir = join(here, "..", "ignition", "deployments", argValue("--deployment-id") ?? `chain-${chainId}`);
  const raw = JSON.parse(readFileSync(join(dir, "deployed_addresses.json"), "utf8")) as Record<string, string>;
  const blockNumber = firstBlockFromJournal(readFileSync(join(dir, "journal.jsonl"), "utf8"));
  const file: DeploymentFile = {
    chainId,
    deployedAt: new Date().toISOString(),
    blockNumber,
    addresses: cleanAddresses(raw),
  };
  const outDir = join(here, "..", "..", "shared", "deployments");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${argValue("--out") ?? chainId}.json`);
  writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
  console.log(`wrote ${out}`);
}

if (import.meta.main) main();
