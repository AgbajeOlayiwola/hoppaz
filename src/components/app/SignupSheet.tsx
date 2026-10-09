"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import Mascot from "@/components/Mascot";
import SignupForm from "@/components/app/SignupForm";
import { useAccountGate } from "@/lib/accountGate";
import { useToast } from "@/lib/store";

/**
 * The sign-up sheet. Opens when a Hopper without an account tries something
 * that needs one (accountGate.requireAccount), says what it was, and finishes
 * it for them once they're in. Mounted once in layout.tsx.
 */
export default function SignupSheet() {
  const { open, reason, pending, close } = useAccountGate();
  const say = useToast((s) => s.say);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60" onClick={close}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Make an account"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[92%] w-full max-w-[480px] animate-rise overflow-y-auto rounded-t-[14px] border-t border-line bg-ink-2 px-4 pt-3 shadow-sheet outline-none"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <button type="button" onClick={close} aria-label="Not now" className="absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center text-dim hover:text-cream">
          <X size={18} />
        </button>

        <div className="mb-4 flex items-center gap-3 pr-9">
          <Mascot state="oya" size={72} className="rig-on-raised flex-none" />
          <div className="min-w-0">
            <h2 className="font-display text-[22px] font-black leading-[1.1]">Make an account to {reason}.</h2>
            <p className="hint mt-1">Takes 20 seconds. Then it&apos;s done for you.</p>
          </div>
        </div>

        <SignupForm
          onDone={(how) => {
            const then = pending;
            close();
            say(how === "create" ? "You're in. Welcome to Hoppaz." : "Welcome back.", "ok");
            // Finish what they were doing, now that they can.
            then?.();
          }}
        />
      </div>
    </div>
  );
}
