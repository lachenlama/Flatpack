# Flatpack: Build Plan (world is flat hackathon)

> **One line:** Build a basket of Stock Tokens, share the link, and earn $WIF every time someone buys it.

- **Hackathon:** world is flat hackathon. 10,000 USDG to a single winner, with no second place.
- **Deadline:** submissions close **Thu Nov 12, 17:30 UTC**, and edits lock at that time. Round one runs Nov 12–14 and the final Nov 14–16. The project must stay live until Nov 16.
- **Category:** Stock Tokens (primary). Also hooks and defi, and social and creators. One prize covers every category, so we tick all three.
- **Today:** Thu Nov 5. Seven days.
- **Name check:** no hackathon entry uses "Flatpack". The name avoids Robinhood's name and logo, as the rules require.

---

## 1. What the hackathon rewards

From the rules (`/build/rules`):
- The project must **use $WIF onchain** on Robinhood Chain, and **have a flywheel** "so using it keeps bringing people back to $wif."
- It must be **live until the final closes**, with a **visible repo, a demo video and real transactions**.
- Judges look for: "**a real reason to use $wif**, a flywheel that holds up, and something that **works and is built well**."
- Judges include a security expert (ogle) and Quicknode devrel. The community votes by burning $WIF, and that vote counts as one judge.
- Stock Token projects **must follow Robinhood's restricted-country list**: no US, Canada, UK or Switzerland, and no sanctioned countries.

## 2. What already exists (checked Nov 5)

All 16 approved projects, from `/build/api/projects`:

| Project | What it is | Takeaway |
|---|---|---|
| **Underfoot** (Stock Tokens) | A treasury of Stock Tokens forms a floor under $WIF. Burn WIF to take your slice. | A $WIF backing mechanism, not a product for investors. |
| **Flat Street** (Stock Tokens) | Fantasy stock picking: choose 5 stocks, pay in $WIF, and Chainlink keeps score. | A game. Nobody ends up owning the stocks. |
| Kerdo, wifpool | Up or down bets on $WIF and crypto prices | The prediction space is crowded. |
| Proof of Ship | Escrowed $WIF bounties for builders, with real transactions and 4 updates | **The strongest competitor**: shipping, active and onchain. |
| 10 others | Games, AI agent arenas, gifting, a launchpad | Almost all are games or social, with no investing utility. |

Across the wider Robinhood Chain ecosystem, Uniswap, Rialto and Lighter cover trading, and Morpho covers lending (Stock Tokens became collateral on Oct 22). **I found no product for baskets, indexes or portfolios.** Morpho itself lists portfolio-level products as "planned".

**The gap:** 203 Stock Tokens are live, but you can only buy them one at a time. Nobody can say "here is my AI-chip portfolio, buy it in one click", and nobody gets paid for curating one.

## 3. The product

**Flatpack** turns a stock thesis into a token anyone can buy.

1. **Assemble.** A curator picks 2–8 Stock Tokens and their weights (for example "AI Picks & Shovels": NVDA 30, AVGO 25, TSM 20, AMD 15, MU 10). They name it and **stake $WIF to publish it**.
2. **Share.** Each basket gets a page and an X card showing performance since launch, holdings and backers.
3. **Buy in one transaction.** Pay USDG, and the router buys every component on Uniswap and mints basket shares. **Redeem** to get the underlying Stock Tokens back in kind, or sell them back to USDG.
4. **Earn.** A 0.30% fee on mint and redeem is converted to **$WIF**: **50% goes to the curator and 50% is burned.**

### The $WIF flywheel
> **Superseded by §10.** That section adds $WIF Dividends, backing, Beat-SPY and referrals, and splits fees 50% burn / 30% backers / 20% curator. The original version is kept below for reference.


```
curators stake WIF to publish ─► baskets get shared on X ─► investors buy in USDG
        ▲                                                         │
        │                                          0.30% fee bought as WIF
        │                                                         │
 curators earn WIF ◄──── 50% to the curator ◄──────┴────► 50% burned
 and re-stake to rank higher                         (steady buy pressure on WIF)
```

