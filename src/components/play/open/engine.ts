import { sfx } from "@/lib/sound/sfx";
import { haptics } from "@/lib/haptics";
import { levelFor } from "@/lib/brand";
import s from "./OpenStage.module.css";
import { cardSVG, crateSVG, rewardCardSVG, CHECK_SVG, SHARE_SVG, SWIPE_SVG, TAP_SVG } from "./art";
import { MAP_SCALE, TIER } from "./tiers";
import { emitOpenEvent } from "./events";
import type { ClaimOk, ClaimRefused, ClaimResult, LandKind, OpenTargets, OpenTier } from "./types";

/*
 * The open moment, ported from the approved mock (part2.html). Imperative DOM and
 * the Web Animations API on purpose: only transform and opacity move, nothing
 * reads layout while an animation runs, and there is no second WebGL context.
 *
 * Coordinates are screen pixels (the stage is the whole viewport). Every size is
 * scaled by U, which follows the screen (1 on the mock's 360 x 720 phone).
 */

type Pt = { x: number; y: number; w: number; h: number; l: number; t: number };

type Item =
  | { type: "xp"; v: number; x?: number; y?: number; done?: boolean }
  | { type: "card"; card: { key: string; name: string }; x?: number; y?: number; done?: boolean }
  | { type: "stamp"; x?: number; y?: number; done?: boolean };

/** The big card that rare, epic and legendary boxes show: a collectible, or the XP reward when there is no collectible. */
type BigCard = { kind: "collectible"; card: { key: string; name: string } } | { kind: "xp"; xp: number; title: string };

