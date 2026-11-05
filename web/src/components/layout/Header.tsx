import Link from "next/link";
import { Suspense } from "react";
import { ConnectButton } from "../wallet/ConnectButton.tsx";
import { BurnCounter } from "./BurnCounter.tsx";
import { NavLinks } from "./NavLinks.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import s from "./layout.module.css";

/** Site header: FLATPACK wordmark, nav, burn counter, theme toggle, Connect. */
export function Header() {
  return (
    <header className={s.header}>
      <div className={`container ${s.bar}`}>
        <Link href="/" className={s.logo} aria-label="Flatpack home">
          FLATPACK
        </Link>
        <NavLinks />
        <div className={s.right}>
          <Suspense fallback={<span className={s.burn}>{"🔥"} {"…"}</span>}>
            <BurnCounter />
          </Suspense>
          <ThemeToggle />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
