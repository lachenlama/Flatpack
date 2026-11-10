"use client";

import { useState } from "react";
import type { Abi } from "viem";
import { useReadContract } from "wagmi";
import { backingVaultAbi } from "../../../../../shared/abi/index.ts";
import { Card } from "../../../components/ui/Card.tsx";
import { Countdown } from "../../../components/ui/Countdown.tsx";
import { InfoTip } from "../../../components/ui/Tooltip.tsx";
import { approveStep, TxButton } from "../../../components/tx/index.ts";
import { useWalletState } from "../../../components/wallet/ConnectButton.tsx";
import { NETWORK } from "../../../lib/chain.ts";
import { getDeployment } from "../../../lib/deployment.ts";
import { erc20Abi } from "../../../lib/erc20.ts";
import { formatWif } from "../../../lib/format.ts";
import { parseAmount, useNow, useRefresh } from "./hooks.ts";
import type { BasketView } from "./types.ts";
import s from "./basket.module.css";

type Pos = { active: bigint; warming: bigint; pendingUnstake: bigint; unlockAt: bigint | number };

/** Backing card: stake $WIF (with warm-up messaging), request unstake, cooldown countdown, withdraw and claim. */
export function BackingCard({ view, backed, warmingTotal }: { view: BasketView; backed: bigint; warmingTotal: bigint }) {
  const { address } = useWalletState();
  const refresh = useRefresh();
  const now = useNow();
  const vault = getDeployment().addresses.BackingVault;
  const [stakeText, setStakeText] = useState("100");
  const [unstakeText, setUnstakeText] = useState("");

  const pos = useReadContract({
    address: vault,
    abi: backingVaultAbi,
    functionName: "position",
    args: address ? [view.address, address] : undefined,
    query: { enabled: !!address },
  });
  const pending = useReadContract({
    address: vault,
    abi: backingVaultAbi,
    functionName: "pendingRewards",
    args: address ? [view.address, address] : undefined,
    query: { enabled: !!address },
  });
  const wifBal = useReadContract({
    address: NETWORK.wif.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const p = pos.data as Pos | undefined;
  const claimable = (pending.data as bigint | undefined) ?? 0n;
  const wif = wifBal.data as bigint | undefined;
  const stake = parseAmount(stakeText, 18);
  const unstake = parseAmount(unstakeText, 18);
  const unlockAt = p ? Number(p.unlockAt) : 0;
  const cooled = !!p && p.pendingUnstake > 0n && now > 0 && now >= unlockAt;

  let stakeReason: string | undefined;
  if (stake === undefined || stake === 0n) stakeReason = "Enter an amount of $WIF.";
  else if (wif !== undefined && stake > wif) stakeReason = `You hold ${formatWif(wif, { maxFraction: 2 })} $WIF.`;
  let unstakeReason: string | undefined;
  if (unstake === undefined || unstake === 0n) unstakeReason = "Enter the $WIF to unstake.";
  else if (p && unstake > p.active + p.warming) unstakeReason = "That is more than your stake.";

  return (
    <Card title="Backing">
      <div className={s.row}>
        <span>
          $WIF backed <InfoTip content="Sum of active and warming stake in the BackingVault for this basket." />
        </span>
        <span className="num" data-testid="backed-total">{formatWif(backed, { maxFraction: 0 })}</span>
      </div>
      {warmingTotal > 0n ? (
        <div className={`${s.row} ${s.small}`}>
          <span>of which warming up</span>
          <span className="num">{formatWif(warmingTotal, { maxFraction: 0 })}</span>
        </div>
      ) : null}
      <p className={`muted ${s.small}`}>
        Back this basket with $WIF to share its weekly rewards when it beats SPY. New stake warms up until the next settle, and unstaking has a 7-day cooldown.
      </p>

      {!address ? (
        <p className={`muted ${s.small}`}>Connect a wallet to back this basket.</p>
      ) : (
        <>
          {p && p.warming > 0n ? (
            <div className={s.notice} role="status" data-testid="warmup-msg">
              Earning from next settle (in <Countdown to={view.nextSettleAt} done="due now" />). Warming:{" "}
              <span className="num">{formatWif(p.warming, { maxFraction: 2 })}</span> $WIF.
            </div>
          ) : null}
          {p ? (
            <div className={s.row}>
              <span>Your stake (earning)</span>
              <span className="num">{formatWif(p.active, { maxFraction: 2 })} $WIF</span>
            </div>
          ) : null}

          <div className={s.field}>
            <label htmlFor="stake-wif">Back with $WIF</label>
            <input id="stake-wif" className={s.input} inputMode="decimal" autoComplete="off" value={stakeText} onChange={(e) => setStakeText(e.target.value)} data-testid="stake-input" />
          </div>
          {wif === 0n ? <p className={`muted ${s.small}`}>You hold no $WIF on Robinhood Chain.</p> : null}
          <TxButton
            disabled={stakeReason !== undefined}
            disabledReason={stakeReason}
            onSuccess={refresh}
            steps={[
              approveStep({ token: NETWORK.wif.address, spender: vault, amount: stake ?? 0n, symbol: "WIF" }),
              {
                id: "stake",
                label: "Back with WIF",
                successTitle: "Backing confirmed",
                call: { address: vault, abi: backingVaultAbi as Abi, functionName: "stake", args: [view.address, stake ?? 0n] },
              },
            ]}
          >
            Approve and back with $WIF
          </TxButton>

          {p && (p.active > 0n || p.warming > 0n) ? (
            <div style={{ marginTop: 16 }}>
              <div className={s.field}>
                <label htmlFor="unstake-wif">Request unstake</label>
                <input id="unstake-wif" className={s.input} inputMode="decimal" autoComplete="off" value={unstakeText} onChange={(e) => setUnstakeText(e.target.value)} />
              </div>
              <TxButton
                variant="ghost"
                size="sm"
                disabled={unstakeReason !== undefined}
                disabledReason={unstakeReason}
                onSuccess={refresh}
                steps={[
                  {
                    id: "unstake",
                    label: "Request unstake",
                    call: { address: vault, abi: backingVaultAbi as Abi, functionName: "requestUnstake", args: [view.address, unstake ?? 0n] },
                  },
                ]}
              />
            </div>
          ) : null}

          {p && p.pendingUnstake > 0n ? (
            <div style={{ marginTop: 16 }} data-testid="cooldown">
              <div className={s.row}>
                <span>Unstaking</span>
                <span className="num">{formatWif(p.pendingUnstake, { maxFraction: 2 })} $WIF</span>
              </div>
              <div className={s.row}>
                <span>Cooldown</span>
                <span>
                  <Countdown to={unlockAt} done="ready to withdraw" />
                </span>
              </div>
              <TxButton
                size="sm"
                disabled={!cooled}
                disabledReason="Withdraw unlocks when the 7-day cooldown ends."
                onSuccess={refresh}
                steps={[{ id: "withdraw", label: "Withdraw", call: { address: vault, abi: backingVaultAbi as Abi, functionName: "withdraw", args: [view.address] } }]}
              />
            </div>
          ) : null}

          <div style={{ marginTop: 16 }}>
            <div className={s.row}>
              <span>Backing rewards</span>
              <span className="num">{formatWif(claimable, { maxFraction: 4 })} $WIF</span>
            </div>
            <TxButton
              size="sm"
              variant="ghost"
              disabled={claimable === 0n}
              disabledReason="Rewards release at a weekly settle when this basket beats SPY."
              onSuccess={refresh}
              steps={[
                {
                  id: "claim",
                  label: "Claim backing rewards",
                  call: ({ account }) => ({ address: vault, abi: backingVaultAbi as Abi, functionName: "claim", args: [view.address, account] }),
                },
              ]}
            />
          </div>
        </>
      )}
    </Card>
  );
}
