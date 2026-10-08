"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import clsx from "clsx";
import { useSession } from "@/lib/useSession";
import { createAccount, GENDERS, logIn, logOut, type Gender } from "@/lib/account";

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="grid h-full place-items-center"><span className="hint">LOADING…</span></div>}>
      <Account />
    </Suspense>
  );
}

/**
 * Make an account or log in. Kept to four fields on purpose; anything else
 * (birthday first) is asked later, one question at a time.
 */
function Account() {
  const params = useSearchParams();
  // Only same-site paths: never bounce to wherever a link says.
  const raw = params.get("next") ?? "/me";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/me";
  const { email: signedIn, profile, state } = useSession();
  const [mode, setMode] = useState<"create" | "login">(params.get("mode") === "login" ? "login" : "create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every hook on the page holds its own copy of the session: a full reload so they all pick up the new one.
  const done = () => window.location.assign(next);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "create" && !gender) return setError("Pick a gender");
    setBusy(true);
    const err = mode === "create" ? await createAccount({ name, email, password, gender: gender! }) : await logIn(email, password);
    setBusy(false);
    if (err) setError(err);
    else done();
  };

  return (
    <div className="h-full overflow-y-auto px-4 pb-8">
      <header className="pad-top flex items-center gap-3 pb-4">
        <Link href={next} aria-label="Back" className="grid h-9 w-9 place-items-center rounded border border-line">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-black leading-none">{signedIn ? "Your account" : mode === "create" ? "Make an account" : "Log in"}</h1>
          <p className="seclabel mt-1.5">{signedIn ? "Signed in" : "Wave, add people and chat privately"}</p>
        </div>
      </header>

      {state === "loading" ? (
        <p className="hint">LOADING…</p>
      ) : signedIn ? (
        <div className="card">
          <p className="label">Signed in as</p>
          <p className="font-display text-base font-black">{profile?.display_name ?? "Hopper"}</p>
          <p className="hint">{signedIn}{profile?.handle ? ` · @${profile.handle}` : ""}</p>
          <button
            className="btn btn-ghost mt-4 w-full"
            onClick={async () => {
              await logOut();
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate hard reload
              window.location.assign("/me");
            }}
          >
            LOG OUT
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <button type="button" className={clsx("btn", mode !== "create" && "btn-ghost")} onClick={() => { setMode("create"); setError(null); }}>
              NEW HERE
            </button>
            <button type="button" className={clsx("btn", mode !== "login" && "btn-ghost")} onClick={() => { setMode("login"); setError(null); }}>
              LOG IN
            </button>
          </div>

          <form onSubmit={submit} className="card flex flex-col gap-3">
            {mode === "create" && (
              <div>
                <label className="label" htmlFor="ac-name">Name</label>
                <input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoComplete="given-name" required />
              </div>
            )}
            <div>
              <label className="label" htmlFor="ac-email">Email</label>
              <input id="ac-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required />
            </div>
            <div>
              <label className="label" htmlFor="ac-pass">Password</label>
              <input
                id="ac-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={mode === "create" ? 8 : undefined}
                autoComplete={mode === "create" ? "new-password" : "current-password"}
                required
              />
              {mode === "create" && <p className="hint mt-1">At least 8 characters.</p>}
            </div>
            {mode === "create" && (
              <div>
                <p className="label">Gender</p>
                <div role="radiogroup" aria-label="Gender" className="flex flex-wrap gap-1.5">
                  {GENDERS.map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={gender === k}
                      onClick={() => setGender(k)}
                      className={clsx("tag px-3 py-2 text-[10px]", gender === k && "tag-o")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p role="alert" className="font-mono text-[11px] font-bold text-orange">{error}</p>}

            <button type="submit" className="btn mt-1 w-full" disabled={busy}>
              {busy ? "ONE SEC…" : mode === "create" ? "MAKE MY ACCOUNT" : "LOG IN"}
            </button>
            <p className="hint">
              {mode === "create"
                ? "Your XP, badges and chats so far stay with you. Gender and email are never shown to other Hoppers."
                : "Logging in switches this phone to that account."}
            </p>
          </form>
        </>
      )}
    </div>
  );
}
