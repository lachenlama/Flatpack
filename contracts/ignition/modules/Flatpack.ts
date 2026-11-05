import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import type { Future } from "@nomicfoundation/ignition-core";
import { LAUNCH_SYMBOLS } from "../../scripts/params.ts";

/**
 * Full Flatpack deployment (WP4a, ADR-0011). Order, mirroring ForkBase in test/fork/RouterFork.t.sol:
 *   Registry -> Harvester -> Vault -> Basket implementation -> Factory -> Router,
 *   then wiring (vault.setFactory, vault.setHarvester, harvester.setFactory, harvester.setKeeper),
 *   then registry.setComponent x10 (explicit ids) and registry.setBenchmark.
 * Parameters are generated from config/mainnet-4663.json by scripts/params.ts. The deployer account must be `owner`.
 */
const FlatpackModule = buildModule("Flatpack", (m) => {
  const owner = m.getParameter<string>("owner");
  const keeper = m.getParameter<string>("keeper");
  const minCuratorStake = m.getParameter<bigint>("minCuratorStake");
  const usdg = m.getParameter<string>("usdg");
  const weth = m.getParameter<string>("weth");
  const wif = m.getParameter<string>("wif");
  const v3Factory = m.getParameter<string>("v3Factory");
  const usdgWethPool = m.getParameter<string>("usdgWethPool");
  const poolManager = m.getParameter<string>("poolManager");
  // PoolKey struct: {currency0, currency1, fee, tickSpacing, hooks}
  const wifPoolKey = m.getParameter<Record<string, string | number>>("wifPoolKey");
  const benchmark = m.getParameter<string>("benchmark");

  // ---- deploy
  const registry = m.contract("ComponentRegistry", [owner, usdg, v3Factory], { id: "ComponentRegistry" });
  const harvester = m.contract(
    "FeeHarvester",
    [owner, registry, usdg, weth, wif, usdgWethPool, poolManager, wifPoolKey],
    { id: "FeeHarvester" },
  );
  const vault = m.contract("BackingVault", [owner, registry, wif], { id: "BackingVault" });
  const basketImpl = m.contract("Basket", [], { id: "BasketImplementation" });
  const factory = m.contract(
    "BasketFactory",
    [owner, registry, harvester, vault, wif, basketImpl, minCuratorStake],
    { id: "BasketFactory" },
  );
  const router = m.contract("FlatpackRouter", [factory, registry], { id: "FlatpackRouter" });

  // ---- one-time wiring (dependency order)
  const vaultSetFactory = m.call(vault, "setFactory", [factory], { id: "vault_setFactory" });
  const vaultSetHarvester = m.call(vault, "setHarvester", [harvester], {
    id: "vault_setHarvester",
    after: [vaultSetFactory],
  });
  const harvesterSetFactory = m.call(harvester, "setFactory", [factory], {
    id: "harvester_setFactory",
    after: [vaultSetHarvester],
  });
  // the harvester's keeper defaults to the owner; hand it to the dedicated keeper key
  const harvesterSetKeeper = m.call(harvester, "setKeeper", [keeper], {
    id: "harvester_setKeeper",
    after: [harvesterSetFactory],
  });

  // ---- registry seeding: 10 components, one call each with an explicit id, strictly sequential
  let prev: Future = harvesterSetKeeper;
  for (const symbol of LAUNCH_SYMBOLS) {
    prev = m.call(
      registry,
      "setComponent",
      [
        m.getParameter<string>(`${symbol}_token`),
        true,
        m.getParameter<string>(`${symbol}_feed`),
        m.getParameter<number>(`${symbol}_v3Fee`),
      ],
      { id: `registry_setComponent_${symbol}`, after: [prev] },
    );
  }
  m.call(registry, "setBenchmark", [benchmark], { id: "registry_setBenchmark", after: [prev] });

  return { registry, harvester, vault, basketImpl, factory, router };
});

export default FlatpackModule;
