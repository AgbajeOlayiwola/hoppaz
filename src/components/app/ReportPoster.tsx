"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Mascot from "@/components/Mascot";
import Wordmark from "@/components/Wordmark";
import LoadingStub from "@/components/app/LoadingStub";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";

/**
 * The shared month report, for people who may not have Hoppaz. A poster, not a
 * dashboard: the loud layer, always on the night ground, no app chrome (the tab
 * bar already hides on /report/).
 *
 * Uses the one RPC the page always used (get_monthly_report); nothing new is
 * read. A link that returns nothing, or errors, says it has expired instead of
 * loading forever.
 */

type Snapshot = {
  name?: string | null;
  verified_outings?: number | null;
  outing_streak?: number | null;
  lagos_rank?: number | null;
};
type Report = { month_start: string; snapshot: Snapshot };
type Load = { kind: "loading" } | { kind: "ready"; report: Report } | { kind: "gone" };

/** Local development only: /report/share/demo with no Supabase shows a sample poster. */
const DEMO_REPORT: Report = {
  month_start: new Date().toISOString().slice(0, 8) + "01",
  snapshot: { name: "Temi", verified_outings: 7, outing_streak: 4, lagos_rank: 12 },
};

function firstLoad(token: string): Load {
  if (supabaseConfigured()) return { kind: "loading" };
  if (process.env.NODE_ENV !== "production" && token === "demo") return { kind: "ready", report: DEMO_REPORT };
  return { kind: "gone" };
}

const whole = (n: unknown) => Math.max(0, Math.floor(Number(n) || 0));

export default function ReportPoster({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>(() => firstLoad(token));

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    sb.rpc("get_monthly_report", { p_token: token }).then(
      ({ data, error }) => {
        if (!alive) return;
        const report = data as Report | null;
        setLoad(!error && report?.snapshot ? { kind: "ready", report } : { kind: "gone" });
      },
      () => alive && setLoad({ kind: "gone" })
    );
    return () => {
      alive = false;
    };
  }, [token]);

  // The poster is always night, so the browser bar should be too, whatever the Lagos clock says.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const was = meta?.getAttribute("content");
    meta?.setAttribute("content", "#0E0B0A");
    return () => {
      if (was) meta?.setAttribute("content", was);
    };
  }, []);

  return (
    <div className="hz-poster relative h-full overflow-y-auto overflow-x-hidden">
      <div aria-hidden className="hz-grain pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex min-h-full w-full max-w-[440px] flex-col px-4 pb-6">
        <div className="pad-top flex items-center justify-between pb-2">
          <Wordmark size={16} tone="cream" />
          <span className="font-mono text-[10px] font-medium tracking-[0.18em] text-dim">OUTSIDE REPORT</span>
        </div>

        {load.kind === "loading" && (
          <div className="flex flex-1 flex-col justify-center py-8">
            <LoadingStub label="Loading the report" lines={3} />
          </div>
        )}
        {load.kind === "gone" && <Expired />}
        {load.kind === "ready" && <Poster report={load.report} />}
      </div>
    </div>
  );
}

function Expired() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
      <Mascot state="oops" size={150} />
      <h1 className="mt-4 text-balance font-display text-[28px] font-black leading-[1.1]">This report has expired.</h1>
      <p className="hint mt-2 max-w-[18rem]">Ask them to send a fresh one.</p>
      <OpenHoppaz className="mt-6 w-full" />
    </div>
  );
}

function OpenHoppaz({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`btn min-h-[56px] text-[16px] ${className}`}>
      OPEN HOPPAZ
    </Link>
  );
}

function Poster({ report }: { report: Report }) {
  const s = report.snapshot;
  const name = (s.name ?? "").trim() || "A Hopper";
  const outings = whole(s.verified_outings);
  const streak = whole(s.outing_streak);
  const rank = whole(s.lagos_rank);
  const month = new Date(`${report.month_start}T12:00:00`).toLocaleDateString("en-NG", {
    month: "long",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });

  // The name sets the size: short names shout, long ones still fit on the line.
  const longest = Math.max(...name.split(/\s+/).map((w) => w.length), 1);
  const namePx = Math.max(18, Math.min(84, Math.floor(336 / (longest * 0.8))));
  // Two digits is the norm; a rare third shrinks so it never runs under the mascot.
  const heroPx = String(outings).length > 2 ? 100 : 150;

  return (
    <>
      <div className="mt-7" style={{ transform: "rotate(-3deg)", transformOrigin: "0 50%" }}>
        <h1 className="font-display font-black uppercase leading-[0.9] tracking-[-0.01em]" style={{ textShadow: "3px 3px 0 #B83600" }}>
          <span className="block break-words" style={{ fontSize: `min(${namePx}px, ${(namePx / 4.2).toFixed(2)}vw)` }}>
            {name}
          </span>
          <span className="mt-1 block" style={{ fontSize: "min(41px, 9.9vw)" }}>
            was outside.
          </span>
        </h1>
      </div>

      <div className="relative mt-5 flex min-h-[112px] items-end">
        <div className="pb-1">
          <p className="font-mono text-[13px] font-medium uppercase tracking-[0.18em]">{month}</p>
          {rank > 0 && (
            <p
              className="mt-3 inline-block bg-brand-cream px-2.5 py-1.5 font-display text-[14px] font-black uppercase leading-none tracking-[0.02em] text-brand-ink"
              style={{ transform: "rotate(2deg)" }}
            >
              #{rank} in Lagos
            </p>
          )}
        </div>
        <div className="absolute -bottom-[130px] right-0 z-10" style={{ transform: "rotate(3deg)" }}>
          <div aria-hidden className="hz-scrap absolute inset-x-2 bottom-5 top-16" />
          <Mascot state="celebrate" edge="ink" size={190} className="relative" />
        </div>
      </div>

      <div className="stub stub-night relative mt-2" style={{ ["--notch-y" as string]: "212px" }}>
        <div className="px-4 pt-3" style={{ height: 212 }}>
          <p className="num text-orange" style={{ fontSize: `min(${heroPx}px, ${(heroPx / 4.17).toFixed(1)}vw)` }}>
            {outings}
          </p>
          <p className="seclabel mt-3">{outings === 1 ? "NIGHT OUT" : "NIGHTS OUT"}</p>
        </div>
        <div aria-hidden className="mx-5 border-t border-dashed border-line" />
        <div className="flex items-baseline gap-3 px-4 pb-4 pt-3">
          <p className="num text-[48px]">{streak}</p>
          <p className="seclabel">WEEK STREAK</p>
        </div>
      </div>

      <div className="mt-auto pt-7">
        <OpenHoppaz className="w-full" />
        <p className="mt-3 text-center font-mono text-[10.5px] font-medium tracking-[0.16em] text-dim">
          COME ALONE. LEAVE WITH FRIENDS.
        </p>
      </div>
    </>
  );
}
