import css from "./OpenStage.module.css";
import { TIER } from "./tiers";
import type { OpenTier } from "./types";

const NS = "http://www.w3.org/2000/svg";

/**
 * The crate, drawn per tier: an isometric box (left face, right face, lid) with
 * a tape stripe across the front and the lid. Classes c-lid, c-glow, c-glow2
 * and tp are used by the open sequence.
 */
export function crateSVG(tier: OpenTier) {
  const T = TIER[tier];
  return (
    `<svg viewBox="0 0 48 52" xmlns="${NS}" aria-hidden="true"><g class="c-body">` +
    `<polygon points="4,16 24,26 24,48 4,38" fill="${T.l}"/>` +
    `<polygon points="44,16 24,26 24,48 44,38" fill="${T.r}"/>` +
    `<polygon class="tp" points="11,19.5 17,22.5 17,44.5 11,41.5" fill="${T.tape}" opacity=".95"/>` +
    `<path d="M4 16 24 26 44 16" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1"/>` +
    `<path d="M24 26V48" stroke="rgba(0,0,0,.25)" stroke-width="1"/></g>` +
    `<polygon class="c-glow" points="24,6 44,16 24,26 4,16" fill="#120d0a" opacity="0"/>` +
    `<polygon class="c-glow2" points="24,9.5 38.5,16 24,22.5 9.5,16" fill="#fff" opacity="0"/>` +
    `<g class="c-lid" style="transform-box:fill-box;transform-origin:50% 100%">` +
    `<polygon points="24,6 44,16 24,26 4,16" fill="${T.t}"/>` +
    `<polygon class="tp" points="31,9.5 37,12.5 17,22.5 11,19.5" fill="${T.tape}" opacity=".95"/>` +
    `<path d="M4 16 24 6 44 16" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1"/></g></svg>`
  );
}

/** Small drawn pictures for card faces, keyed by name. All Hoppaz colours, no emoji. */
const ART: Record<string, (a: string) => string> = {
  danfo: () => '<rect x="8" y="34" width="84" height="36" rx="8" fill="#F5EBDD"/><rect x="8" y="53" width="84" height="7" fill="#0E0B0A"/><rect x="15" y="39" width="13" height="10" rx="2" fill="#0E0B0A"/><rect x="33" y="39" width="13" height="10" rx="2" fill="#0E0B0A"/><rect x="51" y="39" width="13" height="10" rx="2" fill="#0E0B0A"/><rect x="69" y="39" width="17" height="10" rx="2" fill="#0E0B0A"/><circle cx="28" cy="71" r="8" fill="#0E0B0A" stroke="#F5EBDD" stroke-width="2"/><circle cx="72" cy="71" r="8" fill="#0E0B0A" stroke="#F5EBDD" stroke-width="2"/><rect x="86" y="58" width="6" height="5" fill="#FF4D00"/>',
  jollof: (a) => `<path d="M16 52H84A34 30 0 0 1 16 52Z" fill="#F5EBDD"/><ellipse cx="50" cy="50" rx="32" ry="12" fill="#FF4D00"/><circle cx="40" cy="47" r="3" fill="#B83600"/><circle cx="56" cy="50" r="3" fill="#B83600"/><circle cx="64" cy="46" r="2.5" fill="#F5EBDD"/><path d="M38 34q-7-9 0-17M52 34q-7-9 0-17M66 34q-7-9 0-17" fill="none" stroke="${a}" stroke-width="3" stroke-linecap="round"/>`,
  palm: (a) => `<circle cx="76" cy="26" r="13" fill="#FF4D00"/><path d="M48 90Q54 62 46 34" fill="none" stroke="#B83600" stroke-width="6" stroke-linecap="round"/><path d="M46 34Q22 20 8 40M46 34Q30 12 12 14M46 34Q60 12 82 18M46 34Q68 28 84 48M46 34Q46 16 52 8" fill="none" stroke="#F5EBDD" stroke-width="4.5" stroke-linecap="round"/><path d="M0 90H100" stroke="${a}" stroke-width="2"/>`,
  speaker: (a) => `<path d="M32 30v-9h36v9" fill="none" stroke="#F5EBDD" stroke-width="4" stroke-linecap="round"/><rect x="12" y="30" width="76" height="50" rx="9" fill="#F5EBDD"/><circle cx="34" cy="56" r="15" fill="#0E0B0A"/><circle cx="66" cy="56" r="15" fill="#0E0B0A"/><circle cx="34" cy="56" r="6" fill="${a}"/><circle cx="66" cy="56" r="6" fill="${a}"/><circle cx="50" cy="38" r="3" fill="#FF4D00"/>`,
  bridge: (a) => `<rect x="0" y="62" width="100" height="34" fill="#12212d"/><path d="M0 66H100" stroke="#F5EBDD" stroke-width="3"/><path d="M26 66V20M74 66V20" stroke="#F5EBDD" stroke-width="4" stroke-linecap="round"/><path d="M0 62Q13 30 26 20Q50 56 74 20Q87 30 100 62" fill="none" stroke="${a}" stroke-width="2.5"/><path d="M12 66V50M38 66V44M50 66V48M62 66V44M88 66V50" stroke="${a}" stroke-width="1.6"/><path d="M10 80h20M45 86h30M70 78h22" stroke="rgba(245,235,221,.35)" stroke-width="2" stroke-linecap="round"/>`,
  sunset: (a) => `<path d="M20 62A30 30 0 0 1 80 62Z" fill="#FF4D00"/><path d="M8 66H92M16 73H84M26 80H74M38 87H62" stroke="#F5EBDD" stroke-width="3" stroke-linecap="round"/><path d="M0 62H100" stroke="${a}" stroke-width="2"/>`,
  hop: (a) => `<rect x="6" y="28" width="88" height="44" rx="12" fill="#FF4D00"/><rect x="14" y="35" width="15" height="14" rx="3" fill="#F5EBDD"/><rect x="33" y="35" width="15" height="14" rx="3" fill="#F5EBDD"/><rect x="52" y="35" width="15" height="14" rx="3" fill="#F5EBDD"/><rect x="71" y="35" width="17" height="14" rx="3" fill="#F5EBDD"/><rect x="6" y="56" width="88" height="5" fill="#0E0B0A"/><circle cx="26" cy="73" r="9" fill="#0E0B0A" stroke="#F5EBDD" stroke-width="2.5"/><circle cx="74" cy="73" r="9" fill="#0E0B0A" stroke="#F5EBDD" stroke-width="2.5"/><path d="M50 8l3 8 8 1-6 6 2 8-7-4-7 4 2-8-6-6 8-1z" fill="${a}"/>`,
};
const ART_KEYS = Object.keys(ART);

