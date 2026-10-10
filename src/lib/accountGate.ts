"use client";

import { create } from "zustand";
import { introActive, introNeedAccount } from "./intro/active";
import { getSupabase } from "./supabase/client";
import { useSessionStore } from "./useSession";

/**
 * The account gate. Browsing is open to everyone; doing things (saying WE
 * OUTSIDE, checking in, claiming rewards, crews, your profile) needs an
 * account. A gated action calls requireAccount(): with an account it is a
 * no-op; without one it opens the sign-up sheet (SignupSheet, mounted once)
 * and remembers what you were doing, so it goes through the moment you're in.
 *
 * Paz's first-run tour has one sign-up moment of its own (her "keep your Golden
 * Danfo" card). While she is with the Hopper nothing else opens the sheet on its
 * own: the action waits (a short line says so) and Ola's behaviour is back when
 * the tour ends or is skipped.
 */

/**
 * What a gated hook hands back instead of an error message. The toast store
 * ignores it (the sheet is already explaining), and anything that shows
 * errors inline should check isNeedAccount() first.
 */
export const NEED_ACCOUNT = "need_account";
export const isNeedAccount = (msg: string | null | undefined) => msg === NEED_ACCOUNT;

type GateState = {
  open: boolean;
  /** Finishes the sentence "Make an account to …". */
  reason: string;
  /** The action to finish once signed in. */
  pending: (() => void) | null;
  show: (reason: string, then?: () => void) => void;
  close: () => void;
};

export const useAccountGate = create<GateState>((set) => ({
  open: false,
  reason: "",
  pending: null,
  show: (reason, then) => set({ open: true, reason, pending: then ?? null }),
  close: () => set({ open: false, pending: null }),
}));

/**
 * True when the Hopper can go ahead. False when they can't yet: the sign-up
 * sheet is now open, and `then` runs after they sign up or log in.
 * Without a database (local demo) nothing is gated.
 */
export function requireAccount(reason: string, then?: () => void, opts?: { quiet?: boolean }): boolean {
  if (!getSupabase()) return true;
  if (useSessionStore.getState().email) return true;
  // Quiet: the caller has asked already this visit (the Today deck's right swipes) and only needs the answer.
  if (opts?.quiet) return false;
  if (introActive()) {
    introNeedAccount();
    return false;
  }
  useAccountGate.getState().show(reason, then);
  return false;
}
