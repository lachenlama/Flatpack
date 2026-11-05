/**
 * Generates the Ignition parameter files from config/mainnet-4663.json (the single source of truth):
 *   ignition/parameters/fork.json     (owner/keeper = the default Hardhat dev accounts #0 and #1)
 *   ignition/parameters/mainnet.json  (owner/keeper from --owner/--keeper or OWNER/KEEPER env vars)
 *
 * Usage:  node scripts/params.ts [--owner 0x..] [--keeper 0x..] [--min-stake <WIF, whole tokens>] [--rehearsal]
 * The owner of the mainnet deploy MUST be the deployer account (Ignition sends the owner-only wiring calls from it).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

/** The ten launch components, in the order they are seeded into the registry. */
export const LAUNCH_SYMBOLS = ["NVDA", "AAPL", "SPY", "QQQ", "GOOGL", "MSFT", "AMZN", "META", "MU", "TSLA"] as const;

/** Default minimum curator stake: 1000 WIF (18 decimals), same as the fork tests. */
export const DEFAULT_MIN_STAKE_WIF = 1000n;

/** Hardhat/EDR default dev accounts #0 and #1, used as owner and keeper on the fork rehearsal. */
export const FORK_OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const FORK_KEEPER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const ZERO = "0x0000000000000000000000000000000000000000";

interface ComponentConfig {
  token: string;
  feed: string;
  v3Fee: number;
}

interface FlatpackConfig {
  chainId: number;
  tokens: { USDG: { address: string }; WETH: { address: string }; WIF: { address: string } };
  uniswap: {
    v3Factory: string;
    v4PoolManager: string;
    usdgWethPool: { address: string };
    wifEthV4PoolKey: {
      currency0: string;
      currency1: string;
      fee: number;
      tickSpacing: number;
      hooks: string;
    };
  };
  benchmark: string;
  launchUniverse: Record<string, ComponentConfig | string>;
}

/** Flat Ignition parameters for the `Flatpack` module (JSON-serialisable; bigints are `"123n"` strings). */
export type FlatpackParameters = Record<string, string | number | { [key: string]: string | number }>;

/** Reads and parses config/mainnet-4663.json. */
export function loadConfig(path: string): FlatpackConfig {
  return JSON.parse(readFileSync(path, "utf8")) as FlatpackConfig;
}

/**
 * Builds the parameter object of the `Flatpack` module from the config.
 * @param config parsed config/mainnet-4663.json
 * @param owner  owner of every Ownable contract (and the deployer)
 * @param keeper harvester keeper (separate from the owner)
 * @param minStakeWif minimum curator stake, whole WIF tokens
 */
export function buildParameters(
  config: FlatpackConfig,
  owner: string,
  keeper: string,
  minStakeWif: bigint,
): FlatpackParameters {
  const k = config.uniswap.wifEthV4PoolKey;
  const params: FlatpackParameters = {
    owner: getAddress(owner),
    keeper: getAddress(keeper),
    minCuratorStake: `${minStakeWif * 10n ** 18n}n`,
    usdg: getAddress(config.tokens.USDG.address),
    weth: getAddress(config.tokens.WETH.address),
    wif: getAddress(config.tokens.WIF.address),
    v3Factory: getAddress(config.uniswap.v3Factory),
    usdgWethPool: getAddress(config.uniswap.usdgWethPool.address),
    poolManager: getAddress(config.uniswap.v4PoolManager),
    wifPoolKey: {
      currency0: getAddress(k.currency0),
      currency1: getAddress(k.currency1),
      fee: k.fee,
      tickSpacing: k.tickSpacing,
      hooks: getAddress(k.hooks),
    },
    benchmark: getAddress((config.launchUniverse[config.benchmark] as ComponentConfig).token),
  };
  for (const symbol of LAUNCH_SYMBOLS) {
    const c = config.launchUniverse[symbol];
    if (c === undefined || typeof c === "string") throw new Error(`config is missing launch component ${symbol}`);
    params[`${symbol}_token`] = getAddress(c.token);
    params[`${symbol}_feed`] = getAddress(c.feed);
    params[`${symbol}_v3Fee`] = c.v3Fee;
  }
  return params;
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const config = loadConfig(join(here, "..", "..", "config", "mainnet-4663.json"));
  const outDir = join(here, "..", "ignition", "parameters");
  mkdirSync(outDir, { recursive: true });

  const stake = BigInt(argValue("--min-stake") ?? DEFAULT_MIN_STAKE_WIF);
  const owner = argValue("--owner") ?? process.env.OWNER ?? ZERO;
  const keeper = argValue("--keeper") ?? process.env.KEEPER ?? ZERO;

  const write = (name: string, params: FlatpackParameters): void => {
    writeFileSync(join(outDir, name), JSON.stringify({ Flatpack: params }, null, 2) + "\n");
    console.log(`wrote ignition/parameters/${name}`);
  };
  if (process.argv.includes("--rehearsal")) {
    // local-node rehearsal only: touches nothing but rehearsal.json (owner/keeper = dev accounts #0 and #1)
    // --name <id> (default "rehearsal") lets parallel rehearsals use rehearsal-<port>.json
    write(`${argValue("--name") ?? "rehearsal"}.json`, buildParameters(config, FORK_OWNER, FORK_KEEPER, stake));
    return;
  }
  write("fork.json", buildParameters(config, FORK_OWNER, FORK_KEEPER, stake));
  write("mainnet.json", buildParameters(config, owner, keeper, stake));
  if (owner === ZERO || keeper === ZERO) {
    console.warn("WARNING: mainnet.json has a ZERO owner/keeper. Re-run with --owner <deployer> --keeper <keeper>.");
  }
}

if (import.meta.main) main();
