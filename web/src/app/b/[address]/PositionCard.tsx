"use client";

import type { Abi } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { basketAbi } from "../../../../../shared/abi/index.ts";
import { Card } from "../../../components/ui/Card.tsx";
import { TxButton } from "../../../components/tx/index.ts";
import { useWalletState } from "../../../components/wallet/ConnectButton.tsx";
import { formatAmount, formatShares, formatUsd, formatWif } from "../../../lib/format.ts";
import { useRefresh } from "./hooks.ts";
import type { BasketView } from "./types.ts";
import s from "./basket.module.css";

/** Your position: shares, value, pending $WIF dividends (claim) and IOUs (claim). */
export function PositionCard({ view }: { view: BasketView }) {
  const { address } = useWalletState();
  const refresh = useRefresh();
  const enabled = !!address;

  const bal = useReadContract({ address: view.address, abi: basketAbi, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled } });
  const div = useReadContract({
    address: view.address,
    abi: basketAbi,
    functionName: "pendingWifDividend",
    args: address ? [address] : undefined,
    query: { enabled: enabled && view.mode === "PayInWif" },
  });
  const owed = useReadContracts({
    contracts: address ? view.comps.map((c) => ({ address: view.address, abi: basketAbi, functionName: "owed", args: [address, c.token] }) as const) : [],
    query: { enabled },
  });

  if (!address) return null;

  const shares = (bal.data as bigint | undefined) ?? 0n;
  const dividend = (div.data as bigint | undefined) ?? 0n;
  const ious = view.comps
    .map((c, i) => ({ c, amount: owed.data?.[i]?.status === "success" ? (owed.data[i].result as bigint) : 0n }))
    .filter((x) => x.amount > 0n);
  const value = (Number(shares) / 1e18) * view.navPerShareUsd;

  return (
    <Card title="Your position">
      <div data-testid="position-shares">
        <span className={s.big}>{formatShares(shares)}</span> <span className="muted">shares</span>
      </div>
      {shares > 0n ? (
        <div className={s.row}>
          <span>Value</span>
          <span className="num">≈ {formatUsd(value)}</span>
        </div>
      ) : (
        <p className="muted">You hold no shares of this basket yet.</p>
      )}

      {view.mode === "PayInWif" ? (
        <div style={{ marginTop: 12 }}>
          <div className={s.row}>
            <span>Pending $WIF dividends</span>
            <span className="num">{formatWif(dividend, { maxFraction: 4 })}</span>
          </div>
          <TxButton
            size="sm"
            variant="ghost"
            disabled={dividend === 0n}
            disabledReason="Nothing to claim yet. Dividends arrive when a component pays one."
            onSuccess={refresh}
            steps={[
              {
                id: "claim-div",
                label: "Claim $WIF dividends",
                call: ({ account }) => ({ address: view.address, abi: basketAbi as Abi, functionName: "claimWifDividend", args: [account] }),
              },
            ]}
          />
        </div>
      ) : null}

      {ious.length ? (
        <div style={{ marginTop: 12 }}>
          <div className={s.notice} role="status">
            IOUs: a Stock Token was paused when you redeemed, so its share is owed to you. Claim it once the token transfers again.
          </div>
          {ious.map(({ c, amount }) => (
            <div key={c.token} style={{ marginBottom: 8 }}>
              <div className={s.row}>
                <span>{c.ticker} owed</span>
                <span className="num">{formatAmount(amount, 18, { maxFraction: 6 })}</span>
              </div>
              <TxButton
                size="sm"
                variant="ghost"
                onSuccess={refresh}
                steps={[
                  {
                    id: `iou-${c.ticker}`,
                    label: `Claim ${c.ticker} IOU`,
                    call: ({ account }) => ({ address: view.address, abi: basketAbi as Abi, functionName: "claimIOU", args: [c.token, account] }),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
