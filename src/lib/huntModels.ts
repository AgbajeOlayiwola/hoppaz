import * as THREE from "three";
import type { HuntKey } from "./huntItems";

/**
 * The five camera-hunt items as three.js models, built from primitives so
 * there are no asset files to download. Cel shaded with an ink outline to
 * match the anime-style avatars. Each fits roughly in a 2.4-unit cube centred
 * on the origin; `tick(t)` animates the bits that move (steam, wheels, glints).
 */

export type HuntModel = { group: THREE.Group; tick?: (t: number) => void };

const INK = "#1A1210";

// Three bands of light: the cel look.
let ramp: THREE.DataTexture | null = null;
function toonRamp() {
  if (ramp) return ramp;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

const toon = (color: string, extra: Partial<THREE.MeshToonMaterialParameters> = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...extra });

const outlineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

/** A mesh with an inverted-hull outline. thickness is relative to the part's size. */
function part(geo: THREE.BufferGeometry, mat: THREE.Material, outline = 0.05) {
  const mesh = new THREE.Mesh(geo, mat);
  if (outline > 0) {
    const hull = new THREE.Mesh(geo, outlineMat);
    hull.scale.setScalar(1 + outline);
    mesh.add(hull);
  }
  return mesh;
}

/** For parts built in place (tubes): recentre the geometry so the outline hugs it. */
function partInPlace(geo: THREE.BufferGeometry, mat: THREE.Material, outline = 0.05) {
  geo.computeBoundingBox();
  const c = geo.boundingBox!.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  const mesh = part(geo, mat, outline);
  mesh.position.copy(c);
  return mesh;
}

function at<T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): T {
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}

/* ------------------------------------------------------- Golden Danfo ---- */
function danfo(): HuntModel {
  const g = new THREE.Group();
  const gold = toon("#F4B728", { emissive: "#5A3A00", emissiveIntensity: 0.25 });
  const stripe = toon("#1A1210");
  const glass = toon("#2A3550", { emissive: "#1B2A4A", emissiveIntensity: 0.4 });
  const tyre = toon("#1E1A18");
  const hub = toon("#D8CFC2");
  const cream = toon("#F5EBDD");
  const orange = toon("#FF4D00");

  g.add(at(part(new THREE.BoxGeometry(2.1, 0.95, 1.0), gold, 0.03), 0, 0.15, 0)); // body
  g.add(at(part(new THREE.BoxGeometry(0.42, 0.55, 0.98), gold, 0.04), 1.2, -0.05, 0)); // snub nose
  // the black stripes every danfo wears
  for (const z of [0.505, -0.505]) {
    g.add(at(part(new THREE.BoxGeometry(2.12, 0.08, 0.02), stripe, 0), 0, -0.12, z));
    g.add(at(part(new THREE.BoxGeometry(2.12, 0.05, 0.02), stripe, 0), 0, -0.24, z));
  }
  // side windows, a bit of the bus's sliding door, windscreen
  for (const z of [0.51, -0.51]) {
    for (const x of [-0.75, -0.3, 0.15, 0.6]) g.add(at(part(new THREE.BoxGeometry(0.36, 0.3, 0.02), glass, 0), x, 0.36, z));
  }
  g.add(at(part(new THREE.BoxGeometry(0.02, 0.32, 0.86), glass, 0), 1.06, 0.36, 0));
  // the back: a window, tail lights, and the ladder conductors hang off
  g.add(at(part(new THREE.BoxGeometry(0.02, 0.28, 0.7), glass, 0), -1.06, 0.38, 0));
  for (const z of [0.36, -0.36]) g.add(at(part(new THREE.BoxGeometry(0.03, 0.14, 0.12), toon("#D7263D", { emissive: "#7A0010", emissiveIntensity: 0.6 }), 0), -1.06, -0.05, z));
  for (const z of [0.12, -0.12]) g.add(at(part(new THREE.BoxGeometry(0.03, 0.8, 0.03), stripe, 0), -1.07, 0.25, z));
  for (const y of [0.0, 0.25, 0.5]) g.add(at(part(new THREE.BoxGeometry(0.03, 0.03, 0.27), stripe, 0), -1.07, y, 0));
  // headlights and the Hoppaz orange bumper
  for (const z of [0.32, -0.32]) g.add(at(part(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 16), cream, 0.1), 1.42, 0.0, z, 0, 0, Math.PI / 2));
  g.add(at(part(new THREE.BoxGeometry(0.08, 0.12, 1.04), orange, 0.06), 1.44, -0.24, 0));
  // wheels
  const wheels: THREE.Object3D[] = [];
  for (const x of [-0.65, 0.85]) {
    for (const z of [0.5, -0.5]) {
      const w = at(part(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 20), tyre, 0.06), x, -0.36, z, Math.PI / 2, 0, 0);
      w.add(at(part(new THREE.CylinderGeometry(0.1, 0.1, 0.17, 12), hub, 0), 0, 0, 0));
      wheels.push(w);
      g.add(w);
    }
  }
  // roof rack piled with market bags
  g.add(at(part(new THREE.BoxGeometry(1.7, 0.05, 0.86), stripe, 0), -0.1, 0.67, 0));
  g.add(at(part(new THREE.BoxGeometry(0.5, 0.26, 0.5), cream, 0.06), -0.45, 0.82, 0.05, 0, 0.2, 0));
  g.add(at(part(new THREE.BoxGeometry(0.42, 0.2, 0.42), orange, 0.06), 0.18, 0.79, -0.08, 0, -0.3, 0));
  g.add(at(part(new THREE.SphereGeometry(0.17, 14, 10), toon("#3E7CB1"), 0.08), 0.2, 0.98, 0.15));
  g.scale.setScalar(0.95);
  return { group: g, tick: (t) => wheels.forEach((w) => (w.rotation.y = t * 2)) };
}

