"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useToast } from "@/lib/store";
import type { HotspotMute, HotspotReport, HotspotRoomRow, HotspotsAdmin } from "@/app/api/admin/game/hotspots";

/**
 * The staff controls for Hotspots (supabase/hotspots.sql, docs/HOTSPOTS.md): which rooms are open, paused or
 * opening soon (and opening a whole wave), slow mode, the reports from the rooms and a mute for the alias in
 * one, the mutes in force, and the word list. The admin page owns the data and the POST helper; this file
 * only draws it. Staff see aliases and alias keys, never a user or a position.
 */

export { emptyHotspots } from "@/app/api/admin/game/hotspots";
type Act = (body: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

const SUMMARY = "cursor-pointer py-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-orange";
const HOURS: ReadonlyArray<[number, string]> = [
  [1, "1 hour"],
  [6, "6 hours"],
  [12, "12 hours"],
  [24, "1 day"],
  [72, "3 days"],
  [168, "7 days"],
];
const STATUS: Record<HotspotRoomRow["status"], { tag: string; label: string }> = {
  open: { tag: "pill-keke", label: "OPEN" },
  planned: { tag: "", label: "OPENING SOON" },
  paused: { tag: "pill-danfo", label: "PAUSED" },
};

const lagosTime = (iso: string) =>
  new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card mb-4 p-3">
      <h2 className="seclabel mb-3 text-orange">{title}</h2>
      {children}
    </section>
  );
}

function Line({ title, sub, tag, children }: { title: string; sub: ReactNode; tag?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-0">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-display text-sm font-bold">
          {title}
          {tag}
        </p>
        <p className="hint break-words">{sub}</p>
      </div>
      {children}
    </div>
  );
}

/** A button that asks twice: the first tap changes its label, the second does it. It backs off after 4 seconds. */
function Sure({ label, sure = "SURE?", onYes, disabled, ghost = true }: { label: string; sure?: string; onYes: () => void; disabled: boolean; ghost?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn px-3 py-2 ${ghost && !armed ? "btn-ghost" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onYes();
      }}
    >
      {armed ? sure : label}
    </button>
  );
}

