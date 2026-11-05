import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/** Repo root: `../shared` (ABIs, units, deployments) and `../config` are imported directly. */
const repoRoot = resolve(here, "..");

/**
 * The deployment JSON (shared/deployments/<NEXT_PUBLIC_DEPLOYMENT>.json) is read here, at build/start time, and inlined
 * as NEXT_PUBLIC_DEPLOYMENT_JSON so the same addresses reach server and client code without any fs access at runtime.
 * A missing file is not an error at build time (pages that need it are dynamic); src/lib/deployment.ts throws on use.
 */
const deploymentName = process.env.NEXT_PUBLIC_DEPLOYMENT || "4663";
const deploymentFile = resolve(repoRoot, "shared", "deployments", `${deploymentName}.json`);
const deploymentJson = existsSync(deploymentFile) ? JSON.stringify(JSON.parse(readFileSync(deploymentFile, "utf8"))) : "";

const nextConfig: NextConfig = {
  // Lets two builds/servers run side by side in web/ (NEXT_DIST_DIR=.next-b ...).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  env: {
    NEXT_PUBLIC_DEPLOYMENT_JSON: deploymentJson,
    NEXT_PUBLIC_DEPLOYMENT_NAME: deploymentName,
  },
};

export default nextConfig;
