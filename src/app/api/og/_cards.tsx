import type { CSSProperties, ReactElement } from "react";
import { ImageResponse } from "next/og";
import { shareDate } from "@/components/event/share";
import { clockShort, eventPrice, eventTitle, isEventLead } from "@/lib/geo";
import { loadSharp, type Flyer, type ShareEvent } from "./_lib";

/**
 * The two share cards, 1200 x 630, drawn with next/og (Satori): flexbox and a
 * subset of CSS only, every element with more than one child is display:flex.
 * Colours are the brand's fixed ones (src/lib/brand.ts); the card is always
 * the night look, whatever the time in Lagos.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;

const INK = "#0E0B0A";
const INK2 = "#17110F";
const INK3 = "#231915";
const ORANGE = "#FF4D00";
const EMBER = "#B83600";
const CREAM = "#F5EBDD";
const DIM = "#8A7C73";
const LINE = "#2E211C";

const DISPLAY = "Poppins, Archivo";
const BODY = "Archivo";
const MONO = "DM Mono, Archivo";

type Fonts = Awaited<ReturnType<typeof import("./_lib").loadFonts>>;

/**
 * Draws the card to a PNG. The picture is built in full before anything is
 * returned, so a flyer Satori cannot draw throws here (where the caller can
 * try again without it) instead of failing halfway through a response.
 * A card with a photo on it comes out of Satori at 400 to 650 KB, and WhatsApp
 * drops preview pictures over about 300 KB, so it is re-packed as a 256 colour
 * PNG (about 130 to 200 KB) where sharp is available.
 */
