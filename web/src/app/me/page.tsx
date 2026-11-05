import type { Metadata } from "next";
import { hasDeployment } from "../../lib/deployment.ts";
import { loadPortfolio, parseAccount, type PortfolioDto } from "./data.ts";
import { Portfolio } from "./Portfolio.tsx";

export const metadata: Metadata = { title: "My portfolio" };

/**
 * /me : positions and every claimable. `?address=0x...` renders any account read-only on the server (shareable, curl-able);
 * without it the connected wallet is used.
 */
export default async function MePage({ searchParams }: { searchParams: Promise<{ address?: string }> }) {
  const q = parseAccount((await searchParams).address);
  let initial: PortfolioDto | undefined;
  if (q && hasDeployment()) {
    try {
      initial = JSON.parse(JSON.stringify(await loadPortfolio(q), (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as PortfolioDto;
    } catch {
      initial = undefined;
    }
  }
  return (
    <>
      <h1>My portfolio</h1>
      <p className="muted">Your baskets, and everything you can claim, in one place.</p>
      <Portfolio queryAddress={q} initial={initial} />
    </>
  );
}
