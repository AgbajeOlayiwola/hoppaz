import { EYE_COLORS, HAIR_COLORS, SKINS, itemById, type Item, type Look } from "./avatar";

/**
 * Draws a Look as an SVG string. A string, not JSX, so the same renderer feeds
 * React and the MapLibre markers on the night map.
 *
 * Takes a Look that has been through normalizeLook(): every colour and shape
 * below comes from the whitelists in avatar.ts, never from stored JSON.
 * Canvas is 200 x 360, head centred on (100, 78), feet on y 344.
 *
 * Style is anime-ish: one dark lineart stroke on every part, one cel-shadow
 * tone, big eyes with two highlights, pointed bangs.
 */

const INK = "#1E120D";
const MOUTH = "#4A1712";
const GOLD = "#D9A441";
const WHITE = "#FFF9F0";
const BLUSH = "#FF5A6A";
const LIP: Record<Look["lips"], string | null> = { natural: null, tint: "#C9485C", berry: "#7E2242" };

/** Lineart: the one outline every part of the figure shares. */
const LINE = `stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"`;
const THIN = `stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`;

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Blend two colours, t = 0 (all a) to 1 (all b). */
function mix(a: string, b: string, t: number) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

const isLight = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 140;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A cloud outline (afro, puffs, knots): n bumps around a circle. */
function cloud(cx: number, cy: number, r: number, n: number) {
  const pt = (i: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return `${r1(cx + r * Math.cos(a))} ${r1(cy + r * Math.sin(a))}`;
  };
  const bump = r1(r * Math.sin(Math.PI / n) * 1.15);
  let d = `M${pt(0)}`;
  for (let i = 1; i <= n; i++) d += ` A${bump} ${bump} 0 0 1 ${pt(i)}`;
  return `${d} Z`;
}

/** A four-point sparkle. */
const star = (x: number, y: number, r: number) =>
  `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`;

function patternDef(id: string, i: Item) {
  const open = `<pattern id="${id}" patternUnits="userSpaceOnUse"`;
  switch (i.pattern) {
    case "stripes":
      return `${open} width="12" height="12"><rect width="12" height="12" fill="${i.color}"/><rect width="4" height="12" fill="${i.accent}"/><rect x="7" width="1.5" height="12" fill="${shade(i.color, -0.35)}"/></pattern>`;
    case "ankara":
      return `${open} width="18" height="18"><rect width="18" height="18" fill="${i.color}"/><circle cx="9" cy="9" r="5.5" fill="${i.accent}"/><circle cx="9" cy="9" r="2.2" fill="${i.color}"/><circle cx="0" cy="0" r="2.4" fill="${i.accent}"/><circle cx="18" cy="0" r="2.4" fill="${i.accent}"/><circle cx="0" cy="18" r="2.4" fill="${i.accent}"/><circle cx="18" cy="18" r="2.4" fill="${i.accent}"/></pattern>`;
    case "adire":
      return `${open} width="20" height="20"><rect width="20" height="20" fill="${i.color}"/><circle cx="10" cy="10" r="6" fill="none" stroke="${i.accent}" stroke-width="1.4" stroke-dasharray="2 2"/><circle cx="10" cy="10" r="1.6" fill="${i.accent}"/><path d="M0 0L4 4M16 16L20 20" stroke="${i.accent}" stroke-width="1"/></pattern>`;
    case "check":
      return `${open} width="14" height="14"><rect width="14" height="14" fill="${i.color}"/><rect width="7" height="14" fill="${i.accent}" opacity=".45"/><rect width="14" height="7" fill="${i.accent}" opacity=".45"/></pattern>`;
    default:
      return "";
  }
}

/* ---- face: rounded cheeks into a soft point; the male jaw sits wider ---- */
const CHEEKS = {
  female: "C144 94 138 106 126 115 Q111 126.5 100 131 Q89 126.5 74 115 C62 106 56 94 56 76",
  male: "C144 102 143 113 135 121 Q120 130 100 131 Q80 130 65 121 C57 113 56 102 56 76",
};
const CROWN = "M56 76 Q56 26 100 26 Q144 26 144 76";
const TACHE = "M89 108 Q100 102 111 108 Q106 112 100 109.5 Q94 112 89 108 Z";

/* ---- eyes, drawn for the right eye with the outer corner at +x, mirrored for the left ---- */
const EYE = {
  open: "M-8 84 Q-8 74 0.5 74 Q9 74 10 82 Q10 96.5 0.5 96.5 Q-8 96.5 -8 84 Z",
  sharp: "M-8.5 87 Q-6 80.5 1 79.5 Q9 79 11 81.5 Q10 94.5 1 95 Q-7.5 94.5 -8.5 87 Z",
  sleepy: "M-8.5 86.5 Q0 84.5 10 85.5 Q9.5 96.5 0.5 96.8 Q-8 96.5 -8.5 86.5 Z",
};
const LASH = {
  open: "M-9.5 85 Q-9 72.6 0.5 72.6 Q9.6 72.6 11.6 80.5",
  sharp: "M-9.6 88 Q-5.5 79.4 1 78.6 Q9 77.8 12.4 80.8",
  sleepy: "M-9.6 87 Q0 83.6 11.6 85.6",
};

/* ---- the bangs every fringe style shares: pointed strands, side locks down to `lock` ---- */
const bangs = (lock: number) =>
  `M49 98 Q40 16 100 13 Q160 16 151 98 L148 ${lock} L140 78 Q138 64 131 58 Q126 52 124 44 Q120 56 113 66 Q110 52 105 42 Q101 56 93 66 Q93 52 89 43 Q84 55 74 62 Q77 55 77 48 Q66 56 62 70 L60 78 L52 ${lock} Z`;