export default function HotspotsSection({ hotspots, act, busy, loading = false }: { hotspots: HotspotsAdmin; act: Act; busy: boolean; loading?: boolean }) {
  const say = useToast((s) => s.say);
  const { rooms, reports, mutes, words } = hotspots;

  if (loading) {
    return (
      <Card title="Hotspots">
        <p className="hint">Loading the hotspots…</p>
      </Card>
    );
  }
  if (hotspots.error) {
    return (
      <Card title="Hotspots">
        <p className="hint">Hotspots are not set up on this database ({hotspots.error}). Run supabase/hotspot_zones.sql and supabase/hotspots.sql, then refresh.</p>
      </Card>
    );
  }

  const setStatus = async (r: HotspotRoomRow, status: HotspotRoomRow["status"]) => {
    if (await act({ action: "hotspot_status", slug: r.slug, status })) say(`${r.place.toUpperCase()} ${status === "open" ? "OPEN" : status === "paused" ? "PAUSED" : "OPENING SOON"}`, "violet");
  };
  const openWave = async (wave: number) => {
    const res = await act({ action: "hotspot_open_wave", wave });
    if (res) say(`WAVE ${wave} OPEN. ${Number(res.opened) || 0} ${Number(res.opened) === 1 ? "ROOM" : "ROOMS"}`, "violet");
  };

  const places = Object.fromEntries(rooms.map((r) => [r.slug, r.place]));
  const waves = [...new Set(rooms.filter((r) => r.status === "planned").map((r) => r.wave))].sort((a, b) => a - b);
  const count = (s: HotspotRoomRow["status"]) => rooms.filter((r) => r.status === s).length;
  const inRooms = rooms.reduce((n, r) => n + r.here, 0);

  return (
    <>
      <Card title="Hotspots">
        <p className="hint">
          <b className="text-cream">{count("open")}</b> open · <b className="text-cream">{count("planned")}</b> opening soon · <b className="text-cream">{count("paused")}</b> paused ·{" "}
          <b className="text-cream">{inRooms}</b> {inRooms === 1 ? "avatar" : "avatars"} in rooms now
        </p>
        {waves.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {waves.map((w) => {
              const n = rooms.filter((r) => r.wave === w && r.status === "planned").length;
              return <Sure key={w} ghost={false} label={`OPEN WAVE ${w} (${n})`} sure={`OPEN ${n} ${n === 1 ? "ROOM" : "ROOMS"}?`} disabled={busy} onYes={() => void openWave(w)} />;
            })}
          </div>
        )}
        <div className="mt-2">
          {rooms.map((r) => (
            <div key={r.slug} className="border-t border-line py-2 first:border-0">
              <Line
                title={r.place}
                tag={<span className={`pill ${STATUS[r.status].tag}`}>{STATUS[r.status].label}</span>}
                sub={`${r.zone} · wave ${r.wave} · ${r.here} in the room · slow mode ${r.slow_seconds ? `${r.slow_seconds} s, ${r.slow_from} to ${r.slow_to}` : "off"}`}
              >
                {r.status === "open" ? (
                  <Sure label="PAUSE" sure="CLEAR THE ROOM?" disabled={busy} onYes={() => void setStatus(r, "paused")} />
                ) : (
                  <button className="btn px-3 py-2" disabled={busy} onClick={() => void setStatus(r, "open")}>
                    OPEN
                  </button>
                )}
              </Line>
              <details>
                <summary className={SUMMARY}>Slow mode and clean up</summary>
                <RoomTools room={r} act={act} busy={busy} />
              </details>
            </div>
          ))}
          {!rooms.length && <p className="hint">No hotspots on this database.</p>}
        </div>
      </Card>

      <Card title="Hotspot reports">
        <p className="hint">Reports from people in the rooms. Muting stops an alias posting; it does not delete anything. Three different people reporting a message by the same alias within a day mute it for an hour by themselves. A report on a head with no recent message only comes here.</p>
        <div className="mt-2">
          {reports.map((r) => (
            <ReportLine key={r.id} report={r} place={r.hotspot_slug ? places[r.hotspot_slug] ?? r.hotspot_slug : null} act={act} busy={busy} />
          ))}
          {!reports.length && <p className="hint">No open hotspot reports.</p>}
        </div>
      </Card>

      <Card title="Hotspot mutes">
        <div>
          {mutes.map((m) => (
            <MuteLine key={m.id} mute={m} place={m.hotspot_slug ? places[m.hotspot_slug] ?? m.hotspot_slug : null} act={act} busy={busy} />
          ))}
          {!mutes.length && <p className="hint">Nobody is muted.</p>}
        </div>
      </Card>

      <Card title="Hotspot word list">
        <p className="hint">Messages with these whole words are refused. Links, emails, @names and phone numbers are always refused. Add what else the rooms need, such as swearing.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {words.map((w) => (
            <button key={w} type="button" className="chip" disabled={busy} aria-label={`Remove ${w}`} onClick={() => void act({ action: "hotspot_word_remove", word: w })}>
              {w} ×
            </button>
          ))}
          {!words.length && <p className="hint">No words yet.</p>}
        </div>
        <WordForm act={act} busy={busy} />
      </Card>
    </>
  );
}

