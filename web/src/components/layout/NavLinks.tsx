"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import s from "./layout.module.css";

const LINKS = [
  { href: "/explore", label: "Explore" },
  { href: "/assemble", label: "Assemble" },
  { href: "/flywheel", label: "Flywheel" },
  { href: "/proof", label: "Proof" },
  { href: "/me", label: "My portfolio" },
] as const;

/** Primary navigation with `aria-current` on the active route. */
export function NavLinks() {
  const path = usePathname();
  return (
    <nav className={s.nav} aria-label="Primary">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={path === l.href || path.startsWith(`${l.href}/`) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
