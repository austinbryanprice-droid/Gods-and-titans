// Ability effect shapes (schema VFX_SHAPES) and the internal building-block
// effects they are made of. Each handler is { start(sys, e), update(sys, e, dt) → alive };
// state lives in the pooled Fx record `e` (see vfx.js), nothing allocates per frame.
import * as THREE from 'three';
import { CELL } from './vfx-textures.js';
import { COLORS, getPalette } from './vfx-palette.js';

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeOutBack = (t) => {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** Points in a lightning path (2^4 + 1 for midpoint displacement). */
export const BOLT_N = 17;

function style(ring, fill, extra = {}) {
  const s = { ring, fill, runes: 0, noise: 0, crack: 0, edge: 0, add: true, ...extra };
  const ringOnly = !s.fill[0] && !s.runes && !s.noise && !s.crack && !s.edge;
  s.inner = ringOnly ? Math.max(0, s.ring[0] - s.ring[1] * 3.2) : 0;
  return s;
}

/**
 * Decal looks: ring = [centre, half width, strength], fill = [strength, falloff power, core mix],
 * plus runes / noise / crack / edge (ragged outline) strengths and additive or normal blending.
 */
export const STYLE = {
  ring: style([0.86, 0.06, 1.1], [0, 1, 0]),
  wideRing: style([0.8, 0.16, 0.85], [0, 1, 0]),
  flash: style([0.88, 0.1, 0.35], [0.9, 1.3, 0.45]),
  glowDisc: style([0.9, 0.05, 0.55], [0.5, 1.1, 0.45]),
  healDisc: style([0.9, 0.05, 0.7], [0.45, 0.9, 0.5], { noise: 0.35 }),
  scorch: style([0, 0, 0], [0.95, 0.55, 0], { noise: 0.75, edge: 0.6, add: false }),
  crack: style([0, 0, 0], [0.4, 1.6, 0], { crack: 1.3, add: false }),
  shadow: style([0, 0, 0], [0.85, 0.45, 0], { noise: 0.5, edge: 0.5, add: false }),
  runes: style([0.95, 0.025, 0.5], [0.22, 1.4, 0.3], { runes: 1.15 }),
  field: style([0.94, 0.045, 0.85], [0.45, 0.6, 0.3], { noise: 0.85 }),
  fieldRunes: style([0.94, 0.045, 0.85], [0.3, 0.7, 0.3], { noise: 0.55, runes: 0.5 }),
  cloud: style([0, 0, 0], [1.25, 0.3, 0.4], { noise: 1, edge: 1, add: false }),
  cloudGlow: style([0, 0, 0], [0.55, 0.7, 0.6], { noise: 1, edge: 0.8 }),
  cone: style([0.9, 0.07, 1.0], [0.5, 0.7, 0.3], { noise: 0.6 }),
  tele: style([0.9, 0.05, 1], [0.18, 0.25, 0]),
};

const RUNE_ELEMENTS = new Set(['holy', 'arcane', 'sun', 'moon', 'shadow', 'death', 'chaos', 'lightning']);
const SCORCH_ELEMENTS = new Set(['fire', 'lightning', 'war', 'chaos', 'sun', 'death', 'shadow', 'earth']);

/** Opacity envelope: fade in over fin, out over the last fout seconds. */
function env(t, life, fin, fout) {
  if (t < fin) return t / fin;
  if (t > life - fout) return Math.max(0, (life - t) / fout);
  return 1;
}

/**
 * Jagged polyline a → b by midpoint displacement into out (n = 5, 9 or 17 points).
 * jag = max sideways offset as a fraction of the length.
 */
export function boltPath(ax, ah, ay, bx, bh, by, jag, out, n = BOLT_N) {
  const last = n - 1;
  out[0] = ax; out[1] = ah; out[2] = ay;
  out[last * 3] = bx; out[last * 3 + 1] = bh; out[last * 3 + 2] = by;
  let dx = bx - ax;
  let dy = bh - ah;
  let dz = by - ay;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= L; dy /= L; dz /= L;
  // perpendicular basis p1, p2
  let p1x;
  let p1y;
  let p1z;
  if (Math.abs(dy) > 0.9) {
    p1x = 0; p1y = -dz; p1z = dy; // d × X
  } else {
    p1x = -dz; p1y = 0; p1z = dx; // d × Y
  }
  const pl = Math.sqrt(p1x * p1x + p1y * p1y + p1z * p1z) || 1;
  p1x /= pl; p1y /= pl; p1z /= pl;
  const p2x = dy * p1z - dz * p1y;
  const p2y = dz * p1x - dx * p1z;
  const p2z = dx * p1y - dy * p1x;
  let step = last;
  let amp = L * jag;
  while (step > 1) {
    const half = step >> 1;
    for (let i = half; i < last; i += step) {
      const i0 = (i - half) * 3;
      const i1 = (i + half) * 3;
      const o1 = (Math.random() - 0.5) * 2 * amp;
      const o2 = (Math.random() - 0.5) * 2 * amp;
      out[i * 3] = (out[i0] + out[i1]) * 0.5 + p1x * o1 + p2x * o2;
      out[i * 3 + 1] = (out[i0 + 1] + out[i1 + 1]) * 0.5 + p1y * o1 + p2y * o2;
      out[i * 3 + 2] = (out[i0 + 2] + out[i1 + 2]) * 0.5 + p1z * o1 + p2z * o2;
    }
    amp *= 0.5;
    step = half;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);
const _col = new THREE.Color();

/** Place crescent slot k of e (sim position, outward direction in the ground plane). */
function placeCrescent(sys, e, k, x, y, h, dx, dy, depth, height, width, bright) {
  const slot = e.slots[k];
  if (slot < 0) return;
  _d.set(dx, 0, dy);
  if (_d.lengthSq() < 1e-8) _d.set(1, 0, 0);
  _d.normalize();
  _q.setFromUnitVectors(_X, _d);
  _p.set(x, h, y);
  _s.set(depth, Math.max(0.001, height), Math.max(0.001, width));
  _m.compose(_p, _q, _s);
  const b = sys.batches.crescent;
  b.setMatrix(slot, _m);
  _col.copy(e.pal.linTint).multiplyScalar(bright * 0.8);
  b.setColor(slot, _col);
}

function allocCrescents(sys, e, n) {
  e.nslots = 0;
  for (let i = 0; i < n; i++) {
    const s = sys.batches.crescent.alloc();
    if (s < 0) break;
    e.slots[e.nslots++] = s;
  }
}

/** Uniform random point in a disc into out[0..1]. */
const _rp = [0, 0];
function randDisc(x, y, R) {
  const a = Math.random() * TAU;
  const r = Math.sqrt(Math.random()) * R;
  _rp[0] = x + Math.cos(a) * r;
  _rp[1] = y + Math.sin(a) * r;
  return _rp;
}

// ====================================================================== internal effects

export const INTERNAL = {
  /** Ground decal with radius animation and envelope (see VFXSystem.decalFx). */
  decal: {
    start() {},
    layoutAt(sys, e, r) {
      e.d0.layout(sys.getHeight, e.x, e.y, r, r * e.style.inner, 0, TAU, e.style.add ? 0.07 : 0.05, e.flatY);
      e.k4 = r;
      e.k2 = e.x;
      e.k3 = e.y;
    },
    update(sys, e, dt) {
      const t = e.t;
      if (t >= e.dur) return false;
      const d = e.d0;
      d.u.uOpacity.value = env(t, e.dur, e.fin, e.fout) * e.alpha;
      d.u.uTime.value = t;
      d.u.uSpin.value += e.spin * dt;
      let r = e.k4;
      if (e.r1 !== e.r0) r = e.r0 + (e.r1 - e.r0) * easeOut(Math.min(1, t / (e.dur * 0.8)));
      if (Math.abs(r - e.k4) > 0.004 || e.x !== e.k2 || e.y !== e.k3) this.layoutAt(sys, e, r);
      return true;
    },
  },

  /** Billboard flash. */
  flare: {
    start() {},
    update(sys, e, dt) {
      const t = e.t;
      if (t >= e.dur) return false;
      const f = e.f0;
      const k = t / e.dur;
      f.u.uSize.value = e.r0 + (e.r1 - e.r0) * easeOut(k);
      const fo = t < e.fin ? t / e.fin : 1 - (t - e.fin) / (e.dur - e.fin);
      f.u.uOpacity.value = e.alpha * (t < e.fin ? fo : fo * fo);
      f.u.uSpin.value += e.spin * dt;
      return true;
    },
  },

  /** Column of light. */
  pillar: {
    start() {},
    update(sys, e, dt) {
      const t = e.t;
      if (t >= e.dur) return false;
      const p = e.p0;
      const grow = easeOut(Math.min(1, t / Math.max(0.05, e.dur * 0.2)));
      const shrink = t > e.dur - e.fout ? 1 - 0.65 * ((t - (e.dur - e.fout)) / e.fout) : 1;
      const r = e.r0 * (0.45 + 0.55 * grow) * shrink;
      p.mesh.scale.set(r, e.k0 * (0.55 + 0.45 * grow), r);
      p.u.uOpacity.value = env(t, e.dur, e.fin, e.fout) * e.alpha;
      p.u.uTime.value += dt;
      return true;
    },
  },

  /** Flickering lightning bolt with forks. pts[0..5] = endpoints (world). */
  bolt: {
    start(sys, e) {
      const main = sys.acquireRibbon(e, e.c, e.cc, e.k0);
      if (!main) return;
      main.u.uFade.value.set(0.02, 0.02);
      main.u.uHot.value = 5; // white-hot channel: blooms
      for (let i = 0; i < e.k2; i++) {
        const b = sys.acquireRibbon(e, e.c, e.cc, e.k0 * 0.55);
        if (b) {
          b.u.uFade.value.set(0.02, 0.3);
          b.u.uHot.value = 3;
        }
      }
      e.timer = 0;
      this.relay(sys, e);
    },
    relay(sys, e) {
      const P = e.pts;
      const main = e.ribs[0];
      if (!main) return;
      sys.layBolt(main, P[0], P[1], P[2], P[3], P[4], P[5], e.k1);
      const len = Math.hypot(P[3] - P[0], P[4] - P[1], P[5] - P[2]);
      for (let i = 1; i < e.nrib; i++) {
        const r = e.ribs[i];
        const k = 3 + Math.floor(Math.random() * (BOLT_N - 8));
        const sx = main.pts[k * 3];
        const sy = main.pts[k * 3 + 1];
        const sz = main.pts[k * 3 + 2];
        const bl = len * rnd(0.18, 0.32);
        const a = Math.random() * TAU;
        sys.layBolt(r, sx, sy, sz, sx + Math.cos(a) * bl * 0.7, sy - bl * rnd(0.3, 0.8), sz + Math.sin(a) * bl * 0.7, 0.2, 9);
      }
      e.k3 = rnd(0.65, 1.05);
    },
    update(sys, e, dt) {
      const t = e.t;
      if (t >= e.dur || e.nrib === 0) return false;
      e.timer -= dt;
      if (e.timer <= 0) {
        if (e.k1 > 0) this.relay(sys, e);
        else e.k3 = rnd(0.8, 1.05);
        e.timer = rnd(0.035, 0.07);
      }
      const k = t / e.dur;
      const fade = k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55;
      const a = e.k3 * fade * Math.min(1, t / 0.03 + 0.4);
      for (let i = 0; i < e.nrib; i++) {
        const r = e.ribs[i];
        if (!r) continue;
        r.u.uOpacity.value = i === 0 ? a : a * 0.8;
        r.u.uWidth.value = (i === 0 ? e.k0 : e.k0 * 0.55) * (0.7 + 0.3 * fade);
      }
      return true;
    },
  },

  /** Golden level-up column. */
  levelup: {
    start(sys, e) {
      const pal = e.pal;
      const { x, y, gz } = e;
      sys.pillarFx(x, y, 0.75, 7.5, 1.25, COLORS.gold, COLORS.goldCore, 1, 0.1, 0.55);
      sys.flareFx(x, gz + 1, y, 1.5, 3.6, 0.65, COLORS.gold, COLORS.goldCore, 1, 1.1, 0.08);
      sys.decalFx(STYLE.ring, x, y, 0.3, 2.0, 0.75, COLORS.gold, COLORS.goldCore, 1, 0.03, 0.4);
      sys.decalFx(STYLE.runes, x, y, 1.25, 1.35, 1.3, COLORS.gold, COLORS.goldCore, 0.9, 0.15, 0.5, 1.6);
      sys.burst(sys.add, x, gz + 0.4, y, 26, 2.5, 5, 0.5, 3, 0.45, 0.8, 0.3, 0.05, COLORS.goldCore, pal.glow, 1, CELL.STAR, 2, 2.2);
      e.dur = 1.0;
    },
    update(sys, e, dt) {
      if (e.t >= e.dur) return false;
      const n = sys.rate(e, 'acc0', 90, dt);
      for (let i = 0; i < n; i++) {
        const k = i & 1;
        const tt = e.t - Math.random() * dt;
        const a = tt * 9 + k * Math.PI;
        const h = (tt / e.dur) * 2.6;
        const p = sys.add.add(e.x + Math.cos(a) * 0.65, e.gz + 0.15 + h, e.y + Math.sin(a) * 0.65, 0, rnd(0.3, 0.7), 0, rnd(0.45, 0.65), 0.26, 0.06, COLORS.goldCore, 1, CELL.STAR);
        sys.add.setEnd(p, COLORS.gold);
      }
      return true;
    },
  },
};

// ====================================================================== shared pieces

/** Pillar-of-light summon used by the 'summon' shape and spawnSummon (S = scale). */
function summonStart(sys, e, S) {
  const pal = e.pal;
  const { x, y, gz } = e;
  e.k0 = S;
  e.dur = 1.75;
  e.stage = 0;
  const height = 6 + 2.6 * S;
  sys.pillarFx(x, y, 0.45 + 0.34 * S, height, 1.4, pal.glow, pal.core, 1, 0.12, 0.55);
  sys.flashLight(x, gz + 2, y, pal.glow, 7 + 3 * S, 5 + 2 * S, 1.6, 0.25);
  sys.boltFx(x, gz + height, y, x, gz + 0.05, y, 1.05, 0.28 + 0.14 * S, pal.glow, pal.core, 0, 0);
  sys.decalFx(STYLE.runes, x, y, 0.95 + 0.6 * S, 1.05 + 0.66 * S, 1.75, pal.glow, pal.core, 1, 0.22, 0.6, 1.3);
  sys.decalFx(STYLE.glowDisc, x, y, 0.6 + 0.4 * S, 0.8 + 0.5 * S, 1.5, pal.glow, pal.core, 0.6, 0.2, 0.6);
  if (pal.gloom) sys.decalFx(STYLE.shadow, x, y, 1.0 + 0.6 * S, 1.1 + 0.7 * S, 1.8, pal.gloom, pal.gloom, 0.45, 0.2, 0.7);
  if (S >= 2.8) sys.addShake(0.12 + 0.04 * S, x, y);
}

function summonUpdate(sys, e, dt) {
  const t = e.t;
  if (t >= e.dur) return false;
  const S = e.k0;
  const pal = e.pal;
  const { x, y, gz } = e;
  if (t < 0.9) {
    const R = 1.3 + 0.65 * S;
    const n = sys.rate(e, 'acc0', 55 + 25 * S, dt);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const h = rnd(0.1, 1.2 + 0.4 * S);
      const life = rnd(0.35, 0.5);
      const v = (R * 0.9) / life;
      const p = sys.add.add(x + Math.cos(a) * R, gz + h, y + Math.sin(a) * R, -Math.cos(a) * v, rnd(0.5, 2), -Math.sin(a) * v, life, rnd(0.18, 0.3), 0.08, pal.glow, 0.95, i % 3 ? CELL.GLOW : CELL.STAR);
      sys.add.setEnd(p, pal.core);
      sys.add.setFadeIn(p, 0.3);
    }
    const m = sys.rate(e, 'acc1', 40 + 15 * S, dt);
    for (let i = 0; i < m; i++) {
      const pt = randDisc(x, y, 0.35 * S + 0.2);
      sys.add.add(pt[0], gz + rnd(0, 0.6), pt[1], 0, rnd(2.5, 6) * (0.6 + 0.2 * S), 0, rnd(0.5, 0.8), rnd(0.2, 0.32), 0.06, pal.core, 1, CELL.STAR);
    }
  }
  if (e.stage === 0 && t >= 0.85) {
    e.stage = 1;
    sys.flareFx(x, gz + 0.8 + 0.3 * S, y, 1.5 + 0.8 * S, 3 + 1.6 * S, 0.5, pal.glow, pal.core, 1, 1, 0.06);
    sys.decalFx(STYLE.ring, x, y, 0.3, 1.8 + 0.9 * S, 0.65, pal.glow, pal.core, 1, 0.02, 0.4);
    sys.decalFx(STYLE.wideRing, x, y, 0.3, 1.5 + 0.8 * S, 0.7, pal.glow, pal.core, 0.6, 0.02, 0.45);
    sys.burst(sys.add, x, gz + 0.4, y, 24 + 8 * S, 2 + S, 4 + 1.5 * S, 0.4, 2.5, 0.4, 0.7, 0.3, 0.06, pal.core, pal.glow, 1, CELL.STAR, 2, 2.4);
    if (S >= 2.8) {
      sys.addShake(0.2 + 0.05 * S, x, y);
      const n = sys.n(18 + 4 * S);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const sp = rnd(1.5, 3) * Math.sqrt(S);
        const p = sys.alpha.add(x + Math.cos(a) * 0.6 * S, gz + 0.2, y + Math.sin(a) * 0.6 * S, Math.cos(a) * sp, rnd(0.3, 0.8), Math.sin(a) * sp, rnd(0.9, 1.4), 0.6 + 0.15 * S, 1.6 + 0.3 * S, COLORS.dust, 0.45, CELL.SMOKE, -0.2, 2.4);
        sys.alpha.setSpin(p, Math.random() * TAU, rnd(-1, 1));
      }
    }
  }
  return true;
}

