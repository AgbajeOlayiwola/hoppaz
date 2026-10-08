"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";
import { X } from "lucide-react";

/** The longest side the frame is read at. Bigger frames only slow the phone down. */
const MAX_SIDE = 960;

/**
 * Local-only QR reader. Frames stay on the phone; only the decoded short token
 * is sent anywhere. It paints into document.body, because the event page is a
 * masked ticket stub and a mask would clip a full-screen overlay to its shape.
 */
export default function QrScanner({ onRead, onClose }: { onRead: (value: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const read = useRef(onRead);
  const [error, setError] = useState("");

  useEffect(() => {
    read.current = onRead;
  });

  useEffect(() => {
    box.current?.focus();
    // Capture, so Escape closes the scanner and never the sheet underneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) return;
        const el = video.current;
        if (!el) return;
        el.srcObject = stream;
        await el.play();
        const tick = () => {
          if (stopped) return;
          const v = video.current;
          const c = canvas.current;
          if (v && c && v.readyState >= 2 && v.videoWidth) {
            const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
            c.width = Math.round(v.videoWidth * scale);
            c.height = Math.round(v.videoHeight * scale);
            const ctx = c.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, c.width, c.height);
              const img = ctx.getImageData(0, 0, c.width, c.height);
              const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
              if (hit?.data) {
                stopped = true;
                read.current(hit.data);
                return;
              }
            }
          }
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setError("Camera didn't open. Allow camera access, or type the code.");
      }
    };

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center bg-brand-ink/90 p-4" onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Scan the venue code"
        tabIndex={-1}
        className="card w-full max-w-sm outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="font-display text-base font-black">Scan the venue code</h2>
          <button onClick={onClose} aria-label="Close scanner" className="-mr-2 grid h-11 w-11 flex-none place-items-center text-dim hover:text-cream">
            <X size={20} />
          </button>
        </div>

        <div className="relative">
          <video ref={video} playsInline muted className="aspect-square w-full rounded-hz bg-ink" />
          {/* Viewfinder corners, always cream: they sit on a camera picture, not on the page. */}
          <span aria-hidden className="pointer-events-none absolute inset-[12%]">
            <i className="absolute left-0 top-0 h-7 w-7 rounded-tl-[4px] border-l-[3px] border-t-[3px] border-brand-cream" />
            <i className="absolute right-0 top-0 h-7 w-7 rounded-tr-[4px] border-r-[3px] border-t-[3px] border-brand-cream" />
            <i className="absolute bottom-0 left-0 h-7 w-7 rounded-bl-[4px] border-b-[3px] border-l-[3px] border-brand-cream" />
            <i className="absolute bottom-0 right-0 h-7 w-7 rounded-br-[4px] border-b-[3px] border-r-[3px] border-brand-cream" />
          </span>
        </div>
        <canvas ref={canvas} className="hidden" />

        {error ? (
          <>
            <p role="alert" className="mt-3 font-body text-[13px] font-medium leading-snug text-fireant">
              {error}
            </p>
            <button onClick={onClose} className="btn btn-ghost mt-3 w-full">
              TYPE THE CODE
            </button>
          </>
        ) : (
          <p className="hint mt-3">Hold the code inside the corners. Nothing leaves your phone.</p>
        )}
      </div>
    </div>,
    document.body
  );
}
