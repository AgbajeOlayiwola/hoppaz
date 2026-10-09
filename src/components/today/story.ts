import { dayLabel, nightOf } from "@/lib/filters";
import { clockShort, eventPrice, eventTitle, isEventLead } from "@/lib/geo";
import type { EventRow } from "@/lib/types";
import { hasEnded } from "./helpers";
import { BRAND_PALETTE, withAlpha, type Palette } from "./palette";

/**
 * Share to story: a real 1080 x 1920 PNG, drawn on a canvas.
 *
 * The flyer sits on a ticket (the same strip as the card), tilted a little and
 * shadowed, over a backdrop that glows with the flyer's own colours. An I'M GOING
 * sticker (ENDED for a night that is over, COMING UP while its time is unconfirmed), the HOPPAZ wordmark, the date and
 * area, and the site's address finish it, so a story of it sends people back here.
 * A story cannot carry a link and nobody can type a long one, so the picture
 * prints the short address only; the link itself goes with the share sheet.
 *
 * Reading a flyer back off a canvas needs the flyer's server to allow CORS. If it
 * does not (the canvas is "tainted" and cannot be saved), the poster is drawn
 * again with the branded title block instead of the flyer, so there is always an
 * image to share and it never breaks.
 */

export const STORY_W = 1080;
export const STORY_H = 1920;

export type StoryInput = {
  event: EventRow;
  going: number;
  /** The flyer address, or null to draw the branded block. */
  flyer: string | null;
  palette: Palette;
  /** Whether the night has a drop (the violet BOX HERE mark). */
  box: boolean;
  /** The short address to print: the site's host (hoppaz.app), never the event's long link. */
  link: string;
  now: number;
};

export type StoryResult = { blob: Blob; usedFlyer: boolean };

const DISPLAY = "Poppins, 'Arial Black', system-ui, sans-serif";
const MONO = "'DM Mono', ui-monospace, Menlo, monospace";

/** Draw the story and hand back the PNG. */
export async function renderStory(input: StoryInput): Promise<StoryResult> {
  try {
    await Promise.all([document.fonts.load(`900 80px ${DISPLAY}`), document.fonts.load(`500 30px ${MONO}`)]);
  } catch {
    /* the system fonts will do */
  }
  const [flyerImg, word, mark] = await Promise.all([
    input.flyer ? loadImage(input.flyer, true) : Promise.resolve(null),
    loadImage("/brand/wordmark-cream.png", false),
    loadImage("/brand/mark-orange.png", false),
  ]);
  try {
    return { blob: await draw(input, flyerImg, word, mark), usedFlyer: !!flyerImg };
  } catch (e) {
    // A tainted canvas: draw it again without the flyer rather than fail.
    if (flyerImg && e instanceof DOMException && e.name === "SecurityError") {
      return { blob: await draw(input, null, word, mark), usedFlyer: false };
    }
    throw e;
  }
}

function loadImage(src: string, cors: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image();
    if (cors) im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

function toBlob(cv: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("The story could not be saved as a picture."))), "image/png");
    } catch (e) {
      reject(e); // a tainted canvas throws right here
    }
  });
}

/* -------------------------------------------------------------- drawing -- */

type Ctx = CanvasRenderingContext2D;