Why this is "a real reason to use $WIF" and not a token bolted on:
- **$WIF is skin in the game.** Publishing needs a stake, which keeps spam and rug-baskets out. The stake also sets leaderboard rank alongside performance.
- **$WIF is the creator currency.** Curators are paid in WIF, so the people promoting baskets on X are WIF holders.
- **All volume becomes WIF demand.** Investors never need to touch WIF: they use USDG, and the protocol buys WIF for them. That keeps onboarding simple and the buy pressure real.
- *Stretch:* **back a basket.** Any WIF holder stakes behind a basket they believe in and shares in the curator's fee stream. This is curation as a market.

## 4. Technical design

### 4.1 Contracts (Hardhat 3, Solidity 0.8.28)

**`BasketFactory`**
- `createBasket(name, symbol, tokens[], units[], wifStake)` pulls the WIF stake and deploys a `Basket` as an EIP-1167 clone.
- Components must be on the **allowlist**: Stock Tokens with a USDG pool above a liquidity floor. The list is seeded from `api.robinhood.com/rhj/assets` and its addresses are checked onchain.
- The fee is fixed in code (30 bps, hard cap 100 bps), so it can't be raised later.

**`Basket`** (ERC-20 shares, 18 decimals)
- **Fixed units per share**, like an ETF creation unit. Minting one share requires `units[i]` raw tokens of each component, **rounded up**. The composition is **immutable**: a curator changes it by publishing v2.
- `mintInKind(shares)`: deposit the components and receive shares.
- `redeemInKind(shares)` pays out **pro rata to the basket's actual balances** (`balance × shares / totalSupply`), **rounded down**. Tokens sent to the basket directly therefore go to holders instead of being stuck, and rounding can never drain the basket.
- **The fee is charged in shares, inside the Basket.** On mint and redeem, 0.30% of the shares go to the `FeeHarvester`. Because the fee lives in the Basket rather than the router, **minting in kind directly can't avoid it** (§7, E10).
- **Redeem survives a paused component.** Stock Tokens are pausable (NVDA exposes `paused()`, checked Nov 5). Redeem tries each transfer separately, and any leg that fails is recorded as a claimable IOU instead of reverting the whole redeem. `claim(token)` pays it out once the token is unpaused (§7, E1).
- **Mint and redeem never read an oracle.** Value moves in kind, so stale weekend feeds or oracle manipulation can't misprice a share. This is the core security point for the judges.

**`FlatpackRouter`**
- `buy(basket, shares, maxUsdgIn, routes, deadline)` uses Uniswap v3 `exactOutputSingle` to buy each component's required amount (including the fee shares), calls `mintInKind`, and refunds unused USDG. USDG has **6 decimals**, while Stock Tokens and $WIF have 18.
- `sell(basket, shares, minUsdgOut, routes, deadline)` does the reverse, with exact-input swaps.
- The client picks the routes, but each pool must be a v3 pool from the canonical Uniswap factory. Every leg is bounded by slippage limits computed in the client with the Quoter. The router never holds a balance between transactions and uses exact approvals.

**`FeeHarvester`**
- `harvest(basket, minWifOut)` redeems the fee shares into components, sells them to USDG, then routes USDG → WETH → WIF (the WIF/ETH v4 pool holds about $105k of liquidity). It sends **50% to the dead address** and credits **50% to that basket's curator**, so fees are accounted per basket.
- **Only the keeper can call it, with a per-call cap.** A permissionless harvest with a caller-supplied `minWifOut` can be sandwiched, because $WIF has no oracle (§7, E14). The keeper can only choose *when* to harvest: the WIF goes to fixed destinations, so a compromised keeper can't steal it.

