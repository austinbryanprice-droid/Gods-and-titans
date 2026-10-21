// Building models, layer 1 (DESIGN.md 4.7 and 8): colors, what a part is made of (the surface
// classes the fragment shader draws), the geometry primitives, and the Kit that collects parts
// into the four vertex-colored buckets one building is merged from: base (foundation), body,
// team (team-colored, waving cloth) and glow (HDR emissive, flickering). Materials are in
// building-materials.js, the reusable pieces in building-pieces.js, the buildings in
// building-models.js.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../../sim/rng.js';

/** Height of the foundation top above the model origin (ground level). */
export const PLINTH = 0.1;
export const DEPTH = 0.65; // the foundation reaches this far below ground level
export const MARGIN = 0.1; // free space between the model and its footprint edge
export const PI = Math.PI;
export const BUCKETS = ['base', 'body', 'team', 'glow'];

export const DEFAULT_STYLE = { roof: 'gable', wall: 'stone', ornament: 'banners' };
export const DEFAULT_COLORS = { wall: '#d8d0c0', roof: '#8a4a3a', trim: '#4a6a9a', accent: '#d4af37' };

// ---------------------------------------------------------------------------
// colors
// ---------------------------------------------------------------------------

export const WHITE = new THREE.Color(1, 1, 1);
/** Copy of a color (a Color keeps its surface tag, see `made`). */
export function C(c) {
  const o = c instanceof THREE.Color ? c.clone() : new THREE.Color(c);
  if (c && c.surf) o.surf = c.surf;
  return o;
}
export const mix = (a, b, t) => C(a).lerp(C(b), t);
export const shade = (c, k) => C(c).multiplyScalar(k);
export const tint = (c, t) => C(c).lerp(WHITE, t);
export const gray = (v) => new THREE.Color(v, v, v);
export function luma(c) {
  const s = C(c).convertLinearToSRGB();
  return 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
}
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// surfaces: what a part is made of
// ---------------------------------------------------------------------------

/**
 * Surface classes: the procedural detail the fragment shader draws (keep in
 * sync with SURFACE_GLSL). WOOD resolves per part to planks (WOOD_*) or a beam
 * (BEAM_*) with the grain along the part's long axis. INTERIOR is an opening
 * (doorway, window): unlit, only the light from inside (see Kit.hole).
 */
export const CLS = {
  PLAIN: 0, STONE: 1, SANDSTONE: 2, MARBLE: 3, PLASTER: 4, MUDBRICK: 5, BRICK: 6,
  WOOD_Y: 7, WOOD_X: 8, WOOD_Z: 9, TILE: 10, TURF: 11, THATCH: 12, METAL: 13, GOLD: 14,
  CLOTH: 15, LACQUER: 16, ROCK: 17, EARTH: 18, BEAM_Y: 19, BEAM_X: 20, BEAM_Z: 21, INTERIOR: 22, WOOD: -1,
};
export const surf = (cls, rough, metal = 0) => Object.freeze({ cls, rough, metal });
/** Surface tags: class + base roughness / metalness. */
export const SURF = {
  plain: surf(CLS.PLAIN, 0.7),
  paint: surf(CLS.PLAIN, 0.55),
  stone: surf(CLS.STONE, 0.82),
  sandstone: surf(CLS.SANDSTONE, 0.86),
  marble: surf(CLS.MARBLE, 0.38),
  plaster: surf(CLS.PLASTER, 0.9),
  mudbrick: surf(CLS.MUDBRICK, 0.93),
  brick: surf(CLS.BRICK, 0.8),
  glazed: surf(CLS.BRICK, 0.3),
  wood: surf(CLS.WOOD, 0.8),
  tile: surf(CLS.TILE, 0.6),
  glazedTile: surf(CLS.TILE, 0.42),
  slateTile: surf(CLS.TILE, 0.58),
  turf: surf(CLS.TURF, 0.97),
  thatch: surf(CLS.THATCH, 0.95),
  // trim metals stay partly diffuse: seen from above most facets mirror the
  // blue sky, and fully metallic gold would read olive rather than gold
  metal: surf(CLS.METAL, 0.42, 0.5),
  gold: surf(CLS.GOLD, 0.36, 0.3),
  cloth: surf(CLS.CLOTH, 0.92),
  lacquer: surf(CLS.LACQUER, 0.3),
  rock: surf(CLS.ROCK, 0.86),
  earth: surf(CLS.EARTH, 0.97),
  water: surf(CLS.PLAIN, 0.08),
  interior: surf(CLS.INTERIOR, 1),
};

