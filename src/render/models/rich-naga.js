// The rich nagas (High and Ultra): the Hindu Naga, Nüwa and Quetzalcoatl. Above the waist they are the humanoid (rich-humanoid.js:
// the arms with their hands, the head, whatever the unit's pantheon outfit dresses them in); below it a serpent's tail takes the
// legs' place: a chain of bones (rich-kit.js humanoidSpec, opts.tail) hangs from the pelvis, down the belly and back along the
// ground, and one smooth scaled loft is skinned along it, so the tail undulates behind a naga that glides and sways about one that
// stands (rich-anim.js poseTail, 'serpent'). The pantheon outfits (rich-outfits-hindu.js, -chinese.js, -aztec.js) dress the
// body as they dress a person, and call `nagaTail` and `nagaWaist` where they would build the legs and the skirt.
import { mixC, withMat } from './unit-geo.js';
import { ps, vs, B, alongPath, smoothstep } from './rich-kit.js';
import { pathStations, ringPoint } from './rich-creature-kit.js';
import { backTone } from './rich-reptile-heads.js';
import { torsoRing } from './rich-body.js';
import { feather } from './rich-feathers.js';
import { lerp, hash, mul, tint } from './rich-paint.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// the tail: bones, skin weights and the loft's path
// ---------------------------------------------------------------------------

/**
 * The tail's key points below the hip: [forward, drop below the hip, sideways, dorsoventral radius, lateral radius]. It runs from
 * inside the waist down the belly, bends back to the ground and lies along it in a slow S that ends in a thin tip curling up.
 */
const TAIL = [
  [0.0, -0.05, 0.0, 0.086, 0.12],
  [0.0, 0.0, 0.0, 0.094, 0.146],
  [-0.002, 0.06, 0.0, 0.106, 0.152],
  [-0.03, 0.14, 0.0, 0.118, 0.146],
  [-0.095, 0.225, 0.02, 0.122, 0.136],
  [-0.175, 0.295, 0.07, 0.118, 0.126],
  [-0.29, 0.335, 0.14, 0.112, 0.118],
  [-0.45, 0.35, 0.2, 0.104, 0.11],
  [-0.62, 0.36, 0.21, 0.09, 0.096],
  [-0.8, 0.37, 0.14, 0.076, 0.08],
  [-0.98, 0.38, 0.02, 0.062, 0.065],
  [-1.14, 0.39, -0.1, 0.046, 0.048],
  [-1.27, 0.4, -0.18, 0.03, 0.031],
  [-1.36, 0.41, -0.2, 0.014, 0.014],
];
/** The keys the bones sit at (the joints the tail bends about). */
const JOINTS = [2, 4, 6, 7, 8, 9, 10, 11, 12];
/** The loft's frame: the first radius (dorsoventral) lies along this, which is the back wherever the tail runs, down the belly and along the ground. */
const BACK = [-Math.SQRT1_2, Math.SQRT1_2, 0];

/** The key points in model space: [x, y, z, dorsoventral radius, lateral radius], the belly never sunk into the ground. */
function tailKeys(D) {
  return TAIL.map(([x, drop, z, rx, rz]) => [x, Math.max(D.hipY - drop, rx * 0.93), z, rx, rz]);
}

/** The rest positions of the tail's bones for humanoidSpec (opts.tail). */
export const nagaBones = (D) => {
  const K = tailKeys(D);
  return JOINTS.map((k) => [K[k][0], K[k][1], K[k][2]]);
};

/** The skin weights of the tail (bind.tail: along its bones, which hang from the pelvis; the top of it is the pelvis's). */
export function addNagaBinds(spec, D, bind) {
  const K = tailKeys(D);
  const bones = [B.pelvis, ...JOINTS.map((k, i) => spec.tail.first + i)];
  const last = K[K.length - 1];
  bind.tail = alongPath(bones, [[0, D.hipY, 0], ...nagaBones(D), [last[0], last[1], last[2]]]);
}

/** The loft's stations along the whole tail (and the key index of each, for placing things at a fraction of its length). */
function tailStations(D, count) {
  return pathStations(tailKeys(D), count);
}

/** A fraction of the way down the tail's length -> the station index in a list of `count`. */
const stationAt = (count, f) => Math.max(0, Math.min(count - 1, Math.round(f * (count - 1))));

// ---------------------------------------------------------------------------
// the scales
// ---------------------------------------------------------------------------

