// Hair for the rich creatures: the shingled ruff of a wolf, a lion's mane, the crest of a horse, a long tail of hair.
// All of it is cards of hair (rich-creature-parts.js tuft) rooted under the coat and bound to the bones of the part they
// grow on, so they move with it.
import { smoothstep } from './rich-kit.js';
import { ringPoint, along } from './rich-creature-kit.js';
import { clamp, lerp, hash, mul, tint } from './rich-paint.js';
import { tuft } from './rich-creature-parts.js';

const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Locks of fur lying back over the neck and the chest like shingles: wide flat cards rooted under the coat, their tips
 * lifting a little, a mane along the top and a ruff under the throat (the sides stay smooth). `st`: the stations of the
 * body loft. o: { from (x where it starts), len, w, color, back (the second tone), bind }.
 */
export function ruff(kit, st, o) {
  const ANGLES = [[0, 1.0], [0.6, 0.75], [-0.6, 0.75], [2.6, 1.0], [-2.6, 1.0], [Math.PI, 1.3]];
  for (let i = 0; i < st.length - 1; i++) {
    if (st[i].c[0] < o.from || i % 2) continue;
    ANGLES.forEach(([a, k], j) => {
      const h = hash(i, j, 3);
      if (h < 0.12) return;
      const { p, n, t, across } = ringPoint(st, i, a);
      const len = o.len * k * (0.75 + 0.5 * h);
      const dir = [n[0] * 0.14 - t[0] * 0.98, n[1] * 0.14 - t[1] * 0.98, n[2] * 0.14 - t[2] * 0.98];
      const at = [p[0] - n[0] * len * 0.12, p[1] - n[1] * len * 0.12, p[2] - n[2] * len * 0.12];
      tuft(kit, {
        at, dir, len, w: o.w * (0.8 + 0.5 * h), th: o.w * 0.16, bend: [n[0] * len * 0.28, n[1] * len * 0.28 - len * 0.12, n[2] * len * 0.28], across, sides: 4, rings: 3,
        color: h > 0.55 ? o.back : o.color, bind: o.bind,
        paint: (out, x, y, z, u) => mul(out, 1.06 - 0.28 * u),
      });
    });
  }
}

/** The width of a rounded shingle along its length (1 at the root, round at the tip). */
const scallop = (t) => Math.sqrt(Math.max(0, 1 - t ** 2.4)) * 0.9 + 0.1 * (1 - t);

/**
 * A lion's mane: rings of broad rounded locks laid over one another like shingles all round the neck, from the shoulders
 * to the head, lying back and standing out a little more about the face, their tips darker. o: { from, len, w, color, dark,
 * tip, bind, skip(a, tt) (true: no lock at the ring angle a of the ring tt of the way up: a face to keep clear) }.
 */
export function lionMane(kit, st, o) {
  const i0 = Math.max(1, st.findIndex((s) => s.c[0] >= o.from));
  const last = st.length - 2;
  for (let i = i0; i <= last; i++) {
    const tt = (i - i0) / Math.max(1, last - i0);
    const s = st[i];
    const rr = (s.rx + s.rz) * 0.5;
    const n = Math.max(7, Math.round((2 * Math.PI * rr * 1.1) / o.w));
    for (let j = 0; j < n; j++) {
      const h = hash(i, j, 7);
      const a = ((j + (i % 2) * 0.5) / n) * 2 * Math.PI;
      if (o.skip && o.skip(a, tt)) continue;
      const { p, n: nn, t, across } = ringPoint(st, i, a);
      const under = Math.cos(a) < -0.5 ? 0.75 : 1;
      const len = o.len * (0.5 + 0.7 * smoothstep(0, 0.8, tt)) * (0.82 + 0.36 * h) * under;
      const outK = lerp(0.35, 0.95, tt);
      const dir = norm([nn[0] * outK - t[0], nn[1] * outK - t[1], nn[2] * outK - t[2]]);
      const at = [p[0] - nn[0] * len * 0.2, p[1] - nn[1] * len * 0.2, p[2] - nn[2] * len * 0.2];
      tuft(kit, {
        at, dir, len, w: o.w * (0.85 + 0.3 * h) * 0.55, th: o.w * 0.14, bend: [0, -len * 0.22, 0], across, sides: 4, rings: 3, profile: scallop,
        color: (i + j) % 3 ? o.color : o.dark, bind: o.bind,
        paint: (out, x, y, z, u) => {
          tint(out, o.tip, smoothstep(0.4, 1, u) * 0.7);
          mul(out, 0.88 + 0.24 * h);
        },
      });
    }
  }
}