async function draw(
  { event, going, palette, box, link, now }: StoryInput,
  flyerImg: HTMLImageElement | null,
  word: HTMLImageElement | null,
  mark: HTMLImageElement | null
) {
  const W = STORY_W;
  const H = STORY_H;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  // willReadFrequently keeps it a plain (CPU) canvas: it is saved as a picture once drawn, and a GPU one stalls on that read.
  const x = cv.getContext("2d", { willReadFrequently: true });
  if (!x) throw new Error("This browser cannot draw the story.");
  const [c0, c1, c2] = palette ?? BRAND_PALETTE;

  // The ground, then the flyer's colours as soft pools of light.
  x.fillStyle = "#0E0B0A";
  x.fillRect(0, 0, W, H);
  const pool = (cx: number, cy: number, r: number, col: string, a: number) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(col, a));
    g.addColorStop(1, withAlpha(col, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  };
  pool(W * 0.5, H * 0.46, W * 1.05, c0, 0.95);
  pool(0, H * 0.14, W * 0.95, c1, 0.8);
  pool(W, H * 0.9, W * 1.1, c2, 0.9);
  pool(W, 0, W * 0.7, c1, 0.4);
  const vg = x.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, "rgba(14,11,10,.5)");
  vg.addColorStop(0.18, "rgba(14,11,10,0)");
  vg.addColorStop(0.8, "rgba(14,11,10,0)");
  vg.addColorStop(1, "rgba(14,11,10,.72)");
  x.fillStyle = vg;
  x.fillRect(0, 0, W, H);
  // A fine dot screen, like print.
  x.fillStyle = "rgba(14,11,10,.12)";
  for (let yy = 0; yy < H; yy += 22) for (let xx = ((yy / 22) % 2) * 11; xx < W; xx += 22) x.fillRect(xx, yy, 3, 3);
  // A ticket frame: a solid hairline and a dotted one inside it.
  x.strokeStyle = "rgba(245,235,221,.4)";
  x.lineWidth = 5;
  roundRect(x, 34, 34, W - 68, H - 68, 64);
  x.stroke();
  x.setLineDash([2, 18]);
  x.lineCap = "round";
  x.lineWidth = 6;
  x.strokeStyle = "rgba(245,235,221,.35)";
  roundRect(x, 58, 58, W - 116, H - 116, 48);
  x.stroke();
  x.setLineDash([]);

  // The wordmark, the real file (letters take the lower 58% of it, the ears rise above).
  if (word) {
    const h = 150;
    const w = (word.width / word.height) * h;
    x.drawImage(word, W / 2 - w / 2, 112, w, h);
  } else {
    x.fillStyle = "#F5EBDD";
    x.font = `900 112px ${DISPLAY}`;
    x.textAlign = "center";
    x.fillText("HOPPAZ", W / 2, 214);
    x.textAlign = "left";
  }

  // The poster card, tilted and shadowed.
  const cw = 820;
  const ch = 1230;
  const off = document.createElement("canvas");
  off.width = cw;
  off.height = ch;
  // Plain (CPU) like the canvas it is drawn onto: a GPU one would be read back from the graphics card, and stall.
  const ox = off.getContext("2d", { willReadFrequently: true });
  if (!ox) throw new Error("This browser cannot draw the story.");
  drawPoster(ox, { event, going, box, now }, cw, ch, flyerImg, mark);
  x.save();
  x.translate(W / 2, 300 + ch / 2);
  x.rotate((-1.8 * Math.PI) / 180);
  x.shadowColor = "rgba(0,0,0,.6)";
  x.shadowBlur = 70;
  x.shadowOffsetY = 36;
  x.drawImage(off, -cw / 2, -ch / 2);
  x.restore();

  // The sticker: I'M GOING, ENDED once the night is over, COMING UP while its time is still to be confirmed
  // (neither can be said yes to, so neither says "going").
  const over = hasEnded(event, now);
  const stamp = over ? "ENDED" : isEventLead(event) ? "COMING UP" : "I'M GOING";
  x.save();
  x.translate(884, 356);
  x.rotate((9 * Math.PI) / 180);
  x.fillStyle = over ? "rgba(14,11,10,.55)" : "#B83600";
  roundRect(x, -118, -34, 236, 84, 24);
  x.fill();
  x.fillStyle = over ? "#F5EBDD" : "#FF4D00";
  roundRect(x, -118, -42, 236, 84, 24);
  x.fill();
  x.fillStyle = "#0E0B0A";
  x.font = `900 40px ${DISPLAY}`;
  x.textAlign = "center";
  x.fillText(stamp, 0, 13);
  x.restore();

  // When and where, the link, and a goodbye.
  const lead = isEventLead(event);
  const info = [lead ? "TIME TBC" : dateTag(event.starts_at), lead ? null : clockShort(event.starts_at), event.area?.toUpperCase() ?? null]
    .filter(Boolean)
    .join("  ·  ");
  x.textAlign = "center";
  x.fillStyle = "#F5EBDD";
  fitText(x, info, 500, MONO, 35, 24, 3, W - 220);
  x.fillText(info, W / 2, 1614);
  const shown = link.replace(/^https?:\/\//, "");
  const lsz = fitText(x, shown, 500, MONO, 44, 26, 0, W - 220);
  const lw = Math.min(W - 120, x.measureText(shown).width + 120);
  x.fillStyle = "#B83600";
  roundRect(x, W / 2 - lw / 2, 1668, lw, 112, 56);
  x.fill();
  x.fillStyle = "#FF4D00";
  roundRect(x, W / 2 - lw / 2, 1660, lw, 112, 56);
  x.fill();
  x.fillStyle = "#0E0B0A";
  x.fillText(shown, W / 2, 1660 + 56 + lsz * 0.34);
  x.fillStyle = "rgba(245,235,221,.72)";
  setFont(x, 500, MONO, 28, 8);
  x.fillText(over ? "SEE YOU NEXT TIME" : "SEE YOU OUTSIDE", W / 2, 1838);
  setSpacing(x, 0);
  x.textAlign = "left";

  return toBlob(cv);
}

