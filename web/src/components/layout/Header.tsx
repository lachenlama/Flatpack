import Link from "next/link";
import { Suspense } from "react";
import { ConnectButton } from "../wallet/ConnectButton.tsx";
import { BurnCounter } from "./BurnCounter.tsx";
import { Flame } from "./Flame.tsx";
import { NavLinks } from "./NavLinks.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import s from "./layout.module.css";

/**
 * Site header: FLATPACK wordmark, nav, burn counter, theme toggle, Connect.
 * Mobile is two rows: [wordmark ... theme + Connect] over [nav links ... burn counter], the second row scrolling sideways.
 */
export function Header() {
  return (
    <header className={s.header}>
      <div className={`container ${s.bar}`}>
        <Link href="/" className={s.logo} aria-label="Flatpack home">
          FLATPACK
        </Link>
        <div className={s.navRow}>
          <NavLinks />
          <Suspense
            fallback={
              <span className={s.burn}>
                <Flame /> <span>{"…"}</span>
              </span>
            }
          >
            <BurnCounter />
          </Suspense>
        </div>
        <div className={s.actions}>
          <ThemeToggle />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
