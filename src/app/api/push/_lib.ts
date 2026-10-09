import { createHash, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

/**
 * Shared by the push routes (docs/PUSH.md). Server only.
 *
 *   /api/push/subscribe, /unsubscribe   a signed-in Hopper's browser, with their own token
 *   /api/push/send                      the database (pg_net) or staff, with the shared secret
 *   /api/push/test                      development only: an alert to yourself
 */

export type Alert = { user_id: string; title: string; body: string; url: string; tag: string };
export type Delivery = { sent: number; gone: number; failed: number; no_subscription: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/**
 * The push services a real browser hands out. The server posts to this address, so it is never an address a client made
 * up. The same list is enforced in the database (save_push_subscription in supabase/push.sql), because a signed-in
 * Hopper can call that function directly, and again in deliver() before every send.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];
export function pushEndpointOk(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export const supabaseEnv = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, anon, service };
};

export function serviceClient(): SupabaseClient | null {
  const { url, service } = supabaseEnv();
  return url && service ? createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

const bearer = (req: Request) => (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

/** The Hopper behind the request, from their own Supabase access token; plus a client that acts as them (RLS applies). */
export async function hopperFrom(req: Request): Promise<{ id: string; sb: SupabaseClient } | null> {
  const token = bearer(req);
  const { url, anon } = supabaseEnv();
  if (!token || !url || !anon) return null;
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await sb.auth.getUser(token);
  return error || !data.user ? null : { id: data.user.id, sb };
}

const digest = (s: string) => createHash("sha256").update(s).digest();
/** The send route accepts the shared secret (the database) or the staff token (the admin desk). Nothing else. */
export function sendAllowed(req: Request): boolean {
  const received = bearer(req);
  if (!received) return false;
  const known = [process.env.PUSH_SEND_SECRET, process.env.HOPPAZ_ADMIN_TOKEN].filter((s): s is string => !!s);
  return known.some((s) => timingSafeEqual(digest(s), digest(received)));
}

/** Keeps a payload small and safe: short text, and a url that stays inside the app. */
export function cleanAlert(raw: unknown, fallbackUser?: string): Alert | null {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const user_id = fallbackUser ?? a.user_id;
  if (!isUuid(user_id)) return null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const title = text(a.title, 80);
  if (!title) return null;
  const url = typeof a.url === "string" && /^\/(?!\/)[^\s\\]{0,300}$/.test(a.url) ? a.url : "/";
  return { user_id, title, body: text(a.body, 240), url, tag: text(a.tag, 80) };
}

let vapidSet = false;
export function vapidReady(): boolean {
  if (vapidSet) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  webpush.setVapidDetails(subject, pub, priv);
  vapidSet = true;
  return true;
}

/** Sends each alert to every browser its Hopper allowed. Browsers the push service says are gone are forgotten. */
export async function deliver(sb: SupabaseClient, alerts: Alert[]): Promise<Delivery> {
  const out: Delivery = { sent: 0, gone: 0, failed: 0, no_subscription: 0 };
  const ids = [...new Set(alerts.map((a) => a.user_id))];
  const subs: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth").in("user_id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    subs.push(...(data ?? []));
  }
  const byUser = new Map<string, typeof subs>();
  for (const s of subs) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  const jobs: { sub: (typeof subs)[number]; payload: string }[] = [];
  for (const a of alerts) {
    const mine = byUser.get(a.user_id);
    if (!mine?.length) {
      out.no_subscription++;
      continue;
    }
    const payload = JSON.stringify({ title: a.title, body: a.body, url: a.url, tag: a.tag });
    for (const sub of mine) jobs.push({ sub, payload });
  }

  const dead: string[] = [];
  // A row whose address is not a real push service (saved before the database checked) is never posted to, and is dropped.
  const sendable = jobs.filter(({ sub }) => {
    if (pushEndpointOk(sub.endpoint)) return true;
    out.failed++;
    dead.push(sub.id);
    return false;
  });
  // The send route has 30 s: stop starting new batches near the end rather than be cut off mid-way.
  const deadline = Date.now() + 20_000;
  for (let i = 0; i < sendable.length; i += 25) {
    if (Date.now() > deadline) {
      out.failed += sendable.length - i;
      console.warn("[hoppaz] push: out of time, skipped", sendable.length - i);
      break;
    }
    await Promise.all(
      sendable.slice(i, i + 25).map(async ({ sub, payload }) => {
        try {
          // A spot lasts 90 minutes: a push that waits longer than an hour for a sleeping phone is no use.
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600, urgency: "high", timeout: 8000 });
          out.sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            out.gone++;
            dead.push(sub.id);
          } else {
            out.failed++;
            console.warn("[hoppaz] push: send failed", status ?? (e as Error).message);
          }
        }
      }),
    );
  }
  if (dead.length) await sb.from("push_subscriptions").delete().in("id", dead);
  return out;
}

export const noStore = { "Cache-Control": "no-store" };
