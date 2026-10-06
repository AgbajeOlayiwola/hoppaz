/**
 * The Hopper avatar: a Bitmoji-style look built from a whitelist of parts and a
 * wardrobe of Lagos labels.
 *
 * A look is stored as plain JSON on profiles.avatar and other Hoppers' looks
 * are rendered on the map and the crew list, so it is untrusted input:
 * normalizeLook() maps every field back onto these lists and nothing from the
 * stored JSON is ever interpolated into the SVG as-is.
 *
 * Colour note: the four-colour brand rule governs Hoppaz chrome. Skin, hair and
 * clothes are the rider, not the brand, the same way photos carry the chroma.
 */

export const SKINS = ["#3B2219", "#4E2C1E", "#5F3524", "#77452E", "#8D5A3B", "#A8714A", "#C68A5E"] as const;

export const HAIR_COLORS = [
  { key: "black", hex: "#1A1210" },
  { key: "brown", hex: "#4A2A1A" },
  { key: "honey", hex: "#C98B3E" },
  { key: "ginger", hex: "#FF4D00" },
  { key: "wine", hex: "#6E1E2A" },
  { key: "bleach", hex: "#EADBC4" },
] as const;

export const HAIR = [
  ["lowcut", "Low cut"],
  ["fade", "Fade"],
  ["afro", "Afro"],
  ["puff", "Puff"],
  ["braids", "Braids"],
  ["locs", "Locs"],
  ["bantu", "Bantu knots"],
  ["cornrows", "Cornrows"],
  ["bald", "Clean"],
] as const;

export const EYES = [
  ["open", "Open"],
  ["happy", "Happy"],
  ["wink", "Wink"],
  ["sleepy", "3am"],
] as const;

export const MOUTHS = [
  ["smile", "Smile"],
  ["grin", "Grin"],
  ["smirk", "Smirk"],
  ["oh", "Oh"],
] as const;

export const BEARDS = [
  ["none", "None"],
  ["stubble", "Stubble"],
  ["moustache", "Tache"],
  ["goatee", "Goatee"],
  ["full", "Full"],
] as const;

export const GLASSES = [
  ["none", "None"],
  ["round", "Round"],
  ["square", "Square"],
  ["shades", "Shades"],
] as const;

export const EARS = [
  ["none", "None"],
  ["studs", "Studs"],
  ["hoops", "Hoops"],
] as const;

export const NECKS = [
  ["none", "None"],
  ["chain", "Chain"],
] as const;

export const BODIES = [
  ["straight", "Straight"],
  ["curvy", "Curvy"],
] as const;

type Key<T extends ReadonlyArray<readonly [string, string]>> = T[number][0];

export type Slot = "top" | "bottom" | "shoes" | "head";
export type Pattern = "solid" | "stripes" | "ankara" | "adire" | "check";
export type Cut =
  | "tee" | "shirt" | "hoodie" | "kaftan" | "jacket" | "dress"
  | "trousers" | "cargo" | "shorts" | "skirt"
  | "sneakers" | "slides" | "boots" | "loafers"
  | "cap" | "bucket" | "beanie" | "fila" | "gele";

export type Item = {
  id: string;
  brand: string;
  name: string;
  slot: Slot;
  cut: Cut;
  color: string;
  accent: string;
  pattern: Pattern;
};

/**
 * Labels in the wardrobe. These are Lagos and Nigerian fashion houses named so
 * Hoppers can dress in what the city actually wears. The pieces are drawn in the
 * spirit of each label, not copies of real products, and no logos are used.
 * Before this goes public, or before any of it is sold or sponsored, get each
 * label's OK: it is also the obvious brand-partnership slot.
 */
export const LABELS: ReadonlyArray<{ key: string; name: string; note: string }> = [
  { key: "hoppaz", name: "Hoppaz", note: "Bus merch. Hop or stay." },
  { key: "okrika", name: "Yaba Okrika", note: "Market basics. Free for everyone." },
  { key: "orange-culture", name: "Orange Culture", note: "Loud prints, no rules on who wears what" },
  { key: "lsp", name: "Lagos Space Programme", note: "Adire and indigo, done new" },
  { key: "kenneth-ize", name: "Kenneth Ize", note: "Hand-woven aso-oke stripes" },
  { key: "tokyo-james", name: "Tokyo James", note: "Sharp Lagos tailoring" },
  { key: "maki-oh", name: "Maki Oh", note: "Hand-dyed adire womenswear" },
  { key: "lisa-folawiyo", name: "Lisa Folawiyo", note: "Ankara, dressed up" },
  { key: "mai-atafo", name: "Mai Atafo", note: "Bespoke senator and native" },
  { key: "wnc", name: "WAFFLESNCREAM", note: "Lagos skate crew streetwear" },
  { key: "motherlan", name: "Motherlan", note: "Lagos streetwear" },
  { key: "severe-nature", name: "Severe Nature", note: "Lagos streetwear" },
  { key: "cute-saint", name: "Cute Saint", note: "Tracksuits and hoodies" },
  { key: "andrea-iyamah", name: "Andrea Iyamah", note: "Resort and swim" },
  { key: "femi-handmade", name: "Femi Handmade", note: "Hand-made Lagos leather shoes" },
];

