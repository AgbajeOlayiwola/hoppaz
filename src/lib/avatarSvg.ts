import { HAIR_COLORS, SKINS, itemById, type Item, type Look } from "./avatar";

/**
 * Draws a Look as an SVG string. A string, not JSX, so the same renderer feeds
 * React and the MapLibre markers on the night map.
 *
 * Takes a Look that has been through normalizeLook(): every colour and shape
 * below comes from the whitelists in avatar.ts, never from stored JSON.
 * Canvas is 200 x 360, head centred on (100, 78), feet on y 344.
 */

const INK = "#1A1210";
const MOUTH = "#2A120C";
const GOLD = "#D9A441";

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const isLight = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 140;
};

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

const TORSO = {
  straight: "M64 150 Q100 138 136 150 L133 246 L67 246 Z",
  curvy: "M66 150 Q100 138 134 150 Q124 198 131 246 L69 246 Q76 198 66 150 Z",
};
const KAFTAN = "M62 150 Q100 138 138 150 L142 302 L58 302 Z";
const DRESS = "M66 150 Q100 138 134 150 Q126 196 130 214 L148 306 L52 306 L70 214 Q74 196 66 150 Z";
const JAW = "M60 78 Q60 130 100 131 Q140 130 140 78 Q138 102 126 105 Q114 98 100 100 Q86 98 74 105 Q62 102 60 78 Z";
const TACHE = "M85 105 Q100 97 115 105 Q108 110 100 106 Q92 110 85 105 Z";

