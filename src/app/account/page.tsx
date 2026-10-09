"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/app/PageHeader";
import LoadingStub from "@/components/app/LoadingStub";
import { useSession } from "@/lib/useSession";
import { createAccount, GENDERS, logIn, logOut, type Gender } from "@/lib/account";

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="h-full px-4 pt-16"><LoadingStub label="Loading" lines={2} /></div>}>
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
      <PageHeader
        backTo={next}
        title={signedIn ? "Your account" : mode === "create" ? "Make an account" : "Log in"}
        caption={signedIn ? "Signed in" : "Wave, add people and chat privately"}
      />

      {state === "loading" ? (
        <LoadingStub label="Loading your account" lines={2} />
      ) : signedIn ? (
        <div className="card">
          <p className="label">Signed in as</p>
          <p className="font-display text-[22px] font-black leading-tight">{profile?.display_name ?? "Hopper"}</p>
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
            <button type="button" aria-pressed={mode === "create"} className="chip min-h-[44px]" onClick={() => { setMode("create"); setError(null); }}>
              NEW HERE
            </button>
            <button type="button" aria-pressed={mode === "login"} className="chip min-h-[44px]" onClick={() => { setMode("login"); setError(null); }}>
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
                      className="chip min-h-[44px] px-4"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p role="alert" className="font-body text-[13px] font-semibold text-fireant">{error}</p>}

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
