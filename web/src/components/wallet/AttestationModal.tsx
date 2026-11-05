"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useDisconnect } from "wagmi";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import s from "./wallet.module.css";

const KEY = "flatpack-attested-v1";

/** True once the visitor accepted the attestation on this browser (localStorage). `null` until read on the client. */
export function useAttested(): { attested: boolean | null; accept: () => void } {
  const [attested, setAttested] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setAttested(localStorage.getItem(KEY) === "1");
    } catch {
      setAttested(false);
    }
  }, []);
  const accept = useCallback(() => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode: accepted for this session only */
    }
    setAttested(true);
  }, []);
  return { attested, accept };
}

/** Props of {@link AttestationModal}. */
export interface AttestationModalProps {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

/** The blocking "I am not a US person ..." modal (WP5-UX §4.8). Accept needs the checkbox. */
export function AttestationModal({ open, onAccept, onDecline }: AttestationModalProps) {
  const [checked, setChecked] = useState(false);
  return (
    <Modal open={open} title="Before you connect" dismissable={false}>
      <p>
        Flatpack lets you hold baskets of Stock Tokens on Robinhood Chain. Stock Tokens are not available to US persons or in restricted
        jurisdictions.
      </p>
      <label className={s.check}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>
          I am not a US person and not in a restricted jurisdiction. I understand that Stock Tokens are not available to US persons, that
          nothing here is investment advice, and that $WIF has no promise of value.
        </span>
      </label>
      <div className={s.actions}>
        <Button disabled={!checked} onClick={onAccept}>
          Continue
        </Button>
        <Button variant="ghost" onClick={onDecline}>
          Disconnect
        </Button>
      </div>
    </Modal>
  );
}

/** Mounted once in `Providers`: shows {@link AttestationModal} on first connect, remembers acceptance, disconnects on decline. */
export function AttestationGate() {
  const { isConnected } = useConnection();
  const { mutate: disconnect } = useDisconnect();
  const { attested, accept } = useAttested();
  return <AttestationModal open={isConnected && attested === false} onAccept={accept} onDecline={() => disconnect()} />;
}
