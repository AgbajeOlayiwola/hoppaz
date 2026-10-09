"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";

/**
 * The browser's own install prompt (Android Chrome fires "beforeinstallprompt"
 * once and lets us keep it). InstallSheet catches the event and parks it here,
 * so the sheet and Paz's install step share the one prompt: whichever fires it
 * first uses it up. iPhone has no such prompt (two taps in Safari instead).
 */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const useInstallPrompt = create<{ prompt: InstallPromptEvent | null }>(() => ({ prompt: null }));

export const holdInstallPrompt = (e: InstallPromptEvent) => useInstallPrompt.setState({ prompt: e });
export const dropInstallPrompt = () => useInstallPrompt.setState({ prompt: null });

/** The Hopper tapped "Add it". Call it straight from the tap. "none": the browser has nothing to offer here. */
export async function fireInstallPrompt(): Promise<"accepted" | "dismissed" | "none"> {
  const p = useInstallPrompt.getState().prompt;
  if (!p) return "none";
  dropInstallPrompt(); // the browser only lets a saved prompt fire once
  try {
    await p.prompt();
    return (await p.userChoice).outcome;
  } catch {
    return "dismissed"; // the browser refused; treat as not now
  }
}

/**
 * Android Chrome sends the prompt a moment after the page loads. Paz's install step holds for it this long
 * (counted from the page load, so on a normal phone the hello card has used it up already), then moves on.
 */
const PROMPT_WAIT_MS = 3000;
const loadedAt = typeof window === "undefined" ? 0 : Date.now();

/** Still inside the window where the browser's install prompt may yet arrive. */
export const promptWindowOpen = (): boolean => loadedAt > 0 && Date.now() - loadedAt < PROMPT_WAIT_MS;

/** For render: re-renders once when the window closes. */
export function usePromptWindow(): boolean {
  const [open, setOpen] = useState(promptWindowOpen);
  useEffect(() => {
    const t = setTimeout(() => setOpen(false), Math.max(0, PROMPT_WAIT_MS - (Date.now() - loadedAt)));
    return () => clearTimeout(t);
  }, []);
  return open;
}