/**
 * Scale diamonds over the back and flanks, a second tone along the ridge (see backTone), the belly pale and laid in broad plates
 * across it. `u` runs along the tail; `mark(out, x, y, z, u, a, c)` adds a unit's own pattern (c: the cosine round the ring, 1 on the back).
 * `o.feathers = { rows (to the unit of length), per (round the ring), tip (a color for each feather's edge) }` lays lapped feathers
 * pointing back in place of the diamonds.
 */
export function scalesOf(len, o) {
  const rows = Math.round(len * (o.rowsK ?? 13));
  const per = o.per ?? 10;
  const plates = Math.round(len * (o.plateK ?? 9));
  const { k, lo, hi } = backTone(o.skin, o.back, o.backK ?? 0.5);
  const fe = o.feathers;
  const frows = fe ? Math.round(len * fe.rows) : 0;
  return (out, x, y, z, u, a) => {
    const c = Math.cos(a * TAU);
    const bel = smoothstep(-0.5, -0.85, c);
    tint(out, o.back, k * smoothstep(lo, hi, c));
    if (fe) {
      // lapped feathers pointing back: rows across the tail, each feather a scallop with its edge darker, a sheen just inside it
      const frow = u * frows;
      const fi = Math.floor(frow);
      const g = 1 - (frow - fi);
      const fcol = a * fe.per + (fi & 1) * 0.5;
      const fc = fcol - Math.floor(fcol);
      const edge = g + 0.34 * (2 * fc - 1) ** 2;
      if (fe.tip) tint(out, fe.tip, 0.4 * smoothstep(0.55, 0.3, edge) * smoothstep(0.1, 0.3, edge) * (1 - bel));
      mul(out, lerp(edge < 0.3 ? 0.62 : 1.12 - 0.22 * Math.min(1, (edge - 0.3) / 0.7) + 0.05 * (hash(fi, Math.floor(fcol), 5) - 0.5), 1, bel));
    } else {
      const row = u * rows;
      const i = Math.floor(row);
      const f = row - i;
      const col = a * per + (i & 1) * 0.5;
      const cc = col - Math.floor(col);
      const dd = Math.abs(f - 0.5) + Math.abs(cc - 0.5);
      mul(out, lerp(0.78 + 0.3 * smoothstep(0.62, 0.12, dd) + 0.05 * (hash(i, Math.floor(col), 3) - 0.5), 1, bel));
    }
    tint(out, o.belly, 0.85 * bel);
    const pf = (u * plates) % 1;
    mul(out, 1 - bel * (0.3 * smoothstep(0.2, 0, pf) + 0.12 * smoothstep(0.8, 1, pf)));
    if (o.mark) o.mark(out, x, y, z, u, a, c);
  };
}

/** The pale underside of a serpent of this skin: warm cream with a trace of its scales' color (the tail's belly, the cobra hood's face). */
export const nagaBelly = (skin) => withMat(mixC(skin, '#f2e4b8', 0.72), 'scales');

/** A chain of diamonds down the back (`n` of them along the tail), `k` of the ring's angle wide, in `color`: a mark for `scalesOf`. */
export const dorsalDiamonds = (n, color, k = 1.6, amount = 0.85) => (out, x, y, z, u, a, c) => {
  if (c < 0.4) return;
  const f = (u * n) % 1;
  const dd = Math.abs(f - 0.5) * 2 + Math.abs(Math.sin(a * TAU)) * k;
  tint(out, color, amount * smoothstep(1, 0.8, dd) * smoothstep(0.4, 0.7, c));
};

// ---------------------------------------------------------------------------
// the dressing
// ---------------------------------------------------------------------------

/** A ring round the tail over the stations i0 .. i1, `k` times as thick as the tail there. */
function band(kit, st, i0, i1, k, color, bind, { mat, glow = 0 } = {}) {
  const sub = st.slice(Math.max(0, i0), Math.min(st.length, i1 + 1)).map((s) => ({ ...s, rx: s.rx * k, rz: s.rz * k }));
  kit.loft(sub, { ref: BACK, sides: kit.sides + 2, start: null, end: null, color, mat, glow, bind });
}

/**
 * The tail, built where the outfit would build the legs. o: { skin, back, belly (the colors: the unit's skin, the ridge's tone, the
 * belly's), backK, mark(out, x, y, z, u, a, c) (a pattern of its own), feathers: { rows (per unit of length), per (round the tail), tip (a color
 * for the sheen of each feather's edge) } (lapped feathers in place of scales), bands: [[fraction of the length, width in stations, color, mat], ...]
 * (rings of metal or of the team's color), tip: a color for the last of it }.
 * Returns { st, N } (the stations it was lofted along) for what a unit adds on the tail (plumes, ribbons, a fan).
 */
