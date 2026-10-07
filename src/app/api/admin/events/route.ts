import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Moderation queue for flyers Hoppers drop. Nothing reaches the map until it
 * passes through here. Guarded by a shared secret, not a login, because the
 * only caller for now is Jae on his phone or a curl from a laptop.
 *
 *   GET  /api/admin/events                       -> everything pending
 *   POST /api/admin/events { id, action, lat?, lng? }
 *        action: "approve" | "reject"
 *        lat/lng: optional exact venue point, replacing the area centroid
 *
 * Both require: Authorization: Bearer $HOPPAZ_ADMIN_TOKEN
 */
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function authed(req: Request) {
  const secret = process.env.HOPPAZ_ADMIN_TOKEN;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "nope" }, { status: 401 });
  const sb = admin();
  if (!sb) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const { data, error } = await sb
    .from("events")
    .select("id, title, venue_name, area, starts_at, price_naira, vibe, ig_url, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pending: data });
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "nope" }, { status: 401 });
  const sb = admin();
  if (!sb) return NextResponse.json({ error: "not configured" }, { status: 500 });

  let body: { id?: string; action?: string; lat?: number; lng?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const { id, action, lat, lng } = body;
  if (!id || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "need id and action" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    status: action === "approve" ? "live" : "rejected",
  };
  if (action === "approve" && typeof lat === "number" && typeof lng === "number") {
    patch.geog = `SRID=4326;POINT(${lng} ${lat})`;
  }

  const { data, error } = await sb.from("events").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The Hopper who dropped a flyer that went live earns the badge.
  if (action === "approve" && data?.created_by) {
    await sb.from("badges").upsert(
      { user_id: data.created_by, key: "dropper" },
      { onConflict: "user_id,key", ignoreDuplicates: true }
    );
  }

  return NextResponse.json({ ok: true, event: data });
}
