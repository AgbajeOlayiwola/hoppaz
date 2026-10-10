"use client";

import { useState } from "react";
import clsx from "clsx";
import { artUrl, shortDay, thumbSrcSet, type DeckCard } from "@/lib/cards";
import { RARITY_LOOK, copiesLine } from "@/lib/deck";
import { haptics } from "@/lib/haptics";
import { sfx } from "@/lib/sound/sfx";
import VisitedStamp from "./VisitedStamp";
import css from "./CardFace.module.css";

/* eslint-disable @next/next/no-img-element -- fixed 720x1152 WebP files from /public/cards: next/image would only re-encode them */

type Props = {
  card: DeckCard;
  /** tile: the 180x288 thumbnail, still (the album grid). full: the 720x1152 front, tap to flip to the back. */
  mode?: "tile" | "full";
  /** A card you do not hold: a dark silhouette. No image is loaded; the name is drawn only if showName is on. */
  locked?: boolean;
  showName?: boolean;
  /** How many rarities the deck has (catalog.tiers.length): the silhouette draws that many pips, so no tier the deck lacks is hinted at. */
  tiers?: number;
  /** A tile's width on screen, for `sizes`: the browser then picks the 180 px or the 360 px thumb. */
  tileSizes?: string;
  visited?: boolean;
  /** The play-day the stamp was made, as 2026-10-09. */
  visitedOn?: string | null;
  /** The stamp lands now (a first stamp): it is struck in with the 180ms stamp, not just there. */
  stampIn?: boolean;
  /** Your copy number. Drawn on a numbered card only ("NO. 7 OF 100"); a Rare copy has a number but is not numbered. */
  copyNo?: number | null;
  /** Copies you hold, shown as "x2" on a tile. */
  count?: number;
  /** Controlled flip. Leave out to let the card keep its own side. */
  flipped?: boolean;
  onFlip?: (flipped: boolean) => void;
  /** Load the image now, not when it nears the screen (the card you are looking at). */
  priority?: boolean;
  className?: string;
};

/**
 * One card, drawn the way the deck is: the front and back are the Hoppaz art (WebP, lazy), and what changes from
 * Hopper to Hopper is drawn on top in code: the rarity edge (Rare and Epic glow), your copy number, the Visited
 * stamp. A card you do not hold is a dark silhouette with only its rarity pips showing (one per rarity the deck has).
 *
 * Tapping a full card flips it in 3D (sfx.flip). With reduced motion the flip is a quick fade and the Epic glow
 * holds still.
 */
export default function CardFace({
  card,
  mode = "full",
  locked = false,
  showName = false,
  tiers,
  tileSizes = "112px",
  visited = false,
  visitedOn = null,
  stampIn = false,
  copyNo = null,
  count = 1,
  flipped,
  onFlip,
  priority = false,
  className,
}: Props) {
  const look = RARITY_LOOK[card.rarity];
  const [own, setOwn] = useState(false);
  const [seen, setSeen] = useState(false);
  const side = flipped ?? own;
  const scene = clsx(css.scene, card.rarity === "rare" && css.rare, card.rarity === "epic" && css.epic, className);
  const vars = { ["--rim" as string]: look.color, ["--glow" as string]: look.glow } as React.CSSProperties;
  const eager = priority ? "eager" : "lazy";
  // A tile sits inside the album's <button>, which may only hold phrasing content: spans there, a div for the full card.
  const Wrap = mode === "tile" ? "span" : "div";

  if (locked) {
    return (
      <Wrap className={scene} style={vars}>
        <span
          role="img"
          aria-label={showName ? `${card.name}, locked ${look.label.toLowerCase()} card` : `Locked ${look.label.toLowerCase()} card from ${card.setName}`}
          className={css.locked}
        >
          <span aria-hidden className={css.pips}>
            {Array.from({ length: Math.max(tiers ?? look.pips, look.pips) }, (_, i) => (
              <i key={i} className={clsx(css.pip, i < look.pips && css.pipOn)} />
            ))}
          </span>
          {showName ? (
            <span aria-hidden className={css.lockedName}>
              {card.name}
            </span>
          ) : (
            <span aria-hidden className={css.lockedMark}>
              ?
            </span>
          )}
          <span aria-hidden className={css.lockedFoot}>
            <span style={{ color: look.onDark }}>{look.label}</span>
            <span className={css.lockedCopies}>{copiesLine(card)}</span>
          </span>
        </span>
      </Wrap>
    );
  }

  const stamp = visited && (
    <span className={css.stamp}>
      <span className={clsx("block", stampIn && css.stampIn)}>
        <VisitedStamp date={visitedOn ? shortDay(visitedOn).toUpperCase() : undefined} dateClassName={css.stampDate} />
      </span>
    </span>
  );

  if (mode === "tile") {
    return (
      <Wrap className={scene} style={vars}>
        <span aria-hidden className={css.halo} />
        <span className={css.face}>
          <img
            src={artUrl(card, "thumb")}
            srcSet={thumbSrcSet(card)}
            sizes={tileSizes}
            alt=""
            width={180}
            height={288}
            loading={eager}
            decoding="async"
            draggable={false}
            className={css.img}
          />
          {stamp}
          <span aria-hidden className={css.edge} />
          {count > 1 && <span className={css.count}>x{count}</span>}
        </span>
      </Wrap>
    );
  }

  const flip = () => {
    const next = !side;
    if (flipped === undefined) setOwn(next);
    setSeen(true);
    onFlip?.(next);
    haptics.buzz("snap");
    sfx.flip();
  };
  const numbered = card.numbered && copyNo && card.copiesTotal ? { no: copyNo, of: card.copiesTotal } : null;

  return (
    <div className={scene} style={vars}>
      <span aria-hidden className={css.halo} />
      <div className={css.persp}>
        <button
          type="button"
          onClick={flip}
          data-flipped={side}
          aria-label={`${card.name}, ${look.label.toLowerCase()} card${visited ? ", visited" : ""}. Showing the ${side ? "back" : "front"}. Tap to flip.`}
          className={css.card}
        >
          <span className={clsx(css.face, css.front)} aria-hidden={side}>
            <img
              src={artUrl(card, "front")}
              alt=""
              width={720}
              height={1152}
              loading={eager}
              decoding="async"
              draggable={false}
              className={css.img}
              onLoad={() => setSeen(true)}
            />
            {numbered && (
              <span className={css.number}>
                NO. {numbered.no} OF {numbered.of}
              </span>
            )}
            {stamp}
            <span aria-hidden className={css.edge} />
          </span>
          <span className={clsx(css.face, css.back)} aria-hidden={!side}>
            {/* The back waits for the front (or the first flip), so it never competes with it for the connection. */}
            {seen && <img src={artUrl(card, "back")} alt="" width={720} height={1152} loading="lazy" decoding="async" draggable={false} className={css.img} />}
            {numbered && (
              <span aria-hidden className={css.serial}>
                <b>{numbered.no}</b>
                <i>OF {numbered.of} A SEASON</i>
              </span>
            )}
            <span aria-hidden className={css.edge} />
          </span>
        </button>
      </div>
    </div>
  );
}