/* --------------------------------------------------- Party Jollof Pot ---- */
function jollof(): HuntModel {
  const g = new THREE.Group();
  const iron = toon("#5A4A42");
  const rice = toon("#E8501E", { emissive: "#5A1400", emissiveIntensity: 0.2 });
  // the pot: a lathe profile, wider at the belly
  const profile = [
    [0.0, -0.75], [0.7, -0.72], [0.98, -0.45], [1.05, -0.05], [1.0, 0.32], [0.96, 0.4],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(part(new THREE.LatheGeometry(profile, 40), iron, 0.035));
  g.add(at(part(new THREE.TorusGeometry(0.97, 0.06, 10, 40), toon("#3A2E29"), 0.15), 0, 0.4, 0, Math.PI / 2));
  // handles
  for (const x of [1.08, -1.08]) {
    g.add(at(part(new THREE.TorusGeometry(0.18, 0.045, 8, 16, Math.PI), toon("#2A221F"), 0.15), x, 0.18, 0, 0, x > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
  }
  // the rice, heaped
  const mound = part(new THREE.SphereGeometry(0.92, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), rice, 0.03);
  mound.scale.set(1, 0.42, 1);
  g.add(at(mound, 0, 0.36, 0));
  // peas, carrot, and a piece of chicken on top
  const pea = toon("#5BA33B");
  const carrot = toon("#FF9A3D");
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 0.25 + (i % 3) * 0.2;
    const y = 0.36 + 0.42 * Math.sqrt(Math.max(0, 1 - (r / 0.92) ** 2)) - 0.02;
    g.add(at(part(i % 2 ? new THREE.SphereGeometry(0.05, 8, 6) : new THREE.BoxGeometry(0.08, 0.06, 0.08), i % 2 ? pea : carrot, 0), Math.cos(a) * r, y, Math.sin(a) * r));
  }
  const chicken = part(new THREE.SphereGeometry(0.22, 16, 12), toon("#B5622A"), 0.08);
  chicken.scale.set(1.3, 0.8, 1);
  g.add(at(chicken, 0.12, 0.82, -0.05, 0, 0, 0.3));
  // steam puffs drifting up
  const steamMat = new THREE.MeshToonMaterial({ color: "#FFFFFF", gradientMap: toonRamp(), transparent: true, opacity: 0.75 });
  const puffs = [0, 1, 2].map((i) => {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.16 + i * 0.03, 12, 10), steamMat.clone());
    g.add(p);
    return p;
  });
  g.position.y = -0.3;
  g.scale.setScalar(0.85);
  return {
    group: g,
    tick: (t) =>
      puffs.forEach((p, i) => {
        const k = (t * 0.35 + i / 3) % 1;
        p.position.set(Math.sin(k * 6 + i) * 0.25 - 0.2 + i * 0.2, 0.95 + k * 0.75, Math.cos(k * 5 + i) * 0.15);
        p.scale.setScalar(0.6 + k);
        (p.material as THREE.MeshToonMaterial).opacity = 0.8 * (1 - k);
      }),
  };
}

