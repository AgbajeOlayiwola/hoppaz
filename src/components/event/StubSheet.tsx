"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronLeft, X } from "lucide-react";
import type { Theme } from "@/lib/theme";
import { SIDE_PANEL, SIDE_PANEL_CSS_WIDTH } from "./side";

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
 *
 * placement "side" docks it on the right of the map instead (side.ts sizes it,
 * the page sets --hz-side-top under its own chrome): it slides in from the edge,
 * has no grab handle, and closes with X or Escape.
 */
export default function StubSheet({
  label,
  theme,
  onClose,
  closeOnEscape = true,
  placement = "sheet",
  toolbar,
  footer,
  children,
}: {
  /** Side placement only: buttons in the top bar, left of the close button (the map's left and right). */
  toolbar?: React.ReactNode;
  label: string;
  theme?: Theme;
  onClose: () => void;
  closeOnEscape?: boolean;
  placement?: "sheet" | "side" | "page";
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
  const side = placement === "side";
  const page = placement === "page";

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

  if (page) {
    // The full event page: the same stub, filling the screen, with a back arrow instead of a close.
    return (
      <div className="absolute inset-0 flex flex-col">
        <div
          ref={stub}
          className={clsx("stub flex min-h-0 flex-1 flex-col rounded-none border-0", theme && `stub-${theme}`)}
          style={notchY != null ? ({ "--notch-y": `${notchY}px` } as React.CSSProperties) : undefined}
        >
          <div className="pad-top flex flex-none items-center gap-1 px-2 pb-1">
            <button onClick={onClose} aria-label="Back" className="grid h-11 w-11 place-items-center text-cream">
              <ChevronLeft size={26} strokeWidth={2.2} aria-hidden />
            </button>
            <p className="seclabel min-w-0 flex-1 truncate">{label}</p>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div data-evt-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="mx-auto max-w-[680px]">{children}</div>
            </div>
            {footer && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-ink-2 to-transparent" />}
          </div>
          {footer && (
            <div ref={foot} className="flex-none border-t border-dashed border-line px-5 pb-4 pt-4">
              <div className="mx-auto max-w-[680px]">{footer}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={shell}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={
        side
          ? "hz-slide-in absolute z-40 flex flex-col rounded-[14px] outline-none"
          : "absolute inset-x-2 bottom-0 z-40 mx-auto flex max-h-[85%] max-w-[600px] flex-col rounded-t-[14px] outline-none animate-rise"
      }
      style={
        side
          ? { top: "var(--hz-side-top, 140px)", bottom: SIDE_PANEL.gap, right: SIDE_PANEL.gap, width: SIDE_PANEL_CSS_WIDTH }
          : // "translate" is its own property, so the rise animation (which owns "transform") cannot undo a drag.
            { translate: dy ? `0 ${dy}px` : undefined, transition: drag.current ? "none" : "translate .18s ease-out" }
      }
    >
      <div
        ref={stub}
        className={clsx(
          "stub flex min-h-0 flex-1 flex-col",
          side ? "rounded-[14px]" : "rounded-b-none rounded-t-[14px] border-b-0",
          theme && `stub-${theme}`
        )}
        style={notchY != null ? ({ "--notch-y": `${notchY}px` } as React.CSSProperties) : undefined}
      >
        {side ? (
          toolbar ? <div className="flex h-11 flex-none items-center gap-1 pl-1.5 pr-12">{toolbar}</div> : <div aria-hidden className="h-3 flex-none" />
        ) : (
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
        )}
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
          <div ref={foot} className={clsx("flex-none border-t border-dashed border-line pt-4", side ? "px-4 pb-3" : "px-5 pb-4")}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
