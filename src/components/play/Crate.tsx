import type { PlayTier } from "@/lib/playTypes";

/**
 * The crate, drawn in CSS and SVG like the approved mock (a second WebGL context
 * would hurt a cheap phone). Tier is colour: Common cream, Rare violet, Epic pink,
 * Legendary gold. Left face lit, right face in shade, lid on top, a tape stripe.
 */
export const TIER_ART: Record<PlayTier, { name: string; c: string; t: string; l: string; r: string; tape: string }> = {
  common: { name: "Common", c: "#C9B9A3", t: "#E4D8C6", l: "#C9B9A3", r: "#9C8E7B", tape: "#B83600" },
  rare: { name: "Rare", c: "#5B2EFF", t: "#8A66FF", l: "#5B2EFF", r: "#3A1CB5", tape: "#F5EBDD" },
  epic: { name: "Epic", c: "#E83F6F", t: "#F2739A", l: "#E83F6F", r: "#A82650", tape: "#F5EBDD" },
  legendary: { name: "Legendary", c: "#F4B728", t: "#FFD966", l: "#F4B728", r: "#B9830F", tape: "#F5EBDD" },
};

export default function Crate({ tier }: { tier: PlayTier }) {
  const T = TIER_ART[tier];
  return (
    <svg viewBox="0 0 48 52" aria-hidden focusable="false" className="block h-full w-full overflow-visible">
      <polygon points="4,16 24,26 24,48 4,38" fill={T.l} />
      <polygon points="44,16 24,26 24,48 44,38" fill={T.r} />
      <polygon points="11,19.5 17,22.5 17,44.5 11,41.5" fill={T.tape} opacity=".95" />
      <path d="M4 16 24 26 44 16" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="1" />
      <path d="M24 26V48" stroke="rgba(0,0,0,.25)" strokeWidth="1" />
      <polygon points="24,6 44,16 24,26 4,16" fill={T.t} />
      <polygon points="31,9.5 37,12.5 17,22.5 11,19.5" fill={T.tape} opacity=".95" />
      <path d="M4 16 24 6 44 16" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1" />
    </svg>
  );
}