const it = (
  id: string, brand: string, name: string, slot: Slot, cut: Cut,
  color: string, accent: string, pattern: Pattern = "solid"
): Item => ({ id, brand, name, slot, cut, color, accent, pattern });

export const WARDROBE: ReadonlyArray<Item> = [
  // Hoppaz merch
  it("hz-tee", "hoppaz", "Hop or Stay tee", "top", "tee", "#FF4D00", "#F5EBDD"),
  it("hz-hoodie", "hoppaz", "Night Black hoodie", "top", "hoodie", "#17110F", "#FF4D00"),
  it("hz-bucket", "hoppaz", "Conductor bucket", "head", "bucket", "#FF4D00", "#0E0B0A"),
  // Basics, so nobody needs a label to get dressed
  it("ok-tee-cream", "okrika", "Cream tee", "top", "tee", "#EFE4D2", "#C9B9A3"),
  it("ok-tee-black", "okrika", "Black tee", "top", "tee", "#1C1714", "#3A302A"),
  it("ok-jeans", "okrika", "Blue jeans", "bottom", "trousers", "#3B5A8C", "#2A426A"),
  it("ok-black-trousers", "okrika", "Black trousers", "bottom", "trousers", "#1E1A18", "#332C28"),
  it("ok-shorts", "okrika", "Denim shorts", "bottom", "shorts", "#4C6C9C", "#2F4870"),
  it("ok-sneakers", "okrika", "White sneakers", "shoes", "sneakers", "#F2EBE0", "#BFB2A0"),
  it("ok-palm", "okrika", "Palm slippers", "shoes", "slides", "#7A4A28", "#3A2414"),
  // Orange Culture
  it("oc-kaftan", "orange-culture", "Print kaftan", "top", "kaftan", "#FF7A1A", "#2B1A4F", "ankara"),
  it("oc-shirt", "orange-culture", "Pastel print shirt", "top", "shirt", "#F2A7C3", "#3A6E5A", "ankara"),
  it("oc-trousers", "orange-culture", "Wide-leg trousers", "bottom", "trousers", "#E8C547", "#B89820"),
  // Lagos Space Programme
  it("lsp-shirt", "lsp", "Adire shirt", "top", "shirt", "#1F2E5C", "#E9E2D0", "adire"),
  it("lsp-trousers", "lsp", "Indigo trousers", "bottom", "trousers", "#22305E", "#CFC6B0", "adire"),
  // Kenneth Ize
  it("ki-shirt", "kenneth-ize", "Aso-oke stripe shirt", "top", "shirt", "#E83F6F", "#F5C842", "stripes"),
  it("ki-shorts", "kenneth-ize", "Aso-oke shorts", "bottom", "shorts", "#3E7CB1", "#F5EBDD", "stripes"),
  it("ki-skirt", "kenneth-ize", "Aso-oke skirt", "bottom", "skirt", "#F5C842", "#E83F6F", "stripes"),
  it("ki-fila", "kenneth-ize", "Aso-oke fila", "head", "fila", "#3E7CB1", "#F5C842", "stripes"),
  // Tokyo James
  it("tj-jacket", "tokyo-james", "Sharp jacket", "top", "jacket", "#141414", "#C21F1F"),
  it("tj-trousers", "tokyo-james", "Tailored trousers", "bottom", "trousers", "#1E1E1E", "#2E2E2E"),
  // Maki Oh
  it("mo-dress", "maki-oh", "Adire dress", "top", "dress", "#2A3A7A", "#F1E6D3", "adire"),
  // Lisa Folawiyo
  it("lf-dress", "lisa-folawiyo", "Ankara dress", "top", "dress", "#0F7B6C", "#F4B41A", "ankara"),
  it("lf-gele", "lisa-folawiyo", "Owambe gele", "head", "gele", "#F4B41A", "#0F7B6C"),
  // Mai Atafo
  it("ma-senator", "mai-atafo", "Cream senator", "top", "kaftan", "#EFE4D2", "#B8975A"),
  it("ma-senator-wine", "mai-atafo", "Wine senator", "top", "kaftan", "#5E1A26", "#D9A441"),
  // WAFFLESNCREAM
  it("wnc-tee", "wnc", "Skate tee", "top", "tee", "#F2EBE0", "#1E6B3A"),
  it("wnc-hoodie", "wnc", "Crew hoodie", "top", "hoodie", "#1E6B3A", "#F2EBE0"),
  it("wnc-cap", "wnc", "Skate cap", "head", "cap", "#1E6B3A", "#F2EBE0"),
  it("wnc-cargo", "wnc", "Cargo pants", "bottom", "cargo", "#4B4A3A", "#3A392C"),
  // Motherlan
  it("ml-tee", "motherlan", "Graphic tee", "top", "tee", "#141414", "#E85D2A"),
  it("ml-hoodie", "motherlan", "Heavy hoodie", "top", "hoodie", "#6E6A62", "#141414"),
  it("ml-beanie", "motherlan", "Beanie", "head", "beanie", "#E85D2A", "#B8461C"),
  // Severe Nature
  it("sn-shirt", "severe-nature", "Check shirt", "top", "shirt", "#8C2F39", "#1B1B1B", "check"),
  it("sn-bucket", "severe-nature", "Bucket hat", "head", "bucket", "#2F4F2F", "#1B2B1B"),
  // Cute Saint
  it("cs-hoodie", "cute-saint", "Track hoodie", "top", "hoodie", "#EFE4D2", "#141414"),
  it("cs-pants", "cute-saint", "Track pants", "bottom", "trousers", "#141414", "#EFE4D2"),
  // Andrea Iyamah
  it("ai-dress", "andrea-iyamah", "Resort dress", "top", "dress", "#D9534F", "#F5D6C6"),
  // Femi Handmade
  it("fh-loafers", "femi-handmade", "Leather loafers", "shoes", "loafers", "#5A2E1A", "#2A140A"),
  it("fh-slides", "femi-handmade", "Leather slides", "shoes", "slides", "#3B1F12", "#1E0F08"),
  it("fh-boots", "femi-handmade", "Chelsea boots", "shoes", "boots", "#2A1A12", "#140C08"),
];

