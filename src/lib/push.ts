import { getSupabase } from "./supabase/client";

/**
 * Spawn alerts by web push, the browser half (guide: docs/PUSH.md).
 *
 * The Hopper picks how many alerts they want (Off, A few, All); that choice
 * lives in the database (alert_prefs) and is read and written here. Push itself
 * needs the service worker (public/sw.js), the browser's permission and a
 * subscription saved on our server (/api/push/subscribe).
 *
 * iPhone: web push only works once Hoppaz is on the home screen (iOS 16.4+).
 * enablePush() says "needs-install" there, and askToInstall() opens Ola's
 * InstallSheet, the one install flow the app has.
 *
 * Everything here is for the browser; call it from effects and click handlers.
 * enablePush() must be called straight from a tap: browsers (iPhone above all)
 * refuse the permission question otherwise.
 */

export type AlertLevel = "off" | "few" | "all";
export const ALERT_LEVELS: ReadonlyArray<[AlertLevel, string]> = [
  ["off", "Off"],
  ["few", "A few"],
  ["all", "All"],
];

/** Why alerts cannot be turned on here, or "ok" when they can. */
export type PushSupport = "ok" | "needs-install" | "unsupported" | "no-key";

export type PushState = {
  support: PushSupport;
  /** The browser's permission: "default" means not asked yet. "unsupported" where there is no Notification API. */
  permission: NotificationPermission | "unsupported";
  /** This browser has a live subscription (it may not be saved on our server yet; syncPush does that). */
  subscribed: boolean;
};

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: "needs-install" | "unsupported" | "no-key" | "denied" | "dismissed" | "no-session" | "server" };

/**
 * Messages the service worker posts to open windows (see public/sw.js). The spot
 * sheet (a later step) listens for NOTIFICATION_CLICK_MESSAGE on
 * navigator.serviceWorker ({ type, url }) to open the spot a Hopper tapped.
 */
export const PUSH_MESSAGE = "hoppaz:push";
export const NOTIFICATION_CLICK_MESSAGE = "hoppaz:notification-click";
export const RESUBSCRIBE_MESSAGE = "hoppaz:push-resubscribe";

/** The public half of the VAPID key pair (inlined into the browser bundle). */
export const vapidKey = () => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** iPhone or iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** True where push exists in this browser (the browser, not whether the phone has been set up for it). */
function hasPushApis(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Can alerts be turned on here, and if not, why. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  // On iPhone the push APIs do not exist at all until the app is on the home screen.
  if (isIos() && !isStandalone()) return "needs-install";
  if (!hasPushApis()) return "unsupported";
  if (!vapidKey()) return "no-key";
  return "ok";
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!hasPushApis()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  const support = pushSupport();
  const permission = hasPushApis() ? Notification.permission : "unsupported";
  return { support, permission, subscribed: support === "ok" && permission === "granted" && !!(await currentSubscription()) };
}

/** Registers public/sw.js (the only service worker the app has). Safe to call again. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((v, i) => v === b[i]);

async function token(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

async function post(path: string, body: unknown): Promise<boolean> {
  const t = await token();
  if (!t) return false;
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

const saveOnServer = (sub: PushSubscription) => post("/api/push/subscribe", { subscription: sub.toJSON(), userAgent: navigator.userAgent });

/**
 * Turns alerts on for this browser: permission, service worker, subscription,
 * saved on our server. Call it from a tap.
 */
export async function enablePush(): Promise<EnableResult> {
  const support = pushSupport();
  if (support !== "ok") return { ok: false, reason: support };
  if (Notification.permission === "denied") return { ok: false, reason: "denied" };
  if (!(await token())) return { ok: false, reason: "no-session" };

  if (Notification.permission !== "granted") {
    const asked = await Notification.requestPermission();
    if (asked === "denied") return { ok: false, reason: "denied" };
    if (asked !== "granted") return { ok: false, reason: "dismissed" };
  }
  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: "unsupported" };

  const key = keyBytes(vapidKey());
  try {
    let sub = await reg.pushManager.getSubscription();
    // A subscription made under another key (old keys, another environment) can never be sent to.
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return (await saveOnServer(sub)) ? { ok: true } : { ok: false, reason: "server" };
  } catch {
    // The browser could not reach its push service (offline, or blocked by a browser setting).
    return { ok: false, reason: "unsupported" };
  }
}

/** Turns alerts off for this browser: the subscription is dropped here and on our server. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await post("/api/push/unsubscribe", { endpoint });
  try {
    await sub.unsubscribe();
  } catch {
    /* already gone */
  }
}

/**
 * Keeps a live subscription saved: call it when Me opens, and when the worker
 * says the browser rotated it. Quiet when alerts were never turned on here
 * (it never asks for permission), and when the Hopper chose Off.
 */
export async function syncPush(): Promise<void> {
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return;
  if ((await getAlertLevel()) === "off") return;
  const sub = await currentSubscription();
  if (sub) await saveOnServer(sub);
}

/** The Hopper's choice. "few" until they pick; null when it cannot be read (offline, demo). */
export async function getAlertLevel(): Promise<AlertLevel | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("my_alert_level");
  return !error && (data === "off" || data === "few" || data === "all") ? data : null;
}

export async function setAlertLevel(level: AlertLevel): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data, error } = await sb.rpc("set_alert_level", { p_level: level });
  return !error && data === true;
}

/** The Hopper tapped an install button: InstallSheet opens (it shows the Share steps on iPhone and stays quiet in the installed app). */
export const ASK_INSTALL_EVENT = "hoppaz:ask-install";

/**
 * Opens the home-screen install sheet (components/app/InstallSheet) because the
 * Hopper asked: it is the one moment that opens even while Paz's tour is
 * running (every other moment waits until the tour is done).
 */
export function askToInstall(): void {
  window.dispatchEvent(new Event(ASK_INSTALL_EVENT));
}

/** Development only (the route is a 404 in production): sends a test alert to this Hopper's own browsers. */
export async function sendTestAlert(): Promise<{ sent: number } | null> {
  const t = await token();
  if (!t) return null;
  try {
    const res = await fetch("/api/push/test", { method: "POST", headers: { Authorization: `Bearer ${t}` } });
    return res.ok ? ((await res.json()) as { sent: number }) : null;
  } catch {
    return null;
  }
}