/** Explosion on the ground (meteor impact). */
function explode(sys, pal, x, y, gz, R) {
  sys.flareFx(x, gz + 0.8, y, 2.4 + 1.2 * R, 4.4 + 1.8 * R, 0.55, pal.glow, pal.core, 1, 0.7, 0.05);
  sys.decalFx(STYLE.wideRing, x, y, 0.3, R * 1.35, 0.75, pal.glow, pal.core, 1, 0.02, 0.45);
  sys.decalFx(STYLE.ring, x, y, 0.2, R * 1.2, 0.55, pal.core, pal.core, 0.9, 0.02, 0.35);
  sys.decalFx(STYLE.flash, x, y, R, R * 1.1, 0.55, pal.glow, pal.core, 0.9, 0.02, 0.45);
  const scorch = sys.decalFx(STYLE.crack, x, y, R * 0.85, R * 0.9, 4.5, pal.dark || COLORS.scorch, pal.dark || COLORS.scorch, 0.75, 0.05, 2);
  if (scorch) scorch.d0.u.uFill.value.set(0.85, 0.7, 0);
  // fireball
  const n = sys.n(36 + 14 * R);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const sp = rnd(1.5, 4.5) * (0.6 + 0.25 * R);
    const p = sys.add.add(x + Math.cos(a) * 0.3, gz + rnd(0.2, 0.8), y + Math.sin(a) * 0.3, Math.cos(a) * sp, rnd(1, 4.5), Math.sin(a) * sp, rnd(0.45, 0.85), rnd(0.9, 1.4) * (0.7 + 0.15 * R), 0.35, pal.mid, 0.7, CELL.FLAME, -1.5, 2.6);
    sys.add.setEnd(p, pal.alt);
  }
  sys.burst(sys.add, x, gz + 0.4, y, 28, 3, 7, 2, 6, 0.6, 1.1, 0.16, 0.04, COLORS.ember, pal.alt, 1, CELL.SPARK, 10, 0.6);
  const d = sys.n(14 + 4 * R);
  for (let i = 0; i < d; i++) {
    const a = Math.random() * TAU;
    const sp = rnd(2, 5);
    const p = sys.alpha.add(x, gz + 0.4, y, Math.cos(a) * sp, rnd(3, 7), Math.sin(a) * sp, rnd(1.0, 1.5), rnd(0.2, 0.4), 0.15, COLORS.debris, 1, CELL.SHARD, 15, 0.2);
    sys.alpha.setSpin(p, Math.random() * TAU, rnd(-10, 10));
    sys.alpha.setFloor(p, gz + 0.05);
  }
  const sm = sys.n(10 + 3 * R);
  for (let i = 0; i < sm; i++) {
    const pt = randDisc(x, y, R * 0.6);
    const p = sys.alpha.add(pt[0], gz + rnd(0.3, 1.2), pt[1], rnd(-0.6, 0.6), rnd(0.6, 1.6), rnd(-0.6, 0.6), rnd(1.4, 2.2), rnd(0.8, 1.2), rnd(2, 3) * (0.6 + 0.2 * R), pal.smoke, 0.45, CELL.SMOKE, -0.2, 1.2);
    sys.alpha.setSpin(p, Math.random() * TAU, rnd(-0.6, 0.6));
    sys.alpha.setFadeIn(p, 0.15);
  }
  sys.addShake(Math.min(0.85, 0.3 + 0.08 * R), x, y);
}

