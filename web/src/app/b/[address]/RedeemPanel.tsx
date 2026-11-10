"use client";

import { useState } from "react";
import { formatUnits, type Abi } from "viem";
import { useReadContract } from "wagmi";
import { basketAbi } from "../../../../../shared/abi/index.ts";
import { Button } from "../../../components/ui/Button.tsx";
import { InfoTip } from "../../../components/ui/Tooltip.tsx";
import { TxButton } from "../../../components/tx/index.ts";
import { useWalletState } from "../../../components/wallet/ConnectButton.tsx";
import { formatAmount } from "../../../lib/format.ts";
import { ConnectGate } from "./ConnectGate.tsx";
import { parseAmount, useRefresh } from "./hooks.ts";
import { iouNotice } from "./states.ts";
import type { BasketView } from "./types.ts";
import s from "./basket.module.css";

/** Redeem in kind: burns shares and returns the component Stock Tokens. No oracle, always available; paused legs become IOUs. */
export function RedeemPanel({ view }: { view: BasketView }) {
  const { address, isConnected } = useWalletState();
  const refresh = useRefresh();
  const [text, setText] = useState("");
  const shares = parseAmount(text, 18);

  const bal = useReadContract({
    address: view.address,
    abi: basketAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const held = bal.data as bigint | undefined;

  const preview = useReadContract({
    address: view.address,
    abi: basketAbi,
    functionName: "previewRedeem",
    args: shares !== undefined && address ? [shares, address] : undefined,
    query: { enabled: !!address && shares !== undefined && shares > 0n },
  });
  const amounts = preview.data as readonly bigint[] | undefined;

  const paused = view.comps.filter((c) => c.paused);
  let reason: string | undefined;
  if (shares === undefined || shares === 0n) reason = "Enter the shares to redeem.";
  else if (held !== undefined && shares > held) reason = "That is more shares than you hold.";

  return (
    <div>
      <p className={`muted ${s.small}`}>
        Redeem in kind: always available. You receive the Stock Tokens themselves (0.30% fee in shares).{" "}
        <InfoTip content="Burns your shares and sends you the underlying Stock Tokens directly. It needs no oracle and no pool, so it works even when markets are closed or a price feed is down." />
      </p>
      <div className={s.field}>
        <label htmlFor="redeem-shares">Shares to redeem</label>
        <div className={s.inline}>
          <input
            id="redeem-shares"
            className={`${s.input} ${s.inputLg}`}
            style={{ flex: 1, minWidth: 0 }}
            inputMode="decimal"
            autoComplete="off"
            placeholder={held !== undefined ? `You hold ${formatAmount(held, 18, { maxFraction: 4 })}` : "0.0"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="redeem-shares"
          />
          <Button variant="ghost" size="sm" disabled={!held} onClick={() => held !== undefined && setText(formatUnits(held, 18))}>
            Max
          </Button>
        </div>
      </div>
      {amounts && amounts.length === view.comps.length ? (
        <ul className={s.list} aria-label="You would receive">
          {view.comps.map((c, i) => (
            <li key={c.token}>
              <span className="mono">{c.ticker}</span>
              <span className="num">
                {formatAmount(amounts[i] as bigint, 18, { maxFraction: 6 })}
                {c.paused ? " (IOU)" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {paused.length ? (
        <div className={`${s.notice} ${s.warn}`} role="status">
          {iouNotice(paused.map((c) => c.ticker))}
        </div>
      ) : null}
      {!isConnected ? (
        <ConnectGate label="Connect wallet to redeem" />
      ) : (
      <TxButton
        disabled={reason !== undefined}
        disabledReason={reason}
        onSuccess={refresh}
        steps={[
          {
            id: "redeem",
            label: "Redeem",
            successTitle: "Redeem confirmed",
            call: ({ account }) => ({
              address: view.address,
              abi: basketAbi as Abi,
              functionName: "redeem",
              args: [shares ?? 0n, account],
            }),
          },
        ]}
      >
        Redeem in kind
      </TxButton>
      )}
    </div>
  );
}
