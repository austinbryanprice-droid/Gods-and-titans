// Regalia and body extras for the rich humanoids that are not clothing: flames, and the
// pieces gods and creatures wear over the garments (rigid pieces riding a bone, or lofts
// weighted to the skeleton). Flames are the fire giant's; the rest comes with each pantheon.
import * as THREE from 'three';
import { MeshKit, ps, vs, B, rigid } from './rich-kit.js';
import { finishGear, richWeapon } from './rich-gear.js';
import { richArm } from './rich-arms.js';
import { shadeC, mixC, tintC } from './unit-geo.js';
import { torsoRing } from './rich-body.js';
import { feather } from './rich-feathers.js';
import { hash, lerp, clamp, gradY, mul, tint, recolor } from './rich-paint.js';

const PI = Math.PI;
const TAU = PI * 2;

/** One tongue of flame: a tapered curl from `base` along `dir`, bent back by `bend`, with a flicker morph. */
function tongue(kit, pal, base, dir, L, r, { bend = 0.3, k = 0.35, sides = 6, n = 5, rings = 6, cap = 3 } = {}) {
  const st = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rr = r * (1 - t) ** 0.85 + 0.0025;
    st.push(ps(base[0] + dir[0] * L * t - bend * L * t * t, base[1] + dir[1] * L * t, base[2] + dir[2] * L * t, rr, rr * 0.85));
  }
  const f = pal.fire;
  const h = pal.fireHot;
  kit.loft(st, {
    rings, sides, start: 'round', end: 'round', capRings: cap, capDepth: [r * 0.5, L * 0.08], color: pal.fire, mat: 'gem', glow: 0.95, flicker: { base, k },
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

/**
 * The prabhavali: an arch of flames standing behind a god's head, a thin gold arch with tongues of
 * fire along it (rides the head bone, flickers). `size` scales it; 1 is about twice the head's width.
 */
export function addPrabhavali(E, { size = 1, tongues = 7 } = {}) {
  const { D, pal, spec } = E;
  const hs = D.hs;
  const kit = new MeshKit(null, { sides: 6 });
  const R = 0.27 * hs * size;
  const cx = D.headX - 0.13 * hs;
  const cy = D.headCY - 0.05 * hs;
  const arch = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * PI;
    arch.push(ps(cx, cy + Math.sin(a) * R, Math.cos(a) * R, 0.009 * hs, 0.009 * hs));
  }
  kit.loft(arch, { sides: 5, start: 'round', end: 'round', capRings: 2, capDepth: 0.007 * hs, color: pal.accentMetal, mat: 'gold', glow: 0.3 });
  for (let i = 0; i < tongues; i++) {
    const a = (i / (tongues - 1)) * PI;
    const s = Math.sin(a);
    const c = Math.cos(a);
    const wob = 0.85 + 0.3 * hash(i, 4, 9);
    const base = [cx, cy + s * R * 1.02, c * R * 1.02];
    const dir = [-0.18, s, c];
    const l = Math.hypot(...dir);
    // longest at the crown of the arch, shorter at its feet
    tongue(kit, pal, base, dir.map((x) => x / l), (0.075 + 0.05 * s) * hs * size * wob, 0.022 * hs * size, { bend: 0.25, k: 0.3, sides: 4, n: 3, rings: 2, cap: 1 });
  }
  const o = spec.pos[B.head];
  return { name: 'prabhavali', bone: B.head, geo: finishGear(kit, new THREE.Matrix4().makeTranslation(-o[0], -o[1], -o[2])), flicker: true };
}

/** A little ball (a pearl, a pompom) at `p`: a short loft with round ends. */
function ball(kit, p, r, opts) {
  kit.loft([ps(p[0] - r * 0.1, p[1], p[2], r), ps(p[0] + r * 0.1, p[1], p[2], r)], { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: r, ...opts });
}

/**
 * The ring standing behind a god's back (the aura_ring extra), upright in the plane across the
 * shoulders, riding the chest. kind 'drums': Raijin's thunder ring, eight taiko (a barrel with a pale head
 * and a red boss, a gold band) strung on a rope of gold. kind 'rays': the sun's, a thin glowing ring
 * with eight pearls and a corona of long and short rays.
 */
export function addAuraRing(E, { kind = 'rays', color = null } = {}) {
  const { kit, D, pal } = E;
  const bind = E.bind.chest;
  const K = D.k;
  const drums = kind === 'drums';
  const R = D.chestW * (drums ? 1.12 : 1.2);
  const c = [-D.chestD * 0.5 - (drums ? 0.19 : 0.15), D.shoulderY + (drums ? 0.09 : 0.14), 0];
  const at = (a, r = R) => [c[0], c[1] + Math.sin(a) * r, Math.cos(a) * r];
  const gold = pal.accentMetal;
  const glow = tintC(color || pal.glow, 0.25);
  // the ring itself (a closed loop of overlapping ends)
  const N = 26;
  const loop = [];
  for (let i = 0; i <= N; i++) {
    const p = at((i / N) * TAU);
    loop.push(ps(p[0], p[1], p[2], drums ? 0.011 * K : 0.007 * K, drums ? 0.011 * K : 0.016 * K));
  }
  kit.loft(loop, { ref: [1, 0, 0], sides: drums ? 6 : 5, start: null, end: null, color: drums ? mixC(gold, '#7a5a1e', 0.35) : glow, mat: drums ? 'gold' : 'gem', glow: drums ? 0.1 : 0.85, bind });
  if (drums) {
    const dr = R * 0.175; // a drum's radius
    const w = dr * 0.82; // half its length
    const head = mixC(pal.skin, '#fff6e2', 0.7);
    const boss = '#c8342a';
    for (let i = 0; i < 8; i++) {
      const p = at(((i + 0.5) / 8) * TAU);
      const st = [-1, -0.78, 0, 0.78, 1].map((f, k) => ps(p[0] + f * w, p[1], p[2], dr * [0.8, 0.94, 1, 0.94, 0.8][k], dr * [0.8, 0.94, 1, 0.94, 0.8][k]));
      kit.loft(st, {
        ref: [0, 1, 0], sides: 10, start: 'flat', end: 'flat', color: pal.primary, mat: 'lacquer', bind,
        paint: (o, x, y, z, u) => {
          const e = Math.abs(u - 0.5) * 2; // 1 at a head, 0 at the belly
          tint(o, head, clamp((e - 0.9) / 0.1) * 0.95);
          if (!o.team) mul(o, 0.92 + 0.12 * (1 - e));
        },
      });
      // a gold band round the belly, a red boss on each head
      kit.loft([ps(p[0] - 0.012, p[1], p[2], dr * 1.02, dr * 1.02), ps(p[0] + 0.012, p[1], p[2], dr * 1.02, dr * 1.02)], { ref: [0, 1, 0], sides: 10, start: null, end: null, color: gold, mat: 'gold', bind });
      for (const s of [1, -1]) {
        kit.loft([ps(p[0] + s * (w + 0.001), p[1], p[2], dr * 0.5, dr * 0.5), ps(p[0] + s * (w + 0.007), p[1], p[2], dr * 0.46, dr * 0.46)], { ref: [0, 1, 0], sides: 8, start: 'flat', end: 'flat', color: boss, mat: 'lacquer', bind });
      }
    }
  } else {
    // eight pearls on the ring, rays between them
    for (let i = 0; i < 8; i++) ball(kit, at((i / 8) * TAU), 0.024 * K, { color: tintC(color || pal.glow, 0.4), mat: 'gem', glow: 1, bind });
    const rays = 16;
    for (let i = 0; i < rays; i++) {
      const a = ((i + 0.5) / rays) * TAU;
      const L = i % 2 ? 0.14 : 0.26;
      const q = (r) => at(a, r);
      const p0 = q(R * 1.03);
      const p1 = q(R * 1.03 + L * 0.45 * K);
      const p2 = q(R * 1.03 + L * K);
      kit.loft([ps(p0[0], p0[1], p0[2], 0.006, 0.02 * K), ps(p1[0], p1[1], p1[2], 0.005, 0.012 * K), ps(p2[0], p2[1], p2[2], 0.001, 0.0015)],
        { ref: [1, 0, 0], sides: 4, start: null, end: 'round', capRings: 1, capDepth: 0.004, color: mixC(gold, '#fff0b0', 0.4), mat: 'gem', glow: 0.8, bind });
    }
  }
}

/**
 * The sashimono: a banner on a pole at the small of the back, riding the chest. A pole with a gold
 * finial and a socket, a crossbar, and a flag hanging from it with a ripple in it (a stripe at top and
 * foot, a gold mon in the middle). opts: flag and inner (the two faces' colors, the team's by default),
 * stripe, mon.
 */
export function addSashimono(E, { flag, inner = null, stripe = null, mon = null } = {}) {
  const { kit, D, pal } = E;
  const bind = E.bind.chest;
  const x = -D.chestD * 0.5 - 0.075;
  const y0 = D.shoulderY - 0.26;
  const yTop = D.shoulderY + 0.9;
  const gold = pal.accentMetal;
  const wood = pal.woodDark || pal.wood;
  kit.loft([vs(y0, 0.014, 0.014, x, 0), vs(yTop, 0.011, 0.011, x, 0)], { sides: 8, rings: 4, start: null, end: null, color: wood, mat: 'wood', bind });
  // the socket on the back, the finial
  kit.loft([vs(y0 + 0.02, 0.026, 0.026, x, 0), vs(y0 + 0.07, 0.02, 0.02, x, 0)], { sides: 10, start: null, end: null, color: gold, mat: 'gold', bind });
  kit.loft([ps(x, yTop - 0.004, 0, 0.012, 0.012), ps(x, yTop + 0.034, 0, 0.018, 0.018), ps(x, yTop + 0.07, 0, 0.004, 0.004)], { ref: [1, 0, 0], sides: 8, start: null, end: 'round', capRings: 2, capDepth: 0.01, color: gold, mat: 'gold', bind });
  // the crossbar the flag hangs from, a knob at each end
  const fw = 0.145; // half the flag's width
  const fy = yTop - 0.09;
  kit.loft([ps(x, fy, -fw - 0.03, 0.008, 0.008), ps(x, fy, fw + 0.03, 0.008, 0.008)], { ref: [1, 0, 0], sides: 6, start: 'round', end: 'round', capRings: 2, capDepth: 0.01, color: wood, mat: 'wood', bind });
  for (const s of [1, -1]) ball(kit, [x, fy, s * (fw + 0.036)], 0.013, { color: gold, mat: 'gold', bind });
  // the flag hangs from the bar, a gentle ripple in x
  const fh = 0.46;
  const ripple = (u, v) => -0.012 * Math.sin(v * 4.5 + 0.8) * v - 0.004 * Math.sin(u * 3.1 + v * 2) - 0.014 * v * v;
  const fn = (u, v, out) => {
    out[0] = x - 0.02 + ripple(u, v);
    out[1] = fy - 0.012 - v * fh;
    out[2] = (u - 0.5) * 2 * fw * (1 - 0.04 * v);
  };
  const band = stripe || gold;
  const inside = inner || (flag.team ? { team: flag.team * 0.8, mat: flag.mat } : shadeC(flag, 0.8));
  const part = (v0, v1, nv, color, back) => kit.sheet(6, nv, (u, v, out) => fn(u, v0 + (v1 - v0) * v, out), { thick: 0.006, color, inner: back, bind });
  part(0, 0.07, 1, band, band);
  part(0.07, 0.93, 7, flag, inside);
  part(0.93, 1, 1, band, band);
  // the mon: a disc through the middle of the flag, showing on both faces
  const mr = fh * 0.17;
  const mx = x - 0.02 + ripple(0.5, 0.5);
  kit.loft([ps(mx - 0.011, fy - 0.012 - fh * 0.5, 0, mr, mr), ps(mx + 0.011, fy - 0.012 - fh * 0.5, 0, mr, mr)], {
    ref: [0, 1, 0], sides: 14, start: 'flat', end: 'flat', color: mon || gold, mat: 'gold', bind,
  });
}

/**
 * The kaoqi: four pennants on slender poles standing up behind a general's shoulders, two to a side and fanned apart,
 * riding the chest. Each pole ends in a gold point; its pennant, swallow-tailed and edged in gold, streams outward from
 * it. opts: flag (the pennants' color, the team's), edge (the border; default the unit's gold).
 */
export function addKaoqi(E, { flag, edge = null } = {}) {
  const { kit, D, pal } = E;
  const bind = E.bind.chest;
  const K = D.k;
  const gold = pal.accentMetal;
  const border = edge || gold;
  const wood = pal.woodDark || pal.wood;
  const x0 = -D.chestD * 0.5 - 0.034;
  const y0 = D.shoulderY - 0.05;
  // [outward lean, length, fore-aft lean] of each pole on the right side; the left mirrors them
  const poles = [[0.3, 0.44, 0.16], [0.72, 0.34, 0.2]];
  for (const side of [1, -1]) {
    for (const [lean, L0, back] of poles) {
      const L = L0 * K;
      const t = [-Math.sin(back), Math.cos(lean) * Math.cos(back), side * Math.sin(lean) * Math.cos(back)];
      const tl = Math.hypot(...t);
      const dir = t.map((q) => q / tl);
      const root = [x0, y0, side * 0.05 * K];
      const at = (d) => [root[0] + dir[0] * d, root[1] + dir[1] * d, root[2] + dir[2] * d];
      const tip = at(L);
      const mid = at(L * 0.5);
      kit.loft([ps(root[0], root[1], root[2], 0.0066 * K), ps(mid[0], mid[1], mid[2], 0.0058 * K), ps(tip[0], tip[1], tip[2], 0.0048 * K)],
        { ref: [1, 0, 0], rings: 3, sides: 5, start: 'round', end: null, capRings: 1, capDepth: 0.006 * K, color: wood, mat: 'wood', bind });
      // the gold socket at the foot, and the point at the top
      const s0 = at(0.03 * K);
      const s1 = at(0.075 * K);
      kit.loft([ps(s0[0], s0[1], s0[2], 0.011 * K), ps(s1[0], s1[1], s1[2], 0.009 * K)], { ref: [1, 0, 0], sides: 8, start: null, end: null, color: gold, mat: 'gold', bind });
      const p1 = at(L + 0.075 * K);
      kit.loft([ps(tip[0], tip[1], tip[2], 0.0105 * K), ps(...at(L + 0.02 * K), 0.0105 * K), ps(p1[0], p1[1], p1[2], 0.0015 * K)],
        { ref: [1, 0, 0], rings: 3, sides: 6, start: null, end: 'round', capRings: 1, capDepth: 0.006 * K, color: gold, mat: 'gold', bind });
      // the pennant: flown outward and a little back from the pole, narrowing to a swallow tail
      const f = [-0.25, 0, side];
      const fd = f[0] * dir[0] + f[1] * dir[1] + f[2] * dir[2];
      const w = [f[0] - dir[0] * fd, f[1] - dir[1] * fd, f[2] - dir[2] * fd];
      const wl = Math.hypot(...w);
      const wv = w.map((q) => q / wl);
      const nv = [dir[1] * wv[2] - dir[2] * wv[1], dir[2] * wv[0] - dir[0] * wv[2], dir[0] * wv[1] - dir[1] * wv[0]];
      const s0f = 0.5 * L;
      const s1f = 0.94 * L;
      const Lf = 0.2 * K;
      kit.sheet(5, 5, (u, v, out) => {
        const notch = 0.34 * (1 - Math.abs(2 * v - 1));
        const uu = u * (1 - notch * u);
        const vv = 0.5 + (v - 0.5) * (1 - 0.5 * uu);
        const p = at(s0f + (s1f - s0f) * vv);
        const rip = 0.012 * K * Math.sin(uu * 4 + side) * uu;
        for (let k = 0; k < 3; k++) out[k] = p[k] + wv[k] * Lf * uu + nv[k] * rip;
        out[1] -= 0.03 * K * uu * uu;
      }, {
        thick: 0.005, color: flag, inner: flag.team ? { team: flag.team * 0.8, mat: flag.mat } : shadeC(flag, 0.8), mat: 'cloth', bind,
        paint: (o, x, y, z, u, a) => { if (a < 0.1 || a > 0.9 || u > 0.92) recolor(o, border, 1); },
      });
    }
  }
}

/** Catmull-Rom through a list of [x, y, z] points, t from 0 to 1. */
function spline3(pts, t) {
  const n = pts.length - 1;
  const f = Math.min(n - 1e-6, Math.max(0, t * n));
  const i = Math.floor(f);
  const u = f - i;
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(n, i + 2)];
  return [0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u));
}

