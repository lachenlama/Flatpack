"use client";

import { useEffect, useState } from "react";
import { zeroAddress, type Abi } from "viem";
import { useReadContract } from "wagmi";
import { flatpackRouterAbi } from "../../../../../shared/abi/index.ts";
import { Card } from "../../../components/ui/Card.tsx";
import { InfoTip } from "../../../components/ui/Tooltip.tsx";
import { approveStep, TxButton } from "../../../components/tx/index.ts";
import { useWalletState } from "../../../components/wallet/ConnectButton.tsx";
import { NETWORK } from "../../../lib/chain.ts";
import { getDeployment } from "../../../lib/deployment.ts";
import { erc20Abi } from "../../../lib/erc20.ts";
import { describeError } from "../../../lib/errors.ts";
import { formatShares, formatUsdg } from "../../../lib/format.ts";
import { quoteBuyUsdg, withSlippage } from "../../../lib/quote.ts";
import { parseAmount, useRefresh } from "./hooks.ts";
import { buyBlockReason, corporateNotice, MIN_MINT_SHARES } from "./states.ts";
import type { BasketView } from "./types.ts";
import s from "./basket.module.css";

const FEE_BPS = 30n;
const SLIPPAGE_CHOICES = [50, 100, 300];

type Quote = { state: "idle" } | { state: "loading" } | { state: "ok"; usdg: bigint } | { state: "error"; message: string };

/** Buy panel: quoteBuy (decoded QuoteResult), slippage, (1) exact Approve USDG, (2) Buy, optional ?ref= referrer. */
export function BuyPanel({ view }: { view: BasketView }) {
  const { address } = useWalletState();
  const refresh = useRefresh();
  const router = getDeployment().addresses.FlatpackRouter;
  const [text, setText] = useState("1");
  const [bps, setBps] = useState(100);
  const [tick, setTick] = useState(0);
  const [quote, setQuote] = useState<Quote>({ state: "idle" });

  const shares = parseAmount(text, 18);
  const sharesOk = shares !== undefined && shares >= MIN_MINT_SHARES;

  useEffect(() => {
    if (!sharesOk || shares === undefined) {
      setQuote({ state: "idle" });
      return;
    }
    let live = true;
    setQuote({ state: "loading" });
    const t = setTimeout(() => {
      quoteBuyUsdg(view.address, shares, address)
        .then((usdg) => live && setQuote({ state: "ok", usdg }))
        .catch((e: unknown) => live && setQuote({ state: "error", message: describeError(e) }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [sharesOk, shares, view.address, address, tick]);

  const usdgBal = useReadContract({
    address: NETWORK.usdg.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const balance = usdgBal.data as bigint | undefined;

  const halted = view.comps.filter((c) => c.halted).map((c) => c.ticker);
  const paused = view.comps.filter((c) => c.paused).map((c) => c.ticker);
  const corporate = view.comps.filter((c) => c.corporate).map((c) => c.ticker);
  const maxIn = quote.state === "ok" ? withSlippage(quote.usdg, bps) : undefined;
  const referrer = view.ref && view.ref.toLowerCase() !== address?.toLowerCase() ? view.ref : zeroAddress;

  const reason = buyBlockReason({
    shares,
    halted,
    paused,
    navValid: view.navValid,
    quote: quote.state === "error" ? { state: "error", message: quote.message } : { state: quote.state },
    maxIn,
    usdgBalance: balance,
  });

  const feeShares = shares !== undefined ? (shares * FEE_BPS) / 10_000n : 0n;

  return (
    <Card title="Buy">
      <div className={s.field}>
        <label htmlFor="buy-shares">Shares</label>
        <input
          id="buy-shares"
          className={s.input}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-testid="buy-shares"
        />
      </div>

      {halted.length ? <div className={`${s.notice} ${s.warn}`} role="status">{halted.join(", ")} halted. Buy is disabled; redeem stays on.</div> : null}
      {paused.length ? <div className={`${s.notice} ${s.warn}`} role="status">{paused.join(", ")} paused by the issuer. Buy is disabled.</div> : null}
      {corporate.length ? (
        <div className={s.notice} role="status">
          {corporateNotice(corporate)}. Quotes can move until it settles.
        </div>
      ) : null}
      {view.marketClosed ? (
        <div className={s.notice} role="status">
          Markets are closed: weekend AMM prices may differ from the last Chainlink price.
        </div>
      ) : null}

      <div className={s.row} data-testid="buy-quote">
        <span>You pay</span>
        <span className="num">
          {quote.state === "ok" ? `≈ ${formatUsdg(quote.usdg)} USDG` : quote.state === "loading" ? "…" : quote.state === "error" ? "no quote" : "n/a"}
        </span>
      </div>
      <div className={s.row}>
        <span>
          Fee <InfoTip content="0.30% of the shares, taken in shares. The harvester sells it for $WIF: half is burned, the rest rewards curators, backers and referrers." />
        </span>
        <span className="num">0.30% → $WIF {shares !== undefined && sharesOk ? `(${formatShares(feeShares)} sh)` : ""}</span>
      </div>
      <div className={s.row}>
        <span>You receive</span>
        <span className="num">{shares !== undefined && sharesOk ? `${formatShares(shares - feeShares)} shares` : "n/a"}</span>
      </div>
      <div className={s.row}>
        <span>Most you can pay</span>
        <span className="num">{maxIn !== undefined ? `${formatUsdg(maxIn)} USDG` : "n/a"}</span>
      </div>
      <div className={s.slip} role="group" aria-label="Slippage tolerance">
        <span>Slippage</span>
        {SLIPPAGE_CHOICES.map((b) => (
          <button key={b} type="button" aria-pressed={bps === b} onClick={() => setBps(b)}>
            {b / 100}%
          </button>
        ))}
        <InfoTip content="You approve and can spend at most the quote plus this tolerance. Unused USDG is refunded in the same transaction." />
      </div>
      {referrer !== zeroAddress ? (
        <p className={`muted ${s.small}`}>
          Referred by <span className="mono">{referrer.slice(0, 6)}…{referrer.slice(-4)}</span> (10% of the fee).
        </p>
      ) : null}

      {balance === 0n ? (
        <div className={s.notice} role="status">
          You hold no USDG on Robinhood Chain.{" "}
          <a href="https://app.uniswap.org/swap" target="_blank" rel="noopener noreferrer">
            Get USDG on Robinhood Chain {"↗"}
          </a>
          {" · "}
          <a href="https://docs.robinhood.com/chain/" target="_blank" rel="noopener noreferrer">
            Bridge docs {"↗"}
          </a>
        </div>
      ) : null}

      <TxButton
        disabled={reason !== undefined}
        disabledReason={reason}
        onSuccess={() => {
          setTick((n) => n + 1);
          refresh();
        }}
        steps={[
          approveStep({ token: NETWORK.usdg.address, spender: router, amount: maxIn ?? 0n, symbol: "USDG" }),
          {
            id: "buy",
            label: "Buy",
            successTitle: "Buy confirmed",
            call: async ({ account, publicClient }) => ({
              address: router,
              abi: flatpackRouterAbi as Abi,
              functionName: "buy",
              args: [
                {
                  basket: view.address,
                  shares: shares ?? 0n,
                  maxUsdgIn: maxIn ?? 0n,
                  receiver: account,
                  referrer,
                  // 20 minutes from the CHAIN's clock (not the browser's), so a skewed local clock can never make the buy expire.
                  deadline: (await publicClient.getBlock({ blockTag: "latest" })).timestamp + 1200n,
                },
              ],
            }),
          },
        ]}
      >
        Approve and buy
      </TxButton>
    </Card>
  );
}
