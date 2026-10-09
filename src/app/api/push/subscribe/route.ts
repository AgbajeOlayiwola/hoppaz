import { NextResponse } from "next/server";
import { hopperFrom, noStore, pushEndpointOk } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Saves this browser's push subscription for the signed-in Hopper.
 * Body: { subscription: PushSubscription.toJSON(), userAgent? }.
 * Authorization: Bearer <the Hopper's Supabase access token>. The database does
 * the write (save_push_subscription), acting as them.
 */
export async function POST(req: Request) {
  const me = await hopperFrom(req);
  if (!me) return NextResponse.json({ error: "Sign in first" }, { status: 401, headers: noStore });
  const body = (await req.json().catch(() => null)) as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; userAgent?: unknown } | null;
  const sub = body?.subscription;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!pushEndpointOk(sub?.endpoint) || typeof p256dh !== "string" || typeof auth !== "string") {
    return NextResponse.json({ error: "That is not a push subscription we can use" }, { status: 400, headers: noStore });
  }
  const { data, error } = await me.sb.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: typeof body?.userAgent === "string" ? body.userAgent.slice(0, 300) : (req.headers.get("user-agent") ?? "").slice(0, 300),
  });
  if (error) return NextResponse.json({ error: "Could not save alerts" }, { status: 500, headers: noStore });
  if (data !== true) return NextResponse.json({ error: "Subscription refused" }, { status: 400, headers: noStore });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
