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

/**
 * A room message. There is no user id on purpose: author_key is an opaque
 * per-room identity the server maps back to a person. Named and anonymous
 * posts by the same person carry different keys.
 */
export type Message = {
  id: string;
  channel: string;
  body: string;
  created_at: string;
  author_key: string | null;
  author_name: string | null;
  author_look: unknown;
  anon: boolean;
};

export type DmThread = {
  id: string;
  i_am_a: boolean;
  other_name: string;
  other_look: unknown;
  revealed: boolean;
  me_revealed: boolean;
  them_revealed: boolean;
  my_alias: string;
  event_title: string | null;
  last_body: string | null;
  last_at: string;
};

export type DmMessage = { id: string; dm_id: string; from_a: boolean; body: string; created_at: string };

export type Wave = { id: string; from_alias: string; event_title: string | null; created_at: string };

export type CheckinClaim =
  | { ok: true; xp: number; distance_m: number; badges: string[] }
  | { ok: false; reason: "no_session" | "no_event" | "too_far" | "already"; distance_m?: number };
