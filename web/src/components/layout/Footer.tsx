import Link from "next/link";
import s from "./layout.module.css";

/** The disclaimer shown on every page (WP5-UX §7). Exported so server-rendered cards can reuse the exact text. */
export const DISCLAIMER =
  "Flatpack is not affiliated with Robinhood Markets, Inc. Stock Tokens are not available to US persons or in restricted jurisdictions. Nothing here is investment advice. $WIF has no promise of value.";

/** Footer with the disclaimer and the hackathon vote link. */
export function Footer() {
  return (
    <footer className={s.footer}>
      <div className="container">
        <p>{DISCLAIMER}</p>
        <div className={s.footRow}>
          <span>
            <Link href="/proof">Proof</Link> {"·"} <a href="/api/baskets">Public JSON</a>
          </span>
          <a href="https://worldisflat.fun/build" target="_blank" rel="noopener noreferrer">
            Vote for Flatpack in the world is flat hackathon {"↗"}
          </a>
        </div>
      </div>
    </footer>
  );
}
