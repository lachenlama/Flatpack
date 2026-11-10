"use client";

import { useState } from "react";
import { useConnect, useConnectors } from "wagmi";
import { Button } from "../../../components/ui/Button.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import w from "../../../components/wallet/wallet.module.css";

/**
 * A connect button with its own label ("Connect wallet to buy"). The shared ConnectButton has a fixed "Connect" label, so this
 * mirrors its wallet list (EIP-6963 discovered wallets first) and opens the same kind of modal.
 */
export function ConnectGate({ label }: { label: string }) {
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  const [open, setOpen] = useState(false);

  const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const shown = connectors.filter((c) => (discovered.length > 0 ? c.id !== "injected" : true));

  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Connect a wallet">
        <p className="muted">Choose a wallet. Flatpack runs on Robinhood Chain; we will help you switch.</p>
        <ul className={w.list}>
          {shown.map((c) => (
            <li key={c.uid}>
              <Button
                variant="ghost"
                className={w.walletBtn}
                loading={isPending}
                onClick={() => connect({ connector: c }, { onSuccess: () => setOpen(false) })}
              >
                {c.icon ? <img className={w.walletIcon} src={c.icon} alt="" width={22} height={22} /> : null}
                {c.id === "injected" ? "Browser wallet" : c.name}
              </Button>
            </li>
          ))}
        </ul>
        {shown.length === 0 ? <p>No wallet found. Install MetaMask or Rabby, then reload.</p> : null}
        {error ? <p className={w.err}>{error.message.slice(0, 160)}</p> : null}
      </Modal>
    </>
  );
}
