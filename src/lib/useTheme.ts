"use client";

import { useEffect, useState } from "react";
import { forcedTheme, THEME_COLOR, themeAt, type Theme } from "./theme";

/**
 * The live theme. Re-checks the Lagos clock every minute, so an app left open
 * flips to night at sunset by itself, and keeps <html data-theme> and the
 * status-bar colour in step.
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
      const t = forcedTheme() ?? themeAt();
      document.documentElement.setAttribute("data-theme", t);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[t]);
      setTheme(t);
    };
    apply();
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, []);

  return theme;
}
