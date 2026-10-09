"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { createAccount, logIn } from "@/lib/account";

/** Fired on window after a sign-up or log-in, so the home-screen sheet can offer itself. */
export const SIGNED_IN_EVENT = "hoppaz:signed-in";

/**
 * Sign up or log in, in one small form: name, email, password for a new
 * account; email and password to log in. Used by the sign-up sheet, the
 * gated pages and /account. No email to confirm: you're in the moment it saves.
 */
export default function SignupForm({
  onDone,
  startWith = "create",
}: {
  onDone: (how: "create" | "login") => void;
  startWith?: "create" | "login";
}) {
  const [mode, setMode] = useState<"create" | "login">(startWith);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const err = mode === "create" ? await createAccount({ name, email, password }) : await logIn(email, password);
    setBusy(false);
    if (err) return setError(err);
    window.dispatchEvent(new Event(SIGNED_IN_EVENT));
    onDone(mode);
  };

  const flip = () => {
    setMode((m) => (m === "create" ? "login" : "create"));
    setError(null);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {mode === "create" && (
        <div>
          <label className="label" htmlFor="su-name">Your name</label>
          <input
            id="su-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="next"
            required
          />
        </div>
      )}
      <div>
        <label className="label" htmlFor="su-email">Email</label>
        <input
          id="su-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete={mode === "create" ? "email" : "username"}
          inputMode="email"
          autoCapitalize="none"
          enterKeyHint="next"
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="su-pass">Password</label>
        <div className="relative">
          <input
            id="su-pass"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={mode === "create" ? 8 : undefined}
            autoComplete={mode === "create" ? "new-password" : "current-password"}
            enterKeyHint="go"
            className="pr-12"
            required
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-dim"
          >
            {show ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
          </button>
        </div>
        {mode === "create" && <p className="hint mt-1">8 characters or more.</p>}
      </div>

      {error && (
        <p role="alert" className="font-body text-[14px] font-medium text-fireant">
          {error}
        </p>
      )}

      <button type="submit" className="btn mt-1 w-full" disabled={busy}>
        {busy ? "ONE SEC…" : mode === "create" ? "MAKE MY ACCOUNT" : "LOG IN"}
      </button>
      <button type="button" onClick={flip} className="min-h-[44px] font-body text-[14px] text-dim underline underline-offset-4">
        {mode === "create" ? "Already have an account? Log in" : "New here? Make an account"}
      </button>
      {mode === "create" && (
        <p className="hint text-center">Free. Your XP so far comes with you. Your email is never shown to other Hoppers.</p>
      )}
    </form>
  );
}
