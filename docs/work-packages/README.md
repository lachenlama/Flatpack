# Work Packages

| WP | Scope | Depends on | Implementer | Status |
|---|---|---|---|---|
| WP0 | Repo, interfaces, docs, mocks, dependencies | – | Opus (architect) | done |
| WP1 | `ComponentRegistry`, `Basket`, `BasketFactory` + unit, fuzz and invariant tests | WP0 | Sonnet agent | **accepted** (77 tests, 100% coverage) |
| WP2 | `BackingVault`, `libraries/StockMath` + unit and invariant tests | WP0 | Sonnet agent (parallel with WP1) | **accepted** after review R-1 (JIT-stake warmup), R-2 (pull rewards), R-3 (ceil reward debt, applied by architect) |
| WP3 | `FlatpackRouter`, `FeeHarvester`, swap libraries + fork and E2E tests | WP1, WP2 merged | Sonnet agent | **accepted** (18 mainnet-fork tests; claimIOU deviation approved) |
| WP4a | Ignition deploy, fork rehearsal, smoke, shared units, demo baskets, DEPLOY runbook ([brief](WP4a-deploy.md)) | WP3 | Sonnet agent | **accepted** (fork deploy + smoke 52/52; smoke now reuses the module symbol list) |
| WP4b | Stateless keeper (Node 24 and viem), Actions cron and CI, KEEPER runbook ([brief](WP4b-keeper.md)) | WP3 | Sonnet agent (parallel with WP4a) | **accepted** (32 tests, typecheck clean) |
| WP4c | E2E rehearsal: deploy on a local fork node, then run a keeper tick against it | WP4a, WP4b | Sonnet agent | **accepted** (REHEARSAL OK, 3 deploy-day bugs fixed; R-5 same-tick dividends) |
| WP5a | Web foundation: design system, wallet, data layer, geofence, Home/Proof ([brief](WP5a-web-foundation.md), [UX spec](../architecture/WP5-UX.md)) | WP4 | Sonnet agent | **accepted** (28 tests; fork-verified pages; R-6 per-port rehearsals, R-7 WalletConnect removed, R-8 guarded mock wallet + browser e2e) |
| WP5b | Explore and Basket pages ([brief](WP5b-explore-basket.md)) | WP5a | Sonnet agent | **accepted** (browser click-through buy + back; chain-clock deadline fix; brand copy fix by architect) |
| WP5c | Assemble, Portfolio and Flywheel pages ([brief](WP5c-assemble-portfolio-flywheel.md)) | WP5a | Sonnet agent (parallel with WP5b) | **accepted** (browser click-through assemble + referral claim; fee-split copy corrected by architect) |
| WP6 | Security review, gas review, README and demo script | all | Opus | next |

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
