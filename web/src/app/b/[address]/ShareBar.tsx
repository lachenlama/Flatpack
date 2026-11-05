"use client";

import { Button, ButtonLink } from "../../../components/ui/Button.tsx";
import { useToast } from "../../../components/ui/Toast.tsx";
import { useWalletState } from "../../../components/wallet/ConnectButton.tsx";
import { SITE_URL } from "../../../lib/chain.ts";
import s from "./basket.module.css";

/** Share on X (intent; the card image comes from the page's og:image = /api/og/[address]) and copy the referral link. */
export function ShareBar({ address, name }: { address: string; name: string }) {
  const { address: me } = useWalletState();
  const toast = useToast();
  const link = `${SITE_URL}/b/${address}${me ? `?ref=${me}` : ""}`;
  const text = `${name}: a basket of Stock Tokens on Robinhood Chain, built on Flatpack. Performance vs SPY, not advice.`;
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`;
  return (
    <div className={s.actions}>
      <ButtonLink href={intent} variant="ghost" size="sm">
        Share on X {"↗"}
      </ButtonLink>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          navigator.clipboard
            .writeText(link)
            .then(() =>
              toast({
                kind: "success",
                title: me ? "Referral link copied" : "Link copied",
                description: me ? "It carries your address as the referrer." : "Connect a wallet to add your address as the referrer.",
              }),
            )
            .catch(() => toast({ kind: "error", title: "Could not copy", description: link }));
        }}
      >
        Copy referral link
      </Button>
    </div>
  );
}