const BY_ID = new Map(WARDROBE.map((i) => [i.id, i]));
export const itemById = (id: string | null | undefined) => (id ? BY_ID.get(id) ?? null : null);

export type Look = {
  v: 1;
  skin: number;
  hairColor: number;
  body: Key<typeof BODIES>;
  hair: Key<typeof HAIR>;
  eyes: Key<typeof EYES>;
  mouth: Key<typeof MOUTHS>;
  beard: Key<typeof BEARDS>;
  glasses: Key<typeof GLASSES>;
  ears: Key<typeof EARS>;
  neck: Key<typeof NECKS>;
  head: string | null;
  top: string;
  bottom: string;
  shoes: string;
};

export const DEFAULT_LOOK: Look = {
  v: 1,
  skin: 3,
  hairColor: 0,
  body: "straight",
  hair: "fade",
  eyes: "open",
  mouth: "smile",
  beard: "none",
  glasses: "none",
  ears: "none",
  neck: "none",
  head: null,
  top: "hz-tee",
  bottom: "ok-jeans",
  shoes: "ok-sneakers",
};

function pick<T extends ReadonlyArray<readonly [string, string]>>(list: T, v: unknown, fallback: Key<T>): Key<T> {
  return list.some(([k]) => k === v) ? (v as Key<T>) : fallback;
}

function index(len: number, v: unknown, fallback: number) {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < len ? (v as number) : fallback;
}

function slotItem(slot: Slot, v: unknown, fallback: string) {
  const found = typeof v === "string" ? BY_ID.get(v) : undefined;
  return found && found.slot === slot ? found.id : fallback;
}

/** Turn anything (a stored jsonb, a stale local copy, null) into a safe Look. */
export function normalizeLook(raw: unknown): Look {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_LOOK;
  const head = typeof r.head === "string" ? BY_ID.get(r.head) : undefined;
  return {
    v: 1,
    skin: index(SKINS.length, r.skin, d.skin),
    hairColor: index(HAIR_COLORS.length, r.hairColor, d.hairColor),
    body: pick(BODIES, r.body, d.body),
    hair: pick(HAIR, r.hair, d.hair),
    eyes: pick(EYES, r.eyes, d.eyes),
    mouth: pick(MOUTHS, r.mouth, d.mouth),
    beard: pick(BEARDS, r.beard, d.beard),
    glasses: pick(GLASSES, r.glasses, d.glasses),
    ears: pick(EARS, r.ears, d.ears),
    neck: pick(NECKS, r.neck, d.neck),
    head: head && head.slot === "head" ? head.id : null,
    top: slotItem("top", r.top, d.top),
    bottom: slotItem("bottom", r.bottom, d.bottom),
    shoes: slotItem("shoes", r.shoes, d.shoes),
  };
}

const any = <T,>(xs: ReadonlyArray<T>) => xs[Math.floor(Math.random() * xs.length)];

export function randomLook(): Look {
  const of = (slot: Slot) => WARDROBE.filter((i) => i.slot === slot).map((i) => i.id);
  return {
    v: 1,
    skin: Math.floor(Math.random() * SKINS.length),
    hairColor: Math.random() < 0.7 ? 0 : Math.floor(Math.random() * HAIR_COLORS.length),
    body: any(BODIES)[0],
    hair: any(HAIR)[0],
    eyes: any(EYES)[0],
    mouth: any(MOUTHS)[0],
    beard: Math.random() < 0.6 ? "none" : any(BEARDS)[0],
    glasses: Math.random() < 0.6 ? "none" : any(GLASSES)[0],
    ears: any(EARS)[0],
    neck: any(NECKS)[0],
    head: Math.random() < 0.6 ? null : any(of("head")),
    top: any(of("top")),
    bottom: any(of("bottom")),
    shoes: any(of("shoes")),
  };
}
