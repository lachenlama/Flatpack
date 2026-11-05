/**
 * Read-only post-deployment smoke checks (D-5). Pure reads: safe to run against mainnet at any time.
 * Asserts every wiring invariant of a Flatpack deployment: immutables, one-time setters, keeper, owners,
 * the registry seed (10 components + benchmark), Chainlink feed freshness and the router's USDG.
 */
import { LAUNCH_SYMBOLS } from "../params.ts";
import {
  aggregatorV3Abi,
  backingVaultAbi,
  basketFactoryAbi,
  componentRegistryAbi,
  feeHarvesterAbi,
  flatpackRouterAbi,
} from "../../../shared/abi/index.ts";

/** A 0x-prefixed hex string. */
export type Hex = `0x${string}`;

/** The minimal read surface of a viem public client that the smoke check needs. */
export interface SmokeClient {
  readContract(args: {
    address: Hex;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  getCode(args: { address: Hex }): Promise<Hex | undefined>;
  getBlock(): Promise<{ timestamp: bigint }>;
}

/** Deployed contract addresses (Ignition's `Flatpack#...` futures resolved). */
export interface DeployedAddresses {
  registry: Hex;
  harvester: Hex;
  vault: Hex;
  basketImpl: Hex;
  factory: Hex;
  router: Hex;
}

/** One expected registry component. */
export interface ExpectedComponent {
  symbol: string;
  token: Hex;
  feed: Hex;
  v3Fee: number;
}

/** What the deployment should look like (derived from the Ignition parameters / config). */
export interface ExpectedDeployment {
  owner: Hex;
  keeper: Hex;
  usdg: Hex;
  wif: Hex;
  v3Factory: Hex;
  benchmark: Hex;
  components: ExpectedComponent[];
  /** Max age of a Chainlink answer in seconds (the vault's MAX_PRICE_AGE is 4 days). */
  maxFeedAgeSeconds?: bigint;
}

/** One line of the report. */
export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** Result of {@link smoke}. */
export interface SmokeReport {
  checks: SmokeCheck[];
  failures: number;
}

const DEFAULT_MAX_FEED_AGE = 4n * 24n * 3600n;

function same(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

/**
 * Runs all checks and returns the report (never throws on a mismatch; an RPC error becomes a failed check).
 * @param client a viem public client (or anything with readContract/getCode/getBlock)
 * @param addresses the deployed contract addresses
 * @param expected the expected wiring and registry seed
 */
export async function smoke(
  client: SmokeClient,
  addresses: DeployedAddresses,
  expected: ExpectedDeployment,
): Promise<SmokeReport> {
  const checks: SmokeCheck[] = [];
  const record = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };
  const guard = async (name: string, fn: () => Promise<{ ok: boolean; detail: string }>): Promise<void> => {
    try {
      const r = await fn();
      record(name, r.ok, r.detail);
    } catch (e) {
      record(name, false, `read failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  };
  const eqAddr =
    (abi: readonly unknown[], address: Hex, functionName: string, want: string, args?: readonly unknown[]) =>
    async (): Promise<{ ok: boolean; detail: string }> => {
      const got = await client.readContract({ address, abi, functionName, args });
      return { ok: same(got, want), detail: `got ${String(got)}, want ${want}` };
    };

  // code present at every address
  for (const [label, address] of Object.entries(addresses)) {
    await guard(`code:${label}`, async () => {
      const code = await client.getCode({ address: address as Hex });
      return { ok: code !== undefined && code !== "0x", detail: address };
    });
  }

  const { registry, harvester, vault, basketImpl, factory, router } = addresses;

  // factory immutables
  await guard("factory.registry", eqAddr(basketFactoryAbi, factory, "registry", registry));
  await guard("factory.harvester", eqAddr(basketFactoryAbi, factory, "harvester", harvester));
  await guard("factory.vault", eqAddr(basketFactoryAbi, factory, "vault", vault));
  await guard("factory.wif", eqAddr(basketFactoryAbi, factory, "wif", expected.wif));
  await guard("factory.implementation", eqAddr(basketFactoryAbi, factory, "implementation", basketImpl));

  // vault wiring
  await guard("vault.factory", eqAddr(backingVaultAbi, vault, "factory", factory));
  await guard("vault.harvester", eqAddr(backingVaultAbi, vault, "harvester", harvester));
  await guard("vault.registry", eqAddr(backingVaultAbi, vault, "registry", registry));
  await guard("vault.wif", eqAddr(backingVaultAbi, vault, "wif", expected.wif));

  // harvester wiring
  await guard("harvester.factory", eqAddr(feeHarvesterAbi, harvester, "factory", factory));
  await guard("harvester.vault", eqAddr(feeHarvesterAbi, harvester, "vault", vault));
  await guard("harvester.keeper", eqAddr(feeHarvesterAbi, harvester, "keeper", expected.keeper));
  await guard("harvester.registry", eqAddr(feeHarvesterAbi, harvester, "registry", registry));
  await guard("harvester.usdg", eqAddr(feeHarvesterAbi, harvester, "usdg", expected.usdg));
  await guard("harvester.wif", eqAddr(feeHarvesterAbi, harvester, "wif", expected.wif));

  // owners
  await guard("owner:registry", eqAddr(componentRegistryAbi, registry, "owner", expected.owner));
  await guard("owner:harvester", eqAddr(feeHarvesterAbi, harvester, "owner", expected.owner));
  await guard("owner:vault", eqAddr(backingVaultAbi, vault, "owner", expected.owner));
  await guard("owner:factory", eqAddr(basketFactoryAbi, factory, "owner", expected.owner));

  // factory state
  await guard("factory.createPaused", async () => {
    const paused = await client.readContract({ address: factory, abi: basketFactoryAbi, functionName: "createPaused" });
    return { ok: paused === false, detail: `createPaused=${String(paused)}` };
  });

  // registry
  await guard("registry.usdg", eqAddr(componentRegistryAbi, registry, "usdg", expected.usdg));
  await guard("registry.v3Factory", eqAddr(componentRegistryAbi, registry, "v3Factory", expected.v3Factory));
  await guard("registry.benchmark", eqAddr(componentRegistryAbi, registry, "benchmark", expected.benchmark));

  // router
  await guard("router.usdg", eqAddr(flatpackRouterAbi, router, "usdg", expected.usdg));
  await guard("router.factory", eqAddr(flatpackRouterAbi, router, "factory", factory));
  await guard("router.registry", eqAddr(flatpackRouterAbi, router, "registry", registry));

  // components + feeds
  const now = (await client.getBlock()).timestamp;
  const maxAge = expected.maxFeedAgeSeconds ?? DEFAULT_MAX_FEED_AGE;
  for (const c of expected.components) {
    await guard(`component:${c.symbol}`, async () => {
      const got = await client.readContract({
        address: registry,
        abi: componentRegistryAbi,
        functionName: "component",
        args: [c.token],
      });
      const r = got as { enabled: boolean; priceFeed: string; v3Fee: number };
      const ok = r.enabled === true && same(r.priceFeed, c.feed) && Number(r.v3Fee) === c.v3Fee;
      return { ok, detail: `enabled=${r.enabled} feed=${r.priceFeed} fee=${r.v3Fee}; want feed=${c.feed} fee=${c.v3Fee}` };
    });
    await guard(`feed:${c.symbol}`, async () => {
      const round = (await client.readContract({
        address: c.feed,
        abi: aggregatorV3Abi,
        functionName: "latestRoundData",
      })) as readonly [bigint, bigint, bigint, bigint, bigint];
      const decimals = await client.readContract({ address: c.feed, abi: aggregatorV3Abi, functionName: "decimals" });
      const answer = round[1];
      const age = now - round[3];
      const ok = answer > 0n && Number(decimals) === 8 && age <= maxAge;
      return { ok, detail: `answer=${answer} decimals=${String(decimals)} ageSec=${age}` };
    });
  }

  return { checks, failures: checks.filter((c) => !c.ok).length };
}

/** Formats a report as text (one line per check) for CLIs and test logs. */
export function formatReport(report: SmokeReport): string {
  const lines = report.checks.map((c) => `${c.ok ? "PASS" : "FAIL"}  ${c.name}  ${c.ok ? "" : c.detail}`.trimEnd());
  lines.push(`${report.checks.length - report.failures}/${report.checks.length} checks passed`);
  return lines.join("\n");
}

/** Flat Ignition parameter values as stored in ignition/parameters/*.json (the `Flatpack` section). */
export type ParameterValues = Record<string, unknown>;

/** The launch symbols seeded by the module (kept in sync with scripts/params.ts). */
/** Single source of truth: the same list the Ignition module seeds (review: avoid drift). */
export const SMOKE_SYMBOLS = LAUNCH_SYMBOLS;

function str(values: ParameterValues, key: string): Hex {
  const v = values[key];
  if (typeof v !== "string" || !v.startsWith("0x")) throw new Error(`parameter ${key} missing or not an address`);
  return v as Hex;
}

/** Builds the expected deployment from the `Flatpack` section of a generated parameter file. */
export function expectedFromParameters(values: ParameterValues): ExpectedDeployment {
  return {
    owner: str(values, "owner"),
    keeper: str(values, "keeper"),
    usdg: str(values, "usdg"),
    wif: str(values, "wif"),
    v3Factory: str(values, "v3Factory"),
    benchmark: str(values, "benchmark"),
    components: SMOKE_SYMBOLS.map((symbol) => ({
      symbol,
      token: str(values, `${symbol}_token`),
      feed: str(values, `${symbol}_feed`),
      v3Fee: Number(values[`${symbol}_v3Fee`]),
    })),
  };
}

/** Maps Ignition's `deployed_addresses.json` (keys like `Flatpack#FeeHarvester`) to {@link DeployedAddresses}. */
export function addressesFromIgnition(deployed: Record<string, string>): DeployedAddresses {
  const get = (id: string): Hex => {
    const v = deployed[`Flatpack#${id}`];
    if (v === undefined) throw new Error(`deployed_addresses.json has no Flatpack#${id}`);
    return v as Hex;
  };
  return {
    registry: get("ComponentRegistry"),
    harvester: get("FeeHarvester"),
    vault: get("BackingVault"),
    basketImpl: get("BasketImplementation"),
    factory: get("BasketFactory"),
    router: get("FlatpackRouter"),
  };
}
