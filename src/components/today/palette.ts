/**
 * Each event's colours, taken from its flyer: two or three dominant, lively
 * colours that the Today screen glows with while that card is in the middle.
 *
 * The flyer is drawn on a tiny canvas (32 x 48) and its pixels are counted into
 * hue buckets, weighted towards colours that are saturated and neither near
 * black nor near white (a flyer's text and margins would otherwise win). The
 * three best buckets that are far enough apart in hue become the palette, and
 * each is nudged into a range that glows well on the Night or Day ground.
 *
 * Flyers live in the Supabase public bucket, which answers with CORS headers, so
 * the image is requested with crossOrigin "anonymous" (the card draws it the same
 * way, so the browser reuses one download). If the canvas is tainted anyway, or
 * the image will not load, the brand palette is used. Nothing here ever throws.
 *
 * Results are cached per flyer address for the life of the page.
 */

export type Palette = [string, string, string];

/** Orange, violet and ember: what a card with no flyer (or an unreadable one) glows with. */
export const BRAND_PALETTE: Palette = ["#FF4D00", "#5B2EFF", "#B83600"];

const W = 32;
const H = 48;
const BUCKETS = 12;

const done = new Map<string, Palette>();
const pending = new Map<string, Promise<Palette>>();

/** The palette if it is already known, else null (the caller shows the brand palette until it arrives). */
export function knownPalette(url: string | null): Palette | null {
  if (!url) return BRAND_PALETTE;
  return done.get(url) ?? null;
}

/** Load a flyer and read its colours. One request per address, however many cards ask. */
export function loadPalette(url: string | null): Promise<Palette> {
  if (!url) return Promise.resolve(BRAND_PALETTE);
  const have = done.get(url);
  if (have) return Promise.resolve(have);
  const wait = pending.get(url);
  if (wait) return wait;
  const p = new Promise<Palette>((resolve) => {
    const finish = (pal: Palette) => {
      done.set(url, pal);
      pending.delete(url);
      resolve(pal);
    };
    if (typeof Image === "undefined") return finish(BRAND_PALETTE);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        finish(readPalette(img));
      } catch {
        finish(BRAND_PALETTE); // a tainted canvas, or no canvas at all
      }
    };
    img.onerror = () => finish(BRAND_PALETTE);
    img.src = url;
  });
  pending.set(url, p);
  return p;
}

/* ---------------------------------------------------------------- pixels -- */

function readPalette(img: HTMLImageElement): Palette {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  if (!cx) return BRAND_PALETTE;
  cx.drawImage(img, 0, 0, W, H);
  const { data } = cx.getImageData(0, 0, W, H); // throws on a tainted canvas
  return pickPalette(data);
}

type Bucket = { w: number; r: number; g: number; b: number; hue: number };

function pickPalette(data: Uint8ClampedArray): Palette {
  const buckets: Bucket[] = Array.from({ length: BUCKETS }, (_, i) => ({ w: 0, r: 0, g: 0, b: 0, hue: (i + 0.5) * (360 / BUCKETS) }));
  let counted = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.1 || l > 0.93 || s < 0.16) continue;
    // Lively beats common: saturation squared, and mid lightness over the extremes.
    const w = s * s * (1 - Math.abs(l - 0.52) * 1.2);
    const b = buckets[Math.min(BUCKETS - 1, Math.floor(h / (360 / BUCKETS)))];
    b.w += w;
    b.r += data[i] * w;
    b.g += data[i + 1] * w;
    b.b += data[i + 2] * w;
    counted++;
  }
  // A flyer that is nearly all black and white has no colour of its own: use the brand's.
  if (counted < 24) return BRAND_PALETTE;

  const ranked = buckets.filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  const picked: Bucket[] = [];
  for (const b of ranked) {
    if (picked.every((p) => hueGap(p.hue, b.hue) >= 50)) picked.push(b);
    if (picked.length === 3) break;
  }
  const out: string[] = picked.map((b) => glowHex(b.r / b.w, b.g / b.w, b.b / b.w));
  // Fewer than three distinct colours: borrow from the brand so the screen still has depth.
  const spare = [BRAND_PALETTE[1], BRAND_PALETTE[0], BRAND_PALETTE[2]];
  while (out.length < 3) out.push(spare[out.length - 1] ?? BRAND_PALETTE[2]);
  return [out[0], out[1], out[2]];
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Pull a colour into the band that glows: saturated, not muddy, not blown out. */
function glowHex(r: number, g: number, b: number) {
  const [h, s, l] = rgbToHsl(r, g, b);
  const [nr, ng, nb] = hslToRgb(h, Math.max(0.6, Math.min(1, s)), Math.max(0.42, Math.min(0.58, l)));
  return "#" + [nr, ng, nb].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** "#FF4D00" and an alpha as an rgba() string, for the glow gradients. */
export function withAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
