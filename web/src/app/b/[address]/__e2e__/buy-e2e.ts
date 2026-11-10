/**
 * Headless viem e2e (WSL Node 24, cwd web/): account #3 buys 1 share of the first demo basket through the router and the script
 * confirms that the server-rendered /b/<basket> shows the new holder count and TVL.
 *   node "src/app/b/[address]/__e2e__/buy-e2e.ts"       (APP_URL default http://localhost:3000, RPC_URL default http://127.0.0.1:8545)
 */
import { createPublicClient, createWalletClient, http, parseUnits, type Address } from "viem";
import { backingVaultAbi, basketAbi, flatpackRouterAbi } from "../../../../../../shared/abi/index.ts";
import { ACCOUNT3, RPC, USDG, USDG_HOLDER, WIF, WIF_HOLDER, balanceOf, fundFrom, approveFrom3, rpc } from "./fund.ts";
import { readFileSync } from "node:fs";
import { quoteFromError } from "../../../../lib/errors.ts";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const dep = JSON.parse(readFileSync(new URL("../../../../../../shared/deployments/rehearsal.json", import.meta.url), "utf8")) as {
  addresses: Record<string, Address>;
};
const ROUTER = dep.addresses.FlatpackRouter as Address;
const fail = (m: string): never => {
  throw new Error(`BUY E2E FAIL: ${m}`);
};

const pub = createPublicClient({ transport: http(RPC) });
const wal = createWalletClient({ transport: http(RPC) });
const list = (await (await fetch(`${APP}/api/baskets`)).json()) as { baskets?: { address: Address }[] };
const basket = (process.env.BASKET as Address | undefined) ?? list.baskets?.[0]?.address ?? fail("set BASKET=0x...");

async function page(): Promise<{ holders: number; tvl: number; html: string }> {
  const html = await (await fetch(`${APP}/b/${basket}`)).text();
  const h = /data-testid="holders"[^>]*>(\d+)</.exec(html);
  const t = /data-testid="tvl"[^>]*>\$([\d,\.]+)</.exec(html);
  if (!h || !t) fail(`holders/tvl not found in /b/${basket} HTML`);
  return { holders: Number(h![1]), tvl: Number((t![1] as string).replace(/,/g, "")), html };
}

// 1. fund #3 with USDG, reset allowance so the UI e2e later runs the approve step too
// NOTE: the fork can only read upstream state for a short time after the fork block, so run this right after the rehearsal.
await fundFrom(USDG, USDG_HOLDER, ACCOUNT3, 2000n * 10n ** 6n);
await fundFrom(WIF, WIF_HOLDER, ACCOUNT3, 500n * 10n ** 18n);
console.log("funded #3 USDG =", await balanceOf(USDG, ACCOUNT3));

const before = await page();
console.log("before:", before.holders, "holders, TVL $" + before.tvl);

// 2. quote (QuoteResult revert), approve exact, buy
const shares = parseUnits("1", 18);
let quote: bigint | undefined;
try {
  await pub.simulateContract({ address: ROUTER, abi: flatpackRouterAbi, functionName: "quoteBuy", args: [basket, shares] });
} catch (e) {
  quote = quoteFromError(e);
}
if (quote === undefined) throw new Error("BUY E2E FAIL: could not decode QuoteResult");
const maxIn = (quote * 10100n) / 10000n + 1n;
console.log("quote", quote, "maxUsdgIn", maxIn);
await approveFrom3(USDG, ROUTER, maxIn);
const heldBefore = (await pub.readContract({ address: basket, abi: basketAbi, functionName: "balanceOf", args: [ACCOUNT3] })) as bigint;
const hash = await wal.writeContract({
  account: ACCOUNT3,
  chain: null,
  address: ROUTER,
  abi: flatpackRouterAbi,
  functionName: "buy",
  args: [{ basket, shares, maxUsdgIn: maxIn, receiver: ACCOUNT3, referrer: "0x0000000000000000000000000000000000000000", deadline: (await pub.getBlock()).timestamp + 1200n }],
});
const rc = await pub.waitForTransactionReceipt({ hash });
if (rc.status !== "success") fail("buy reverted");
const held = (await pub.readContract({ address: basket, abi: basketAbi, functionName: "balanceOf", args: [ACCOUNT3] })) as bigint;
console.log("buy tx", hash, "shares held", heldBefore, "->", held);
if (held - heldBefore !== shares - (shares * 30n) / 10000n) fail("unexpected shares received");
await approveFrom3(USDG, ROUTER, 0n);

// 2b. warm the fork's state cache for the slots the UI click-through reads for #3 (eth_call fetches and caches upstream slots)
const erc20 = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const vaultAddr = dep.addresses.BackingVault as Address;
const comps = (await pub.readContract({ address: basket, abi: basketAbi, functionName: "components" })) as readonly [readonly Address[], readonly bigint[]];
const reads: Promise<unknown>[] = [
  pub.readContract({ address: vaultAddr, abi: backingVaultAbi, functionName: "position", args: [basket, ACCOUNT3] }),
  pub.readContract({ address: vaultAddr, abi: backingVaultAbi, functionName: "pendingRewards", args: [basket, ACCOUNT3] }),
  pub.readContract({ address: basket, abi: basketAbi, functionName: "pendingWifDividend", args: [ACCOUNT3] }),
  pub.readContract({ address: USDG, abi: erc20, functionName: "allowance", args: [ACCOUNT3, ROUTER] }),
  pub.readContract({ address: WIF, abi: erc20, functionName: "allowance", args: [ACCOUNT3, vaultAddr] }),
  ...comps[0].map((tk) => pub.readContract({ address: basket, abi: basketAbi, functionName: "owed", args: [ACCOUNT3, tk] })),
];
await Promise.allSettled(reads);
console.log("warmed state reads for #3");
// 3. the server-rendered page must show the new state (server caches: holders 60s, baskets 15s)
const wantHolders = before.holders + (heldBefore === 0n ? 1 : 0);
let after = before;
for (let i = 0; i < 45; i++) {
  after = await page();
  if (after.holders === wantHolders && after.tvl > before.tvl) break;
  await new Promise((r) => setTimeout(r, 3000));
}
console.log("after:", after.holders, "holders, TVL $" + after.tvl);
if (after.holders !== wantHolders) fail(`holders ${after.holders} != expected ${wantHolders}`);
if (!(after.tvl > before.tvl)) fail("TVL did not increase");
console.log(`BUY E2E PASS (${await rpc("eth_blockNumber")})`);
