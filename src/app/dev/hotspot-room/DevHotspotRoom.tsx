"use client";

import { useEffect, useState } from "react";
import HotspotRoom from "@/components/play/hotspots/HotspotRoom";
import { useSession } from "@/lib/useSession";

/**
 * A stand-in for Play: a plain ground with the Hopper's XP (to watch the daily reward land) and a button that
 * opens the room the way the avatar's arrival does. `?slug=yaba` picks the hotspot, `?auto=1` opens it on load.
 */
export default function DevHotspotRoom() {
  const { profile, email, state } = useSession();
  const [slug, setSlug] = useState("yaba");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setSlug(q.get("slug") ?? "yaba");
    if (q.get("auto")) setOpen(true);
  }, []);

  return (
    <div className="h-full px-4">
      <div className="pad-top">
        <p className="seclabel">DEV · HOTSPOT ROOM</p>
        <p className="mt-2 font-mono text-[12px] text-dim">
          session {state} · {email ? "account" : "guest"} · <b data-xp>{profile?.xp ?? 0}</b> XP
        </p>
        <button className="btn mt-4" onClick={() => setOpen(true)} disabled={open}>
          ENTER {slug.toUpperCase()}
        </button>
        <p className="hint mt-3">{open ? "Room open." : "Room closed."}</p>
      </div>
      {open && <HotspotRoom slug={slug} onLeave={() => setOpen(false)} />}
    </div>
  );
}
