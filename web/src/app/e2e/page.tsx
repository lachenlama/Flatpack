import { notFound } from "next/navigation";
import { RPC_URL } from "../../lib/chain.ts";
import { e2eEnabled } from "../../lib/e2e.ts";
import { listBaskets } from "../../lib/reads/baskets.ts";
import { E2EPanel } from "./E2EPanel.tsx";

export const dynamic = "force-dynamic";

/**
 * TEST-ONLY page for the headless-browser write-path check (web/e2e). 404 unless NEXT_PUBLIC_E2E=1 with a local RPC
 * (the same guard that enables the mock wallet).
 */
export default async function E2EPage() {
  if (!e2eEnabled(RPC_URL, process.env.NEXT_PUBLIC_E2E)) notFound();
  const baskets = await listBaskets();
  const first = baskets[0];
  if (!first) notFound();
  return (
    <div>
      <h1>E2E write path</h1>
      <p className="muted">Test page: two-step TxButton (approve USDG exactly, then basket.sync()).</p>
      <E2EPanel basket={first.address} />
    </div>
  );
}
