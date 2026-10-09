import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { headers } from "next/headers";
import { demoEvents } from "@/lib/demoData";
import type { EventRow } from "@/lib/types";

/**
 * Shared by the share previews (the event page's metadata and the OG image
 * routes). Server only. Reads an event with the public key, because events
 * that are live are public; nothing here ever needs a login.
 */

/** What a share card needs to know about an event. */
export type ShareEvent = Pick<EventRow, "id" | "title" | "venue_name" | "area" | "starts_at" | "price_naira" | "vibe" | "flyer_url">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEV = process.env.NODE_ENV !== "production";
const COLUMNS = "id,title,venue_name,area,starts_at,price_naira,vibe,flyer_url";

/**
 * One live event by id, or null (unknown id, ended and removed, not live).
 * Development falls back to the sample day only when the database cannot
 * answer (no keys, or unreachable), the same rule the page follows (useEvents).
 */
export async function loadShareEvent(id: string): Promise<ShareEvent | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let answered = false;
  if (base && key) {
    if (!UUID.test(id)) {
      answered = true; // Not an event id: nothing to ask.
    } else {
      try {
        const res = await fetch(`${base}/rest/v1/events?id=eq.${id}&status=eq.live&select=${COLUMNS}&limit=1`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          next: { revalidate: 60 },
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          answered = true;
          const rows = (await res.json()) as ShareEvent[];
          if (rows[0]) return rows[0];
        }
      } catch {
        // Falls through: no card is better than a broken page.
      }
    }
  }
  if (DEV && !answered) return demoEvents().find((e) => e.id === id) ?? null;
  return null;
}

