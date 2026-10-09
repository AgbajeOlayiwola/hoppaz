"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bookmark, EllipsisVertical, Share, SquarePlus, X } from "lucide-react";
import Mascot from "@/components/Mascot";
import { FIRST_GOING_EVENT } from "@/lib/useGoing";
import { FIRST_CHECKIN_EVENT } from "@/lib/useCheckin";
import { SIGNED_IN_EVENT } from "@/components/app/SignupForm";

/**
 * "Keep Hoppaz on your home screen." A sheet, never a screen, and it never
 * leads: it only appears after a win.
 *
 *   0. Right after making an account or logging in (SIGNED_IN_EVENT), every time
 *      until it's installed. Where the browser can't install, it shows how to
 *      bookmark instead.
 *   1. After the first "I'm going" (FIRST_GOING_EVENT).
 *   2. If that was dismissed, once more after the first check-in (FIRST_CHECKIN_EVENT).
 *   3. Then never again, and never inside the installed app.
 *
 * Android (Chrome): the browser's real install prompt, fired from our own
 * button. iPhone has no such API, so it shows Share, then Add to Home Screen.
 * Anywhere that can do neither (desktop, in-app browsers) it stays quiet and
 * keeps its chances for later.
 *
 * If another sheet is open when its moment comes (the event card the Hopper just
 * tapped "I'm going" on), it waits for that sheet to close: it never covers the
 * "you're going" stamp.
 *
 * Fixed above the tab bar (the app's own Sheet is absolute inside <main>, which
 * the event page already uses). Mounted once in layout.tsx.
 */

const KEY = "hoppaz.install";
const DELAY_MS = 1400; // let the stamp and the toast land first
/** Where an install nudge is never right: public posters and staff tools. */
const QUIET_PATHS = [/^\/report\//, /^\/admin/];
/** How often to look again while another sheet is still open, and the breath after it closes. */
const WAIT_POLL_MS = 500;
const AFTER_CLOSE_MS = 500;
const LABEL = "Add Hoppaz to your home screen";

/** Any sheet or reveal on screen other than this one. */
const otherDialogOpen = () => !!document.querySelector(`[role="dialog"]:not([aria-label="${LABEL}"])`);

type Stage = 0 | 1 | 2; // how many times it has been shown
type Saved = { stage: Stage; done?: boolean };

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** iPhone or iPad in a browser that can add to the home screen (not an in-app webview). */
function isIosBrowser() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && !/FBAN|FBAV|Instagram|Snapchat|Line\/|Twitter|TikTok|GSA\//.test(ua);
}

