"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import { ChevronDown, FileText, Lock, Play, Settings, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { RowButton, RowLink, RowValue } from "./Rows";
import { setThemePref, themePref, type ThemePref } from "@/lib/theme";
import {
  ALERT_LEVELS,
  RESUBSCRIBE_MESSAGE,
  askToInstall,
  disablePush,
  enablePush,
  getAlertLevel,
  pushState,
  sendTestAlert,
  setAlertLevel,
  syncPush,
  type AlertLevel,
  type EnableResult,
  type PushState,
} from "@/lib/push";
import { supabaseConfigured } from "@/lib/supabase/client";
import { sfx } from "@/lib/sound/sfx";
import { haptics } from "@/lib/haptics";
import { useSessionStore } from "@/lib/useSession";
import ReplayTourRow from "@/components/intro/ReplayTourRow";

const LOOKS: ReadonlyArray<[ThemePref, string]> = [
  ["night", "Dark"],
  ["day", "Light"],
  ["clock", "Lagos clock"],
];

/** Dark by default; light, or light by day and dark after sunset, if you'd rather. */
function Appearance() {
  const [pref, setPref] = useState<ThemePref>("night");
  // The choice lives in this browser, so read it after mount.
  useEffect(() => setPref(themePref()), []);
  return (
    <div className="px-4 py-3.5">
      <span className="seclabel block">APPEARANCE</span>
      <div role="radiogroup" aria-label="Appearance" className="mt-2 grid grid-cols-3 gap-1.5">
        {LOOKS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={pref === k}
            onClick={() => {
              setThemePref(k);
              setPref(k);
            }}
            className={clsx("chip px-2", pref === k && "border-orange bg-orange text-brand-ink")}
          >
            {label}
          </button>
        ))}
      </div>
      {pref === "clock" && <p className="hint mt-2">Light from 6:30am, dark after 6:45pm, Lagos time.</p>}
    </div>
  );
}

/** One on/off setting: a row like HOME AREA (label, value, one small action) with a quiet line under it. */
function SwitchRow({ label, on, line, onToggle }: { label: string; on: boolean; line: string; onToggle: () => void }) {
  return (
    <div>
      <RowValue label={label} value={on ? "On" : "Off"} action={on ? "TURN OFF" : "TURN ON"} onAction={onToggle} />
      <p className="hint -mt-1.5 px-4 pb-3.5" aria-live="polite">{line}</p>
    </div>
  );
}

/**
 * Sound and Buzz. Sound is the app's one mute (the speaker in Play and the button on Today are the same
 * switch, saved as hz-sound). Buzz is its own switch for the Android buzz (lib/haptics.ts), on by default.
 * Turning either on answers with a tiny tick or tap, so the tap is felt.
 */
function SoundRows() {
  const muted = useSyncExternalStore(sfx.subscribe, sfx.isMuted, () => false);
  const buzz = useSyncExternalStore(haptics.subscribe, haptics.isOn, () => true);
  const [canBuzz, setCanBuzz] = useState(true);
  // Whether the phone can buzz is only known in the browser, so read it after mount.
  useEffect(() => setCanBuzz(typeof navigator.vibrate === "function"), []);
  return (
    <>
      <SwitchRow
        label="SOUND"
        on={!muted}
        line={muted ? "Hoppaz stays quiet. You still see everything." : "You hear boxes, rewards and taps. Quieter from 11pm to 7am."}
        onToggle={() => {
          sfx.setMuted(!muted);
          if (muted) sfx.agogo(3);
        }}
      />
      <SwitchRow
        label="BUZZ"
        on={buzz}
        line={!canBuzz ? "This phone can't buzz. Android phones can." : buzz ? "A small buzz when something lands for you." : "No buzz."}
        onToggle={() => {
          haptics.setOn(!buzz);
          if (!buzz) haptics.buzz("snap");
        }}
      />
    </>
  );
}

