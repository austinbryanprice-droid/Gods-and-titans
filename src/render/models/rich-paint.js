// Per-vertex color work shared by the rich character builders (rich-humanoid.js, rich-gear.js,
// rich-headgear.js, rich-regalia.js, the pantheon outfits). A paint is (out, x, y, z, u, a) =>
// void, called by MeshKit for every vertex of a primitive: it scales or replaces out.r/g/b
// (out.team scales the team color instead when the primitive is team-painted) and may add
// out.glow. A pattern in the vertex colors costs no triangles, so cloth, armor plates, wraps
// and face paint get their detail from here.
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Cheap deterministic value noise in 3D (cloth mottling, fur tufts, feather variation). */
export const hash = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Scale a vertex color (the team color when the primitive is team painted). */
export const mul = (o, k) => {
  if (o.team) o.team *= k;
  else {
    o.r *= k;
    o.g *= k;
    o.b *= k;
  }
};

/** Mix a vertex color toward a THREE.Color-like { r, g, b } by t (leaves team painting alone: a team color has no rgb of its own). */
export const tint = (o, c, t) => {
  if (o.team) return;
  o.r = lerp(o.r, c.r, t);
  o.g = lerp(o.g, c.g, t);
  o.b = lerp(o.b, c.b, t);
};

/** Replace a vertex color with a fixed one, mixed in by t (a team painted vertex turns into a plain one when t is half or more). */
export const dye = (o, c, t = 1) => {
  if (o.team) {
    if (t < 0.5) return;
    o.team = 0;
    o.r = c.r;
    o.g = c.g;
    o.b = c.b;
    return;
  }
  o.r = lerp(o.r, c.r, t);
  o.g = lerp(o.g, c.g, t);
  o.b = lerp(o.b, c.b, t);
};

/** Like dye, where `c` may also be a team color ({ team }): the vertex turns team painted (a stripe of the team's color on cloth of another). */
export const recolor = (o, c, t = 1) => {
  if (c.team) {
    if (t >= 0.5) o.team = c.team;
  } else dye(o, c, t);
};

/** Brighten / darken by height: k0 at y0 to k1 at y1. */
export const gradY = (y0, y1, k0, k1) => (o, x, y) => mul(o, lerp(k0, k1, clamp((y - y0) / (y1 - y0))));

/** A fur coat: streaks of lighter and darker hair over a surface (a monkey's), a speckle of tufts between. */
export const furStreaks = (o, x, y, z) => mul(o, 0.88 + 0.16 * Math.abs(Math.sin(z * 85 + x * 55 + y * 9)) + 0.08 * hash(Math.round(x * 60), Math.round(y * 45), Math.round(z * 60)));

/** A jaguar's coat: rosettes (a dark ring about a tawny middle) at the nearest of a jittered point in each cell of a grid `cell` wide. */
export const jaguarSpots = (cell = 0.05) => (o, x, y, z) => {
  const px = x / cell;
  const py = y / cell;
  const pz = z / cell;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  let d = 9;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (let k = -1; k <= 1; k++) {
        const cx = ix + i;
        const cy = iy + j;
        const cz = iz + k;
        d = Math.min(d, Math.hypot(cx + hash(cx, cy, cz) - px, cy + hash(cy, cz, cx) - py, cz + hash(cz, cx, cy) - pz));
      }
    }
  }
  if (d < 0.17) mul(o, 0.8);
  else if (d < 0.3) mul(o, 0.3);
};

/** Quilting: lines of stitching on a diamond grid `cell` wide, a shade darker than the cotton. */
export const quilt = (cell = 0.05, k = 0.8) => (o, x, y, z) => {
  const a = (y + z) / cell;
  const b = (y - z) / cell;
  if (Math.min(Math.abs(a - Math.round(a)), Math.abs(b - Math.round(b))) < 0.1) mul(o, k);
};

/**
 * Rows of overlapping feathers laid round a limb or a body about the vertical axis through (cx, cz): `per` feathers a row,
 * rows `pitch` high, the lower edge of each feather rounded, a shade darker where one overlaps the next.
 */