/* ------------------------------------------------- Gangan Talking Drum ---- */
function gangan(): HuntModel {
  const g = new THREE.Group();
  const wood = toon("#A0602E");
  const skin = toon("#EADBC4");
  const cord = toon("#D9C29A");
  // hourglass body
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 20; i++) {
    const y = -0.95 + (1.9 * i) / 20;
    pts.push(new THREE.Vector2(0.28 + 0.32 * (y / 0.95) ** 2, y));
  }
  g.add(part(new THREE.LatheGeometry(pts, 32), wood, 0.035));
  // drum heads with dark rims
  for (const y of [0.97, -0.97]) {
    g.add(at(part(new THREE.CylinderGeometry(0.66, 0.66, 0.05, 32), skin, 0.04), 0, y, 0));
    g.add(at(part(new THREE.TorusGeometry(0.66, 0.05, 8, 32), toon("#5A3218"), 0.12), 0, y, 0, Math.PI / 2));
  }
  // tension cords, rim to rim
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const top = new THREE.Vector3(Math.cos(a) * 0.64, 0.95, Math.sin(a) * 0.64);
    const bottom = new THREE.Vector3(Math.cos(a + 0.35) * 0.64, -0.95, Math.sin(a + 0.35) * 0.64);
    const mid = new THREE.Vector3(Math.cos(a + 0.17) * 0.4, 0, Math.sin(a + 0.17) * 0.4);
    const curve = new THREE.QuadraticBezierCurve3(top, mid, bottom);
    g.add(part(new THREE.TubeGeometry(curve, 12, 0.018, 5), cord, 0));
  }
  // the band the drummer squeezes, in Hoppaz colours
  g.add(at(part(new THREE.TorusGeometry(0.33, 0.06, 8, 28), toon("#5B2EFF"), 0.1), 0, 0.08, 0, Math.PI / 2));
  g.add(at(part(new THREE.TorusGeometry(0.33, 0.04, 8, 28), toon("#FF4D00"), 0.1), 0, -0.08, 0, Math.PI / 2));
  // the curved stick
  const stick = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.75, 1.25, 0.25), new THREE.Vector3(1.25, 0.95, 0.35), new THREE.Vector3(1.2, 0.35, 0.3));
  g.add(partInPlace(new THREE.TubeGeometry(stick, 16, 0.045, 8), toon("#6B3A1A"), 0.08));
  g.add(at(part(new THREE.SphereGeometry(0.08, 10, 8), toon("#6B3A1A"), 0.1), 0.75, 1.25, 0.25));
  g.rotation.z = -0.12;
  g.scale.setScalar(0.95);
  return { group: g };
}

/* ------------------------------------------------------ Golden Cowrie ---- */
function cowrie(): HuntModel {
  const g = new THREE.Group();
  const gold = toon("#F2B33D", { emissive: "#6A4300", emissiveIntensity: 0.3 });
  // a high gold back over a shallow belly: the cowrie's shape
  const back = part(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), gold, 0.03);
  back.scale.set(0.72, 0.55, 1.1);
  g.add(back);
  const BELLY = 0.2;
  const belly = part(new THREE.SphereGeometry(1, 40, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon("#F6D27A"), 0.03);
  belly.scale.set(0.72, BELLY, 1.1);
  g.add(belly);
  // the toothed slit, following the belly's curve end to end
  const under = (z: number) => -BELLY * Math.sqrt(Math.max(0, 1 - (z / 1.1) ** 2)) - 0.012;
  const slit = new THREE.CatmullRomCurve3(Array.from({ length: 11 }, (_, i) => {
    const z = -0.9 + (1.8 * i) / 10;
    return new THREE.Vector3(Math.sin(z * 2) * 0.03, under(z), z);
  }));
  g.add(partInPlace(new THREE.TubeGeometry(slit, 24, 0.028, 6), toon("#4A2E0C"), 0));
  const tooth = toon("#FFF4DA");
  for (let i = -6; i <= 6; i++) {
    const z = i * 0.13;
    for (const side of [1, -1]) {
      const t = part(new THREE.BoxGeometry(0.11, 0.03, 0.05), tooth, 0.12);
      g.add(at(t, side * 0.075 + Math.sin(z * 2) * 0.03, under(z) + 0.004, z, 0, 0, side * 0.12));
    }
  }
  // a glossy streak along the back, the way a polished shell catches light
  const gloss = part(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: "#FFF6D8", transparent: true, opacity: 0.6 }), 0);
  gloss.scale.set(0.1, 0.04, 0.6);
  g.add(at(gloss, -0.24, 0.5, -0.05, 0, 0, 0.4));
  // tilted so you see the slit, and orbiting sparkles
  g.rotation.set(-1.1, 0, 0.35);
  const sparkMat = toon("#FFF4C2", { emissive: "#FFE38A", emissiveIntensity: 0.9 });
  const sparks = [0, 1, 2, 3].map(() => {
    const s = part(new THREE.OctahedronGeometry(0.09), sparkMat, 0.15);
    return s;
  });
  const holder = new THREE.Group();
  holder.add(g, ...sparks);
  return {
    group: holder,
    tick: (t) =>
      sparks.forEach((s, i) => {
        const a = t * 0.9 + (i * Math.PI) / 2;
        s.position.set(Math.cos(a) * 1.35, Math.sin(t * 1.7 + i) * 0.45, Math.sin(a) * 1.35);
        s.rotation.y = t * 3;
        s.scale.setScalar(0.7 + 0.4 * Math.abs(Math.sin(t * 2 + i)));
      }),
  };
}

