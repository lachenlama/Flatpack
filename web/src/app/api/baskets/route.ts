import { NETWORK } from "../../../lib/chain.ts";
import { DEPLOYMENT_NAME, getDeployment } from "../../../lib/deployment.ts";
import { listBaskets } from "../../../lib/reads/baskets.ts";
import { toJson } from "../../../lib/serialize.ts";

export const dynamic = "force-dynamic";

/**
 * Public read-only JSON of all baskets (judges and developers). bigint values are decimal strings.
 * Cached 15 seconds (CDN `s-maxage` and the in-process reader cache).
 */
export async function GET(): Promise<Response> {
  try {
    const dep = getDeployment();
    const baskets = await listBaskets();
    const body = toJson(
      {
        chainId: NETWORK.chainId,
        deployment: DEPLOYMENT_NAME,
        contracts: dep.addresses,
        generatedAt: new Date().toISOString(),
        count: baskets.length,
        baskets,
      },
      2,
    );
    return new Response(body, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, s-maxage=15, stale-while-revalidate=30", "access-control-allow-origin": "*" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unavailable";
    return new Response(JSON.stringify({ error: "baskets unavailable", detail: message.slice(0, 200) }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