export const featherRows = ({ pitch = 0.04, per = 14, cx = 0, cz = 0, dark = 0.7, light = 1.1 } = {}) => (o, x, y, z) => {
  const row = y / pitch;
  const i = Math.floor(row);
  const f = row - i;
  const col = (Math.atan2(z - cz, x - cx) / (2 * Math.PI)) * per + (i & 1) * 0.5;
  const c = col - Math.floor(col);
  const edge = f + 0.34 * (1 - (1 - Math.abs(2 * c - 1) ** 2));
  if (edge < 0.3) mul(o, dark);
  else mul(o, light - (light - 0.92) * Math.min(1, (edge - 0.3) / 0.7));
};

/**
 * Tartan, the Celts' woven check: two sets of bands crossing at right angles, repeating every `cell`. The warp bands (up and
 * down) turn the cloth to `hue` (a plain color; none: they darken it like the weft), the weft bands (across) darken it by `k`,
 * and where they cross it is the darkest. About a limb or a garment the warp bands follow the arc at radius `r` round the
 * vertical axis through (cx, cz); `flat` runs them along z instead, over a hanging sheet. `band`: the share of a repeat a band takes.
 */
export const tartan = ({ cell = 0.1, hue = null, k = 0.72, cx = 0, cz = 0, r = 0.06, flat = false, band = 0.42 } = {}) => (o, x, y, z) => {
  const s = (flat ? z : Math.atan2(z - cz, x - cx) * r) / cell;
  const t = y / cell;
  if (s - Math.floor(s) < band) {
    if (hue) dye(o, hue, 0.92);
    else mul(o, k);
  }
  if (t - Math.floor(t) < band) mul(o, k);
};

/**
 * The color of block `j` of strip `i` of kente, the Akan's strip-woven cloth: narrow strips sewn edge to edge, each its own color
 * from `colors` (a team color works), the even ones banded across in the colors that follow, the odd ones plain with a band of
 * another every third block. For a stole or a sheet laid out by its own grid.
 */
export const kenteAt = (colors, i, j) => {
  const n = colors.length;
  const k = i & 1 ? (j % 3 === 0 ? 2 : 0) : j;
  return colors[(((i + k) % n) + n) % n];
};

/**
 * Kente about a limb or a garment: the strips follow the arc at radius `r` round the vertical axis through (cx, cz); `flat` runs
 * them along z instead, over a hanging sheet. `strip` is the width of a strip (a strip narrower than two vertices turns to noise),
 * `block` the height of a band.
 */
export const kente = ({ colors, strip = 0.07, block = 0.07, cx = 0, cz = 0, r = 0.06, flat = false } = {}) => (o, x, y, z) => {
  recolor(o, kenteAt(colors, Math.floor((flat ? z : Math.atan2(z - cz, x - cx) * r) / strip), Math.floor(y / block)), 1);
};

/**
 * Mud cloth (bogolan), the Mande's hand-dyed cotton, sewn from strips `cell` wide: on the cloth's own dark ground, every other
 * strip a ladder of bars of `ink` a cell apart, the strips between dotted with a dash of it in every other cell. Laid about a body
 * like `kente` (r, cx, cz, flat).
 */
export const mudcloth = ({ ink, cell = 0.08, cx = 0, cz = 0, r = 0.06, flat = false } = {}) => (o, x, y, z) => {
  const s = (flat ? z : Math.atan2(z - cz, x - cx) * r) / cell;
  const t = y / cell;
  const fs = s - Math.floor(s);
  const ft = t - Math.floor(t);
  if (!(Math.floor(s) & 1)) {
    if (ft < 0.3) recolor(o, ink, 1);
  } else if (Math.floor(t) & 1 && Math.abs(fs - 0.5) < 0.25 && Math.abs(ft - 0.5) < 0.25) recolor(o, ink, 1);
};

/** Ring mail: a flecked, uneven sheen (rows of rings catch the light one way and the next another). */
export const mailSheen = (cell = 0.03, k = 0.2) => (o, x, y, z) => {
  const row = Math.floor(y / cell);
  mul(o, 1 - k * 0.5 + k * 0.4 * hash(row, Math.round(z * 40), Math.round(x * 40)) - (row & 1) * k * 0.3);
};

/** Several paints in a row. */
export const paints = (...fns) => (o, x, y, z, u, a) => {
  for (const f of fns) if (f) f(o, x, y, z, u, a);
};

export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};