/** The card: the flyer (or the branded block), the ticket strip, TAP FOR DETAILS' twin "JOIN THE HOPPERS". */
function drawPoster(
  x: Ctx,
  { event, going, box, now }: { event: EventRow; going: number; box: boolean; now: number },
  cw: number,
  ch: number,
  flyer: HTMLImageElement | null,
  mark: HTMLImageElement | null
) {
  const s = cw / 260;
  x.save();
  roundRect(x, 0, 0, cw, ch, 22 * s);
  x.clip();
  if (flyer) {
    // object-fit: cover
    const k = Math.max(cw / flyer.width, ch / flyer.height);
    const w = flyer.width * k;
    const h = flyer.height * k;
    x.drawImage(flyer, (cw - w) / 2, (ch - h) / 2, w, h);
    const sh = x.createLinearGradient(0, 0, 0, ch);
    sh.addColorStop(0, "rgba(14,11,10,.4)");
    sh.addColorStop(0.2, "rgba(14,11,10,0)");
    sh.addColorStop(0.65, "rgba(14,11,10,0)");
    sh.addColorStop(1, "rgba(14,11,10,.3)");
    x.fillStyle = sh;
    x.fillRect(0, 0, cw, ch);
  } else {
    drawBlock(x, event, cw, ch, s, mark);
  }

  // The violet mark.
  const by = ch - 112 * s;
  if (box) {
    setFont(x, 500, MONO, 8.5 * s, 0.14 * 8.5 * s);
    const tw = x.measureText("BOX HERE").width;
    const bw = tw + 30 * s;
    x.save();
    x.shadowColor = "rgba(91,46,255,.8)";
    x.shadowBlur = 14 * s;
    x.fillStyle = "#5B2EFF";
    roundRect(x, cw - 12 * s - bw, by - 24 * s, bw, 24 * s, 12 * s);
    x.fill();
    x.restore();
    x.fillStyle = "#fff";
    x.textAlign = "left";
    x.fillText("BOX HERE", cw - 12 * s - bw + 15 * s, by - 8.2 * s);
    setSpacing(x, 0);
  }

  // The ticket strip.
  const lead = isEventLead(event);
  const ended = hasEnded(event, now);
  const sy = ch - 100 * s;
  x.fillStyle = "#FBF3E6";
  x.fillRect(0, sy, cw, 100 * s);
  x.fillStyle = "rgba(14,11,10,.36)";
  for (let px = 14 * s; px < cw - 14 * s; px += 10 * s) x.fillRect(px, sy - 0.5 * s, 5 * s, 1.5 * s);
  const time = lead ? "TBC" : clockShort(event.starts_at);
  x.fillStyle = "#0E0B0A";
  x.textAlign = "left";
  x.font = `900 ${23 * s}px ${DISPLAY}`;
  setSpacing(x, 0);
  x.fillText(time, 14 * s, sy + 34 * s);
  const tw2 = x.measureText(time).width;
  if (!lead) {
    x.fillStyle = "#6B5F55";
    setFont(x, 500, MONO, 9 * s, 0.14 * 9 * s);
    x.fillText(dayWord(event.starts_at, now), 14 * s + tw2 + 7 * s, sy + 34 * s);
    setSpacing(x, 0);
  }
  x.fillStyle = "#0E0B0A";
  x.textAlign = "right";
  if (lead) {
    setFont(x, 500, MONO, 9 * s, 0.1 * 9 * s);
    x.fillText(eventPrice(event), cw - 14 * s, sy + 33 * s);
  } else {
    x.font = `900 ${16 * s}px ${DISPLAY}`;
    setSpacing(x, 0);
    x.fillText(eventPrice(event), cw - 14 * s, sy + 33 * s);
  }
  x.fillStyle = "#FF4D00";
  x.beginPath();
  x.arc(18 * s, sy + 55 * s, 3.2 * s, 0, 7);
  x.fill();
  x.fillStyle = "#3B322C";
  x.textAlign = "left";
  setFont(x, 500, MONO, 9 * s, 0.1 * 9 * s);
  x.fillText((event.area ?? event.venue_name).toUpperCase().slice(0, 26), 27 * s, sy + 58.5 * s);
  x.textAlign = "right";
  x.fillText(ended ? "ENDED" : lead ? "UNCONFIRMED" : going > 0 ? `${going} GOING` : "BE THE FIRST", cw - 14 * s, sy + 58.5 * s);
  x.textAlign = "left";
  setSpacing(x, 0);
  x.fillStyle = "#FF4D00";
  x.fillRect(0, ch - 30 * s, cw, 30 * s);
  x.fillStyle = "#B83600";
  x.fillRect(0, ch - 3 * s, cw, 3 * s);
  x.fillStyle = "#0E0B0A";
  x.font = `900 ${10.5 * s}px ${DISPLAY}`;
  setSpacing(x, 0.1 * 10.5 * s);
  x.textAlign = "center";
  x.fillText("JOIN THE HOPPERS", cw / 2, ch - 12.5 * s);
  x.textAlign = "left";
  setSpacing(x, 0);
  x.restore();

  // The two punched notches on the perforation.
  x.save();
  x.globalCompositeOperation = "destination-out";
  x.beginPath();
  x.arc(0, sy, 9 * s, 0, 7);
  x.fill();
  x.beginPath();
  x.arc(cw, sy, 9 * s, 0, 7);
  x.fill();
  x.restore();
}

