# Work Packages

| WP | Scope | Depends on | Implementer | Status |
|---|---|---|---|---|
| WP0 | Repo, interfaces, docs, mocks, dependencies | – | Opus (architect) | done |
| WP1 | `ComponentRegistry`, `Basket`, `BasketFactory` + unit, fuzz and invariant tests | WP0 | Sonnet agent | **accepted** (77 tests, 100% coverage) |
| WP2 | `BackingVault`, `libraries/StockMath` + unit and invariant tests | WP0 | Sonnet agent (parallel with WP1) | **accepted** after review R-1 (JIT-stake warmup), R-2 (pull rewards), R-3 (ceil reward debt, applied by architect) |
| WP3 | `FlatpackRouter`, `FeeHarvester`, swap libraries + fork and E2E tests | WP1, WP2 merged | Sonnet agent | **accepted** (18 mainnet-fork tests; claimIOU deviation approved) |
| WP4 | Hardhat Ignition deploy module, registry seeding, keeper bot (`keeper/`, TypeScript and viem) | WP3 | Sonnet agent | next |
| WP5 | Next.js app (Explore, Basket, Assemble, burn counter, geofence) | WP3 ABIs | Sonnet agent | blocked |
| WP6 | Security review, gas review, README and demo script | all | Opus | blocked |

**Process**
1. The architect publishes the binding interfaces and the brief.
2. An agent implements against them and opens a report (`WPn-REPORT.md`).
3. The architect reviews against the interfaces, the TEST-PLAN and the standards.
4. The architect fixes or sends the work back, then commits.

Agents never edit files outside their ownership list. Interface changes go through the architect.

## Constructor and wiring contract (shared by all WPs)

```solidity
ComponentRegistry(address owner, address usdg, address v3Factory)
FeeHarvester(address owner, address registry, address usdg, address weth, address wif,
             address usdgWethPool, address poolManager, PoolKey wifPoolKey)       // WP3; setFactory(factory) once
BackingVault(address owner, address registry, address wif)                          // WP2; setFactory once, setHarvester once
Basket()  // implementation: constructor calls _disableInitializers()
BasketFactory(address owner, address registry, address harvester, address vault,
              address wif, address implementation, uint256 minCuratorStake)
FlatpackRouter(address factory, address registry)                                   // WP3; reads usdg and v3Factory from the registry
```
- The vault reads `factory.minCuratorStake()` and `factory.isBasket()`, and reads `IBasket(basket).components()` and `registry.component(token).priceFeed` for NAV.
- The harvester reads `factory.vault()` and `factory.isBasket()`.
- The basket reads its harvester and WIF from `BasketInit`, and `factory` = msg.sender of `initialize`.
