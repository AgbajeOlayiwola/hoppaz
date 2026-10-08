"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { HUNT_ITEMS, type HuntKey } from "@/lib/huntItems";

/**
 * A camera-hunt item, spinning in 3D on a transparent canvas. three.js and the
 * models load on first use, so pages that never show an item never pay for
 * them. Falls back to the item's emoji where WebGL is unavailable. Fills its
 * parent; size it with className.
 */
export default function Hunt3D({
  item,
  locked = false,
  spin = 0.6,
  className,
  label,
}: {
  item: HuntKey;
  locked?: boolean;
  /** Turns per ~10 seconds; 0 holds still. */
  spin?: number;
  className?: string;
  label?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let stop = () => {};
    let cancelled = false;

    void Promise.all([import("three"), import("@/lib/huntModels")]).then(([THREE, models]) => {
      if (cancelled) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      } catch {
        setFailed(true);
        return;
      }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
      camera.position.set(0, 1.4, 5.6);
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.HemisphereLight("#FFF4E6", "#3A2440", 1.2));
      const key = new THREE.DirectionalLight("#FFFFFF", 1.6);
      key.position.set(3, 4, 5);
      scene.add(key);

      const model = models.buildHuntModel(item, { locked });
      scene.add(model.group);

      const size = () => {
        const w = el.clientWidth || 1, h = el.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // Keep the whole item in frame whatever the box's shape.
        camera.position.setLength(w >= h ? 5.6 : 5.6 * (h / w) ** 0.6);
        camera.updateProjectionMatrix();
      };
      size();
      const resize = new ResizeObserver(size);
      resize.observe(el);

      // Only draw while on screen: a collection page holds several of these.
      let visible = true;
      const seen = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
      seen.observe(el);

      const t0 = performance.now();
      let raf = 0;
      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (!visible) return;
        const t = (performance.now() - t0) / 1000;
        model.group.rotation.y = t * spin * 0.63;
        model.group.position.y = locked ? 0 : Math.sin(t * 1.6) * 0.06;
        if (!locked) model.tick?.(t);
        renderer.render(scene, camera);
      };
      frame();

      stop = () => {
        cancelAnimationFrame(raf);
        resize.disconnect();
        seen.disconnect();
        models.disposeHuntModel(model);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    }).catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      stop();
    };
  }, [item, locked, spin]);

  const info = HUNT_ITEMS[item];
  return (
    <div
      ref={holder}
      role="img"
      aria-label={label ?? (locked ? "An item you have not found yet" : info.name)}
      className={clsx("relative", className ?? "h-full w-full")}
    >
      {failed && <span className={clsx("absolute inset-0 grid place-items-center text-5xl", locked && "opacity-20 grayscale")}>{info.emoji}</span>}
    </div>
  );
}
