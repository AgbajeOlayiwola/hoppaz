"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";

/**
 * Accounts, the client half. Nobody has to make one: the map, rooms and
 * check-ins all work anonymously. An account (name, email, password, gender)
 * is what lets you wave, add people to your crew and chat privately.
 */

export type Gender = "female" | "male" | "other";
export const GENDERS: ReadonlyArray<[Gender, string]> = [
  ["female", "Female"],
  ["male", "Male"],
  ["other", "Other / rather not say"],
];

/** Returns an error line, or null once the Hopper is signed in to the new account. */
export async function createAccount(input: { name: string; email: string; password: string; gender: Gender }): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    // No anonymous session to upgrade (anonymous sign-ins switched off): a plain sign-up.
    const { error } = await sb.auth.signUp({ email: input.email, password: input.password, options: { data: { name: input.name } } });
    if (error) return error.message;
    await sb.rpc("set_private_details", { p_gender: input.gender });
    return null;
  }
  const res = await fetch("/api/account/create", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return out.error ?? "Could not create the account";
  // Same user, now with an email: sign in so the session knows it too.
  const { error } = await sb.auth.signInWithPassword({ email: input.email, password: input.password });
  return error ? "Account made. Log in with your email and password." : null;
}

export async function logIn(email: string, password: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (!error) return null;
  return /invalid/i.test(error.message) ? "Wrong email or password" : error.message;
}

export async function logOut() {
  const sb = getSupabase();
  await sb?.auth.signOut();
}

/* ------------------------------------------------- tell us more, slowly -- */

type Details = { gender: Gender | null; birthday: string | null; account_at: string | null };

/**
 * What to ask an account holder, one question at a time, each only once the
 * account is old enough. Add the next question here; nothing else changes.
 */
export const ASKS: ReadonlyArray<{ key: "birthday"; afterDays: number; missing: (d: Details) => boolean }> = [
  { key: "birthday", afterDays: 1, missing: (d) => !d.birthday },
];

const SNOOZE = "hoppaz.ask-snooze";
const DAY = 24 * 3.6e6;

/** The next question due for this Hopper, if any, plus how to answer or put it off. */
export function useNextAsk(userId: string | null, hasAccount: boolean) {
  const [details, setDetails] = useState<Details | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId || !hasAccount) return;
    let cancelled = false;
    void sb
      .from("profile_private")
      .select("gender, birthday, account_at")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setDetails((data as Details | null) ?? { gender: null, birthday: null, account_at: null });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, hasAccount]);

  const [snoozed, setSnoozed] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(SNOOZE) ?? 0);
    } catch {
      return 0;
    }
  });

  const since = details?.account_at ? Date.now() - Date.parse(details.account_at) : 0;
  const next =
    details && Date.now() > snoozed
      ? ASKS.find((a) => since >= a.afterDays * DAY && a.missing(details)) ?? null
      : null;

  const later = useCallback(() => {
    const until = Date.now() + DAY;
    setSnoozed(until);
    try {
      localStorage.setItem(SNOOZE, String(until));
    } catch {
      /* private mode: it just asks again next visit */
    }
  }, []);

  const answer = useCallback(async (patch: { birthday?: string }) => {
    const sb = getSupabase();
    if (!sb) return false;
    const { data } = await sb.rpc("set_private_details", { p_birthday: patch.birthday ?? null });
    if (data) setDetails((d) => (d ? { ...d, ...patch } : d));
    return !!data;
  }, []);

  return { next, later, answer };
}
