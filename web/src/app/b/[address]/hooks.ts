"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** Current unix seconds, ticking every second (0 until mounted, so SSR and hydration agree). */
export function useNow(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Re-reads every on-chain query (balances, positions) and the server-rendered parts (TVL, holders). Call after a tx. */
export function useRefresh(): () => void {
  const qc = useQueryClient();
  const router = useRouter();
  return useCallback(() => {
    void qc.invalidateQueries();
    router.refresh();
  }, [qc, router]);
}

export { parseAmount } from "./amount.ts";
