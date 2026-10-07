"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Look } from "./avatar";
import { ANY_DATE, type DateFilter } from "./filters";

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
  /** Map filters. Types are remembered; the date is not, since "tonight" goes stale. */
  dateFilter: DateFilter;
  types: string[];
  setDateFilter: (f: DateFilter) => void;
  setTypes: (t: string[]) => void;
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
      dateFilter: ANY_DATE,
      types: [],
      setDateFilter: (dateFilter) => set({ dateFilter }),
      setTypes: (types) => set({ types }),
    }),
    {
      name: "hoppaz.v1",
      partialize: (state) => {
        const { dateFilter, ...rest } = state;
        void dateFilter;
        return rest;
      },
    }
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