export function nagaTail(E, o = {}) {
  const { kit, D, bind, pal } = E;
  const N = 40;
  const st = tailStations(D, N);
  const skin = o.skin ?? withMat(pal.skin, 'scales');
  const back = o.back ?? withMat(pal.back, 'scales');
  const belly = o.belly ?? nagaBelly(skin);
  const K = tailKeys(D);
  let len = 0;
  for (let i = 1; i < K.length; i++) len += Math.hypot(K[i][0] - K[i - 1][0], K[i][1] - K[i - 1][1], K[i][2] - K[i - 1][2]);
  kit.loft(st, {
    ref: BACK, sides: kit.sides + 2, start: null, end: 'round', capRings: 3, capDepth: 0.03, color: skin, bind: bind.tail,
    paint: scalesOf(len, { skin, back, belly, backK: o.backK, mark: o.mark, rowsK: o.rowsK, plateK: o.plateK, per: o.per, feathers: o.feathers }),
  });
  for (const [f, w, color, mat, k = 1.06] of o.bands ?? []) band(kit, st, stationAt(N, f) - 1, stationAt(N, f) + w, k, color, bind.tail, { mat });
  return { st, N };
}

/**
 * The belt where the body meets the tail: a broad band that hides the seam between the torso's last ring and the tail's first, a rim
 * of metal below it and a clasp at the front. o: { color, rim, clasp (gem or metal), mat }.
 */
export function nagaWaist(E, o) {
  const { kit, D, bind } = E;
  const a = torsoRing(D, -0.16, 0.052);
  const b = torsoRing(D, 0.2, 0.034);
  kit.loft([vs(a.y, a.rx, a.rz, a.dx), vs((a.y + b.y) / 2, (a.rx + b.rx) / 2 + 0.004, (a.rz + b.rz) / 2 + 0.004, (a.dx + b.dx) / 2), vs(b.y, b.rx, b.rz, b.dx)],
    { sides: 20, rings: 3, start: null, end: null, color: o.color, mat: o.mat ?? 'trim', bind: bind.torso });
  if (o.rim) {
    kit.loft([vs(a.y - 0.008, a.rx + 0.004, a.rz + 0.004, a.dx), vs(a.y + 0.012, a.rx + 0.003, a.rz + 0.003, a.dx)], { sides: 20, start: null, end: null, color: o.rim, mat: 'gold', bind: bind.torso });
  }
  if (o.clasp) {
    const m = torsoRing(D, 0.06, 0.05);
    const r = 0.028 * D.k;
    kit.loft([ps(m.dx + m.rx - 0.004, m.y, 0, r, r), ps(m.dx + m.rx + 0.012, m.y, 0, r * 0.86, r * 0.86)],
      { ref: [0, 1, 0], sides: 12, start: 'round', end: 'round', capDepth: 0.008, color: o.clasp, mat: o.claspMat ?? 'gem', glow: o.claspMat === 'gold' ? 0 : 0.35, bind: bind.torso });
  }
}

/**
 * A fan of feathers at the tip of the tail (the feathered serpent's), rooted on the tail `back` stations short of its end and spread
 * flat about it, the outer ones shorter. o: { n, len, width, colors (each feather takes the next), tip, spread (radians), lift }.
 */
export function tailFan(E, st, o) {
  const { kit, bind, D } = E;
  const { p, t } = onTail(st, st.length - 1 - (o.back ?? 3), 0);
  const n = o.n ?? 5;
  const spread = o.spread ?? 1.0;
  for (let k = 0; k < n; k++) {
    const s = n > 1 ? k / (n - 1) : 0.5;
    const ang = (s - 0.5) * spread;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const dir = [t[0] * ca + t[2] * sa, t[1] + (o.lift ?? 0.2), -t[0] * sa + t[2] * ca];
    feather(kit, p, dir, [0, 1, 0], (o.len ?? 0.4) * D.k * (1 - 0.3 * Math.abs(2 * s - 1)), (o.width ?? 0.045) * D.k, {
      color: o.colors[k % o.colors.length], tip: o.tip, bind: bind.tail, bend: [0, -0.03 * D.k, 0], rows: o.rows ?? 3, thick: 0.003,
    });
  }
}

/** The point on the tail's surface at station `i` and ring angle `a` (0 on the back), with its outward normal and the direction the tail runs: where a plume or an ornament roots. */
export function onTail(st, i, a) {
  return ringPoint(st, i, a, BACK);
}

