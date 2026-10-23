// Regalia and body extras for the rich humanoids that are not clothing: flames, and the
// pieces gods and creatures wear over the garments (rigid pieces riding a bone, or lofts
// weighted to the skeleton). Flames are the fire giant's; the rest comes with each pantheon.
import * as THREE from 'three';
import { MeshKit, ps, vs, B } from './rich-kit.js';
import { finishGear } from './rich-gear.js';
import { shadeC, mixC, tintC } from './unit-geo.js';
import { torsoRing } from './rich-body.js';
import { feather } from './rich-feathers.js';
import { hash, lerp, clamp, gradY, mul } from './rich-paint.js';

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

// ---------------------------------------------------------------------------
// wings (rigid pieces on four extra bones)
// ---------------------------------------------------------------------------

/** Where the right wing's root and wrist sit (the left mirrors them); `span` is the wing's length. */
export function wingLayout(D, span) {
  const root = [-D.chestD * 0.5 - 0.02, D.shoulderY - 0.075, 0.07 * D.k];
  const wrist = [root[0] - 0.045 * span, root[1] + 0.2 * span, root[2] + 0.5 * span];
  return { span, root, wrist };
}

/**
 * Feathered wings, an inner and an outer piece per side that hang from the wing bones: the
 * secondaries and coverts ride the inner bone, the primaries the outer one, so the wing
 * flaps with its tip lagging and folds at the wrist (rich-anim.js). Built spread, swept back.
 */
export function wingPieces(ctx, D, spec, layout) {
  const { pal } = ctx;
  const S = layout.span;
  const covertC = pal.primary;
  const flightC = tintC(pal.secondary, 0.15);
  const tipC = ctx.grand ? pal.accent : null;
  const out = [];
  for (const side of [1, -1]) {
    const R = layout.root.map((x, i) => (i === 2 ? x * side : x));
    const W = layout.wrist.map((x, i) => (i === 2 ? x * side : x));
    const bone1 = side > 0 ? B.wingR1 : B.wingL1;
    const bone2 = side > 0 ? B.wingR2 : B.wingL2;
    const inner = new MeshKit(null, { sides: 6 });
    const outer = new MeshKit(null, { sides: 6 });
    const at = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const up = [0, 1, 0];
    // the leading edge: shoulder to wrist to the tip of the hand
    const tip = [W[0] - 0.06 * S, W[1] + 0.03 * S, W[2] + side * 0.42 * S];
    inner.loft([ps(R[0], R[1], R[2], 0.022 * S * 1.2), ps(...at(R, W, 0.5), 0.017 * S * 1.2), ps(W[0], W[1], W[2], 0.014 * S * 1.2)],
      { ref: [1, 0, 0], rings: 4, sides: 6, start: 'round', end: null, capDepth: 0.014 * S, color: shadeC(covertC, 0.82), mat: 'feather' });
    outer.loft([ps(W[0], W[1], W[2], 0.014 * S * 1.2), ps(...at(W, tip, 0.5), 0.011 * S * 1.2), ps(tip[0], tip[1], tip[2], 0.006 * S)],
      { ref: [1, 0, 0], rings: 4, sides: 6, start: null, end: 'round', capDepth: 0.01 * S, color: shadeC(covertC, 0.82), mat: 'feather' });
    // secondaries along the inner arm, sweeping back and a little down
    const nSec = 6;
    for (let i = 0; i < nSec; i++) {
      const t = 0.08 + (0.86 * i) / (nSec - 1);
      const root = at(R, W, t);
      const k = 1 - Math.abs(t - 0.55) * 0.5;
      const dir = [-1, -0.18 - 0.06 * t, side * (0.1 + 0.34 * t)];
      feather(inner, root, dir, up, 0.5 * S * k, 0.04 * S, { color: flightC, tip: tipC, bind: null, bend: [0, -0.03 * S, 0], thick: 0.003 * S, rows: 4 });
    }
    // primaries fan out of the wrist, the outermost longest and nearly straight out
    const nPri = 7;
    for (let i = 0; i < nPri; i++) {
      const k = i / (nPri - 1);
      const a = lerp(0.18, 1.3, k);
      const dir = [-Math.cos(a) * 0.95, -0.06 - 0.12 * (1 - k), side * Math.sin(a)];
      feather(outer, at(W, tip, k * 0.5), dir, up, (0.5 + 0.2 * Math.sin(k * 2.2)) * S, 0.04 * S, { color: flightC, tip: tipC, bend: [-0.02 * S, -0.025 * S, 0], thick: 0.003 * S, rows: 4 });
    }
    // coverts: shorter feathers over the roots of the flight feathers
    for (let i = 0; i < 5; i++) {
      const t = 0.1 + (0.8 * i) / 4;
      feather(inner, at(R, W, t), [-1, -0.1, side * (0.1 + 0.3 * t)], up, 0.26 * S, 0.034 * S, { color: covertC, tip: null, bend: [0, -0.02 * S, 0], thick: 0.003 * S, mat: 'feather', rows: 3 });
    }
    for (let i = 0; i < 4; i++) {
      const k = i / 3;
      const a = lerp(0.3, 1.2, k);
      feather(outer, at(W, tip, 0.2 + k * 0.4), [-Math.cos(a) * 0.95, -0.05, side * Math.sin(a)], up, 0.3 * S, 0.034 * S, { color: covertC, tip: null, bend: [-0.01 * S, -0.015 * S, 0], thick: 0.003 * S, rows: 3 });
    }
    const m1 = new THREE.Matrix4().makeTranslation(-spec.pos[bone1][0], -spec.pos[bone1][1], -spec.pos[bone1][2]);
    const m2 = new THREE.Matrix4().makeTranslation(-spec.pos[bone2][0], -spec.pos[bone2][1], -spec.pos[bone2][2]);
    out.push({ name: side > 0 ? 'wingR1' : 'wingL1', bone: bone1, geo: finishGear(inner, m1), wing: true });
    out.push({ name: side > 0 ? 'wingR2' : 'wingL2', bone: bone2, geo: finishGear(outer, m2), wing: true });
  }
  return out;
}