export function avatarSvg(look: Look, opts: { uid: string; crop?: "full" | "head"; label?: string }) {
  // Pattern ids live in the page's global id space; React's useId has colons.
  const uid = opts.uid.replace(/[^\w-]/g, "");
  const skin = SKINS[look.skin];
  const skinD = shade(skin, -0.22);
  const hair = HAIR_COLORS[look.hairColor].hex;
  const brow = isLight(hair) ? shade(hair, -0.55) : hair;

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

  /* ---- floor shadow ---- */
  if (opts.crop !== "head") add(`<ellipse cx="100" cy="346" rx="52" ry="6" fill="#000" opacity=".28"/>`);

  /* ---- hair, back layer ---- */
  if (look.hair === "afro") add(`<circle cx="100" cy="64" r="60" fill="${hair}"/>`);
  if (look.hair === "puff") add(`<circle cx="100" cy="18" r="26" fill="${hair}"/>`);
  if (look.hair === "braids" || look.hair === "locs") {
    add(`<path d="M56 78 Q100 6 144 78 L148 160 L52 160 Z" fill="${shade(hair, -0.15)}"/>`);
  }

  /* ---- legs, bottoms, shoes ---- */
  const dress = top.cut === "dress";
  add(`<rect x="74" y="236" width="20" height="98" rx="9" fill="${skin}"/><rect x="106" y="236" width="20" height="98" rx="9" fill="${skin}"/>`);
  if (!dress) {
    const b = paint(bottom, "b");
    if (bottom.cut === "trousers" || bottom.cut === "cargo") {
      add(`<path d="M67 238 L133 238 L131 330 L103 330 L100 268 L97 330 L69 330 Z" fill="${b}"/>`);
      if (bottom.cut === "cargo") {
        add(`<rect x="69" y="276" width="13" height="18" rx="2" fill="${bottom.accent}"/><rect x="118" y="276" width="13" height="18" rx="2" fill="${bottom.accent}"/>`);
      } else {
        add(`<path d="M70 250 L69 330 M130 250 L131 330" stroke="${bottom.accent}" stroke-width="2.5" opacity=".6"/>`);
      }
    } else if (bottom.cut === "shorts") {
      add(`<path d="M67 238 L133 238 L132 290 L103 290 L100 264 L97 290 L68 290 Z" fill="${b}"/>`);
    } else {
      add(`<path d="M67 238 L133 238 L144 302 L56 302 Z" fill="${b}"/>`);
    }
  }
  const foot = (x: number, flip: boolean) => {
    const toe = flip ? 1 : -1;
    switch (shoes.cut) {
      case "slides":
        return `<ellipse cx="${x + 16}" cy="338" rx="13" ry="7" fill="${skin}"/><rect x="${x + toe * 3}" y="341" width="34" height="5" rx="2.5" fill="${shoes.accent}"/><rect x="${x + 4}" y="330" width="24" height="9" rx="4.5" fill="${shoes.color}"/>`;
      case "boots":
        return `<path d="M${x + 6} 306 h22 v26 q${toe * 8} 0 ${toe * 8} 8 v4 h-38 v-6 q0 -6 8 -6 Z" transform="translate(${flip ? 0 : 4} 0)" fill="${shoes.color}"/><rect x="${x + (flip ? 0 : 2)}" y="342" width="36" height="4" rx="2" fill="${shoes.accent}"/>`;
      case "loafers":
        return `<rect x="${x + toe * 2}" y="330" width="34" height="13" rx="6.5" fill="${shoes.color}"/><path d="M${x + 8} 334 h16" stroke="${shoes.accent}" stroke-width="2.5" stroke-linecap="round"/><rect x="${x + toe * 2}" y="341" width="34" height="4" rx="2" fill="${shoes.accent}"/>`;
      default:
        return `<rect x="${x + toe * 3}" y="325" width="34" height="18" rx="9" fill="${shoes.color}"/><rect x="${x + toe * 3}" y="338" width="34" height="6" rx="3" fill="${shoes.accent}"/><path d="M${x + 8} 331 l5 -2 M${x + 15} 331 l5 -2" stroke="${shoes.accent}" stroke-width="2" stroke-linecap="round"/>`;
    }
  };
  add(foot(66, false) + foot(102, true));

  /* ---- arms, then sleeves over them ---- */
  add(`<path d="M66 156 L55 232 M134 156 L145 232" stroke="${skin}" stroke-width="15" stroke-linecap="round"/>`);
  add(`<circle cx="54" cy="238" r="9" fill="${skin}"/><circle cx="146" cy="238" r="9" fill="${skin}"/>`);
  const t = paint(top, "t");
  const sleeve = (len: number, w: number) =>
    `<path d="M66 156 L${66 - (len - 156) * 0.145} ${len} M134 156 L${134 + (len - 156) * 0.145} ${len}" stroke="${t}" stroke-width="${w}" stroke-linecap="round"/>`;
  if (top.cut === "kaftan") {
    add(`<path d="M68 150 L44 214 L70 220 L80 180 Z M132 150 L156 214 L130 220 L120 180 Z" fill="${t}"/>`);
  } else if (top.cut === "tee") add(sleeve(192, 21));
  else if (top.cut === "dress") add(sleeve(174, 21));
  else {
    add(sleeve(226, 20));
    add(`<path d="M55 226 L54 230 M145 226 L146 230" stroke="${top.accent}" stroke-width="20" stroke-linecap="butt"/>`);
  }

  /* ---- neck, torso ---- */
  add(`<rect x="90" y="106" width="20" height="44" rx="7" fill="${skin}"/><path d="M90 118 Q100 128 110 118 L110 128 Q100 134 90 128 Z" fill="${skinD}" opacity=".6"/>`);
  const torso = top.cut === "kaftan" ? KAFTAN : dress ? DRESS : TORSO[look.body];
  add(`<path d="${torso}" fill="${t}"/>`);
  const tD = shade(top.color, -0.22);
  switch (top.cut) {
    case "tee":
      add(`<path d="M86 146 Q100 160 114 146" stroke="${top.accent}" stroke-width="4" fill="none" stroke-linecap="round"/>`);
      break;
    case "shirt":
      add(`<path d="M100 160 V246" stroke="${tD}" stroke-width="2"/>`);
      add([172, 192, 212, 232].map((y) => `<circle cx="100" cy="${y}" r="2.2" fill="${top.accent}"/>`).join(""));
      add(`<path d="M88 145 L100 162 L94 170 L80 150 Z M112 145 L100 162 L106 170 L120 150 Z" fill="${top.pattern === "solid" ? tD : top.accent}"/>`);
      break;
    case "hoodie":
      add(`<path d="M74 150 Q100 182 126 150 Q118 138 100 140 Q82 138 74 150 Z" fill="${tD}"/>`);
      add(`<path d="M93 162 L91 188 M107 162 L109 188" stroke="${top.accent}" stroke-width="2.5" stroke-linecap="round"/>`);
      add(`<path d="M78 212 L122 212 L118 240 L82 240 Z" fill="${tD}"/>`);
      break;
    case "kaftan":
      add(`<path d="M88 146 L100 176 L112 146" stroke="${top.accent}" stroke-width="3.5" fill="none" stroke-linejoin="round"/>`);
      add([186, 198, 210].map((y) => `<circle cx="100" cy="${y}" r="2.4" fill="${top.accent}"/>`).join(""));
      add(`<path d="M60 296 L140 296" stroke="${top.accent}" stroke-width="3"/>`);
      break;
    case "jacket":
      add(`<path d="M89 147 L111 147 L107 246 L93 246 Z" fill="${top.accent}"/>`);
      add(`<path d="M88 147 L100 190 L92 196 L78 152 Z M112 147 L100 190 L108 196 L122 152 Z" fill="${tD}"/>`);
      add(`<circle cx="108" cy="214" r="2.6" fill="${top.accent}"/><circle cx="108" cy="230" r="2.6" fill="${top.accent}"/>`);
      break;
    case "dress":
      add(`<path d="M70 214 Q100 220 130 214" stroke="${top.accent}" stroke-width="5" fill="none"/>`);
      add(`<path d="M86 146 Q100 162 114 146" stroke="${top.accent}" stroke-width="3" fill="none"/>`);
      break;
  }
  if (look.hair === "braids" || look.hair === "locs") {
    const w = look.hair === "locs" ? 9 : 6;
    const end = look.hair === "locs" ? 186 : 204;
    add(
      [58, 66, 134, 142]
        .map((x) => `<path d="M${x} 92 Q${x + (x < 100 ? -4 : 4)} 140 ${x + (x < 100 ? 2 : -2)} ${end}" stroke="${hair}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`)
        .join("")
    );
  }
  if (look.neck === "chain") {
    add(`<path d="M84 148 Q100 184 116 148" stroke="${GOLD}" stroke-width="3" fill="none"/><circle cx="100" cy="175" r="4.5" fill="${GOLD}"/>`);
  }

  /* ---- head ---- */
  add(`<ellipse cx="60" cy="84" rx="8" ry="11" fill="${skin}"/><ellipse cx="140" cy="84" rx="8" ry="11" fill="${skin}"/>`);
  add(`<ellipse cx="61" cy="85" rx="3.5" ry="5.5" fill="${skinD}"/><ellipse cx="139" cy="85" rx="3.5" ry="5.5" fill="${skinD}"/>`);
  add(`<ellipse cx="100" cy="78" rx="40" ry="46" fill="${skin}"/>`);

  add(`<path d="M76 66 Q84 60 92 65 M108 65 Q116 60 124 66" stroke="${brow}" stroke-width="4" fill="none" stroke-linecap="round"/>`);
  const open = (x: number) =>
    `<ellipse cx="${x}" cy="82" rx="5" ry="6.5" fill="${INK}"/><circle cx="${x + 2}" cy="79" r="1.8" fill="#F5EBDD"/>`;
  const happy = (x: number) => `<path d="M${x - 6} 84 Q${x} 76 ${x + 6} 84" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  const sleepy = (x: number) =>
    `<ellipse cx="${x}" cy="84" rx="5" ry="3.5" fill="${INK}"/><path d="M${x - 7} 81 H${x + 7}" stroke="${skinD}" stroke-width="3" stroke-linecap="round"/>`;
  if (look.eyes === "happy") add(happy(84) + happy(116));
  else if (look.eyes === "wink") add(open(84) + happy(116));
  else if (look.eyes === "sleepy") add(sleepy(84) + sleepy(116));
  else add(open(84) + open(116));
  add(`<path d="M95 93 Q100 101 105 93" stroke="${skinD}" stroke-width="3" fill="none" stroke-linecap="round"/>`);

  if (look.beard === "full") add(`<path d="${JAW}" fill="${hair}"/>`);
  if (look.beard === "stubble") add(`<path d="${JAW}" fill="${hair}" opacity=".3"/>`);
  if (look.beard === "goatee") add(`<path d="M91 116 Q100 112 109 116 Q107 127 100 129 Q93 127 91 116 Z" fill="${hair}"/>`);
  if (look.beard === "moustache" || look.beard === "goatee" || look.beard === "full") add(`<path d="${TACHE}" fill="${hair}"/>`);

  switch (look.mouth) {
    case "grin":
      add(`<path d="M86 107 Q100 125 114 107 Z" fill="#F5EBDD" stroke="${MOUTH}" stroke-width="3" stroke-linejoin="round"/>`);
      break;
    case "smirk":
      add(`<path d="M90 111 Q103 115 113 106" stroke="${MOUTH}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`);
      break;
    case "oh":
      add(`<ellipse cx="100" cy="112" rx="4.5" ry="5.5" fill="${MOUTH}"/>`);
      break;
    default:
      add(`<path d="M88 109 Q100 119 112 109" stroke="${MOUTH}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`);
  }

  /* ---- hair, front layer ---- */
  if (!coversHair) {
    const lowcut = `<path d="M61 76 Q60 32 100 30 Q140 32 139 76 Q132 56 100 52 Q68 56 61 76 Z" fill="${hair}"/>`;
    switch (look.hair) {
      case "lowcut":
      case "puff":
        add(lowcut);
        break;
      case "fade":
        add(`<path d="M61 78 Q60 40 70 36 L130 36 Q140 40 139 78 Q134 62 126 58 L74 58 Q66 62 61 78 Z" fill="${hair}" opacity=".45"/>`);
        add(`<path d="M66 60 Q64 16 100 14 Q136 16 134 60 Q126 48 100 46 Q74 48 66 60 Z" fill="${hair}"/>`);
        break;
      case "afro":
        add(`<path d="M58 80 Q54 26 100 22 Q146 26 142 80 Q134 54 100 50 Q66 54 58 80 Z" fill="${hair}"/>`);
        break;
      case "braids":
      case "locs":
        add(`<path d="M58 84 Q54 28 100 26 Q146 28 142 84 Q136 58 100 52 Q64 58 58 84 Z" fill="${hair}"/><path d="M100 28 V50" stroke="${shade(hair, 0.25)}" stroke-width="2"/>`);
        break;
      case "bantu":
        add(lowcut);
        add(
          [[70, 40, 11], [100, 26, 12], [130, 40, 11], [84, 30, 8], [116, 30, 8]]
            .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${hair}"/><path d="M${x - r / 2} ${y} Q${x} ${y - r / 2} ${x + r / 2} ${y}" stroke="${shade(hair, 0.3)}" stroke-width="1.5" fill="none"/>`)
            .join("")
        );
        break;
      case "cornrows":
        add(lowcut);
        add(
          [72, 86, 100, 114, 128]
            .map((x) => `<path d="M${x} 54 Q${x + (x - 100) * 0.1} 40 ${x + (x - 100) * 0.3} 32" stroke="${shade(hair, 0.35)}" stroke-width="1.6" fill="none" stroke-dasharray="3 2"/>`)
            .join("")
        );
        break;
      case "bald":
        add(`<ellipse cx="86" cy="44" rx="10" ry="5" fill="#fff" opacity=".1" transform="rotate(-20 86 44)"/>`);
        break;
    }
  }

  /* ---- glasses ---- */
  const arms = `<path d="M73 80 L61 78 M127 80 L139 78" stroke="${INK}" stroke-width="2.5"/>`;
  if (look.glasses === "round") {
    add(`<circle cx="84" cy="82" r="11" fill="#F5EBDD" fill-opacity=".12" stroke="${INK}" stroke-width="3"/><circle cx="116" cy="82" r="11" fill="#F5EBDD" fill-opacity=".12" stroke="${INK}" stroke-width="3"/><path d="M95 81 Q100 76 105 81" stroke="${INK}" stroke-width="2.5" fill="none"/>${arms}`);
  } else if (look.glasses === "square") {
    add(`<rect x="72" y="72" width="25" height="20" rx="3" fill="#F5EBDD" fill-opacity=".12" stroke="${INK}" stroke-width="3"/><rect x="103" y="72" width="25" height="20" rx="3" fill="#F5EBDD" fill-opacity=".12" stroke="${INK}" stroke-width="3"/><path d="M97 80 H103" stroke="${INK}" stroke-width="2.5"/>${arms}`);
  } else if (look.glasses === "shades") {
    add(`<rect x="70" y="73" width="28" height="18" rx="7" fill="#120D0B"/><rect x="102" y="73" width="28" height="18" rx="7" fill="#120D0B"/><path d="M98 79 H102" stroke="#120D0B" stroke-width="3"/><path d="M76 78 L82 76" stroke="#FF4D00" stroke-width="2" stroke-linecap="round"/>${arms}`);
  }

  /* ---- headwear ---- */
  if (hat) {
    const h = paint(hat, "h");
    const hD = shade(hat.color, -0.2);
    switch (hat.cut) {
      case "cap":
        add(`<ellipse cx="148" cy="58" rx="16" ry="5" fill="${hD}"/>`);
        add(`<path d="M59 68 Q57 22 100 20 Q143 22 141 68 Z" fill="${h}"/><path d="M59 68 Q100 60 141 68 L141 74 Q100 66 59 74 Z" fill="${hat.accent}"/><path d="M90 66 Q100 52 110 66 Z" fill="${hD}"/>`);
        break;
      case "bucket":
        add(`<path d="M64 58 Q66 20 100 18 Q134 20 136 58 Z" fill="${h}"/><path d="M64 52 Q100 46 136 52 L136 58 Q100 52 64 58 Z" fill="${hat.accent}"/><path d="M42 66 Q100 44 158 66 Q162 74 150 73 Q100 56 50 73 Q38 74 42 66 Z" fill="${hD}"/>`);
        break;
      case "beanie":
        add(`<path d="M57 66 Q55 10 100 8 Q145 10 143 66 Z" fill="${h}"/><path d="M55 56 Q100 48 145 56 L145 72 Q100 64 55 72 Z" fill="${hD}"/>`);
        add([70, 82, 94, 106, 118, 130].map((x) => `<path d="M${x} 54 V68" stroke="${hat.color}" stroke-width="2"/>`).join(""));
        break;
      case "fila":
        add(`<g transform="rotate(-8 100 44)"><path d="M60 62 Q58 20 100 12 Q134 8 148 30 L150 50 Q142 44 140 62 Z" fill="${h}"/><path d="M60 62 Q100 54 140 62 L140 68 Q100 60 60 68 Z" fill="${hD}"/><path d="M146 30 L162 40 L150 50 Z" fill="${hD}"/></g>`);
        break;
      case "gele":
        add(`<ellipse cx="72" cy="22" rx="36" ry="17" transform="rotate(-22 72 22)" fill="${hD}"/><ellipse cx="130" cy="16" rx="38" ry="19" transform="rotate(20 130 16)" fill="${hD}"/>`);
        add(`<path d="M56 70 Q50 14 100 6 Q150 14 144 70 Z" fill="${h}"/><ellipse cx="100" cy="12" rx="24" ry="14" fill="${hat.accent}"/><path d="M56 62 Q100 50 144 62 L144 70 Q100 58 56 70 Z" fill="${hat.accent}"/>`);
        break;
    }
  }

  if (look.ears === "hoops") add(`<circle cx="59" cy="100" r="6" stroke="${GOLD}" stroke-width="2.5" fill="none"/><circle cx="141" cy="100" r="6" stroke="${GOLD}" stroke-width="2.5" fill="none"/>`);
  if (look.ears === "studs") add(`<circle cx="59" cy="95" r="2.8" fill="${GOLD}"/><circle cx="141" cy="95" r="2.8" fill="${GOLD}"/>`);

  const box = opts.crop === "head" ? "26 -16 148 148" : "0 -12 200 364";
  const a11y = opts.label ? `role="img" aria-label="${opts.label.replace(/[^\w\s'-]/g, "")}"` : `aria-hidden="true"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" ${a11y} style="display:block;width:100%;height:100%"><defs>${defs.join("")}</defs>${out.join("")}</svg>`;
}
