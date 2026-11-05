"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatDuration } from "../../lib/format.ts";

/** Props of {@link Countdown}. */
export interface CountdownProps {
  /** Target time, unix seconds. */
  to: number;
  /** Shown once the target has passed (default "now"). */
  done?: ReactNode;
}

/** Live "3d 4h" countdown to a unix-seconds target. Renders "…" until mounted (hydration-safe). */
export function Countdown({ to, done = "now" }: CountdownProps) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return <span className="num">{"…"}</span>;
  const left = to - now;
  return <span className="num">{left <= 0 ? done : formatDuration(left)}</span>;
}
