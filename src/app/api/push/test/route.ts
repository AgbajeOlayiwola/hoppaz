import { NextResponse } from "next/server";
import { deliver, hopperFrom, noStore, serviceClient, vapidReady } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Development only (404 in production): sends a test alert to the signed-in
 * Hopper's own browsers, skipping the setting, cap and quiet hours, so the
 * whole path (service worker, subscription, VAPID, delivery) can be tried
 * before spots exist. The Settings row shows a button for it in development.
 * Authorization: Bearer <the Hopper's Supabase access token>.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const me = await hopperFrom(req);
  if (!me) return NextResponse.json({ error: "Sign in first" }, { status: 401, headers: noStore });
  const sb = serviceClient();
  if (!sb || !vapidReady()) return NextResponse.json({ error: "Push is not configured" }, { status: 503, headers: noStore });
  try {
    const result = await deliver(sb, [
      {
        user_id: me.id,
        title: "Test spot just lit up",
        body: "About 1.4 km from you. Send your avatar to open a box.",
        url: "/?spot=test",
        tag: "spot-test",
      },
    ]);
    return NextResponse.json({ ok: true, ...result }, { headers: noStore });
  } catch (e) {
    console.warn("[hoppaz] push: test failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not send" }, { status: 500, headers: noStore });
  }
}
