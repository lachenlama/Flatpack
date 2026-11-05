"use client";

import { useConnection } from "wagmi";
import type { Abi, Address } from "viem";
import { basketAbi } from "../../../../shared/abi/index.ts";
import { NETWORK } from "../../lib/chain.ts";
import { getDeployment } from "../../lib/deployment.ts";
import { approveStep, TxButton } from "../../components/tx/index.ts";

/** Exact approval amount used by the e2e (1.234567 USDG): unusual on purpose so the assertion cannot match by accident. */
export const E2E_APPROVE_AMOUNT = 1_234_567n;

/** Two-step flow: (1) approve USDG to the router (exact), (2) `basket.sync()`, a harmless write. */
export function E2EPanel({ basket }: { basket: Address }) {
  const { address, isConnected } = useConnection();
  const router = getDeployment().addresses.FlatpackRouter;
  return (
    <div data-testid="e2e-panel">
      <p data-testid="e2e-state">{isConnected ? `connected:${address}` : "disconnected"}</p>
      <p className="muted">
        basket <span data-testid="e2e-basket">{basket}</span>, spender <span data-testid="e2e-spender">{router}</span>
      </p>
      <TxButton
        steps={[
          approveStep({ token: NETWORK.usdg.address, spender: router, amount: E2E_APPROVE_AMOUNT, symbol: "USDG" }),
          { id: "sync", label: "Sync basket", call: { address: basket, abi: basketAbi as Abi, functionName: "sync" } },
        ]}
      >
        Approve and sync
      </TxButton>
    </div>
  );
}
