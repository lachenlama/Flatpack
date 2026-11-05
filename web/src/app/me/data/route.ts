import { NextResponse } from "next/server";
import { toJson } from "../../../lib/serialize.ts";
import { loadPortfolio, parseAccount } from "../data.ts";

export const dynamic = "force-dynamic";

/** GET /me/data?address=0x... : the portfolio DTO as JSON (bigints as strings). Uncached: it is refetched after each claim. */
export async function GET(req: Request): Promise<Response> {
  const account = parseAccount(new URL(req.url).searchParams.get("address"));
  if (!account) return NextResponse.json({ error: "Pass ?address=0x... (a valid address)." }, { status: 400 });
  try {
    return new Response(toJson(await loadPortfolio(account)), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Portfolio unavailable." }, { status: 502 });
  }
}
