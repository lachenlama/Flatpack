"use client";

import type { ReactNode } from "react";
import type { Hex } from "viem";
import { Button } from "../ui/Button.tsx";
import { ConnectButton, SwitchChainButton, useWalletState } from "../wallet/ConnectButton.tsx";
import { useTx, type TxStep } from "./useTx.ts";

const CIRCLED = ["①", "②", "③", "④", "⑤"];

/** Props of {@link TxButton}. */
export interface TxButtonProps {
  /** One step = a plain action button. Several steps = ① Approve ② Action, run in order from one click. */
  steps: TxStep[];
  /** Button text when idle (default: the last step's label). */
  children?: ReactNode;
  disabled?: boolean;
  /** Why it is disabled, shown under the button (e.g. "NVDA halted"). */
  disabledReason?: ReactNode;
  variant?: "primary" | "ghost";
  size?: "md" | "sm";
  /** Called after the last step confirmed (refetch reads here). */
  onSuccess?: (hash: Hex) => void;
}

/**
 * The standard write button. Handles: not connected (Connect), wrong chain (Switch to Robinhood Chain), simulate, wallet,
 * wait, toast with Blockscout link, decoded errors, a pending state, and a ①②-numbered step list for multi-step flows.
 */
export function TxButton({ steps, children, disabled, disabledReason, variant = "primary", size = "md", onSuccess }: TxButtonProps) {
  const { isConnected, onWrongChain } = useWalletState();
  const tx = useTx({ onSuccess });
  const last = steps[steps.length - 1];

  if (!isConnected) return <ConnectButton />;
  if (onWrongChain) return <SwitchChainButton size={size} />;

  const label = tx.pending ? (steps[tx.stepIndex]?.label ?? "Working") + "…" : (children ?? last?.label ?? "Confirm");
  return (
    <div>
      {steps.length > 1 ? (
        <ol style={{ listStyle: "none", margin: "0 0 8px", padding: 0, display: "flex", gap: 12, fontSize: "0.9rem" }} aria-label="Steps">
          {steps.map((st, i) => (
            <li key={st.id} aria-current={tx.pending && tx.stepIndex === i ? "step" : undefined} style={{ fontWeight: tx.stepIndex === i && tx.pending ? 700 : 400 }}>
              <span aria-hidden="true">{CIRCLED[i]} </span>
              {st.label}
              {tx.completed.includes(st.id) ? <span aria-label="done"> {"✓"}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      <Button variant={variant} size={size} loading={tx.pending} disabled={disabled} onClick={() => void tx.run(steps)}>
        {label}
      </Button>
      {disabled && disabledReason ? <p className="muted" style={{ marginTop: 6, fontSize: "0.85rem" }}>{disabledReason}</p> : null}
      {tx.phase === "error" && tx.error ? (
        <p role="alert" style={{ marginTop: 6, fontSize: "0.9rem" }}>
          <span aria-hidden="true">{"▼ "}</span>
          {tx.error}
        </p>
      ) : null}
    </div>
  );
}
