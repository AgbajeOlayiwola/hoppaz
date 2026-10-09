import { NextResponse } from "next/server";
import { hopperFrom, noStore } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Forgets this browser's push subscription (or all of the Hopper's browsers
 * when no endpoint is sent). Body: { endpoint? }.
 * Authorization: Bearer <the Hopper's Supabase access token>; row level
 * security lets them delete only their own rows.
 */
export async function POST(req: Request) {
  const me = await hopperFrom(req);
  if (!me) return NextResponse.json({ error: "Sign in first" }, { status: 401, headers: noStore });
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.slice(0, 1000) : null;
  const q = me.sb.from("push_subscriptions").delete();
  const { error } = await (endpoint ? q.eq("endpoint", endpoint) : q.eq("user_id", me.id));
  if (error) return NextResponse.json({ error: "Could not remove alerts" }, { status: 500, headers: noStore });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
