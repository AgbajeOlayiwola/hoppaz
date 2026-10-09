/**
 * Small, safe reads of the device for the tour. Everything is wrapped: a
 * private window, an in-app browser or the server render must never throw.
 */

export type IntroEnv = {
  /** Running as the installed app. */
  standalone: boolean;
  /** iPhone or iPad. */
  ios: boolean;
  /** iPhone or iPad in a browser that can add to the home screen (not an in-app webview such as Instagram's). */
  iosBrowser: boolean;
  /** An Android phone or tablet. */
  android: boolean;
  /** The browser already allows notifications here. */
  pushGranted: boolean;
};

export function readEnv(): IntroEnv {
  if (typeof window === "undefined") return { standalone: false, ios: false, iosBrowser: false, android: false, pushGranted: false };
  let standalone = false;
  let ios = false;
  let iosBrowser = false;
  let android = false;
  let pushGranted = false;
  try {
    standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    /* ignore */
  }
  try {
    ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  } catch {
    /* ignore */
  }
  try {
    iosBrowser = ios && !/FBAN|FBAV|Instagram|Snapchat|Line\/|Twitter|TikTok|GSA\//.test(navigator.userAgent);
    android = /Android/i.test(navigator.userAgent);
  } catch {
    /* ignore */
  }
  try {
    pushGranted = "Notification" in window && Notification.permission === "granted";
  } catch {
    /* ignore */
  }
  return { standalone, ios, iosBrowser, android, pushGranted };
}

/** A little wider than the map's hard bound (geo.ts LAGOS_BOUNDS) so Ikorodu, Epe and Badagry count. */
const LAGOS = { minLat: 6.2, maxLat: 6.95, minLng: 2.6, maxLng: 4.2 };

export function inLagos(lat: number, lng: number): boolean {
  return lat >= LAGOS.minLat && lat <= LAGOS.maxLat && lng >= LAGOS.minLng && lng <= LAGOS.maxLng;
}

export function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