/* ----------------------------------------------------- Eko Disco Ball ---- */
function disco(): HuntModel {
  const g = new THREE.Group();
  // Mirror tiles: flat facets, metal, lit by two coloured lights that circle it.
  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.95, 3),
    new THREE.MeshStandardMaterial({ color: "#E6E9F2", metalness: 0.45, roughness: 0.3, flatShading: true, emissive: "#262633" })
  );
  const hull = new THREE.Mesh(ball.geometry, outlineMat);
  hull.scale.setScalar(1.03);
  ball.add(hull);
  g.add(ball);
  // cap and chain
  g.add(at(part(new THREE.CylinderGeometry(0.14, 0.18, 0.12, 16), toon("#8C8F99"), 0.1), 0, 0.98, 0));
  for (let i = 0; i < 4; i++) {
    g.add(at(part(new THREE.TorusGeometry(0.07, 0.022, 6, 12), toon("#A7AAB3"), 0.15), 0, 1.13 + i * 0.12, 0, 0, i % 2 ? Math.PI / 2 : 0, 0));
  }
  const orange = new THREE.PointLight("#FF4D00", 6, 6);
  const violet = new THREE.PointLight("#7A4DFF", 6, 6);
  const white = new THREE.PointLight("#FFFFFF", 3, 6);
  g.add(orange, violet, white);
  g.position.y = -0.2;
  return {
    group: g,
    tick: (t) => {
      ball.rotation.y = t * 0.6;
      orange.position.set(Math.cos(t * 1.3) * 2, 0.6, Math.sin(t * 1.3) * 2);
      violet.position.set(Math.cos(t * 1.3 + Math.PI) * 2, -0.4, Math.sin(t * 1.3 + Math.PI) * 2);
      white.position.set(Math.cos(t * 0.7 + 1.5) * 1.6, 1.6, 1.8);
    },
  };
}

const BUILDERS: Record<HuntKey, () => HuntModel> = {
  "golden-danfo": danfo,
  "jollof-pot": jollof,
  "gangan-drum": gangan,
  "golden-cowrie": cowrie,
  "eko-disco-ball": disco,
};

/**
 * Build an item. locked: an ink silhouette with a faint violet rim, for
 * items not found yet.
 */
export function buildHuntModel(key: HuntKey, opts: { locked?: boolean } = {}): HuntModel {
  const model = BUILDERS[key]();
  if (opts.locked) {
    const shadow = new THREE.MeshBasicMaterial({ color: "#241B2E" });
    const rim = new THREE.MeshBasicMaterial({ color: "#5B2EFF", side: THREE.BackSide });
    model.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.material = o.material === outlineMat ? rim : shadow;
    });
    model.group.traverse((o) => {
      if (o instanceof THREE.PointLight) o.visible = false;
    });
  }
  return model;
}

/** Free the GPU memory an item holds. */
export function disposeHuntModel(model: HuntModel) {
  model.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => m !== outlineMat && m.dispose());
  });
}
