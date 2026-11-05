"use client";

import Link from "next/link";
import { useState } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { robinhoodChain } from "../../lib/chain.ts";
import { shortAddress } from "../../lib/format.ts";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import s from "./wallet.module.css";

/**
 * Returns the connected account state and whether the wallet is on Robinhood Chain.
 * `{ address, isConnected, onWrongChain, chainId }`
 */
export function useWalletState() {
  const c = useConnection();
  return {
    address: c.address,
    isConnected: c.isConnected,
    chainId: c.chainId,
    onWrongChain: c.isConnected && c.chainId !== robinhoodChain.id,
  };
}

/** The "Switch to Robinhood Chain" button (adds the chain to the wallet if missing). */
export function SwitchChainButton({ size = "md" }: { size?: "md" | "sm" }) {
  const { mutate, isPending } = useSwitchChain();
  return (
    <Button size={size} loading={isPending} onClick={() => mutate({ chainId: robinhoodChain.id })}>
      Switch to Robinhood Chain
    </Button>
  );
}

/**
 * Header connect control. Disconnected: "Connect" opens a list of the wallets discovered via EIP-6963 (plus WalletConnect if
 * configured). Wrong chain: "Switch to Robinhood Chain". Connected: short address menu (portfolio, disconnect).
 */
export function ConnectButton() {
  const { address, isConnected, onWrongChain } = useWalletState();
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  if (isConnected && onWrongChain) return <SwitchChainButton size="sm" />;

  if (isConnected && address) {
    return (
      <span className={s.wrap}>
        <Button variant="ghost" size="sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
          <span className="mono">{shortAddress(address)}</span>
        </Button>
        {menu ? (
          <div className={s.menu} role="menu">
            <Link className={s.menuItem} role="menuitem" href="/me" onClick={() => setMenu(false)}>
              My portfolio
            </Link>
            <button
              type="button"
              className={s.menuItem}
              role="menuitem"
              onClick={() => {
                setMenu(false);
                disconnect();
              }}
            >
              Disconnect
            </button>
          </div>
        ) : null}
      </span>
    );
  }

  // Prefer discovered (EIP-6963) wallets; keep the generic injected fallback only when none were discovered.
  const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const shown = connectors.filter((c) => (discovered.length > 0 ? c.id !== "injected" : true));

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Connect
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Connect a wallet">
        <p className="muted">Choose a wallet. Flatpack runs on Robinhood Chain; we will help you switch.</p>
        <ul className={s.list}>
          {shown.map((c) => (
            <li key={c.uid}>
              <Button
                variant="ghost"
                className={s.walletBtn}
                loading={isPending}
                onClick={() => connect({ connector: c }, { onSuccess: () => setOpen(false) })}
              >
                {c.icon ? <img className={s.walletIcon} src={c.icon} alt="" width={22} height={22} /> : null}
                {c.id === "injected" ? "Browser wallet" : c.name}
              </Button>
            </li>
          ))}
        </ul>
        {shown.length === 0 ? <p>No wallet found. Install MetaMask or Rabby, then reload.</p> : null}
        {error ? <p className={s.err}>{error.message.slice(0, 160)}</p> : null}
      </Modal>
    </>
  );
}
