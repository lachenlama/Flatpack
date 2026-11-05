import { appendFileSync } from "node:fs";
import type { Result } from "./types.ts";

function replacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

/** One JSON line per event on stdout. */
export function logEvent(event: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...event }, replacer) + "\n");
}

export function logResult(r: Result): void {
  logEvent({
    basket: r.action.basket,
    action: r.action.kind,
    token: "token" in r.action ? r.action.token : undefined,
    status: r.status,
    txHash: r.txHash,
    wifOut: r.wifOut,
    minWifOut: r.minWifOut,
    reason: r.reason,
    error: r.error,
  });
}

export function summaryMarkdown(results: Result[], note?: string): string {
  const lines = ["## Flatpack keeper tick", ""];
  if (note) lines.push(note, "");
  if (results.length === 0) {
    lines.push("No actions needed.");
  } else {
    lines.push("| Basket | Action | Status | WIF out | Tx / detail |", "|---|---|---|---|---|");
    for (const r of results) {
      const detail = (r.txHash ?? r.error ?? r.reason ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ");
      const act = "token" in r.action ? `${r.action.kind}(${r.action.token})` : r.action.kind;
      lines.push(`| ${r.action.basket} | ${act} | ${r.status} | ${r.wifOut ?? ""} | ${detail} |`);
    }
  }
  return lines.join("\n") + "\n";
}

export function writeSummary(results: Result[], note?: string, env: Record<string, string | undefined> = process.env): void {
  const path = env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, summaryMarkdown(results, note));
}