/** A copy of `color` tagged as made of `s` (the tag survives C, shade, tint and mix). */
export function made(color, s) {
  const c = C(color);
  c.surf = s;
  return c;
}

// ---------------------------------------------------------------------------
// geometry primitives (non-indexed, position only — or with smooth normals
// for round parts; colors and surfaces are added by Kit)
// ---------------------------------------------------------------------------

export const UP = new THREE.Vector3(0, 1, 0);
export const _a = new THREE.Vector3();
export const _b = new THREE.Vector3();
export const _c = new THREE.Vector3();
export const _q = new THREE.Quaternion();

/**
 * Non-indexed, position-only copy of a three.js geometry. `smooth` keeps its
 * normals (round parts shade smoothly; transforms keep them right). Parts
 * without normals get flat face normals in Kit.add, so a part whose vertices
 * are moved afterwards must not be smooth.
 */
export function prep(g, smooth = false) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const key of Object.keys(n.attributes)) if (key !== 'position' && !(smooth && key === 'normal')) n.deleteAttribute(key);
  n.morphAttributes = {};
  n.clearGroups();
  return n;
}

/** Cylinders and cones with this many sides or more are shaded round. */
export const SMOOTH_SEGMENTS = 6;

/** Box w×h×d standing on y (bottom face at y), centered on x/z, turned by ry. */
export function box(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = prep(new THREE.BoxGeometry(w, h, d));
  g.translate(0, h / 2, 0);
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
}

/** Box whose top face is scaled by kx/kz (battered walls, obelisks). */
export function frustum(w, h, d, kx, x = 0, y = 0, z = 0, kz = kx) {
  const g = box(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > h * 0.5) {
      p.setX(i, p.getX(i) * kx);
      p.setZ(i, p.getZ(i) * kz);
    }
  }
  return g.translate(x, y, z);
}

/** Cylinder standing on y. A flat side faces +Z when `flat` is set. Round-shaded from SMOOTH_SEGMENTS sides. */
export function cyl(rt, rb, h, seg = 6, x = 0, y = 0, z = 0, open = false, flat = false) {
  const g = prep(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), seg >= SMOOTH_SEGMENTS);
  g.translate(0, h / 2, 0);
  if (flat) g.rotateY(PI / seg);
  return g.translate(x, y, z);
}

/** Cone standing on y. Round-shaded from SMOOTH_SEGMENTS sides. */
export function cone(r, h, seg = 6, x = 0, y = 0, z = 0, open = false, flat = false) {
  const g = prep(new THREE.ConeGeometry(r, h, seg, 1, open), seg >= SMOOTH_SEGMENTS);
  g.translate(0, h / 2, 0);
  if (flat) g.rotateY(PI / seg);
  return g.translate(x, y, z);
}

/** Sphere centered at (x, y, z), optionally squashed vertically (round-shaded). */
export function ball(r, x = 0, y = 0, z = 0, ws = 6, hs = 4, sy = 1) {
  const g = prep(new THREE.SphereGeometry(r, ws, hs), true);
  if (sy !== 1) g.scale(1, sy, 1);
  return g.translate(x, y, z);
}

/** Half sphere of radius r and height h standing on y (round-shaded). */
export function dome(r, h, x = 0, y = 0, z = 0, ws = 8, hs = 3) {
  const g = prep(new THREE.SphereGeometry(r, ws, hs, 0, PI * 2, 0, PI / 2), true);
  g.scale(1, h / r, 1);
  return g.translate(x, y, z);
}

export const octa = (r, x = 0, y = 0, z = 0) => prep(new THREE.OctahedronGeometry(r, 0)).translate(x, y, z);
export const ico = (r, x = 0, y = 0, z = 0) => prep(new THREE.IcosahedronGeometry(r, 0)).translate(x, y, z);
export const dodeca = (r, x = 0, y = 0, z = 0) => prep(new THREE.DodecahedronGeometry(r, 0)).translate(x, y, z);
export const torus = (r, t, x = 0, y = 0, z = 0, rs = 3, ts = 10) => prep(new THREE.TorusGeometry(r, t, rs, ts)).translate(x, y, z);