### 4.2 Stock Token details we handle correctly (shows we read the docs)
- **Corporate actions:** the tokens are not rebasing. A `uiMultiplier()` (ERC-8056) changes on dividends and splits. A basket holds raw units, so **reinvested dividends flow to basket holders automatically**. The UI shows share-equivalents with `balanceOfUI`.
- **NAV for display only:** the sum of `balance × Chainlink price`. The feed already includes the multiplier, so we don't apply it twice. We check staleness and sequencer uptime, and respect `oraclePaused()` during corporate actions.
- **Weekend gap:** Chainlink stock feeds update 24/5, but the AMMs trade 24/7. The basket page shows **"Friday close NAV" next to the "weekend AMM price"**. This is a small, novel insight that helps on demo day.
- **Prices API pitfall:** `/rhj/prices` bid and ask are **not** multiplier-adjusted, but Chainlink prices are. Mixing the two silently misprices any token that has paid a dividend (CRM's multiplier is already 1.0011). We multiply API prices by `currentMultiplier`.
- **Trading halts:** `/rhj/prices/{symbol}` returns `isTradingHalt`. The router UI blocks buying a basket with a halted component, while redeem in kind stays open.

### 4.3 Frontend
- Next.js, viem/wagmi, and RainbowKit on chain 4663. Deployed on Vercel.
- Pages: **Explore** (leaderboard by performance and WIF staked), **Basket** (holdings, chart, NAV vs AMM, buy and sell, backers, share to X), **Assemble** (pick tokens, set weights, see a live unit calculation, stake and publish), and **Burn counter** (total WIF bought and burned, live).
- **Compliance:** a geofence on the restricted list (US, CA, UK, CH and sanctioned countries), plus an attestation checkbox and the required disclaimer. The contracts stay permissionless like every other Stock Token venue, and the app gates access to the product.

### 4.4 Data
- Server-side caching of `/rhj/assets` (the allowlist, logos and multipliers) and `/rhj/prices` (15s cache).
- An indexer for Basket and Harvest events, using Blockscout's API or a small viem poller into SQLite or Postgres. This feeds the leaderboard and the burn counter.

## 5. Schedule (7 days, buffer included)

| Day | Date | Work |
|---|---|---|
| 1 | Thu Nov 5 | Confirm the Uniswap v3 router, quoter and pool addresses on 4663. Set up the Hardhat 3 repo. Write `Basket` and `BasketFactory` (fixed units, pro-rata redeem, fee in shares, IOUs for paused tokens) with unit tests. |
| 2 | Fri Nov 6 | `FlatpackRouter.buy` with referrer (U4), and `FeeHarvester` with the 50/30/20 split. **Mainnet-fork tests** against the real NVDA, COST, AAPL and USDG pools and the WIF v4 pool. |
| 3 | Sat Nov 7 | **U1 $WIF Dividends:** the multiplier watcher, the ≤3% skim rule and the rewards accumulator. Fork-test it against SOXX's split (no skim) and a historical dividend (skim). |
| 4 | Sun Nov 8 | **U2 backing + U3 Beat-SPY epochs.** Deploy to mainnet. Seed a demo basket **holding COST and AAPL** plus 2 others. First real transactions. **Post a project update.** |
| 5 | Mon Nov 9 | Frontend: Explore (ranked by backing × performance), Basket (holdings, buy, redeem, back, claim $WIF), and Assemble. |
| 6 | Tue Nov 10 | Frontend: the burn counter, epoch scoreboard, dividend feed, geofence and referral links. Polish the README. Record the demo. **Submit.** |
| 7 | Wed Nov 11 | Buffer: fix bugs from testers, post an update, recruit curators and backers. Run the keeper cron. Build the v4 hook only if everything else is done. |
| — | Thu Nov 12 17:30 UTC | Edits lock. From then on the only job is keeping the app live. |
| — | **Fri Nov 13** | **COST dividend:** the demo basket pays holders in $WIF during round one. Announce it on X. |
| — | **Mon Nov 16** | **AAPL dividend** on final day: a second live payout while judges vote. |

**Scope cuts if behind, in order:** the v4 hook, U4 referrals, U3 Beat-SPY (keep a plain 50/50 split), and Explore ranking (use a simple list). **Never cut U1.** It's the headline.

## 5a. Budget (checked Nov 5)
- **Days 1–2 cost $0.** We build and test against a local fork of mainnet with Hardhat 3 (EDR), using the real NVDA, USDG and WIF pools and fake balances. The testnet faucet (chain 46630) also gives free ETH and test Stock Tokens (TSLA, AMZN, PLTR, NFLX, AMD).
- **A mainnet deploy costs well under $1.** Gas is about 0.02 gwei, so deploying roughly 3M gas comes to about $0.15 at ETH ≈ $2,270, plus a small L1 data fee. A swap costs about a cent.
- **Seed baskets can be tiny.** Stock Tokens have 18 decimals, so a basket worth $2 is valid. We don't need $100+.
- **Realistic minimum: about $3–5** of ETH and USDG. Sources: a builder gas grant from the organizers (@WIFonRH), a teammate, or a tester in an eligible region who makes the buys. Testers' buys count as real transactions too.

## 6. Proof for judges
- A public repo, verified contracts on Blockscout, and a README with a security section (no oracle in mint and redeem, an immutable fee cap, redeem in kind that always works, and no admin over user funds).
- **Real transactions:** basket creation with a WIF stake, buys, a redeem, a harvest and the WIF burn, all linked.
- A 2-minute demo: assemble "AI Picks & Shovels" → share → a second wallet buys it with USDG → harvest → the burn counter ticks and the curator receives WIF.
- 2–3 project updates on the hackathon page before the lock. Proof of Ship shows updates get noticed.

## 7. Edge cases

"Design" means the edge case changed the contracts. "Test" means it gets a fork test. "UI" means it's handled in the app.

### Stock Token behaviour
| # | Edge case | What breaks | Handling |
|---|---|---|---|
| E1 | **A component token is paused** (the contracts are pausable) | A naive redeem reverts for *every* holder because one leg fails, so funds are stuck | **Design:** each redeem leg is attempted separately, and failed legs become claimable IOUs. **Test:** use a fork and impersonate the pauser, or a mock pausable token. |
| E2 | The basket's address is frozen or blocklisted by the issuer | Every transfer out fails | Can't be fixed in code. Disclosed in the README. Non-custodial, like any pool. |
| E3 | A split or reverse split changes `uiMultiplier` | Nothing in the contracts, because they hold raw units | **UI:** show share-equivalents with `balanceOfUI`, and show "corporate action in progress" while `oraclePaused()`. |
| E4 | A cash dividend is reinvested through the multiplier | Nothing: holders gain automatically | **UI:** show "dividends reinvested: +x%" from the multiplier history. This doubles as a demo point. |
| E5 | A component is delisted, merged or `ASSET_STATUS_INACTIVE` | The NAV can't be shown, and buys can't route | **UI:** flag the basket and disable buys. Redeem in kind still works. |
| E6 | A token with the same ticker as a real Stock Token, but a different address | A fake "NVDA" gets into a basket | **Design:** components must be on the allowlist, which is checked against the official registry addresses. |
| E7 | Trading halt (`isTradingHalt`) | AMM prices drift away from the real price | **UI:** block buys and sells. Redeem in kind stays open. |

### Minting, redeeming and math
| # | Edge case | What breaks | Handling |
|---|---|---|---|
| E8 | Rounding on tiny mints | A loop of dust mint and redeem could extract value | **Design:** round up on mint and down on redeem, with a minimum mint size. **Test:** fuzz with `shares ∈ [1 wei, 1e30]`. |
| E9 | Tokens sent to a basket directly | Surplus gets stuck, or accounting goes wrong | **Design:** pro-rata redeem gives donations to holders. Mint stays at fixed units, so nobody can use a donation to inflate the share price. |
| E10 | A user mints in kind to avoid the router fee | The flywheel loses its revenue | **Design:** the fee is charged in shares inside the Basket, so every path pays it. |
| E11 | Duplicate tokens, zero units, more than 8 components, 1 component | Broken baskets, or redeem running out of gas | **Design:** validation in `createBasket`. **Test:** the revert cases. |
| E12 | Decimal mismatch: USDG 6, the rest 18 | Prices off by 1e12 | **Test:** fork tests use the real tokens. All math lives in one library. |

### Swaps and liquidity
| # | Edge case | What breaks | Handling |
|---|---|---|---|
| E13 | Weekend or overnight: market makers widen spreads or pull liquidity | Bad fills | `maxUsdgIn` and `minUsdgOut` revert the trade. **UI:** a "weekend premium vs Friday close" warning and the maximum buy size shown from Quoter depth. |
| E14 | A sandwich attack on the WIF harvest (no WIF oracle, about $105k liquidity) | Fee value gets extracted | **Design:** keeper-only harvest with a per-call cap and Quoter-based `minWifOut`. Robinhood Chain's first-come, first-served sequencer also helps, since there's no fee auction to jump ahead. |
| E15 | One leg has no liquidity | A partial basket | Not possible: `buy` is atomic, so the whole transaction reverts. |
| E16 | A route points at a malicious pool (a fake factory or a taxed v4 hook) | Funds drained during a swap | **Design:** pools must come from the canonical v3 factory, and slippage bounds still apply. |
| E17 | Leftover approvals or dust in the router | A later caller steals the dust | **Design:** exact approvals, the router ends every transaction with a zero balance, and unused USDG is refunded. |
| E18 | A large redeem crashes a thin pool on `sell` | The sell reverts | Redeem in kind is always available. **UI:** suggest splitting the sale or using redeem in kind. |

### Incentives and the $WIF loop
| # | Edge case | What breaks | Handling |
|---|---|---|---|
| E19 | A curator wash-trades to farm their own fee share | Fake volume | It loses money: they pay 0.30% each way and get 0.15% back. **UI:** rank by TVL, holders and performance, never by volume. |
| E20 | A whale stakes a lot of WIF to sit at #1 | A bought leaderboard | **UI:** rank = performance × holders, with stake as a tie-break or a minimum, not a multiplier. |
| E21 | A curator withdraws their stake | The basket has no backer | **Design:** a 7-day cooldown. After that the basket drops off Explore and fees stop accruing to the curator (they go 100% to burn). Holders can still redeem. |
| E22 | Misleading or offensive names ("Official NVDA"), or Robinhood brand terms | Scams, and a rule violation (no Robinhood name or logo) | **UI:** banned-term filter and a report button. The app can hide a basket, while the contract still works for holders. Stock logos are shown as ticker text, not Robinhood CDN logos. |
| E23 | The keeper goes offline | Fees pile up unharvested | Nothing is lost, since fees stay as shares in the harvester. The keeper runs as a cron job and the burn counter shows "pending". |

### Compliance and operations
| # | Edge case | What breaks | Handling |
|---|---|---|---|
| E24 | A restricted-country user on a VPN | A rules violation | **UI:** a geofence, a self-attestation and the restricted list linked. The contracts are permissionless like Uniswap's. Disclosed honestly. |
| E25 | Basket shares are freely transferable, so they could carry Reg S Stock Tokens to US persons | Regulatory risk: the strongest objection a judge could raise | Frame baskets as **non-custodial recipes** that nobody manages, with an immutable composition and no discretion. Gate the app, document the risk, and present it as a hackathon prototype. |
| E26 | The public RPC rate-limits during judging | The app looks broken | Use a free QuickNode or Alchemy tier (QuickNode's devrel is a judge). Read the chain directly when the indexer lags. |
| E27 | A bug found after edits lock on Nov 12 | We can't change the submission text | The live link can still point at a v2 deployment, and the contracts have no admin over funds. Avoid upgradeable proxies. |

## 8. Stonkbrokers Pair Tokens and v4 hooks

**What's live (checked Nov 5):**
- **Pair Tokens via the factory are live.** The factory is at `0x282c…5B38` and has code onchain. A Pair Token is an ERC-20 that wraps a **full-range position in a hookless 1% Uniswap v4 pool**. It auto-compounds, and **10% of the LP fees buy back $STONKBROKER**. Mint and redeem are fee-free, and mint works with one side via a zap.
- **The Pair Token *hook* is not live.** Hookr's page lists it as "coming soon / not deployed". So the live Pair Tokens aren't a hook product: they're an LP wrapper. Hookr's other StonkBrokers hooks (Battle, Strategy, Smart LP, Fractional) have addresses but no audits listed.

**Should Flatpack use them? Not in the core. Yes as one stretch feature.**

Why not as components or core plumbing:
- A Pair Token is an **LP position**, not stock. Putting one in a basket adds impermanent loss and a 1% fee pool, which breaks "a basket is just the stocks".
- It would add an **unaudited third-party contract** to the "redeem always works" path, which is our main security claim to the judges.
- 10% of fees go to **$STONKBROKER**, not $WIF. Judges are scoring $WIF utility, and that leaks part of the flywheel to another token.

**Where it does help (stretch S1): "List on WIF".**
- One click creates a **Basket/WIF Pair Token** through the Stonkbrokers factory. Every basket then gets a **secondary market quoted in $WIF**: anyone can trade basket shares for WIF without touching the 8 underlying pools.
- Curators can put their **WIF stake into that pool** so it earns the 1% fees instead of sitting idle. The stake becomes the basket's liquidity.
- This adds a third source of WIF demand, because trading baskets needs WIF. It also reuses an ecosystem primitive, which judges tend to like.
- **Day-1 check before committing:** read the factory ABI (Blockscout is behind Cloudflare from here, so use the UI or Sourcify) and confirm it accepts arbitrary ERC-20 pairs.

**Our own hook (stretch S2, worth more than S1 for this hackathon): `FlatpackHook`.**
- A small v4 hook on Basket/WIF pools. On `afterSwap` it takes a 0.30% hook fee and sends it into the same harvester: half burned, half to the curator.
- **Secondary trading then feeds the $WIF flywheel too**, not only mint and redeem. It also qualifies Flatpack for the "hooks and defi" category honestly, and keeps 100% of the value in $WIF.
- If S2 ships, it replaces S1 (we'd create our own pool instead of a Pair Token). If time is short, S1 is about half a day. S2 is about 1.5 days including fork tests.

**Priority:** both S1 and S2 now rank *below* the §10 upgrades. Build the hook only if Day 6 has room left.

## 9. Risks
| Risk | Mitigation |
|---|---|
| Thin liquidity for long-tail Stock Tokens | Allowlist only components with deep USDG pools (NVDA's USDG pool holds about $2M). Expand later. |
| A sandwich attack on harvest | Batch it, cap the amount per call, require `minWifOut` and use the Quoter. |
| Regulatory perception | Geofence the restricted list, avoid "investment advice" wording, show the disclaimer, and avoid Robinhood's brand. |
| Building alone in seven days | Fixed-unit baskets keep the contracts small. The scope cuts above are already ranked. |

## 10. Upgrades: making $WIF necessary (added Nov 5)

### 10.1 Honest assessment of the plan before these upgrades
**Strong:** a real gap (no baskets exist), a security story judges can verify (no oracle in mint and redeem, redeem works even when a token is paused), and careful handling of Stock Token details.

**Weak, measured against "a real reason to use $wif":**
1. **$WIF was passive.** Investors pay in USDG, and the protocol buys and burns $WIF out of sight. Nearly every other entry also "burns $WIF", so this doesn't stand out. Stonkbrokers works because **the token pays its holders**: activation fees are 50% burned, and activated NFTs earn Stock Token rewards. People hold the token *because of what it pays them*.
2. **Weak retention.** A basket is bought once and held. The rules want "a product people keep coming back to."
3. **Curators were paid for volume, not skill.** That rewards marketing over good picks.

### 10.2 The upgrades (ranked)

**U1. $WIF Dividends (the headline innovation, about 1.5 days)**
> *Stonkbrokers pays its holders in stocks. Flatpack pays stockholders in $WIF.*
- When a basket is created, the curator picks the dividend mode: **reinvest** (the default stock behaviour) or **pay in $WIF**.
- In $WIF mode, when a component's `uiMultiplier` rises because of a cash dividend, the dividend portion of the basket's raw balance (`balance × (1 − oldMult/newMult)`) is skimmed. The keeper sells it to USDG, buys $WIF, and **streams it to basket holders**. The accounting is a standard rewards-per-share accumulator hooked into ERC-20 transfers.
- **Telling a dividend apart from a split without trusting anyone:** a quarterly dividend moves the multiplier by under 3%. Splits move it by 2× or more (SOXX does a 3:1 split today), and reverse splits move it down. The contract treats only increases of **≤3%** as skimmable. Anything else simply resets the baseline. The corporate-actions API is used only to label the event in the UI.
- Units are tracked as **share-equivalents** (raw units × multiplier) in $WIF mode, so new minters always deposit exactly what existing shares are backed by. This stops a skim from diluting anyone.
- **Live during judging:** **COST pays a dividend on Nov 13** (round one) and **AAPL on Nov 16** (final day). The demo basket holds both, so judges can watch a real stock dividend arrive as $WIF while they score.
- $WIF benefit: it's a **recurring buy tied to real corporate cash flows**, not to hype. $WIF also lands *in users' wallets*, so they hold it.
- Retention: holders come back to claim their $WIF.

**U2. Back a basket: $WIF as the curation currency (promoted from stretch, about 1 day)**
- Any $WIF holder can stake behind a basket. The 50% that used to go to the curator now splits **20% curator, 30% backers** (pro rata, with a bonus for backing early). The other 50% is still burned.
- Explore ranks baskets by **$WIF backed × performance**, so the market of $WIF holders decides which portfolios surface.
- $WIF benefit: holding and staking $WIF is how you take part. It's a **prediction on real portfolios**, unlike Flat Street's fantasy game, because the baskets hold actual stock.

**U3. Beat the SPY or burn (about 0.5 day, the "built well" signal)**
- Each epoch is a week that **ends at Friday's close**, so the Chainlink stock feeds are fresh. The curator and backer shares are paid only if the basket **beat the SPY Stock Token** over that epoch. If it didn't, **their share is burned too**.
- Bad curators burn more $WIF, and good curators earn more. The burn rate becomes a function of skill.
- The oracle only decides how *fees* are split, never user principal, so a stale or manipulated price can't touch deposits. Feeds are checked for staleness and sequencer uptime. If a feed is stale at the end of an epoch, the share is burned (fail-safe).
- Retention: a weekly scoreboard with a Friday-close settlement is a natural "come back every week" moment.

**U4. Referrals paid in $WIF (about 2 hours)**
- Share links carry `?ref=0x…`. The router passes the referrer along, and 10% of that trade's fee goes to the referrer **in $WIF**, taken from the curator and backer share, never from the burn.
- $WIF benefit: the people promoting Flatpack on X are paid in $WIF, so marketing creates more holders.

**Considered and rejected:**
- **A fee discount for $WIF holders:** it lowers the burn, and every exchange token does it.
- **A community-voted index** with monthly recomposition: it conflicts with immutable baskets and needs migrations, which is too much for this deadline.
- **Recurring buys** (DCA): good retention, but it needs session keys or an allowance keeper. Post-hackathon.

### 10.3 The flywheel after the upgrades
```
 $WIF holders back baskets ──► the best baskets surface ──► investors buy in USDG
        ▲                                                         │
        │                       ┌─────────────── 0.30% fee → $WIF ┤
   earn $WIF if the basket      │  50% burned                     │
   beats SPY (else burned)  ◄───┤  30% backers · 20% curator      │
        │                       └── referrers paid in $WIF        │
        │                                                         ▼
 holders receive stock dividends AS $WIF ◄── COST, AAPL... pay dividends
```
There are four ways to get $WIF (backing, curating, referring, dividends) and three sources of buy pressure (fees, dividends, demand for backing stake). All of them run on real activity.

### 10.4 Revised scope (we're building alone, so additions replace other work)
- **Core:** Basket, Factory, Router (buy only), Harvester, U1, U2, U3, U4, and the frontend.
- **Cut to post-hackathon:** `sell` to USDG (redeem in kind covers exits), the weekend AMM comparison, X cards (a plain share link), and S1/S2. The v4 hook happens only if Day 6 has room.
- **Regulatory note:** paying backers from fees makes $WIF look more security-like. Wording is "curation rewards", there are no promises of return, and everything is geofenced as before (E24, E25).
