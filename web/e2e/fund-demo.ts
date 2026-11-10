/**
 * Funds the mock wallet (Hardhat account #3) on the LOCAL rehearsal node so you can click through Buy / Back / Assemble.
 *   cd web && node e2e/fund-demo.ts            (RPC_URL default http://127.0.0.1:8545, DEPLOYMENT default "rehearsal")
 * Gives account #3: 5,000 USDG and 3,000 $WIF. Also writes a 1-wei allowance to the router / factory / vault so those storage
 * slots exist locally (the public RPC prunes old fork state after ~10 minutes; a UI approve to a never-touched slot would fail).
 * Local node only: refuses any RPC that is not 127.0.0.1 / localhost.
 */
import { readFileSync } from "node:fs";
import {
  ACCOUNT3,
  RPC,
  USDG,
  USDG_HOLDER,
  WIF,
  WIF_HOLDER,
  approveFrom3,
  balanceOf,
  fundFrom,
  fundFrom0,
} from "../src/app/b/[address]/__e2e__/fund.ts";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(RPC)) throw new Error(`refusing to run against a non-local RPC: ${RPC}`);

const id = process.env.DEPLOYMENT ?? "rehearsal";
const dep = JSON.parse(readFileSync(new URL(`../../shared/deployments/${id}.json`, import.meta.url), "utf8")) as {
  addresses: Record<string, string>;
};
const { FlatpackRouter, BasketFactory, BackingVault } = dep.addresses;

const USDG_AMOUNT = 5_000n * 10n ** 6n;
const WIF_AMOUNT = 3_000n * 10n ** 18n;

async function fund(token: string, holder: string, amount: bigint, label: string): Promise<void> {
  try {
    await fundFrom(token, holder, ACCOUNT3, amount);
  } catch (e) {
    console.log(`  ${label}: pool-holder funding failed (${(e as Error).message}); falling back to account #0's leftovers`);
    await fundFrom0(token, ACCOUNT3, amount / 5n);
  }
}

await fund(USDG, USDG_HOLDER, USDG_AMOUNT, "USDG");
await fund(WIF, WIF_HOLDER, WIF_AMOUNT, "WIF");
await approveFrom3(USDG, FlatpackRouter, 1n);
await approveFrom3(WIF, BasketFactory, 1n);
await approveFrom3(WIF, BackingVault, 1n);

const usdg = await balanceOf(USDG, ACCOUNT3);
const wif = await balanceOf(WIF, ACCOUNT3);
console.log(`Mock wallet ${ACCOUNT3}`);
console.log(`  USDG: ${Number(usdg) / 1e6}`);
console.log(`  $WIF: ${Number(wif / 10n ** 15n) / 1000}`);
