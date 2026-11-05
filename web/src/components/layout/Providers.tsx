"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "../../lib/wagmi.ts";
import { ToastProvider } from "../ui/Toast.tsx";
import { AttestationGate } from "../wallet/AttestationModal.tsx";

/** Client providers: wagmi, react-query, toasts and the first-connect attestation. Mounted once in the root layout. */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {children}
          <AttestationGate />
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
