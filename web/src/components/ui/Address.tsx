"use client";

import { useState } from "react";
import { explorerAddress } from "../../lib/chain.ts";
import { shortAddress } from "../../lib/format.ts";
import s from "./ui.module.css";

/** Props of {@link Address}. */
export interface AddressProps {
  address: string;
  /** Show the full address instead of 0xabcd…ef12. */
  full?: boolean;
  /** Hide the copy button. */
  noCopy?: boolean;
  /** Hide the Blockscout link. */
  noLink?: boolean;
}

/** Short mono address with a copy button and a Blockscout link. */
export function Address({ address, full = false, noCopy = false, noLink = false }: AddressProps) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <span className={s.addr}>
      <span title={address}>{full ? address : shortAddress(address)}</span>
      {noCopy ? null : (
        <button type="button" className={s.iconBtn} onClick={copy} aria-label={copied ? "Copied" : "Copy address"}>
          {copied ? "✓" : "⧉"}
        </button>
      )}
      {noLink ? null : (
        <a className={s.iconBtn} href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" aria-label="Open in Blockscout">
          {"↗"}
        </a>
      )}
    </span>
  );
}