function RoomTools({ room, act, busy }: { room: HotspotRoomRow; act: Act; busy: boolean }) {
  const say = useToast((s) => s.say);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (await act({ action: "hotspot_slow", slug: room.slug, seconds: f.get("seconds"), from: f.get("from"), to: f.get("to") })) say("SLOW MODE SAVED", "violet");
  };
  const clear = async (minutes: number) => {
    const res = await act({ action: "hotspot_clear", slug: room.slug, minutes });
    if (res) say(`${Number(res.deleted) || 0} MESSAGES DELETED`, "violet");
  };
  return (
    <div className="mt-2 grid gap-3">
      <form className="grid gap-2" onSubmit={save}>
        <p className="hint">Slow mode: one message per person every so many seconds, between two Lagos times (the window may cross midnight). 0 is off.</p>
        <div className="grid grid-cols-3 gap-2">
          <label className="label">
            Seconds
            <input name="seconds" type="number" min="0" max="120" defaultValue={room.slow_seconds} required />
          </label>
          <label className="label">
            From
            <input name="from" type="time" defaultValue={room.slow_from || "00:00"} required />
          </label>
          <label className="label">
            To
            <input name="to" type="time" defaultValue={room.slow_to || "05:00"} required />
          </label>
        </div>
        <button className="btn px-3 py-2" disabled={busy}>
          SAVE SLOW MODE
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <span className="hint">Delete the last</span>
        {[15, 60, 360].map((m) => (
          <Sure key={m} label={m < 60 ? `${m} MIN` : `${m / 60} H`} sure="DELETE?" disabled={busy} onYes={() => void clear(m)} />
        ))}
        <span className="hint">of messages</span>
      </div>
    </div>
  );
}

function ReportLine({ report: r, place, act, busy }: { report: HotspotReport; place: string | null; act: Act; busy: boolean }) {
  const say = useToast((s) => s.say);
  const mute = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const here = f.get("scope") === "here" ? r.hotspot_slug : null;
    if (await act({ action: "hotspot_mute", key: r.key, slug: here, hours: f.get("hours"), reason: `Report: ${r.reason}` })) say("ALIAS MUTED", "violet");
  };
  return (
    <div className="border-t border-line py-2 first:border-0">
      <Line
        title={`${r.alias ?? "An alias that has gone"}${place ? ` · ${place}` : ""}`}
        tag={r.reporters_24h > 1 ? <span className="pill pill-danfo">{r.reporters_24h} PEOPLE IN 24 H</span> : undefined}
        sub={
          <>
            {r.excerpt ?? "No excerpt"}
            <br />
            {r.reason} · {lagosTime(r.created_at)}
          </>
        }
      >
        <button className="btn btn-ghost px-3 py-2" disabled={busy} onClick={() => void act({ action: "resolve_report", id: r.id })}>
          CLOSE
        </button>
      </Line>
      {r.key && (
        <form className="mt-1 flex flex-wrap items-center gap-2" onSubmit={mute}>
          <select name="hours" defaultValue="12" aria-label="Mute for" className="w-auto">
            {HOURS.map(([h, label]) => (
              <option key={h} value={h}>
                {label}
              </option>
            ))}
          </select>
          <select name="scope" defaultValue={r.hotspot_slug ? "here" : "all"} aria-label="Where" className="w-auto">
            {r.hotspot_slug && <option value="here">This hotspot</option>}
            <option value="all">All hotspots</option>
          </select>
          <button className="btn px-3 py-2" disabled={busy}>
            MUTE ALIAS
          </button>
        </form>
      )}
    </div>
  );
}

function MuteLine({ mute: m, place, act, busy }: { mute: HotspotMute; place: string | null; act: Act; busy: boolean }) {
  const say = useToast((s) => s.say);
  return (
    <Line
      title={m.alias ?? "An alias that has gone"}
      tag={<span className={`pill ${m.auto ? "" : "pill-violet"}`}>{m.auto ? "AUTO" : "STAFF"}</span>}
      sub={`${place ?? "All hotspots"} · until ${lagosTime(m.until)}${m.reason ? ` · ${m.reason}` : ""}`}
    >
      <button
        className="btn btn-ghost px-3 py-2"
        disabled={busy}
        onClick={async () => {
          if (await act({ action: "hotspot_unmute", id: m.id })) say("MUTE LIFTED", "violet");
        }}
      >
        LIFT
      </button>
    </Line>
  );
}

function WordForm({ act, busy }: { act: Act; busy: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="mt-3 flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const word = String(new FormData(e.currentTarget).get("word") ?? "");
        if (await act({ action: "hotspot_word_add", word })) form.current?.reset();
      }}
    >
      <input name="word" required minLength={2} maxLength={40} placeholder="Add a word or phrase" aria-label="Add a word or phrase" autoComplete="off" />
      <button className="btn flex-none px-3 py-2" disabled={busy}>
        ADD
      </button>
    </form>
  );
}
