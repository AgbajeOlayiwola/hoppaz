"use client";

import clsx from "clsx";
import { Package, PackageOpen } from "lucide-react";
import type { DailyBox } from "@/lib/useDailyBox";

/**
 * Today's box: one a day, and opening it keeps your streak. A violet border
 * and a violet box, because boxes are violet; OPEN is the one orange button.
 * Once it is open the card says what you got and when to come back. Until we
 * know which of the two it is, the button waits instead of guessing.
 */
export default function TodaysBox({
  status,
  box,
  onOpen,
}: {
  status: "loading" | "ready" | "opened";
  box: DailyBox | null;
  onOpen: () => void;
}) {
  const opened = status === "opened" && !!box;
  return (
    <section
      aria-label="Today's box"
      className={clsx(
        "mt-3 flex items-center gap-3.5 rounded-hz border-[1.5px] bg-ink-2 px-3.5 py-3",
        opened ? "border-violet/50" : "border-violet"
      )}
    >
      <span aria-hidden className="grid h-11 w-11 flex-none place-items-center text-violet max-[359px]:hidden">
        {opened ? <PackageOpen size={30} strokeWidth={1.8} /> : <Package size={30} strokeWidth={1.8} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[17px] font-black leading-tight">Today&apos;s box</p>
        <p className="hint mt-0.5">{opened ? `${box.title} · +${box.xp} XP` : "Open it to keep your streak"}</p>
      </div>
      {opened ? (
        <span className="pill flex-none">BACK TOMORROW</span>
      ) : (
        <button type="button" onClick={onOpen} disabled={status !== "ready"} className="btn flex-none px-6">
          OPEN
        </button>
      )}
    </section>
  );
}
