import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import s from "./ui.module.css";

type Common = { variant?: "primary" | "ghost"; size?: "md" | "sm"; children?: ReactNode };

const cls = (v: "primary" | "ghost", size: "md" | "sm", extra?: string): string =>
  [s.btn, v === "primary" ? s.primary : s.ghost, size === "sm" ? s.sm : "", extra ?? ""].filter(Boolean).join(" ");

/** Props of {@link Button}. */
export type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean };

/**
 * Ink-filled primary button or ghost button. Primary uses ink fill + paper text (never series colors).
 * @param loading shows a spinner and disables the button
 */
export function Button({ variant = "primary", size = "md", loading = false, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={cls(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className={s.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Props of {@link ButtonLink}. */
export type ButtonLinkProps = Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string };

/** A link styled as a {@link Button}. Internal hrefs use next/link; external hrefs open in a new tab. */
export function ButtonLink({ variant = "primary", size = "md", href, className, children, ...rest }: ButtonLinkProps) {
  const external = /^https?:\/\//.test(href);
  if (external) {
    return (
      <a href={href} className={cls(variant, size, className)} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