// ---------------------------------------------------------------------------
// extras worn over the garments (lofts weighted to the skeleton)
// ---------------------------------------------------------------------------

/** Ice shards or horn spikes: a pair on each shoulder and a row down the spine. */
export function addSpikes(E) {
  const { kit, D, pal, bind } = E;
  const K = D.k;
  const sh = D.shoulderY - 0.02;
  const spike = (base, dir, L, r, bd) => {
    const n = Math.hypot(...dir);
    const d = dir.map((x) => x / n);
    kit.loft([
      ps(base[0], base[1], base[2], r), ps(base[0] + d[0] * L * 0.4, base[1] + d[1] * L * 0.4, base[2] + d[2] * L * 0.4, r * 0.62),
      ps(base[0] + d[0] * L, base[1] + d[1] * L, base[2] + d[2] * L, r * 0.04),
    ], { ref: [1, 0, 0], rings: 5, sides: 6, start: null, end: 'round', capDepth: r * 0.4, color: pal.horn, mat: 'bone', bind: bd, paint: gradY(base[1], base[1] + L, 0.8, 1.12) });
  };
  for (const side of [1, -1]) {
    const upper = side > 0 ? B.upperR : B.upperL;
    const bd = (x, y, z, S) => { S.add(upper, 0.6); S.add(B.chest, 0.4); };
    const z = side * (D.shoulderZ + 0.01);
    spike([-0.01, sh + 0.05 * K, z], [0.1, 1, side * 0.55], 0.2 * K, 0.034 * K, bd);
    spike([-0.035, sh + 0.035 * K, z - side * 0.05 * K], [-0.25, 1, side * 0.25], 0.14 * K, 0.026 * K, bd);
  }
  for (let i = 0; i < 4; i++) {
    const ring = torsoRing(D, 0.9 - i * 0.2, 0.01);
    spike([ring.dx - ring.rx + 0.006, ring.y, (i % 2 ? 0.012 : -0.012) * K], [-0.9, 0.55 - i * 0.08, 0], (0.13 - i * 0.012) * K, 0.03 * K, bind.torso);
  }
}

/** A gold collar with a pendant gem at the neck base, earrings and (for gods) upper-arm bands. */
export function addJewelry(E, { collar = true, bands = null } = {}) {
  const { kit, D, ctx, pal, bind } = E;
  const hs = D.hs;
  const gold = pal.accentMetal;
  if (collar) {
    const a = torsoRing(D, 1.0, 0.016);
    const b = torsoRing(D, 1.055, 0.014);
    kit.loft([vs(a.y, a.rx, a.rz, a.dx), vs(b.y, b.rx, b.rz, b.dx)], { sides: 20, start: null, end: null, color: gold, mat: 'gold', glow: 0.1, bind: bind.torso });
    // a second band below it in the accent color, with a pendant gem on the breastbone
    const c = torsoRing(D, 0.935, 0.016);
    kit.loft([vs(c.y - 0.024, c.rx + 0.002, c.rz + 0.002, c.dx), vs(c.y, c.rx, c.rz, c.dx)], { sides: 20, start: null, end: null, color: shadeC(pal.secondary, 1.0), mat: 'trim', bind: bind.torso });
    const gx = c.dx + c.rx + 0.004;
    kit.loft([ps(gx, c.y - 0.012, 0, 0.007, 0.009), ps(gx + 0.011, c.y - 0.026, 0, 0.0065, 0.011), ps(gx + 0.008, c.y - 0.048, 0, 0.0035, 0.0055)], {
      ref: [1, 0, 0], rings: 5, sides: 8, start: 'round', end: 'round', capDepth: 0.006, color: tintC(pal.glow, 0.2), mat: 'gem', glow: 0.8, bind: bind.torso,
    });
  }
  // earrings: a gold drop under each ear
  for (const side of [1, -1]) {
    kit.loft([ps(D.headX - 0.004 * hs, D.headCY - 0.022 * hs, side * 0.097 * hs, 0.006 * hs), ps(D.headX - 0.004 * hs, D.headCY - 0.05 * hs, side * 0.097 * hs, 0.0055 * hs)],
      { ref: [1, 0, 0], sides: 6, start: 'round', end: 'round', capDepth: 0.005 * hs, color: gold, mat: 'gold', glow: 0.2, bind: bind.head });
  }
  if (bands ?? ctx.grand) {
    for (const side of [1, -1]) {
      const y = D.shoulderY - 0.02 - D.upper * 0.42;
      kit.loft([vs(y - 0.016, D.armR * 1.06 + 0.012, D.armR * 1.03 + 0.012, 0, side * D.shoulderZ), vs(y + 0.016, D.armR * 1.07 + 0.012, D.armR * 1.04 + 0.012, 0, side * D.shoulderZ)],
        { sides: 12, start: null, end: null, color: gold, mat: 'gold', glow: 0.1, bind: bind.arm[side] });
    }
  }
}

