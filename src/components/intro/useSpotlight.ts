"use client";

import { useEffect, useState, type RefObject } from "react";
import { targetSelector, type IntroTarget } from "@/lib/intro/steps";

/**
 * Finds the spotlight target, follows it, and works out where the card goes.
 *
 * One requestAnimationFrame loop while a step is current. Each pass reads (the
 * target's rect, once) and then writes (a transform on the ring and the
 * arrow, custom properties on the root), in that order, so nothing forces a
 * second layout. React state changes only when the answer changes in kind:
 * found or not, which zone, blocked or not. A map marker moving 60 times a
 * second moves the ring and re-renders nothing.
 *
 * Blocked means a sheet, the open stage, the title sequence or the sign-up
 * sheet is on screen. A dialog that contains the target does not block (the
 * event chat link lives in one).
 */

export type Zone = "none" | "nav" | "upper" | "lower";
export type Geo = { found: boolean; zone: Zone; blocked: boolean; pazLeft: boolean };

const PAD = 8;
/** The arrow between the ring and the card: 36 tall, 4 off the ring, a little air. */
const ARROW = 44;
/** Room for Paz above a top-docked card (the dock's padding-top in intro.module.css; the party moments have a bigger Paz). */
const HEAD = 112;
const HEAD_BIG = 142;
const HEAD_COMPACT = 62;
/** What the small Paz shows above the card, plus a little air: the room a screen keeps for the card (--intro-reserve). */
const PEEK = 58;
/** Paz's drawing is narrower than her box: this much each side does not count when she is tested against the ring. */
const SLACK = 10;
const REAPPEAR_MS = 450;
const SLOW_MS = 250;

function firstVisible(sels: string[]): Element | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const sel of sels) {
    const all = document.querySelectorAll(sel);
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
      return el;
    }
  }
  return null;
}

function dialogUp(target: Element | null): boolean {
  const ds = document.querySelectorAll('[role="dialog"]');
  for (const d of ds) {
    if (d.closest("[data-intro-root]")) continue;
    if (d.getClientRects().length === 0) continue;
    if (target && d.contains(target)) continue;
    return true;
  }
  return false;
}

