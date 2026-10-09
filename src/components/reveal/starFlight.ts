/**
 * The star flight: a few stars arc from where something was won to the Me tab,
 * and the tab pops when they land. Kept for badges, rank changes and drops
 * (the design system's rule), so it means something when it happens.
 *
 * Plain DOM and the Web Animations API, on a layer of its own, so it outlives
 * whatever screen started it (the reveal closes while the stars are in the air).
 */

const STARS = 5;

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function meTab() {
  return document.querySelector<HTMLElement>('nav[aria-label="Main"] a[href="/me"]');
}

/** The Me tab takes the hit: one quick pop. */
function pop(el: HTMLElement | null) {
  el?.animate([{ transform: "scale(1)" }, { transform: "scale(1.28)" }, { transform: "scale(1)" }], {
    duration: 300,
    easing: "cubic-bezier(0.2, 0.9, 0.3, 1)",
  });
}

const STAR_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6L12 22.5l-2.6-7.9L1.5 12l7.9-2.6z" fill="#F5EBDD" stroke="#FF4D00" stroke-width="1.5" stroke-linejoin="round"/></svg>';

/** Fly stars from `from` (a point on screen) to the Me tab. Resolves when they land. */
export function flyStarsToMe(from: { x: number; y: number }): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const target = meTab();
  if (!target) return Promise.resolve();
  if (reduced()) {
    pop(target);
    return Promise.resolve();
  }
  const t = target.getBoundingClientRect();
  const to = { x: t.left + t.width / 2, y: t.top + t.height / 2 };

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:70";
  document.body.append(layer);

  const flights = Array.from({ length: STARS }, (_, i) => {
    const star = document.createElement("div");
    star.innerHTML = STAR_SVG; // a constant string, no stored text
    star.style.cssText = "position:absolute;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px";
    layer.append(star);
    // A fan of starting points and arcs that bow up and away, the same every time.
    const spread = (i - (STARS - 1) / 2) * 26;
    const start = { x: from.x + spread, y: from.y + (i % 2 ? 8 : -8) };
    const mid = { x: (start.x + to.x) / 2 - 40 + i * 18, y: Math.min(start.y, to.y) - 90 - (i % 3) * 24 };
    return star.animate(
      [
        { transform: `translate(${start.x}px, ${start.y}px) scale(0.3) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${start.x}px, ${start.y - 14}px) scale(1.15) rotate(40deg)`, opacity: 1, offset: 0.18 },
        { transform: `translate(${mid.x}px, ${mid.y}px) scale(1) rotate(160deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${to.x}px, ${to.y}px) scale(0.45) rotate(300deg)`, opacity: 0.9 },
      ],
      { duration: 820 + i * 70, delay: i * 55, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "forwards" }
    ).finished;
  });

  return Promise.all(flights)
    .catch(() => undefined)
    .then(() => {
      layer.remove();
      pop(target);
    });
}
