"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Look } from "./avatar";

type Fix = { lat: number; lng: number; source: "gps" | "area"; area: string | null };

type HoppazState = {
  /** Where the Hopper is. GPS when granted, the picked area otherwise. */
  fix: Fix | null;
  radiusKm: number;
  showCrew: boolean;
  seenIntro: boolean;
  /** The opening title sequence plays once; the Me tab can replay it. */
  seenTitle: boolean;
  /** Local copy of the avatar so it shows before, or without, Supabase. */
  look: Look | null;
  setFix: (fix: Fix | null) => void;
  setRadius: (km: number) => void;
  toggleCrew: () => void;
  markIntroSeen: () => void;
  setSeenTitle: (seen: boolean) => void;
  setLook: (look: Look) => void;
};

export const useHoppaz = create<HoppazState>()(
  persist(
    (set) => ({
      fix: null,
      radiusKm: 8,
      showCrew: false,
      seenIntro: false,
      seenTitle: false,
      look: null,
      setFix: (fix) => set({ fix }),
      setRadius: (radiusKm) => set({ radiusKm }),
      toggleCrew: () => set((s) => ({ showCrew: !s.showCrew })),
      markIntroSeen: () => set({ seenIntro: true }),
      setSeenTitle: (seenTitle) => set({ seenTitle }),
      setLook: (look) => set({ look }),
    }),
    { name: "hoppaz.v1" }
  )
);

type ToastState = {
  toast: { text: string; tone: "orange" | "violet" } | null;
  say: (text: string, tone?: "orange" | "violet") => void;
};

export const useToast = create<ToastState>((set) => ({
  toast: null,
  say: (text, tone = "orange") => {
    set({ toast: { text, tone } });
    setTimeout(() => set({ toast: null }), 2600);
  },
}));
