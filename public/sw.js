/*
 * Hoppaz service worker. It does one job: spawn alerts (web push).
 * No caching and no fetch handler, so it can never serve a stale page.
 *
 *   push              shows the notification (title, body, Hoppaz icon) and tells
 *                     any open Hoppaz window about it (message type "hoppaz:push").
 *   notificationclick focuses an open Hoppaz window or opens one at the url in the
 *                     payload, and tells it where to go (message type
 *                     "hoppaz:notification-click", for the spot sheet later).
 *   pushsubscriptionchange
 *                     the browser rotated the subscription: ask open windows to
 *                     save the new one (they hold the sign-in; this worker does not).
 *
 * Payload (JSON, sent by /api/push/send): { title, body, url, tag }.
 * Docs: docs/PUSH.md
 */
const ICON = "/icon-192.png";
const BADGE = "/brand/mark-cream.png"; // Android draws only the alpha channel of a badge

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Only paths inside the app. A payload can never send anyone to another site. */
function appUrl(raw) {
  try {
    const u = new URL(typeof raw === "string" && raw ? raw : "/", self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/";
  } catch {
    return "/";
  }
}

function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

async function tellWindows(message) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of list) c.postMessage(message);
}

self.addEventListener("push", (event) => {
  const p = readPayload(event);
  const title = String(p.title || "Hoppaz").slice(0, 80);
  const url = appUrl(p.url);
  const tag = typeof p.tag === "string" && p.tag ? p.tag.slice(0, 80) : undefined;
  event.waitUntil(
    Promise.all([
      // Chrome wants a visible notification for every push, so always show one.
      self.registration.showNotification(title, {
        body: String(p.body || "").slice(0, 240),
        icon: ICON,
        badge: BADGE,
        tag,
        renotify: !!tag,
        data: { url },
      }),
      tellWindows({ type: "hoppaz:push", title, body: String(p.body || ""), url, tag: tag || null }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = appUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = list.find((c) => new URL(c.url).origin === self.location.origin) || null;
      if (!open) {
        await self.clients.openWindow(url);
        return;
      }
      const here = new URL(open.url);
      let target = open;
      try {
        target = (await open.focus()) || open;
      } catch {
        /* focus can be refused; the message below still goes out */
      }
      // The window handles the url itself when it can (the spot sheet will);
      // otherwise take it there.
      target.postMessage({ type: "hoppaz:notification-click", url });
      if (here.pathname + here.search !== url && "navigate" in target) {
        try {
          await target.navigate(url);
        } catch {
          /* a window that cannot be navigated already got the message */
        }
      }
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(tellWindows({ type: "hoppaz:push-resubscribe" }));
});
