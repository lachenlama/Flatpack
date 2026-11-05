"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import s from "./ui.module.css";

/** A toast request. */
export interface ToastInput {
  kind?: "success" | "error" | "info";
  title: string;
  description?: string;
  /** Optional link, e.g. the Blockscout transaction. */
  href?: string;
  linkLabel?: string;
  /** Auto-dismiss in ms (default 8000; 0 = sticky). */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ICON = { success: "✓", error: "✕", info: "○" } as const;
const Ctx = createContext<((t: ToastInput) => void) | null>(null);

/** Mount once near the root (done by `Providers`). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      const ms = t.durationMs ?? 8000;
      if (ms > 0) setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className={s.toasts} role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`${s.toast} ${s[`toast_${t.kind ?? "info"}`] ?? ""}`}>
            <div className={s.toastTitle}>
              <span>
                <span aria-hidden="true">{ICON[t.kind ?? "info"]} </span>
                {t.title}
              </span>
              <button type="button" className={s.iconBtn} onClick={() => dismiss(t.id)} aria-label="Dismiss">
                {"✕"}
              </button>
            </div>
            {t.description ? <div className={s.toastBody}>{t.description}</div> : null}
            {t.href ? (
              <a href={t.href} target="_blank" rel="noopener noreferrer" className={s.toastBody}>
                {t.linkLabel ?? "View on Blockscout"} {"↗"}
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Returns `toast(input)`. Must be used under `ToastProvider`. */
export function useToast(): (t: ToastInput) => void {
  const fn = useContext(Ctx);
  if (!fn) throw new Error("useToast must be used inside <ToastProvider>");
  return fn;
}
