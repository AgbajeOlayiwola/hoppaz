export type EventRow = {
  id: string;
  title: string;
  venue_name: string;
  area: string | null;
  lat: number;
  lng: number;
  starts_at: string;
  price_naira: number;
  vibe: string;
  source: "hoppaz" | "hopper" | "instagram" | "partner";
  ig_url: string | null;
  flyer_url: string | null;
  distance_m: number;
  heat: number;
  checkins?: number;
  swipes_in?: number;
  /** Check-ins in the last three hours: the live crowd. */
  here_now?: number;
};

export type EventPhoto = {
  id: string;
  event_id: string;
  user_id: string;
  path: string;
  created_at: string;
  url: string;
};

export type Profile = {
  id: string;
  display_name: string | null;
  area: string | null;
  xp: number;
  is_admin: boolean;
  /** Raw jsonb from the database. Always pass through normalizeLook() before use. */
  avatar?: unknown;
};

export type HopStop = {
  id: string;
  idx: number;
  name: string;
  area: string | null;
  lat: number;
  lng: number;
  stop_time: string;
  role: string;
};

export type Hop = {
  id: string;
  name: string;
  hop_date: string;
  price_naira: number;
  boarding: string;
  ticket_url: string | null;
  status: string;
  stops: HopStop[];
};

export type Message = {
  id: string;
  channel: string;
  user_id: string;
  body: string;
  created_at: string;
  author?: string | null;
};

export type CheckinClaim =
  | { ok: true; xp: number; distance_m: number; badges: string[] }
  | { ok: false; reason: "no_session" | "no_event" | "too_far" | "already"; distance_m?: number };
