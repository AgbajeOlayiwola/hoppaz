"use client";

import { useEffect } from "react";
import { sfx } from "@/lib/sound/sfx";

/**
 * Keeps the app-wide sound lane on (src/lib/sound/sfx.ts, GAMIFY-NEXT 5.4). While it is mounted,
 * reward and UI sounds work on every tab, not only in Play. It makes no sound and no network
 * request itself: importing sfx.ts is what listens for the first real tap on any screen, and the
 * audio context and the sound files wait for that tap. The Sound row in Me, Settings (and the
 * speaker in Play) is the one switch for all of it.
 */
export default function SoundLane() {
  useEffect(() => {
    sfx.setApp(true);
    return () => sfx.setApp(false);
  }, []);
  return null;
}
