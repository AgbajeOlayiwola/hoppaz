"use client";

import { useTheme } from "@/lib/useTheme";

/** Keeps <html data-theme> on the Lagos clock while the app stays open. Renders nothing. */
export default function ThemeClock() {
  useTheme();
  return null;
}
