/**
 * Rehearsal steps (WP4c). Usage: node scripts/rehearsal/steps.ts <step> [args]
 *   fund                  give owner (#0) WIF (from the v4 PoolManager) and USDG (from the USDG/WETH v3 pool)
 *   buy [usdgPerBasket]   buy shares in every basket through the router (referrer = #2 on the 2nd basket)
 *   snapshot <name>       record harvest-relevant balances into the state file
 *   assert-harvest        compare against snapshot "pre"; checks the keeper's harvestFees effects
 *   warp                  evm_increaseTime past the latest nextSettleAt, mine a block
 *   assert-settle         checks EpochSettled / lastSettledAt advanced since snapshot "pre_settle"
 *   bump-dividend [bps]   raise AAPL.uiMultiplier by bps (default 10 = 0.1%) via hardhat_setStorageAt
 *   assert-dividend       checks harvestDividends effects on the PayInWif basket
 *   gas <logfile...>      gas used per keeper tx found in keeper JSON logs
 */
import { readFileSync } from "node:fs";
import { encodeFunctionData, parseEventLogs, type Abi, type Hex } from "viem";
import {
  backingVaultAbi,
  basketAbi,
  basketFactoryAbi,
  feeHarvesterAbi,
  flatpackRouterAbi,
  scaledUiAmountAbi,
} from "../../../shared/abi/index.ts";
import { quoteBuy, type DemoPublicClient } from "../lib/demo.ts";
import {
  DEAD,
  big,
  balanceOf,
  check,
  erc20Abi,
  finish,
  fmt,
  fundFrom,
  loadDeployment,
  loadState,
  networkConfig,
  owner,
  publicClient,
  referrer,
  rpc,
  saveState,
  walletFor,
  type Address,
} from "./lib.ts";

const dep = loadDeployment();
const A = dep.addresses as Record<string, Address>;
const WIF = networkConfig.tokens.WIF.address;
const USDG = networkConfig.tokens.USDG.address;
const ZERO = "0x0000000000000000000000000000000000000000";
const read = (address: Address, abi: Abi, functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args }) as Promise<any>;

async function baskets(): Promise<Address[]> {
  const n = (await read(A.BasketFactory!, basketFactoryAbi as Abi, "basketCount")) as bigint;
  const out: Address[] = [];
  for (let i = 0n; i < n; i++) out.push(await read(A.BasketFactory!, basketFactoryAbi as Abi, "basketAt", [i]));
  return out;
}

async function stateOf(basket: Address) {
  const vs = await read(A.BackingVault!, backingVaultAbi as Abi, "basketState", [basket]);
  return {
    basket,
    pendingFeeShares: (await read(A.FeeHarvester!, feeHarvesterAbi as Abi, "pendingFeeShares", [basket])) as bigint,
    cycle: (await read(A.FeeHarvester!, feeHarvesterAbi as Abi, "currentCycle", [basket])) as bigint,
    queuedBackers: vs.queuedBackers as bigint,
    queuedCurator: vs.queuedCurator as bigint,
    lastSettledAt: BigInt(vs.lastSettledAt),
    settleCount: BigInt(vs.settleCount),
    nextSettleAt: BigInt(await read(A.BackingVault!, backingVaultAbi as Abi, "nextSettleAt", [basket])),
  };
}

async function snapshot() {
  const list = await baskets();
  return {
    block: await publicClient.getBlockNumber(),
    timestamp: (await publicClient.getBlock()).timestamp,
    dead: await balanceOf(WIF, DEAD),
    harvesterWif: await balanceOf(WIF, A.FeeHarvester!),
    vaultWif: await balanceOf(WIF, A.BackingVault!),
    baskets: await Promise.all(list.map(stateOf)),
  };
}

