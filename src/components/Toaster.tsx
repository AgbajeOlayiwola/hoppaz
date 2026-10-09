"use client";

import { useToast, type ToastTone } from "@/lib/store";
import clsx from "clsx";

/**
 * One plain toast: a raised card, a hairline, and one coloured dot that says
 * what happened. Violet is kept for drops and rewards, so a violet dot means
 * something rare happened. Older call sites still pass "violet" for any
 * success; those read as done unless the message is about a drop or reward.
 */
const DROPPY = /DROP|REWARD|COLLECT|REVEAL|YOU GOT/i;

function dotFor(tone: ToastTone, text: string) {
  if (tone === "error") return "bg-fireant";
  if (tone === "ok") return "bg-keke";
  if (tone === "violet") return DROPPY.test(text) ? "bg-violet" : "bg-keke";
  return "bg-dim";
}

export default function Toaster() {
  const toast = useToast((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      // --hz-toast-lift: a page with its own card along the bottom (the map) says how tall it is, so the toast sits above it.
      style={{ bottom: "calc(5.25rem + var(--hz-toast-lift, 0px) + env(safe-area-inset-bottom, 0px))" }}
    >
      <div
        key={toast.id}
        className="flex max-w-md animate-stamp items-center gap-2.5 rounded-hz border border-line bg-ink-2 px-4 py-3 text-cream shadow-sheet"
      >
        <i aria-hidden className={clsx("h-2 w-2 flex-none rounded-full", dotFor(toast.tone, toast.text))} />
        <span className="font-body text-[13px] font-semibold leading-snug">{toast.text}</span>
      </div>
    </div>
  );
}
