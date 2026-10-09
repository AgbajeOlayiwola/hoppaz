"use client";

import { useEffect, useState } from "react";
import { currentTheme, THEME_COLOR, THEME_PREF_EVENT, type Theme } from "./theme";

/**
 * The live theme: night unless the Hopper chose otherwise. When they chose to
 * follow the Lagos clock it re-checks every minute, so an app left open flips
 * at sunset by itself. Keeps <html data-theme> and the status-bar colour in step.
 */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document === "undefined"
      ? "night"
      : document.documentElement.getAttribute("data-theme") === "day"
        ? "day"
        : "night"
  );

  useEffect(() => {
    const apply = () => {
      const t = currentTheme();
      document.documentElement.setAttribute("data-theme", t);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[t]);
      setTheme(t);
    };
    apply();
    const id = setInterval(apply, 60_000);
    window.addEventListener(THEME_PREF_EVENT, apply);
    return () => {
      clearInterval(id);
      window.removeEventListener(THEME_PREF_EVENT, apply);
    };
  }, []);

  return theme;
}
