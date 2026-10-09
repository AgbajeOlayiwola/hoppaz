"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import m from "./today.module.css";
import { knownPalette, loadPalette, withAlpha, type Palette } from "./palette";

/** Layers that exist: the middle card and one either side. The deck is never between more than two cards. */
const MOUNT = 1;
/** Colours that are read ahead: two places either side, so the next layer is ready before it is needed. */
const PRELOAD = 2;

/** What the deck calls every frame. */
export type GlowApi = { set: (pos: number) => void };

/**
 * The screen behind the deck, tinted with the colours of the flyer in the
 * middle. One soft layer per card near the middle (three at most); as the deck
 * slides, the layer of the card the deck is passing stays full and the one after
 * it fades in on top, so the colours blend with the finger without the glow
 * thinning in the middle of the move (two half-faded layers would only cover
 * three quarters of the screen). The deck pushes `pos` straight into the layers'
 * opacity (no React state), and only opacity ever changes.
 *
 * A layer is only drawn once its flyer's colours are read (a card with no flyer
 * glows with the brand's colours at once), and it eases in the first time, so
 * the screen never flashes the wrong colour first.
 */
export default function DeckGlow({
  urls,
  index,
  api,
}: {
  /** The flyer address of every card in the deck, in order (null: no flyer). */
  urls: Array<string | null>;
  /** The card in the middle. */
  index: number;
  api: MutableRefObject<GlowApi | null>;
}) {
  const layers = useRef(new Map<number, HTMLDivElement>());
  const last = useRef(index);
  const end = useRef(urls.length - 1);
  const [, bump] = useState(0);
  useEffect(() => {
    end.current = urls.length - 1;
  });

  const paint = useCallback((pos: number) => {
    // The deck's rubber band takes it past either end; the glow stays on the end card.
    const at = Math.min(Math.max(0, end.current), Math.max(0, pos));
    last.current = at;
    layers.current.forEach((el, i) => {
      el.style.opacity = layerOpacity(i, at).toFixed(3);
    });
  }, []);

  useEffect(() => {
    api.current = { set: paint };
    return () => {
      api.current = null;
    };
  }, [api, paint]);

  // Read the colours of the cards near the middle, and draw when they arrive.
  useEffect(() => {
    let alive = true;
    for (let i = Math.max(0, index - PRELOAD); i <= Math.min(urls.length - 1, index + PRELOAD); i++) {
      if (knownPalette(urls[i])) continue;
      void loadPalette(urls[i]).then(() => alive && bump((n) => n + 1));
    }
    return () => {
      alive = false;
    };
  }, [urls, index]);

  const nodes: React.ReactNode[] = [];
  for (let i = Math.max(0, index - MOUNT); i <= Math.min(urls.length - 1, index + MOUNT); i++) {
    const pal = knownPalette(urls[i]);
    if (!pal) continue;
    nodes.push(
      <div
        key={`${i}:${urls[i] ?? ""}`}
        data-i={i}
        ref={(el) => {
          if (el) {
            layers.current.set(i, el);
            el.style.opacity = layerOpacity(i, last.current).toFixed(3);
          } else layers.current.delete(i);
        }}
        className={m.glow}
      >
        <div className={m.glowIn} style={{ background: gradient(pal) }} />
      </div>
    );
  }

  return (
    <>
      <div aria-hidden className={m.glows}>
        {nodes}
      </div>
      <div aria-hidden className={m.scrim} />
    </>
  );
}

/**
 * Between card k and card k+1 (pos = k + f), layer k stays at full and layer k+1, drawn above it, rises from 0 to 1 with f.
 * Moving back works the same way: the layer above fades out and the one under it was already full.
 */
function layerOpacity(i: number, pos: number) {
  const k = Math.floor(pos);
  if (i === k) return 1;
  if (i === k + 1) return pos - k;
  return 0;
}

/** Three soft pools of colour: the main one low in the middle, the second at the top left, the third at the bottom right. */
function gradient([a, b, c]: Palette) {
  return [
    `radial-gradient(95% 56% at 50% 58%, ${withAlpha(a, 0.95)}, transparent 68%)`,
    `radial-gradient(80% 52% at 0% 18%, ${withAlpha(b, 0.8)}, transparent 66%)`,
    `radial-gradient(80% 54% at 100% 92%, ${withAlpha(c, 0.9)}, transparent 66%)`,
    `radial-gradient(60% 40% at 100% 4%, ${withAlpha(b, 0.45)}, transparent 70%)`,
  ].join(",");
}
