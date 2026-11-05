# WP1: ComponentRegistry, Basket, BasketFactory

## Read first (in this order)
1. `docs/ENGINEERING-STANDARDS.md` (binding)
2. `docs/architecture/ARCHITECTURE.md` §4–8
3. `contracts/src/interfaces/IBasket.sol`, `IBasketFactory.sol` and `IComponentRegistry.sol`. **These are the normative spec.**
4. ADR-0001, 0002, 0003, 0006 and 0008 in `docs/adr/`
5. `docs/TEST-PLAN.md`: the Basket and Factory/Registry sections
6. `docs/work-packages/README.md`: the constructor and wiring contract

## You own (create and edit ONLY these)
- `contracts/src/ComponentRegistry.sol`
- `contracts/src/Basket.sol`
- `contracts/src/BasketFactory.sol`
- `contracts/test/mocks/MockV3Factory.sol` (a settable `getPool`)
- `contracts/test/mocks/MockHarvester.sol` (records `onFeeShares` and `onDividendSkim`, and can call `basket.notifyWifDividend` and mint or redeem as the harvester)
- `contracts/test/mocks/MockVault.sol` (records `registerBasket` and `stakeFor`, and pulls WIF)
- `contracts/test/unit/ComponentRegistry.t.sol`, `Basket.t.sol`, `BasketDividends.t.sol`, `BasketFactory.t.sol`
- `contracts/test/invariant/BasketInvariant.t.sol` (plus a handler in the same file or `BasketHandler.sol` next to it)
- `docs/work-packages/WP1-REPORT.md`

Read-only for you: everything else, including `src/interfaces/**`, `test/mocks/MockERC20.sol`, `MockStockToken.sol` and `MockAggregator.sol`. **Another agent is working on `BackingVault` and `StockMath` in parallel.** If the full build breaks because of *their* files, wait about a minute and retry (up to 5 times). Never edit their files.

## Implementation notes (the interface NatSpec governs, these are clarifications)
- **Basket** is `ERC20Upgradeable`, `ReentrancyGuardTransient` and `IBasket`. Store `tokens[]`, `rawUnits[]` and `lastMultiplier[]` in storage (set in `initialize`). `factory = msg.sender` at `initialize`.
- `_sync()` runs at the start of `mint` and `redeem`. The public `sync()` is `nonReentrant` and calls `_sync()`. A skim calls `IERC20(token).safeTransfer(harvester, excess)` and then `IFeeHarvester(harvester).onDividendSkim(token, excess)`. Skip it if `excess == 0`. **Only skim when `totalSupply() > 0`.** With zero supply there are no holders to pay, so the units are still adjusted but nothing is skimmed. Note that `excess` also captures any donated balance at that moment, which is intended: it goes to holders as $WIF.
- **Fee math:** `fee = shares * FEE_BPS / 10_000` (floor). The harvester is exempt (`msg.sender == harvester` for mint, and the owner is the harvester for redeem).
  - On mint: `_mint(receiver, shares - fee)` and `_mint(harvester, fee)`. If `fee > 0`, call `onFeeShares(referrer, fee)`.
  - On redeem: `_transfer(msg.sender, harvester, fee)`, call `onFeeShares(address(0), fee)`, then burn `net = shares - fee` and pay pro rata on `net` using `supplyBefore` = totalSupply **before** the burn (fee shares stay in supply).
- **The referral fraction** is applied by the harvester, not the basket. The basket just forwards the referrer.
- **Redeem legs:** use `SafeERC20.trySafeTransfer` (OZ ≥ 5.1). If your OZ version lacks it, use a low-level call that treats a revert, a `false` return, or a no-code target as failure. A failure means `owed[receiver][token] += amt`, `totalOwed[token] += amt`, and emit `IOURecorded`.
- **The WIF dividend accumulator** (PayInWif only): `accWifPerShare` (1e18 scale), `rewardDebt[account]` and `accrued[account]`. Override `_update(from, to, value)` to settle `from` and `to` **before** balances change (skip address(0)). `pendingWifDividend = accrued + balance * acc / 1e18 - rewardDebt`.
- **Factory:** `Clones.clone(implementation)`. The validation order follows the error list in `IBasketFactory`. Then `vault.registerBasket(basket, msg.sender)`. Pull the stake: `wif.safeTransferFrom(msg.sender, address(this), stake)`, then `forceApprove(vault, stake)`, `vault.stakeFor(basket, msg.sender, stake)`, and reset the approval. Note: `registerBasket` must be called **after** `initialize` (the vault reads `components()`).
- **Registry:** `Ownable2Step`. Enabling requires `priceFeed != 0`, a valid fee tier, and `IUniswapV3Factory(v3Factory).getPool(token, usdg, fee) != address(0)`. `setBenchmark` requires an enabled component.

## Acceptance criteria
- The Definition of Done in ENGINEERING-STANDARDS (coverage ≥ 95% on the three src files).
- Every TEST-PLAN ID in **U-B01..U-B15, Z-B01, I-B01, U-F01..U-F03** is implemented and passing.
- The invariant suite asserts INV-1, INV-2 and INV-7 over a handler that includes pause/unpause and multiplier bumps (both dividend-sized and split-sized).
- Write `docs/work-packages/WP1-REPORT.md`: what was built, any spec ambiguities (quote the line), deviations (there should be none), coverage table, and gas for mint and redeem of a 3- and an 8-component basket. Measure it with `gasleft()` deltas in a dedicated `test_U_GAS_*` test and print it with `console.log`. If Hardhat's `--gas-stats` flag works, use that instead.
