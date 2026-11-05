/**
 * UI click-through (WINDOWS Node 24 + headless Edge, see web/e2e/README.md). App built with NEXT_PUBLIC_E2E=1 against the rehearsal node.
 * connect -> 1 share -> (1) Approve USDG -> (2) Buy -> success toast + position card; then back with WIF -> warm-up message.
 *   APP_URL=http://localhost:3000 RPC_URL=http://127.0.0.1:8545 CDP_PORT=9333 node ui-e2e.ts
 */
import { launchBrowser, rpc as nodeRpc } from "../../../../../e2e/cdp.ts";
import { readFileSync } from "node:fs";
import { ACCOUNT3, USDG, WIF, allowance, approveFrom3, balanceOf, RPC } from "./fund.ts";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const fail = (m: string): never => {
  throw new Error(`UI E2E FAIL: ${m}`);
};

const list = (await (await fetch(`${APP}/api/baskets`)).json()) as { baskets: { address: string; name: string }[] };
const basket = process.env.BASKET ?? list.baskets[0]?.address ?? fail("no basket");

// funding is done by buy-e2e.ts (run it first, right after the rehearsal)
if ((await balanceOf(USDG, ACCOUNT3)) < 100n * 10n ** 6n || (await balanceOf(WIF, ACCOUNT3)) < 200n * 10n ** 18n) fail("run buy-e2e.ts first: it funds account #3 and warms the fork state");
const router = (await (await fetch(`${APP}/e2e`)).text()).match(/data-testid="e2e-spender">(0x[0-9a-fA-F]{40})/)?.[1] ?? fail("router address (is the app built with NEXT_PUBLIC_E2E=1?)");
const vault = (JSON.parse(readFileSync(new URL("../../../../../../shared/deployments/rehearsal.json", import.meta.url), "utf8")) as { addresses: { BackingVault: string } }).addresses.BackingVault;
await approveFrom3(USDG, router, 0n);
await approveFrom3(WIF, vault, 0n);

const sharesOf = async (): Promise<bigint> =>
  BigInt(await nodeRpc<string>(RPC, "eth_call", [{ to: basket, data: `0x70a08231${ACCOUNT3.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"]));

// card titles are rendered upper-case by CSS (innerText follows it), so compare case-insensitively
const has = (p: { waitFor(e: string, ms?: number, l?: string): Promise<void> }, s: string): Promise<void> =>
  p.waitFor(`document.body.innerText.toLowerCase().includes(${JSON.stringify(s.toLowerCase())})`, 30_000, `text "${s}"`);

const browser = await launchBrowser({ port: Number(process.env.CDP_PORT ?? 9333) });
try {
  // explore page (state: list)
  const ex = await browser.newPage(`${APP}/explore`);
  await has(ex, "Baskets ranked by performance versus SPY");
  await ex.screenshot(process.env.E2E_SHOT_DIR ? `${process.env.E2E_SHOT_DIR}/explore.png` : "explore.png");
  console.log("explore ok");

  const page = await browser.newPage(`${APP}/b/${basket}`);
  await has(page, "NAV vs SPY (indexed to 100)");
  await has(page, "Holdings (per share)");
  await has(page, "Connect your wallet to see your shares");
  console.log("basket page rendered, disconnected position copy shown");

  // connect
  await page.clickText("button", "Connect");
  await page.clickText("dialog button", "Mock Connector");
  await page.waitFor(`document.querySelector('[data-testid="position-shares"]')`);
  console.log("connected");
  // first connect shows the attestation modal (WP5a): accept it like a user would
  await page.waitFor(`document.querySelector('dialog[open] input[type="checkbox"]')`, 10_000, "attestation modal");
  await page.click('dialog[open] input[type="checkbox"]');
  await page.clickText("dialog[open] button", "Continue");
  console.log("attestation accepted");

  const heldBefore = await sharesOf();

  // enter 1 share, wait for the decoded quote
  await page.type("#buy-shares", "1");
  await page.waitFor(`document.querySelector('[data-testid="buy-quote"]').innerText.includes("USDG")`, 30_000, "quote shown");
  console.log("quote:", await page.eval<string>(`document.querySelector('[data-testid="buy-quote"]').innerText.split(/[\s]+/).join(" ")`));

  // (1) approve + (2) buy from one click
  await page.clickText("button", "Approve and buy");
  await page.waitForText("Approve USDG confirmed", 60_000);
  console.log("step 1: Approve USDG confirmed");
  await page.waitForText("Buy confirmed", 60_000);
  console.log("step 2: Buy confirmed");

  // position card
  const heldAfter = await sharesOf();
  const gained = heldAfter - heldBefore;
  if (gained !== 997_000_000_000_000_000n) fail(`expected +0.997 shares on chain, got ${gained}`);
  await page.waitFor(`/^[0-9.,]*[1-9]/.test(document.querySelector('[data-testid="position-shares"]').innerText)`, 30_000, "position shows shares");
  const shown = await page.eval<string>(`document.querySelector('[data-testid="position-shares"]').innerText.split(/[\s]+/).join(" ")`);
  console.log("position card:", shown, "| on-chain delta:", gained);
  if ((await allowance(USDG, ACCOUNT3, router)) > 10n ** 6n) console.log("note: residual USDG allowance", await allowance(USDG, ACCOUNT3, router));
  await page.screenshot(process.env.E2E_SHOT_DIR ? `${process.env.E2E_SHOT_DIR}/basket-after-buy.png` : "basket-after-buy.png");

  // back with WIF -> warm-up
  await page.type("#stake-wif", "100");
  await page.clickText("button", "Approve and back with $WIF");
  await page.waitForText("Approve WIF confirmed", 60_000);
  await page.waitForText("Backing confirmed", 60_000);
  await page.waitForText("Earning from next settle", 30_000);
  const warm = await page.eval<string>(`document.querySelector('[data-testid="warmup-msg"]').innerText.split(/[\s]+/).join(" ")`);
  console.log("warm-up message:", warm);
  if ((await balanceOf(WIF, ACCOUNT3)) !== 400n * 10n ** 18n) console.log("note: WIF balance", await balanceOf(WIF, ACCOUNT3));
  await page.screenshot(process.env.E2E_SHOT_DIR ? `${process.env.E2E_SHOT_DIR}/basket-after-back.png` : "basket-after-back.png");

  // chart toggle: hypothetical label
  await page.clickText("button", "30d recipe");
  await page.waitForText("Hypothetical");
  console.log("recipe toggle shows the hypothetical note");

  const errs = page.logs.filter((l) => /error|exception/i.test(l));
  if (errs.length) console.log("page logs with errors:", errs.slice(0, 5));
  console.log("UI E2E PASS");
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exitCode = 1;
} finally {
  await browser.close();
}