const steps: Record<string, (args: string[]) => Promise<void>> = {
  async fund() {
    const h1 = await fundFrom(WIF, networkConfig.uniswap.v4PoolManager, owner.address, 3000n * 10n ** 18n);
    const usdgHolder = networkConfig.uniswap.usdgWethPool.address;
    const h2 = await fundFrom(USDG, usdgHolder, owner.address, 5000n * 10n ** 6n);
    console.log(`funded #0 with 3000 WIF (tx ${h1}) and 5000 USDG (tx ${h2})`);
    console.log(`#0 WIF=${fmt(await balanceOf(WIF, owner.address))} USDG=${fmt(await balanceOf(USDG, owner.address), 6)}`);
  },

  async buy(args) {
    const budget = BigInt(Math.round(Number(args[0] ?? "1000") * 1e6)); // USDG per basket, 6 decimals
    const list = await baskets();
    const w = walletFor(owner);
    const bought: Record<string, unknown>[] = [];
    for (const [i, basket] of list.entries()) {
      const shareUsd18 = 100n * 10n ** 18n; // demo-baskets.json: $100 per share
      const shares = (budget * 10n ** 12n * 10n ** 18n * 95n) / (shareUsd18 * 100n);
      const quote = await quoteBuy(publicClient as unknown as DemoPublicClient, A.FlatpackRouter!, basket, shares);
      const maxIn = (quote * 101n) / 100n;
      const ref = i === 1 ? referrer.address : ZERO;
      const ap = await w.writeContract({ address: USDG, abi: erc20Abi, functionName: "approve", args: [A.FlatpackRouter!, maxIn] });
      await publicClient.waitForTransactionReceipt({ hash: ap });
      const deadline = (await publicClient.getBlock()).timestamp + 600n;
      const tx = await w.writeContract({
        address: A.FlatpackRouter!,
        abi: flatpackRouterAbi,
        functionName: "buy",
        args: [{ basket, shares, maxUsdgIn: maxIn, receiver: owner.address, referrer: ref as Address, deadline }],
      });
      const r = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (r.status !== "success") throw new Error(`buy reverted ${tx}`);
      const ev = parseEventLogs({ abi: flatpackRouterAbi, logs: r.logs, eventName: "Bought" })[0];
      const feeShares = await read(A.FeeHarvester!, feeHarvesterAbi as Abi, "pendingFeeShares", [basket]);
      const row = {
        basket,
        referrer: ref,
        shares,
        quoteUsdg: quote,
        usdgSpent: ev?.args.usdgSpent,
        sharesOut: ev?.args.sharesOut,
        pendingFeeShares: feeShares,
        tx,
        gas: r.gasUsed,
      };
      bought.push(row);
      console.log(JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    }
    saveState({ baskets: list, bought });
  },

  async snapshot(args) {
    const name = args[0] ?? "pre";
    const s = await snapshot();
    saveState({ [`snap_${name}`]: s });
    console.log(`snapshot "${name}": block ${s.block}, DEAD WIF ${fmt(s.dead)}, harvester WIF ${fmt(s.harvesterWif)}`);
    for (const b of s.baskets) {
      console.log(
        `  ${b.basket} pendingFeeShares=${b.pendingFeeShares} cycle=${b.cycle} queued(backers=${b.queuedBackers}, curator=${b.queuedCurator}) next=${b.nextSettleAt} last=${b.lastSettledAt}`,
      );
    }
  },

  async "assert-harvest"() {
    const st = loadState();
    const pre = st.snap_pre;
    const post = await snapshot();
    const list = await baskets();
    const logs = await publicClient.getLogs({ address: A.FeeHarvester!, fromBlock: big(pre.block) + 1n, toBlock: "latest" });
    const harvested = parseEventLogs({ abi: feeHarvesterAbi, logs, eventName: "FeesHarvested" });
    let burnSum = 0n;
    let wifSum = 0n;
    for (const [i, basket] of list.entries()) {
      const p = post.baskets[i]!;
      const b0 = pre.baskets[i];
      const ev = harvested.find((e) => e.args.basket.toLowerCase() === basket.toLowerCase());
      check(`[${i}] FeesHarvested emitted`, ev !== undefined);
      if (!ev) continue;
      const { wifOut, burned, toReferrers, toVaultBackers, toVaultCurator, cycle } = ev.args;
      burnSum += burned;
      wifSum += wifOut;
      console.log(
        `  basket ${basket}: wifOut=${fmt(wifOut)} burned=${fmt(burned)} toReferrers=${fmt(toReferrers)} backers=${fmt(toVaultBackers)} curator=${fmt(toVaultCurator)} (cycle ${cycle})`,
      );
      check(`[${i}] harvester pendingFeeShares == 0`, p.pendingFeeShares === 0n, `was ${b0.pendingFeeShares}`);
      check(`[${i}] cycle advanced`, p.cycle === big(b0.cycle) + 1n);
      check(
        `[${i}] vault queued rewards == backers+curator`,
        p.queuedBackers - big(b0.queuedBackers) === toVaultBackers && p.queuedCurator - big(b0.queuedCurator) === toVaultCurator,
        `dBackers=${p.queuedBackers - big(b0.queuedBackers)} dCurator=${p.queuedCurator - big(b0.queuedCurator)}`,
      );
      check(`[${i}] split sums to wifOut`, burned + toReferrers + toVaultBackers + toVaultCurator === wifOut);
      const info = await read(A.FeeHarvester!, feeHarvesterAbi as Abi, "cycleInfo", [basket, cycle]);
      const bought = (st.bought as any[])[i];
      const expectReferral = bought !== undefined && bought.referrer !== ZERO;
      check(
        `[${i}] referral WIF reserved for closed cycle (${expectReferral ? ">0" : "0"} expected)`,
        expectReferral ? info[2] > 0n && info[2] === toReferrers : info[2] === 0n,
        `cycleInfo=${info.map(String).join(",")}`,
      );
      if (expectReferral) {
        const r = await read(A.FeeHarvester!, feeHarvesterAbi as Abi, "referralOf", [basket, cycle, referrer.address]);
        check(`[${i}] referrer #2 claimable == reserved`, r[1] === info[2] && r[1] > 0n, `claimableWif=${fmt(r[1])}`);
      }
    }
    check("0x..dEaD WIF balance increased by exactly the burned sum", post.dead - big(pre.dead) === burnSum && burnSum > 0n, `+${fmt(post.dead - big(pre.dead))} WIF`);
    console.log(`TOTAL wifOut=${fmt(wifSum)} burned=${fmt(burnSum)}; harvester WIF now ${fmt(post.harvesterWif)} (reserved referral WIF)`);
    finish();
  },

  async warp() {
    const list = await baskets();
    const nexts = await Promise.all(list.map((b) => stateOf(b).then((s) => s.nextSettleAt)));
    const latestNext = nexts.reduce((a, b) => (a > b ? a : b));
    const target = latestNext + 60n;
    const now = (await publicClient.getBlock()).timestamp;
    const delta = target > now ? target - now : 0n;
    await rpc("evm_increaseTime", [Number(delta)]);
    await rpc("evm_mine", []);
    const after = (await publicClient.getBlock()).timestamp;
    console.log(`warped +${delta}s (${(Number(delta) / 3600).toFixed(1)} h); block ts ${after}, latest nextSettleAt ${latestNext}`);
  },

  async "assert-settle"() {
    const st = loadState();
    const pre = st.snap_pre_settle;
    const post = await snapshot();
    const logs = await publicClient.getLogs({ address: A.BackingVault!, fromBlock: big(pre.block) + 1n, toBlock: "latest" });
    const settled = parseEventLogs({ abi: backingVaultAbi, logs, eventName: "EpochSettled" });
    for (const [i, p] of post.baskets.entries()) {
      const b0 = pre.baskets[i];
      const ev = settled.find((e) => e.args.basket.toLowerCase() === p.basket.toLowerCase());
      check(`[${i}] EpochSettled emitted`, ev !== undefined);
      check(`[${i}] lastSettledAt advanced`, p.lastSettledAt > big(b0.lastSettledAt), `${b0.lastSettledAt} -> ${p.lastSettledAt}`);
      check(`[${i}] settleCount +1`, p.settleCount === big(b0.settleCount) + 1n);
      if (ev) {
        const a = ev.args;
        console.log(
          `  outcome: beat=${a.beat} navLast=${a.navLast} navNow=${a.navNow} benchLast=${a.benchLast} benchNow=${a.benchNow} releasedBackers=${fmt(a.releasedBackers)} releasedCurator=${fmt(a.releasedCurator)} burned=${fmt(a.burned)} => ${a.burned > 0n ? "BURN" : "RELEASE"}`,
        );
      }
    }
    console.log(`DEAD WIF delta over settle: ${fmt(post.dead - big(pre.dead))}`);
    finish();
  },

  async "bump-dividend"(args) {
    const bps = BigInt(args[0] ?? "10");
    const aapl = (networkConfig.launchUniverse.AAPL as { token: Address }).token;
    await rpc("evm_mine", []);
    const cur = (await read(aapl, scaledUiAmountAbi as Abi, "uiMultiplier")) as bigint;
    console.log(`AAPL ${aapl} uiMultiplier() = ${cur}`);
    // The stock tokens are beacon proxies whose implementation keeps the multiplier in an ERC-7201 namespaced struct.
    // eth_createAccessList is not supported by EDR, so: collect every PUSH32 constant of the proxy and of the
    // implementation (the namespace base slots are among them) and scan base..base+3 for the multiplier value.
    const codeConsts = (code: string): string[] => [...code.slice(2).matchAll(/7f([0-9a-f]{64})/g)].map((m) => m[1]!);
    const proxyCode = await rpc<string>("eth_getCode", [aapl, "latest"]);
    const bases = new Set<string>(codeConsts(proxyCode));
    let impl = "0x" + (await rpc<string>("eth_getStorageAt", [aapl, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", "latest"])).slice(26);
    if (BigInt(impl) === 0n) {
      // beacon proxy: the beacon address is an immutable embedded as PUSH32
      for (const c of codeConsts(proxyCode)) {
        if (BigInt("0x" + c) >> 160n !== 0n) continue;
        const r = await rpc<string>("eth_call", [{ to: "0x" + c.slice(24), data: "0x5c60da1b" }, "latest"]).catch(() => "0x");
        if (r.length >= 66) impl = "0x" + r.slice(26);
      }
    }
    if (BigInt(impl) !== 0n) codeConsts(await rpc<string>("eth_getCode", [impl, "latest"])).forEach((c) => bases.add(c));
    console.log(`implementation ${impl}; ${bases.size} candidate namespace constants`);
    const slots: Hex[] = [];
    for (let i = 0; i < 8; i++) slots.push(("0x" + i.toString(16).padStart(64, "0")) as Hex);
    for (const b of bases) {
      const base = BigInt("0x" + b);
      for (let o = 0n; o < 4n; o++) slots.push(("0x" + ((base + o) & ((1n << 256n) - 1n)).toString(16).padStart(64, "0")) as Hex);
    }
    const raws = new Map<Hex, bigint>();
    for (let i = 0; i < slots.length; i += 24) {
      await Promise.all(
        slots.slice(i, i + 24).map(async (s) => raws.set(s, BigInt(await rpc<string>("eth_getStorageAt", [aapl, s, "latest"])))),
      );
    }
    const target = (cur * (10000n + bps)) / 10000n;
    const hex = (v: bigint) => ("0x" + v.toString(16).padStart(64, "0")) as Hex;
    const full = (1n << 256n) - 1n;
    const lo128 = (1n << 128n) - 1n;
    let found: Hex | undefined;
    for (const slot of slots) {
      const raw = raws.get(slot) ?? 0n;
      if (raw === 0n) continue;
      const mask = raw === cur ? full : (raw & lo128) === cur ? lo128 : undefined; // maybe packed with other fields
      if (mask === undefined) continue;
      await rpc("hardhat_setStorageAt", [aapl, slot, hex((raw & ~mask) | target)]);
      const now = (await read(aapl, scaledUiAmountAbi as Abi, "uiMultiplier")) as bigint;
      if (now === target) {
        found = slot;
        console.log(`uiMultiplier storage slot = ${slot} (mask 0x${mask.toString(16)}); ${cur} -> ${now}`);
        break;
      }
      await rpc("hardhat_setStorageAt", [aapl, slot, hex(raw)]); // not the one the getter reads: restore
    }
    check("found the uiMultiplier storage slot and bumped it", found !== undefined);
    saveState({ dividendSlot: found ?? null, aaplBefore: cur, aaplAfter: target });
    finish();
  },

  async "assert-dividend"() {
    const st = loadState();
    const list = await baskets();
    const div = list[1]!;
    const aapl = (networkConfig.launchUniverse.AAPL as { token: Address }).token;
    const pend = (await read(A.FeeHarvester!, feeHarvesterAbi as Abi, "pendingDividend", [div, aapl])) as bigint;
    const holder = (await read(div, basketAbi as Abi, "pendingWifDividend", [owner.address])) as bigint;
    const lastM = ((await read(div, basketAbi as Abi, "lastMultipliers")) as bigint[]).map(String);
    const logs = await publicClient.getLogs({ address: A.FeeHarvester!, fromBlock: big(st.snap_pre_dividend.block) + 1n, toBlock: "latest" });
    const hv = parseEventLogs({ abi: feeHarvesterAbi, logs, eventName: "DividendsHarvested" });
    console.log(`  DividendsHarvested events: ${hv.map((e) => `${e.args.basket}:${fmt(e.args.wifOut)}`).join(", ") || "(none)"}`);
    check("DividendsHarvested emitted for the PayInWif basket", hv.some((e) => e.args.basket.toLowerCase() === div.toLowerCase()));
    check("harvester pendingDividend(AAPL) == 0 after harvestDividends", pend === 0n);
    check("basket lastMultipliers synced to the bumped value", lastM.includes(String(big(st.aaplAfter))), lastM.join(","));
    check("holder #0 pendingWifDividend > 0", holder > 0n, `${fmt(holder)} WIF`);
    finish();
  },

  async gas(args) {
    for (const f of args) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        if (!line.startsWith("{")) continue;
        const j = JSON.parse(line) as { action?: string; basket?: string; txHash?: Hex; wifOut?: string };
        if (!j.txHash || !j.action) continue;
        const r = await publicClient.getTransactionReceipt({ hash: j.txHash });
        console.log(`GAS ${j.action.padEnd(17)} ${j.basket} gas=${r.gasUsed} wifOut=${j.wifOut ?? "-"} tx=${j.txHash}`);
      }
    }
  },
};

const [step, ...rest] = process.argv.slice(2);
const fn = step ? steps[step] : undefined;
if (!fn) {
  console.error(`unknown step "${step}". Steps: ${Object.keys(steps).join(", ")}`);
  process.exit(2);
}
await fn(rest);
