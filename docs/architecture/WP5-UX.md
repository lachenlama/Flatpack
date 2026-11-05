# WP5: Web App UX and Technical Specification

| | |
|---|---|
| **Status** | Accepted for build (2026-11-06) |
| **Goal** | A judge can understand, trust and use Flatpack in **5 minutes**. A retail visitor from an X link can buy a basket in **3 clicks**. Every $WIF flow is **visible**. |
| **Inputs** | FLATPACK-PLAN §3/§10, ARCHITECTURE.md, `shared/abi`, `shared/units.ts`, `shared/deployments/*.json`, hackathon rules |
| **Skills applied** | `engineering:system-design` (structure), `dataviz` (chart forms, a validated palette, mark specs) |

---

## 1. Who we are designing for

### 1.1 Judges (they decide the prize, so the UX is built for them first)
The rubric: *"a real reason to use $wif, a flywheel that holds up, and something that works and is built well."* Each judge's domain predicts what they'll probe:

| Judge | Domain | What they'll look for | Where the app answers it |
|---|---|---|---|
| **ogle** | Security, co-founder of Glue | Can I lose funds? Admin keys? Oracle risk? Is redeem real? | `/proof`: the security model, verified contracts, "redeem in kind always works", IOU explainer, test and rehearsal evidence. Every action shows exactly what it calls. |
| **niro** | Multichain advisor (Pyth, MoonPay): oracles and onboarding | Are prices honest? Weekend handling? Can a newcomer get in? | Feed-freshness badges ("prices as of Fri close, markets closed"), Chainlink source links, a "Get USDG" helper, network add and switch handled for you |
| **daniel zou** | Ex-Binance, McKinsey: product and business | Is there real usage? Unit economics? A flywheel? | `/flywheel`: live KPIs (TVL, volume, $WIF bought, $WIF burned, curator earnings), the fee split explained, a recent-harvest feed |
| **glabuz** | Gaming and retail BD at Ava Labs | Is it fun? Shareable? Retail-friendly? | The weekly **Beat-SPY** scoreboard, the leaderboard, one-click **share cards for X**, referral links, plain-English copy |
| **sahil sen** | QuickNode devrel | Is it built well? Good RPC usage? Docs? | Fast pages (multicall, caching), a configurable RPC, a public read-only JSON at `/api/baskets`, and linked docs and ADRs |
| **world is flat team** | $WIF | $WIF utility and the flywheel | The burn counter on every page, "$WIF earned" on every basket, and a $WIF Dividends demo |

The community vote (people burning $WIF) counts as one judge. That's why the share cards and a "vote for Flatpack" link in the footer matter.

### 1.2 Users
| Persona | Goal | Main journey |
|---|---|---|
| **Investor** (non-US, has USDG) | Own a theme in one click | X card → basket page → connect → buy → see position and $WIF dividends → share referral |
| **Curator** | Publish a thesis and earn $WIF | Assemble → pick and weight → preview → stake $WIF → publish → share → claim |
| **$WIF backer** | Put $WIF behind good baskets | Explore → back → (warm-up) → weekly settle → claim |

## 2. Information architecture

```
/                 Home: hero, how it works (4 steps), live flywheel strip, top baskets
/explore          Leaderboard: all baskets, sort by Beat-SPY, $WIF backed or TVL
/b/[address]      Basket: the core page (§4.3)
/assemble         Create a basket (curator flow)
/me               Portfolio: positions and EVERY claimable (dividends, backing, curator, referral, IOUs)
/flywheel         Live $WIF flywheel dashboard
/proof            For judges: security model, contracts, test evidence, transaction log
/restricted       Shown to geofenced visitors
/api/baskets      Public read-only JSON (judges and devs)
/api/og/[address] Share-card image (next/og)
```
Navigation: logo · Explore · Assemble · Flywheel · Proof · [My portfolio] · [Connect]. The **burn counter** sits in the header on every page ("🔥 12,345 $WIF burned").

## 3. Visual language: "the assembly manual"
Flatpack = flat-pack furniture. The world is flat. The UI looks like a **clean assembly manual**: warm paper, black ink, numbered steps, thin line icons, generous whitespace. It's calm and trustworthy, the opposite of a casino-style DeFi dashboard, which suits a product holding stocks.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` (surface) | `#f6f3ec` | `#151513` | page and chart surface |
| `--paper-2` | `#eeeae0` | `#1e1e1b` | cards, insets |
| `--ink` | `#121212` | `#f0efec` | primary text, **primary buttons** (ink fill, paper text) |
| `--ink-2` | `#52514e` | `#c3c2b7` | secondary text |
| `--rule` | `#d9d4c7` | `#33332f` | 1px hairlines and borders |
| `--series-1` | `#2a78d6` | `#3987e5` | **the basket** (charts only) |
| `--series-2` | `#eb6834` | `#d95926` | **SPY benchmark** (charts only) |
| `--good` / `--critical` / `--warning` | `#0ca30c` / `#d03b3b` / `#fab219` | same | status, **always with an icon and label** |

