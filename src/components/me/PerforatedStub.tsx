"use client";

import { useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";

/**
 * A ticket stub in two parts with a dashed perforation between them. The two
 * punched notches sit exactly on the perforation, however tall the top part
 * turns out to be (it is measured, so a long description moves them with it).
 */
export default function PerforatedStub({
  top,
  bottom,
  className,
  topClassName = "px-4 py-4",
  bottomClassName = "px-4 py-4",
  notch = 9,
}: {
  top: React.ReactNode;
  bottom?: React.ReactNode;
  className?: string;
  topClassName?: string;
  bottomClassName?: string;
  notch?: number;
}) {
  const topRef = useRef<HTMLDivElement>(null);
  const [y, setY] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const measure = () => setY(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <article
      className={clsx("stub", className)}
      style={{ ["--notch" as string]: `${notch}px`, ["--notch-y" as string]: y === null || !bottom ? "50%" : `${y}px` } as React.CSSProperties}
    >
      <div ref={topRef} className={topClassName}>
        {top}
      </div>
      {bottom && <div className={clsx("border-t border-dashed border-line", bottomClassName)}>{bottom}</div>}
    </article>
  );
}