export function useSpotlight({
  targets,
  enabled,
  reserve,
  rootRef,
  ringRef,
  arrowRef,
}: {
  targets: IntroTarget[];
  enabled: boolean;
  /** The screen keeps room for the card: its height goes to --intro-reserve on the page root. */
  reserve: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  ringRef: RefObject<HTMLDivElement | null>;
  arrowRef: RefObject<HTMLDivElement | null>;
}): Geo {
  const [geo, setGeo] = useState<Geo>({ found: false, zone: "none", blocked: false, pazLeft: true });
  const key = targets.join("|");

  useEffect(() => {
    const root = rootRef.current;
    const ring = ringRef.current;
    const arrow = arrowRef.current;
    if (!enabled || !root || !ring || !arrow) return;

    const sels = key ? key.split("|").map((t) => targetSelector(t as IntroTarget)) : [];
    let raf = 0;
    let el: Element | null = null;
    let last = 0;
    let lastChrome = -1000;
    let blocked = false;
    let unblockAt = 0;
    let zone: Zone = "none";
    let pazLeft = true;
    let found = false;
    let drawn = "";
    let side = "";
    let bottomPx = -1;
    let topPx = -1;
    let cssBottom = "";
    let cssTop = "";
    let cssReserve = "";

    const setReserve = (px: string) => {
      if (px === cssReserve) return;
      cssReserve = px;
      const html = document.documentElement;
      if (px) {
        html.style.setProperty("--intro-reserve", px);
        html.dataset.introReserve = "1";
      } else {
        html.style.removeProperty("--intro-reserve");
        delete html.dataset.introReserve;
      }
    };

    const publish = () =>
      setGeo((g) => (g.found === found && g.zone === zone && g.blocked === blocked && g.pazLeft === pazLeft ? g : { found, zone, blocked, pazLeft }));

    const hideRing = () => {
      if (drawn !== "off") {
        ring.dataset.on = "false";
        arrow.dataset.on = "false";
        drawn = "off";
      }
    };

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // Hidden, or nothing to follow: a slow look is enough.
      const slow = blocked || !el;
      if (t - last < (slow ? SLOW_MS : 32)) return;
      last = t;

      /* ---- read ---- */
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (el && !el.isConnected) el = null;
      let rect = el ? el.getBoundingClientRect() : null;
      if (rect && (rect.width < 1 || rect.height < 1 || rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh)) {
        el = null;
        rect = null;
      }
      if (!el && sels.length) {
        el = firstVisible(sels);
        rect = el ? el.getBoundingClientRect() : null;
      }

      const cardRect = root.querySelector('[role="region"]')?.getBoundingClientRect();
      const cardH = cardRect?.height ?? 0;
      const cardL = cardRect?.left ?? 16;
      const cardR = cardRect?.right ?? vw - 16;
      const raw = dialogUp(el);
      if (raw) {
        blocked = true;
        unblockAt = 0;
      } else if (blocked) {
        if (!unblockAt) unblockAt = t + REAPPEAR_MS;
        else if (t >= unblockAt) {
          blocked = false;
          unblockAt = 0;
        }
      }

      if (t - lastChrome > 300) {
        lastChrome = t;
        const nav = document.querySelector('nav[aria-label="Main"]')?.getBoundingClientRect();
        const tray = document.querySelector(".hz-tray")?.getBoundingClientRect();
        // On a phone the card spans the width, so the whole HUD row is in its way. On a wide screen it is a narrow card in the
        // middle: only the streak pips (also in the middle) are.
        const hud = document.querySelector(vw >= 700 ? ".hz-pips" : ".hz-hud-top")?.getBoundingClientRect();
        const navH = nav && nav.top < vh && nav.height > 0 ? vh - nav.top : 0;
        const trayH = tray && tray.height > 0 ? vh - tray.top : 0;
        bottomPx = Math.max(navH, trayH);
        topPx = hud && hud.height > 0 ? hud.bottom : 0;
      }

      /* ---- decide ---- */
      found = !!rect;
      let cx = vw / 2;
      let clashTop = false;
      let head = HEAD;
      let cardHeight = 0;
      let ringTop = 0;
      let ringBottom = 0;
      if (rect) {
        const cy = rect.top + rect.height / 2;
        cx = rect.left + rect.width / 2;
        const lowerEdge = zone === "lower" ? 0.46 : 0.56;
        zone = rect.bottom > vh - 110 || el?.closest("nav") ? "nav" : cy > vh * lowerEdge ? "lower" : "upper";
        if (pazLeft && cx < vw * 0.4) pazLeft = false;
        else if (!pazLeft && cx > vw * 0.6) pazLeft = true;
        // The card goes on the side the target is not on. On a short screen that side can still reach the target
        // (a box just under the middle, the card docked above it): then it takes the other side, if that one is clear.
        // The card's own height and Paz's headroom are measured, not guessed, the arrow counts as part of the target,
        // and so does Paz: she stands on the card's edge, so she can sit over a target above a bottom-docked card
        // unless she takes the other corner.
        clashTop = false;
        if (zone === "lower" || zone === "upper") {
          const dock = root.querySelector("[data-at]");
          const compact = dock?.getAttribute("data-compact") === "true";
          const big = dock?.getAttribute("data-big") === "true";
          head = compact ? HEAD_COMPACT : big ? HEAD_BIG : HEAD;
          const pazSize = compact ? 84 : big ? 156 : 122;
          const over = compact ? 54 : pazSize - 20;
          const ch = cardH || 190;
          const h = Math.max(56, rect.height + PAD * 2);
          const wRing = Math.max(56, rect.width + PAD * 2);
          ringTop = cy - h / 2;
          ringBottom = cy + h / 2;
          const ringL = cx - wRing / 2 - 4;
          const ringR = cx + wRing / 2 + 4;
          const reach = (x0: number) => Math.max(0, Math.min(x0 + pazSize - SLACK, ringR) - Math.max(x0 + SLACK, ringL));
          const hitL = reach(cardL + 8);
          const hitR = reach(cardR - 8 - pazSize);
          if (pazLeft && hitL > 0 && hitR === 0) pazLeft = false;
          else if (!pazLeft && hitR > 0 && hitL === 0) pazLeft = true;
          const pazHits = (pazLeft ? hitL : hitR) > 0;
          const topStart = (topPx > 0 ? topPx + 8 : 12) + head;
          const botEnd = vh - (bottomPx > 0 ? bottomPx + 12 : 12);
          clashTop =
            (topStart + ch > ringTop - ARROW && topStart < ringBottom) ||
            (pazHits && topStart - over < ringBottom && topStart > ringTop - ARROW);
          const clashBottom =
            (botEnd - ch < ringBottom + ARROW && botEnd > ringTop) ||
            (pazHits && botEnd - ch - over < ringBottom + ARROW && botEnd - ch > ringTop);
          if (zone === "lower" && clashTop && !clashBottom) zone = "upper";
          else if (zone === "upper" && clashBottom && !clashTop) zone = "lower";
          cardHeight = ch;
        }
      } else {
        zone = "none";
        pazLeft = true;
      }

      /* ---- write ---- */
      let b = bottomPx > 0 ? bottomPx + 12 : 0;
      // A target on the bottom bar: the card sits above its ring and arrow.
      if (zone === "nav" && rect) b = Math.max(b, vh - rect.top + PAD + 44);
      const nextBottom = b > 0 ? `${Math.round(b)}px` : "calc(env(safe-area-inset-bottom, 0px) + 12px)";
      let nextTop = topPx > 0 ? `${Math.round(topPx + 8)}px` : "calc(env(safe-area-inset-top, 0px) + 12px)";
      // Docked on top and still in the way of a small target (neither side was clear): ride up over the HUD, so the
      // card ends above the target's arrow. A target as big as the screen (the deck) keeps the normal dock.
      if (zone === "lower" && rect && clashTop && rect.height < vh * 0.5) {
        const up = ringTop - ARROW - cardHeight - head;
        nextTop = `max(calc(env(safe-area-inset-top, 0px) + 8px), ${Math.round(up)}px)`;
      }
      if (nextBottom !== cssBottom) {
        cssBottom = nextBottom;
        root.style.setProperty("--ic-bottom", nextBottom);
      }
      if (nextTop !== cssTop) {
        cssTop = nextTop;
        root.style.setProperty("--ic-top", nextTop);
      }
      setReserve(reserve && cardH > 0 ? `${Math.round(cardH + PEEK)}px` : "");
      const pz = pazLeft ? "left" : "right";
      if (root.dataset.paz !== pz) root.dataset.paz = pz;

      if (!rect || blocked) {
        hideRing();
      } else {
        const round = rect.width < 130 && rect.height < 130 && Math.abs(rect.width - rect.height) < Math.max(10, rect.width * 0.18);
        const w = Math.max(56, rect.width + PAD * 2);
        const h = Math.max(56, rect.height + PAD * 2);
        const x = Math.round((rect.left + rect.width / 2 - w / 2) * 2) / 2;
        const y = Math.round((rect.top + rect.height / 2 - h / 2) * 2) / 2;
        const sig = `${x}|${y}|${w}|${h}|${round}`;
        if (sig !== drawn) {
          if (drawn === "off" || drawn === "") {
            ring.dataset.on = "true";
            arrow.dataset.on = "true";
          }
          drawn = sig;
          ring.style.width = `${w}px`;
          ring.style.height = `${h}px`;
          ring.style.borderRadius = round ? "9999px" : "16px";
          ring.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          // The arrow sits between the ring and the card, pointing at the ring.
          const above = zone === "lower" || zone === "nav";
          const nextSide = above ? "above" : "below";
          if (nextSide !== side) {
            side = nextSide;
            arrow.dataset.side = side;
          }
          const ax = Math.round(x + w / 2 - 15);
          const ay = above ? y - 40 : y + h + 4;
          arrow.style.transform = `translate3d(${ax}px, ${ay}px, 0)`;
        }
      }
      publish();
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      hideRing();
      setReserve("");
    };
  }, [enabled, key, reserve, rootRef, ringRef, arrowRef]);

  return geo;
}
