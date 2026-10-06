import type { Hop } from "./types";

/**
 * Where the Hop bus is, worked out from the published schedule.
 *
 * There is no GPS on the bus yet, so this is an estimate: before the first
 * stop it sits at boarding, between stops it is placed along the straight line
 * by how much of the leg's time has gone, after the finale it parks there. On
 * any other day it waits at stop 1 with the date. When a tracker exists, swap
 * this for its last reported point and keep the same return shape.
 */
export type BusFix = {
  lat: number;
  lng: number;
  /** Short line under the bus marker. */
  label: string;
  moving: boolean;
};

/** "7:00pm" / "11:30pm" / "19:00" -> minutes after midnight. */
function minutes(t: string): number | null {
  const m = t.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3] === "pm") h += 12;
  if (!m[3] && Number(m[1]) >= 12) h = Number(m[1]);
  return h * 60 + Number(m[2] ?? 0);
}

/** Now, in Lagos (UTC+1 all year): the date string and minutes after midnight. */
function lagosNow(now: Date) {
  const l = new Date(now.getTime() + 60 * 60 * 1000);
  return { date: l.toISOString().slice(0, 10), mins: l.getUTCHours() * 60 + l.getUTCMinutes() };
}

export function busPosition(hop: Hop | null, now = new Date()): BusFix | null {
  const stops = hop?.stops.slice().sort((a, b) => a.idx - b.idx) ?? [];
  if (!hop || stops.length === 0) return null;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const { date, mins } = lagosNow(now);

  if (date < hop.hop_date) {
    const day = new Date(`${hop.hop_date}T12:00:00Z`).toLocaleDateString("en-NG", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    return { lat: first.lat, lng: first.lng, label: day.toUpperCase(), moving: false };
  }
  if (date > hop.hop_date) {
    return { lat: last.lat, lng: last.lng, label: "NEXT HOP SOON", moving: false };
  }

  const times = stops.map((s) => minutes(s.stop_time));
  if (times.some((t) => t === null)) {
    return { lat: first.lat, lng: first.lng, label: "TONIGHT", moving: false };
  }
  const t = times as number[];

  if (mins < t[0]) return { lat: first.lat, lng: first.lng, label: `BOARDING · ${first.stop_time.toUpperCase()}`, moving: false };
  if (mins >= t[t.length - 1]) return { lat: last.lat, lng: last.lng, label: "AT THE FINALE", moving: false };

  for (let i = 0; i < stops.length - 1; i++) {
    if (mins >= t[i] && mins < t[i + 1]) {
      // Dwell at each stop for the first half of the gap, then drive.
      const leg = t[i + 1] - t[i];
      const k = (mins - t[i]) / leg;
      if (k < 0.5) return { lat: stops[i].lat, lng: stops[i].lng, label: `AT STOP ${stops[i].idx}`, moving: false };
      const f = (k - 0.5) / 0.5;
      const a = stops[i];
      const b = stops[i + 1];
      return {
        lat: a.lat + (b.lat - a.lat) * f,
        lng: a.lng + (b.lng - a.lng) * f,
        label: `→ STOP ${b.idx}`,
        moving: true,
      };
    }
  }
  return { lat: first.lat, lng: first.lng, label: "TONIGHT", moving: false };
}