/** Square beam of thickness t × t from point a to point b. */
export function strut(a, b, t, t2 = t) {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  _c.subVectors(_b, _a);
  const len = _c.length() || 1e-4;
  const g = box(t, len, t2);
  _q.setFromUnitVectors(UP, _c.normalize());
  g.applyQuaternion(_q);
  return g.translate(_a.x, _a.y, _a.z);
}

/** Round pole from a to b. */
export function pole(a, b, r, seg = 4, r2 = r) {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  _c.subVectors(_b, _a);
  const len = _c.length() || 1e-4;
  const g = cyl(r2, r, len, seg, 0, 0, 0, true);
  _q.setFromUnitVectors(UP, _c.normalize());
  g.applyQuaternion(_q);
  return g.translate(_a.x, _a.y, _a.z);
}

/** 2D outline (XY plane) extruded along Z by depth, centered on z = 0. */
export function extrude(points, depth) {
  const shape = new THREE.Shape(points.map(([px, py]) => new THREE.Vector2(px, py)));
  const g = prep(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 }));
  return g.translate(0, 0, -depth / 2);
}

export function triArea2(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return nx * nx + ny * ny + nz * nz;
}

/** Geometry from triangles [[a, b, c], ...]; degenerate ones are skipped. */
export function fromTris(tris) {
  const keep = tris.filter(([a, b, c]) => triArea2(a, b, c) > 1e-12);
  const arr = new Float32Array(keep.length * 9);
  let o = 0;
  for (const t of keep) for (const v of t) {
    arr[o++] = v[0];
    arr[o++] = v[1];
    arr[o++] = v[2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return g;
}

/**
 * Smooth normals across faces that meet at less than `deg` degrees, crisp hips,
 * ridges and eaves beyond it. Roofs lofted from rings read as one curved surface
 * (and their surface pattern keeps one direction across a split quad) instead of
 * a patchwork of flat triangles. Returns a new geometry.
 */
export function soft(g, deg = 38) {
  return toCreasedNormals(g, (deg * Math.PI) / 180);
}

/** Flip triangles whose normal points toward ref(centroid). */
export function orient(tris, ref) {
  for (const t of tris) {
    const [a, b, c] = t;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0]) / 3;
    const my = (a[1] + b[1] + c[1]) / 3;
    const mz = (a[2] + b[2] + c[2]) / 3;
    const r = ref(mx, my, mz);
    if (nx * (mx - r[0]) + ny * (my - r[1]) + nz * (mz - r[2]) < 0) {
      t[1] = c;
      t[2] = b;
    }
  }
  return tris;
}

/** Convex solid from triangles: every face is turned away from the vertex average. */
export function solid(tris) {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (const t of tris) for (const v of t) {
    sx += v[0];
    sy += v[1];
    sz += v[2];
    n++;
  }
  const ref = [sx / n, sy / n, sz / n];
  return fromTris(orient(tris, () => ref));
}

/**
 * Closed rectangle ring at height y, counter-clockwise seen from above,
 * starting at the (+x, +z) corner. `per` points per side; corners rise by `lift`.
 */
export function rectRing(hw, hd, y, cx = 0, cz = 0, per = 1, lift = 0) {
  const cs = [[hw, hd], [hw, -hd], [-hw, -hd], [-hw, hd]];
  const pts = [];
  for (let s = 0; s < 4; s++) {
    const [ax, az] = cs[s];
    const [bx, bz] = cs[(s + 1) % 4];
    for (let i = 0; i < per; i++) {
      const t = i / per;
      const l = lift * Math.pow(Math.abs(2 * t - 1), 3);
      pts.push([cx + ax + (bx - ax) * t, y + l, cz + az + (bz - az) * t]);
    }
  }
  return pts;
}

/** Closed circle (ellipse) ring, counter-clockwise seen from above. */
export function circleRing(r, y, cx = 0, cz = 0, n = 8, rz = r, phase = 0) {
  const pts = [];
  for (let j = 0; j < n; j++) {
    const a = phase + (j / n) * PI * 2;
    pts.push([cx + r * Math.cos(a), y, cz - rz * Math.sin(a)]);
  }
  return pts;
}

/** Surface through a stack of rings (bottom to top, same point count, CCW from above). */
export function loft(rings, capTop = false) {
  const tris = [];
  const n = rings[0].length;
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i];
    const B = rings[i + 1];
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      tris.push([A[j], A[j1], B[j1]], [A[j], B[j1], B[j]]);
    }
  }
  if (capTop) {
    const R = rings[rings.length - 1];
    for (let j = 1; j < n - 1; j++) tris.push([R[0], R[j], R[j + 1]]);
  }
  return fromTris(tris);
}

