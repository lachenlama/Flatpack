/**
 * Write-path e2e: headless browser -> mock wallet (Hardhat #3) -> TxButton two-step (approve USDG exactly, then basket.sync())
 * on the local rehearsal node. Needs: node on RPC_URL, app built with NEXT_PUBLIC_E2E=1 and running at APP_URL.
 *   node e2e/tx-e2e.ts            (APP_URL default http://localhost:3000, RPC_URL default http://127.0.0.1:8545)
 */
import { launchBrowser, rpc, sleep } from "./cdp.ts";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const AMOUNT = 1_234_567n; // keep in sync with src/app/e2e/E2EPanel.tsx
const ACCOUNT = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const pad = (h: string): string => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const fail = (m: string): never => {
  throw new Error(`E2E FAIL: ${m}`);
};

const browser = await launchBrowser();
try {
  const page = await browser.newPage(`${APP}/e2e`);
  const spender = await page.eval<string>(`document.querySelector('[data-testid="e2e-spender"]').textContent`);
  const basket = await page.eval<string>(`document.querySelector('[data-testid="e2e-basket"]').textContent`);
  console.log("page ok; basket", basket, "spender", spender);

  const before = BigInt(await rpc<string>(RPC, "eth_blockNumber"));
  await page.waitForText("disconnected");
  await page.clickText("button", "Connect");
  await page.clickText("dialog button", "Mock Connector");
  await page.waitForText(`connected:${ACCOUNT}`);
  console.log("connected via mock wallet");

  await page.clickText("button", "Approve and sync");
  await page.waitForText("Approve USDG confirmed", 60_000);
  console.log("step 1 toast: Approve USDG confirmed");
  await page.waitForText("Sync basket confirmed", 60_000);
  console.log("step 2 toast: Sync basket confirmed");
  await page.screenshot(process.env.E2E_SHOT ?? "e2e-tx.png");

  // on-chain assertions
  const allowanceHex = await rpc<string>(RPC, "eth_call", [
    { to: USDG, data: `0xdd62ed3e${pad(ACCOUNT)}${pad(spender)}` },
    "latest",
  ]);
  const allowance = BigInt(allowanceHex);
  if (allowance !== AMOUNT) fail(`allowance ${allowance} != exact ${AMOUNT}`);
  console.log("allowance(account -> router) =", allowance.toString(), "(exact)");

  await sleep(500);
  const after = BigInt(await rpc<string>(RPC, "eth_blockNumber"));
  let found = 0;
  for (let n = before + 1n; n <= after; n++) {
    const blk = await rpc<{ transactions: { hash: string; from: string; to: string }[] }>(RPC, "eth_getBlockByNumber", [`0x${n.toString(16)}`, true]);
    for (const tx of blk.transactions) {
      if (tx.from.toLowerCase() !== ACCOUNT.toLowerCase()) continue;
      const rc = await rpc<{ status: string }>(RPC, "eth_getTransactionReceipt", [tx.hash]);
      console.log(`receipt ${tx.hash} to=${tx.to} status=${rc.status}`);
      if (rc.status !== "0x1") fail(`tx ${tx.hash} failed`);
      found++;
    }
  }
  if (found < 1) fail("no transactions from the mock account found on the node");
  console.log(`E2E PASS (${found} confirmed transaction(s) from ${ACCOUNT})`);
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exitCode = 1;
} finally {
  await browser.close();
}