/** What to tell the Hopper when alerts could not be turned on, and what they can do about it. */
const WHY: Record<Exclude<EnableResult, { ok: true }>["reason"], string> = {
  "needs-install": "On iPhone, alerts need Hoppaz on your home screen first.",
  unsupported: "Alerts need the app open on this device.",
  "no-key": "Alerts need the app open on this device.",
  denied: "Notifications are blocked for Hoppaz. Allow them in your browser settings, then pick again.",
  dismissed: "Alerts need the app open until you allow notifications.",
  "no-session": "Give it a moment, then try again.",
  server: "Could not turn alerts on. Try again in a minute.",
};

/**
 * Spawn alerts: Off, A few (about 3 a day) or All. The choice is kept in the
 * database; picking A few or All also asks the browser for permission and
 * subscribes it (lib/push.ts). On iPhone that first needs Hoppaz on the home
 * screen, which opens the install sheet. Hidden in demo mode (no database).
 */
function SpawnAlerts() {
  const userId = useSessionStore((s) => s.userId);
  const [level, setLevel] = useState<AlertLevel | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [problem, setProblem] = useState<Exclude<EnableResult, { ok: true }>["reason"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<string | null>(null);

  const refresh = async () => setPush(await pushState());

  useEffect(() => {
    if (!userId) return;
    let live = true;
    (async () => {
      const [l, p] = await Promise.all([getAlertLevel(), pushState()]);
      if (!live) return;
      setLevel(l);
      setPush(p);
      await syncPush();
    })();
    // The service worker asks for a fresh save when the browser rotates the subscription.
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === RESUBSCRIBE_MESSAGE) syncPush();
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      live = false;
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [userId]);

  if (!supabaseConfigured()) return null;

  const turnOn = async () => {
    setBusy(true);
    setProblem(null);
    const r = await enablePush();
    if (!r.ok) setProblem(r.reason);
    await refresh();
    setBusy(false);
  };

  const pick = async (next: AlertLevel) => {
    if (busy || next === level) return;
    const before = level;
    setLevel(next);
    setBusy(true);
    setTest(null);
    if (!(await setAlertLevel(next))) {
      setLevel(before);
      setBusy(false);
      return;
    }
    if (next === "off") {
      setProblem(null);
      await disablePush();
      await refresh();
      setBusy(false);
    } else {
      setBusy(false);
      await turnOn();
    }
  };

  const on = level !== null && level !== "off";
  const live = on && !!push?.subscribed;
  let line: string;
  if (level === null) line = "";
  else if (level === "off") line = "No alerts. You still see spots on the map when you look.";
  else if (live) line = `${level === "few" ? "About 3 a day" : "Every spot near you"}, even with the app closed. Nothing between 11pm and 8am.`;
  else if (problem) line = WHY[problem];
  else if (push?.support === "needs-install") line = WHY["needs-install"];
  else if (push?.permission === "denied") line = WHY.denied;
  else line = "Alerts need the app open.";

  const canInstall = on && !live && (problem === "needs-install" || push?.support === "needs-install");
  const canTurnOn = on && !live && !canInstall && push?.support === "ok" && push.permission !== "denied";

  return (
    <div className="px-4 py-3.5" data-intro="alerts">
      <span className="seclabel block">SPAWN ALERTS</span>
      <div role="radiogroup" aria-label="Spawn alerts" className="mt-2 grid grid-cols-3 gap-1.5">
        {ALERT_LEVELS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={level === k}
            disabled={level === null}
            onClick={() => pick(k)}
            className={clsx("chip px-2", level === k && "border-orange bg-orange text-brand-ink")}
          >
            {label}
          </button>
        ))}
      </div>
      {line && <p className="hint mt-2" aria-live="polite">{line}</p>}
      {canInstall && (
        <button type="button" data-intro="install" className="btn mt-3 w-full" onClick={askToInstall}>
          ADD TO HOME SCREEN
        </button>
      )}
      {canTurnOn && (
        <button type="button" className="btn mt-3 w-full" disabled={busy} onClick={turnOn}>
          {busy ? "ONE MOMENT" : "TURN ON ALERTS"}
        </button>
      )}
      {process.env.NODE_ENV !== "production" && live && (
        <div className="mt-3">
          <button
            type="button"
            className="btn btn-ghost w-full"
            onClick={async () => {
              setTest("Sending");
              const r = await sendTestAlert();
              setTest(r ? `Sent to ${r.sent} browser${r.sent === 1 ? "" : "s"}` : "Could not send");
            }}
          >
            SEND ME A TEST ALERT
          </button>
          {test && <p className="hint mt-2" aria-live="polite">{test} (development only)</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Settings, folded away at the bottom of Me. Name, home area, appearance, sound and
 * buzz, spawn alerts, account, replay the intro, privacy, community rules, staff
 * (only for staff) and delete.
 */
export default function SettingsGroup({
  className = "mt-7",
  name,
  handle,
  area,
  hasAccount,
  email,
  accountReady,
  isAdmin,
  onSaveName,
  onChangeArea,
  onReplayIntro,
  onDelete,
}: {
  className?: string;
  name: string | null;
  handle: string | null;
  area: string;
  hasAccount: boolean;
  email: string | null;
  /** Hide the account row until we know if there is one. */
  accountReady: boolean;
  isAdmin: boolean;
  onSaveName: (name: string | null) => Promise<void>;
  onChangeArea: () => void;
  onReplayIntro: () => void;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sure, setSure] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <section aria-label="Settings" className={className}>
      <div className="overflow-hidden rounded-hz border border-line bg-ink-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="me-settings"
          className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left focus-visible:[outline-offset:-2px]"
        >
          <Settings size={19} strokeWidth={1.9} aria-hidden className="flex-none text-dim" />
          <span className="min-w-0 flex-1 font-body text-[15px] font-semibold">Settings</span>
          <ChevronDown size={18} aria-hidden className={clsx("flex-none text-dim transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div id="me-settings" className="border-t border-line [&>*+*]:border-t [&>*+*]:border-line">
            {editing ? (
              <form
                className="px-4 py-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await onSaveName(draft.trim().slice(0, 24) || null);
                  setEditing(false);
                }}
              >
                <label className="label" htmlFor="me-name">
                  What should the bus call you
                </label>
                <input id="me-name" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={24} autoComplete="off" autoFocus />
                <p className="hint mt-2">
                  Your crew searches for this name. In chat you show as @{handle ?? "your handle"}, so people know it&apos;s you.
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="submit" className="btn flex-1">SAVE</button>
                  <button type="button" className="btn btn-ghost flex-none" onClick={() => setEditing(false)}>CANCEL</button>
                </div>
              </form>
            ) : (
              <RowValue
                label="NAME"
                value={name || "Hopper"}
                action="EDIT"
                onAction={() => {
                  setDraft(name ?? "");
                  setEditing(true);
                }}
              />
            )}
            <RowValue label="HOME AREA" value={area} action="CHANGE" onAction={onChangeArea} />
            <Appearance />
            <SoundRows />
            <SpawnAlerts />
            {accountReady &&
              (hasAccount ? (
                <RowLink href="/account" icon={UserRound} title="Account" hint={email ?? undefined} />
              ) : (
                <RowLink href="/account" icon={UserRound} title="Make an account" hint="Wave at people, join crews, chat privately. Your XP comes with you." />
              ))}
            <RowButton icon={Play} title="Replay the intro" onClick={onReplayIntro} />
            <ReplayTourRow />
            <RowLink href="/privacy" icon={Lock} title="Privacy" />
            <RowLink href="/community" icon={FileText} title="Community rules" />
            {isAdmin && <RowLink href="/admin" icon={ShieldCheck} title="Staff" />}
            {sure ? (
              <div className="px-4 py-4">
                <p className="font-body text-[15px] font-semibold text-fireant">Delete your account?</p>
                <p className="hint mt-1">
                  Your nights, chats, crews and photos go with it. No coming back.
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn flex-1" onClick={() => setSure(false)}>
                    KEEP IT
                  </button>
                  <button
                    type="button"
                    disabled={deleting}
                    className="btn btn-ghost flex-1 border-fireant text-fireant"
                    onClick={async () => {
                      setDeleting(true);
                      await onDelete();
                      setDeleting(false);
                    }}
                  >
                    {deleting ? "DELETING" : "DELETE FOREVER"}
                  </button>
                </div>
              </div>
            ) : (
              <RowButton icon={Trash2} title="Delete my account" tone="danger" chevron={false} onClick={() => setSure(true)} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