export async function renderPng(card: ReactElement, fonts: Fonts, cacheControl: string) {
  const image = new ImageResponse(card, { ...OG_SIZE, fonts });
  let body: Uint8Array = new Uint8Array(await image.arrayBuffer());
  if (body.length > 150_000) {
    try {
      const sharp = await loadSharp();
      if (sharp) {
        const { data } = await sharp(body).png({ palette: true, quality: 80, effort: 4, colours: 256, dither: 1 }).toBuffer({ resolveWithObject: true });
        if (data.length < body.length) body = data;
      }
    } catch {
      // The full size picture is still a good picture.
    }
  }
  return new Response(body as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": cacheControl } });
}

/** The biggest title size that fits the column in at most three lines. */
function titleSize(title: string, width: number) {
  for (const size of [112, 96, 84, 72, 62, 54, 46]) {
    const charW = size * 0.76;
    const perLine = Math.floor(width / charW);
    let lines = 1;
    let used = 0;
    let fits = true;
    for (const word of title.split(/\s+/)) {
      if (word.length > perLine) {
        fits = false;
        break;
      }
      if (used === 0) used = word.length;
      else if (used + 1 + word.length <= perLine) used += 1 + word.length;
      else {
        lines++;
        used = word.length;
      }
    }
    if (fits && lines <= 3 && lines * size * 1.04 <= 276) return size;
  }
  return 40;
}

/** The flyer's box: the whole flyer, scaled to fit, never cropped. */
function flyerBox(f: Flyer) {
  const maxW = 400;
  const maxH = 488;
  const k = Math.min(maxW / f.width, maxH / f.height);
  return { w: Math.round(f.width * k), h: Math.round(f.height * k) };
}

const frame: CSSProperties = {
  display: "flex",
  transform: "rotate(-2.5deg)",
  border: `7px solid ${CREAM}`,
  borderRadius: 12,
  background: CREAM,
  boxShadow: `0 10px 0 ${EMBER}, 0 28px 50px rgba(0,0,0,0.55)`,
};

/** An event: the flyer in the Hoppaz frame, its name, when and where, and the wordmark. */
export function EventShareCard({
  event,
  flyer,
  wordmark,
  mark,
}: {
  event: ShareEvent;
  flyer: Flyer | null;
  wordmark: string;
  mark: string;
}) {
  const lead = isEventLead(event);
  const title = eventTitle(event).toUpperCase();
  const size = titleSize(title, 600);
  const when = `${shareDate(event.starts_at)}  ·  ${lead ? "TIME TBC" : clockShort(event.starts_at)}`;
  const place = (event.area ?? event.venue_name).toUpperCase();
  const price = lead ? null : eventPrice(event);
  const box = flyer ? flyerBox(flyer) : null;

  return (
    <div
      style={{
        display: "flex",
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        backgroundColor: INK,
        backgroundImage: "radial-gradient(circle at 24% 46%, rgba(255,77,0,0.30) 0%, rgba(255,77,0,0) 50%)",
        color: CREAM,
        position: "relative",
      }}
    >
      {/* The flyer, whole, in the frame. Without one: the Hoppaz mark in the same frame, never a made-up picture. */}
      <div style={{ display: "flex", width: 520, height: OG_SIZE.height, alignItems: "center", justifyContent: "center" }}>
        <div style={frame}>
          {flyer && box ? (
            // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain img tags
            <img src={flyer.src} width={box.w} height={box.h} alt="" style={{ borderRadius: 5 }} />
          ) : (
            <div style={{ display: "flex", width: 330, height: 440, alignItems: "center", justifyContent: "center", background: INK3, borderRadius: 5 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain img tags */}
              <img src={mark} width={216} height={269} alt="" />
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, padding: "56px 56px 52px 8px" }}>
        <div style={{ display: "flex" }}>
          <div
            style={{
              display: "flex",
              padding: "11px 20px",
              background: INK3,
              border: `2px solid ${LINE}`,
              borderRadius: 8,
              fontFamily: MONO,
              fontWeight: 500,
              fontSize: 28,
              letterSpacing: 2,
              color: CREAM,
            }}
          >
            {when}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontFamily: DISPLAY,
              fontWeight: 900,
              fontSize: size,
              lineHeight: 1.04,
              letterSpacing: -1,
              color: CREAM,
              lineClamp: 3,
            }}
          >
            {title}
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 26, fontFamily: MONO, fontWeight: 500, fontSize: 28, letterSpacing: 1.5, color: CREAM }}>
            <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: ORANGE, marginRight: 14 }} />
            <div style={{ display: "flex" }}>{place}</div>
            {price && (
              <div style={{ display: "flex", marginLeft: 22, paddingLeft: 22, borderLeft: `2px solid ${LINE}` }}>{price}</div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain img tags */}
          <img src={wordmark} width={198} height={62} alt="" />
          <div
            style={{
              display: "flex",
              padding: "13px 24px",
              background: ORANGE,
              borderRadius: 8,
              boxShadow: `0 5px 0 ${EMBER}`,
              fontFamily: DISPLAY,
              fontWeight: 900,
              fontSize: 25,
              letterSpacing: 1,
              color: INK,
            }}
          >
            SEE WHO&apos;S GOING
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the map ----

/** Street corners, as x,y on a 520 x 630 board. */
const N = {
  a: [64, 92],
  b: [214, 58],
  c: [402, 112],
  d: [118, 250],
  e: [292, 232],
  f: [470, 286],
  g: [42, 430],
  h: [212, 420],
  i: [362, 402],
  j: [488, 524],
  k: [150, 584],
  l: [332, 592],
} as const;
type Corner = keyof typeof N;

/** Main roads first, then the small streets between them. */
const MAIN: Array<[Corner, Corner]> = [["a", "b"], ["b", "c"], ["c", "f"], ["d", "e"], ["e", "f"], ["g", "h"], ["h", "i"], ["i", "j"], ["b", "e"], ["e", "h"], ["f", "i"]];
const SIDE: Array<[Corner, Corner]> = [["a", "d"], ["d", "g"], ["c", "e"], ["h", "k"], ["i", "l"], ["k", "l"], ["j", "f"]];

/** Where the pins stand: always at a junction, the biggest one live. */
const PINS: Array<{ at: Corner; r: number; live?: boolean }> = [
  { at: "e", r: 19, live: true },
  { at: "h", r: 14 },
  { at: "c", r: 14 },
  { at: "j", r: 13 },
  { at: "l", r: 13 },
];

function MapBoard() {
  return (
    <svg width={520} height={630} viewBox="0 0 520 630" xmlns="http://www.w3.org/2000/svg">
      {SIDE.map(([p, q]) => (
        <line key={p + q} x1={N[p][0]} y1={N[p][1]} x2={N[q][0]} y2={N[q][1]} stroke="#2B1F1A" strokeWidth={8} strokeLinecap="round" />
      ))}
      {MAIN.map(([p, q]) => (
        <line key={p + q} x1={N[p][0]} y1={N[p][1]} x2={N[q][0]} y2={N[q][1]} stroke="#382822" strokeWidth={16} strokeLinecap="round" />
      ))}
      {(Object.keys(N) as Corner[]).map((k) => (
        <circle key={k} cx={N[k][0]} cy={N[k][1]} r={11} fill={INK2} stroke={LINE} strokeWidth={4} />
      ))}
      {PINS.map(({ at, r, live }) => {
        const [x, y] = N[at];
        return (
          <g key={at}>
            {live && <circle cx={x} cy={y} r={r + 52} fill="none" stroke={ORANGE} strokeWidth={3} opacity={0.18} />}
            {live && <circle cx={x} cy={y} r={r + 28} fill="none" stroke={ORANGE} strokeWidth={3} opacity={0.34} />}
            <circle cx={x} cy={y + 5} r={r} fill={EMBER} />
            <circle cx={x} cy={y} r={r} fill={ORANGE} stroke={CREAM} strokeWidth={4} />
          </g>
        );
      })}
    </svg>
  );
}

/** The site's own card, for the map and every page that has no card of its own. */
export function SiteShareCard({ wordmark }: { wordmark: string }) {
  return (
    <div style={{ display: "flex", width: OG_SIZE.width, height: OG_SIZE.height, background: INK, color: CREAM, position: "relative" }}>
      <div style={{ display: "flex", position: "absolute", right: 0, top: 0, width: 520, height: OG_SIZE.height }}>
        <MapBoard />
      </div>
      <div
        style={{
          position: "absolute",
          right: 380,
          top: 0,
          width: 180,
          height: OG_SIZE.height,
          backgroundImage: `linear-gradient(to right, ${INK}, rgba(14,11,10,0))`,
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 700, padding: "64px 0 60px 72px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain img tags */}
        <img src={wordmark} width={360} height={113} alt="" />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "column", fontFamily: DISPLAY, fontWeight: 900, fontSize: 58, lineHeight: 1.06, letterSpacing: -1, color: CREAM }}>
            <div style={{ display: "flex" }}>WHAT IS ON</div>
            <div style={{ display: "flex" }}>IN LAGOS TODAY,</div>
            <div style={{ display: "flex" }}>ON ONE MAP.</div>
          </div>
          <div style={{ display: "flex", marginTop: 22, fontFamily: BODY, fontWeight: 600, fontSize: 32, color: DIM }}>Come alone, leave with friends.</div>
        </div>

        <div style={{ display: "flex" }}>
          <div
            style={{
              display: "flex",
              padding: "15px 28px",
              background: ORANGE,
              borderRadius: 8,
              boxShadow: `0 5px 0 ${EMBER}`,
              fontFamily: DISPLAY,
              fontWeight: 900,
              fontSize: 27,
              letterSpacing: 1,
              color: INK,
            }}
          >
            OPEN THE MAP
          </div>
        </div>
      </div>
    </div>
  );
}
