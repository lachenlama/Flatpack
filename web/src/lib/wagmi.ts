import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { mock } from "wagmi/connectors/mock";
import { RPC_URL, robinhoodChain } from "./chain.ts";
import { E2E_ACCOUNT, e2eEnabled } from "./e2e.ts";

function makeConnectors(): CreateConnectorFn[] {
  // EIP-6963 discovery (multiInjectedProviderDiscovery, default on) adds one connector per installed wallet (MetaMask, Rabby, ...).
  // `injected()` is the fallback for wallets that only expose window.ethereum.
  const list: CreateConnectorFn[] = [injected()];
  // TEST ONLY: mock wallet (Hardhat account #3) when NEXT_PUBLIC_E2E=1 and the RPC is local; throws otherwise (see lib/e2e.ts).
  const host = typeof window === "undefined" ? undefined : window.location.hostname;
  if (e2eEnabled(RPC_URL, process.env.NEXT_PUBLIC_E2E, host)) {
    list.push(mock({ accounts: [E2E_ACCOUNT], features: { defaultConnected: false, reconnect: false } }));
  }
  return list;
}

/** wagmi 3 config: Robinhood Chain (4663) only, EIP-6963 multi-wallet discovery (injected). SSR-safe. */
export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: makeConnectors(),
  transports: { [robinhoodChain.id]: http(RPC_URL) },
  multiInjectedProviderDiscovery: true,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
