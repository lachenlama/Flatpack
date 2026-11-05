/**
 * UI click-through (REQUIRED by WP5c), headless Edge via web/e2e/cdp.ts, run with WINDOWS Node 24:
 *   node ui-e2e.ts      (APP_URL default http://localhost:3001, CDP_PORT default 9223)
 * Preconditions: app built with NEXT_PUBLIC_E2E=1 against the 8547 rehearsal; create-basket.ts and setup-claims.ts already run
 * (mock wallet #3 funded with WIF and a referral cycle closed for it).
 * Flow: /assemble: connect mock wallet, pick 3 tokens, even weights, name, symbol, Approve WIF + Publish, assert redirect to /b/<new>;
 * then client-side nav to /me: claim cards render and one claim (referral $WIF) succeeds with a toast.
 */
import { launchBrowser, sleep } from "../../../../e2e/cdp.ts";

const APP = process.env.APP_URL ?? "http://localhost:3001";
const SHOT = process.env.E2E_SHOT_DIR ?? ".";
const ACCOUNT = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const fail = (m: string): never => {
  throw new Error(`UI E2E FAIL: ${m}`);
};

const browser = await launchBrowser({ port: Number(process.env.CDP_PORT ?? 9223) });
let page: Awaited<ReturnType<typeof browser.newPage>> | undefined;
try {
  page = await browser.newPage(`${APP}/assemble`);

  await page.waitForText("Assemble a basket");
  await page.clickText("button", "Connect");
  await page.clickText("dialog button", "Mock Connector");
  await page.waitForText("Your balance:", 30_000);
  console.log("1. connected mock wallet #3 (balance shown)");

  for (const t of ["NVDA", "MSFT", "GOOGL"]) await page.click(`button[data-ticker="${t}"]`);
  await page.waitForText("Weights total 100%");
  console.log("2. picked NVDA, MSFT, GOOGL; weights total 100%");

  await page.type("#b-name", "Click Through Three");
  await page.type("#b-symbol", "CLK3");
  await page.waitForText("Hypothetical", 120_000);
  console.log("3. named it; hypothetical 30-day preview rendered");
  await page.screenshot(`${SHOT}/assemble.png`);

  await page.eval(`(() => { window.__seen = new Set(); new MutationObserver(() => { const t = document.body.innerText; for (const k of ["Approve WIF confirmed","Basket published","Transaction not sent","Referral $WIF claimed"]) if (t.includes(k)) window.__seen.add(k); }).observe(document.body, { childList: true, subtree: true, characterData: true }); })()`);
  await page.clickText("button", "Approve and publish");
  await page.waitFor(`window.__seen.has("Basket published") || window.__seen.has("Transaction not sent") || document.querySelector('[role=alert]')`, 120_000, "publish result");
  const alert = await page.eval<string>(`[...document.querySelectorAll('[role=alert]')].map(e => e.innerText).join(' / ')`);
  if (alert) fail(`publish error shown: ${alert}`);
  console.log("4/5. toasts seen:", await page.eval<string>(`[...window.__seen].join(", ")`));
  if (!(await page.eval<boolean>(`window.__seen.has("Approve WIF confirmed")`))) console.log("   (approve step was skipped: allowance already sufficient)");
  await page.waitFor(`location.pathname.startsWith("/b/")`, 30_000, "redirect to /b/<new>");
  const dest = await page.eval<string>("location.pathname");
  console.log("6. redirected to", dest);
  if (!/^\/b\/0x[0-9a-fA-F]{40}$/.test(dest)) fail(`unexpected destination ${dest}`);
  await page.screenshot(`${SHOT}/after-publish.png`);

  // /me via client-side navigation (keeps the mock connection)
  await page.clickText("a", "My portfolio");
  await page.waitFor(`document.querySelector('[data-testid="claim-cards"]')`, 60_000, "claim cards");
  await page.waitFor(`document.body.innerText.toLowerCase().includes("referral $wif")`);
  const txt = await page.text();
  for (const k of ["$WIF dividends", "Backing rewards", "Curator rewards", "Referral $WIF", "IOUs"]) if (!txt.toLowerCase().includes(k.toLowerCase())) fail(`card missing: ${k}`);
  console.log("7. /me: all 5 claim cards rendered");
  await page.screenshot(`${SHOT}/me.png`);

  await page.clickText('[data-testid="claim-referral"] button', "Claim Referral");
  await page.waitForText("Referral $WIF claimed", 90_000);
  console.log("8. toast: Referral $WIF claimed");
  await page.waitFor(`document.querySelector('[data-testid="claim-referral"]').innerText.includes("Nothing to claim")`, 30_000, "referral card refreshed");
  console.log("9. referral card now shows nothing to claim");
  await sleep(300);
  console.log(`UI E2E PASS (account ${ACCOUNT}, new basket ${dest})`);
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  if (page) console.error("page logs:", page.logs.slice(-10).join(" | "));
  process.exitCode = 1;
} finally {
  await browser.close();
}
