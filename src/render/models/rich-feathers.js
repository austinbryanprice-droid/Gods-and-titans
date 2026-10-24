// Feathers for the rich characters: winged helmets, wings, feather cloaks, headdresses and
// plumes all use the same leaf-shaped double sheet, so they cost a few triangles each and read
// as feathers (a rachis down the middle, a darker or brighter tip, a slight cup) rather than
// as flat cards.
import { smoothstep } from './rich-kit.js';
import { lerp, mul } from './rich-paint.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * A feather: a leaf shaped double sheet from `root` along `dir`, its face turned toward `face`
 * (any vector not parallel to dir). opts: color, tip (color toward the tip), mat ('feather'),
 * bind, thick, bend ([x, y, z] added at the tip, growing with the square of the distance
 * along: a curve), cup (how far the vane curls toward the face, as a fraction of the
 * width), rows (cells along the length), shape (the widest point along it, 0..1), glow.
 */
export function feather(kit, root, dir, face, length, width, opts = {}) {
  const t = norm(dir);
  const f0 = norm(face);
  const f = norm(sub(f0, [t[0] * dot(f0, t), t[1] * dot(f0, t), t[2] * dot(f0, t)]));
  const w = cross(t, f);
  const bend = opts.bend || [0, 0, 0];
  const cup = opts.cup ?? 0.25;
  const peak = opts.shape ?? 0.38;
  const tip = opts.tip || null;
  const tipC = tip ? { r: tip.r, g: tip.g, b: tip.b } : null;
  kit.sheet(2, opts.rows ?? 5, (u, v, out) => {
    // leaf outline: rises to the widest point, then closes to a point
    const wv = v < peak ? Math.sin((Math.PI / 2) * (v / peak)) ** 0.8 : Math.cos((Math.PI / 2) * ((v - peak) / (1 - peak))) ** 0.9;
    const across = (u - 0.5) * 2 * width * wv * (v < 0.02 ? 0.4 : 1);
    const lift = cup * width * (across / (width || 1)) ** 2 * wv;
    for (let k = 0; k < 3; k++) {
      out[k] = root[k] + t[k] * length * v + bend[k] * v * v + w[k] * across + f[k] * lift;
    }
  }, {
    thick: opts.thick ?? Math.max(0.0012, width * 0.06),
    color: opts.color, inner: opts.inner ?? opts.color, mat: opts.mat ?? 'feather', bind: opts.bind, glow: opts.glow || 0,
    paint: (o, x, y, z, u, a) => {
      // the rachis runs lighter down the middle; the tip takes its own color
      const rach = 1 - smoothstep(0.0, 0.22, Math.abs(u - 0.5));
      mul(o, 1 + 0.12 * rach - 0.1 * (1 - rach) * smoothstep(0.2, 1, a));
      if (tipC && !o.team) {
        const k = smoothstep(0.55, 1, a);
        o.r = lerp(o.r, tipC.r, k);
        o.g = lerp(o.g, tipC.g, k);
        o.b = lerp(o.b, tipC.b, k);
      }
    },
  });
}

/**
 * A fan of feathers from one root: n feathers swept from angle a0 to a1 (radians) about
 * `axis` (the normal of the fan's plane), starting along `from`; lengths follow len(i / (n - 1)).
 */
export function featherFan(kit, root, from, axis, a0, a1, n, len, width, opts = {}) {
  const ax = norm(axis);
  const f0 = norm(from);
  const b = cross(ax, f0);
  for (let i = 0; i < n; i++) {
    const k = n > 1 ? i / (n - 1) : 0.5;
    const a = lerp(a0, a1, k);
    const d = [f0[0] * Math.cos(a) + b[0] * Math.sin(a), f0[1] * Math.cos(a) + b[1] * Math.sin(a), f0[2] * Math.cos(a) + b[2] * Math.sin(a)];
    const o = typeof opts === 'function' ? opts(i, k) : opts;
    feather(kit, root, d, ax, typeof len === 'function' ? len(k, i) : len, typeof width === 'function' ? width(k, i) : width, o);
  }
}