/** A cloak of overlapping feathers hanging from the shoulders (rows in the unit's three colors) and a tuft on each shoulder. */
export function addFeatherCloak(E, { rows = null } = {}) {
  const { kit, D, ctx, pal, bind, ex } = E;
  const K = D.k;
  const nRows = rows ?? (ex.has('wings') ? 1 : 3);
  const colors = [pal.primary, pal.secondary, pal.accent];
  const top = D.shoulderY - 0.015;
  const back = -D.chestD * 0.5 - 0.016;
  for (let r = 0; r < nRows; r++) {
    const n = 7 + r * 2;
    const y = top - r * 0.095 * K;
    const half = D.chestW * (0.4 + r * 0.06);
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) : 0.5;
      const z = (k - 0.5) * 2 * half;
      const edge = Math.abs(k - 0.5) * 2;
      const root = [back - 0.01 * r - 0.012 * edge, y - 0.035 * edge, z];
      const len = (0.3 + 0.045 * r - 0.07 * edge) * (K > 1.2 ? 1.1 : 1);
      const dir = [-0.14 - 0.1 * edge, -1, (k - 0.5) * 0.5];
      feather(kit, root, dir, [-1, 0.1, 0], len, 0.05 + 0.006 * r, {
        color: shadeC(colors[r % 3], 1 - 0.05 * (i % 2)), tip: mixC(colors[(r + 1) % 3], colors[r % 3], 0.35), bind: bind.cape, bend: [-0.03, 0, 0], rows: 4, thick: 0.004,
      });
    }
  }
  // a tuft of short feathers over each shoulder
  for (const side of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const root = [-0.01 - i * 0.012, D.shoulderY + 0.012 - i * 0.008, side * (D.shoulderZ * 1.0 + (i - 1) * 0.018)];
      feather(kit, root, [-0.2, -0.25, side * (0.8 + i * 0.1)], [0, 1, 0], 0.11 * K, 0.03 * K, { color: pal.accent, tip: null, bind: (x, y, z, S) => { S.add(side > 0 ? B.upperR : B.upperL, 0.6); S.add(B.chest, 0.4); }, bend: [-0.01, -0.03, 0], rows: 3 });
    }
  }
  void ctx;
}

/** Chain links draped diagonally across the chest (and shackle rings at the wrists when `wrists`). */
export function addChains(E, { wrists = true } = {}) {
  const { kit, D, pal, bind } = E;
  const col = pal.darkMetal;
  const a = torsoRing(D, 0.2, 0.034);
  const b = torsoRing(D, 0.98, 0.032);
  const pts = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ring = torsoRing(D, lerp(0.22, 0.97, t), 0.034);
    const ang = lerp(0.55, -0.85, t) * 1.0; // sweeping from the right hip to the left shoulder across the chest
    pts.push(ps(ring.dx + Math.cos(ang * 1.6) * ring.rx, ring.y, Math.sin(ang * 1.6) * ring.rz, i % 2 ? 0.014 : 0.0085, i % 2 ? 0.0085 : 0.014));
  }
  kit.loft(pts, { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capDepth: 0.01, color: col, mat: 'iron', bind: bind.torso });
  void a; void b;
  if (wrists) {
    for (const side of [1, -1]) {
      const w = D.shoulderY - 0.02 - D.upper - D.fore;
      kit.loft([vs(w + 0.004, D.armR * 0.72 + 0.014, D.armR * 0.7 + 0.014, 0, side * D.shoulderZ), vs(w + 0.04, D.armR * 0.78 + 0.016, D.armR * 0.76 + 0.016, 0, side * D.shoulderZ)],
        { sides: 12, start: null, end: null, color: col, mat: 'iron', bind: bind.arm[side] });
    }
  }
}
