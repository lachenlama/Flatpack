"use client";

import { useCallback, useRef, useState } from "react";
import type { Abi, Address, Hex, PublicClient } from "viem";
import { useConnection, usePublicClient, useWalletClient } from "wagmi";
import { explorerTx, robinhoodChain } from "../../lib/chain.ts";
import { erc20Abi } from "../../lib/erc20.ts";
import { describeError } from "../../lib/errors.ts";
import { useToast } from "../ui/Toast.tsx";

/** A contract call. */
export interface TxCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

/** Context handed to step callbacks. */
export interface TxContext {
  account: Address;
  publicClient: PublicClient;
}

/** One transaction in a (possibly multi-step) flow. Steps run in order; each is simulated first. */
export interface TxStep {
  id: string;
  /** Shown on the button/progress, e.g. "Approve USDG" or "Buy". */
  label: string;
  /** The exact call (or a function building it from fresh state). */
  call: TxCall | ((ctx: TxContext) => TxCall | Promise<TxCall>);
  /** Return true to skip this step (e.g. allowance already sufficient). */
  skip?: (ctx: TxContext) => boolean | Promise<boolean>;
  /** Toast title on success (default `${label} confirmed`). */
  successTitle?: string;
}

/** Lifecycle of a run. */
export type TxPhase = "idle" | "simulating" | "signing" | "confirming" | "done" | "error";

/** State returned by {@link useTx}. */
export interface TxState {
  phase: TxPhase;
  /** Index of the step currently executing (or last executed). */
  stepIndex: number;
  /** Ids of completed (or skipped) steps. */
  completed: string[];
  /** Hash of the last submitted transaction. */
  hash?: Hex;
  /** Plain-English error from the last failure. */
  error?: string;
  /** True while any phase other than idle/done/error. */
  pending: boolean;
}

/** Options of {@link useTx}. */
export interface UseTxOptions {
  /** Called after the LAST step confirmed. Use it to refetch reads. */
  onSuccess?: (hash: Hex) => void;
}

/**
 * Builds an exact-amount ERC-20 approval step that is skipped when the allowance already covers `amount`.
 * Exact approvals only (never infinite).
 */
export function approveStep(opts: { token: Address; spender: Address; amount: bigint; symbol: string }): TxStep {
  return {
    id: `approve-${opts.symbol}`,
    label: `Approve ${opts.symbol}`,
    call: { address: opts.token, abi: erc20Abi as Abi, functionName: "approve", args: [opts.spender, opts.amount] },
    skip: async ({ account, publicClient }) => {
      const allowance = (await publicClient.readContract({
        address: opts.token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, opts.spender],
      })) as bigint;
      return allowance >= opts.amount;
    },
  };
}

/**
 * Write helper: simulate, then wallet, then wait for the receipt, then toast with the Blockscout link; custom errors are decoded
 * into plain English (`ExcessiveInput` becomes "Price moved more than your slippage. Try again."). Supports multi-step flows
 * (① Approve ② Action).
 *
 * ```ts
 * const tx = useTx({ onSuccess: () => router.refresh() });
 * await tx.run([approveStep({...}), { id: "buy", label: "Buy", call: {...} }]);
 * ```
 */
export function useTx(options: UseTxOptions = {}): TxState & { run: (steps: TxStep[]) => Promise<boolean>; reset: () => void } {
  const toast = useToast();
  const { address } = useConnection();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const { data: walletClient } = useWalletClient({ chainId: robinhoodChain.id });
  const [state, setState] = useState<TxState>({ phase: "idle", stepIndex: 0, completed: [], pending: false });
  const busy = useRef(false);
  const onSuccess = useRef(options.onSuccess);
  onSuccess.current = options.onSuccess;

  const patch = (p: Partial<TxState>): void =>
    setState((s) => {
      const next = { ...s, ...p };
      next.pending = next.phase === "simulating" || next.phase === "signing" || next.phase === "confirming";
      return next;
    });

  const reset = useCallback(() => setState({ phase: "idle", stepIndex: 0, completed: [], pending: false }), []);

  const run = useCallback(
    async (steps: TxStep[]): Promise<boolean> => {
      if (busy.current) return false;
      if (!address || !publicClient || !walletClient) {
        toast({ kind: "error", title: "Connect your wallet first" });
        return false;
      }
      busy.current = true;
      const ctx: TxContext = { account: address, publicClient: publicClient as PublicClient };
      const completed: string[] = [];
      let lastHash: Hex | undefined;
      setState({ phase: "simulating", stepIndex: 0, completed: [], pending: true });
      try {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i] as TxStep;
          patch({ phase: "simulating", stepIndex: i });
          if (step.skip && (await step.skip(ctx))) {
            completed.push(step.id);
            patch({ completed: [...completed] });
            continue;
          }
          const call = typeof step.call === "function" ? await step.call(ctx) : step.call;
          const { request } = await publicClient.simulateContract({
            account: address,
            address: call.address,
            abi: call.abi,
            functionName: call.functionName,
            args: call.args,
            value: call.value,
          } as Parameters<PublicClient["simulateContract"]>[0]);
          patch({ phase: "signing" });
          const hash = await walletClient.writeContract(request as Parameters<typeof walletClient.writeContract>[0]);
          lastHash = hash;
          patch({ phase: "confirming", hash });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error("The transaction was mined but reverted.");
          completed.push(step.id);
          patch({ completed: [...completed] });
          toast({ kind: "success", title: step.successTitle ?? `${step.label} confirmed`, href: explorerTx(hash) });
        }
        patch({ phase: "done" });
        if (lastHash) onSuccess.current?.(lastHash);
        return true;
      } catch (err) {
        const message = describeError(err);
        patch({ phase: "error", error: message });
        toast({ kind: "error", title: "Transaction not sent", description: message, durationMs: 12000 });
        return false;
      } finally {
        busy.current = false;
      }
    },
    [address, publicClient, walletClient, toast],
  );

  return { ...state, run, reset };
}
