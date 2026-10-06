"use client";

import { useToast } from "@/lib/store";
import clsx from "clsx";

export default function Toaster() {
  const toast = useToast((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "fixed left-1/2 -translate-x-1/2 bottom-24 z-50 animate-pop",
        "font-display font-black text-xs px-4 py-3 rounded shadow-[0_8px_24px_rgba(0,0,0,.5)]",
        "max-w-[86vw] text-center",
        toast.tone === "violet" ? "bg-violet text-cream" : "bg-cream text-ink"
      )}
    >
      {toast.text}
    </div>
  );
}
