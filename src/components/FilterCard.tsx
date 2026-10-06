"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import { VIBES } from "@/lib/brand";
import { dateKey, dateOptions, type DateFilter } from "@/lib/filters";

/** The map's filter card: which night, what kind of event. Same floating card as an event. */
export default function FilterCard({
  date,
  types,
  count,
  onDate,
  onTypes,
  onClear,
  onClose,
}: {
  date: DateFilter;
  types: string[];
  count: number;
  onDate: (d: DateFilter) => void;
  onTypes: (t: string[]) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const active = dateKey(date);
  const toggle = (v: string) => onTypes(types.includes(v) ? types.filter((t) => t !== v) : [...types, v]);

  return (
    <div
      role="dialog"
      aria-label="Filter events"
      className="absolute inset-x-3 bottom-3 z-40 flex max-h-[70%] flex-col overflow-hidden rounded-lg border border-line bg-ink-2 shadow-sheet animate-rise"
    >
      <div className="flex flex-none items-center justify-between border-b border-line px-4 py-3">
        <p className="font-display text-base font-black">Filter the night</p>
        <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center text-dim hover:text-cream">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <p className="label">When</p>
        <div role="radiogroup" aria-label="Date" className="flex flex-wrap gap-1.5">
          {dateOptions().map((o) => (
            <button
              key={o.key}
              role="radio"
              aria-checked={active === o.key}
              onClick={() => onDate(o.value)}
              className={clsx(
                "rounded-sm border px-2.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.08em]",
                active === o.key ? "border-orange bg-orange text-ink" : "border-line text-cream"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-baseline justify-between">
          <p className="label">What kind</p>
          {types.length > 0 && (
            <button onClick={() => onTypes([])} className="font-mono text-[9px] font-bold tracking-widest text-dim">
              ALL TYPES
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {VIBES.map((v) => (
            <button
              key={v}
              aria-pressed={types.includes(v)}
              onClick={() => toggle(v)}
              className={clsx(
                "rounded-full border px-3 py-1.5 font-display text-[11px] font-black capitalize",
                types.includes(v) ? "border-orange bg-orange text-ink" : "border-line text-cream"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-none gap-2 border-t border-line px-4 py-3">
        <button className="btn flex-1" onClick={onClose}>
          {count ? `SHOW ${count} EVENT${count === 1 ? "" : "S"}` : "NOTHING MATCHES"}
        </button>
        <button className="btn btn-ghost flex-none" onClick={onClear}>
          CLEAR
        </button>
      </div>
    </div>
  );
}
