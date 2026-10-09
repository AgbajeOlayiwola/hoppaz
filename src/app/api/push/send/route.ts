import { NextResponse } from "next/server";
import { cleanAlert, deliver, isUuid, noStore, sendAllowed, serviceClient, vapidReady, type Alert } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Delivers push alerts. Called by the database (pg_net, from
 * notify_spot_alert in supabase/push.sql) and by staff. Not for Hoppers:
 * the caller must send Authorization: Bearer <PUSH_SEND_SECRET> (or the staff
 * token, HOPPAZ_ADMIN_TOKEN).
 *
 * Body, either shape:
 *   { alerts: [{ user_id, title, body, url, tag }, ...] }       one message each (at most 500)
 *   { user_ids: [uuid, ...], title, body, url, tag }            the same message to all (at most 500)
 * The database has already decided who gets an alert (setting, daily cap,
 * quiet hours, range, dedupe); this route only delivers.
 */
export async function POST(req: Request) {
  if (!sendAllowed(req)) return NextResponse.json({ error: "Not allowed" }, { status: 401, headers: noStore });
  const sb = serviceClient();
  if (!sb || !vapidReady()) return NextResponse.json({ error: "Push is not configured" }, { status: 503, headers: noStore });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const alerts: Alert[] = [];
  if (Array.isArray(body?.alerts)) {
    for (const raw of body.alerts.slice(0, 500)) {
      const a = cleanAlert(raw);
      if (a) alerts.push(a);
    }
  } else if (Array.isArray(body?.user_ids)) {
    for (const id of body.user_ids.slice(0, 500)) {
      const a = isUuid(id) ? cleanAlert(body, id) : null;
      if (a) alerts.push(a);
    }
  } else {
    return NextResponse.json({ error: "Send alerts or user_ids" }, { status: 400, headers: noStore });
  }
  if (!alerts.length) return NextResponse.json({ error: "No valid alerts" }, { status: 400, headers: noStore });

  try {
    const result = await deliver(sb, alerts);
    return NextResponse.json({ ok: true, ...result }, { headers: noStore });
  } catch (e) {
    console.warn("[hoppaz] push: send route failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not send" }, { status: 500, headers: noStore });
  }
}
