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
      className="absolute inset-x-0 bottom-0 z-40 max-h-[85%] overflow-y-auto rounded-t-[12px]
                 border-t border-line bg-ink-2 px-4 pt-3 shadow-sheet animate-rise outline-none"
      style={{ paddingBottom: "1rem" }}
    >
      <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center text-dim hover:text-cream"
      >
        <X size={18} />
      </button>
      {children}
    </div>
  );
}
