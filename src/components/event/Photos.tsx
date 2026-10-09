"use client";

import { useRef } from "react";
import { Camera } from "lucide-react";
import type { EventPhoto } from "@/lib/types";

/* eslint-disable @next/next/no-img-element -- user uploads from Supabase storage, sizes unknown */

const LINK =
  "inline-flex min-h-[44px] items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream underline decoration-orange decoration-2 underline-offset-4 disabled:no-underline disabled:opacity-60";

/** What the picker hands back, so the page can run the upload. */
export type PhotoPicker = { open: () => void; input: React.ReactNode };

/** A hidden file input plus a way to open it; the page owns what happens to the file. */
export function usePhotoPicker(onFile: (f: File) => void): PhotoPicker {
  const file = useRef<HTMLInputElement>(null);
  return {
    open: () => file.current?.click(),
    input: (
      <input
        ref={file}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    ),
  };
}

/**
 * Pictures from the night: only when there are approved ones. The "add a photo"
 * link shows only after check-in. With nothing to show and nothing to add, the
 * whole section is simply not there.
 */
export default function Photos({
  photos,
  title,
  checkedIn,
  uploading,
  onAdd,
}: {
  photos: EventPhoto[];
  title: string;
  checkedIn: boolean;
  uploading: boolean;
  onAdd: () => void;
}) {
  if (!photos.length && !checkedIn) return null;
  const add = (
    <button type="button" className={LINK} onClick={onAdd} disabled={uploading}>
      <Camera size={14} aria-hidden /> {uploading ? "SENDING…" : "ADD A PHOTO"}
    </button>
  );
  if (!photos.length) {
    return <section className="px-5 pt-3">{add}</section>;
  }
  return (
    <section className="pt-6" aria-label="Photos from the night">
      <div className="flex items-center justify-between px-5">
        <p className="seclabel">PHOTOS FROM THE NIGHT</p>
        {checkedIn && add}
      </div>
      <div className="mt-1 flex snap-x gap-2 overflow-x-auto px-5 pb-1">
        {photos.map((p) => (
          <img
            key={p.id}
            src={p.url}
            alt={`From ${title}`}
            loading="lazy"
            className="h-40 w-32 flex-none snap-start rounded-hz border border-line object-cover"
          />
        ))}
      </div>
    </section>
  );
}