/** Small strike used by storms (and as the strike core). */
function miniStrike(sys, e, px, py, cloudH) {
  const pal = e.pal;
  const pg = sys.ground(px, py);
  const el = pal.el;
  if (pal.jagged || el === 'shadow' || el === 'death') {
    sys.boltFx(px + rnd(-0.6, 0.6), cloudH, py + rnd(-0.6, 0.6), px, pg, py, rnd(0.22, 0.32), rnd(0.26, 0.36), pal.glow, pal.core, 0.12, Math.random() < 0.6 ? 1 : 0);
    sys.flareFx(px, pg + 0.3, py, 0.7, 1.9, 0.28, pal.glow, pal.core, 0.95, 0, 0.05);
    sys.decalFx(STYLE.ring, px, py, 0.1, 1.0, 0.35, pal.glow, pal.core, 0.9, 0.02, 0.25);
    sys.burst(sys.add, px, pg + 0.15, py, 9, 1.5, 4, 1, 4, 0.25, 0.5, 0.17, 0.03, pal.core, pal.glow, 1, CELL.SPARK, 9, 1);
    sys.addShake(0.035, px, py);
    e.k2 = 1;
  } else if (el === 'fire') {
    sys.launch('fireball', pal, px - 1.2, cloudH, py - 1.6, px, 0.1, py, 0.38, 1.25, 0.9);
    e.k2 = 0.6;
  } else if (el === 'ice') {
    sys.launch('ice', pal, px - 0.8, cloudH, py - 1.2, px, 0.05, py, 0.32, 1.4, 0);
  } else if (el === 'earth') {
    sys.launch('rock', pal, px - 0.8, cloudH, py - 1.2, px, 0.05, py, 0.42, 1.2, 0);
  } else if (el === 'holy' || el === 'sun' || el === 'moon') {
    sys.pillarFx(px, py, 0.32, cloudH - pg, 0.45, pal.glow, pal.core, 0.95, 0.04, 0.3);
    sys.flareFx(px, pg + 0.3, py, 0.8, 1.8, 0.3, pal.glow, pal.core, 0.9, 0.5, 0.05);
    sys.decalFx(STYLE.ring, px, py, 0.1, 1.0, 0.35, pal.glow, pal.core, 0.9, 0.02, 0.25);
    e.k2 = 0.8;
  } else if (el === 'wind' || el === 'sand') {
    sys.decalFx(STYLE.wideRing, px, py, 0.2, 1.4, 0.5, pal.glow, pal.core, 0.6, 0.03, 0.35);
    const n = sys.n(10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const p = sys.alpha.add(px + Math.cos(a) * 0.4, pg + rnd(0.1, 0.8), py + Math.sin(a) * 0.4, -Math.sin(a) * 3 + Math.cos(a), rnd(0.5, 2), Math.cos(a) * 3 + Math.sin(a), rnd(0.5, 0.9), 0.4, 1.0, pal.smoke, 0.45, CELL.SMOKE, 0, 2);
      sys.alpha.setSpin(p, Math.random() * TAU, 3);
    }
  } else {
    sys.launch('orb', pal, px - 0.8, cloudH, py - 1.2, px, 0.1, py, 0.3, 1.2, 0.7);
    e.k2 = 0.5;
  }
}

// ====================================================================== ability shapes

