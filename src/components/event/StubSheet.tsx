"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import type { Theme } from "@/lib/theme";

/**
 * The one sheet the event page and the Hop share: a tall ticket stub that rises
 * from the bottom (about 85% of the screen at most), with a grab handle, a
 * hairline top edge and two punched notches.
 *
 * Layout: a scrolling body, then an optional footer pinned under a dashed
 * perforation. The notches sit on that perforation, so the "tear-off" part
 * (the going button, the seat button) is always in reach.
 *
 * theme forces the stub's own day or night colours (a card follows its event);
 * leave it out to follow the page.
 */
export default function StubSheet({
  label,
  theme,
  onClose,
  closeOnEscape = true,
  footer,
  children,
}: {
  label: string;
  theme?: Theme;
  onClose: () => void;
  closeOnEscape?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const stub = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const [notchY, setNotchY] = useState<number | null>(null);
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y: number; t: number } | null>(null);
  const hasFooter = !!footer;

  useEffect(() => {
    shell.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOnEscape, onClose]);

  // The notches ride the perforation, wherever the footer ends up.
  useLayoutEffect(() => {
    const s = stub.current;
    const f = foot.current;
    if (!s || !f) {
      setNotchY(null);
      return;
    }
    const measure = () => setNotchY(f.offsetTop + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    ro.observe(f);
    return () => ro.disconnect();
  }, [hasFooter]);

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, t: Date.now() };
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const moved = Math.max(0, e.clientY - d.y);
    const quick = moved > 36 && Date.now() - d.t < 260;
    if (moved > 110 || quick) onClose();
    else setDy(0);
  };

  return (
    <div
      ref={shell}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className="absolute inset-x-2 bottom-0 z-40 mx-auto flex max-h-[85%] max-w-[600px] flex-col rounded-t-[14px] outline-none animate-rise"
      // "translate" is its own property, so the rise animation (which owns "transform") cannot undo a drag.
      style={{ translate: dy ? `0 ${dy}px` : undefined, transition: drag.current ? "none" : "translate .18s ease-out" }}
    >
      <div
        ref={stub}
        className={clsx("stub flex min-h-0 flex-1 flex-col rounded-b-none rounded-t-[14px] border-b-0", theme && `stub-${theme}`)}
        style={notchY != null ? ({ "--notch-y": `${notchY}px` } as React.CSSProperties) : undefined}
      >
        <div
          aria-hidden
          className="flex h-8 flex-none cursor-grab touch-none items-center justify-center"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <span className="h-1 w-10 rounded-full bg-dim/40" />
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-0 top-0 z-10 grid h-11 w-11 place-items-center text-dim hover:text-cream"
        >
          <X size={18} />
        </button>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div data-evt-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {children}
          </div>
          {/* A short fade so nothing looks sliced where the body runs under the perforation. */}
          {footer && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-ink-2 to-transparent" />}
        </div>

        {footer && (
          <div ref={foot} className="flex-none border-t border-dashed border-line px-5 pb-4 pt-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