/** Picks the picture for a collectible: its key if it names one, otherwise a steady pick from the key's letters. */
export function artFor(key: string) {
  if (ART[key]) return key;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ART_KEYS[h % ART_KEYS.length];
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

/** A collectible's card face: tier-coloured frame, a drawn picture, the name, the tier. */
export function cardSVG(card: { key: string; name: string }, tier: OpenTier) {
  const T = TIER[tier];
  const name = esc(card.name.length > 18 ? card.name.slice(0, 17) + "." : card.name);
  return (
    `<svg viewBox="0 0 120 168" xmlns="${NS}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
    `<rect x="2" y="2" width="116" height="164" rx="12" fill="#17120f" stroke="${T.t}" stroke-width="3"/>` +
    `<rect x="9" y="9" width="102" height="104" rx="7" fill="${T.bg}"/>` +
    `<rect x="9" y="9" width="102" height="52" rx="7" fill="${T.c}" opacity=".16"/>` +
    `<g transform="translate(10,13)">${ART[artFor(card.key)](T.t)}</g>` +
    `<text x="60" y="130" text-anchor="middle" font-family="var(--font-mono),monospace" font-size="10" fill="#F5EBDD">${name}</text>` +
    `<text x="60" y="149" text-anchor="middle" font-family="var(--font-mono),monospace" font-size="8.5" letter-spacing="1" fill="${T.t}">${T.name.toUpperCase()}</text></svg>`
  );
}

/**
 * A deck card's face: the deck's own front image (the name, rarity and picture are drawn into it) over a plate that shows
 * the name and rarity until the image is in, and stays if it never comes. The caller hides the plate on the image's load
 * and removes the image if it errors (see dressDeckFace in engine.ts).
 */
export function deckFaceHTML(card: { name: string; rarity: OpenTier; art: { front: string; version: number } }, tier: OpenTier) {
  const T = TIER[tier];
  return (
    `<div class="${css.deckF}" style="border-color:${T.t}">` +
    `<div class="${css.deckPlate}"><b>${esc(card.name)}</b><i style="color:${T.t}">${T.name.toUpperCase()}</i></div>` +
    `<img class="${css.deckImg}" src="${esc(`${card.art.front}?v=${card.art.version}`)}" alt="" draggable="false" decoding="async"></div>`
  );
}

/** The card for a box that pays XP only: the number big on the tier colour. */
export function rewardCardSVG(opts: { xp: number; title: string }, tier: OpenTier) {
  const T = TIER[tier];
  const title = esc(opts.title.length > 20 ? opts.title.slice(0, 19) + "." : opts.title);
  return (
    `<svg viewBox="0 0 120 168" xmlns="${NS}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
    `<rect x="2" y="2" width="116" height="164" rx="12" fill="#17120f" stroke="${T.t}" stroke-width="3"/>` +
    `<rect x="9" y="9" width="102" height="104" rx="7" fill="${T.bg}"/>` +
    `<rect x="9" y="9" width="102" height="52" rx="7" fill="${T.c}" opacity=".16"/>` +
    `<circle cx="60" cy="61" r="34" fill="none" stroke="${T.t}" stroke-width="2" stroke-dasharray="3 5" opacity=".7"/>` +
    `<circle cx="60" cy="61" r="26" fill="#FF4D00"/>` +
    `<text x="60" y="68" text-anchor="middle" font-family="var(--font-poppins),sans-serif" font-weight="900" font-size="${opts.xp >= 100 ? 20 : 24}" fill="#0E0B0A">${opts.xp}</text>` +
    `<text x="60" y="101" text-anchor="middle" font-family="var(--font-mono),monospace" font-size="9" letter-spacing="2" fill="#F5EBDD">XP</text>` +
    `<text x="60" y="130" text-anchor="middle" font-family="var(--font-mono),monospace" font-size="10" fill="#F5EBDD">${title}</text>` +
    `<text x="60" y="149" text-anchor="middle" font-family="var(--font-mono),monospace" font-size="8.5" letter-spacing="1" fill="${T.t}">${T.name.toUpperCase()}</text></svg>`
  );
}

export const SWIPE_SVG =
  '<svg viewBox="0 0 34 20" aria-hidden="true"><path d="M3 10H31M26 5l5 5-5 5" fill="none" stroke="#F5EBDD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".55" stroke-dasharray="1 4"/><g class="fg"><circle cx="17" cy="10" r="5.5" fill="#F5EBDD"/><circle cx="17" cy="10" r="2.5" fill="#5B2EFF"/></g></svg>';
export const CHECK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#FF4D00" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const SHARE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4"/></svg>';
export const TAP_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="#F5EBDD"/><circle cx="12" cy="12" r="9" fill="none" stroke="#F5EBDD" stroke-width="2" opacity=".55"/></svg>';
