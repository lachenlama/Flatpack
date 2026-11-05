"use client";

import { useEffect, useState } from "react";
import s from "./layout.module.css";

const KEY = "flatpack-theme";

/** Inline script (runs before paint) that applies a stored theme to <html data-theme>. Without a stored value the OS decides. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

/** Light/dark toggle. Starts from the OS preference; the choice is stored in localStorage and set as `data-theme`. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    setTheme(attr === "dark" || attr === "light" ? attr : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);
  const toggle = (): void => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
  };
  return (
    <button type="button" className={s.theme} onClick={toggle} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title="Toggle theme">
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}