/** Changes whenever something the card shows changes, so a chat app that cached the old picture fetches the new one. */
export function cardVersion(e: ShareEvent) {
  let h = 2166136261;
  for (const ch of `${e.title}|${e.area}|${e.starts_at}|${e.price_naira}|${e.flyer_url}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

/**
 * The address people reach this site at, for absolute links in previews.
 * NEXT_PUBLIC_SITE_URL wins when set; otherwise it is the host that served
 * this request, so a preview deployment and a laptop both point at themselves.
 */
export async function siteOrigin(): Promise<string> {
  const fixed = process.env.NEXT_PUBLIC_SITE_URL;
  if (fixed) {
    try {
      return new URL(fixed).origin;
    } catch {
      // A malformed value is ignored.
    }
  }
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host") || "localhost:3000";
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return "http://localhost:3000";
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || (local ? "http" : "https");
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

// ------------------------------------------------------------------ fonts ----

type OgFont = { name: string; data: ArrayBuffer; weight: 500 | 600 | 900; style: "normal" };

/**
 * The fonts are copies of the @fontsource files the app already ships (SIL Open
 * Font License), kept beside the route on purpose: the build traces files under
 * the project into the deployed function but not these files out of node_modules,
 * and every path is spelled out in full because a path assembled from variables
 * would be left out too.
 *
 * Satori uses one file per family name and weight, and falls back to every
 * other family name per missing letter. So each extra subset gets a name of
 * its own: "Archivo Ext" carries the naira sign, "Archivo Vi" the Yoruba
 * letters (dotted e, o and s), which Poppins and DM Mono do not have.
 */
const FONT_FILES: Array<{ name: string; weight: OgFont["weight"]; load: () => Promise<Buffer> }> = [
  { name: "Poppins", weight: 900, load: () => readFile(join(process.cwd(), "src/app/api/og/fonts/poppins-latin-900.woff")) },
  { name: "Poppins Ext", weight: 900, load: () => readFile(join(process.cwd(), "src/app/api/og/fonts/poppins-latin-ext-900.woff")) },
  { name: "Archivo", weight: 600, load: () => readFile(join(process.cwd(), "src/app/api/og/fonts/archivo-latin-600.woff")) },
  { name: "Archivo Ext", weight: 600, load: () => readFile(join(process.cwd(), "src/app/api/og/fonts/archivo-latin-ext-600.woff")) },
  { name: "Archivo Vi", weight: 600, load: () => readFile(join(process.cwd(), "src/app/api/og/fonts/archivo-vietnamese-600.woff")) },
  { name: "Archivo", weight: 900, load: () => readFile(join(process.cwd(), "src/app/api/og/fonts/archivo-latin-900.woff")) },
  { name: "Archivo Ext", weight: 900, load: () => readFile(join(process.cwd(), "src/app/api/og/fonts/archivo-latin-ext-900.woff")) },
  { name: "Archivo Vi", weight: 900, load: () => readFile(join(process.cwd(), "src/app/api/og/fonts/archivo-vietnamese-900.woff")) },
  { name: "DM Mono", weight: 500, load: () => readFile(join(process.cwd(), "src/app/api/og/fonts/dm-mono-latin-500.woff")) },
  { name: "DM Mono Ext", weight: 500, load: () => readFile(join(process.cwd(), "src/app/api/og/fonts/dm-mono-latin-ext-500.woff")) },
];

const toBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

let fontsOnce: Promise<OgFont[]> | null = null;

/** The same faces the app uses, read once. A missing file is skipped, not fatal. */
export function loadFonts(): Promise<OgFont[]> {
  fontsOnce ??= Promise.all(
    FONT_FILES.map(async (f) => {
      try {
        return { name: f.name, data: toBuffer(await f.load()), weight: f.weight, style: "normal" } as OgFont;
      } catch {
        return null;
      }
    })
  ).then((all) => all.filter((f): f is OgFont => f !== null));
  return fontsOnce;
}

const brandCache = new Map<string, string>();

/** A brand picture from public/brand as a data URL, so the card needs no network round trip for the wordmark. */
export async function brandImage(which: "wordmark" | "mark"): Promise<string> {
  const hit = brandCache.get(which);
  if (hit) return hit;
  const buf = await (which === "wordmark"
    ? readFile(join(process.cwd(), "public/brand/wordmark-cream.png"))
    : readFile(join(process.cwd(), "public/brand/mark-orange.png")));
  const url = `data:image/png;base64,${buf.toString("base64")}`;
  brandCache.set(which, url);
  return url;
}

// ----------------------------------------------------------------- flyers ----

export type Flyer = { src: string; width: number; height: number };

const MAX_FLYER_BYTES = 6 * 1024 * 1024;
/** A small, heavily squeezed file can unpack to a huge picture (sharp's own limit is 268 million pixels, about a gigabyte). A flyer never needs more than this. */
const MAX_FLYER_PIXELS = 24_000_000;

/** Our own Supabase storage: the one place a flyer is expected to live (and, in development, a local address). */
function isOwnOrigin(u: URL) {
  const own = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    return !!own && new URL(own).origin === u.origin;
  } catch {
    return false;
  }
}

/**
 * Flyer links are typed in by organisers, and this server fetches them, so
 * only places a flyer can really live are allowed: our own storage, or a
 * public https host. Never localhost, a private name or a bare IP address.
 */
function flyerUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (isOwnOrigin(u)) return u;
  if (u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || /\.(localhost|local|internal|lan)$/.test(h)) return null;
  if (/^[\d.]+$/.test(h) || h.includes(":") || !h.includes(".")) return null;
  return u;
}

/** An address that is not the open internet: this machine, the private ranges, link-local (cloud metadata), carrier NAT, multicast. */
function privateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateAddress(mapped[1]);
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(v) === 6) return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
  return true; // not an address at all: do not trust it
}

/**
 * A public name that points at a private address (a hostname someone set up to
 * reach our own network) is as bad as an IP typed in. The name is resolved here
 * and every address it gives must be public. Redirects are off in the fetch, so
 * the first hop is the only hop.
 */
async function resolvesPublic(host: string): Promise<boolean> {
  try {
    const all = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, no) => setTimeout(() => no(new Error("dns timeout")), 2000)),
    ]);
    return all.length > 0 && all.every((a) => !privateAddress(a.address));
  } catch {
    return false;
  }
}

/** Pixel size of a PNG, JPEG or GIF from its header, or null for anything else. */
function imageSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 32) return null;
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, height: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  // JPEG: walk the segments to the first start-of-frame marker
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

/** The slice of sharp this folder uses. sharp ships with Next (it is what the image optimizer runs on). */
type SharpPipeline = {
  rotate(): SharpPipeline;
  resize(o: { width: number; height: number; fit: "inside"; withoutEnlargement: boolean }): SharpPipeline;
  flatten(o: { background: string }): SharpPipeline;
  jpeg(o: { quality: number }): SharpPipeline;
  png(o: { palette: boolean; quality: number; effort: number; colours: number; dither: number }): SharpPipeline;
  toBuffer(o: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number } }>;
};
type Sharp = (input: Uint8Array, options?: { limitInputPixels?: number }) => SharpPipeline;

let sharpOnce: Promise<Sharp | null> | null = null;

/** sharp, or null where it is not installed (flyers then draw as they are, and the card is not slimmed down). */
export function loadSharp(): Promise<Sharp | null> {
  const name = "sharp";
  sharpOnce ??= import(/* webpackIgnore: true */ name).then(
    (m) => (m.default ?? m) as Sharp,
    () => null
  );
  return sharpOnce;
}

/**
 * The flyer, fetched here and handed to the card as a data URL with its size,
 * so one slow or broken link can never fail the picture: null means "draw the
 * card without a flyer". With sharp, every flyer (WebP too, which the drawing
 * library cannot show) is turned upright, shrunk to what the card needs and
 * re-encoded as a JPEG on cream.
 */
export async function loadFlyer(raw: string | null): Promise<Flyer | null> {
  const u = raw ? flyerUrl(raw) : null;
  if (!u) return null;
  if (!isOwnOrigin(u) && !(await resolvesPublic(u.hostname))) return null;
  try {
    const res = await fetch(u, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_FLYER_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_FLYER_BYTES) return null;

    const sharp = await loadSharp();
    if (sharp) {
      const { data, info } = await sharp(bytes, { limitInputPixels: MAX_FLYER_PIXELS })
        .rotate()
        .resize({ width: 800, height: 976, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#F5EBDD" })
        .jpeg({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      return { src: `data:image/jpeg;base64,${data.toString("base64")}`, width: info.width, height: info.height };
    }

    const size = imageSize(bytes);
    if (!size || size.width < 8 || size.height < 8) return null;
    const mime = bytes[0] === 0x89 ? "image/png" : bytes[0] === 0x47 ? "image/gif" : "image/jpeg";
    return { src: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`, ...size };
  } catch {
    return null;
  }
}
