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

/** Brighten / darken by height: k0 at y0 to k1 at y1. */
export const gradY = (y0, y1, k0, k1) => (o, x, y) => mul(o, lerp(k0, k1, clamp((y - y0) / (y1 - y0))));

/** Several paints in a row. */
export const paints = (...fns) => (o, x, y, z, u, a) => {
  for (const f of fns) if (f) f(o, x, y, z, u, a);
};

export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};