/**
 * The pibo: two long ribbons of silk draped from the nape over the shoulders and flowing down behind the arms in
 * arcs, their ends trailing: a goddess's. They ride the cape bones, so they stream behind her when she moves. opts:
 * color, trim (a thin edge at each border).
 */
export function addPibo(E, { color, trim = null } = {}) {
  const { kit, D } = E;
  const bind = E.bind.cape;
  const K = D.k;
  const sh = D.shoulderY;
  const z = D.shoulderZ;
  for (const side of [1, -1]) {
    const path = [
      [-0.05, sh + 0.045 * K, side * 0.02 * K],
      [-0.03, sh + 0.06 * K, side * z * 0.55],
      [-0.012, sh + 0.05 * K, side * z * 0.95],
      [-0.05, sh - 0.03 * K, side * (z + 0.07 * K)],
      [-0.12, sh - 0.18 * K, side * (z + 0.09 * K)],
      [-0.2, sh - 0.34 * K, side * (z + 0.06 * K)],
      [-0.27, sh - 0.5 * K, side * (z + 0.08 * K)],
      [-0.31, sh - 0.62 * K, side * (z + 0.04 * K)],
    ];
    const edge = (u) => (u < 0.1 || u > 0.9);
    kit.sheet(4, 20, (u, v, out) => {
      const p = spline3(path, v);
      const wid = 0.036 * K * (1 - 0.35 * v) * (u - 0.5) * 2;
      out[0] = p[0] + wid + 0.012 * K * Math.sin(v * 9 + (side > 0 ? 0 : 1.7)) * v;
      out[1] = p[1];
      out[2] = p[2] + 0.014 * K * Math.sin(v * 7 + 1) * v;
    }, {
      thick: 0.005, color, inner: color.team ? { team: color.team * 0.82, mat: color.mat } : shadeC(color, 0.84), mat: 'cloth', bind,
      paint: trim ? (o, x, y, z2, u) => { if (edge(u)) recolor(o, trim, 1); } : null,
    });
  }
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

/**
 * A tail from the small of the back, riding the pelvis. `forked` rises in a curve and splits into
 * two upright prongs (Set's); `monkey` is long, rises in an S and curls forward over the back with a
 * pale tuft at its tip (Hanuman's). opts: color (default the unit's skin), len (scale of the length), kind.
 */
export function addTail(E, { color = null, len = 1, kind = 'forked' } = {}) {
  const { kit, D, pal } = E;
  const K = D.k * len;
  const col = color || pal.skin;
  const bind = rigid(B.pelvis);
  const root = torsoRing(D, 0.16, 0);
  const x0 = root.dx - root.rx + 0.01;
  const y0 = root.y;
  if (kind === 'monkey') {
    const path = [[0, 0, 0.032], [-0.075, 0.0, 0.03], [-0.15, 0.03, 0.028], [-0.215, 0.1, 0.026], [-0.245, 0.19, 0.024], [-0.24, 0.29, 0.022], [-0.205, 0.37, 0.02], [-0.15, 0.415, 0.0185], [-0.1, 0.425, 0.0185], [-0.066, 0.418, 0.027], [-0.034, 0.402, 0.02]];
    const tuft = mixC(col, '#f8dfae', 0.55);
    kit.loft(path.map(([dx, dy, r]) => ps(x0 + dx * K, y0 + dy * K, 0, r * D.k, r * D.k)), {
      ref: [0, 0, 1], rings: 18, sides: 8, start: 'round', end: 'round', capDepth: [0.012 * K, 0.016 * K], color: col, mat: 'skin', bind,
      paint: (o, x, y, z, u) => {
        mul(o, 0.88 + 0.2 * Math.abs(Math.sin(u * 70 + z * 60)));
        tint(o, tuft, clamp((u - 0.84) / 0.12) * 0.85);
      },
    });
    return;
  }
  // the stem: out and up from the back, a gentle S
  const stem = [[0, 0, 0.034], [-0.07, 0.008, 0.03], [-0.135, 0.045, 0.026], [-0.168, 0.11, 0.0215], [-0.172, 0.18, 0.0175]];
  kit.loft(stem.map(([dx, dy, r]) => ps(x0 + dx * K, y0 + dy * K, 0, r * D.k, r * D.k * 0.92)), {
    ref: [0, 0, 1], rings: 8, sides: 8, start: 'round', end: null, capDepth: 0.012 * K, color: col, mat: 'skin', bind,
    paint: (o, x, y, z, u) => mul(o, 0.9 + 0.1 * u),
  });
  // the fork: two prongs curving apart and back up
  const top = stem[stem.length - 1];
  for (const side of [1, -1]) {
    const prong = [[top[0], top[1], 0.0175, 0], [top[0] - 0.004, top[1] + 0.05, 0.0145, 0.012], [top[0] - 0.008, top[1] + 0.105, 0.0105, 0.034], [top[0] - 0.004, top[1] + 0.155, 0.0045, 0.052]];
    kit.loft(prong.map(([dx, dy, r, dz]) => ps(x0 + dx * K, y0 + dy * K, side * dz * K, r * D.k, r * D.k)), {
      ref: [0, 0, 1], rings: 7, sides: 7, start: null, end: 'round', capDepth: 0.01 * K, color: col, mat: 'skin', bind,
      paint: (o, x, y, z, u) => mul(o, 1 - 0.28 * u),
    });
  }
}

// ---------------------------------------------------------------------------
// extra arms (a rigid piece on the chest bone)
// ---------------------------------------------------------------------------

/** How each pair of extra arms is held (right side; the left mirrors): the root as fractions of the shoulder width, the directions of the upper arm and forearm, and where the held item points. */
const ARM_POSES = [
  { root: [-0.05, -0.055, 0.8], upper: [-0.16, 0.5, 0.85], fore: [0.1, 1.0, 0.3], item: [0.1, 1, 0.45] },
  { root: [-0.035, -0.128, 0.78], upper: [0.05, -0.62, 0.8], fore: [0.95, 0.4, -0.2], item: [1, 0.5, -0.15] },
  { root: [-0.06, -0.01, 0.84], upper: [-0.3, 0.9, 0.6], fore: [0.0, 1.0, 0.55], item: [0, 1, 0.35] },
];

/**
 * The extra arms of a many-armed god: pairs of arms from the shoulder blades, the first pair raised
 * with the hands up, the next held out in front, each hand holding its item. `items` is a list of
 * [right, left] item ids (a rich-gear.js weapon or a rich-arms.js item; null is an open hand). Returns
 * the rigid attach entry (riding the chest bone: the extra arms do not swing).
 */
export function extraArmsPiece(E, items) {
  const { D, pal, spec, skin, skinPaint } = E;
  const kit = new MeshKit(null, { sides: 8 });
  const gold = pal.accentMetal;
  const sw = D.weaponSize * 0.58;
  const hr = D.handR / 0.048;
  const unit = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const along = (p, d, t) => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
  const refFor = (d) => (Math.abs(d[1]) < 0.8 ? [0, 1, 0] : [1, 0, 0]);
  const limb = (a, b, ra, rb, opts) => {
    const d = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const mid = along(a, d, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 0.5);
    kit.loft([ps(a[0], a[1], a[2], ra, ra * 0.95), ps(mid[0], mid[1], mid[2], (ra + rb) * 0.5 * 1.08, (ra + rb) * 0.5 * 1.03), ps(b[0], b[1], b[2], rb, rb * 0.95)],
      { ref: refFor(d), rings: 4, sides: 8, capRings: 2, color: skin, paint: skinPaint, ...opts });
  };
  const band = (c, d, r, w, color = gold) => {
    kit.loft([ps(c[0] - d[0] * w * 0.5, c[1] - d[1] * w * 0.5, c[2] - d[2] * w * 0.5, r), ps(c[0] + d[0] * w * 0.5, c[1] + d[1] * w * 0.5, c[2] + d[2] * w * 0.5, r)],
      { ref: refFor(d), sides: 8, start: null, end: null, color, mat: 'gold', glow: 0.1 });
  };
  items.forEach((pair, p) => {
    const pose = ARM_POSES[p % ARM_POSES.length];
    pair.forEach((item, i) => {
      const side = i === 0 ? 1 : -1;
      const flip = (v) => [v[0], v[1], v[2] * side];
      const root = [pose.root[0], D.shoulderY + pose.root[1], D.shoulderZ * pose.root[2] * side];
      const du = unit(flip(pose.upper));
      const df = unit(flip(pose.fore));
      const elbow = along(root, du, D.upper * 0.97);
      const wrist = along(elbow, df, D.fore * 0.97);
      const hand = along(wrist, df, 0.046 * hr);
      limb(root, elbow, D.armR * 1.08, D.armR * 0.88, { start: 'round', capDepth: D.armR });
      limb(elbow, wrist, D.armR * 0.88, D.armR * 0.62, { start: null });
      // the hand: a rounded mitten along the forearm
      kit.loft([ps(...wrist, 0.027 * hr, 0.031 * hr), ps(...along(wrist, df, 0.034 * hr), 0.031 * hr, 0.042 * hr), ps(...along(wrist, df, 0.07 * hr), 0.025 * hr, 0.034 * hr)],
        { ref: refFor(df), rings: 3, sides: 8, start: null, end: 'round', capRings: 2, capDepth: 0.02 * hr, color: skin, paint: skinPaint });
      // an armlet on the upper arm, a bangle at the wrist
      band(along(root, du, D.upper * 0.5), du, D.armR * 1.1 + 0.012, 0.03, gold);
      band(along(wrist, df, -0.004), df, D.armR * 0.65 + 0.009, 0.022, gold);
      if (!item) return;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...unit(flip(pose.item))));
      const M = new THREE.Matrix4().compose(new THREE.Vector3(...hand), q, new THREE.Vector3(1, 1, 1));
      kit.placed(M, (k) => {
        if (!richWeapon(k, pal, item, sw)) richArm(k, pal, item, sw);
      });
    });
  });
  const o = spec.pos[B.chest];
  return { name: 'extraArms', bone: B.chest, geo: finishGear(kit, new THREE.Matrix4().makeTranslation(-o[0], -o[1], -o[2])) };
}
