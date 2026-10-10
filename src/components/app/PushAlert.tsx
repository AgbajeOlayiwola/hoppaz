"use client";

import { useEffect } from "react";
import { PUSH_MESSAGE } from "@/lib/push";
import { sfx } from "@/lib/sound/sfx";

/**
 * A spawn alert arrives while the app is open: the service worker shows the notification and also posts
 * "hoppaz:push" to every open window (public/sw.js). This is the app's half of that: the short, short,
 * long ping of sfx.alert() (GAMIFY-NEXT 5.2), in the UI lane, with no buzz. It draws nothing and makes no
 * sound itself before a real tap, a hidden page or a muted switch: sfx.ts decides that.
 */
export default function PushAlert() {
  useEffect(() => {
    const sw = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === PUSH_MESSAGE) sfx.alert();
    };
    sw.addEventListener("message", onMessage);
    return () => sw.removeEventListener("message", onMessage);
  }, []);
  return null;
}