export default function InstallSheet() {
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"android" | "ios" | "bookmark">("ios");
  const [bottom, setBottom] = useState(0);
  const deferred = useRef<InstallPromptEvent | null>(null);
  const memory = useRef<Saved>({ stage: 0 }); // when storage is blocked, this phone-session is all we have
  const box = useRef<HTMLDivElement>(null);

  const read = useCallback((): Saved => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as Saved;
    } catch {
      /* private mode: fall through to memory */
    }
    return memory.current;
  }, []);
  const save = useCallback((s: Saved) => {
    memory.current = s;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearTimeout(timer);
      clearInterval(poll);
    };

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the browser's own bar away; we ask at the right moment
      deferred.current = e as InstallPromptEvent;
    };
    const onInstalled = () => {
      deferred.current = null;
      save({ stage: 2, done: true });
      setOpen(false);
    };
    const attempt = (moment: "signup" | "going" | "checkin") => {
      const s = read();
      if (s.done || isStandalone()) return;
      if (moment === "going" && s.stage >= 1) return;
      if (moment === "checkin" && s.stage >= 2) return;
      if (QUIET_PATHS.some((re) => re.test(pathRef.current))) return;
      // Right after sign-up, anywhere that can't install still gets told how to bookmark.
      const next = deferred.current ? "android" : isIosBrowser() ? "ios" : moment === "signup" ? "bookmark" : null;
      if (!next) return; // nothing to offer here, keep the chance
      const show = () => {
        if (isStandalone() || QUIET_PATHS.some((re) => re.test(pathRef.current))) return;
        const nav = document.querySelector('nav[aria-label="Main"]');
        setBottom(nav ? Math.round(nav.getBoundingClientRect().height) : 0);
        setMode(next);
        setOpen(true);
        // The sign-up nudge doesn't use up the later chances.
        if (moment !== "signup") save({ ...read(), stage: moment === "going" ? 1 : 2 });
      };
      stop();
      timer = setTimeout(() => {
        if (!otherDialogOpen()) return show();
        // The chance is kept (the stage is only saved once it shows): look again until that sheet closes.
        poll = setInterval(() => {
          if (otherDialogOpen()) return;
          stop();
          timer = setTimeout(show, AFTER_CLOSE_MS);
        }, WAIT_POLL_MS);
      }, DELAY_MS);
    };
    const onSignedIn = () => attempt("signup");
    const onGoing = () => attempt("going");
    const onCheckin = () => attempt("checkin");

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener(SIGNED_IN_EVENT, onSignedIn);
    window.addEventListener(FIRST_GOING_EVENT, onGoing);
    window.addEventListener(FIRST_CHECKIN_EVENT, onCheckin);
    return () => {
      stop();
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener(SIGNED_IN_EVENT, onSignedIn);
      window.removeEventListener(FIRST_GOING_EVENT, onGoing);
      window.removeEventListener(FIRST_CHECKIN_EVENT, onCheckin);
    };
  }, [read, save]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const install = async () => {
    const p = deferred.current;
    deferred.current = null; // the browser only lets a saved prompt fire once
    if (!p) return close();
    try {
      await p.prompt();
      const choice = await p.userChoice;
      if (choice.outcome === "accepted") save({ stage: 2, done: true });
    } catch {
      /* the browser refused; treat as not now */
    }
    close();
  };

  if (!open) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[55] flex justify-center"
      style={{ bottom }}
    >
      <div
        ref={box}
        role="dialog"
        aria-label={LABEL}
        tabIndex={-1}
        className="pointer-events-auto relative w-full max-w-[480px] animate-rise rounded-t-[12px] border-t border-line bg-ink-2 px-4 pt-3 shadow-sheet outline-none"
        style={{ paddingBottom: bottom ? "1rem" : "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center text-dim hover:text-cream"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-4 pr-8">
          <Mascot state="oya" size={88} className="rig-on-raised flex-none" />
          <div className="min-w-0">
            <h2 className="font-display text-[22px] font-black leading-[1.1]">{mode === "bookmark" ? "Keep Hoppaz one tap away." : "Keep Hoppaz on your home screen."}</h2>
            <p className="hint mt-1.5">One tap to tonight.</p>
          </div>
        </div>

        {mode === "bookmark" ? (
          <BookmarkSteps />
        ) : mode === "ios" ? (
          <ol className="mt-4 space-y-2">
            <li className="flex items-center gap-3 rounded-hz border border-line bg-ink-3 px-3 py-2.5">
              <span className="font-mono text-[11px] text-dim">01</span>
              <span className="flex-1 font-body text-[15px]">Tap Share</span>
              <Share size={20} strokeWidth={1.9} aria-hidden />
            </li>
            <li className="flex items-center gap-3 rounded-hz border border-line bg-ink-3 px-3 py-2.5">
              <span className="font-mono text-[11px] text-dim">02</span>
              <span className="flex-1 font-body text-[15px]">Then Add to Home Screen</span>
              <SquarePlus size={20} strokeWidth={1.9} aria-hidden />
            </li>
          </ol>
        ) : (
          <button type="button" onClick={install} className="btn mt-4 w-full">
            ADD TO HOME SCREEN
          </button>
        )}

        <button
          type="button"
          onClick={close}
          className={mode !== "android" ? "btn btn-ghost mt-3 w-full" : "mt-1 flex min-h-[44px] w-full items-center justify-center font-mono text-[11px] font-medium tracking-[0.14em] text-dim"}
        >
          NOT NOW
        </button>
      </div>
    </div>
  );
}

/** No install button here (a laptop, or a phone browser without one): how to keep Hoppaz a tap away anyway. */
function BookmarkSteps() {
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  const row = "flex items-center gap-3 rounded-hz border border-line bg-ink-3 px-3 py-2.5";
  return touch ? (
    <ol className="mt-4 space-y-2">
      <li className={row}>
        <span className="font-mono text-[11px] text-dim">01</span>
        <span className="flex-1 font-body text-[15px]">Open your browser menu</span>
        <EllipsisVertical size={20} strokeWidth={1.9} aria-hidden />
      </li>
      <li className={row}>
        <span className="font-mono text-[11px] text-dim">02</span>
        <span className="flex-1 font-body text-[15px]">Tap Add to Home screen</span>
        <SquarePlus size={20} strokeWidth={1.9} aria-hidden />
      </li>
    </ol>
  ) : (
    <div className={`mt-4 ${row}`}>
      <Bookmark size={20} strokeWidth={1.9} aria-hidden />
      <span className="flex-1 font-body text-[15px]">Bookmark it: press <kbd className="font-mono text-[13px] font-semibold">{mac ? "⌘ + D" : "Ctrl + D"}</kbd></span>
    </div>
  );
}