/** No flyer: the title in Poppins Black on the brand's colours, the mark faint behind it. */
function drawBlock(x: Ctx, event: EventRow, cw: number, ch: number, s: number, mark: HTMLImageElement | null) {
  x.fillStyle = "#0E0B0A";
  x.fillRect(0, 0, cw, ch);
  const pool = (cx: number, cy: number, r: number, col: string, a: number) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(col, a));
    g.addColorStop(1, withAlpha(col, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, cw, ch);
  };
  pool(cw, 0, cw * 0.95, "#FF4D00", 0.55);
  pool(0, ch, cw * 0.95, "#5B2EFF", 0.5);
  if (mark) {
    const w = cw * 0.62;
    const h = (mark.height / mark.width) * w;
    x.save();
    x.globalAlpha = 0.16;
    x.drawImage(mark, cw * 0.46, ch * 0.52 - h / 2, w, h);
    x.restore();
  }
  const title = eventTitle(event).toUpperCase();
  const maxW = cw - 32 * s;
  let size = (title.length <= 12 ? 52 : title.length <= 22 ? 42 : title.length <= 36 ? 34 : 28) * s;
  let lines: string[] = [];
  for (let tries = 0; tries < 8; tries++) {
    x.font = `900 ${size}px ${DISPLAY}`;
    lines = wrap(x, title, maxW);
    if (lines.length <= 5 && lines.every((l) => x.measureText(l).width <= maxW)) break;
    size *= 0.88;
  }
  x.fillStyle = "#F5EBDD";
  x.textAlign = "left";
  setSpacing(x, 0);
  x.save();
  x.shadowColor = "rgba(0,0,0,.3)";
  x.shadowBlur = 18 * s;
  x.shadowOffsetY = 3 * s;
  lines.slice(0, 5).forEach((l, i) => x.fillText(l, 18 * s, 52 * s + size * 0.82 + i * size * 0.95));
  x.restore();
  if (event.vibe) {
    setFont(x, 500, MONO, 9.5 * s, 0.18 * 9.5 * s);
    const t = event.vibe.toUpperCase();
    const w = x.measureText(t).width + 16 * s;
    x.fillStyle = "rgba(245,235,221,.14)";
    roundRect(x, 18 * s, ch - 118 * s - 22 * s, w, 22 * s, 4 * s);
    x.fill();
    x.fillStyle = "#F5EBDD";
    x.fillText(t, 26 * s, ch - 118 * s - 7 * s);
    setSpacing(x, 0);
  }
}

/* -------------------------------------------------------------- helpers -- */

function roundRect(x: Ctx, a: number, b: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(a + r, b);
  x.arcTo(a + w, b, a + w, b + h, r);
  x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r);
  x.arcTo(a, b, a + w, b, r);
  x.closePath();
}

/** letterSpacing is not in every browser yet; without it the text is just a touch tighter. */
function setSpacing(x: Ctx, px: number) {
  if ("letterSpacing" in x) (x as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`;
}

function setFont(x: Ctx, weight: number, family: string, px: number, spacing: number) {
  x.font = `${weight} ${px}px ${family}`;
  setSpacing(x, spacing);
}

/** Set the font so `text` fits `max` wide: from `from` px down to no less than `min`. Returns the size used. */
function fitText(x: Ctx, text: string, weight: number, family: string, from: number, min: number, spacing: number, max: number) {
  let px = from;
  setFont(x, weight, family, px, spacing);
  while (px > min && x.measureText(text).width > max) {
    px -= 1;
    setFont(x, weight, family, px, spacing);
  }
  return px;
}

function wrap(x: Ctx, text: string, maxW: number) {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && x.measureText(next).width > maxW) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** "FRI 9 OCT": the night the event belongs to (a 1am start is the night before). */
function dateTag(startsAt: string) {
  const d = new Date(`${nightOf(Date.parse(startsAt))}T12:00:00Z`);
  const weekday = d.toLocaleDateString("en-NG", { weekday: "short", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-NG", { month: "short", timeZone: "UTC" });
  return `${weekday} ${d.getUTCDate()} ${month}`.toUpperCase();
}

/** "TODAY", "TONIGHT", "SAT 10 OCT": the small word beside the time on the strip (the card's own wording). */
function dayWord(startsAt: string, now: number) {
  return dayLabel(startsAt, now).split(" · ")[0] ?? "";
}