export type EngineDeps = {
  root: HTMLElement;
  stage: HTMLElement;
  dim: HTMLElement;
  tier: OpenTier;
  claim: () => Promise<ClaimResult>;
  targets: () => OpenTargets;
  origin: () => { x: number; y: number } | null;
  firstOfDay: () => boolean;
  xpBefore: () => number | null;
  share: (title: string) => void;
  onLand: (kind: LandKind, result: ClaimOk) => void;
  onDone: (r: ClaimResult) => void;
  onCancel: () => void;
  say: (text: string) => void;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const tf = (x: number, y: number, sc = 1, r = 0) => `translate(${x}px,${y}px) scale(${sc}) rotate(${r}deg)`;

const NOOP_ANIM = { cancel() {}, pause() {}, play() {}, playbackRate: 1, onfinish: null } as unknown as Animation;
function anim(e: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation {
  try {
    return e.animate(frames, { fill: "forwards", ...opts });
  } catch {
    return NOOP_ANIM;
  }
}

/* ----------------------------------------------------- landing effects -- */
/* They live in a layer on the body, so they finish even after the stage is gone. */
function fxLayer(u: number): HTMLElement {
  let l = document.querySelector<HTMLElement>("[data-hz-open-fx]");
  if (!l) {
    l = document.createElement("div");
    l.className = s.fx;
    l.setAttribute("data-hz-open-fx", "");
    l.setAttribute("aria-hidden", "true");
    document.body.append(l);
  }
  l.style.setProperty("--u", String(u));
  return l;
}
function fxDrop(el: HTMLElement) {
  el.remove();
  const l = document.querySelector("[data-hz-open-fx]");
  if (l && !l.childElementCount) l.remove();
}

export type OpenEngine = {
  start: () => void;
  /** Four-box path: Reveal already played; fly what came out into the tray. */
  flyOnly: (res: ClaimOk) => void;
  cancel: () => void;
  /** Enter, Space or Escape on the stage (keyboard players). */
  key: (k: "advance" | "escape") => void;
  destroy: () => void;
};

export function createOpenEngine(d: EngineDeps): OpenEngine {
  const { stage, dim, root, tier } = d;
  const T = TIER[tier];
  const RM = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LOW = typeof navigator !== "undefined" && ((navigator.hardwareConcurrency || 8) <= 2 || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 8) <= 2);
  /** Reduced motion keeps every beat but halves the waits and drops the shake and freeze. */
  const D = (ms: number) => (RM ? Math.round(ms * 0.5) : ms);

  let W = 360;
  let H = 720;
  let U = 1;
  let CX = 180;
  let CY = 340;
  const measure = () => {
    W = stage.clientWidth || window.innerWidth;
    H = stage.clientHeight || window.innerHeight;
    U = clamp(Math.min(W / 360, H / 720), 0.85, 1.5);
    CX = W / 2;
    CY = H * 0.472;
    root.style.setProperty("--u", String(U));
  };

  let TM: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }, ms);
    TM.push(id);
    return id;
  };
  const clearTM = () => {
    TM.forEach(clearTimeout);
    TM = [];
  };

  let destroyed = false;
  let committed = false;
  let ready = false;
  let cardUp = false;
  let finished = false;
  let skipped = false;
  let canSkip = false;
  let result: ClaimOk | null = null;
  let crate: HTMLElement | null = null;
  let hint: HTMLElement | null = null;
  let edgeEl: HTMLElement | null = null;
  let raysEl: HTMLElement | null = null;
  let waitAnim: Animation | null = null;
  let cardGo: (() => void) | null = null;
  let startTimer: ReturnType<typeof setTimeout> | undefined;

  /* ------------------------------------------------------------ helpers -- */
  function mk(cls: string, w: number, h: number, html?: string) {
    const e = document.createElement("div");
    e.className = cls;
    e.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px;`;
    if (html) e.innerHTML = html;
    stage.appendChild(e);
    return e;
  }
  function plain(cls: string) {
    const e = document.createElement("div");
    e.className = cls;
    stage.appendChild(e);
    return e;
  }
  const put = (e: HTMLElement, x: number, y: number, sc?: number, r?: number) => {
    e.style.transform = tf(x, y, sc, r);
  };

  const pt = (r: DOMRect | null, fb: Pt): Pt =>
    r && r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top } : fb;
  const where = {
    xp: (): Pt => pt(d.targets().xp, { x: W - 14 * U - 54 * U, y: 38 * U, w: 108 * U, h: 10 * U, l: W - 14 * U - 108 * U, t: 33 * U }),
    shelf: (): Pt => pt(d.targets().shelf, { x: 44 * U, y: H - 14 * U - 40 * U, w: 30 * U, h: 30 * U, l: 29 * U, t: H - 69 * U }),
    pips: (): Pt => pt(d.targets().pips, { x: W / 2, y: 28 * U, w: 100 * U, h: 12 * U, l: W / 2 - 50 * U, t: 22 * U }),
  };
  const targetOf = (it: Item) => (it.type === "xp" ? where.xp() : it.type === "card" ? where.shelf() : where.pips());

  /* --------------------------------------------------- landing effects -- */
  function ringAt(p: Pt, size: number, color: string) {
    const l = fxLayer(U);
    const r = document.createElement("div");
    r.className = s.ring;
    r.style.cssText = `width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;--tc:${color}`;
    l.append(r);
    const a = anim(r, [{ transform: tf(p.x, p.y, 0.5), opacity: 0.95 }, { transform: tf(p.x, p.y, 1.7), opacity: 0 }], { duration: D(460), easing: "cubic-bezier(.1,.7,.3,1)" });
    a.onfinish = () => fxDrop(r);
  }
  /** A bright band runs across the XP bar: the fill, without pretending to know the bar's numbers. */
  function sweepAt(p: Pt) {
    const l = fxLayer(U);
    const w = document.createElement("div");
    w.className = s.sweep;
    w.style.cssText = `left:${p.l}px;top:${p.t}px;width:${p.w}px;height:${p.h}px`;
    const i = document.createElement("i");
    w.append(i);
    l.append(w);
    anim(w, [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: D(560) });
    const a = anim(i, [{ transform: "translateX(-100%)" }, { transform: "translateX(100%)" }], { duration: D(500), easing: "cubic-bezier(.2,.8,.3,1)" });
    a.onfinish = () => fxDrop(w);
  }
  /** "+30" under the XP bar, counting up in 50 ms ticks. */
  function chipAt(p: Pt, v: number) {
    const l = fxLayer(U);
    const c = document.createElement("div");
    c.className = s.chip;
    c.textContent = "+0";
    l.append(c);
    const x = clamp(p.x, 40 * U, W - 40 * U);
    const y = p.t + p.h + 24 * U;
    const tr = (dy: number) => `translate(${x}px,${y + dy}px) translate(-50%,-50%)`;
    anim(c, [{ transform: tr(8), opacity: 0 }, { transform: tr(0), opacity: 1 }], { duration: D(140) });
    const steps = Math.max(2, Math.min(Math.abs(v), 10));
    let i = 0;
    const iv = setInterval(() => {
      i++;
      c.textContent = "+" + Math.round((v * i) / steps);
      // the UI lane lets two ticks through a second, so they go partway and on the number landing (as in Reveal)
      if (i === steps || i === steps - 4) sfx.tick(Math.ceil(i / 2));
      if (i >= steps) {
        clearInterval(iv);
        c.textContent = "+" + v;
        setTimeout(() => {
          const a = anim(c, [{ transform: tr(0), opacity: 1 }, { transform: tr(-14), opacity: 0 }], { duration: D(300) });
          a.onfinish = () => fxDrop(c);
        }, D(650));
      }
    }, D(50));
  }
  function levelAt(p: Pt, name: string) {
    const l = fxLayer(U);
    const e = document.createElement("div");
    e.className = s.lvl;
    e.innerHTML = `<small>LEVEL UP</small><b></b>`;
    (e.querySelector("b") as HTMLElement).textContent = name;
    l.append(e);
    const w = e.offsetWidth || 120;
    const x = clamp(p.x, w / 2 + 10, W - w / 2 - 10);
    const y = p.t + p.h + 62 * U;
    const tr = (sc: number, dy = 0) => `translate(${x}px,${y + dy}px) translate(-50%,-50%) scale(${sc})`;
    anim(e, [{ transform: tr(0.4), opacity: 0 }, { transform: tr(1.14), opacity: 1, offset: 0.6 }, { transform: tr(1), opacity: 1 }], { duration: D(460), easing: "cubic-bezier(.3,1.6,.5,1)" });
    setTimeout(() => {
      const a = anim(e, [{ transform: tr(1), opacity: 1 }, { transform: tr(1, -10), opacity: 0 }], { duration: D(320) });
      a.onfinish = () => fxDrop(e);
    }, D(1500));
    ringAt(p, p.h * 4 + 20 * U, "#FF4D00");
  }

  function land(it: Item) {
    if (it.done || !result) return;
    it.done = true;
    if (it.type === "xp") {
      const p = where.xp();
      sfx.fill();
      sweepAt(p);
      ringAt(p, 30 * U, "#FF4D00");
      chipAt(p, it.v);
      const before = d.xpBefore();
      if (before != null) {
        const a = levelFor(before);
        const b = levelFor(before + it.v);
        if (b.index > a.index) {
          setTimeout(() => {
            sfx.crowdEhn();
            sfx.sparkle();
            levelAt(where.xp(), b.name);
            haptics.buzz("levelUp");
          }, D(520));
        }
      }
      d.onLand("xp", result);
    } else if (it.type === "card") {
      ringAt(where.shelf(), 46 * U, "#F5EBDD");
      sfx.click();
      d.onLand("collectible", result);
    } else {
      ringAt(where.pips(), 26 * U, "#FF4D00");
      sfx.stamp();
      haptics.buzz("stampSmall");
      d.onLand("stamp", result);
    }
  }

  /* ---------------------------------------------------- items and flight -- */
  function itemEl(it: Item) {
    let inner = "";
    let lab = "";
    if (it.type === "xp") {
      inner = `<div class="${s.orb}">+${it.v}</div>`;
      lab = "XP";
    } else if (it.type === "stamp") {
      inner = `<div class="${s.stampi}">${CHECK_SVG}</div>`;
      lab = "TODAY";
    } else {
      inner = `<div class="${s.mini}">${cardSVG(it.card, tier)}</div>`;
    }
    const h = it.type === "card" ? 66 * U : 60 * U;
    const e = mk(s.item, 72 * U, h + 16 * U, inner + (lab ? `<span>${lab}</span>` : ""));
    return e;
  }
  function fan(list: Item[], t0: number, gap: number, ys?: number) {
    const n = list.length;
    const out: { el: HTMLElement; it: Item }[] = [];
    list.forEach((it, i) => {
      const el = itemEl(it);
      const x = CX + (i - (n - 1) / 2) * 76 * U;
      const y = (ys ?? CY - 132 * U) - (i % 2 ? 0 : 14 * U);
      put(el, CX, CY - 20 * U, 0.2);
      el.style.opacity = "0";
      it.x = x;
      it.y = y;
      out.push({ el, it });
      at(t0 + i * gap, () => {
        anim(
          el,
          [
            { transform: tf(CX, CY - 20 * U, 0.2), opacity: 0 },
            { transform: tf(x, y - 22 * U, 1.3, i % 2 ? 7 : -7), opacity: 1, offset: 0.6 },
            { transform: tf(x, y, 1, 0), opacity: 1 },
          ],
          { duration: D(340), easing: "cubic-bezier(.2,.9,.3,1)" }
        );
        sfx.chime(i);
      });
    });
    return out;
  }
  function flyItem(en: { el: HTMLElement; it: Item }, dur = 380) {
    if (destroyed) return;
    sfx.fly();
    const t = targetOf(en.it);
    const a = anim(en.el, [{ transform: tf(en.it.x ?? CX, en.it.y ?? CY, 1), opacity: 1 }, { transform: tf(t.x, t.y, 0.42), opacity: 1 }], {
      duration: D(dur),
      easing: "cubic-bezier(.55,0,.9,.6)",
    });
    a.onfinish = () => {
      en.el.remove();
      if (!destroyed) land(en.it);
    };
  }
  function landAllInstant(list: Item[]) {
    list.forEach((it) => land(it));
    stage.querySelectorAll("." + s.item).forEach((e) => e.remove());
  }

  /* ------------------------------------------------------------ effects -- */
  function squash(c: HTMLElement, ms: number) {
    anim(c, [{ transform: tf(CX, CY, 1) }, { transform: `translate(${CX}px,${CY + 9 * U}px) scale(1.08,.88)` }, { transform: tf(CX, CY, 1) }], { duration: ms + 60, easing: "ease-out" });
  }
  function rip(c: HTMLElement) {
    c.querySelectorAll<SVGElement>(".tp").forEach((t) => {
      t.style.transition = "opacity .12s";
      t.style.opacity = "0";
    });
    for (let i = 0; i < 2; i++) {
      const bit = mk(s.p, 34 * U, 9 * U, "");
      bit.style.background = T.tape;
      const x0 = CX + (i ? 14 : -14) * U;
      put(bit, x0, CY - 24 * U, 1, i ? 30 : -30);
      anim(bit, [{ transform: tf(x0, CY - 24 * U, 1, i ? 30 : -30), opacity: 1 }, { transform: tf(CX + (i ? 96 : -96) * U, CY - 100 * U, 0.8, i ? 200 : -200), opacity: 0 }], { duration: D(520), easing: "ease-out" });
      at(650, () => bit.remove());
    }
    sfx.rip();
    // No buzz here: the burst follows within 120 ms, and a buzz inside the 400 ms window would swallow its pattern.
  }
  function burst(o: { n?: number; waves?: number; big?: boolean; pw?: number; dur?: number } = {}) {
    const n = Math.round((o.n || 18) * (LOW ? 0.6 : 1));
    const anims: Animation[] = [];
    const cols = [T.c, T.t, "#F5EBDD", T.c];
    const cy = CY - 14 * U;
    const waves = o.waves || 1;
    for (let w = 0; w < waves; w++) {
      const wv = mk(s.wave, 120 * U, 120 * U, "");
      wv.style.setProperty("--tc", T.t);
      put(wv, CX, cy, 0.2);
      anims.push(anim(wv, [{ transform: tf(CX, cy, 0.2), opacity: 0.95 }, { transform: tf(CX, cy, o.big ? 5 : 3.4), opacity: 0 }], { duration: D(o.big ? 900 : 520), delay: w * 130, easing: "cubic-bezier(.1,.7,.3,1)" }));
      at(1200 + w * 130, () => wv.remove());
    }
    const bits: HTMLElement[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      const dd = (o.big ? rnd(120, 300) : rnd(70, 170)) * (o.pw || 1) * U;
      const sz = rnd(4, 9) * U;
      const p = mk(s.p, sz * 1.7, sz, "");
      p.style.background = cols[i % 4];
      if (i % 3 === 0) p.style.borderRadius = "50%";
      put(p, CX, cy, 1);
      bits.push(p);
      anims.push(
        anim(
          p,
          [
            { transform: tf(CX, cy, 1, 0), opacity: 1 },
            { transform: tf(CX + Math.cos(a) * dd, cy + Math.sin(a) * dd * 0.8, 1, rnd(-300, 300)), opacity: 1, offset: 0.55 },
            { transform: tf(CX + Math.cos(a) * dd * 1.1, cy + Math.sin(a) * dd * 0.8 + 40 * U, 0.6, rnd(-500, 500)), opacity: 0 },
          ],
          { duration: D(o.dur || rnd(500, 860)), easing: "cubic-bezier(.1,.8,.3,1)" }
        )
      );
    }
    at(2400, () => bits.forEach((b) => b.remove()));
    const c = crate;
    if (c) {
      const lid = c.querySelector<SVGElement>(".c-lid");
      const gl = c.querySelector<SVGElement>(".c-glow");
      const g2 = c.querySelector<SVGElement>(".c-glow2");
      if (lid) anim(lid, [{ transform: "translateY(0) rotate(0)", opacity: 1 }, { transform: "translateY(-26px) rotate(-14deg)", opacity: 0 }], { duration: D(o.big ? 520 : 380), easing: "ease-out" });
      if (gl) anim(gl, [{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
      if (g2) {
        g2.setAttribute("fill", T.t);
        anim(g2, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0.65 }, { opacity: 1 }], { duration: D(900), iterations: 3 });
      }
      const ch = parseFloat(c.style.height);
      const bm = mk(s.beam, 80 * U, 190 * U, "");
      bm.style.background = `linear-gradient(to top,${T.t},rgba(255,255,255,0))`;
      const by = CY - ch / 2 + (ch * 16) / 52 - 95 * U;
      put(bm, CX, by, 1);
      anim(bm, [{ transform: tf(CX, by + 40 * U, 0.4), opacity: 0 }, { transform: tf(CX, by, 1), opacity: 0.9, offset: 0.3 }, { transform: tf(CX, by - 20 * U, 1), opacity: 0 }], { duration: D(o.big ? 1500 : 800) });
      at(1700, () => bm.remove());
    }
    if (tier !== "common") {
      const fl = plain(s.flash);
      fl.style.background = `radial-gradient(circle at 50% 46%,${o.big ? "#fff" : T.t} 0,${T.c} 35%,rgba(0,0,0,0) 72%)`;
      anim(fl, [{ opacity: 0 }, { opacity: o.big ? 0.95 : 0.6 }, { opacity: 0 }], { duration: D(o.big ? 700 : 420) });
      at(900, () => fl.remove());
    }
    sfx.hush();
    sfx.talkingDrum(o.big ? "legendPhrase" : tier);
    sfx.swish(o.big);
    haptics.buzz(o.big ? "burstBig" : "stampSmall");
    emitOpenEvent({ type: "open-burst", tier });
    return anims;
  }
  function edge(k: number) {
    const e = plain(s.edge);
    e.style.boxShadow = `inset 0 0 70px 16px ${T.c}, inset 0 0 160px 30px ${T.c}55`;
    anim(e, [{ opacity: 0 }, { opacity: k }], { duration: D(360) });
    return e;
  }
  function rays(size: number) {
    const e = mk(s.rays, size, size, "");
    e.style.background = `repeating-conic-gradient(from 0deg,${T.t} 0deg 7deg,rgba(0,0,0,0) 7deg 22deg)`;
    const y = CY - 14 * U;
    put(e, CX, y, 1);
    anim(e, [{ transform: tf(CX, y, 0.6, 0), opacity: 0 }, { transform: tf(CX, y, 1, RM ? 20 : 60), opacity: 0.9, offset: 0.25 }, { transform: tf(CX, y, 1.15, RM ? 40 : 360), opacity: 0.55 }], { duration: 6000, easing: "linear" });
    return e;
  }

  /** The full-screen card. Face up after a flip. */
  function showCard(big: BigCard, opts: { w?: number; y?: number; dur?: number; instant?: boolean } = {}) {
    const w = (opts.w || 212) * U;
    const h = Math.round(w * 1.4);
    const y = opts.y ?? CY + 12 * U;
    const dur = D(opts.dur || 600);
    const wrap = mk(s.card, w, h, "");
    wrap.setAttribute("role", "button");
    wrap.tabIndex = 0;
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        wrap.click();
      }
    });
    wrap.setAttribute("aria-label", big.kind === "collectible" ? `${big.card.name}. Tap to put it on your Shelf.` : `${big.title}. Tap to collect.`);
    const inn = document.createElement("div");
    inn.className = s.cardIn;
    const face = big.kind === "collectible" ? cardSVG(big.card, tier) : rewardCardSVG({ xp: big.xp, title: big.title }, tier);
    inn.innerHTML = `<div class="${s.cardF}" style="filter:drop-shadow(0 0 ${tier === "legendary" ? 34 : 22}px ${T.c})">${face}</div><div class="${s.cardB}"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="none" stroke="#5B2EFF" stroke-width="3"/><circle cx="30" cy="30" r="17" fill="none" stroke="#FF4D00" stroke-width="3"/><circle cx="30" cy="30" r="7" fill="#F5EBDD"/></svg></div>`;
    wrap.appendChild(inn);
    put(wrap, CX, y, 0.5);
    wrap.style.opacity = "0";
    anim(wrap, [{ transform: tf(CX, y, 0.5), opacity: 0 }, { transform: tf(CX, y, 1), opacity: 1 }], { duration: dur, easing: "cubic-bezier(.2,.9,.3,1)" });
    if (opts.instant) inn.style.transform = "rotateY(0deg)";
    else {
      anim(inn, [{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], { duration: dur, easing: "cubic-bezier(.3,.7,.3,1)" });
      sfx.flip();
    }
    cardUp = true;
    wrap.focus({ preventScroll: true });
    return { wrap, y, h };
  }
  function readyHint(y: number) {
    const el = mk(s.hint, 34 * U, 34 * U, `<div class="${s.tap}">${TAP_SVG}</div>`);
    put(el, CX, y);
    return el;
  }

  /* ------------------------------------------------------------- the open -- */
  function crateSize() {
    const big = tier === "legendary";
    const w = (big ? 210 : 152) * U;
    return { w, h: Math.round((w * 52) / 48) };
  }
  function mapPoint() {
    const o = d.origin();
    return o ? { x: o.x, y: o.y - 24 * U } : { x: CX, y: H * 0.8 };
  }

  function start() {
    if (destroyed) return;
    measure();
    emitOpenEvent({ type: "open-start", tier });
    const { w, h } = crateSize();
    const p0 = mapPoint();
    const s0 = (48 * U * MAP_SCALE[tier]) / w;
    dim.classList.remove(s.dimBlack);
    dim.classList.add(s.dimOn);
    crate = mk(s.crate, w, h, crateSVG(tier));
    crate.setAttribute("role", "button");
    crate.tabIndex = 0;
    crate.setAttribute("aria-label", "Open the box. Swipe across the tape, or press Enter.");
    put(crate, p0.x, p0.y, s0);
    anim(crate, [{ transform: tf(p0.x, p0.y, s0) }, { transform: tf(CX, CY, 1) }], { duration: D(280), easing: "cubic-bezier(.2,.9,.3,1.15)" });
    sfx.shekere(T.shekere); // longer for rarer tiers
    hint = mk(s.hint, 70 * U, 26 * U, SWIPE_SVG);
    hint.style.opacity = "0";
    put(hint, CX, CY + h / 2 + 34 * U, 1.5);
    const hn = hint;
    at(D(280), () => {
      ready = true;
      hn.style.opacity = "1";
      anim(hn, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      crate?.focus({ preventScroll: true });
    });

    let sx: { x: number; y: number } | null = null;
    const c = crate;
    c.addEventListener("pointerdown", (e) => {
      sx = { x: e.clientX, y: e.clientY };
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* capture not available */
      }
    });
    c.addEventListener("pointermove", (e) => {
      if (sx && ready && !committed && Math.hypot(e.clientX - sx.x, e.clientY - sx.y) > 16) {
        sx = null;
        void commit();
      }
    });
    c.addEventListener("pointerup", () => {
      if (sx && ready && !committed) {
        sx = null;
        void commit();
      }
      sx = null;
    });
    c.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && ready && !committed) {
        e.preventDefault();
        void commit();
      }
    });
    stage.onclick = (e) => {
      if (e.target === stage && ready && !committed && !cardUp) cancel();
    };
  }

  function cancel() {
    if (committed || destroyed || !crate || finished) return;
    committed = true; // nothing else may start
    const c = crate;
    const p0 = mapPoint();
    const { w } = crateSize();
    const s0 = (48 * U * MAP_SCALE[tier]) / w;
    hint?.remove();
    sfx.hush();
    anim(c, [{ transform: tf(CX, CY, 1) }, { transform: tf(p0.x, p0.y, s0) }], { duration: D(240), easing: "ease-in" });
    dim.classList.remove(s.dimOn);
    emitOpenEvent({ type: "open-cancel", tier });
    at(D(250), () => {
      finished = true;
      c.remove();
      stage.onclick = null;
      root.classList.add(s.off);
      if (!destroyed) d.onCancel();
    });
  }

  const refused = (reason: string, message: string): ClaimRefused => ({ ok: false, reason, message });

  async function commit() {
    if (committed || destroyed || !crate) return;
    committed = true;
    const c = crate;
    const big = tier === "legendary";
    if (hint) anim(hint, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 });
    c.style.cursor = "default";
    c.style.pointerEvents = "none";
    c.tabIndex = -1;
    stage.onclick = null;
    const began = performance.now();

    if (big) {
      // Legendary: the shaker cuts, then 600 ms of silence and a building rumble.
      sfx.hush();
      dim.classList.add(s.dimBlack);
      anim(
        c,
        [
          { transform: tf(CX, CY, 1) },
          { transform: tf(CX - 1, CY + 1, 1.01) },
          { transform: tf(CX + 2, CY - 1, 1.02) },
          { transform: tf(CX - 3, CY + 2, 1.03) },
          { transform: tf(CX + 4, CY - 2, 1.04) },
          { transform: tf(CX - 5, CY + 2, 1.06) },
          { transform: tf(CX, CY, 1.08) },
        ],
        { duration: D(600), easing: "linear" }
      );
      c.style.filter = `drop-shadow(0 0 28px ${T.c})`;
      haptics.buzz("crateShake");
    } else {
      anim(c, [{ transform: tf(CX, CY, 1) }, { transform: `translate(${CX}px,${CY + 6 * U}px) scale(1.05,.92)` }], { duration: 110, easing: "ease-out" });
    }

    // The answer is slow: the crate shakes until it comes (the real wait is usually well under a second).
    const shakeAt = setTimeout(
      () => {
        if (destroyed || result) return;
        waitAnim = anim(
          c,
          [
            { transform: tf(CX, CY + 6 * U, 1.0, -4) },
            { transform: tf(CX, CY + 6 * U, 1.0, 4) },
            { transform: tf(CX, CY + 6 * U, 1.0, -4) },
          ],
          { duration: 380, iterations: Infinity, easing: "ease-in-out", composite: "replace" }
        );
      },
      big ? D(640) : 200
    );
    TM.push(shakeAt);

    let res: ClaimResult;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    try {
      res = await Promise.race([
        d.claim(),
        new Promise<ClaimResult>((ok) => {
          giveUp = setTimeout(() => ok(refused("timeout", "That didn't open. Try again.")), 12000);
        }),
      ]);
    } catch {
      res = refused("error", "That didn't open. Try again.");
    } finally {
      clearTimeout(giveUp);
    }
    clearTimeout(shakeAt);
    if (destroyed) return;
    waitAnim?.cancel();
    waitAnim = null;
    emitOpenEvent({ type: "open-claimed", tier, result: res });
    if (!res.ok) {
      refuse(res);
      return;
    }
    result = res;
    if (big) {
      const wait = Math.max(0, D(600) - (performance.now() - began));
      at(wait, () => seqLegend(res));
    } else if (tier === "common") seqCommon(res);
    else seqRare(res);
  }

  function refuse(res: ClaimRefused) {
    const c = crate;
    sfx.hush();
    const quiet = ["closed", "sold_out", "already", "not_yours"].includes(res.reason);
    const text = quiet || !res.message || res.message.length > 60 ? "Gone" : res.message;
    d.say(text);
    if (c) {
      anim(c, [{ transform: tf(CX, CY, 1) }, { transform: tf(CX - 9 * U, CY, 1, -3) }, { transform: tf(CX + 9 * U, CY, 1, 3) }, { transform: tf(CX - 5 * U, CY, 1, -2) }, { transform: tf(CX, CY, 1) }], { duration: D(320) });
      at(D(360), () => anim(c, [{ transform: tf(CX, CY, 1), opacity: 1 }, { transform: tf(CX, CY + 20 * U, 0.7), opacity: 0 }], { duration: D(260), easing: "ease-in" }));
    }
    const ch = crateSize().h;
    const note = mk(s.note, Math.min(W - 40, 260 * U), 30 * U, "");
    note.textContent = text;
    put(note, CX, CY - ch / 2 - 26 * U);
    anim(note, [{ opacity: 0, transform: tf(CX, CY - ch / 2 - 18 * U) }, { opacity: 1, transform: tf(CX, CY - ch / 2 - 26 * U) }], { duration: D(200) });
    haptics.buzz("refused");
    at(D(1000), () => {
      if (destroyed) return;
      cleanup();
      d.onDone(res);
    });
  }

  /* ---------------------------------------------------- the sequences -- */
  function itemsFor(res: ClaimOk): { list: Item[]; big: BigCard | null } {
    const list: Item[] = [];
    let big: BigCard | null = null;
    if (tier === "common") {
      list.push({ type: "xp", v: res.xp });
      if (res.collectible) list.push({ type: "card", card: res.collectible });
    } else if (res.collectible) {
      list.push({ type: "xp", v: res.xp });
      big = { kind: "collectible", card: res.collectible };
    } else {
      // XP only: the big card carries the XP, so no orb.
      big = { kind: "xp", xp: res.xp, title: res.title || `${T.name} box` };
    }
    if (d.firstOfDay()) list.push({ type: "stamp" });
    return { list, big };
  }

  function finish() {
    if (finished || destroyed) return;
    const c = crate;
    if (c) anim(c, [{ transform: tf(CX, CY, 1), opacity: 1 }, { transform: tf(CX, CY, 0.7), opacity: 0 }], { duration: D(220) });
    at(D(240), () => {
      if (destroyed) return;
      cleanup();
      if (result) {
        emitOpenEvent({ type: "open-done", tier, result });
        d.onDone(result);
      }
    });
  }
  function cleanup() {
    finished = true;
    stage.onclick = null;
    stage.innerHTML = "";
    dim.classList.remove(s.dimOn, s.dimBlack);
    root.classList.add(s.off);
  }

  function announce(res: ClaimOk, big: BigCard | null) {
    const parts = [`${res.xp} XP`];
    if (res.collectible) parts.push(res.collectible.name);
    d.say(`${big ? `${T.name}. ` : ""}You got ${parts.join(" and ")}.`);
  }

  function seqCommon(res: ClaimOk) {
    const c = crate as HTMLElement;
    const { list } = itemsFor(res);
    announce(res, null);
    squash(c, 120);
    rip(c);
    at(D(120), () => burst({ n: 16 }));
    const ens = fan(list, D(260), D(90));
    ens.forEach((en, i) => at(D(600) + i * D(60), () => flyItem(en)));
    at(D(1500), finish);
  }

  function seqRare(res: ClaimOk) {
    const c = crate as HTMLElement;
    const ep = tier === "epic";
    const { list, big } = itemsFor(res);
    announce(res, big);
    squash(c, 120);
    rip(c);
    let parts: Animation[] = [];
    at(D(120), () => {
      parts = burst({ n: ep ? 36 : 26, waves: ep ? 2 : 1, pw: ep ? 1.25 : 1 });
      edgeEl = edge(ep ? 0.95 : 0.6);
      if (ep) raysEl = rays(420 * U);
    });
    const fr = ep && !RM ? 200 : 0; // epic: a 200 ms freeze frame on the burst
    if (fr) {
      at(190, () => parts.forEach((a) => a.pause()));
      at(190 + fr, () => parts.forEach((a) => a.play()));
    }
    const ens = fan(list, D(260) + fr, D(90), CY - 150 * U);
    ens.forEach((en, i) => at(D(560) + fr + i * D(60), () => flyItem(en)));
    const flip = D(660) + (ep ? D(400) : 0) + fr;
    at(flip, () => {
      if (!big) return finish();
      anim(c, [{ transform: tf(CX, CY, 1), opacity: 1 }, { transform: tf(CX, CY + 30 * U, 0.5), opacity: 0 }], { duration: D(260) });
      const cd = showCard(big, { dur: 600, y: CY + 12 * U });
      at(D(640), () => {
        const h = readyHint(cd.y + cd.h / 2 + 30 * U);
        let done = false;
        const go = () => {
          if (done || destroyed) return;
          done = true;
          cardGo = null;
          h.remove();
          const item: Item = big.kind === "collectible" ? { type: "card", card: big.card } : { type: "xp", v: big.xp };
          const t = targetOf(item);
          if (edgeEl) anim(edgeEl, [{ opacity: ep ? 0.95 : 0.6 }, { opacity: 0 }], { duration: D(450) });
          if (raysEl) anim(raysEl, [{ opacity: 0.55 }, { opacity: 0 }], { duration: D(450) });
          const a = anim(cd.wrap, [{ transform: tf(CX, cd.y, 1), opacity: 1 }, { transform: tf(t.x, t.y, 0.14), opacity: 0.9 }], { duration: D(450), easing: "cubic-bezier(.55,0,.9,.6)" });
          sfx.flip();
          a.onfinish = () => {
            cd.wrap.remove();
            if (destroyed) return;
            land(item);
            at(D(120), finish);
          };
        };
        cardGo = go;
        cd.wrap.onclick = go;
        stage.onclick = (e) => {
          if (e.target === stage) go();
        };
        at(6500, go);
      });
    });
  }

  function seqLegend(res: ClaimOk) {
    const c = crate as HTMLElement;
    const { list, big } = itemsFor(res);
    announce(res, big);
    const t0 = performance.now();
    let parts: Animation[] = [];
    // the silence is over: rip, shake, the full talking drum phrase
    rip(c);
    c.style.filter = "";
    if (!RM) {
      stage.classList.remove(s.shake);
      void stage.offsetWidth;
      stage.classList.add(s.shake);
      at(520, () => stage.classList.remove(s.shake));
    }
    parts = burst({ n: 80, waves: 3, big: true, pw: 1.2, dur: 1100 });
    if (!RM) {
      parts.forEach((a) => {
        a.playbackRate = 0.25; // 300 ms of slow motion
      });
      at(300, () => parts.forEach((a) => (a.playbackRate = 1)));
    }
    edgeEl = edge(1);
    raysEl = rays(560 * U);
    canSkip = true;

    at(D(550), () => {
      const ens = fan(list, 0, D(110), CY - 170 * U);
      ens.forEach((en, i) => at(D(420) + i * D(70), () => flyItem(en)));
    });

    const showIt = (instant: boolean) => {
      if (cardUp || !big) return;
      anim(c, [{ transform: tf(CX, CY, 1), opacity: 1 }, { transform: tf(CX, CY + 30 * U, 0.5), opacity: 0 }], { duration: instant ? 10 : D(260) });
      const cd = showCard(big, { dur: instant ? 10 : 700, w: 214, y: CY + 10 * U, instant });
      if (instant && edgeEl) anim(edgeEl, [{ opacity: 1 }], { duration: 10 });
      at(instant ? 60 : D(760), () => {
        sfx.sparkle();
        haptics.buzz("cardUp");
        const sh = mk(s.share, 150 * U, 38 * U, `${SHARE_SVG}Share`);
        const sy = cd.y + cd.h / 2 + 32 * U;
        put(sh, CX, sy);
        anim(sh, [{ opacity: 0, transform: tf(CX, sy + 12 * U, 0.9) }, { opacity: 1, transform: tf(CX, sy) }], { duration: D(260) });
        sh.onclick = (e) => {
          e.stopPropagation();
          d.share(big.kind === "collectible" ? big.card.name : big.title);
        };
        const h = readyHint(sy + 50 * U);
        let done = false;
        const go = () => {
          if (done || destroyed) return;
          done = true;
          cardGo = null;
          sh.remove();
          h.remove();
          const item: Item = big.kind === "collectible" ? { type: "card", card: big.card } : { type: "xp", v: big.xp };
          const t = targetOf(item);
          if (edgeEl) anim(edgeEl, [{ opacity: 1 }, { opacity: 0 }], { duration: D(500) });
          if (raysEl) anim(raysEl, [{ opacity: 0.55 }, { opacity: 0 }], { duration: D(500) });
          const a = anim(cd.wrap, [{ transform: tf(CX, cd.y, 1), opacity: 1 }, { transform: tf(t.x, t.y, 0.14), opacity: 0.9 }], { duration: D(450), easing: "cubic-bezier(.55,0,.9,.6)" });
          sfx.flip();
          a.onfinish = () => {
            cd.wrap.remove();
            if (destroyed) return;
            land(item);
            at(D(150), finish);
          };
        };
        cardGo = go;
        cd.wrap.onclick = go;
        stage.onclick = (e) => {
          if (e.target === stage) go();
        };
        at(9000, go);
      });
    };

    at(D(1150), () => {
      if (!skipped) showIt(false);
    });
    // skippable after 600 ms: land everything at once and show the card
    stage.onclick = (e) => {
      if (e.target !== stage && !(e.target as HTMLElement).closest("." + s.crate)) return;
      if (!canSkip || performance.now() - t0 < 600 || cardUp) return;
      skipped = true;
      clearTM();
      stage.querySelectorAll("." + s.p + ", ." + s.wave + ", ." + s.flash).forEach((x) => x.remove());
      landAllInstant(list);
      showIt(true);
    };
  }

  /** The four-box path: Reveal has played, now the result flies into the tray. */
  function flyOnly(res: ClaimOk) {
    if (destroyed) return;
    measure();
    result = res;
    dim.classList.add(s.dimOn);
    const list: Item[] = [{ type: "xp", v: res.xp }];
    if (res.collectible) list.push({ type: "card", card: res.collectible });
    if (d.firstOfDay()) list.push({ type: "stamp" });
    const ens = fan(list, 0, D(90), CY - 20 * U);
    ens.forEach((en, i) => at(D(520) + i * D(60), () => flyItem(en)));
    at(D(520) + list.length * D(60) + D(520), () => {
      if (destroyed) return;
      cleanup();
      emitOpenEvent({ type: "open-done", tier, result: res });
      d.onDone(res);
    });
  }

  /* ------------------------------------------------------------- control -- */
  const onResize = () => {
    measure();
    if (crate && !committed && ready) put(crate, CX, CY, 1);
  };
  if (typeof window !== "undefined") window.addEventListener("resize", onResize);

  return {
    start: () => {
      startTimer = setTimeout(start, 0); // a StrictMode remount cancels this before it fires
    },
    flyOnly: (res) => {
      startTimer = setTimeout(() => flyOnly(res), 0);
    },
    cancel,
    key: (k) => {
      if (k === "escape") {
        if (!committed) cancel();
        else if (canSkip && !cardUp && !skipped) stage.click();
        else cardGo?.();
        return;
      }
      if (cardGo) cardGo();
    },
    destroy: () => {
      destroyed = true;
      clearTimeout(startTimer);
      clearTM();
      waitAnim?.cancel();
      sfx.hush();
      window.removeEventListener("resize", onResize);
      stage.onclick = null;
      stage.innerHTML = "";
    },
  };
}