/**
 * Hip-style roof surface: rings from the eaves (half sizes hw, hd at y) to the top
 * (half sizes tw, td at y + h). Inset follows u^pi, height u^py (py > 1: concave,
 * pi > 1: convex beehive). Corners of the eave ring rise by lift.
 */
export function hipLoft({ cx = 0, cz = 0, y, hw, hd, tw = 0, td = 0, h, steps = 3, pi = 1, py = 1, lift = 0, per = 1, cap = false }) {
  const rings = [];
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const f = Math.pow(u, pi);
    const yy = y + h * Math.pow(u, py);
    // the upturned eave corners fade out up the slope
    const l = lift * Math.pow(1 - u, 1.6);
    rings.push(rectRing(hw + (tw - hw) * f, hd + (td - hd) * f, yy, cx, cz, per, l));
  }
  // Each of the four slopes is its own smooth surface: a roof with curved
  // slopes and swept corners keeps a clean hip line where two slopes meet, and
  // the surface pattern (tile courses) runs one way across a whole slope.
  const n = rings[0].length;
  const parts = [];
  for (let side = 0; side < 4; side++) {
    const tris = [];
    for (let i = 0; i < rings.length - 1; i++) {
      const A = rings[i];
      const B = rings[i + 1];
      for (let q = 0; q < per; q++) {
        const j = side * per + q;
        const j1 = (j + 1) % n;
        tris.push([A[j], A[j1], B[j1]], [A[j], B[j1], B[j]]);
      }
    }
    const g = fromTris(tris);
    if (g.attributes.position.count) parts.push(soft(g, 55));
  }
  if (cap) {
    const R = rings[rings.length - 1];
    const tris = [];
    for (let j = 1; j < n - 1; j++) tris.push([R[0], R[j], R[j + 1]]);
    const g = fromTris(tris);
    if (g.attributes.position.count) parts.push(soft(g));
  }
  return mergeGeometries(parts, false);
}

// ---------------------------------------------------------------------------
// Kit: collects colored parts into buckets and merges them
// ---------------------------------------------------------------------------

/** Contact shading needs the height above a part's foot: stored / CONTACT_RANGE in aSurf.w (8 bits). */
export const CONTACT_RANGE = 2.5;

// HDR gains of glowing parts (linear color × gain): over ~1 they bloom. Flames
// stay moderate (tone mapping turns very bright orange pale), their cores hot.
export const GLOW = { flame: 1.35, core: 2.4, lamp: 2.1, paper: 1.7, halo: 1.9, rune: 1.7, portal: 2.3 };
// Doorways and windows: a dark interior (linear emissive) with warm light
// pooling at the floor (INTERIOR_FLOOR) and fading out well below the lintel
// (INTERIOR_DARK). The vertex color is what the unlit placement ghosts show.
export const INTERIOR_FLOOR = new THREE.Color(0.1, 0.04, 0.013);
export const INTERIOR_DARK = new THREE.Color(0.0025, 0.0018, 0.0015);
export const OPENING = made('#21180f', SURF.interior);

export class Kit {
  constructor(seed) {
    this.rng = new RNG(seed);
    this.parts = { base: [], body: [], team: [], glow: [] };
    this.count = 0;
  }

