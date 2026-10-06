import { AREAS } from "./geo";
import { VIBES } from "./brand";

export type ParsedFlyer = {
  title?: string;
  venue?: string;
  area?: string;
  date?: string; // yyyy-mm-dd
  time?: string; // HH:mm
  price?: number;
  vibe?: string;
};

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/**
 * Reads a pasted Instagram flyer caption. This is deliberately a parser and not
 * a scraper: Instagram does not let anyone read a post server side without
 * their Graph API and a business account, so the Hopper pastes the text and we
 * do the tedious part. Everything it finds is editable before it is submitted.
 */
export function parseFlyerCaption(caption: string): ParsedFlyer {
  const out: ParsedFlyer = {};
  const lines = caption
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return out;

  // Title: the first line, stripped of emoji and decoration.
  const first = lines[0].replace(/[^\p{L}\p{N}\s'&.,!-]/gu, "").trim();
  if (first.length >= 2) out.title = first.slice(0, 120);

  // Time: "6pm", "11:30pm", "22:00"
  const t12 = caption.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const t24 = caption.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (t12) {
    let h = Number(t12[1]) % 12;
    if (/pm/i.test(t12[3])) h += 12;
    out.time = `${String(h).padStart(2, "0")}:${t12[2] ?? "00"}`;
  } else if (t24) {
    out.time = `${t24[1].padStart(2, "0")}:${t24[2]}`;
  }

  // Date: "11 Oct", "Oct 11", "11/10"
  const dm = caption.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-z]{3,9})\b/i);
  const md = caption.match(/\b([a-z]{3,9})\s+(\d{1,2})\s*(?:st|nd|rd|th)?\b/i);
  const slash = caption.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  const year = new Date().getFullYear();
  const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  if (dm && MONTHS.indexOf(dm[2].slice(0, 3).toLowerCase()) >= 0) {
    out.date = iso(year, MONTHS.indexOf(dm[2].slice(0, 3).toLowerCase()) + 1, Number(dm[1]));
  } else if (md && MONTHS.indexOf(md[1].slice(0, 3).toLowerCase()) >= 0) {
    out.date = iso(year, MONTHS.indexOf(md[1].slice(0, 3).toLowerCase()) + 1, Number(md[2]));
  } else if (slash) {
    const y = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : year;
    out.date = iso(y, Number(slash[2]), Number(slash[1])); // day/month, as Nigeria writes it
  }

  // Price: "₦5,000", "N5000", "5k", "free"
  const naira = caption.match(/(?:₦|\bN|NGN)\s?([\d,]{3,9})/i);
  const kay = caption.match(/\b(\d{1,3})\s?k\b/i);
  if (/\bfree\b|free entry|no gate/i.test(caption)) out.price = 0;
  else if (naira) out.price = Number(naira[1].replace(/,/g, ""));
  else if (kay) out.price = Number(kay[1]) * 1000;

  // Area: match the longest known area name that appears.
  const area = AREAS.filter((a) =>
    new RegExp(`\\b${a.name.replace(/ /g, "[ -]?")}\\b`, "i").test(caption)
  ).sort((a, b) => b.name.length - a.name.length)[0];
  if (area) out.area = area.name;

  // Vibe
  const vibe = VIBES.find((v) => new RegExp(`\\b${v}\\b`, "i").test(caption));
  if (vibe) out.vibe = vibe;

  // Venue: a line with a comma that is not the price or the time line, or the
  // part before the area name on the line that mentions it.
  const venueLine =
    lines.slice(1).find((l) => l.includes(",") && !/₦|\bN\d|free\b/i.test(l) && !/\d\s*(am|pm)/i.test(l)) ??
    (area ? lines.find((l) => new RegExp(area.name.replace(/ /g, "[ -]?"), "i").test(l)) : undefined);
  if (venueLine) {
    const candidate = venueLine.split(",")[0].replace(/[^\p{L}\p{N}\s'&.-]/gu, "").trim();
    if (candidate.length >= 2 && candidate.toLowerCase() !== out.title?.toLowerCase()) {
      out.venue = candidate.slice(0, 120);
    }
  }

  return out;
}
