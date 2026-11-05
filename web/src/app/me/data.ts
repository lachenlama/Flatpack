import { isAddress, getAddress, type Address } from "viem";
import { backingVaultAbi, basketAbi, feeHarvesterAbi } from "../../../../shared/abi/index.ts";
import { getPublicClient } from "../../lib/chain.ts";
import { getDeployment } from "../../lib/deployment.ts";
import { batch, ok } from "../../lib/reads/multicall.ts";
import { listBaskets } from "../../lib/reads/baskets.ts";
import { closedCycles, selectClaimableCycles, type CycleReading } from "./referral.ts";

/** A basket position. All bigint values are decimal strings (this object crosses the server/client boundary as JSON). */
export interface PositionDto {
  basket: Address;
  name: string;
  symbol: string;
  mode: "Reinvest" | "PayInWif";
  shares: string;
  valueUsd: number;
  beatPts: number | null;
  /** $WIF the account has backing this basket (active + warming). */
  backed: string;
}

/** One claimable line. `amount` is 18-decimal raw units of `ticker` ("WIF" for rewards). */
export interface ClaimDto {
  basket: Address;
  name: string;
  amount: string;
  /** IOU only. */
  token?: Address;
  ticker: string;
  /** Referral only: the closed cycles to claim. */
  cycles?: number[];
}

/** Everything /me shows for one account. */
export interface PortfolioDto {
  account: Address;
  positions: PositionDto[];
  claims: { dividends: ClaimDto[]; backing: ClaimDto[]; curator: ClaimDto[]; referral: ClaimDto[]; ious: ClaimDto[] };
}

type PositionTuple = { active: bigint; warming: bigint; claimable: bigint };
type StateTuple = { curator: Address; curatorClaimable: bigint };

/** Parses `?address=`; undefined when absent or invalid. */
export function parseAccount(v: string | null | undefined): Address | undefined {
  return v && isAddress(v) ? getAddress(v) : undefined;
}

/** Reads an account's positions and every claimable source across all baskets (3 multicall round trips). */
export async function loadPortfolio(account: Address): Promise<PortfolioDto> {
  const { BackingVault: vault, FeeHarvester: harvester } = getDeployment().addresses;
  const client = getPublicClient();
  const baskets = await listBaskets();
  const out: PortfolioDto = { account, positions: [], claims: { dividends: [], backing: [], curator: [], referral: [], ious: [] } };
  if (baskets.length === 0) return out;

  const per = baskets.map((b) => [
    { address: b.address, abi: basketAbi, functionName: "balanceOf", args: [account] },
    { address: b.address, abi: basketAbi, functionName: "pendingWifDividend", args: [account] },
    { address: vault, abi: backingVaultAbi, functionName: "position", args: [b.address, account] },
    { address: vault, abi: backingVaultAbi, functionName: "pendingRewards", args: [b.address, account] },
    { address: vault, abi: backingVaultAbi, functionName: "basketState", args: [b.address] },
    { address: harvester, abi: feeHarvesterAbi, functionName: "currentCycle", args: [b.address] },
    ...b.components.map((c) => ({ address: b.address, abi: basketAbi, functionName: "owed", args: [account, c.token] })),
  ]);
  const flat = await batch(client, per.flat());

  // second round: referralOf over each basket's closed cycles
  let off = 0;
  const readings = baskets.map((b, i) => {
    const n = (per[i] as unknown[]).length;
    const r = flat.slice(off, off + n);
    off += n;
    return r;
  });
  const cycleCalls: { bi: number; cycle: number }[] = [];
  baskets.forEach((b, bi) => {
    const current = Number(ok<bigint>(readings[bi]?.[5]) ?? 0n);
    for (const cycle of closedCycles(current)) cycleCalls.push({ bi, cycle });
  });
  const refRes = await batch(
    client,
    cycleCalls.map((c) => ({ address: harvester, abi: feeHarvesterAbi, functionName: "referralOf", args: [(baskets[c.bi] as { address: Address }).address, BigInt(c.cycle), account] })),
  );
  const refByBasket = new Map<number, CycleReading[]>();
  cycleCalls.forEach((c, i) => {
    const t = ok<readonly [bigint, bigint, boolean]>(refRes[i]);
    if (!t) return;
    const list = refByBasket.get(c.bi) ?? [];
    list.push({ cycle: c.cycle, shares: t[0], claimableWif: t[1], claimed: t[2] });
    refByBasket.set(c.bi, list);
  });

  baskets.forEach((b, bi) => {
    const r = readings[bi] as typeof flat;
    const shares = ok<bigint>(r[0]) ?? 0n;
    const dividend = ok<bigint>(r[1]) ?? 0n;
    const pos = ok<PositionTuple>(r[2]);
    const pending = ok<bigint>(r[3]) ?? 0n;
    const state = ok<StateTuple>(r[4]);
    const base = { basket: b.address, name: b.name };
    const backed = (pos?.active ?? 0n) + (pos?.warming ?? 0n);
    if (shares > 0n || backed > 0n) {
      out.positions.push({
        basket: b.address,
        name: b.name,
        symbol: b.symbol,
        mode: b.mode,
        shares: shares.toString(),
        valueUsd: (Number(shares) / 1e18) * b.navPerShareUsd,
        beatPts: b.epoch ? b.epoch.beatPts : null,
        backed: backed.toString(),
      });
    }
    if (dividend > 0n) out.claims.dividends.push({ ...base, amount: dividend.toString(), ticker: "WIF" });
    const claimable = pos ? (pending > pos.claimable ? pending : pos.claimable) : 0n;
    if (claimable > 0n) out.claims.backing.push({ ...base, amount: claimable.toString(), ticker: "WIF" });
    if (state && state.curator.toLowerCase() === account.toLowerCase() && state.curatorClaimable > 0n) {
      out.claims.curator.push({ ...base, amount: state.curatorClaimable.toString(), ticker: "WIF" });
    }
    const sel = selectClaimableCycles(refByBasket.get(bi) ?? []);
    if (sel.cycles.length > 0) out.claims.referral.push({ ...base, amount: sel.total.toString(), ticker: "WIF", cycles: sel.cycles });
    b.components.forEach((c, ci) => {
      const owed = ok<bigint>(r[6 + ci]) ?? 0n;
      if (owed > 0n) out.claims.ious.push({ ...base, amount: owed.toString(), ticker: c.ticker, token: c.token });
    });
  });
  return out;
}