  /**
   * Add a part. Colors get a small per-triangle jitter; `anim` (team / glow)
   * maps a vertex to aAnim (wave or flicker amount, twinkle seed); `gain`
   * scales glowing colors into HDR. The part's surface comes from the color's
   * tag (see `made`), else a default per bucket.
   */
  add(bucket, g, color, jit = 0.035, anim = null, gain = 1) {
    const pos = g.attributes.position;
    const n = pos.count;
    const c = bucket === 'team' && typeof color === 'number' ? gray(color) : C(color);
    if (gain !== 1) c.multiplyScalar(gain);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 3) {
      const k = jit ? 1 + (this.rng.next() * 2 - 1) * jit : 1;
      for (let v = i; v < i + 3 && v < n; v++) {
        col[v * 3] = c.r * k;
        col[v * 3 + 1] = c.g * k;
        col[v * 3 + 2] = c.b * k;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (bucket === 'team' || bucket === 'glow') {
      const an = new Float32Array(n * 2);
      if (anim) {
        for (let v = 0; v < n; v++) {
          const a = anim(pos.getX(v), pos.getY(v), pos.getZ(v));
          an[v * 2] = a[0];
          an[v * 2 + 1] = a[1];
        }
      }
      g.setAttribute('aAnim', new THREE.BufferAttribute(an, 2));
    }
    // flat face normals unless the primitive kept smooth ones
    if (!g.attributes.normal) g.computeVertexNormals();
    this.surface(g, bucket, (color && color.surf) || (bucket === 'team' ? (anim ? SURF.cloth : SURF.paint) : bucket === 'base' ? SURF.stone : SURF.plain), !!anim);
    this.parts[bucket].push(g);
    return g;
  }

  /**
   * aSurf (normalized bytes): x roughness, y metalness, z class × 8 + a per-part
   * pattern offset, w the vertex's height above the part's foot (contact
   * shading; 1 = none for small, hanging or foundation parts).
   */
  surface(g, bucket, s, hanging) {
    const p = g.attributes.position;
    const n = p.count;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    let cls = s.cls;
    if (cls === CLS.WOOD) {
      // grain along the longest side; parts thinner than a plank are single beams
      const axis = dy >= Math.max(dx, dz) * 0.9 ? 0 : dx >= dz ? 1 : 2;
      const thin = axis === 0 ? Math.max(dx, dz) < 0.15 : axis === 1 ? Math.max(dy, dz) < 0.15 : Math.max(dx, dy) < 0.15;
      cls = (thin ? [CLS.BEAM_Y, CLS.BEAM_X, CLS.BEAM_Z] : [CLS.WOOD_Y, CLS.WOOD_X, CLS.WOOD_Z])[axis];
    }
    const id = this.count++;
    const code = cls * 8 + ((id * 5 + 3) & 7);
    // a little roughness variety between parts (stones, planks), rocks more
    const rj = (((id * 37 + 11) % 17) / 16 - 0.5) * (cls === CLS.ROCK ? 0.2 : 0.06);
    const rough = Math.round(clamp01(s.rough + rj) * 255);
    const metal = Math.round(clamp01(s.metal) * 255);
    const contact = bucket !== 'base' && bucket !== 'glow' && !hanging && dy >= 0.2;
    const a = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      a[i * 4] = rough;
      a[i * 4 + 1] = metal;
      a[i * 4 + 2] = code;
      a[i * 4 + 3] = contact ? Math.round(clamp01((p.getY(i) - y0) / CONTACT_RANGE) * 255) : 255;
    }
    g.setAttribute('aSurf', new THREE.BufferAttribute(a, 4, true));
  }

  /** Body part (lit, vertex colored). */
  b(g, color, jit = 0.035) {
    return this.add('body', g, color, jit);
  }

  /** Team-colored part; shade multiplies the team color. */
  t(g, shadeK = 1, anim = null) {
    return this.add('team', g, gray(shadeK), 0.02, anim);
  }

  /** Glowing (unlit) part; gain > 1 makes it bloom. */
  g(g, color, anim = null, gain = 1) {
    return this.add('glow', g, color, 0, anim, gain);
  }

  /**
   * Doorway / window opening from the floor (y0) to the lintel (y0 + h): a body
   * part of class INTERIOR (so it is clipped with the walls on a building site
   * and costs no extra draw call), unlit, with a faint warm light from inside.
   * aSurf.w holds the height in the opening (0 floor, 1 lintel) instead of the
   * contact height; the shader shapes the light from it.
   */
  hole(g, y0, h) {
    this.add('body', g, OPENING, 0);
    const p = g.attributes.position;
    const a = g.attributes.aSurf;
    for (let i = 0; i < p.count; i++) a.array[i * 4 + 3] = Math.round(clamp01((p.getY(i) - y0) / Math.max(h, 1e-3)) * 255);
    return g;
  }

  /** Foundation part. */
  f(g, color, jit = 0.04) {
    return this.add('base', g, color, jit);
  }

  rand(a = 0, b = 1) {
    return a + (b - a) * this.rng.next();
  }
}

export function finishKit(kit) {
  const out = { triangles: 0 };
  for (const name of BUCKETS) {
    const list = kit.parts[name];
    if (!list.length) {
      out[name] = null;
      continue;
    }
    // normals were set per part (flat, or smooth for round parts); ground
    // and contact shading happen per pixel in the shader
    const g = mergeGeometries(list, false);
    for (const p of list) p.dispose();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out[name] = g;
    out.triangles += g.attributes.position.count / 3;
  }
  return out;
}