/**
 * A horse's mane: long locks from the crest of the neck falling over one side. o: { from, side (+1 right), len, w, color,
 * tip, bind, rows }.
 */
export function crestMane(kit, st, o) {
  const side = o.side ?? 1;
  const i0 = Math.max(1, st.findIndex((s) => s.c[0] >= o.from));
  const last = st.length - 2;
  for (let i = i0; i <= last; i++) {
    const tt = (i - i0) / Math.max(1, last - i0);
    for (let j = 0; j < (o.rows ?? 2); j++) {
      const h = hash(i, j, 5);
      const a = (j - ((o.rows ?? 2) - 1) / 2) * 0.35 + (h - 0.5) * 0.12;
      const { p, n, t } = ringPoint(st, i, a);
      const len = o.len * (1.05 - 0.25 * tt) * (0.8 + 0.4 * h);
      const dir = norm([-t[0] * 0.35 + n[0] * 0.4, -t[1] * 0.35 + n[1] * 0.4, side * 0.85]);
      tuft(kit, {
        at: [p[0] - n[0] * len * 0.08, p[1] - n[1] * len * 0.08, p[2] - n[2] * len * 0.08], dir, len, w: o.w * (0.85 + 0.4 * h), th: o.w * 0.14,
        bend: [-len * 0.15, -len * 0.55, side * len * 0.1], across: t, sides: 4, rings: 4, color: o.color, bind: o.bind,
        paint: (out, x, y, z, u) => {
          tint(out, o.tip, smoothstep(0.5, 1, u) * 0.7);
          mul(out, 0.94 + 0.12 * h);
        },
      });
    }
  }
}

/** The forelock: a few locks falling forward between the ears. o: { at (head frame origin), len, w, color, tip, bind, down (unit vector of the head's forward direction) }. */
export function forelock(kit, o) {
  for (let k = 0; k < 4; k++) {
    const h = hash(k, 2, 9);
    const z = (k - 1.5) * o.w * 1.1;
    tuft(kit, {
      at: [o.at[0], o.at[1], o.at[2] + z], dir: norm([o.dir[0], o.dir[1], o.dir[2] + z * 2]), len: o.len * (0.8 + 0.4 * h), w: o.w, th: o.w * 0.18,
      bend: [o.dir[0] * 0.02, -o.len * 0.5, 0], across: [0, 0, 1], sides: 4, rings: 3, color: o.color, bind: o.bind,
      paint: (out, x, y, z, u) => tint(out, o.tip, smoothstep(0.5, 1, u) * 0.6),
    });
  }
}

/**
 * A tail of long hair: locks rooted along the first part of the tail path, hanging back and down. o: { pts (the tail's
 * path, model space), n, len, w, color, tip, bind, droop, spread }.
 */
export function hairTail(kit, o) {
  for (let k = 0; k < o.n; k++) {
    const f = o.n > 1 ? k / (o.n - 1) : 0.5;
    const h = hash(k, 4, 13);
    const { p, dir } = along(o.pts, clamp(0.05 + 0.55 * f * (0.7 + 0.5 * h)));
    const side = (h - 0.5) * 2 * (o.spread ?? 1);
    const len = o.len * (0.65 + 0.55 * h) * (1 - 0.3 * f);
    const d = norm([dir[0], dir[1] - (o.droop ?? 0.5), dir[2] + side * 0.35]);
    tuft(kit, {
      at: [p[0], p[1], p[2] + side * o.w * 0.8], dir: d, len, w: o.w * (0.8 + 0.5 * h), th: o.w * 0.2,
      bend: [dir[0] * len * 0.1, -len * 0.5, side * len * 0.12], across: norm([d[0], 0, d[2] + side * 0.3 + 0.01]), sides: 4, rings: 4, color: o.color, bind: o.bind,
      paint: (out, x, y, z, u) => {
        tint(out, o.tip, smoothstep(0.55, 1, u) * 0.7);
        mul(out, 0.92 + 0.14 * h);
      },
    });
  }
}