- The palette was validated with the dataviz validator: blue/orange passes all gates in both modes, with CVD ΔE 24.7 light and 26.8 dark. Orange on light paper is 2.89:1, so **direct labels on lines are mandatory** (the relief rule). Series colors are **never** used for buttons or text.
- Type: system UI sans for the interface, and a monospace (`ui-monospace`) for numbers, addresses and tickers, with tabular figures.
- Step numbers: circled numerals ①②③④ in "how it works" and in multi-step transactions (Approve → Buy).
- No Robinhood logos, no Robin Neon `#ccff00`, no feather. Stock Tokens appear as **ticker chips** (monospace text), not logos.
- Dark mode is **selected** (its own steps above), follows the OS, and has a toggle.

## 4. Screens

### 4.1 Home `/`
```
┌──────────────────────────────────────────────────────────────────────┐
│ FLATPACK   Explore Assemble Flywheel Proof      🔥 12,345 WIF  [Connect]│
├──────────────────────────────────────────────────────────────────────┤
│  Build a basket of Stock Tokens.                                       │
│  Share it. Earn $WIF when people buy it.                               │
│  [Explore baskets]  [Assemble one]          on Robinhood Chain         │
│                                                                        │
│  ① Assemble   ② Share   ③ Buy in one tx   ④ Fees → $WIF: burn + earn   │
│                                                                        │
│  ┌ KPI ─────┬──────────┬──────────┬──────────┐  live, onchain          │
│  │ $WIF burned │ $WIF to curators │ TVL │ baskets │                     │
│  └──────────┴──────────┴──────────┴──────────┘                         │
│  Top this week (Beat-SPY)   [card][card][card]   → Explore             │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Explore `/explore`
A table on desktop and cards on mobile. Columns: name and tickers · **vs SPY this epoch** (▲ +1.2 pts, good with icon / ▼ −0.4 pts, critical with icon) · since launch · TVL · $WIF backed · holders · mode badge (`Reinvest` / `Pays $WIF`). Sort by Beat-SPY (default), $WIF backed, TVL or newest. Includes a 7-day sparkline (series-1, no axes, last point labelled). Empty state: "No baskets yet. **Assemble the first one** and earn $WIF from every buy."

### 4.3 Basket `/b/[address]`: the core page
```
┌ AI Picks & Shovels  [Pays $WIF]  by 0xab…cd  ·  [Share ↗] [Copy referral link]
│
│ ┌ NAV vs SPY (indexed to 100) ───────────────┐ ┌ Buy ─────────────────────┐
│ │  ── basket 104.2   - - SPY 101.1            │ │ Shares   [ 2.00 ]        │
│ │  [Since launch] [30d recipe (hypothetical)] │ │ You pay ≈ 412.37 USDG    │
│ │                                             │ │ Fee 0.30% → $WIF         │
│ └─────────────────────────────────────────────┘ │ Slippage 1% ⚙            │
│ ┌ Holdings (per share) ─────────────┐           │ ① Approve USDG  ② Buy    │
│ │ NVDA ████████████ 30.1%  0.0482   │           │ ─────────── or ───────── │
│ │ MSFT ████████     25.0%  0.0263   │           │ Redeem in kind  [ ... ]  │
│ │ …  (sorted, one hue, labels)      │           │ always available ⓘ       │
│ └───────────────────────────────────┘           └──────────────────────────┘
│ ┌ This epoch: Beat-SPY ──────┐ ┌ Backing ───────────────┐ ┌ $WIF from this basket ┐
│ │ ends Sat 02:00 UTC (3d 4h) │ │ 1.2M WIF backed · 14   │ │ burned  · to curator  │
│ │ basket +1.8% · SPY +0.6%   │ │ [Back with WIF]        │ │ to backers · dividends│
│ │ ▲ beating, rewards release │ │ warm-up explained ⓘ    │ │ recent harvests (tx)  │
│ └────────────────────────────┘ └────────────────────────┘ └───────────────────────┘
│ Market status: ● open / ◐ extended / ○ closed, prices as of Fri 20:00 ET (Chainlink)
└ Contracts: basket 0x…  [Blockscout ↗] · Not investment advice · Stock Tokens restricted in…
```
**States the page must handle** (each has explicit copy):
| State | Detection | UI |
|---|---|---|
| Markets closed or weekend | feed `updatedAt` older than 2h, or the session flag from `/rhj/prices` | ○ "Markets closed. Prices as of {time}." The buy quote warns "weekend AMM prices may differ". |
| Trading halt on a component | `isTradingHalt` | Buy disabled: "{TICKER} halted". **Redeem stays enabled.** |
| Component paused (issuer) | `paused()` | Buy disabled. Redeem shows "{TICKER} will arrive as an IOU, claim it later." |
| Corporate action in progress | `oraclePaused()` or a pending multiplier | Info banner: "{TICKER} split/dividend processing" |
| Pays $WIF basket | `mode()` | Badge, plus "Dividends paid to holders in $WIF", plus claimable in the position card |
| Wrong network | the chain id | One button: "Switch to Robinhood Chain" (adds the network if missing) |
| No USDG | balance 0 | "Get USDG on Robinhood Chain ↗" helper (links to Uniswap and the bridge docs) |
| Warm-up stake | `position.warming > 0` | "Earning from next settle (in 3d 4h)" |
| Unstake cooldown | `unlockAt` | Countdown, then [Withdraw] |

**Buy flow:**
1. `quoteBuy` simulation, which reverts with `QuoteResult`, so decode it.
2. Show the price, fee and slippage.
3. Approve exactly `maxUsdgIn`.
4. `buy`.
5. A toast with the Blockscout link.
6. The position updates.

Every write uses **simulate → wallet → wait → toast** and decodes custom errors into plain English (`ExcessiveInput` → "Price moved more than your slippage. Try again.").

### 4.4 Assemble `/assemble`
```
① Pick 2–8 Stock Tokens  [search ticker…]  (only tokens with a price feed + USDG pool)
② Set weights           NVDA [30]%  MSFT [25]% …  = 100% ✓   (bar list updates live)
③ Name it               "AI Picks & Shovels"  ·  symbol  AIPS   · dividends: (•) Reinvest ( ) Pay in $WIF
④ Preview               30-day recipe backtest vs SPY (hypothetical) · one share ≈ $100
                        units per share (from shared/units.ts, sorted by address)
