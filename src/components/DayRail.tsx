"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CalendarDays } from "lucide-react";
import Sheet from "@/components/Sheet";
import { nightOf, railDays, type DateFilter } from "@/lib/filters";

/**
 * The day rail (the design system's "night rail"). Nobody going out picks
 * "October 17", they pick "Friday": fourteen days on a horizontal rail, each
 * with its weekday, date and how many events are on. The month grid sits
 * behind the calendar icon for the person planning three weeks ahead.
 *
 * One rail for the Map and Today, driven by the shared date filter.
 */

/** Events load up to 45 days ahead (useEvents), so the grid stops there. */
const LOADABLE_DAYS = 45;

export default function DayRail({
  value,
  onChange,
  counts,
  slim = false,
  lead,
  className,
}: {
  /** A chip before the days, e.g. the Map's NEXT 20. Selected when `on`. */
  lead?: { label: string; sub: string; aria: string; on: boolean; onClick: () => void };
  value: DateFilter;
  onChange: (f: DateFilter) => void;
  /** Events per day key (countByDay). */
  counts: Record<string, number>;
  /** The Map's thinner version. */
  slim?: boolean;
  className?: string;
}) {
  const [gridOpen, setGridOpen] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const days = useMemo(() => railDays(14), []);
  const selected = value.kind === "night" ? value.date : null;
  const offRail = selected !== null && !days.some((d) => d.date === selected);

  // Keep the chosen day in view.
  useEffect(() => {
    const el = rail.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [selected]);

  return (
    <div className={clsx("flex items-stretch gap-1.5", className)}>
      <div
        ref={rail}
        role="radiogroup"
        aria-label="Day"
        className="-my-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {lead && (
          <button
            role="radio"
            aria-checked={lead.on}
            aria-label={lead.aria}
            onClick={lead.onClick}
            className={clsx(
              "flex flex-none flex-col items-center justify-center rounded-hz border transition-[transform,box-shadow] duration-75",
              slim ? "min-w-[52px] px-1.5 py-1" : "min-w-[58px] px-2 py-1.5",
              lead.on ? "border-orange bg-orange text-brand-ink shadow-chunk active:translate-y-1 active:shadow-none" : "border-line bg-ink-2 text-cream"
            )}
          >
            <span className={clsx("font-mono font-medium tracking-[0.08em]", slim ? "text-[9.5px]" : "text-[10px]", lead.on ? "text-brand-ink" : "text-dim")}>
              {lead.label}
            </span>
            <span className={clsx("num", slim ? "text-[17px]" : "text-[22px]")}>{lead.sub}</span>
          </button>
        )}
        {days.map((d) => {
          const on = d.date === selected;
          const n = counts[d.date] ?? 0;
          return (
            <button
              key={d.date}
              role="radio"
              aria-checked={on}
              aria-label={`${d.isToday ? "Today" : d.weekday} ${d.day} ${d.month}, ${n} on`}
              onClick={() => onChange({ kind: "night", date: d.date })}
              className={clsx(
                "flex flex-none flex-col items-center justify-center rounded-hz border transition-[transform,box-shadow] duration-75",
                slim ? "min-w-[52px] px-1.5 py-1" : "min-w-[58px] px-2 py-1.5",
                on
                  ? "border-orange bg-orange text-brand-ink shadow-chunk active:translate-y-1 active:shadow-none"
                  : "border-line bg-ink-2 text-cream",
                !on && n === 0 && "opacity-55"
              )}
            >
              <span className={clsx("font-mono font-medium tracking-[0.08em]", slim ? "text-[9.5px]" : "text-[10px]", on ? "text-brand-ink" : "text-dim")}>
                {d.weekday}
              </span>
              <span className={clsx("num", slim ? "text-[17px]" : "text-[22px]")}>{d.day}</span>
              {!slim && (
                <span className={clsx("font-mono text-[10px]", on ? "text-brand-ink" : "text-dim")}>{n} on</span>
              )}
              {slim && n > 0 && (
                <span className={clsx("font-mono text-[9.5px]", on ? "text-brand-ink" : "text-dim")}>{n} on</span>
              )}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => setGridOpen(true)}
        aria-label="Pick a later date"
        className={clsx(
          "grid flex-none place-items-center rounded-hz border",
          slim ? "w-11" : "w-12",
          offRail ? "border-orange bg-orange text-brand-ink" : "border-line bg-ink-2 text-cream"
        )}
      >
        <CalendarDays size={18} aria-hidden />
      </button>
      <Sheet open={gridOpen} onClose={() => setGridOpen(false)} label="Pick a day">
        <MonthGrid
          selected={selected}
          counts={counts}
          onPick={(date) => {
            onChange({ kind: "night", date });
            setGridOpen(false);
          }}
        />
      </Sheet>
    </div>
  );
}

function MonthGrid({
  selected,
  counts,
  onPick,
}: {
  selected: string | null;
  counts: Record<string, number>;
  onPick: (date: string) => void;
}) {
  const today = nightOf(Date.now());
  const last = nightOf(Date.now() + LOADABLE_DAYS * 864e5);
  const months = useMemo(() => {
    const first = new Date(`${today}T12:00:00Z`);
    return [0, 1].map((k) => {
      const m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + k, 1, 12));
      const lead = (m.getUTCDay() + 6) % 7; // weeks start on Monday
      const len = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate();
      const cells: Array<string | null> = Array.from({ length: lead }, () => null);
      for (let d = 1; d <= len; d++) {
        cells.push(new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), d, 12)).toISOString().slice(0, 10));
      }
      return {
        title: m.toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" }),
        cells,
      };
    });
  }, [today]);

  return (
    <div className="pb-2">
      <h2 className="text-xl font-black">Pick a day</h2>
      <p className="hint mt-1">Events are listed up to six weeks ahead.</p>
      {months.map((m) => (
        <section key={m.title} className="mt-4">
          <p className="seclabel mb-2">{m.title}</p>
          <div className="grid grid-cols-7 gap-1">
            {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
              <span key={i} className="text-center font-mono text-[10px] text-dim">
                {w}
              </span>
            ))}
            {m.cells.map((date, i) => {
              if (!date) return <span key={`e${i}`} />;
              const usable = date >= today && date <= last;
              const n = counts[date] ?? 0;
              const on = date === selected;
              return (
                <button
                  key={date}
                  disabled={!usable}
                  onClick={() => onPick(date)}
                  aria-label={`${date}, ${n} on`}
                  className={clsx(
                    "flex aspect-square flex-col items-center justify-center rounded-hz border",
                    on ? "border-orange bg-orange text-brand-ink" : "border-line bg-ink-3 text-cream",
                    !usable && "opacity-30",
                    usable && !on && n === 0 && "opacity-60"
                  )}
                >
                  <span className="num text-[15px]">{Number(date.slice(8))}</span>
                  {usable && n > 0 && (
                    <span className={clsx("font-mono text-[9px]", on ? "text-brand-ink" : "text-dim")}>{n}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
