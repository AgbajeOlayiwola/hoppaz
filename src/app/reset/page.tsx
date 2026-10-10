"use client";

import { useEffect, useState } from "react";

/**
 * Test hosts only: /reset wipes this browser's Hoppaz data (the sign-in, the
 * tour, saved switches, cached files) and opens the app again as a brand new
 * Hopper, so the first-run tour with Paz plays from the top. It touches
 * nothing on the server. On any other host it does nothing.
 */
const TEST_HOST =
  /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.trycloudflare\.com|[a-z0-9-]+\.vercel\.app)$/i;

async function wipe() {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* storage blocked */
  }
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(dbs.map((d) => (d.name ? new Promise((r) => {
      const q = indexedDB.deleteDatabase(d.name as string);
      q.onsuccess = q.onerror = q.onblocked = () => r(null);
    }) : null)));
  } catch {
    /* no IndexedDB here */
  }
  try {
    if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {
    /* no Cache Storage here */
  }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* no service worker here */
  }
}

export default function ResetPage() {
  const [state, setState] = useState<"wiping" | "blocked">("wiping");

  useEffect(() => {
    if (!TEST_HOST.test(location.hostname)) {
      queueMicrotask(() => setState("blocked"));
      return;
    }
    void wipe().then(() => {
      // Anything the shell saved while this page was up goes too, then the app opens fresh.
      try {
        localStorage.clear();
      } catch {
        /* storage blocked */
      }
      location.replace("/");
    });
  }, []);

  return (
    <div className="fixed inset-0 grid place-items-center bg-ink px-6 text-center">
      <span className="font-mono text-[11px] tracking-[0.2em] text-dim">
        {state === "wiping" ? "FRESH START. ONE SECOND…" : "NOTHING TO RESET HERE."}
      </span>
    </div>
  );
}