⑤ Stake & publish       stake ≥ {minCuratorStake} WIF  [Approve WIF] [Publish]
```
Validation is inline: weights must sum to 100, 2–8 tokens, the name and symbol lengths, and banned terms (`robinhood`, `official`, a ticker name alone). After publishing: a celebration plus "Share your basket" (X intent with the OG card).

### 4.5 Portfolio `/me`
One table of positions (basket, shares, value, vs SPY). Then **"Claim everything"**, grouped by source with a single Claim button for each: $WIF dividends (`claimWifDividend`), backing rewards (`vault.claim`), curator rewards (`claimCurator`), referral $WIF (`claimReferral` over closed cycles), and IOUs (`claimIOU`). Each row says *why* it exists.

### 4.6 Flywheel `/flywheel`
- A hero number: **total $WIF burned** (sum of `FeesHarvested.burned` + vault burns to DEAD), plus `$WIF bought ≈ $X`.
- A KPI row: $WIF to curators · to backers · to referrers · dividends paid in $WIF · basket TVL · buy volume.
- A diagram of the flywheel (§10.3 of the plan) with live numbers on each edge.
- A feed of the latest 20 harvests and settlements with transaction links.

### 4.7 Proof `/proof` (the judges' page)
1. **Security model** in 6 bullets: in-kind redeem with no oracle; pause-proof IOUs; fee in shares; keeper can't redirect funds; no proxies; admin limited to the allowlist. Each links its ADR.
2. **Contracts**: a table of name, address, verified ✓ and Blockscout link (from `shared/deployments`).
3. **Evidence**: test counts (unit, fuzz, invariant, fork), the deploy-day rehearsal, and links to the repo docs.
4. **Live transaction log**: deploy tx, the first basket, first buy, first harvest, first burn (from events).
5. **Oracles**: the Chainlink feed per component with freshness.

### 4.8 Restricted `/restricted` and the attestation
- Geofence: the proxy (Next 16 `proxy.ts`, formerly `middleware.ts`) reads `x-vercel-ip-country`. If it's in {US, CA, GB, CH, CU, BY, IR, KP, RU, SY, UA, SS, SD, MM, VE}, rewrite to `/restricted`, except for `/proof`, `/api/*` and static assets, so judges can still read the evidence.
- First connect: a modal "I'm not a US person and not in a restricted jurisdiction. I understand Stock Tokens …" with a checkbox, remembered in localStorage.

## 5. Charts (dataviz skill: form → color → marks → interaction → a11y)
| Chart | Form | Encoding | Interaction | Accessibility |
|---|---|---|---|---|
| NAV vs SPY | Line, **both indexed to 100 at the start** (one axis, never dual) | basket = series-1 solid 2px, SPY = series-2 dashed 2px, **direct end labels** with values | Crosshair and tooltip (date, both index values, the gap in pts). Toggle: Since launch / 30d recipe (hypothetical) | Legend present, a "View as table" toggle, an `aria-label` summary |
| Holdings | Sorted horizontal bar list, **one hue** (series-1), 2px gap, 4px rounded ends at the data end | Ticker label left, % and units right | Hover row → token details (price, feed age, multiplier) | It's text-first, so it's readable without color |
| Sparkline (Explore) | Line, no axes, last-point dot ≥8px and label | series-1 | Hover → value | The row text carries the number |
| Flywheel KPIs | Stat tiles (not a chart) | Ink numbers, muted labels, mono tabular | Tooltip explains the source event | – |
| Beat-SPY scoreboard | Table with a status cell | ▲/▼ icon + "beating"/"behind" label + good/critical | Sortable | Never color alone |

Recessive axes and grid (`--rule`), with no chart-junk. Charts are hand-built SVG components with no chart library: small, on-brand, and they follow the mark specs exactly.

## 6. Technical architecture
```
web/ (Next.js 16 App Router, React 19, TypeScript strict)
  src/app/…                 routes (§2). Server components for reads, client components for wallet and writes
  src/lib/chain.ts          viem Chain 4663 (multicall3 from config), public client (RPC from env, default public)
  src/lib/wagmi.ts          wagmi 3: injected (EIP-6963 multi-discovery) + optional WalletConnect (if NEXT_PUBLIC_WC_PROJECT_ID)
  src/lib/deployment.ts     loads shared/deployments/{NEXT_PUBLIC_DEPLOYMENT}.json (4663 | rehearsal)
  src/lib/reads/*.ts        server-side multicall readers: listBaskets, basketDetail, vaultState, flywheelStats, events
  src/lib/history.ts        Chainlink round history → daily index series (basket units × prices vs SPY), cached
  src/lib/prices.ts         proxy to api.robinhood.com/rhj/prices + /assets (session flags, halts, multipliers), cached 15s
  src/lib/errors.ts         custom-error → plain-English map (from the ABI error names)
  src/lib/format.ts         amounts (USDG 6 decimals vs 18), percentages, time-to-epoch
  src/components/…          design system (§3) + charts (§5) + TxButton (simulate→send→wait→toast)
  src/proxy.ts              geofence (§4.8)
  ../shared/{abi,units.ts,deployments} imported directly (one source of truth with the keeper)
```
- **Data strategy:** no indexer. Server components read with multicall (`revalidate: 15s`). Events (harvests, settlements, buys) come from `getLogs` from the deployment block, in chunks of 10M blocks or fewer (an RPC limit), cached for 60s. The client refreshes position data after each transaction.
- **Writes:** wagmi `useSimulateContract` → `useWriteContract` → `useWaitForTransactionReceipt`. Exact approvals only.
- **Config:** `NEXT_PUBLIC_RPC_URL` (QuickNode-ready), `NEXT_PUBLIC_DEPLOYMENT`, `NEXT_PUBLIC_WC_PROJECT_ID` (optional), `NEXT_PUBLIC_SITE_URL`.
- **Hosting:** Vercel (free). Geo headers are available there.
- **Development without mainnet:** `tools/rehearse.sh --keep` leaves the local fork node running with `shared/deployments/rehearsal.json`, and the app runs against it (`NEXT_PUBLIC_DEPLOYMENT=rehearsal`, RPC `http://127.0.0.1:8545`).

## 7. Copy rules
- Say "Stock Tokens" (never "tokenized stocks") and "Robinhood Chain" in full. Never just "Robinhood".
- Don't say "invest", "returns", "profit" or "guaranteed". Use "performance", "vs SPY" and "hypothetical" for backtests.
- The footer on every page: "Flatpack is not affiliated with Robinhood Markets, Inc. Stock Tokens are not available to US persons or in restricted jurisdictions. Nothing here is investment advice. $WIF has no promise of value."
- Plain-English errors and empty states. Every number has a source tooltip.

## 8. Quality bar
- Lighthouse: performance ≥ 85 on mobile, accessibility ≥ 95.
- Keyboard-navigable, with visible focus. Charts have table views.
- `next build` clean, `tsc --noEmit` clean, and unit tests (node:test) for `format`, `errors`, `history` math and `deployment` loading.
- Works with MetaMask and Rabby. Network add and switch are tested.