const SPIKY =
  "M50 96 L34 64 L50 58 L36 30 L60 34 L58 8 L80 22 L94 -2 L106 18 L126 0 L130 24 L154 16 L146 42 L166 52 L150 62 L150 96 L146 106 L139 76 L131 58 L125 70 L117 50 L109 68 L99 48 L91 67 L83 49 L75 64 L70 54 L62 74 L54 106 Z";
const LOWCUT = "M53 82 Q50 22 100 20 Q150 22 147 82 L141 80 Q141 58 130 51 Q100 42 70 51 Q59 58 59 80 Z";
const CAP = "M52 90 Q46 22 100 20 Q154 22 148 90 Q142 60 128 54 Q114 48 100 50 Q86 48 72 54 Q58 60 52 90 Z";

export function avatarSvg(look: Look, opts: { uid: string; crop?: "full" | "head"; label?: string }) {
  // Pattern ids live in the page's global id space; React's useId has colons.
  const uid = opts.uid.replace(/[^\w-]/g, "");
  const female = look.frame === "female";
  const skin = SKINS[look.skin];
  const skinD = shade(skin, -0.24);
  const skinL = shade(skin, 0.14);
  const hair = HAIR_COLORS[look.hairColor].hex;
  const hairD = shade(hair, -0.32);
  // Dark hair shines cool, the anime way; lifting black toward white reads as a grey band.
  const hairL = isLight(hair) ? shade(hair, 0.55) : mix(hair, "#7C74B8", 0.4);
  const brow = isLight(hair) ? shade(hair, -0.55) : hair;
  const iris = EYE_COLORS[look.eyeColor].hex;

  const top = itemById(look.top)!;
  const bottom = itemById(look.bottom)!;
  const shoes = itemById(look.shoes)!;
  const hat = itemById(look.head);

  const defs: string[] = [];
  const paint = (i: Item, key: string) => {
    if (i.pattern === "solid") return i.color;
    const id = `${uid}-${key}`;
    defs.push(patternDef(id, i));
    return `url(#${id})`;
  };

  const out: string[] = [];
  const add = (s: string) => out.push(s);
  const coversHair = hat?.cut === "gele" || hat?.cut === "beanie";
  const face = `${CROWN} ${CHEEKS[look.frame]} Z`;

  /** A limb drawn as a fat stroke, with its outline as a fatter ink stroke under it. */
  const limb = (d: string, fill: string, w: number) =>
    `<path d="${d}" stroke="${INK}" stroke-width="${w + 5}" stroke-linecap="round" fill="none"/><path d="${d}" stroke="${fill}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;

  /* ---- floor shadow ---- */
  if (opts.crop !== "head") add(`<ellipse cx="100" cy="346" rx="52" ry="6" fill="#000" opacity=".28"/>`);

  /* ---- hair, the layer behind the body (long styles) ---- */
  const h = look.hair;
  if (h === "long") {
    add(`<path d="M48 64 Q46 12 100 10 Q154 12 152 64 L158 196 L146 188 L138 202 L126 190 L114 200 L100 190 L86 200 L74 190 L62 202 L54 188 L42 196 Z" fill="${hairD}" ${LINE}/>`);
  } else if (h === "curls") {
    add(`<path d="M50 56 Q48 10 100 8 Q152 10 150 56 Q164 76 152 96 Q166 116 154 136 Q168 156 156 176 Q166 198 146 206 Q132 196 120 206 Q110 198 100 206 Q90 198 80 206 Q68 196 54 206 Q34 198 44 176 Q32 156 46 136 Q34 116 48 96 Q36 76 50 56 Z" fill="${hairD}" ${LINE}/>`);
    add(`<path d="M42 120 q8 -6 4 -14 M158 120 q-8 -6 -4 -14 M44 162 q8 -6 4 -14 M156 162 q-8 -6 -4 -14" stroke="${hairL}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>`);
  } else if (h === "braids" || h === "locs") {
    add(`<path d="M52 78 Q100 2 148 78 L152 164 L48 164 Z" fill="${hairD}" ${LINE}/>`);
  } else if (h === "twintails") {
    const tail = `<path d="M66 34 Q30 36 26 96 Q22 140 40 178 Q42 134 56 100 Q66 72 72 44 Z" fill="${hair}" ${LINE}/><path d="M42 70 Q34 100 38 140" stroke="${hairL}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"/><path d="M60 30 l10 4 l-3 10 l-10 -4 Z" fill="${hairD}" ${LINE}/>`;
    add(tail + `<g transform="translate(200 0) scale(-1 1)">${tail}</g>`);
  } else if (h === "ponytail") {
    add(`<path d="M124 18 Q170 16 172 66 Q174 118 152 164 Q156 116 146 84 Q138 56 120 40 Z" fill="${hair}" ${LINE}/><path d="M160 46 Q166 80 160 120" stroke="${hairL}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"/>`);
    add(`<path d="M118 14 l14 -2 l4 14 l-14 3 Z" fill="${hairD}" ${LINE}/>`);
  }

  /* ---- legs, bottoms, shoes ---- */
  const dress = top.cut === "dress";
  add(`<rect x="74" y="236" width="20" height="98" rx="9" fill="${skin}" ${LINE}/><rect x="106" y="236" width="20" height="98" rx="9" fill="${skin}" ${LINE}/>`);
  if (!dress) {
    const b = paint(bottom, "b");
    if (bottom.cut === "trousers" || bottom.cut === "cargo") {
      add(`<path d="M67 238 L133 238 L131 330 L103 330 L100 268 L97 330 L69 330 Z" fill="${b}" ${LINE}/>`);
      if (bottom.cut === "cargo") {
        add(`<rect x="69" y="276" width="13" height="18" rx="2" fill="${bottom.accent}" ${THIN}/><rect x="118" y="276" width="13" height="18" rx="2" fill="${bottom.accent}" ${THIN}/>`);
      } else {
        add(`<path d="M71 250 L70.5 328 M129 250 L129.5 328" stroke="${bottom.accent}" stroke-width="2.5" opacity=".6"/>`);
      }
    } else if (bottom.cut === "shorts") {
      add(`<path d="M67 238 L133 238 L132 290 L103 290 L100 264 L97 290 L68 290 Z" fill="${b}" ${LINE}/>`);
    } else {
      add(`<path d="M67 238 L133 238 L144 302 L56 302 Z" fill="${b}" ${LINE}/>`);
    }
  }
  const foot = (x: number, flip: boolean) => {
    const toe = flip ? 1 : -1;
    switch (shoes.cut) {
      case "slides":
        return `<ellipse cx="${x + 16}" cy="338" rx="13" ry="7" fill="${skin}" ${THIN}/><rect x="${x + toe * 3}" y="341" width="34" height="5" rx="2.5" fill="${shoes.accent}" ${THIN}/><rect x="${x + 4}" y="330" width="24" height="9" rx="4.5" fill="${shoes.color}" ${LINE}/>`;
      case "boots":
        return `<path d="M${x + 6} 306 h22 v26 q${toe * 8} 0 ${toe * 8} 8 v4 h-38 v-6 q0 -6 8 -6 Z" transform="translate(${flip ? 0 : 4} 0)" fill="${shoes.color}" ${LINE}/><rect x="${x + (flip ? 0 : 2)}" y="342" width="36" height="4" rx="2" fill="${shoes.accent}" ${THIN}/>`;
      case "loafers":
        return `<rect x="${x + toe * 2}" y="330" width="34" height="13" rx="6.5" fill="${shoes.color}" ${LINE}/><path d="M${x + 8} 334 h16" stroke="${shoes.accent}" stroke-width="2.5" stroke-linecap="round"/><rect x="${x + toe * 2}" y="341" width="34" height="4" rx="2" fill="${shoes.accent}" ${THIN}/>`;
      default:
        return `<rect x="${x + toe * 3}" y="325" width="34" height="18" rx="9" fill="${shoes.color}" ${LINE}/><rect x="${x + toe * 3}" y="338" width="34" height="6" rx="3" fill="${shoes.accent}" ${THIN}/><path d="M${x + 8} 331 l5 -2 M${x + 15} 331 l5 -2" stroke="${shoes.accent}" stroke-width="2" stroke-linecap="round"/>`;
    }
  };
  add(foot(66, false) + foot(102, true));

  /* ---- arms, then sleeves over them; shoulders follow the frame ---- */
  const sw = female ? 31 : 37;
  const L = 100 - sw, R = 100 + sw;
  const arm = (y: number) => (y - 156) * 0.145;
  add(limb(`M${L + 2} 156 L${L - 9} 232 M${R - 2} 156 L${R + 9} 232`, skin, 15));
  add(`<circle cx="${L - 10}" cy="238" r="9" fill="${skin}" ${LINE}/><circle cx="${R + 10}" cy="238" r="9" fill="${skin}" ${LINE}/>`);
  const t = paint(top, "t");
  const sleeve = (len: number, w: number) => limb(`M${L + 2} 156 L${r1(L + 2 - arm(len))} ${len} M${R - 2} 156 L${r1(R - 2 + arm(len))} ${len}`, t, w);
  if (top.cut === "kaftan") {
    add(`<path d="M${L + 4} 150 L${L - 20} 214 L${L + 6} 220 L${L + 16} 180 Z M${R - 4} 150 L${R + 20} 214 L${R - 6} 220 L${R - 16} 180 Z" fill="${t}" ${LINE}/>`);
  } else if (top.cut === "tee") add(sleeve(192, 21));
  else if (top.cut === "dress") add(sleeve(174, 21));
  else {
    add(sleeve(226, 20));
    const cx = r1(L + 2 - arm(228)), cx2 = r1(R - 2 + arm(228));
    add(`<path d="M${cx} 225 L${cx - 0.6} 231 M${cx2} 225 L${cx2 + 0.6} 231" stroke="${top.accent}" stroke-width="20" stroke-linecap="butt"/>`);
  }

  /* ---- neck, torso ---- */
  add(`<rect x="91" y="108" width="18" height="44" rx="7" fill="${skin}" ${LINE}/><path d="M91.5 116 Q100 134 108.5 116 L108.5 132 Q100 140 91.5 132 Z" fill="${skinD}"/>`);
  const torso =
    top.cut === "kaftan" ? `M${L - 2} 150 Q100 138 ${R + 2} 150 L142 302 L58 302 Z`
    : dress ? `M${L} 150 Q100 138 ${R} 150 Q${R - 8} 196 ${R - 4} 214 L148 306 L52 306 L${L + 4} 214 Q${L + 8} 196 ${L} 150 Z`
    : look.body === "curvy" ? `M${L} 150 Q100 138 ${R} 150 Q${R - 11} 198 ${R - 2} 246 L${L + 2} 246 Q${L + 11} 198 ${L} 150 Z`
    : `M${L} 150 Q100 138 ${R} 150 L${R - 3} 246 L${L + 3} 246 Z`;
  add(`<path d="${torso}" fill="${t}" ${LINE}/>`);
  const tD = shade(top.color, -0.22);
  switch (top.cut) {
    case "tee":
      add(`<path d="M86 146 Q100 160 114 146" stroke="${top.accent}" stroke-width="4" fill="none" stroke-linecap="round"/>`);
      break;
    case "shirt":
      add(`<path d="M100 160 V246" stroke="${tD}" stroke-width="2"/>`);
      add([172, 192, 212, 232].map((y) => `<circle cx="100" cy="${y}" r="2.2" fill="${top.accent}"/>`).join(""));
      add(`<path d="M88 145 L100 162 L94 170 L80 150 Z M112 145 L100 162 L106 170 L120 150 Z" fill="${top.pattern === "solid" ? tD : top.accent}" ${THIN}/>`);
      break;
    case "hoodie":
      add(`<path d="M74 150 Q100 182 126 150 Q118 138 100 140 Q82 138 74 150 Z" fill="${tD}" ${THIN}/>`);
      add(`<path d="M93 162 L91 188 M107 162 L109 188" stroke="${top.accent}" stroke-width="2.5" stroke-linecap="round"/>`);
      add(`<path d="M80 212 L120 212 L116 240 L84 240 Z" fill="${tD}" ${THIN}/>`);
      break;
    case "kaftan":
      add(`<path d="M88 146 L100 176 L112 146" stroke="${top.accent}" stroke-width="3.5" fill="none" stroke-linejoin="round"/>`);
      add([186, 198, 210].map((y) => `<circle cx="100" cy="${y}" r="2.4" fill="${top.accent}"/>`).join(""));
      add(`<path d="M60 296 L140 296" stroke="${top.accent}" stroke-width="3"/>`);
      break;
    case "jacket":
      add(`<path d="M89 147 L111 147 L107 246 L93 246 Z" fill="${top.accent}" ${THIN}/>`);
      add(`<path d="M88 147 L100 190 L92 196 L${L + 12} 152 Z M112 147 L100 190 L108 196 L${R - 12} 152 Z" fill="${tD}" ${THIN}/>`);
      add(`<circle cx="108" cy="214" r="2.6" fill="${top.accent}"/><circle cx="108" cy="230" r="2.6" fill="${top.accent}"/>`);
      break;
    case "dress":
      add(`<path d="M${L + 4} 214 Q100 220 ${R - 4} 214" stroke="${top.accent}" stroke-width="5" fill="none"/>`);
      add(`<path d="M86 146 Q100 162 114 146" stroke="${top.accent}" stroke-width="3" fill="none"/>`);
      break;
  }
  if (h === "braids" || h === "locs") {
    const locs = h === "locs";
    const w = locs ? 9 : 6;
    const end = locs ? 186 : 204;
    add(
      [54, 62, 138, 146]
        .map((x) => {
          const dx = x < 100 ? -4 : 4;
          const d = `M${x} 92 Q${x + dx} 140 ${x - dx / 2} ${end}`;
          const ticks = [110, 126, 142, 158, 174].filter((y) => y < end - 6)
            .map((y) => {
              const xx = r1(x + dx * 0.55 * Math.sin(((y - 92) / (end - 92)) * Math.PI));
              return locs ? `M${xx - 3.5} ${y} h7` : `M${xx - 2.5} ${y - 2} l2.5 3 l2.5 -3`;
            }).join(" ");
          return limb(d, hair, w) + `<path d="${ticks}" stroke="${hairL}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".7"/>`;
        })
        .join("")
    );
  }
  if (look.neck === "chain") {
    add(`<path d="M84 148 Q100 184 116 148" stroke="${GOLD}" stroke-width="3" fill="none"/><circle cx="100" cy="175" r="4.5" fill="${GOLD}" ${THIN}/>`);
  }

  /* ---- hair, the layer behind the head ---- */
  if (h === "afro") {
    add(`<path d="${cloud(100, 58, 60, 16)}" fill="${hair}" ${LINE}/>`);
    add(`<path d="M52 40 Q56 30 64 24 M70 16 Q76 12 84 10 M64 34 Q68 30 74 28" stroke="${hairL}" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".6"/>`);
  }
  if (h === "puff") add(`<path d="${cloud(100, 10, 26, 10)}" fill="${hair}" ${LINE}/><path d="M86 2 Q90 -6 98 -9" stroke="${hairL}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"/>`);
  if (h === "twinpuffs") {
    add([58, 142].map((x) => `<path d="${cloud(x, 24, 22, 9)}" fill="${hair}" ${LINE}/><path d="M${x - 12} 16 Q${x - 8} 8 ${x} 6" stroke="${hairL}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"/>`).join(""));
  }
  if (h === "bun") add(`<circle cx="100" cy="6" r="17" fill="${hair}" ${LINE}/><path d="M88 0 Q100 -8 112 0 M90 10 Q100 4 110 10" stroke="${hairD}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M90 -4 Q94 -9 100 -10" stroke="${hairL}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`);
  if (h === "bob") {
    add(`<path d="M44 72 Q42 10 100 8 Q158 10 156 72 L158 120 Q150 130 138 124 L62 124 Q50 130 42 120 Z" fill="${hairD}" ${LINE}/>`);
  }

  /* ---- ears, then the face over them ---- */
  add(`<ellipse cx="55" cy="86" rx="7" ry="10" fill="${skin}" ${LINE}/><ellipse cx="145" cy="86" rx="7" ry="10" fill="${skin}" ${LINE}/>`);
  add(`<path d="M56 81 Q52 86 56 91 M144 81 Q148 86 144 91" stroke="${skinD}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);
  defs.push(`<clipPath id="${uid}-face"><path d="${face}"/></clipPath>`);
  add(`<path d="${face}" fill="${skin}"/>`);
  // Cel shading: one shadow tone down the far cheek, a soft light on the brow.
  add(`<g clip-path="url(#${uid}-face)"><path d="M146 70 Q140 104 118 126 L150 140 Z" fill="${skinD}" opacity=".3"/><ellipse cx="86" cy="46" rx="18" ry="8" fill="${skinL}" opacity=".35"/></g>`);

  /* ---- hair front: fill, cel shadow on the forehead, lineart ---- */
  let front = "";
  let fringe = true; // whether the front throws a shadow on the forehead
  switch (h) {
    case "lowcut":
    case "puff":
    case "bantu":
    case "cornrows":
      front = LOWCUT;
      break;
    case "twinpuffs":
      front = LOWCUT;
      break;
    case "fade":
      front = "M62 58 Q60 4 100 2 Q140 4 138 58 Q122 50 100 50 Q78 50 62 58 Z";
      break;
    case "afro":
      front = "M52 88 Q46 28 100 20 Q154 28 148 88 Q146 64 136 58 Q130 48 118 50 Q110 43 100 46 Q90 43 82 50 Q70 48 64 58 Q54 64 52 88 Z";
      break;
    case "braids":
    case "locs":
      front = CAP;
      break;
    case "long":
      front = bangs(150);
      break;
    case "curls":
      front = bangs(128);
      break;
    case "ponytail":
    case "bun":
    case "twintails":
      front = bangs(106);
      break;
    case "bob":
      front = "M46 78 Q44 12 100 10 Q156 12 154 78 L152 118 Q146 126 139 120 L138 72 Q137 64 130 63 L126 66 L121 61 L114 66 L107 61 L100 66 L93 61 L86 66 L79 61 L74 66 L70 63 Q63 64 62 72 L61 120 Q54 126 48 118 Z";
      break;
    case "spiky":
      front = SPIKY;
      break;
    default:
      fringe = false;
  }
  if (coversHair) front = "";
  if (front && fringe) {
    add(`<g clip-path="url(#${uid}-face)"><path d="${front}" transform="translate(1.5 5)" fill="${skinD}"/></g>`);
  }
  // The face outline goes on after the forehead shadow so the line stays crisp.
  add(`<path d="${face}" fill="none" ${LINE}/>`);

  if (front) {
    if (h === "fade") {
      add(`<path d="M57 80 Q55 36 70 34 L130 34 Q145 36 143 80 L139 78 Q137 60 128 56 L72 56 Q63 60 61 78 Z" fill="${hair}" opacity=".5"/>`);
      add(`<path d="M61 78 Q63 60 72 56 M139 78 Q137 60 128 56" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".6"/>`);
    }
    if (h === "afro") {
      add(`<path d="${front}" fill="${hair}"/>`);
      add(`<path d="M148 88 Q146 64 136 58 Q130 48 118 50 Q110 43 100 46 Q90 43 82 50 Q70 48 64 58 Q54 64 52 88" fill="none" ${LINE}/>`);
    } else {
      add(`<path d="${front}" fill="${hair}" ${LINE}/>`);
    }
  }

  /* ---- hair details: shade strands, highlight ring, textures ---- */
  const shine = (d: string, w = 3) => add(`<path d="${d}" stroke="${hairL}" stroke-width="${w}" fill="none" stroke-linecap="round" opacity=".75"/>`);
  if (front) {
    switch (h) {
      case "long":
      case "curls":
      case "ponytail":
      case "bun":
      case "twintails":
        add(`<path d="M124 44 Q122 32 114 24 M105 42 Q104 32 98 24 M89 43 Q86 34 80 28 M146 104 Q148 70 140 40 M54 104 Q52 70 60 40" stroke="${hairD}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);
        add(`<path d="M66 38 Q82 28 100 27 Q118 28 134 38 L128 37 L124 41 L118 35.5 L112 39 L106 34 L100 38 L94 34 L88 39 L82 35.5 L76 41 L72 37 Z" fill="${hairL}" opacity=".5"/>`);
        if (h === "long") add(`<path d="M146 112 Q150 130 148 146 M54 112 Q50 130 52 146" stroke="${hairD}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
        if (h === "curls") add(`<path d="M150 104 q-6 6 -2 12 M50 104 q6 6 2 12" stroke="${hairD}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
        break;
      case "spiky":
        add(`<path d="M117 50 Q116 34 110 22 M99 48 Q98 32 94 18 M83 49 Q80 38 72 30 M131 58 Q134 44 140 36" stroke="${hairD}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);
        add(`<path d="M62 40 L74 30 L80 36 L92 26 L98 32 L110 24 L116 30 L130 26 L126 34 L114 36 L108 40 L96 36 L90 42 L78 38 L72 44 Z" fill="${hairL}" opacity=".55"/>`);
        break;
      case "bob":
        add(`<path d="M70 62 Q72 44 76 30 M86 62 Q86 40 90 24 M114 62 Q114 40 110 24 M130 62 Q128 44 124 30" stroke="${hairD}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);
        add(`<path d="M62 38 Q80 24 100 23 Q120 24 138 38 L132 36 L126 40 L118 34 L110 38 L100 33 L90 38 L82 34 L74 40 L68 36 Z" fill="${hairL}" opacity=".5"/>`);
        break;
      case "braids":
      case "locs":
        add(`<path d="M100 21 V49" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`);
        add(
          [-30, -18, -7, 7, 18, 30]
            .map((dx) => `<path d="M${100 + dx * 0.25} 23 Q${100 + dx * 1.1} 34 ${100 + dx * 1.35} ${52 - Math.abs(dx) * 0.05}" stroke="${hairD}" stroke-width="2" fill="none" stroke-linecap="round"/>`)
            .join("")
        );
        shine("M70 34 Q80 26 92 24", 2.5);
        break;
      case "bantu":
        add(
          [[70, 40, 11], [100, 26, 12], [130, 40, 11], [84, 30, 8], [116, 30, 8]]
            .map(([x, y, r]) => `<path d="${cloud(x, y, r, 7)}" fill="${hair}" ${LINE}/><path d="M${x - r / 2} ${y + 1} Q${x - r / 3} ${y - r / 2} ${x + r / 3} ${y - r / 3} Q${x + r / 2} ${y + r / 4} ${x} ${y + 1}" stroke="${hairL}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".8"/>`)
            .join("")
        );
        break;
      case "cornrows":
        add(
          [70, 82, 94, 106, 118, 130]
            .map((x) => `<path d="M${x} 52 Q${x + (x - 100) * 0.1} 38 ${x + (x - 100) * 0.3} 26" stroke="${hairD}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M${x + 1.5} 50 Q${x + 1.5 + (x - 100) * 0.1} 38 ${x + 1.5 + (x - 100) * 0.3} 28" stroke="${hairL}" stroke-width="1.2" fill="none" stroke-dasharray="3 3" opacity=".8"/>`)
            .join("")
        );
        break;
      case "fade":
        add(`<path d="M68 52 Q66 10 84 6" stroke="${hairD}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);
        shine("M76 20 Q86 10 100 9", 3);
        break;
      default:
        // low cut and the puffs: a close crop with a clean highlight
        shine("M70 34 Q84 26 98 25", 3);
        add(`<path d="M76 46 l2 -3 M88 43 l2 -3 M112 43 l-2 -3 M124 46 l-2 -3" stroke="${hairD}" stroke-width="1.6" stroke-linecap="round"/>`);
        if (h === "twinpuffs") add(`<path d="M100 21 V44" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`);
    }
  }
  if (h === "bald" && !coversHair) {
    add(`<ellipse cx="84" cy="40" rx="12" ry="5" fill="#fff" opacity=".16" transform="rotate(-20 84 40)"/>`);
  }

  /* ---- brows over the fringe, the anime way ---- */
  const browD = female ? "M-8 66 Q1 61 10.5 64.5" : "M-9 66.5 Q1 61.5 11.5 65";
  const browCool = female ? "M-8 67.5 Q1 63 10.5 63.5" : "M-9 68.5 Q1 63.5 11.5 63.5";
  const bd = look.eyes === "sharp" ? browCool : browD;
  const bw = female ? 2.6 : 4.4;
  add(`<g fill="none" stroke="${brow}" stroke-width="${bw}" stroke-linecap="round"><path d="${bd}" transform="translate(118 0)"/><path d="${bd}" transform="translate(82 0) scale(-1 1)"/></g>`);

  /* ---- eyes ---- */
  const irisD = shade(iris, -0.45);
  const irisL = shade(iris, 0.45);
  const clip = (k: keyof typeof EYE) => {
    const id = `${uid}-e${k}`;
    if (!defs.some((d) => d.includes(`id="${id}"`))) defs.push(`<clipPath id="${id}"><path d="${EYE[k]}"/></clipPath>`);
    return id;
  };
  const flicks = female ? `<path d="M10.8 77.5 L15.2 73.8 M11.8 81.5 L16.2 79.6" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` : "";
  const lid = (k: keyof typeof EYE, sparkle = false) => {
    const cy = k === "sharp" ? 87.5 : 87;
    const glint = sparkle
      ? `<path d="${star(3.6, 81.5, 4.6)}" fill="#fff"/><path d="${star(-2.6, 91.5, 2.4)}" fill="#fff"/>`
      : k === "sleepy"
        ? `<circle cx="3.4" cy="88.5" r="2.2" fill="#fff"/>`
        : `<ellipse cx="3.4" cy="${cy - 5.5}" rx="2.9" ry="3.3" fill="#fff"/><circle cx="-2.6" cy="${cy + 4.6}" r="1.4" fill="#fff"/>`;
    return (
      `<path d="${EYE[k]}" fill="${WHITE}"/>` +
      `<g clip-path="url(#${clip(k)})">` +
      `<ellipse cx="0.8" cy="${cy}" rx="7" ry="9.6" fill="${iris}" stroke="${irisD}" stroke-width="1.2"/>` +
      `<ellipse cx="0.8" cy="${cy - 6}" rx="8" ry="5" fill="${irisD}" opacity=".75"/>` +
      `<ellipse cx="0.8" cy="${cy + 0.5}" rx="3.4" ry="5.4" fill="${shade(iris, -0.7)}"/>` +
      `<ellipse cx="0.8" cy="${cy + 6.2}" rx="4.4" ry="2.4" fill="${irisL}" opacity=".85"/>` +
      `<path d="M-9 76 Q1 70 12 77 L12 79 Q1 74 -9 80 Z" fill="${shade(skin, -0.5)}" opacity=".35"/>` +
      `</g>` +
      glint +
      `<path d="${LASH[k]}" stroke="${INK}" stroke-width="${female ? 4.2 : 3.6}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
      (k === "sleepy" ? `<path d="M-7 80.5 Q1 78 9.5 80.5" stroke="${INK}" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".6"/>` : "") +
      `<path d="M-5 ${k === "sharp" ? 95.6 : 97.2} Q1.5 ${k === "sharp" ? 97 : 98.8} 7 96.4" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round"/>` +
      flicks
    );
  };
  const arc = (d: string) => `<path d="${d}" stroke="${INK}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`;
  const happy = arc("M-9 91 Q0.5 76 10.5 90") + (female ? `<path d="M10 89.5 L14.6 88" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` : "");
  const closed = arc("M-9 86 Q0.5 94.5 10.5 86") + (female ? `<path d="M10.2 86.4 L14.8 83.6 M7 89.6 L10.4 92.4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>` : "");
  const eyeR = { open: lid("open"), sparkle: lid("open", true), sharp: lid("sharp"), sleepy: lid("sleepy"), happy, closed, wink: happy }[look.eyes];
  const eyeL = look.eyes === "wink" ? lid("open") : eyeR;
  add(`<g transform="translate(82 0) scale(-1 1)">${eyeL}</g><g transform="translate(118 0)">${eyeR}</g>`);

  /* ---- blush, nose ---- */
  add(`<ellipse cx="73" cy="104" rx="7.5" ry="3.6" fill="${BLUSH}" opacity=".32"/><ellipse cx="127" cy="104" rx="7.5" ry="3.6" fill="${BLUSH}" opacity=".32"/>`);
  add(`<path d="M69 105.5 l2.5 -3 M73 105.5 l2.5 -3 M125 105.5 l2.5 -3 M129 105.5 l2.5 -3" stroke="${shade(BLUSH, -0.2)}" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>`);
  add(`<path d="M100.5 98 Q98.6 101.6 101 102.6" stroke="${shade(skin, -0.45)}" stroke-width="2" fill="none" stroke-linecap="round"/>`);

  /* ---- facial hair ---- */
  const jaw = `M144 78 ${CHEEKS[look.frame]} C58 98 62 106 72 110 Q86 103 100 105 Q114 103 128 110 C138 106 142 98 144 78 Z`;
  if (look.beard === "full") add(`<path d="${jaw}" fill="${hair}" ${LINE}/>`);
  if (look.beard === "stubble") add(`<path d="${jaw}" fill="${hair}" opacity=".3"/>`);
  if (look.beard === "goatee") add(`<path d="M93 119 Q100 116.5 107 119 Q106 128 100 130 Q94 128 93 119 Z" fill="${hair}" ${THIN}/>`);
  if (look.beard === "moustache" || look.beard === "goatee" || look.beard === "full") add(`<path d="${TACHE}" fill="${hair}" ${THIN}/>`);

  /* ---- mouth ---- */
  const lip = LIP[look.lips];
  const ml = lip ? shade(lip, -0.35) : MOUTH;
  // Tinted lips: one soft filled shape (fuller on the female frame) under the mouth line.
  const lw = female ? 6.6 : 5.6, lh = female ? 4.4 : 3.2;
  const lipFill = (cx: number) =>
    lip ? `<path d="M${cx - lw} 113 Q${cx - lw / 2} ${113 - lh * 0.75} ${cx} ${113 - lh * 0.45} Q${cx + lw / 2} ${113 - lh * 0.75} ${cx + lw} 113 Q${cx + lw / 2} ${113 + lh} ${cx} ${113 + lh} Q${cx - lw / 2} ${113 + lh} ${cx - lw} 113 Z" fill="${lip}"/><ellipse cx="${cx + 1.5}" cy="${114.4 + lh / 3}" rx="1.8" ry=".9" fill="#fff" opacity=".45"/>` : "";
  const openLine = lip ? `stroke="${lip}" stroke-width="2.6"` : `stroke="${MOUTH}" stroke-width="2.2"`;
  switch (look.mouth) {
    case "grin":
      add(`<path d="M90.5 111 Q100 110 109.5 111 Q108 121.5 100 121.5 Q92 121.5 90.5 111 Z" fill="${MOUTH}" ${openLine} stroke-linejoin="round"/><path d="M92 111.6 Q100 110.8 108 111.6 Q107 114.6 100 114.6 Q93 114.6 92 111.6 Z" fill="#fff"/>`);
      break;
    case "laugh":
      add(`<path d="M89 109.5 Q100 107.5 111 109.5 Q109 124 100 124 Q91 124 89 109.5 Z" fill="${MOUTH}" ${openLine} stroke-linejoin="round"/><ellipse cx="100" cy="120.4" rx="5.4" ry="3" fill="#E36A78"/>`);
      break;
    case "smirk":
      add(lipFill(101) + `<path d="M94 114 Q102 116 107 110.5" stroke="${ml}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`);
      break;
    case "oh":
      add(`<ellipse cx="100" cy="115" rx="3.6" ry="4.6" fill="${MOUTH}" ${openLine}/>`);
      break;
    case "cat":
      add(lipFill(100) + `<path d="M92.5 112.5 Q96.2 117.4 100 113 Q103.8 117.4 107.5 112.5" stroke="${ml}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
      break;
    case "tongue":
      add(lipFill(100) + `<path d="M96.5 114.4 Q96.5 121.6 100.4 121.6 Q104.2 121.6 104.2 114.4 Z" fill="#E36A78" ${THIN}/><path d="M100.4 115.4 V118.6" stroke="#B8475A" stroke-width="1.2" stroke-linecap="round"/><path d="M93 112.5 Q100 117 107 112.5" stroke="${ml}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
      break;
    default:
      add(lipFill(100) + `<path d="M93.5 112.5 Q100 117.5 106.5 112.5" stroke="${ml}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`);
  }

  /* ---- glasses ---- */
  const arms = `<path d="M70 84 L56 81 M130 84 L144 81" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
  const glass = `fill="#F5EBDD" fill-opacity=".14" stroke="${INK}" stroke-width="3"`;
  if (look.glasses === "round") {
    add(`<circle cx="82" cy="86" r="13" ${glass}/><circle cx="118" cy="86" r="13" ${glass}/><path d="M95 84 Q100 79 105 84" stroke="${INK}" stroke-width="2.5" fill="none"/>${arms}`);
  } else if (look.glasses === "square") {
    add(`<rect x="68" y="75" width="28" height="22" rx="4" ${glass}/><rect x="104" y="75" width="28" height="22" rx="4" ${glass}/><path d="M96 83 H104" stroke="${INK}" stroke-width="2.5"/>${arms}`);
  } else if (look.glasses === "shades") {
    add(`<rect x="66" y="77" width="31" height="19" rx="8" fill="#120D0B" ${THIN}/><rect x="103" y="77" width="31" height="19" rx="8" fill="#120D0B" ${THIN}/><path d="M97 82 H103" stroke="#120D0B" stroke-width="3"/><path d="M72 82 L79 79.5" stroke="#FF4D00" stroke-width="2.2" stroke-linecap="round"/>${arms}`);
  }

  /* ---- headwear, scaled to the bigger anime head ---- */
  if (hat) {
    const hp = paint(hat, "h");
    const hD = shade(hat.color, -0.2);
    let s = "";
    switch (hat.cut) {
      case "cap":
        s = `<ellipse cx="148" cy="58" rx="16" ry="5" fill="${hD}"/><path d="M59 68 Q57 22 100 20 Q143 22 141 68 Z" fill="${hp}"/><path d="M59 68 Q100 60 141 68 L141 74 Q100 66 59 74 Z" fill="${hat.accent}"/><path d="M90 66 Q100 52 110 66 Z" fill="${hD}"/>`;
        break;
      case "bucket":
        s = `<path d="M64 58 Q66 20 100 18 Q134 20 136 58 Z" fill="${hp}"/><path d="M64 52 Q100 46 136 52 L136 58 Q100 52 64 58 Z" fill="${hat.accent}"/><path d="M42 66 Q100 44 158 66 Q162 74 150 73 Q100 56 50 73 Q38 74 42 66 Z" fill="${hD}"/>`;
        break;
      case "beanie":
        s = `<path d="M57 66 Q55 10 100 8 Q145 10 143 66 Z" fill="${hp}"/><path d="M55 56 Q100 48 145 56 L145 72 Q100 64 55 72 Z" fill="${hD}"/>` +
          [70, 82, 94, 106, 118, 130].map((x) => `<path d="M${x} 56 V67" stroke="${hat.color}" stroke-width="2"/>`).join("");
        break;
      case "fila":
        s = `<g transform="rotate(-8 100 44)"><path d="M60 62 Q58 20 100 12 Q134 8 148 30 L150 50 Q142 44 140 62 Z" fill="${hp}"/><path d="M60 62 Q100 54 140 62 L140 68 Q100 60 60 68 Z" fill="${hD}"/><path d="M146 30 L162 40 L150 50 Z" fill="${hD}"/></g>`;
        break;
      case "gele":
        s = `<ellipse cx="72" cy="22" rx="36" ry="17" transform="rotate(-22 72 22)" fill="${hD}"/><ellipse cx="130" cy="16" rx="38" ry="19" transform="rotate(20 130 16)" fill="${hD}"/>` +
          `<path d="M56 70 Q50 14 100 6 Q150 14 144 70 Z" fill="${hp}"/><ellipse cx="100" cy="12" rx="24" ry="14" fill="${hat.accent}"/><path d="M56 62 Q100 50 144 62 L144 70 Q100 58 56 70 Z" fill="${hat.accent}"/>`;
        break;
    }
    // The hats were drawn for a narrower head: widen around x 100, lift a touch.
    add(`<g transform="matrix(1.1 0 0 1.04 -10 -5)" stroke="${INK}" stroke-width="2.3" stroke-linejoin="round">${s}</g>`);
  }

  if (look.ears === "hoops") add(`<circle cx="54" cy="103" r="6" stroke="${GOLD}" stroke-width="2.5" fill="none"/><circle cx="146" cy="103" r="6" stroke="${GOLD}" stroke-width="2.5" fill="none"/>`);
  if (look.ears === "studs") add(`<circle cx="54" cy="97" r="2.8" fill="${GOLD}" ${THIN}/><circle cx="146" cy="97" r="2.8" fill="${GOLD}" ${THIN}/>`);

  const box = opts.crop === "head" ? "26 -16 148 148" : "0 -12 200 364";
  const a11y = opts.label ? `role="img" aria-label="${opts.label.replace(/[^\w\s'-]/g, "")}"` : `aria-hidden="true"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" ${a11y} style="display:block;width:100%;height:100%"><defs>${defs.join("")}</defs>${out.join("")}</svg>`;
}
