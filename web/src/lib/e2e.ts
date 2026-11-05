/** Hardhat dev account #3 (PUBLIC test address; the local fork node signs for it, no key is ever in the app). */
export const E2E_ACCOUNT = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;

const LOCAL_RPC = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)$/;

/**
 * Whether the test-only mock wallet may be enabled. True ONLY when the flag is "1" AND the RPC is a local node AND (in a
 * browser) the page is served from localhost. A set flag with anything else THROWS, so a production build cannot ship it.
 * @param rpcUrl the configured RPC
 * @param flag value of NEXT_PUBLIC_E2E
 * @param hostname `window.location.hostname` in a browser, undefined on the server
 */
export function e2eEnabled(rpcUrl: string, flag: string | undefined, hostname?: string): boolean {
  if (flag !== "1") return false;
  if (!LOCAL_RPC.test(rpcUrl)) throw new Error("NEXT_PUBLIC_E2E=1 is only allowed with a local RPC (127.0.0.1 or localhost).");
  if (hostname !== undefined && !LOCAL_HOST.test(hostname)) throw new Error("NEXT_PUBLIC_E2E=1 is only allowed when served from localhost.");
  return true;
}
