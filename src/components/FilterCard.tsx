"use client";

import Sheet from "@/components/Sheet";
import { VIBES } from "@/lib/brand";
import type { DateFilter } from "@/lib/filters";

/**
 * "What kind": the map's one filter sheet. The day lives on the day rail now
 * (there is no "any day" and no date box here), so this is only the vibes.
 * Pick none and you see everything.
 */
export default function FilterCard({
  types,
  count,
  onTypes,
  onClear,
  onClose,
}: {
  types: string[];
  /** Events on the selected day that match the vibes picked. */
  count: number;
  onTypes: (t: string[]) => void;
  onClear: () => void;
  onClose: () => void;
  /** Older call sites passed these. The day is on the rail now, so they are ignored. */
  date?: DateFilter;
  onDate?: (d: DateFilter) => void;
}) {
  const toggle = (v: string) => onTypes(types.includes(v) ? types.filter((t) => t !== v) : [...types, v]);

  return (
    <Sheet open onClose={onClose} label="What kind">
      <h2 className="text-xl font-black">What kind</h2>
      <p className="hint mt-1">Pick a vibe or two. Pick none and you see it all.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {VIBES.map((v) => (
          <button key={v} aria-pressed={types.includes(v)} onClick={() => toggle(v)} className="chip">
            {v}
          </button>
        ))}
      </div>

      <div className="mt-5 flex gap-2">
        <button className="btn flex-1" onClick={onClose}>
          {count ? `Show ${count} event${count === 1 ? "" : "s"}` : "Nothing on for that"}
        </button>
        {types.length > 0 && (
          <button className="btn btn-ghost flex-none" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </Sheet>
  );
}
