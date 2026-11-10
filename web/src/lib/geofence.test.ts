import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCKED_COUNTRIES, decideGeofence } from "./geofence.ts";

test("blocked countries are rewritten to /restricted", () => {
  for (const c of ["US", "CA", "GB", "CH", "CU", "BY", "IR", "KP", "RU", "SY", "UA", "SS", "SD", "MM", "VE"]) {
    assert.ok(BLOCKED_COUNTRIES.has(c));
    assert.deepEqual(decideGeofence(c, "/"), { action: "rewrite", to: "/restricted" });
    assert.deepEqual(decideGeofence(c, "/explore"), { action: "rewrite", to: "/restricted" });
    assert.deepEqual(decideGeofence(c, "/b/0xabc"), { action: "rewrite", to: "/restricted" });
  }
  assert.deepEqual(decideGeofence("us", "/me"), { action: "rewrite", to: "/restricted" });
});

test("/restricted, /api and static assets stay reachable for blocked countries", () => {
  for (const p of ["/restricted", "/api/baskets", "/api/og/0xabc", "/_next/static/a.js", "/favicon.ico", "/logo.svg"]) {
    assert.deepEqual(decideGeofence("US", p), { action: "allow" }, p);
  }
});

test("other countries and missing header are allowed", () => {
  assert.deepEqual(decideGeofence("DE", "/"), { action: "allow" });
  assert.deepEqual(decideGeofence(null, "/"), { action: "allow" });
  assert.deepEqual(decideGeofence(undefined, "/assemble"), { action: "allow" });
});
