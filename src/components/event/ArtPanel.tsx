"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import Wordmark from "@/components/Wordmark";

/* eslint-disable @next/next/no-img-element -- organiser flyers come from anywhere, sizes unknown */

/**
 * The art at the top of the stub. With a flyer: the whole flyer, centred on a
 * soft blur of itself (flyers are posters, not banners), and a tap opens it full
 * size. Without one: a calm branded strip. Never a made-up picture.
 */
export default function ArtPanel({
  flyer,
  alt,
  vibe,
  tone,
  tall = false,
}: {
  /** The full event page: a hero, not a strip. */
  tall?: boolean;
  flyer: string | null;
  alt: string;
  vibe: string;
  /** Wordmark tone for the strip: the card's own theme, not the page's. */
  tone: "cream" | "ink";
}) {
  const [broken, setBroken] = useState(false);
  const [zoom, setZoom] = useState(false);

  // Escape closes the flyer first, and never reaches the sheet behind it.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setZoom(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoom]);

  if (!flyer || broken) {
    return (
      <div className="flex h-[72px] flex-none items-end justify-between border-y border-line bg-ink-3 px-5 pb-3">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-dim">{vibe}</span>
        <Wordmark size={13} tone={tone} className="opacity-60" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoom(true)}
        aria-label="Open the flyer full size"
        className="relative block w-full flex-none overflow-hidden border-y border-line bg-ink-3"
        style={{ height: tall ? "clamp(240px, 46svh, 460px)" : "clamp(140px, 23svh, 210px)" }}
      >
        <img src={flyer} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-xl" />
        <img src={flyer} alt={alt} onError={() => setBroken(true)} className="relative h-full w-full object-contain" />
        <span aria-hidden className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-brand-ink/70 text-brand-cream">
          <Maximize2 size={14} />
        </span>
      </button>
      {zoom &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            className="fixed inset-0 z-[60] grid place-items-center bg-brand-ink/95 p-4 animate-fade"
            onClick={() => setZoom(false)}
          >
            <img src={flyer} alt={alt} className="max-h-full max-w-full object-contain" />
            <button
              onClick={() => setZoom(false)}
              aria-label="Close flyer"
              className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-full bg-brand-ink/70 text-brand-cream"
              style={{ top: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
            >
              <X size={20} />
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
