"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export default function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    box.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={box}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className="absolute inset-x-0 bottom-0 z-40 max-h-[80%] overflow-y-auto rounded-t-lg
                 border-t-2 border-orange bg-ink-2 px-4 pt-4 shadow-sheet animate-rise outline-none"
      style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 grid h-7 w-7 place-items-center text-dim hover:text-cream"
      >
        <X size={16} />
      </button>
      {children}
    </div>
  );
}
