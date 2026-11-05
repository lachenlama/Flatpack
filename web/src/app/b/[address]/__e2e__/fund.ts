/** Test-only helpers for the WP5b e2e scripts (local rehearsal node only). Dependency-free: raw JSON-RPC. */
export const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
export const ACCOUNT3 = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const WIF = "0x5173b8eA6923c2d40267890D45C46a3480954773";
export const WIF_HOLDER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"; // v4 PoolManager
export const USDG_HOLDER = "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca"; // USDG/WETH v3 pool

export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}

const pad = (h: string): string => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");

export async function balanceOf(token: string, who: string): Promise<bigint> {
  return BigInt(await rpc<string>("eth_call", [{ to: token, data: `0x70a08231${pad(who)}` }, "latest"]));
}
export async function allowance(token: string, owner: string, spender: string): Promise<bigint> {
  return BigInt(await rpc<string>("eth_call", [{ to: token, data: `0xdd62ed3e${pad(owner)}${pad(spender)}` }, "latest"]));
}

async function waitReceipt(hash: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const r = await rpc<{ status: string } | null>("eth_getTransactionReceipt", [hash]);
    if (r) {
      if (r.status !== "0x1") throw new Error(`tx ${hash} reverted`);
      return;
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`tx ${hash} not mined`);
}

/** Sends an unlocked-account transaction on the local node. */
export async function send(from: string, to: string, data: string): Promise<void> {
  await waitReceipt(await rpc<string>("eth_sendTransaction", [{ from, to, data, gas: "0x30d40" }]));
}

/** Moves `amount` of `token` from `holder` (impersonated, gas ETH set) to `to`. Local hardhat node only. */
export async function fundFrom(token: string, holder: string, to: string, amount: bigint): Promise<void> {
  await rpc("hardhat_setBalance", [holder, "0x56BC75E2D63100000"]);
  await rpc("hardhat_impersonateAccount", [holder]);
  try {
    await send(holder, token, `0xa9059cbb${pad(to)}${amount.toString(16).padStart(64, "0")}`);
  } finally {
    await rpc("hardhat_stopImpersonatingAccount", [holder]);
  }
}

/** approve(spender, amount) from account #3 (used to reset allowances). */
export const approveFrom3 = (token: string, spender: string, amount: bigint): Promise<void> =>
  send(ACCOUNT3, token, `0x095ea7b3${pad(spender)}${amount.toString(16).padStart(64, "0")}`);

/** Hardhat account #0 (holds the rehearsal's leftover USDG/WIF; its state is local to the fork, so it works after the upstream RPC pruned old state). */
export const ACCOUNT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
/** Funds `to` from account #0 (unlocked on the local node). */
export async function fundFrom0(token: string, to: string, amount: bigint): Promise<void> {
  await send(ACCOUNT0, token, `0xa9059cbb${pad(to)}${amount.toString(16).padStart(64, "0")}`);
}
