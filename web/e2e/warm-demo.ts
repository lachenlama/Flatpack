/**
 * Warms the LOCAL rehearsal fork so the demo keeps working after the upstream RPC prunes its old state (~10 min).
 *   cd web && node e2e/warm-demo.ts            critical warm-up: pages + simulated quotes/buys (what makes Buy work)
 *   cd web && node e2e/warm-demo.ts --charts   slow part: loads each basket page so its 30-day chart history is cached too
 * (APP_URL default http://localhost:3000, RPC_URL default http://127.0.0.1:8545)
 * The fork fetches storage lazily from the public RPC, so anything not yet read fails later with "Missing or invalid parameters".
 * The simulations are eth_call (no state change); the allowance they need is reset to 1 wei afterwards.
 * Run it AFTER node e2e/fund-demo.ts and with the app already running. Local node only.
 */
import { readFileSync } from "node:fs";
import { encodeFunctionData, parseUnits, zeroAddress } from "viem";
import { flatpackRouterAbi } from "../../shared/abi/index.ts";
import { ACCOUNT3, RPC, USDG, approveFrom3, rpc } from "../src/app/b/[address]/__e2e__/fund.ts";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(RPC)) throw new Error(`refusing to run against a non-local RPC: ${RPC}`);

const APP = process.env.APP_URL ?? "http://localhost:3000";
const id = process.env.DEPLOYMENT ?? "rehearsal";
const dep = JSON.parse(readFileSync(new URL(`../../shared/deployments/${id}.json`, import.meta.url), "utf8")) as { addresses: Record<string, string> };
const router = dep.addresses.FlatpackRouter as `0x${string}`;
const SIZES = ["1", "5", "10", "25", "50"]; // a share costs ~$65-70, so 50 shares is ~$3,500 of the wallet's 5,000 USDG
const chartsOnly = process.argv.includes("--charts");

const t0 = Date.now();
const secs = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
let bad = 0;

async function get(path: string): Promise<string> {
  const r = await fetch(`${APP}${path}`);
  const body = await r.text(); // waits for the whole stream, including the Suspense-streamed chart
  // The app's RPC-failure states still return 200, so look for their text too (rendered with an HTML-escaped apostrophe).
  const rpcError = /Can(?:'|&#x27;|&#39;)t read (?:this basket|baskets) right now/.test(body);
  console.log(`  [${secs()}] ${r.status} ${path}${rpcError ? "  <- page shows an RPC error" : ""}`);
  if (!r.ok || rpcError) bad++;
  return body;
}

if (!chartsOnly) {
  console.log("pages");
  for (const p of ["/", "/assemble", "/api/baskets", `/me?address=${ACCOUNT3}`]) await get(p);
}
const explore = await get("/explore");
const baskets = [...new Set([...explore.matchAll(/\/b\/(0x[0-9a-fA-F]{40})/g)].map((m) => m[1] as `0x${string}`))];
if (baskets.length === 0) {
  console.log("  no baskets found on /explore");
  process.exit(1);
}

if (chartsOnly) {
  console.log("basket pages (30-day chart history)");
  await Promise.all(baskets.map((b) => get(`/b/${b}`)));
  console.log(bad === 0 ? `CHARTS WARM (${secs()})` : `CHARTS FINISHED WITH ${bad} PROBLEM(S) (${secs()})`);
  process.exit(bad === 0 ? 0 : 1);
}

console.log("simulated quotes and buys (eth_call, mock wallet)");
await approveFrom3(USDG, router, (1n << 200n) - 1n);
const ts = BigInt((await rpc<{ timestamp: string }>("eth_getBlockByNumber", ["latest", false])).timestamp);
async function sim(label: string, data: string): Promise<void> {
  try {
    await rpc("eth_call", [{ from: ACCOUNT3, to: router, data }, "latest"]);
    console.log(`  [${secs()}] ok     ${label}`);
  } catch (e) {
    const m = (e as Error).message;
    // quoteBuy always reverts with QuoteResult (the success case). A buy over the wallet's budget reverts ExcessiveInput: the swaps
    // all ran, so the state is cached. Anything else is reported; only a stale-state error counts as a problem.
    if (/QuoteResult|17080d7e|ExcessiveInput/.test(m)) console.log(`  [${secs()}] ok     ${label}`);
    else if (/invalid param|missing trie|header not found|forking/i.test(m)) {
      console.log(`  [${secs()}] STALE  ${label}: ${m}`);
      bad++;
    } else console.log(`  [${secs()}] revert ${label}: ${m.slice(0, 90)}`);
  }
}
for (const basket of baskets) {
  for (const n of SIZES) {
    const shares = parseUnits(n, 18);
    await sim(`quote ${basket.slice(0, 8)} x${n}`, encodeFunctionData({ abi: flatpackRouterAbi, functionName: "quoteBuy", args: [basket, shares] }));
    await sim(
      `buy   ${basket.slice(0, 8)} x${n}`,
      encodeFunctionData({
        abi: flatpackRouterAbi,
        functionName: "buy",
        // maxUsdgIn stays below the 5,000 USDG wallet: the router pulls maxUsdgIn up front
        args: [{ basket, shares, maxUsdgIn: parseUnits("4500", 6), receiver: ACCOUNT3, referrer: zeroAddress, deadline: ts + 1200n }],
      }),
    );
  }
}
await approveFrom3(USDG, router, 1n);

console.log(bad === 0 ? `WARM OK (${secs()})` : `WARM FINISHED WITH ${bad} PROBLEM(S) (${secs()})`);
process.exit(bad === 0 ? 0 : 1);
