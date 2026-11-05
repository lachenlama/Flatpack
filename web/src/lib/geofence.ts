/** Geofence decision logic (WP5-UX §4.8). Pure, so it is unit-testable; src/proxy.ts applies it. */

/** ISO country codes whose visitors are routed to /restricted. */
export const BLOCKED_COUNTRIES: ReadonlySet<string> = new Set([
  "US", "CA", "GB", "CH", "CU", "BY", "IR", "KP", "RU", "SY", "UA", "SS", "SD", "MM", "VE",
]);

/** Paths that stay reachable for everyone, so judges can read the evidence. */
export function isExemptPath(pathname: string): boolean {
  return (
    pathname === "/proof" ||
    pathname.startsWith("/proof/") ||
    pathname === "/restricted" ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$/i.test(pathname)
  );
}

export type GeofenceDecision = { action: "allow" } | { action: "rewrite"; to: "/restricted" };

/**
 * @param country value of `x-vercel-ip-country` (null/undefined when absent, e.g. local dev -> allowed)
 * @param pathname request pathname
 */
export function decideGeofence(country: string | null | undefined, pathname: string): GeofenceDecision {
  if (isExemptPath(pathname)) return { action: "allow" };
  if (country && BLOCKED_COUNTRIES.has(country.trim().toUpperCase())) return { action: "rewrite", to: "/restricted" };
  return { action: "allow" };
}
