// Regalia and body extras for the rich humanoids that are not clothing: flames, and the
// pieces gods and creatures wear over the garments (rigid pieces riding a bone, or lofts
// weighted to the skeleton). Flames are the fire giant's; the rest comes with each pantheon.
import * as THREE from 'three';
import { MeshKit, ps, B } from './rich-kit.js';
import { finishGear } from './rich-gear.js';
import { hash } from './rich-paint.js';

const PI = Math.PI;
const TAU = PI * 2;

/** One tongue of flame: a tapered curl from `base` along `dir`, bent back by `bend`, with a flicker morph. */
function tongue(kit, pal, base, dir, L, r, { bend = 0.3, k = 0.35, sides = 6 } = {}) {
  const n = 5;
  const st = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rr = r * (1 - t) ** 0.85 + 0.0025;
    st.push(ps(base[0] + dir[0] * L * t - bend * L * t * t, base[1] + dir[1] * L * t, base[2] + dir[2] * L * t, rr, rr * 0.85));
  }
  const f = pal.fire;
  const h = pal.fireHot;
  kit.loft(st, {
    rings: 6, sides, start: 'round', end: 'round', capDepth: [r * 0.5, L * 0.08], color: pal.fire, mat: 'gem', glow: 0.95, flicker: { base, k },
    paint: (o, x, y, z, u) => {
      const t = u * u;
      o.r = f.r + (h.r - f.r) * t;
      o.g = f.g + (h.g - f.g) * t;
      o.b = f.b + (h.b - f.b) * t;
    },
  });
}

/** A mane of fire over the crown and back of the head (rides the head bone). */
export function flameMane(ctx, D, spec) {
  const { pal } = ctx;
  const hs = D.hs;
  const kit = new MeshKit(null, { sides: 6 });
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = 0.8 + (i / (n - 1)) * (TAU - 1.6);
    const wob = 0.8 + 0.4 * hash(i, 2, 5);
    const base = [D.headX + Math.cos(a) * 0.066 * hs, D.headCY + 0.088 * hs, Math.sin(a) * 0.062 * hs];
    const dir = [Math.cos(a) * 0.45 - 0.3, 1, Math.sin(a) * 0.6];
    const l = Math.hypot(...dir);
    tongue(kit, pal, base, dir.map((x) => x / l), 0.21 * hs * wob, 0.03 * hs, { bend: 0.5, k: 0.4 });
  }
  const o = spec.pos[B.head];
  return { name: 'mane', bone: B.head, geo: finishGear(kit, new THREE.Matrix4().makeTranslation(-o[0], -o[1], -o[2])), flicker: true };
}

/** Fire on the shoulders and back (riding the chest bone). */
export function flamePieces(ctx, D, spec) {
  const { pal } = ctx;
  const kit = new MeshKit(null, { sides: 6 });
  const k = D.chestW / 0.38;
  const sh = D.shoulderY;
  for (const side of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const base = [-0.02 - 0.012 * i, sh + 0.035 - 0.012 * i, side * (D.shoulderZ * 0.92 + (i - 1.5) * 0.034 * k)];
      const dir = [-0.12 - 0.1 * i, 1, side * (0.08 + 0.12 * i)];
      const l = Math.hypot(...dir);
      tongue(kit, pal, base, dir.map((x) => x / l), (0.17 - 0.025 * Math.abs(i - 1.2)) * k, 0.032 * k, { bend: 0.45, k: 0.33 });
    }
  }
  // a fan of tongues rising behind the shoulders
  for (let i = 0; i < 5; i++) {
    const z = (i - 2) * 0.095 * k;
    const base = [-D.chestD * 0.52, sh - 0.12 - 0.02 * Math.abs(i - 2), z];
    const dir = [-0.35, 1, (i - 2) * 0.22];
    const l = Math.hypot(...dir);
    tongue(kit, pal, base, dir.map((x) => x / l), (0.23 - 0.035 * Math.abs(i - 2)) * k, 0.036 * k, { bend: 0.6, k: 0.3 });
  }
  const o = spec.pos[B.chest];
  return [{ name: 'flames', bone: B.chest, geo: finishGear(kit, new THREE.Matrix4().makeTranslation(-o[0], -o[1], -o[2])), flicker: true }];
}