export const SHAPES = {
  strike: {
    start(sys, e) {
      const pal = e.pal;
      const R = Math.max(e.r, 0.7);
      const { x, y, gz } = e;
      if (pal.jagged) {
        const sx = x + rnd(-1.4, 1.4);
        const sy = y + rnd(-2.4, -1.2);
        sys.boltFx(sx, gz + 15, sy, x, gz, y, 0.45, 0.42 + 0.07 * R, pal.glow, pal.core, 0.09, 2);
        sys.boltFx(sx + rnd(-0.5, 0.5), gz + 15, sy, x + rnd(-0.3, 0.3), gz, y + rnd(-0.3, 0.3), 0.32, 0.24, pal.glow, pal.core, 0.13, 1);
        if (R > 1.5) {
          for (let k = 0; k < 3; k++) {
            const a = Math.random() * TAU;
            sys.boltFx(x, gz + 0.3, y, x + Math.cos(a) * R * 0.9, gz + 0.05, y + Math.sin(a) * R * 0.9, 0.22, 0.2, pal.glow, pal.core, 0.22, 0, 0.04 + k * 0.03);
          }
        }
      } else {
        sys.pillarFx(x, y, 0.32 + 0.2 * R, 14, 0.6, pal.glow, pal.core, 1, 0.05, 0.4);
        sys.boltFx(x, gz + 14, y, x, gz, y, 0.4, 0.34 + 0.1 * R, pal.glow, pal.core, 0, 0);
      }
      const rays = pal.el === 'holy' || pal.el === 'sun' ? 1 : 0.35;
      sys.flareFx(x, gz + 0.4, y, 1.4 + 0.8 * R, 2.8 + 1.2 * R, 0.42, pal.glow, pal.core, 1, rays, 0.04);
      sys.decalFx(STYLE.ring, x, y, 0.2, R * 1.15, 0.55, pal.glow, pal.core, 1, 0.03, 0.35);
      sys.decalFx(STYLE.flash, x, y, R, R, 0.45, pal.glow, pal.core, 0.85, 0.02, 0.4);
      if (SCORCH_ELEMENTS.has(pal.el)) sys.decalFx(STYLE.scorch, x, y, R * 0.7, R * 0.8, 2.6, pal.dark || COLORS.scorch, COLORS.scorch, 0.55, 0.05, 1.4);
      sys.burst(sys.add, x, gz + 0.2, y, 18 + 8 * R, 2, 6 + R, 1.5, 6, 0.35, 0.75, 0.22, 0.04, pal.core, pal.glow, 1, CELL.SPARK, 9, 1.2);
      sys.burst(sys.add, x, gz + 0.3, y, 6 + 2 * R, 0.3, 1.2, 0.8, 2.2, 0.6, 1.0, 0.5, 0.1, pal.glow, pal.alt, 0.6, CELL.GLOW, -0.5, 1);
      sys.addShake(0.07 + 0.04 * R, x, y);
    },
    update() {
      return false;
    },
  },

  nova: {
    start(sys, e) {
      const pal = e.pal;
      const R = Math.max(e.r, 1);
      const { x, y, gz } = e;
      sys.decalFx(STYLE.wideRing, x, y, 0.3, R, 0.6, pal.glow, pal.core, 1, 0.03, 0.35);
      sys.decalFx(STYLE.ring, x, y, 0.2, R * 1.05, 0.5, pal.mid, pal.core, 0.9, 0.02, 0.3);
      sys.decalFx(STYLE.flash, x, y, R * 0.6, R, 0.5, pal.tint, pal.mid, 0.5, 0.02, 0.45);
      if (pal.gloom) sys.decalFx(STYLE.shadow, x, y, 0.4, R * 1.05, 1.0, pal.gloom, pal.gloom, 0.5, 0.05, 0.6);
      sys.flareFx(x, gz + 0.6, y, 1.2 + 0.4 * R, 2 + 0.8 * R, 0.35, pal.glow, pal.core, 1, 0.4);
      const n = sys.n(26 + 10 * R);
      const v = R * 3.3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rnd(-0.1, 0.1);
        const sp = v * rnd(0.75, 1.05);
        const c = Math.cos(a);
        const s = Math.sin(a);
        const p = sys.add.add(x + c * 0.3, gz + rnd(0.15, 0.55), y + s * 0.3, c * sp, rnd(0.2, 1.2), s * sp, rnd(0.45, 0.6), rnd(0.45, 0.65), 0.12, pal.glow, 0.85, i % 3 === 0 ? CELL.STAR : CELL.GLOW, 0, 2.6);
        sys.add.setEnd(p, pal.alt);
      }
      sys.burst(sys.add, x, gz + 0.5, y, 10 + 3 * R, 1, 3, 2, 5, 0.4, 0.8, 0.2, 0.04, pal.core, pal.glow, 1, CELL.SPARK, 6, 1);
      sys.addShake(0.04 * R, x, y);
    },
    update() {
      return false;
    },
  },

  beam: {
    start(sys, e) {
      const pal = e.pal;
      const R = Math.max(e.r, 0.45);
      e.dur = clamp(e.dur || 0.8, 0.6, 1.6);
      const P = e.pts;
      const dist = Math.hypot(e.x - e.fx, e.y - e.fy);
      if (e.hasFrom && dist > 0.3) {
        P[0] = e.fx; P[1] = sys.ground(e.fx, e.fy) + 1.1; P[2] = e.fy;
        P[3] = e.x; P[4] = e.gz + 0.6; P[5] = e.y;
      } else {
        P[0] = e.x; P[1] = e.gz + 12; P[2] = e.y - 2;
        P[3] = e.x; P[4] = e.gz; P[5] = e.y;
      }
      e.k0 = 0.4 + 0.22 * R;
      const main = sys.acquireRibbon(e, pal.glow, pal.core, e.k0);
      if (main) {
        main.u.uStripes.value = 0.45;
        main.u.uFade.value.set(0.02, 0.02);
        main.u.uHot.value = 3.5;
      }
      const halo = sys.acquireRibbon(e, pal.alt, pal.glow, e.k0 * 2.6);
      if (halo) halo.u.uFade.value.set(0.05, 0.05);
      e.g0 = sys.glows.alloc();
      e.g1 = sys.glows.alloc();
      e.light = sys.holdLight(P[3], P[4] + 0.6, P[5], pal.glow, 5 + 3 * R, 4 + 2 * R, 0.12, 0.08);
      e.d0 = sys.acquireDecal(STYLE.glowDisc, pal.glow, pal.core);
      if (e.d0) e.d0.layout(sys.getHeight, P[3], P[5], Math.max(R, 0.8));
      if (pal.gloom) {
        e.d1 = sys.acquireDecal(STYLE.shadow, pal.gloom, pal.gloom);
        if (e.d1) e.d1.layout(sys.getHeight, P[3], P[5], Math.max(R, 0.8) * 1.1);
      }
      sys.flareFx(P[0], P[1], P[2], 0.6, 1.6, 0.3, pal.glow, pal.core, 0.9);
    },
    update(sys, e, dt) {
      const t = e.t;
      const D = e.dur;
      if (t >= D) return false;
      const pal = e.pal;
      const P = e.pts;
      const w = Math.min(1, t / 0.12) * (t > D - 0.25 ? (D - t) / 0.25 : 1);
      const n = 8;
      for (let k = 0; k < e.nrib; k++) {
        const r = e.ribs[k];
        if (!r) continue;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const wob = Math.sin(i * 1.7 + t * 24 + k) * 0.06 * Math.sin(u * Math.PI);
          r.set(i, P[0] + (P[3] - P[0]) * u, P[1] + (P[4] - P[1]) * u + wob, P[2] + (P[5] - P[2]) * u, 0.75 + 0.25 * Math.sin(u * Math.PI));
        }
        r.commit(n);
        r.u.uTime.value = t;
        r.u.uWidth.value = (k === 0 ? e.k0 : e.k0 * 2.6) * (0.3 + 0.7 * w) * (0.92 + 0.08 * Math.sin(t * 45));
        r.u.uOpacity.value = k === 0 ? w : w * 0.32;
      }
      sys.glows.set(e.g0, P[0], P[1], P[2], (0.9 + 0.2 * Math.sin(t * 30)) * w, pal.glow, 1, 0, 0, 1.4);
      sys.glows.set(e.g1, P[3], P[4], P[5], (1.3 + 0.3 * e.k0 + 0.25 * Math.sin(t * 37)) * w, pal.core, 1, 0, 0, 2);
      if (t > D - 0.25 && e.light >= 0) {
        sys.lights.release(e.light, D - t);
        e.light = -1;
      }
      if (e.d0) {
        e.d0.u.uOpacity.value = w * 0.9;
        e.d0.u.uTime.value = t;
      }
      if (e.d1) e.d1.u.uOpacity.value = w * 0.45;
      const s = sys.rate(e, 'acc0', 55, dt);
      for (let i = 0; i < s; i++) {
        const a = Math.random() * TAU;
        const sp = rnd(1, 3.5);
        const p = sys.add.add(P[3], P[4], P[5], Math.cos(a) * sp, rnd(0.5, 3), Math.sin(a) * sp, rnd(0.25, 0.45), 0.2, 0.04, pal.core, 1, CELL.SPARK, 6, 1);
        sys.add.setEnd(p, pal.glow);
      }
      const m = sys.rate(e, 'acc1', 30, dt);
      for (let i = 0; i < m; i++) {
        const u = Math.random();
        sys.add.add(P[0] + (P[3] - P[0]) * u, P[1] + (P[4] - P[1]) * u, P[2] + (P[5] - P[2]) * u, rnd(-0.4, 0.4), rnd(0, 0.6), rnd(-0.4, 0.4), rnd(0.3, 0.5), 0.3, 0.05, pal.glow, 0.8, CELL.GLOW);
      }
      return true;
    },
  },

  cone: {
    start(sys, e) {
      const dist = Math.hypot(e.x - e.fx, e.y - e.fy);
      if (!e.hasFrom || dist < 0.3) {
        SHAPES.nova.start(sys, e);
        e.flag = true;
        return;
      }
      const ang = Math.atan2(e.y - e.fy, e.x - e.fx);
      const L = Math.max(dist, e.r * 1.6, 2.5);
      const half = clamp(Math.atan2(Math.max(e.r, 1) * 1.3, L), 0.35, 0.8);
      e.k0 = ang;
      e.k1 = L;
      e.k2 = half;
      e.k3 = sys.ground(e.fx, e.fy);
      e.dur = 0.8;
      e.d0 = sys.acquireDecal(STYLE.cone, e.pal.tint, e.pal.core);
      if (e.d0) e.d0.layout(sys.getHeight, e.fx, e.fy, 0.3, 0, ang - half, half * 2);
      if (e.pal.gloom) {
        e.d1 = sys.acquireDecal(STYLE.shadow, e.pal.gloom, e.pal.gloom);
        if (e.d1) e.d1.layout(sys.getHeight, e.fx, e.fy, L, 0, ang - half, half * 2);
      }
    },
    update(sys, e, dt) {
      if (e.flag) return false;
      const t = e.t;
      if (t >= e.dur) return false;
      const pal = e.pal;
      const L = e.k1;
      const half = e.k2;
      const r = Math.max(0.3, L * easeOut(Math.min(1, t / 0.32)));
      const a = env(t, e.dur, 0.05, 0.4);
      if (e.d0) {
        e.d0.layout(sys.getHeight, e.fx, e.fy, r, 0, e.k0 - half, half * 2);
        e.d0.u.uOpacity.value = a * 0.75;
        e.d0.u.uTime.value = t * 2;
      }
      if (e.d1) e.d1.u.uOpacity.value = a * 0.5;
      if (t < 0.48) {
        const fire = pal.el === 'fire';
        const n = sys.rate(e, 'acc0', 130, dt);
        for (let i = 0; i < n; i++) {
          const da = e.k0 + rnd(-half, half) * 0.85;
          const sp = L * 2.6 * rnd(0.55, 1.0);
          const p = sys.add.add(e.fx + Math.cos(da) * 0.4, e.k3 + rnd(0.4, 0.9), e.fy + Math.sin(da) * 0.4, Math.cos(da) * sp, rnd(0, 1), Math.sin(da) * sp,
            rnd(0.4, 0.58), rnd(0.25, 0.4), rnd(0.9, 1.3), pal.mid, fire ? 0.62 : 0.5, fire ? CELL.FLAME : i % 3 ? CELL.GLOW : CELL.STAR, fire ? -1 : 0, 1.3);
          sys.add.setEnd(p, pal.alt);
        }
        if (fire || pal.el === 'earth' || pal.el === 'sand' || pal.el === 'poison') {
          const m = sys.rate(e, 'acc1', 20, dt);
          for (let i = 0; i < m; i++) {
            const da = e.k0 + rnd(-half, half) * 0.8;
            const sp = L * 2.2 * rnd(0.4, 0.9);
            const p = sys.alpha.add(e.fx, e.k3 + 0.6, e.fy, Math.cos(da) * sp, rnd(0.3, 1), Math.sin(da) * sp, rnd(0.7, 1), 0.4, 1.4, pal.smoke, 0.35, CELL.SMOKE, -0.3, 1.6);
            sys.alpha.setSpin(p, Math.random() * TAU, rnd(-1, 1));
          }
        }
      }
      return true;
    },
  },

  wave: {
    start(sys, e) {
      const pal = e.pal;
      const R = Math.max(e.r, 0.8);
      const dist = Math.hypot(e.x - e.fx, e.y - e.fy);
      const el = pal.el;
      e.k4 = el === 'water' ? 1.15 : el === 'earth' ? 0.55 : el === 'wind' ? 0.75 : 0.9;
      if (e.hasFrom && dist > 1) {
        e.flag = true;
        e.k0 = (e.x - e.fx) / dist;
        e.k1 = (e.y - e.fy) / dist;
        e.k2 = dist;
        e.k3 = Math.max(2 * R, 1.8);
        e.dur = clamp(dist / 11, 0.35, 0.9);
        allocCrescents(sys, e, 3);
      } else {
        e.flag = false;
        e.k3 = R;
        e.dur = 0.55 + 0.06 * R;
        e.k5 = Math.random() * TAU;
        allocCrescents(sys, e, 10);
        sys.decalFx(STYLE.wideRing, e.x, e.y, 0.3, R, e.dur + 0.2, pal.glow, pal.core, 0.8, 0.04, 0.3);
      }
      if (pal.gloom) {
        e.d1 = sys.acquireDecal(STYLE.shadow, pal.gloom, pal.gloom);
        if (e.d1) {
          e.d1.u.uOpacity.value = 0;
          if (!e.flag) e.d1.layout(sys.getHeight, e.x, e.y, e.k3);
        }
      }
    },
    update(sys, e, dt) {
      const T = e.dur;
      const t = e.t;
      const pal = e.pal;
      if (t > T + 0.3) return false;
      const u = Math.min(1, t / T);
      const fade = t > T ? 1 - (t - T) / 0.3 : Math.min(1, t / 0.08);
      const H = e.k4;
      const el = pal.el;
      if (e.flag) {
        const dx = e.k0;
        const dy = e.k1;
        const W = e.k3;
        const cx = e.fx + dx * e.k2 * u;
        const cy = e.fy + dy * e.k2 * u;
        const g = sys.ground(cx, cy);
        for (let k = 0; k < e.nslots; k++) {
          const back = k * 0.42;
          const sc = 1 - k * 0.18;
          placeCrescent(sys, e, k, cx - dx * back, cy - dy * back, g - 0.05, dx, dy, 0.9 * sc, H * sc * fade, (W / 1.8) * sc, fade * (k === 0 ? 1 : 0.6));
        }
        if (e.d1) {
          e.d1.layout(sys.getHeight, cx - dx * 0.6, cy - dy * 0.6, W * 0.6);
          e.d1.u.uOpacity.value = 0.4 * fade;
        }
        if (t < T) this.spray(sys, e, cx, cy, g, -dy, dx, W, dx, dy, (e.k2 / T) * 0.6, dt);
      } else {
        const Rr = 0.3 + (e.k3 - 0.3) * easeOut(u);
        const g = e.gz;
        const n = e.nslots;
        for (let k = 0; k < n; k++) {
          const a = e.k5 + (k / n) * TAU;
          const c = Math.cos(a);
          const s = Math.sin(a);
          placeCrescent(sys, e, k, e.x + c * Rr, e.y + s * Rr, g - 0.05, c, s, 0.7, H * fade * (0.6 + 0.4 * u), (Rr * 1.0) / 1.8 + 0.12, fade);
        }
        if (e.d1) e.d1.u.uOpacity.value = 0.4 * fade;
        if (t < T) {
          const m = sys.rate(e, 'acc2', 10 * e.k3, dt);
          for (let i = 0; i < m; i++) {
            const a = Math.random() * TAU;
            const c = Math.cos(a);
            const s = Math.sin(a);
            this.particle(sys, pal, el, e.x + c * Rr, g, e.y + s * Rr, c * 2, s * 2);
          }
        }
      }
      return true;
    },
    spray(sys, e, cx, cy, g, px, py, W, dx, dy, fwd, dt) {
      const pal = e.pal;
      const n = sys.rate(e, 'acc0', 45 * W, dt);
      for (let i = 0; i < n; i++) {
        const side = rnd(-0.5, 0.5) * W * 0.9;
        this.particle(sys, pal, pal.el, cx + px * side, g, cy + py * side, dx * fwd, dy * fwd);
      }
    },
    particle(sys, pal, el, x, g, y, vx, vy) {
      if (el === 'water') {
        const p = sys.alpha.add(x, g + rnd(0.3, 0.9), y, vx + rnd(-0.4, 0.4), rnd(1.2, 3), vy + rnd(-0.4, 0.4), rnd(0.35, 0.55), rnd(0.25, 0.35), 0.55, pal.core, 0.7, CELL.SMOKE, 7, 0.5);
        sys.alpha.setSpin(p, Math.random() * TAU, 2);
        sys.add.add(x, g + rnd(0.2, 0.8), y, vx, rnd(0.5, 2), vy, rnd(0.2, 0.35), 0.35, 0.08, pal.glow, 0.7, CELL.GLOW, 4);
      } else if (el === 'earth' || el === 'sand') {
        const p = sys.alpha.add(x, g + 0.2, y, vx * 0.5 + rnd(-0.5, 0.5), rnd(0.5, 1.5), vy * 0.5 + rnd(-0.5, 0.5), rnd(0.6, 0.9), 0.45, 1.1, pal.smoke, 0.5, CELL.SMOKE, 0, 1.5);
        sys.alpha.setSpin(p, Math.random() * TAU, 1);
        if (Math.random() < 0.4) {
          const q = sys.alpha.add(x, g + 0.3, y, vx * 0.6, rnd(2, 4), vy * 0.6, rnd(0.5, 0.8), rnd(0.12, 0.22), 0.1, COLORS.debris, 1, CELL.SHARD, 12);
          sys.alpha.setSpin(q, Math.random() * TAU, rnd(-8, 8));
          sys.alpha.setFloor(q, g + 0.05);
        }
      } else if (el === 'fire') {
        const p = sys.add.add(x, g + rnd(0.2, 0.7), y, vx * 0.7, rnd(0.8, 2), vy * 0.7, rnd(0.3, 0.5), rnd(0.45, 0.7), 0.2, pal.mid, 0.65, CELL.FLAME, -1);
        sys.add.setEnd(p, pal.alt);
      } else if (el === 'wind') {
        sys.add.add(x, g + rnd(0.2, 1.0), y, vx * 1.3, rnd(-0.2, 0.6), vy * 1.3, rnd(0.25, 0.4), rnd(0.3, 0.45), 0.08, pal.glow, 0.6, CELL.GLOW);
        if (Math.random() < 0.3) {
          const p = sys.alpha.add(x, g + 0.3, y, vx, rnd(0.2, 0.6), vy, 0.6, 0.4, 1, pal.smoke, 0.3, CELL.SMOKE, 0, 1.5);
          sys.alpha.setSpin(p, Math.random() * TAU, 2);
        }
      } else {
        const p = sys.add.add(x, g + rnd(0.2, 0.9), y, vx * 0.8, rnd(0.3, 1.5), vy * 0.8, rnd(0.3, 0.5), rnd(0.35, 0.5), 0.08, pal.glow, 0.75, Math.random() < 0.3 ? CELL.STAR : CELL.GLOW, 1);
        sys.add.setEnd(p, pal.alt);
        if (pal.gloom && Math.random() < 0.3) sys.alpha.add(x, g + 0.4, y, vx * 0.5, rnd(0.3, 0.8), vy * 0.5, 0.6, 0.4, 0.9, pal.gloom, 0.35, CELL.SMOKE, 0, 1.5);
      }
    },
  },

  field: {
    start(sys, e) {
      const pal = e.pal;
      const R = Math.max(e.r, 1);
      e.k0 = R;
      e.dur = Math.max(e.dur, 1);
      e.d0 = sys.acquireDecal(RUNE_ELEMENTS.has(pal.el) ? STYLE.fieldRunes : STYLE.field, pal.tint, pal.core);
      if (e.d0) {
        e.d0.layout(sys.getHeight, e.x, e.y, R);
        e.d0.u.uOpacity.value = 0;
        e.d0.u.uSpin.value = Math.random() * TAU;
      }
      if (pal.gloom || pal.el === 'fire') {
        const c = pal.gloom || pal.dark;
        e.d1 = sys.acquireDecal(STYLE.shadow, c, c);
        if (e.d1) {
          e.d1.layout(sys.getHeight, e.x, e.y, R * 1.03);
          e.d1.u.uOpacity.value = 0;
        }
      }
      e.timer = 0;
      sys.decalFx(STYLE.ring, e.x, e.y, 0.3, R, 0.45, pal.glow, pal.core, 0.9, 0.03, 0.3);
      // burning ground flickers a warm light (dim: flashes take precedence for the lights)
      if (pal.el === 'fire') e.light = sys.holdLight(e.x, e.gz + 1.2, e.y, pal.mid, 1.6 + 0.8 * R, 2.5 + 1.6 * R, 0.4, 0.22);
    },
    update(sys, e, dt) {
      const t = e.t;
      const D = e.dur;
      if (t >= D) return false;
      const pal = e.pal;
      const R = e.k0;
      const a = env(t, D, 0.35, 0.6);
      if (e.light >= 0 && t > D - 0.6) {
        sys.lights.release(e.light, D - t);
        e.light = -1;
      }
      if (e.d0) {
        e.d0.u.uOpacity.value = a * 0.85;
        e.d0.u.uTime.value = t;
        e.d0.u.uSpin.value += 0.3 * dt;
      }
      if (e.d1) {
        e.d1.u.uOpacity.value = a * (pal.gloom ? 0.55 : 0.35);
        e.d1.u.uTime.value = t;
      }
      const { x, y, gz } = e;
      const el = pal.el;
      const n = sys.rate(e, 'acc0', Math.min(75, 9 + 5 * R * R) * (0.3 + 0.7 * a) * (el === 'fire' ? 1.7 : 1), dt);
      for (let i = 0; i < n; i++) {
        const pt = randDisc(x, y, R * 0.95);
        const px = pt[0];
        const py = pt[1];
        const g = R > 2.5 ? sys.ground(px, py) : gz;
        if (el === 'fire') {
          const p = sys.add.add(px, g + 0.1, py, rnd(-0.1, 0.1), rnd(0.8, 1.6), rnd(-0.1, 0.1), rnd(0.5, 0.85), rnd(0.6, 0.95), 0.18, pal.mid, 0.62, CELL.FLAME, -0.5);
          sys.add.setEnd(p, pal.alt);
          if (Math.random() < 0.25) sys.add.add(px, g + 0.2, py, rnd(-0.3, 0.3), rnd(1.5, 2.5), rnd(-0.3, 0.3), rnd(0.7, 1.1), 0.12, 0.03, COLORS.ember, 1, CELL.SPARK, -0.3);
        } else if (el === 'water') {
          if (Math.random() < 0.5) {
            const p = sys.add.add(px, g + 0.08, py, 0, 0, 0, rnd(0.6, 0.9), 0.25, 1.1, pal.glow, 0.6, CELL.RING);
            sys.add.setFadeIn(p, 0.05);
          } else {
            sys.add.add(px, g + 0.1, py, 0, rnd(0.4, 0.9), 0, rnd(0.6, 1), 0.18, 0.1, pal.core, 0.8, CELL.SPARK);
          }
        } else if (el === 'poison' || el === 'death' || el === 'shadow' || el === 'chaos') {
          if (Math.random() < 0.45) {
            const toxic = el === 'poison';
            const p = sys.alpha.add(px, g + 0.15, py, rnd(-0.1, 0.1), rnd(0.3, 0.7), rnd(-0.1, 0.1), rnd(1, 1.6), 0.45, 1.2, toxic ? pal.glow : pal.gloom || pal.smoke, toxic ? 0.28 : 0.45, CELL.SMOKE, -0.1, 0.5);
            sys.alpha.setSpin(p, Math.random() * TAU, rnd(-0.8, 0.8));
            sys.alpha.setFadeIn(p, 0.3);
          } else if (el === 'poison' && Math.random() < 0.5) {
            sys.add.add(px, g + 0.1, py, 0, rnd(0.3, 0.6), 0, rnd(0.5, 0.8), 0.15, 0.32, pal.glow, 0.8, CELL.RING);
          } else {
            const p = sys.add.add(px, g + 0.1, py, rnd(-0.1, 0.1), rnd(0.5, 1.2), rnd(-0.1, 0.1), rnd(0.8, 1.3), rnd(0.25, 0.4), 0.06, pal.glow, 0.85, CELL.GLOW, -0.2);
            sys.add.setEnd(p, pal.alt);
          }
        } else if (el === 'ice') {
          if (Math.random() < 0.4) {
            const p = sys.alpha.add(px, g + 0.15, py, rnd(-0.2, 0.2), rnd(0.05, 0.25), rnd(-0.2, 0.2), rnd(1.2, 1.8), 0.6, 1.4, pal.smoke, 0.3, CELL.SMOKE);
            sys.alpha.setSpin(p, Math.random() * TAU, 0.4);
            sys.alpha.setFadeIn(p, 0.3);
          } else {
            sys.add.add(px, g + rnd(0.1, 0.8), py, 0, rnd(-0.2, 0.3), 0, rnd(0.5, 0.9), 0.24, 0.04, pal.core, 1, CELL.STAR);
          }
        } else if (el === 'nature') {
          if (Math.random() < 0.4) {
            const p = sys.alpha.add(px, g + 0.1, py, rnd(-0.3, 0.3), rnd(0.4, 0.9), rnd(-0.3, 0.3), rnd(0.9, 1.4), rnd(0.12, 0.18), 0.1, Math.random() < 0.5 ? pal.glow : pal.alt, 0.95, CELL.SHARD, -0.1, 0.3);
            sys.alpha.setSpin(p, Math.random() * TAU, rnd(-3, 3));
          } else {
            sys.add.add(px, g + 0.1, py, 0, rnd(0.5, 1), 0, rnd(0.8, 1.2), 0.22, 0.05, pal.glow, 0.9, CELL.STAR);
          }
        } else if (el === 'earth' || el === 'sand') {
          const p = sys.alpha.add(px, g + 0.1, py, rnd(-0.3, 0.3), rnd(0.2, 0.5), rnd(-0.3, 0.3), rnd(0.9, 1.3), 0.4, 1.1, pal.smoke, 0.4, CELL.SMOKE, 0, 0.5);
          sys.alpha.setSpin(p, Math.random() * TAU, 0.6);
        } else if (el === 'wind') {
          const dx = px - x;
          const dy = py - y;
          sys.add.add(px, g + rnd(0.2, 1.2), py, -dy * 2.2, rnd(0.2, 0.8), dx * 2.2, rnd(0.35, 0.6), rnd(0.25, 0.4), 0.06, pal.glow, 0.7, CELL.GLOW, 0, 0.5);
        } else {
          const p = sys.add.add(px, g + 0.1, py, rnd(-0.1, 0.1), rnd(0.6, 1.4), rnd(-0.1, 0.1), rnd(0.8, 1.3), rnd(0.2, 0.32), 0.05, pal.glow, 0.95, Math.random() < 0.4 ? CELL.STAR : CELL.GLOW, -0.2);
          sys.add.setEnd(p, pal.core);
        }
      }
      if (el === 'lightning' || el === 'chaos' || el === 'arcane') {
        e.timer -= dt;
        if (e.timer <= 0 && a > 0.3) {
          e.timer = rnd(0.12, 0.26) * (R > 2 ? 0.7 : 1);
          const p0 = randDisc(x, y, R * 0.85);
          const ax = p0[0];
          const ay = p0[1];
          const ang = Math.random() * TAU;
          const l = rnd(0.8, 1.8);
          const bx = ax + Math.cos(ang) * l;
          const by = ay + Math.sin(ang) * l;
          sys.boltFx(ax, sys.ground(ax, ay) + 0.12, ay, bx, sys.ground(bx, by) + 0.12, by, 0.14, 0.16, pal.glow, pal.core, 0.2, 0);
        }
      }
      return true;
    },
  },

  buff: {
    start(sys, e) {
      const pal = e.pal;
      const R = e.r;
      e.flag = R >= 1.4;
      e.dur = 1.15;
      const ring = sys.decalFx(STYLE.ring, e.x, e.y, e.flag ? R * 0.4 : 0.3, e.flag ? R : 0.95, 0.75, pal.glow, pal.core, 0.9, 0.05, 0.4);
      if (ring) ring.follow = e.follow;
      const disc = sys.decalFx(STYLE.glowDisc, e.x, e.y, e.flag ? R : 0.9, e.flag ? R : 0.9, 1.0, pal.glow, pal.core, 0.5, 0.15, 0.5);
      if (disc) disc.follow = e.follow;
      e.g0 = sys.glows.alloc();
      if (e.flag) sys.flareFx(e.x, e.gz + 0.8, e.y, 1.2, 2.6, 0.4, pal.glow, pal.core, 0.7, 0.6);
    },
    update(sys, e, dt) {
      const t = e.t;
      if (t >= e.dur) return false;
      const pal = e.pal;
      const area = e.flag;
      const strands = area ? 3 : 2;
      const rad = area ? 0.9 : 0.55;
      const H = area ? 2.4 : 2.0;
      const n = sys.rate(e, 'acc0', 60 * strands, dt);
      for (let i = 0; i < n; i++) {
        const k = i % strands;
        const tt = t - Math.random() * dt;
        const a = tt * 10 + (k * TAU) / strands;
        const h = (tt / e.dur) * H;
        const p = sys.add.add(e.x + Math.cos(a) * rad, e.gz + 0.12 + h, e.y + Math.sin(a) * rad, 0, rnd(0.2, 0.5), 0, rnd(0.4, 0.6), rnd(0.28, 0.38), 0.06, pal.mid, 1, i % 3 ? CELL.STAR : CELL.GLOW);
        sys.add.setEnd(p, pal.glow);
      }
      if (area) {
        const m = sys.rate(e, 'acc1', Math.min(60, 14 * e.r), dt);
        for (let i = 0; i < m; i++) {
          const pt = randDisc(e.x, e.y, e.r);
          const p = sys.add.add(pt[0], e.gz + rnd(0.1, 0.4), pt[1], 0, rnd(1.2, 2.4), 0, rnd(0.5, 0.8), 0.32, 0.06, pal.glow, 0.9, CELL.STAR);
          sys.add.setEnd(p, pal.alt);
        }
      }
      // a buff lasts for seconds: its glow is barely hot, so it does not bloom all that time
      sys.glows.set(e.g0, e.x, e.gz + 0.4, e.y, (1.4 + 0.2 * Math.sin(t * 12)) * env(t, e.dur, 0.1, 0.4) * (area ? 1.6 : 1), pal.glow, 0.6, 0, 0, 0.15);
      return true;
    },
  },

  summon: {
    start(sys, e) {
      summonStart(sys, e, e.r > 0 ? 1 + 0.3 * e.r : e.scale);
    },
    update: summonUpdate,
  },

  blink: {
    start(sys, e) {
      const pal = e.pal;
      const dist = Math.hypot(e.x - e.fx, e.y - e.fy);
      if (e.hasFrom && dist > 0.2) {
        const ox = e.fx;
        const oy = e.fy;
        const og = sys.ground(ox, oy);
        const n = sys.n(20);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const b = rnd(-0.6, 1.2);
          const r = 1.1;
          const life = rnd(0.25, 0.32);
          const dx = Math.cos(a) * Math.cos(b) * r;
          const dy = Math.sin(b) * r;
          const dz = Math.sin(a) * Math.cos(b) * r;
          const p = sys.add.add(ox + dx, og + 0.8 + dy, oy + dz, -dx / life, -dy / life, -dz / life, life, 0.3, 0.08, pal.glow, 0.95, i % 2 ? CELL.GLOW : CELL.STAR);
          sys.add.setEnd(p, pal.core);
          sys.add.setFadeIn(p, 0.25);
        }
        sys.flareFx(ox, og + 0.8, oy, 1.6, 0.4, 0.32, pal.glow, pal.core, 1, 0.5, 0.2);
        sys.burst(sys.alpha, ox, og + 0.4, oy, 6, 0.3, 0.9, 0.2, 0.6, 0.6, 0.9, 0.5, 1.1, pal.smoke, null, 0.4, CELL.SMOKE, -0.2, 1.5);
        sys.decalFx(STYLE.ring, ox, oy, 0.9, 0.2, 0.4, pal.glow, pal.core, 0.8, 0.03, 0.25);
        sys.boltFx(ox, og + 0.9, oy, e.x, e.gz + 0.9, e.y, 0.22, 0.22, pal.alt, pal.glow, 0.05, 0);
      }
      const { x, y, gz } = e;
      sys.flareFx(x, gz + 0.8, y, 1.0, 2.6, 0.38, pal.glow, pal.core, 1, 0.6, 0.06);
      sys.decalFx(STYLE.ring, x, y, 0.2, Math.max(1.3, e.r), 0.45, pal.glow, pal.core, 1, 0.02, 0.3);
      sys.burst(sys.add, x, gz + 0.7, y, 24, 1.5, 3.5, -0.5, 2.5, 0.35, 0.6, 0.28, 0.05, pal.core, pal.glow, 1, CELL.STAR, 1, 2.5);
      const m = sys.n(10);
      for (let i = 0; i < m; i++) {
        const pt = randDisc(x, y, 0.8);
        sys.add.add(pt[0], gz + rnd(0.2, 1.6), pt[1], 0, rnd(0.1, 0.4), 0, rnd(0.6, 1.0), 0.22, 0.05, pal.glow, 0.9, CELL.STAR);
      }
      sys.burst(sys.alpha, x, gz + 0.3, y, 6, 0.6, 1.4, 0.1, 0.5, 0.6, 0.9, 0.45, 1.1, pal.smoke, null, 0.4, CELL.SMOKE, 0, 2);
    },
    update() {
      return false;
    },
  },

  projectile: {
    ownDelay: true,
    start(sys, e) {
      const pal = e.pal;
      const dist = Math.hypot(e.x - e.fx, e.y - e.fy);
      let ax;
      let ah;
      let ay;
      if (e.hasFrom && dist > 0.3) {
        ax = e.fx; ah = sys.ground(e.fx, e.fy) + 1.4; ay = e.fy;
        sys.flareFx(ax, ah, ay, 0.6, 1.4, 0.25, pal.glow, pal.core, 0.9);
      } else {
        ax = e.x - 2; ah = e.gz + 9; ay = e.y - 4;
      }
      const d = Math.hypot(e.x - ax, e.y - ay);
      const flight = e.k5 > 0 ? e.k5 : clamp(d / 12, 0.25, 1.4);
      sys.launch('orb', pal, ax, ah, ay, e.x, 0.5, e.y, flight, 1.7, Math.max(e.r, 0.8));
    },
    update() {
      return false;
    },
  },

  meteor: {
    ownDelay: true,
    start(sys, e) {
      const pal = e.pal;
      const R = Math.max(e.r, 1.2);
      e.k0 = R;
      e.dur = e.k5 > 0 ? clamp(e.k5, 0.35, 2.5) : 0.65;
      const P = e.pts;
      P[0] = e.x - 3.5 - 0.5 * R;
      P[1] = e.gz + 17;
      P[2] = e.y - 5.5;
      e.rock = sys.batches.rock.alloc();
      e.g0 = sys.glows.alloc();
      e.f0 = sys.flares.acquire();
      if (e.f0) {
        e.f0.u.uColor.value.set(pal.glow.r, pal.glow.g, pal.glow.b);
        e.f0.u.uCore.value.set(pal.core.r, pal.core.g, pal.core.b);
        e.f0.u.uRays.value = 0;
        e.f0.u.uOpacity.value = 0.9;
        e.f0.u.uSize.value = 2 + 0.4 * R;
        e.f0.u.uHot.value = 3;
      }
      // the falling rock lights the ground more and more as it comes down
      e.light = sys.holdLight(P[0], P[1], P[2], pal.mid, 9 + 2.5 * R, 7 + 2 * R, Math.max(0.1, e.dur * 0.8), 0.12);
      e.d0 = sys.acquireDecal(STYLE.tele, pal.glow, pal.core);
      if (e.d0) e.d0.layout(sys.getHeight, e.x, e.y, R * 1.05);
      e.k1 = rnd(-1, 1);
      e.k2 = rnd(-1, 1);
      e.stage = 0;
    },
    update(sys, e, dt) {
      const t = e.t;
      const T = e.dur;
      if (e.stage === 1) return t < T + 0.05;
      const pal = e.pal;
      const R = e.k0;
      const P = e.pts;
      const u = Math.min(1, t / T);
      const uu = u * 0.65 + u * u * 0.35;
      const x = P[0] + (e.x - P[0]) * uu;
      const h = P[1] + (e.gz + 0.3 - P[1]) * uu;
      const z = P[2] + (e.y - P[2]) * uu;
      if (e.rock >= 0) {
        _d.set(e.k1, 1, e.k2).normalize();
        _q.setFromAxisAngle(_d, t * 6);
        _p.set(x, h, z);
        const sc = 1.6 + 0.35 * R;
        _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s);
        sys.batches.rock.setMatrix(e.rock, _m);
      }
      sys.glows.set(e.g0, x, h, z, 1.6 + 0.3 * R, pal.core, 1, 0, 0, 2);
      if (e.light >= 0) sys.moveLight(e.light, x, h, z);
      if (e.f0) {
        e.f0.mesh.position.set(x, h, z);
        e.f0.u.uSize.value = (2 + 0.45 * R) * (0.92 + 0.08 * Math.sin(t * 40));
      }
      if (e.d0) {
        e.d0.u.uOpacity.value = (0.3 + 0.6 * u) * (0.8 + 0.2 * Math.sin(t * 20));
        e.d0.u.uRing.value.set(0.9 - 0.3 * (1 - u), 0.05, 1);
      }
      const n = sys.rate(e, 'acc0', 150, dt);
      for (let i = 0; i < n; i++) {
        const k = Math.random();
        const p = sys.add.add(x + rnd(-0.2, 0.2), h + rnd(-0.2, 0.2) + k * 0.4, z + rnd(-0.2, 0.2), rnd(-0.4, 0.4), rnd(0.2, 1), rnd(-0.4, 0.4), rnd(0.3, 0.5), rnd(0.9, 1.4) * (0.6 + 0.15 * R), 0.25, pal.mid, 0.7, CELL.FLAME, -0.5);
        sys.add.setEnd(p, pal.alt);
      }
      const m = sys.rate(e, 'acc1', 32, dt);
      for (let i = 0; i < m; i++) {
        const p = sys.alpha.add(x, h + 0.2, z, rnd(-0.3, 0.3), rnd(0.2, 0.6), rnd(-0.3, 0.3), rnd(0.8, 1.2), 0.6, 1.8, pal.smoke, 0.4, CELL.SMOKE);
        sys.alpha.setSpin(p, Math.random() * TAU, rnd(-1, 1));
      }
      const s = sys.rate(e, 'acc2', 30, dt);
      for (let i = 0; i < s; i++) sys.add.add(x, h, z, rnd(-1.5, 1.5), rnd(-0.5, 1.5), rnd(-1.5, 1.5), rnd(0.4, 0.7), 0.14, 0.03, COLORS.ember, 1, CELL.SPARK, 4);
      if (u >= 1) {
        e.stage = 1;
        if (e.light >= 0) {
          sys.lights.release(e.light, 0.1);
          e.light = -1;
        }
        if (e.rock >= 0) {
          sys.batches.rock.free(e.rock);
          e.rock = -1;
        }
        if (e.g0 >= 0) {
          sys.glows.free(e.g0);
          e.g0 = -1;
        }
        if (e.f0) {
          sys.flares.release(e.f0);
          e.f0 = null;
        }
        if (e.d0) {
          sys.decals.release(e.d0);
          e.d0 = null;
        }
        explode(sys, pal, e.x, e.y, e.gz, R);
      }
      return true;
    },
  },

  heal: {
    start(sys, e) {
      const pal = e.pal;
      const R = Math.max(e.r, 0.75);
      e.k0 = R;
      e.flag = R >= 1.4;
      e.dur = 1.3;
      e.c = pal.el === 'nature' || pal.el === 'poison' ? COLORS.healGold : COLORS.heal;
      e.d0 = sys.acquireDecal(STYLE.healDisc, pal.glow, pal.core);
      if (e.d0) {
        e.d0.layout(sys.getHeight, e.x, e.y, R);
        e.k2 = e.x;
        e.k3 = e.y;
      }
      sys.pillarFx(e.x, e.y, e.flag ? R * 0.75 : 0.7, e.flag ? 3 : 2.4, 1.1, pal.glow, pal.core, 0.42, 0.15, 0.5);
      if (e.flag) sys.decalFx(STYLE.ring, e.x, e.y, R * 0.3, R, 0.6, pal.glow, pal.core, 0.9, 0.03, 0.35);
    },
    update(sys, e, dt) {
      const t = e.t;
      if (t >= e.dur) return false;
      const pal = e.pal;
      const R = e.k0;
      if (e.d0) {
        if (e.x !== e.k2 || e.y !== e.k3) {
          e.d0.layout(sys.getHeight, e.x, e.y, R);
          e.k2 = e.x;
          e.k3 = e.y;
        }
        e.d0.u.uOpacity.value = env(t, e.dur, 0.15, 0.55) * 0.85;
        e.d0.u.uTime.value = t;
      }
      if (t < e.dur - 0.35) {
        const n = sys.rate(e, 'acc0', e.flag ? Math.min(55, 9 * R * R) : 20, dt);
        for (let i = 0; i < n; i++) {
          const pt = randDisc(e.x, e.y, R * 0.85);
          const p = sys.add.add(pt[0], e.gz + rnd(0.1, 0.6), pt[1], 0, rnd(0.8, 1.4), 0, rnd(0.75, 1.05), rnd(0.32, 0.44), 0.2, i % 2 ? pal.glow : e.c, 1, CELL.PLUS);
          sys.add.setFadeIn(p, 0.2);
        }
        const m = sys.rate(e, 'acc1', e.flag ? Math.min(60, 12 * R) : 26, dt);
        for (let i = 0; i < m; i++) {
          const pt = randDisc(e.x, e.y, R * 0.9);
          sys.add.add(pt[0], e.gz + rnd(0.1, 0.5), pt[1], 0, rnd(1.4, 2.6), 0, rnd(0.45, 0.65), 0.2, 0.04, i % 2 ? e.c : pal.core, 1, CELL.STAR);
        }
      }
      return true;
    },
  },

  chain: {
    start(sys, e) {
      const pal = e.pal;
      const P = e.pts;
      if (e.npts === 0) {
        P[0] = e.x;
        P[1] = e.y;
        e.npts = 1;
      }
      e.flag = false;
      if (e.hasFrom && e.npts < P.length / 3 && Math.hypot(P[0] - e.fx, P[1] - e.fy) > 0.3) {
        for (let i = e.npts; i > 0; i--) {
          P[i * 3] = P[i * 3 - 3];
          P[i * 3 + 1] = P[i * 3 - 2];
        }
        P[0] = e.fx;
        P[1] = e.fy;
        e.npts++;
        e.flag = true; // first point is the caster
      }
      for (let i = 0; i < e.npts; i++) P[i * 3 + 2] = sys.ground(P[i * 3], P[i * 3 + 1]) + (e.flag && i === 0 ? 1.3 : 0.9);
      const hop = 0.075;
      const jag = pal.jagged ? 0.17 : 0.1;
      for (let i = 0; i < e.npts - 1; i++) {
        sys.boltFx(P[i * 3], P[i * 3 + 2], P[i * 3 + 1], P[i * 3 + 3], P[i * 3 + 5], P[i * 3 + 4], 0.42, 0.34, pal.glow, pal.core, jag, i === 0 ? 1 : 0, i * hop);
      }
      if (e.npts === 1) {
        sys.boltFx(P[0], P[2] + 8, P[1] - 1.2, P[0], P[2] - 0.8, P[1], 0.35, 0.36, pal.glow, pal.core, 0.1, 1);
      }
      e.k0 = hop;
      e.dur = hop * e.npts + 0.45;
      e.stage = 0;
    },
    update(sys, e) {
      const pal = e.pal;
      const P = e.pts;
      while (e.stage < e.npts && e.t >= Math.max(0, e.stage - 1) * e.k0) {
        const i = e.stage++;
        const x = P[i * 3];
        const y = P[i * 3 + 1];
        const h = P[i * 3 + 2];
        if (e.flag && i === 0) {
          sys.flareFx(x, h, y, 0.5, 1.3, 0.25, pal.glow, pal.core, 0.9);
          continue;
        }
        sys.flareFx(x, h, y, 0.7, 1.8, 0.3, pal.glow, pal.core, 1, 0.3, 0.04);
        sys.burst(sys.add, x, h, y, 10, 1.5, 4, -0.5, 3, 0.2, 0.4, 0.18, 0.03, pal.core, pal.glow, 1, CELL.SPARK, 7, 1);
        sys.decalFx(STYLE.ring, x, y, 0.1, 0.9, 0.35, pal.glow, pal.core, 0.8, 0.02, 0.25);
      }
      return e.t < e.dur;
    },
  },

  quake: {
    start(sys, e) {
      const pal = e.pal;
      const R = Math.max(e.r, 1.5);
      const { x, y, gz } = e;
      e.k0 = R;
      const crack = pal.dark || COLORS.debris;
      sys.decalFx(STYLE.crack, x, y, R, R, 2.8, crack, crack, 0.85, 0.05, 1.2);
      sys.decalFx(STYLE.wideRing, x, y, 0.4, R * 1.1, 0.7, pal.glow, pal.core, 0.85, 0.03, 0.4);
      sys.decalFx(STYLE.ring, x, y, 0.3, R, 0.5, pal.core, pal.core, 0.6, 0.02, 0.3);
      this.dust(sys, e, x, y, gz, R, 1);
      const d = sys.n(14 + 5 * R);
      for (let i = 0; i < d; i++) {
        const pt = randDisc(x, y, R);
        const g = sys.ground(pt[0], pt[1]);
        const p = sys.alpha.add(pt[0], g + 0.1, pt[1], rnd(-0.6, 0.6), rnd(3, 6.5), rnd(-0.6, 0.6), rnd(1.0, 1.4), rnd(0.15, 0.35), 0.15, COLORS.debris, 1, CELL.SHARD, 15, 0.2);
        sys.alpha.setSpin(p, Math.random() * TAU, rnd(-9, 9));
        sys.alpha.setFloor(p, g + 0.05);
      }
      const earth = getPalette('earth');
      const rocks = Math.min(6, 2 + Math.floor(R / 1.5));
      for (let i = 0; i < rocks; i++) {
        const a = Math.random() * TAU;
        const r0 = rnd(0, R * 0.4);
        const r1 = rnd(R * 0.6, R * 1.1);
        const sx = x + Math.cos(a) * r0;
        const sy = y + Math.sin(a) * r0;
        sys.launch('rock', earth, sx, sys.ground(sx, sy) + 0.2, sy, x + Math.cos(a) * r1, 0.1, y + Math.sin(a) * r1, rnd(0.45, 0.75), rnd(0.6, 1.0), 0);
      }
      sys.addShake(Math.min(0.75, 0.22 + 0.08 * R), x, y);
      e.dur = 0.6;
      e.stage = R >= 2.5 ? 0 : 1;
    },
    dust(sys, e, x, y, gz, R, k) {
      const pal = e.pal;
      const n = sys.n((22 + 8 * R) * k);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rnd(-0.15, 0.15);
        const c = Math.cos(a);
        const s = Math.sin(a);
        const sp = R * 2.4 * rnd(0.7, 1.05);
        const px = x + c * R * 0.25;
        const py = y + s * R * 0.25;
        const p = sys.alpha.add(px, sys.ground(px, py) + 0.2, py, c * sp, rnd(0.3, 1), s * sp, rnd(0.9, 1.4), rnd(0.55, 0.8), rnd(1.4, 1.9), pal.smoke, 0.5, CELL.SMOKE, -0.1, 2.5);
        sys.alpha.setSpin(p, Math.random() * TAU, rnd(-1, 1));
        sys.alpha.setFadeIn(p, 0.1);
      }
    },
    update(sys, e) {
      if (e.stage === 0 && e.t >= 0.4) {
        e.stage = 1;
        const R = e.k0 * 0.75;
        sys.decalFx(STYLE.wideRing, e.x, e.y, 0.3, R, 0.55, e.pal.glow, e.pal.core, 0.6, 0.03, 0.35);
        this.dust(sys, e, e.x, e.y, e.gz, R, 0.6);
        sys.addShake(0.2, e.x, e.y);
      }
      return e.t < e.dur;
    },
  },

  storm: {
    ownDelay: true,
    start(sys, e) {
      const pal = e.pal;
      const R = Math.max(e.r, 1.5);
      e.k0 = R;
      e.dur = Math.max(e.dur, 1.5);
      e.k1 = e.gz + 4.4 + 0.25 * R;
      e.d0 = sys.acquireDecal(STYLE.cloud, pal.dark || COLORS.cloud, COLORS.cloudLit);
      if (e.d0) {
        e.d0.layout(sys.getHeight, e.x, e.y, R * 1.12, 0, 0, TAU, 0, e.k1);
        e.d0.u.uOpacity.value = 0;
      }
      e.d1 = sys.acquireDecal(STYLE.cloudGlow, pal.glow, pal.core);
      if (e.d1) {
        e.d1.layout(sys.getHeight, e.x, e.y, R * 1.0, 0, 0, TAU, 0, e.k1 + 0.06);
        e.d1.u.uOpacity.value = 0;
      }
      e.d2 = sys.acquireDecal(STYLE.shadow, COLORS.cloud, COLORS.cloud);
      if (e.d2) {
        e.d2.layout(sys.getHeight, e.x, e.y, R * 1.1);
        e.d2.u.uOpacity.value = 0;
      }
      e.timer = e.k5 > 0 ? e.k5 : 0.25;
      e.k2 = 0;
    },
    update(sys, e, dt) {
      const t = e.t;
      const D = e.dur;
      const life = D + 0.6;
      if (t >= life) return false;
      const pal = e.pal;
      const R = e.k0;
      const a = env(t, life, 0.4, 0.8);
      e.k2 *= Math.exp(-9 * dt);
      if (e.d0) {
        e.d0.u.uOpacity.value = a * 0.78;
        e.d0.u.uTime.value = t * 0.6;
        e.d0.u.uSpin.value += 0.2 * dt;
      }
      if (e.d1) {
        e.d1.u.uOpacity.value = a * (0.1 + 0.9 * e.k2);
        e.d1.u.uTime.value = t * 0.6;
      }
      if (e.d2) e.d2.u.uOpacity.value = a * 0.32;
      // billowing puffs give the flat cloud body some volume from the side
      const puffs = sys.rate(e, 'acc1', (t < D ? 5 + 3 * R : 0), dt);
      const cloudC = pal.dark || COLORS.cloud;
      for (let i = 0; i < puffs; i++) {
        const ang = Math.random() * TAU;
        const rr = R * Math.sqrt(Math.random()) * 0.95;
        const p = sys.alpha.add(e.x + Math.cos(ang) * rr, e.k1 + rnd(-0.1, 0.35), e.y + Math.sin(ang) * rr, Math.cos(ang) * 0.25, rnd(0.02, 0.15), Math.sin(ang) * 0.25,
          rnd(1.4, 2.1), rnd(1.0, 1.5) + 0.2 * R, rnd(1.6, 2.2) + 0.25 * R, Math.random() < 0.35 ? COLORS.cloudLit : cloudC, 0.5, CELL.SMOKE, 0, 0.3);
        sys.alpha.setSpin(p, Math.random() * TAU, rnd(-0.3, 0.3));
        sys.alpha.setFadeIn(p, 0.35);
      }
      if (t < D) {
        e.timer -= dt;
        if (e.timer <= 0) {
          e.timer = rnd(0.2, 0.42) * (R < 2.5 ? 1.15 : 0.85);
          const pt = randDisc(e.x, e.y, R * 0.9);
          miniStrike(sys, e, pt[0], pt[1], e.k1);
        }
      }
      // weather inside the storm
      const el = pal.el;
      const { x, y, gz } = e;
      const area = Math.min(90, 10 * R * R) * a;
      if (el === 'water' || el === 'lightning' || el === 'ice') {
        const n = sys.rate(e, 'acc0', area, dt);
        for (let i = 0; i < n; i++) {
          const pt = randDisc(x, y, R);
          const h = rnd(1, e.k1 - gz);
          const p = sys.add.add(pt[0], gz + h, pt[1], 0.6, el === 'ice' ? -6 : -11, 0.9, h / (el === 'ice' ? 6 : 11), el === 'ice' ? 0.16 : 0.1, 0.1, el === 'ice' ? pal.core : COLORS.soul, 0.55, CELL.SPARK);
          sys.add.setFadeIn(p, 0.05);
        }
      } else if (el === 'wind' || el === 'sand') {
        const n = sys.rate(e, 'acc0', area * 0.8, dt);
        for (let i = 0; i < n; i++) {
          const pt = randDisc(x, y, R);
          const dx = pt[0] - x;
          const dy = pt[1] - y;
          const g = sys.ground(pt[0], pt[1]);
          if (Math.random() < 0.55) {
            const p = sys.alpha.add(pt[0], g + rnd(0.2, 2), pt[1], -dy * 1.8 - dx * 0.2, rnd(0.2, 1), dx * 1.8 - dy * 0.2, rnd(0.6, 1), 0.5, 1.3, pal.smoke, el === 'sand' ? 0.5 : 0.3, CELL.SMOKE, 0, 0.3);
            sys.alpha.setSpin(p, Math.random() * TAU, 2);
          } else {
            sys.add.add(pt[0], g + rnd(0.3, 2.5), pt[1], -dy * 2.4, rnd(0.2, 1.2), dx * 2.4, rnd(0.3, 0.5), 0.3, 0.06, pal.glow, 0.65, CELL.GLOW, 0, 0.3);
          }
        }
      } else if (el === 'fire') {
        const n = sys.rate(e, 'acc0', area * 0.4, dt);
        for (let i = 0; i < n; i++) {
          const pt = randDisc(x, y, R);
          sys.add.add(pt[0], e.k1 - rnd(0, 1.5), pt[1], rnd(-0.3, 0.3), -rnd(2, 4), rnd(-0.3, 0.3), rnd(1, 1.6), 0.14, 0.05, COLORS.ember, 1, CELL.SPARK);
        }
      } else if (pal.gloom) {
        const n = sys.rate(e, 'acc0', area * 0.35, dt);
        for (let i = 0; i < n; i++) {
          const pt = randDisc(x, y, R);
          const p = sys.alpha.add(pt[0], sys.ground(pt[0], pt[1]) + 0.2, pt[1], 0, rnd(0.3, 0.8), 0, rnd(1, 1.5), 0.5, 1.3, pal.gloom, 0.35, CELL.SMOKE, 0, 0.5);
          sys.alpha.setSpin(p, Math.random() * TAU, 0.5);
        }
      }
      return true;
    },
  },

  shield: {
    start(sys, e) {
      const pal = e.pal;
      const area = e.r >= 2;
      const R = area ? e.r : Math.max(e.r, 1.3);
      e.k0 = R;
      e.k1 = area ? 0.7 : 1.15; // height ratio
      e.flag = area;
      e.dur = e.follow ? clamp(e.dur || 3, 1, 15) : clamp(e.dur || 1.6, 1, 1.8);
      e.dome = sys.domes.acquire();
      if (e.dome) {
        e.dome.u.uColor.value.set(pal.glow.r, pal.glow.g, pal.glow.b);
        e.dome.u.uCore.value.set(pal.core.r, pal.core.g, pal.core.b);
        e.dome.u.uOpacity.value = 0;
        e.dome.u.uTime.value = Math.random() * 5;
        e.dome.mesh.position.set(e.x, e.gz - 0.05, e.y);
        e.dome.mesh.scale.set(0.01, 0.01, 0.01);
      }
      e.d0 = sys.acquireDecal(STYLE.glowDisc, pal.glow, pal.core);
      if (e.d0) {
        e.d0.layout(sys.getHeight, e.x, e.y, R);
        e.k2 = e.x;
        e.k3 = e.y;
      }
      sys.flareFx(e.x, e.gz + 0.8, e.y, 0.8, 2 + 0.4 * R, 0.35, pal.glow, pal.core, 0.8, 0.4);
      if (area) sys.decalFx(STYLE.ring, e.x, e.y, 0.3, R, 0.5, pal.glow, pal.core, 0.9, 0.03, 0.3);
    },
    update(sys, e, dt) {
      const t = e.t;
      const D = e.dur;
      if (t >= D) return false;
      const pal = e.pal;
      const R = e.k0;
      const pop = t < 0.28 ? Math.max(0.01, easeOutBack(t / 0.28)) : 1;
      const fade = t > D - 0.4 ? (D - t) / 0.4 : 1;
      if (e.dome) {
        e.dome.mesh.position.set(e.x, e.gz - 0.05, e.y);
        e.dome.mesh.scale.set(R * pop, R * e.k1 * pop, R * pop);
        e.dome.u.uOpacity.value = (0.75 + 0.15 * Math.sin(t * 6)) * fade * (t < 0.28 ? 1.4 : 1);
        e.dome.u.uTime.value += dt;
      }
      if (e.d0) {
        if (e.x !== e.k2 || e.y !== e.k3) {
          e.d0.layout(sys.getHeight, e.x, e.y, R);
          e.k2 = e.x;
          e.k3 = e.y;
        }
        e.d0.u.uOpacity.value = 0.55 * fade;
        e.d0.u.uTime.value = t;
      }
      const n = sys.rate(e, 'acc0', 10 * R, dt);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const b = rnd(0.1, 1.3);
        sys.add.add(e.x + Math.cos(a) * Math.cos(b) * R, e.gz + Math.sin(b) * R * e.k1, e.y + Math.sin(a) * Math.cos(b) * R, 0, rnd(0.1, 0.4), 0, rnd(0.4, 0.6), 0.2, 0.04, pal.core, fade, CELL.STAR);
      }
      return true;
    },
  },

  dash: {
    start(sys, e) {
      const pal = e.pal;
      const dist = Math.hypot(e.x - e.fx, e.y - e.fy);
      if (!e.hasFrom || dist < 0.3) {
        e.flag = true;
        sys.flareFx(e.x, e.gz + 0.7, e.y, 1, 2.2, 0.3, pal.glow, pal.core, 1, 0.3);
        sys.decalFx(STYLE.ring, e.x, e.y, 0.2, 1.3, 0.4, pal.glow, pal.core, 1, 0.02, 0.3);
        sys.dustAt(e.x, e.y, 1);
        return;
      }
      e.k0 = clamp((e.dur || 0.5) - 0.3, 0.12, 0.8);
      e.k1 = dist;
      e.k2 = 0.7 + 0.4 * Math.max(e.r, 0.5);
      const main = sys.acquireRibbon(e, pal.glow, pal.core, e.k2);
      if (main) {
        main.u.uStripes.value = 0.55;
        main.u.uFade.value.set(0.3, 0.05);
        main.u.uHot.value = 2;
      }
      const halo = sys.acquireRibbon(e, pal.alt, pal.glow, e.k2 * 2.4);
      if (halo) halo.u.uFade.value.set(0.4, 0.1);
      e.g0 = sys.glows.alloc();
      e.stage = 0;
      sys.dustAt(e.fx, e.fy, 1);
      sys.flareFx(e.fx, sys.ground(e.fx, e.fy) + 0.7, e.fy, 0.8, 1.8, 0.25, pal.glow, pal.core, 0.8);
    },
    update(sys, e, dt) {
      if (e.flag) return false;
      const t = e.t;
      const T = e.k0;
      const total = T + 0.38;
      if (t >= total) return false;
      const pal = e.pal;
      const u = Math.min(1, t / T);
      const u0 = clamp((t - 0.2) / T, 0, u);
      const n = 6;
      const op = t < T ? 1 : (total - t) / 0.38;
      for (let k = 0; k < e.nrib; k++) {
        const r = e.ribs[k];
        if (!r) continue;
        for (let i = 0; i < n; i++) {
          const uu = u0 + ((u - u0) * i) / (n - 1);
          const px = e.fx + (e.x - e.fx) * uu;
          const py = e.fy + (e.y - e.fy) * uu;
          r.set(i, px, sys.ground(px, py) + 0.7, py, 0.2 + (0.8 * i) / (n - 1));
        }
        r.commit(u - u0 > 0.002 ? n : 0);
        r.u.uOpacity.value = k === 0 ? op : op * 0.35;
        r.u.uTime.value = t;
      }
      const hx = e.fx + (e.x - e.fx) * u;
      const hy = e.fy + (e.y - e.fy) * u;
      const hg = sys.ground(hx, hy);
      sys.glows.set(e.g0, hx, hg + 0.7, hy, t < T ? 1.3 : 1.3 * op, pal.glow, 1, 0, 0, 1.3);
      if (t < T) {
        const m = sys.rate(e, 'acc0', 45, dt);
        for (let i = 0; i < m; i++) {
          const p = sys.alpha.add(hx + rnd(-0.3, 0.3), hg + 0.15, hy + rnd(-0.3, 0.3), rnd(-0.6, 0.6), rnd(0.2, 0.6), rnd(-0.6, 0.6), rnd(0.6, 0.9), 0.35, 0.9, COLORS.dust, 0.4, CELL.SMOKE, 0, 1.5);
          sys.alpha.setSpin(p, Math.random() * TAU, 1);
        }
        const s = sys.rate(e, 'acc1', 60, dt);
        const dx = (e.x - e.fx) / e.k1;
        const dy = (e.y - e.fy) / e.k1;
        for (let i = 0; i < s; i++) {
          sys.add.add(hx + rnd(-0.3, 0.3), hg + rnd(0.3, 1.1), hy + rnd(-0.3, 0.3), -dx * 2, 0, -dy * 2, rnd(0.2, 0.32), 0.3, 0.06, pal.glow, 0.8, CELL.GLOW);
        }
      } else if (e.stage === 0) {
        e.stage = 1;
        sys.decalFx(STYLE.ring, e.x, e.y, 0.2, Math.max(1.2, e.k2 * 2), 0.4, pal.glow, pal.core, 1, 0.02, 0.3);
        sys.burst(sys.add, e.x, hg + 0.5, e.y, 14, 1.5, 4, 0.5, 3, 0.3, 0.5, 0.2, 0.04, pal.core, pal.glow, 1, CELL.SPARK, 6, 1);
        sys.dustAt(e.x, e.y, 1.2);
        sys.addShake(0.05, e.x, e.y);
      }
      return true;
    },
  },
};
