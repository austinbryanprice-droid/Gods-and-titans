// Procedural low-poly building models (DESIGN.md 4.7 and 8).
//
//   const m = buildBuildingModel('temple', pantheon, '#d63a3a', 1);
//   scene.add(m.root);   // origin = footprint center at ground level, +X east, +Z south
//   m.setProgress(bp);   // 0..1 construction: foundation + scaffolding, walls rising; 1 = complete
//   m.setTier(2);        // town centers: 1 Village, 2 Town, 3 City
//   m.animate(timeSec);  // flames, waving flags, the titan gate vortex
//   m.height             // top of the model (health bar placement)
//   m.dispose();         // detaches; cached geometry and shared materials stay
//
// Every building is merged into at most four vertex-colored buffers (stone
// foundation, body, team-colored parts, glowing parts), plus a scaffold while
// under construction and the titan gate's vortex: ≤ 6 meshes. Geometry is cached
// per (building, pantheon style + colors, tier). Team-colored parts store a gray
// shade that a shared per-team-color material multiplies.
//
// Styles (pantheon.style): roof drives the silhouette, wall the materials and
// ornament the signature details. All values of DESIGN 4.7 are supported.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, hashSeed } from '../../sim/rng.js';
import { BUILDINGS, GOLD_MINE } from '../../data/buildings.js';

/** Height of the foundation top above the model origin (ground level). */
export const PLINTH = 0.1;
const DEPTH = 0.65; // the foundation reaches this far below ground level
const MARGIN = 0.1; // free space between the model and its footprint edge
const PI = Math.PI;
const BUCKETS = ['base', 'body', 'team', 'glow'];

export const DEFAULT_STYLE = { roof: 'gable', wall: 'stone', ornament: 'banners' };
export const DEFAULT_COLORS = { wall: '#d8d0c0', roof: '#8a4a3a', trim: '#4a6a9a', accent: '#d4af37' };

// ---------------------------------------------------------------------------
// colors
// ---------------------------------------------------------------------------

const WHITE = new THREE.Color(1, 1, 1);
const C = (c) => (c instanceof THREE.Color ? c.clone() : new THREE.Color(c));
const mix = (a, b, t) => C(a).lerp(C(b), t);
const shade = (c, k) => C(c).multiplyScalar(k);
const tint = (c, t) => C(c).lerp(WHITE, t);
const gray = (v) => new THREE.Color(v, v, v);
function luma(c) {
  const s = C(c).convertLinearToSRGB();
  return 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// geometry primitives (non-indexed, position only; colors are added by Kit)
// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();

function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const key of Object.keys(n.attributes)) if (key !== 'position') n.deleteAttribute(key);
  n.morphAttributes = {};
  n.clearGroups();
  return n;
}

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

/** Cylinder standing on y. A flat side faces +Z when `flat` is set. */
export function cyl(rt, rb, h, seg = 6, x = 0, y = 0, z = 0, open = false, flat = false) {
  const g = prep(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
  g.translate(0, h / 2, 0);
  if (flat) g.rotateY(PI / seg);
  return g.translate(x, y, z);
}

/** Cone standing on y. */
export function cone(r, h, seg = 6, x = 0, y = 0, z = 0, open = false, flat = false) {
  const g = prep(new THREE.ConeGeometry(r, h, seg, 1, open));
  g.translate(0, h / 2, 0);
  if (flat) g.rotateY(PI / seg);
  return g.translate(x, y, z);
}

/** Sphere centered at (x, y, z), optionally squashed vertically. */
export function ball(r, x = 0, y = 0, z = 0, ws = 6, hs = 4, sy = 1) {
  const g = prep(new THREE.SphereGeometry(r, ws, hs));
  if (sy !== 1) g.scale(1, sy, 1);
  return g.translate(x, y, z);
}

/** Half sphere of radius r and height h standing on y. */
export function dome(r, h, x = 0, y = 0, z = 0, ws = 8, hs = 3) {
  const g = prep(new THREE.SphereGeometry(r, ws, hs, 0, PI * 2, 0, PI / 2));
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

function triArea2(a, b, c) {
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

/** Flip triangles whose normal points toward ref(centroid). */
function orient(tris, ref) {
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
function hipLoft({ cx = 0, cz = 0, y, hw, hd, tw = 0, td = 0, h, steps = 3, pi = 1, py = 1, lift = 0, per = 1, cap = false }) {
  const rings = [];
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const f = Math.pow(u, pi);
    const yy = y + h * Math.pow(u, py);
    const l = s === 0 ? lift : s === 1 ? lift * 0.2 : 0;
    rings.push(rectRing(hw + (tw - hw) * f, hd + (td - hd) * f, yy, cx, cz, per, l));
  }
  return loft(rings, cap);
}

// ---------------------------------------------------------------------------
// Kit: collects colored parts into buckets and merges them
// ---------------------------------------------------------------------------

class Kit {
  constructor(seed) {
    this.rng = new RNG(seed);
    this.parts = { base: [], body: [], team: [], glow: [] };
  }

  add(bucket, g, color, jit = 0.035, anim = null) {
    const pos = g.attributes.position;
    const n = pos.count;
    const c = bucket === 'team' && typeof color === 'number' ? gray(color) : C(color);
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
    this.parts[bucket].push(g);
    return g;
  }

  /** Body part (lit, vertex colored). */
  b(g, color, jit = 0.035) {
    return this.add('body', g, color, jit);
  }

  /** Team-colored part; shade multiplies the team color. */
  t(g, shadeK = 1, anim = null) {
    return this.add('team', g, gray(shadeK), 0.02, anim);
  }

  /** Glowing (unlit) part. */
  g(g, color, anim = null) {
    return this.add('glow', g, color, 0, anim);
  }

  /** Foundation part. */
  f(g, color, jit = 0.04) {
    return this.add('base', g, color, jit);
  }

  rand(a = 0, b = 1) {
    return a + (b - a) * this.rng.next();
  }
}

function finishKit(kit) {
  const out = { triangles: 0 };
  for (const name of BUCKETS) {
    const list = kit.parts[name];
    if (!list.length) {
      out[name] = null;
      continue;
    }
    const g = mergeGeometries(list, false);
    for (const p of list) p.dispose();
    if (name === 'body') applyGroundShade(g);
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out[name] = g;
    out.triangles += g.attributes.position.count / 3;
  }
  return out;
}

// Darken vertices near the ground a little (cheap ambient occlusion).
function applyGroundShade(g) {
  const p = g.attributes.position;
  const c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > 0.55) continue;
    const t = clamp01((y - PLINTH) / 0.45);
    const k = 0.8 + 0.2 * t * t * (3 - 2 * t);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
}

// ---------------------------------------------------------------------------
// materials (shared)
// ---------------------------------------------------------------------------

const TIME = { value: 0 };
const MATS = {};
const TEAM_MATS = new Map();
const VORTEX_MATS = new Map();

const WAVE_GLSL = `
if (aAnim.x > 0.0) {
  float wph = uTime * 3.6 + position.x * 6.5 + position.y * 2.3;
  transformed.z += sin(wph) * 0.055 * aAnim.x;
  transformed.y += cos(wph * 0.8) * 0.012 * aAnim.x;
}`;
const FLICKER_GLSL = `
if (aAnim.x > 0.0) {
  float fph = uTime * 9.0 + position.x * 17.0 + position.z * 13.0;
  transformed.x += sin(fph + position.y * 21.0) * 0.022 * aAnim.x;
  transformed.z += cos(fph * 1.13 + position.y * 17.0) * 0.022 * aAnim.x;
  transformed.y += (0.5 + 0.5 * sin(fph * 0.73)) * 0.06 * aAnim.x;
}`;
const TWINKLE_GLSL = `
#ifdef USE_COLOR
if (aAnim.y > 0.0) {
  float tw = sin(uTime * 2.3 + aAnim.y * 41.0);
  vColor.rgb *= 0.72 + 1.3 * pow(max(tw, 0.0), 10.0);
}
#endif`;

/** Patch a built-in material: animated vertices (team: waving, glow: flicker) and construction clipping. */
function patchShader(mat, anim, clip) {
  mat.onBeforeCompile = (sh) => {
    let vs = sh.vertexShader;
    let fs = sh.fragmentShader;
    let common = '';
    let begin = '';
    if (anim) {
      sh.uniforms.uTime = TIME;
      common += '\nattribute vec2 aAnim;\nuniform float uTime;';
      begin += anim === 'team' ? WAVE_GLSL : FLICKER_GLSL;
      if (anim === 'glow') vs = vs.replace('#include <color_vertex>', `#include <color_vertex>\n${TWINKLE_GLSL}`);
    }
    if (clip) {
      sh.uniforms.uCut = mat.userData.uCut;
      common += '\nvarying float vBldY;';
      begin += '\nvBldY = position.y;';
      fs = fs
        .replace('#include <common>', '#include <common>\nvarying float vBldY;\nuniform float uCut;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vBldY > uCut) discard;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb *= 0.45;');
    }
    vs = vs.replace('#include <common>', `#include <common>${common}`).replace('#include <begin_vertex>', `#include <begin_vertex>${begin}`);
    sh.vertexShader = vs;
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `mythicwar-bld-${anim || 'none'}-${clip ? 'clip' : 'full'}`;
  return mat;
}

function bodyMaterial() {
  if (!MATS.body) {
    MATS.body = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    MATS.body.name = 'building-body';
  }
  return MATS.body;
}

function glowMaterial() {
  if (!MATS.glow) {
    MATS.glow = patchShader(new THREE.MeshBasicMaterial({ vertexColors: true }), 'glow', false);
    MATS.glow.name = 'building-glow';
  }
  return MATS.glow;
}

function teamMaterial(teamColor) {
  const col = C(teamColor ?? '#888888');
  const key = col.getHexString();
  let m = TEAM_MATS.get(key);
  if (!m) {
    m = patchShader(new THREE.MeshLambertMaterial({ color: col, vertexColors: true, flatShading: true }), 'team', false);
    m.name = `building-team-${key}`;
    TEAM_MATS.set(key, m);
  }
  return m;
}

/** Per-model clone used while under construction (clips everything above uCut). */
function clipMaterial(base, anim) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: base.color, side: THREE.DoubleSide });
  m.userData.uCut = { value: 0 };
  m.name = `${base.name}-clip`;
  return patchShader(m, anim, true);
}

const VORTEX_VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const VORTEX_FS = `
uniform float uTime;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float arms = sin(a * 3.0 + log(r + 0.04) * 5.5 - uTime * 3.2);
  float arms2 = sin(a * 5.0 - log(r + 0.04) * 3.0 + uTime * 1.7);
  float band = smoothstep(-0.2, 0.9, arms) * 0.75 + smoothstep(0.3, 1.0, arms2) * 0.35;
  vec3 col = mix(uColC, uColB, band);
  col = mix(col, uColA, smoothstep(0.55, 0.0, r) * 0.9);
  col += vec3(1.0) * pow(max(0.0, 1.0 - r * 2.4), 2.0);
  float edge = smoothstep(1.0, 0.82, r);
  float rim = smoothstep(0.78, 0.95, r) * edge;
  col += uColB * rim * 0.8;
  gl_FragColor = vec4(col * edge, edge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function vortexMaterial(colA, colB, colC) {
  const key = `${C(colA).getHexString()}${C(colB).getHexString()}${C(colC).getHexString()}`;
  let m = VORTEX_MATS.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { uTime: TIME, uColA: { value: C(colA) }, uColB: { value: C(colB) }, uColC: { value: C(colC) } },
      vertexShader: VORTEX_VS,
      fragmentShader: VORTEX_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    m.name = `building-vortex-${key}`;
    VORTEX_MATS.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// palette
// ---------------------------------------------------------------------------

const STONE_BY_WALL = { marble: '#ddd7ca', timber: '#8e8a80', mudbrick: '#9a7656', brick: '#958a7e', lacquer: '#8e8c86' };
const YARD_BY_WALL = {
  marble: '#b5ad99', sandstone: '#bb9d6c', stone: '#837c6f', mudbrick: '#a27f58',
  timber: '#6f5f45', brick: '#8a7a64', lacquer: '#948e83',
};

function makePalette(colors, st) {
  const wall = C(colors.wall);
  const roof = C(colors.roof);
  const trim = C(colors.trim);
  const accent = C(colors.accent);
  let stone;
  if (STONE_BY_WALL[st.wall]) stone = C(STONE_BY_WALL[st.wall]);
  else if (st.wall === 'sandstone') stone = mix(wall, '#b39566', 0.35);
  else stone = shade(wall, 0.88);
  const lightTrim = luma(trim) > 0.62;
  return {
    wall, wallD: shade(wall, 0.76), wallL: tint(wall, 0.22),
    roof, roofD: shade(roof, 0.68), roofL: tint(roof, 0.2),
    trim, trimD: shade(trim, 0.72), trimL: tint(trim, 0.3),
    accent, accentD: shade(accent, 0.7),
    stone, stoneD: shade(stone, 0.74), stoneL: tint(stone, 0.18),
    infill: lightTrim ? C(colors.trim) : mix(wall, '#2a1410', 0.3),
    beam: lightTrim ? shade(wall, 0.9) : trim,
    yard: C(YARD_BY_WALL[st.wall] || '#8d877a'),
    wood: C('#7b5536'), woodD: C('#4d3421'), woodL: C('#a27c54'),
    dark: C('#21180f'), metal: C('#8c949b'), cloth: C('#d6cbb0'), white: C('#f2ede2'),
    straw: C('#c9a35a'), leaf: C('#4f7a36'), sack: C('#bfa57a'),
    fire: C('#ff8a1e'), fireHot: C('#ffe07a'), lantern: C('#ff5a2a'),
    gold: C('#f3c63c'),
  };
}

// ---------------------------------------------------------------------------
// team pieces
// ---------------------------------------------------------------------------

/** Flag on a pole: pole foot at (x, y, z); the cloth flies toward the model's center line (dir ±1 along X). */
function flag(k, P, x, y, z, poleH, fw = 0.4, fh = 0.24, dir = x > 0.001 ? -1 : 1) {
  k.b(cyl(0.016, 0.022, poleH, 4, x, y, z, true), P.woodD, 0);
  k.b(octa(0.035, x, y + poleH + 0.02, z), P.accent, 0);
  const g = prep(new THREE.BoxGeometry(fw, fh, 0.016, 2, 1, 1));
  g.translate(x + dir * (fw / 2 + 0.01), y + poleH - fh / 2 - 0.02, z);
  k.t(g, 1, (vx) => [clamp01(Math.abs(vx - x) / fw), 0]);
}

/** Tall vertical banner on a pole with a crossbar (nobori / war banner), hanging toward the center line. */
function standard(k, P, x, y, z, h, bw = 0.2, bh = 0.6, dir = x > 0.001 ? -1 : 1) {
  k.b(cyl(0.017, 0.022, h, 4, x, y, z, true), P.woodD, 0);
  k.b(box(bw + 0.05, 0.025, 0.025, x + dir * (bw / 2 + 0.01), y + h - 0.06, z), P.woodD, 0);
  k.b(octa(0.035, x, y + h + 0.02, z), P.accent, 0);
  const g = prep(new THREE.BoxGeometry(bw, bh, 0.016, 1, 3, 1));
  const top = y + h - 0.07;
  g.translate(x + dir * (bw / 2 + 0.02), top - bh / 2, z);
  k.t(g, 1, (vx, vy) => [clamp01((top - vy) / bh) * 0.55, 0]);
}

/** Cloth banner hanging on a wall face that looks south (+Z). */
function banner(k, P, x, yTop, zFace, w, h) {
  k.b(box(w + 0.06, 0.03, 0.03, x, yTop, zFace + 0.03), P.woodD, 0);
  const g = prep(new THREE.BoxGeometry(w, h, 0.02, 1, 2, 1));
  g.translate(x, yTop - h / 2, zFace + 0.025);
  k.t(g, 1, (vx, vy) => [clamp01((yTop - vy) / h) * 0.25, 0]);
  // pointed tail in a darker shade
  const tail = fromTris([
    [[x + w / 2, yTop - h, zFace + 0.035], [x - w / 2, yTop - h, zFace + 0.035], [x, yTop - h - w * 0.45, zFace + 0.035]],
  ]);
  k.t(tail, 0.75);
  k.b(box(w * 0.5, w * 0.5, 0.02, x, yTop - h * 0.45, zFace + 0.03), P.accent, 0);
}

/** Round shield on a south-facing wall. */
function shield(k, P, x, y, zFace, r) {
  const g = cyl(r, r, 0.03, 8, 0, 0, 0);
  g.rotateX(PI / 2);
  g.translate(x, y, zFace + 0.02);
  k.t(g, 1);
  k.b(ball(r * 0.28, x, y, zFace + 0.04, 5, 3), P.accent, 0);
}

// ---------------------------------------------------------------------------
// small props
// ---------------------------------------------------------------------------

function crate(k, P, x, y, z, s, ry = 0) {
  k.b(box(s, s, s, x, y, z, ry), P.woodL, 0.08);
  k.b(box(s * 1.04, s * 0.14, s * 1.04, x, y + s * 0.43, z, ry), P.woodD, 0.05);
}

function barrel(k, P, x, y, z, s) {
  k.b(cyl(s * 0.42, s * 0.4, s, 6, x, y, z), P.wood, 0.06);
  k.b(cyl(s * 0.44, s * 0.44, s * 0.08, 6, x, y + s * 0.62, z, true), P.woodD, 0);
}

function sack(k, P, x, y, z, s, color) {
  k.b(dodeca(s * 0.5, x, y + s * 0.38, z).scale(1, 1, 1), color ?? P.sack, 0.1);
}

function logPile(k, P, x, y, z, len, ry = 0) {
  const rows = [[-0.12, 0], [0, 0], [0.12, 0], [-0.06, 0.1], [0.06, 0.1]];
  for (const [ox, oy] of rows) {
    const g = cyl(0.06, 0.06, len, 5, 0, -len / 2, 0, false);
    g.rotateZ(PI / 2);
    g.translate(0, 0.06 + oy, ox);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    k.b(g, P.wood, 0.1);
  }
}

function goldPile(k, P, x, y, z, s) {
  k.b(cone(s * 0.5, s * 0.45, 6, x, y, z), P.gold, 0.12);
  k.b(box(s * 0.36, s * 0.12, s * 0.2, x + s * 0.4, y, z + s * 0.25, 0.4), P.gold, 0.05);
}

/** Flames (glowing, flickering) rising from y with height fh. */
function flames(k, P, x, y, z, s) {
  const fh = 0.34 * s;
  k.g(cone(0.13 * s, fh, 5, x, y, z, true), P.fire, (vx, vy) => [clamp01((vy - y) / fh), 0]);
  k.g(cone(0.08 * s, fh * 0.72, 4, x + 0.02 * s, y, z + 0.02 * s, true), P.fireHot, (vx, vy) => [clamp01((vy - y) / fh), 0]);
}

/** Brazier on a short stand with a sacred flame. */
function brazier(k, P, x, y, z, s = 1, standH = 0.3) {
  k.b(cyl(0.035 * s, 0.06 * s, standH * s, 5, x, y, z), P.metal, 0.04);
  k.b(cyl(0.15 * s, 0.07 * s, 0.1 * s, 6, x, y + standH * s, z), P.accentD, 0.04);
  flames(k, P, x, y + (standH + 0.07) * s, z, s);
  return y + (standH + 0.4) * s;
}

/** Fire pit ringed with stones. */
function firePit(k, P, x, y, z, s = 1) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    k.b(dodeca(0.06 * s, x + Math.cos(a) * 0.15 * s, y + 0.03 * s, z + Math.sin(a) * 0.15 * s), P.stoneD, 0.1);
  }
  flames(k, P, x, y, z, s * 0.9);
}

/** Golden idol: a stylized god statue on a pedestal, facing south. */
function idol(k, P, x, y, z, s = 1, head = 'halo') {
  k.b(box(0.3 * s, 0.22 * s, 0.26 * s, x, y, z), P.stone, 0.04);
  const by = y + 0.22 * s;
  const gold = P.accent;
  k.b(frustum(0.2 * s, 0.32 * s, 0.13 * s, 0.75, x, by, z), gold, 0.05);
  k.b(frustum(0.16 * s, 0.18 * s, 0.11 * s, 1.25, x, by + 0.3 * s, z), gold, 0.05);
  k.b(ball(0.065 * s, x, by + 0.55 * s, z, 6, 4), gold, 0.03);
  k.b(strut([x - 0.09 * s, by + 0.44 * s, z], [x - 0.16 * s, by + 0.62 * s, z + 0.03 * s], 0.04 * s), gold, 0.03);
  k.b(strut([x + 0.09 * s, by + 0.44 * s, z], [x + 0.14 * s, by + 0.28 * s, z + 0.06 * s], 0.04 * s), gold, 0.03);
  if (head === 'halo') {
    const halo = torus(0.11 * s, 0.014 * s, x, by + 0.57 * s, z - 0.03 * s, 3, 10);
    k.g(halo, tint(P.accent, 0.35));
  }
  return by + 0.7 * s;
}

/** Stone platform with `steps` stacked slabs; returns the top height. */
function steps(k, P, w, d, y, n, stepH, inset, color, x = 0, z = 0) {
  let yy = y;
  for (let i = 0; i < n; i++) {
    const ww = w - i * inset * 2;
    const dd = d - i * inset * 2;
    k.b(box(ww, stepH, dd, x, yy, z), i % 2 ? shade(color, 1.06) : color, 0.03);
    yy += stepH;
  }
  return yy;
}

/** Wooden or stone stairway ramp rising toward -Z (front foot at zFront). */
function stair(k, P, x, y0, y1, zFront, zBack, w, color) {
  const n = Math.max(2, Math.round((y1 - y0) / 0.09));
  const run = (zFront - zBack) / n;
  for (let i = 0; i < n; i++) {
    const h = ((i + 1) * (y1 - y0)) / n;
    k.b(box(w, h, run + 0.001, x, y0, zFront - run * (i + 0.5)), i % 2 ? color : shade(color, 0.92), 0.02);
  }
}

// ---------------------------------------------------------------------------
// ornament pieces
// ---------------------------------------------------------------------------

/** Classical column: base, shaft, capital. */
function column(k, P, x, y, z, h, r, color = P.wallL) {
  k.b(box(r * 2.5, 0.05, r * 2.5, x, y, z), color, 0.02);
  k.b(cyl(r * 0.88, r, h - 0.11, 6, x, y + 0.05, z, true), color, 0.03);
  k.b(box(r * 2.7, 0.06, r * 2.7, x, y + h - 0.06, z), color, 0.02);
}

function obelisk(k, P, x, y, z, h) {
  const w = h * 0.13;
  k.b(box(w * 1.7, h * 0.07, w * 1.7, x, y, z), P.stoneD, 0.03);
  k.b(frustum(w, h * 0.82, w, 0.62, x, y + h * 0.07, z), P.wall, 0.03);
  k.b(cone(w * 0.44, h * 0.13, 4, x, y + h * 0.89, z, true, true), P.accent, 0);
  k.b(box(w * 0.5, h * 0.4, 0.01, x, y + h * 0.3, z + w * 0.42), P.trimD, 0);
}

/** Carved wooden post topped with a beast head facing south. */
function carvedPost(k, P, x, y, z, h) {
  const w = h * 0.12;
  k.b(box(w, h * 0.78, w, x, y, z), P.wood, 0.06);
  for (let i = 0; i < 3; i++) k.b(box(w * 1.25, h * 0.06, w * 1.25, x, y + h * (0.18 + i * 0.2), z), i % 2 ? P.accent : P.trim, 0.03);
  const hy = y + h * 0.78;
  k.b(box(w * 1.2, h * 0.16, w * 1.3, x, hy, z), P.trim, 0.05);
  k.b(box(w * 0.9, h * 0.07, w * 1.0, x, hy + h * 0.02, z + w * 0.9), P.trim, 0.05);
  k.b(cone(w * 0.25, h * 0.12, 4, x - w * 0.4, hy + h * 0.15, z), P.accent, 0);
  k.b(cone(w * 0.25, h * 0.12, 4, x + w * 0.4, hy + h * 0.15, z), P.accent, 0);
  k.b(box(w * 0.22, w * 0.22, 0.02, x - w * 0.3, hy + h * 0.1, z + w * 0.66), P.accent, 0);
  k.b(box(w * 0.22, w * 0.22, 0.02, x + w * 0.3, hy + h * 0.1, z + w * 0.66), P.accent, 0);
}

/** Stone lamp pillar (deepastambha) ringed with small flames. */
function lampPillar(k, P, x, y, z, h) {
  k.b(box(h * 0.22, h * 0.08, h * 0.22, x, y, z), P.stoneD, 0.04);
  k.b(cyl(h * 0.05, h * 0.075, h * 0.82, 6, x, y + h * 0.08, z, true), P.stone, 0.04);
  for (let i = 0; i < 2; i++) {
    const yy = y + h * (0.36 + i * 0.26);
    const r = h * (0.14 - i * 0.035);
    k.b(cyl(r, r * 0.8, h * 0.03, 6, x, yy, z), P.accentD, 0.03);
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * PI * 2 + i * 0.4;
      k.g(cone(h * 0.025, h * 0.07, 3, x + Math.cos(a) * r * 0.85, yy + h * 0.03, z + Math.sin(a) * r * 0.85, true), P.fireHot);
    }
  }
  k.b(cone(h * 0.07, h * 0.12, 6, x, y + h * 0.9, z), P.accent, 0);
  flames(k, P, x, y + h * 1.0, z, h * 0.35);
}

/** Torii gate spanning `span` at z, facing south. */
function torii(k, P, cx, y, z, span, h) {
  const r = 0.035 + span * 0.025;
  const red = luma(P.wall) > 0.25 && P.wall.r > P.wall.g * 1.3 ? P.wall : C('#d8462c');
  for (const sx of [-1, 1]) {
    k.b(cyl(r * 0.9, r, h, 6, cx + (sx * span) / 2, y, z, true), red, 0.03);
    k.b(cyl(r * 1.25, r * 1.25, 0.06, 6, cx + (sx * span) / 2, y, z), P.dark, 0);
  }
  // kasagi: gently curved top beam with upturned ends
  const L = span / 2 + 0.22;
  const pts = [];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const px = -L + 2 * L * t;
    pts.push([px, 0.05 * Math.pow(Math.abs(2 * t - 1), 2.5)]);
  }
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    const px = -L * 1.04 + 2 * L * 1.04 * t;
    pts.push([px, 0.11 + 0.08 * Math.pow(Math.abs(2 * t - 1), 2.5)]);
  }
  const kasagi = extrude(pts, r * 2.6);
  kasagi.translate(cx, y + h - 0.02, z);
  k.b(kasagi, P.roofD.r + P.roofD.g + P.roofD.b < 0.3 ? P.roofD : C('#2a2a2e'), 0.02);
  k.b(box(span + 0.16, 0.06, r * 1.6, cx, y + h * 0.78, z), red, 0.02);
  k.b(box(0.06, h * 0.2, r * 1.4, cx, y + h * 0.8, z), red, 0.02);
  return y + h + 0.17;
}

/** Stone lantern (toro). */
function stoneLantern(k, P, x, y, z, h) {
  k.b(cyl(h * 0.12, h * 0.16, h * 0.12, 6, x, y, z), P.stoneD, 0.04);
  k.b(cyl(h * 0.05, h * 0.06, h * 0.38, 6, x, y + h * 0.12, z), P.stone, 0.04);
  k.b(box(h * 0.24, h * 0.06, h * 0.24, x, y + h * 0.5, z), P.stone, 0.03);
  k.g(box(h * 0.15, h * 0.16, h * 0.15, x, y + h * 0.56, z), P.fireHot);
  k.b(cone(h * 0.22, h * 0.16, 4, x, y + h * 0.72, z, true, true), P.stoneD, 0.03);
  k.b(ball(h * 0.04, x, y + h * 0.9, z, 4, 3), P.stone, 0);
}

/** Post with an arm and a hanging red paper lantern. */
function lanternPost(k, P, x, y, z, h, dir = 1) {
  k.b(cyl(0.02, 0.026, h, 4, x, y, z, true), P.wall, 0.03);
  k.b(box(0.22, 0.03, 0.03, x + dir * 0.09, y + h - 0.04, z), P.woodD, 0);
  hangingLantern(k, P, x + dir * 0.17, y + h - 0.05, z, 0.11);
}

function hangingLantern(k, P, x, yTop, z, s) {
  k.g(ball(s * 0.5, x, yTop - s * 0.65, z, 6, 4, 1.25), P.lantern);
  k.b(cyl(s * 0.28, s * 0.28, s * 0.08, 5, x, yTop - s * 0.18, z), P.dark, 0);
  k.b(cyl(s * 0.28, s * 0.28, s * 0.08, 5, x, yTop - s * 1.3, z), P.dark, 0);
  k.b(cyl(s * 0.03, s * 0.03, s * 0.3, 3, x, yTop - s * 1.6, z, true), P.accent, 0);
}

/** Feathered serpent head at ground level facing south. */
function serpentHead(k, P, x, y, z, s) {
  const c = P.trim;
  k.b(box(0.3 * s, 0.24 * s, 0.38 * s, x, y, z), P.stone, 0.06);
  k.b(box(0.26 * s, 0.14 * s, 0.22 * s, x, y + 0.08 * s, z + 0.24 * s), c, 0.05);
  k.b(box(0.24 * s, 0.06 * s, 0.2 * s, x, y + 0.01 * s, z + 0.25 * s), c, 0.05);
  k.b(box(0.2 * s, 0.03 * s, 0.03 * s, x, y + 0.07 * s, z + 0.35 * s), P.white, 0);
  for (const sx of [-1, 1]) {
    k.b(box(0.05 * s, 0.05 * s, 0.05 * s, x + sx * 0.1 * s, y + 0.2 * s, z + 0.27 * s), P.accent, 0);
    k.b(strut([x + sx * 0.12 * s, y + 0.2 * s, z - 0.1 * s], [x + sx * 0.2 * s, y + 0.42 * s, z - 0.15 * s], 0.06 * s, 0.03 * s), P.accent, 0.05);
  }
  k.b(strut([x, y + 0.22 * s, z - 0.1 * s], [x, y + 0.45 * s, z - 0.18 * s], 0.06 * s, 0.03 * s), c, 0.05);
}

/** Standing stone with a carved knot disc. */
function standingStone(k, P, x, y, z, h, ry = 0) {
  const g = frustum(0.24 * (h / 0.85), h, 0.15 * (h / 0.85), 0.72, 0, 0, 0, 0.8);
  const p = g.attributes.position;
  const rr = new RNG(hashSeed(`${x.toFixed(2)},${z.toFixed(2)}`));
  for (let i = 0; i < p.count; i++) if (p.getY(i) > h * 0.5) p.setY(i, p.getY(i) + (rr.next() - 0.5) * 0.08);
  g.rotateY(ry);
  g.translate(x, y, z);
  k.b(g, P.stone, 0.1);
  const disc = torus(0.055 * (h / 0.85), 0.012, 0, 0, 0, 3, 8);
  disc.rotateY(ry);
  const fx = Math.sin(ry) * 0.08 * (h / 0.85);
  const fz = Math.cos(ry) * 0.08 * (h / 0.85);
  disc.translate(x + fx, y + h * 0.62, z + fz);
  k.b(disc, P.accent, 0);
}

/** Lamassu: winged human-headed bull guardian facing south. */
function lamassu(k, P, x, y, z, s) {
  const c = P.stoneL;
  k.b(box(0.32 * s, 0.1 * s, 0.56 * s, x, y, z), P.stoneD, 0.04);
  const by = y + 0.1 * s;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(box(0.08 * s, 0.22 * s, 0.08 * s, x + sx * 0.09 * s, by, z + sz * 0.18 * s), c, 0.04);
  k.b(box(0.26 * s, 0.2 * s, 0.5 * s, x, by + 0.2 * s, z), c, 0.04);
  k.b(box(0.18 * s, 0.2 * s, 0.16 * s, x, by + 0.34 * s, z + 0.27 * s), c, 0.04);
  k.b(frustum(0.16 * s, 0.14 * s, 0.06 * s, 0.6, x, by + 0.22 * s, z + 0.36 * s), P.dark, 0.05);
  k.b(cyl(0.08 * s, 0.07 * s, 0.13 * s, 6, x, by + 0.54 * s, z + 0.27 * s), P.accent, 0.02);
  for (const sx of [-1, 1]) {
    const wx = x + sx * 0.14 * s;
    const a = [wx, by + 0.3 * s, z + 0.18 * s];
    const b = [wx, by + 0.3 * s, z - 0.25 * s];
    const c = [wx, by + 0.62 * s, z - 0.28 * s];
    const d = [wx, by + 0.5 * s, z + 0.1 * s];
    k.b(fromTris([[a, b, c], [a, c, d], [a, c, b], [a, d, c]]), P.accentD, 0.08);
  }
}

/** Mudbrick pinnacle with wooden spikes and an ostrich-egg finial. */
function pinnacle(k, P, x, y, z, h, w = 0.22) {
  k.b(frustum(w, h, w, 0.55, x, y, z), P.wall, 0.05);
  k.b(cone(w * 0.32, h * 0.22, 6, x, y + h, z), P.wall, 0.04);
  k.b(ball(w * 0.15, x, y + h + h * 0.22, z, 5, 4, 1.3), P.white, 0);
  for (let i = 0; i < 2; i++) {
    const yy = y + h * (0.35 + i * 0.3);
    const ww = w * (1 - 0.45 * (0.35 + i * 0.3)) * 0.5;
    k.b(box(0.03, 0.03, 0.16, x, yy, z + ww), P.woodD, 0);
    k.b(box(0.16, 0.03, 0.03, x + ww * (i ? -1 : 1), yy, z), P.woodD, 0);
  }
}

/** One ornament item of the pantheon's kind at (x, z), scaled by s. */
function ornament(k, P, st, x, y, z, s, side = 1) {
  switch (st.ornament) {
    case 'columns':
      column(k, P, x, y, z, 0.85 * s, 0.07 * s);
      k.b(ball(0.06 * s, x, y + 0.9 * s, z, 6, 3, 1.2), P.accent, 0);
      break;
    case 'carvings':
      if (st.wall === 'timber') carvedPost(k, P, x, y, z, 0.9 * s);
      else lampPillar(k, P, x, y, z, 0.95 * s);
      break;
    case 'obelisks':
      obelisk(k, P, x, y, z, 1.15 * s);
      break;
    case 'torii':
      stoneLantern(k, P, x, y, z, 0.62 * s);
      break;
    case 'lanterns':
      lanternPost(k, P, x, y, z, 0.75 * s, -side);
      break;
    case 'serpents':
      serpentHead(k, P, x, y, z, 0.85 * s);
      break;
    case 'knots':
      standingStone(k, P, x, y, z, 0.85 * s, side * 0.2);
      break;
    case 'winged_bulls':
      lamassu(k, P, x, y, z, 0.95 * s);
      break;
    case 'spikes':
      pinnacle(k, P, x, y, z, 0.85 * s, 0.2 * s);
      break;
    case 'banners':
    default:
      standard(k, P, x, y, z, 1.1 * s, 0.18 * s, 0.5 * s);
      break;
  }
}

/** A matching pair of ornaments flanking an entrance (torii spans the gap instead). */
function ornamentPair(k, P, st, x, y, z, s) {
  if (st.ornament === 'torii') return torii(k, P, 0, y, z, x * 2, 0.95 * s);
  ornament(k, P, st, -x, y, z, s, -1);
  ornament(k, P, st, x, y, z, s, 1);
  return y + s;
}

// ---------------------------------------------------------------------------
// walls
// ---------------------------------------------------------------------------

const isRound = (st) => st.roof === 'thatch_cone' || st.roof === 'dome';

function door(k, P, st, x, y, fz, w, h) {
  const frame = st.wall === 'timber' ? P.woodD : st.wall === 'lacquer' ? P.beam : P.trim;
  k.b(box(w + 0.1, h + 0.06, 0.05, x, y, fz + 0.005), frame, 0.03);
  k.b(box(w, h, 0.06, x, y, fz + 0.012), P.dark, 0);
  if (st.wall === 'mudbrick' || st.wall === 'sandstone') k.b(box(w + 0.14, 0.05, 0.07, x, y + h + 0.06, fz + 0.01), P.wallD, 0.03);
}

function windowHole(k, P, x, y, fz, w = 0.12, h = 0.16) {
  k.b(box(w + 0.05, h + 0.05, 0.03, x, y - 0.025, fz + 0.004), P.wallD, 0);
  k.b(box(w, h, 0.04, x, y, fz + 0.008), P.dark, 0);
}

/** Wooden spikes (toron) protruding from a south and side walls. */
function torons(k, P, x, z, w, d, y, h) {
  const rows = h > 0.75 ? 2 : 1;
  for (let r = 0; r < rows; r++) {
    const yy = y + h * (rows === 1 ? 0.62 : 0.38 + r * 0.38);
    const nf = Math.max(2, Math.round(w / 0.4));
    for (let i = 0; i < nf; i++) {
      const px = x - w / 2 + (w * (i + 0.5)) / nf;
      k.b(pole([px, yy, z + d / 2 - 0.02], [px, yy - 0.01, z + d / 2 + 0.12], 0.016, 3), P.woodD, 0);
    }
    const ns = Math.max(1, Math.round(d / 0.45));
    for (const sx of [-1, 1]) {
      for (let i = 0; i < ns; i++) {
        const pz = z - d / 2 + (d * (i + 0.5)) / ns;
        k.b(pole([x + (sx * w) / 2 - sx * 0.02, yy, pz], [x + sx * (w / 2 + 0.12), yy - 0.01, pz], 0.016, 3), P.woodD, 0);
      }
    }
  }
}

/** Carved frieze along the top of the south face. */
function frieze(k, P, x, fz, w, y) {
  k.b(box(w, 0.07, 0.03, x, y, fz + 0.01), P.trim, 0.03);
  const n = Math.max(2, Math.round(w / 0.24));
  for (let i = 0; i < n; i++) {
    const px = x - w / 2 + (w * (i + 0.5)) / n;
    k.b(box(0.07, 0.05, 0.03, px, y + 0.01, fz + 0.025), P.accent, 0.04);
  }
}

/** Rectangular walls in the pantheon's wall material, with door and windows on the south face. */
function rectWalls(k, P, st, o) {
  const { x = 0, z = 0, w, d, y = PLINTH, h } = o;
  const fz = z + d / 2;
  let face = fz;
  switch (st.wall) {
    case 'timber': {
      k.b(box(w + 0.05, 0.08, d + 0.05, x, y, z), P.stone, 0.1);
      k.b(box(w, h - 0.08, d, x, y + 0.08, z), P.wall, 0.07);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(box(0.08, h, 0.08, x + (sx * w) / 2, y, z + (sz * d) / 2), P.woodD, 0.03);
      k.b(box(w + 0.07, 0.07, d + 0.07, x, y + h - 0.07, z), P.woodD, 0.03);
      const n = Math.max(1, Math.round(w / 0.3));
      for (let i = 1; i < n; i++) k.b(box(0.022, h - 0.16, 0.02, x - w / 2 + (w * i) / n, y + 0.08, fz), P.woodD, 0);
      break;
    }
    case 'marble':
      k.b(box(w + 0.08, 0.06, d + 0.08, x, y, z), P.stoneL, 0.02);
      k.b(box(w, h, d, x, y, z), P.wall, 0.025);
      k.b(box(w + 0.06, 0.1, d + 0.06, x, y + h - 0.1, z), P.wallL, 0.02);
      k.b(box(w + 0.075, 0.035, d + 0.075, x, y + h - 0.07, z), P.trim, 0.02);
      break;
    case 'sandstone':
      k.b(box(w + 0.06, 0.06, d + 0.06, x, y, z), P.wallD, 0.03);
      k.b(frustum(w, h, d, 0.94, x, y, z), P.wall, 0.04);
      k.b(box(w * 0.94 + 0.09, 0.08, d * 0.94 + 0.09, x, y + h - 0.06, z), P.trim, 0.02);
      k.b(box(w * 0.94 + 0.03, 0.025, d * 0.94 + 0.03, x, y + h - 0.1, z), P.accent, 0.02);
      face = z + (d / 2) * 0.97;
      break;
    case 'mudbrick':
      k.b(box(w + 0.12, 0.12, d + 0.12, x, y, z), P.wallD, 0.04);
      k.b(frustum(w + 0.04, h, d + 0.04, 0.92, x, y, z), P.wall, 0.05);
      k.b(frustum(w * 0.92 + 0.02, 0.07, d * 0.92 + 0.02, 0.9, x, y + h, z), P.wallL, 0.04);
      face = z + (d / 2) * 0.97;
      break;
    case 'brick':
      k.b(box(w, h, d, x, y, z), P.wall, 0.05);
      for (let i = 1; i <= 2; i++) k.b(box(w + 0.02, 0.025, d + 0.02, x, y + (i * h) / 3, z), P.wallD, 0);
      k.b(box(w + 0.06, 0.06, d + 0.06, x, y + h - 0.06, z), P.trim, 0.02);
      break;
    case 'lacquer': {
      k.b(box(w + 0.08, 0.09, d + 0.08, x, y, z), P.stone, 0.06);
      k.b(box(w - 0.04, h - 0.09, d - 0.04, x, y + 0.09, z), P.infill, 0.03);
      const n = Math.max(2, Math.round(w / 0.55) + 1);
      for (let i = 0; i < n; i++) {
        const px = x - w / 2 + (w * i) / (n - 1);
        k.b(box(0.08, h - 0.09, 0.08, px, y + 0.09, fz - 0.02), P.wall, 0.03);
        k.b(box(0.08, h - 0.09, 0.08, px, y + 0.09, z - d / 2 + 0.02), P.wall, 0.03);
      }
      k.b(box(w + 0.04, 0.08, d + 0.04, x, y + h - 0.08, z), P.wall, 0.02);
      k.b(box(w + 0.1, 0.05, d + 0.1, x, y + h - 0.02, z), P.beam, 0.02);
      break;
    }
    case 'stone':
    default: {
      k.b(box(w + 0.06, 0.1, d + 0.06, x, y, z), P.stoneD, 0.08);
      k.b(box(w, h, d, x, y, z), P.wall, 0.08);
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const qy = y + 0.12 + (i * (h - 0.22)) / 3;
          k.b(box(0.1 + (i % 2) * 0.06, 0.1, 0.05, x + sx * (w / 2 - 0.04 - (i % 2) * 0.03), qy, fz + 0.004), P.wallL, 0.03);
        }
      }
      k.b(box(w + 0.04, 0.05, d + 0.04, x, y + h - 0.05, z), P.wallD, 0.04);
      break;
    }
  }
  if (o.door !== false) {
    const dw = o.doorW ?? Math.min(0.32, w * 0.24);
    const dh = o.doorH ?? Math.min(h * 0.62, 0.5);
    door(k, P, st, x, y, face, dw, dh);
  }
  const nw = o.windows ?? 0;
  if (nw > 0) {
    const wy = y + h * 0.55;
    for (const sx of [-1, 1]) windowHole(k, P, x + sx * w * 0.3, wy, face);
    if (nw > 1 && d > 0.7) {
      for (const sx of [-1, 1]) {
        const g = box(0.04, 0.16, 0.12, x + sx * (w / 2 + 0.005), wy, z);
        k.b(g, P.dark, 0);
      }
    }
  }
  if (st.ornament === 'spikes') torons(k, P, x, z, w, d, y, h);
  if (st.ornament === 'carvings' && st.wall !== 'timber') frieze(k, P, x, face, w * 0.9, y + h - 0.2);
  if (st.ornament === 'carvings' && st.wall === 'timber') {
    for (const sx of [-1, 1]) carvedBoard(k, P, x + sx * (o.doorW ?? Math.min(0.32, w * 0.24)) * 0.5 + sx * 0.08, y, face, Math.min(h * 0.72, 0.6));
  }
}

/** Carved door-side board for timber halls. */
function carvedBoard(k, P, x, y, fz, h) {
  k.b(box(0.07, h, 0.04, x, y, fz + 0.02), P.trim, 0.04);
  for (let i = 0; i < 3; i++) k.b(box(0.09, 0.04, 0.05, x, y + h * (0.25 + i * 0.27), fz + 0.025), P.accent, 0);
}

/** Round walls (a flat face looks south) in the wall material. */
function roundWalls(k, P, st, o) {
  const { x = 0, z = 0, r, y = PLINTH, h } = o;
  const seg = o.seg ?? 10;
  const taper = st.wall === 'mudbrick' || st.wall === 'sandstone' ? 0.9 : 1;
  k.b(cyl(r + 0.05, r + 0.07, 0.09, seg, x, y, z, true, true), st.wall === 'mudbrick' ? P.wallD : P.stoneD, 0.08);
  k.b(cyl(r * taper, r, h, seg, x, y, z, true, true), P.wall, st.wall === 'stone' ? 0.1 : 0.05);
  if (st.wall === 'timber' || st.wall === 'lacquer') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + PI / 6;
      k.b(box(0.07, h, 0.07, x + Math.sin(a) * r, y, z + Math.cos(a) * r, a), st.wall === 'lacquer' ? P.wall : P.woodD, 0.03);
    }
  }
  const face = z + r * Math.cos(PI / seg) * (taper < 1 ? 0.97 : 1);
  if (o.door !== false) door(k, P, st, x, y, face, o.doorW ?? Math.min(0.3, r * 0.42), o.doorH ?? Math.min(h * 0.7, 0.48));
  if (st.ornament === 'spikes') {
    for (let row = 0; row < (h > 0.7 ? 2 : 1); row++) {
      const yy = y + h * (0.45 + row * 0.3);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2 + PI / 8;
        const rr = r * (1 - (1 - taper) * ((yy - y) / h));
        k.b(pole([x + Math.sin(a) * (rr - 0.02), yy, z + Math.cos(a) * (rr - 0.02)], [x + Math.sin(a) * (rr + 0.13), yy - 0.01, z + Math.cos(a) * (rr + 0.13)], 0.016, 3), P.woodD, 0);
      }
    }
  }
  if (st.ornament === 'knots') {
    k.b(torus(r * 0.16, 0.014, x, y + h * 0.7, face + 0.02, 3, 8), P.accent, 0);
  }
}

// ---------------------------------------------------------------------------
// roofs (each returns the top height)
// ---------------------------------------------------------------------------

/** Pleasing roof height for a style and span. */
function roofH(st, span, grade = 'small') {
  const g = grade === 'grand' ? 1.25 : grade === 'mid' ? 1.1 : 1;
  switch (st.roof) {
    case 'gable': return span * 0.34 * g;
    case 'longhouse': return span * 0.42 * g;
    case 'pyramid': return span * (grade === 'small' ? 0.36 : 0.55) * g;
    case 'pagoda': return span * 0.3 * g;
    case 'curved': return span * 0.36 * g;
    case 'shikhara': return span * (grade === 'small' ? 0.55 : 0.85) * g;
    case 'thatch_cone': return span * 0.62 * g;
    case 'dome': return span * 0.4 * g;
    case 'stepped': return 0.12;
    default: return 0.1;
  }
}

/** How far a style's roof (and its ornaments) reaches past the walls. */
function roofOver(st, w = 2) {
  switch (st.roof) {
    case 'gable': return 0.11;
    case 'longhouse': return 0.22;
    case 'pyramid': return 0.08;
    case 'pagoda': return Math.min(0.24, 0.1 + 0.08 * w) + 0.02;
    case 'curved': return Math.min(0.22, 0.09 + 0.07 * w) + 0.03;
    case 'thatch_cone': return 0.15;
    case 'shikhara': return 0.04;
    case 'stepped': return 0.05;
    case 'dome': return 0.04;
    default: return 0.04;
  }
}

/** Collect parts in a local frame, then turn and move them. */
function placer(k, x, y, z, ry) {
  return (bucket, g, color, jit, anim) => {
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return k.add(bucket, g, color, jit, anim);
  };
}

function roofGable(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  const alongX = (o.ridge ?? (w >= d ? 'x' : 'z')) === 'x';
  const len = alongX ? w : d;
  const span = alongX ? d : w;
  const over = 0.1;
  const overEnd = 0.08;
  const L = len / 2 + overEnd;
  const S = span / 2 + over;
  const ye = (-over * h) / (span / 2);
  const put = placer(k, x, y, z, alongX ? 0 : PI / 2);
  const slopes = fromTris([
    [[-L, ye, S], [L, ye, S], [L, h, 0]], [[-L, ye, S], [L, h, 0], [-L, h, 0]],
    [[L, ye, -S], [-L, ye, -S], [-L, h, 0]], [[L, ye, -S], [-L, h, 0], [L, h, 0]],
  ]);
  put('body', slopes, P.roof, 0.05);
  const hl = len / 2;
  const sp = span / 2;
  const ends = fromTris(orient([
    [[hl, 0, sp], [hl, 0, -sp], [hl, h - 0.02, 0]],
    [[-hl, 0, -sp], [-hl, 0, sp], [-hl, h - 0.02, 0]],
  ], () => [0, 0.01, 0]));
  put('body', ends, st.wall === 'marble' ? P.wallL : P.wall, 0.02);
  if (st.ornament === 'columns' || grade !== 'small') {
    const ih = (h - 0.02) * 0.62;
    const isp = sp * 0.62;
    const yb = (h - 0.02) * 0.14;
    const tymp = fromTris([
      [[hl + 0.012, yb, isp], [hl + 0.012, yb, -isp], [hl + 0.012, yb + ih, 0]],
      [[-hl - 0.012, yb, -isp], [-hl - 0.012, yb, isp], [-hl - 0.012, yb + ih, 0]],
    ]);
    put('body', tymp, P.trim, 0.02);
  }
  const slopeLen = Math.hypot(S, h - ye);
  const ang = Math.atan2(h - ye, S);
  for (const sz of [-1, 1]) {
    put('body', box(2 * L + 0.02, 0.05, 0.05, 0, ye - 0.035, sz * S), P.roofD, 0.02);
    for (const sx of [-1, 1]) {
      const rake = box(0.05, 0.05, slopeLen, 0, -0.025, 0);
      rake.translate(0, 0, -slopeLen / 2);
      rake.rotateX(ang);
      if (sz < 0) rake.rotateY(PI);
      rake.translate(sx * L, ye, sz * S);
      put('body', rake, P.roofD, 0.02);
    }
  }
  if (grade !== 'small') {
    for (const sz of [-1, 1]) {
      for (const t of [0.35, 0.68]) {
        const strip = box(2 * L, 0.025, 0.03, 0, ye + (h - ye) * t + 0.005, sz * S * (1 - t));
        put('body', strip, P.roofD, 0.02);
      }
    }
  }
  const cap = box(2 * L + 0.03, 0.055, 0.1, 0, h - 0.025, 0);
  if (team) put('team', cap, 1);
  else put('body', cap, P.roofD, 0.02);
  if (grade === 'grand' || st.ornament === 'columns') {
    for (const sx of [-1, 1]) put('body', cone(0.05, 0.14, 4, sx * (L - 0.02), h + 0.02, 0, true), P.accent, 0);
  }
  return y + h + 0.05;
}

function roofLonghouse(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  const alongX = w >= d;
  const len = alongX ? w : d;
  const span = alongX ? d : w;
  const put = placer(k, x, y, z, alongX ? 0 : PI / 2);
  const n = o.simple ? 2 : 4;
  const L = len / 2 + 0.04;
  const sag = h * 0.28;
  const sec = [];
  for (let i = 0; i <= n; i++) {
    const u = (2 * i) / n - 1;
    const px = u * L;
    const lift = sag * u * u;
    const S = (span / 2 + 0.12) * (1 + 0.07 * (1 - u * u));
    sec.push({ l: [px, -0.06 + lift * 0.5, S], r: [px, -0.06 + lift * 0.5, -S], t: [px, h + lift, 0] });
  }
  // turf / shingle courses: three bands per slope, darker toward the eaves
  const lerp3 = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
  const BANDS = [[0, 0.3, 0.74], [0.3, 0.66, 1], [0.66, 1, 0.88]];
  for (const [f0, f1, sh] of BANDS) {
    const tris = [];
    for (let i = 0; i < n; i++) {
      const a = sec[i];
      const b = sec[i + 1];
      for (const side of ['l', 'r']) {
        const a0 = lerp3(a[side], a.t, f0);
        const a1 = lerp3(a[side], a.t, f1);
        const b0 = lerp3(b[side], b.t, f0);
        const b1 = lerp3(b[side], b.t, f1);
        tris.push([a0, b0, b1], [a0, b1, a1]);
      }
    }
    put('body', fromTris(orient(tris, (mx, my) => [mx, my - 1, 0])), shade(P.roof, sh), 0.07);
  }
  // dark eave boards give the turf a visible edge
  if (!o.simple) {
    const m = n / 2;
    for (const [i0, i1] of [[0, m], [m, n]]) {
      for (const side of ['l', 'r']) put('body', strut(sec[i0][side], sec[i1][side], 0.05, 0.06), P.woodD, 0.02);
    }
  }
  const sp = span / 2;
  const hl = len / 2;
  const endH = h + sag * Math.pow(hl / L, 2) - 0.05;
  put('body', fromTris(orient([
    [[hl, 0, sp], [hl, 0, -sp], [hl, endH, 0]],
    [[-hl, 0, -sp], [-hl, 0, sp], [-hl, endH, 0]],
  ], () => [0, 0, 0])), P.wallD, 0.04);
  // ridge cap: one beam per section
  for (let i = 0; i < n; i++) {
    const g = strut(sec[i].t, sec[i + 1].t, 0.07, 0.07);
    if (team) put('team', g, 1);
    else put('body', g, P.roofD, 0.02);
  }
  // crossed gable boards, carved into dragon heads on grander halls
  const dragons = !o.simple && (grade !== 'small' || st.ornament === 'carvings');
  for (const sx of [-1, 1]) {
    const top = sec[sx < 0 ? 0 : n].t;
    const ex = top[0];
    const eS = sec[sx < 0 ? 0 : n].l[2];
    const ey = sec[sx < 0 ? 0 : n].l[1];
    const tip = dragons ? 0.08 : 0.14;
    for (const sz of [-1, 1]) {
      const p0 = [ex, ey, sz * eS];
      const t = (top[1] + tip - ey) / (top[1] - ey);
      put('body', strut(p0, [ex, ey + (top[1] - ey) * t, sz * eS * (1 - t)], 0.05, 0.05), P.trim, 0.03);
    }
    if (dragons) {
      const hx = ex;
      const hy = top[1] + 0.04;
      put('body', strut([hx, hy - 0.04, 0], [hx + sx * 0.05, hy + 0.13, 0], 0.07), P.trim, 0.04);
      put('body', strut([hx + sx * 0.03, hy + 0.13, 0], [hx + sx * 0.17, hy + 0.15, 0], 0.075, 0.065), P.trim, 0.04);
      put('body', strut([hx + sx * 0.05, hy + 0.08, 0], [hx + sx * 0.15, hy + 0.07, 0], 0.03, 0.05), P.trim, 0.04);
      put('body', box(0.025, 0.03, 0.08, hx + sx * 0.09, hy + 0.18, 0), P.accent, 0);
      put('body', cone(0.025, 0.08, 4, hx + sx * 0.04, hy + 0.17, 0, true), P.trim, 0);
    }
  }
  return y + h + sag + (dragons ? 0.24 : 0.16);
}

function roofPyramid(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  const hw = w / 2 + 0.07;
  const hd = d / 2 + 0.07;
  const capF = grade === 'small' ? 0.7 : 0.82;
  k.b(hipLoft({ cx: x, cz: z, y: y - 0.02, hw, hd, tw: hw * (1 - capF), td: hd * (1 - capF), h: h * capF, steps: 1 }), P.roof, 0.04);
  if (grade === 'small') {
    k.b(box(hw * 2 * (1 - capF), 0.03, hd * 2 * (1 - capF), x, y - 0.02 + h * capF, z), P.roofD, 0);
    k.b(hipLoft({ cx: x, cz: z, y: y - 0.02 + h * capF + 0.03, hw: hw * 0.2, hd: hd * 0.2, h: h * 0.3, steps: 1 }), P.accent, 0);
  } else {
    k.b(hipLoft({ cx: x, cz: z, y: y - 0.02 + h * capF, hw: hw * (1 - capF), hd: hd * (1 - capF), h: h * (1 - capF), steps: 1 }), P.accent, 0);
  }
  if (team) {
    for (const sz of [-1, 1]) k.t(box(2 * hw + 0.02, 0.06, 0.04, x, y - 0.03, z + sz * hd), 1);
    for (const sx of [-1, 1]) k.t(box(0.04, 0.06, 2 * hd, x + sx * hw, y - 0.03, z), 1);
  }
  return y + h + (grade === 'small' ? 0.07 : 0);
}

function roofPagoda(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  const tiers = o.tiers ?? (grade === 'grand' ? 3 : grade === 'mid' ? 2 : 1);
  let cw = w;
  let cd = d;
  let yy = y;
  const rh = h / (1 + (tiers - 1) * 0.75);
  for (let t = 0; t < tiers; t++) {
    const last = t === tiers - 1;
    const over = Math.min(0.2, 0.08 + 0.08 * cw) + 0.04 * (t === 0);
    const hw = cw / 2 + over;
    const hd = cd / 2 + over;
    const th = rh * (t === 0 ? 1 : 0.82);
    const ridge = last ? Math.max(0, (cw - cd) / 2) + cw * 0.06 : 0;
    k.b(hipLoft({
      cx: x, cz: z, y: yy - 0.04, hw, hd, tw: last ? ridge : cw * 0.3, td: last ? 0.001 : cd * 0.3, h: th, steps: 3, pi: 1, py: 1.7, lift: 0.1, per: 3, cap: !last,
    }), P.roof, 0.05);
    // eave fascia in trim
    if (!o.simple) for (const sz of [-1, 1]) k.b(box(2 * hw * 0.8, 0.035, 0.035, x, yy - 0.06, z + sz * hd * 0.99), P.roofD, 0);
    if (last) {
      const cap = box(ridge * 2 + 0.12, 0.05, 0.08, x, yy - 0.04 + th - 0.01, z);
      if (team) k.t(cap, 1);
      else k.b(cap, P.roofD, 0);
      const top = yy - 0.04 + th + 0.03;
      if (grade !== 'small') {
        k.b(cyl(0.025, 0.025, 0.5 * (grade === 'grand' ? 1.2 : 0.8), 4, x, top, z, true), P.accentD, 0);
        for (let i = 0; i < 3; i++) k.b(cyl(0.06 - i * 0.01, 0.06 - i * 0.01, 0.03, 5, x, top + 0.1 + i * 0.1, z), P.accent, 0);
        k.b(octa(0.05, x, top + 0.5 * (grade === 'grand' ? 1.2 : 0.8), z), P.accent, 0);
        return top + 0.65;
      }
      if (!o.simple) {
        k.b(box(0.05, 0.1, 0.05, x - ridge, top - 0.02, z), P.roofD, 0);
        k.b(box(0.05, 0.1, 0.05, x + ridge, top - 0.02, z), P.roofD, 0);
      }
      return top + 0.06;
    }
    // next tier wall band
    const band = 0.22 + 0.04 * (tiers - t);
    cw *= 0.74;
    cd *= 0.74;
    const by = yy - 0.04 + th * 0.45;
    k.b(box(cw, band, cd, x, by, z), P.wall, 0.03);
    k.b(box(cw * 0.6, band * 0.5, 0.02, x, by + band * 0.25, z + cd / 2), P.infill, 0);
    k.b(box(cw + 0.06, 0.04, cd + 0.06, x, by + band - 0.02, z), P.beam, 0);
    yy = by + band;
  }
  return yy;
}

function roofCurved(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  let yy = y;
  if (grade !== 'small') {
    // lower skirt roof (double eave) around the walls
    const sh = Math.min(0.32, h * 0.45);
    const so = Math.min(0.22, 0.08 + 0.07 * w);
    k.b(hipLoft({ cx: x, cz: z, y: y - 0.04, hw: w / 2 + so, hd: d / 2 + so, tw: w / 2 * 0.86, td: d / 2 * 0.8, h: sh * 0.55, steps: 2, py: 1.6, lift: 0.1, per: 3 }), P.roof, 0.05);
    const by = y - 0.04 + sh * 0.5;
    k.b(box(w * 0.84, sh * 0.75, d * 0.78, x, by, z), P.wall, 0.03);
    k.b(box(w * 0.84 + 0.05, 0.05, d * 0.78 + 0.05, x, by + sh * 0.75 - 0.05, z), P.beam, 0.02);
    yy = by + sh * 0.75;
  }
  const cw = grade === 'small' ? w : w * 0.84;
  const cd = grade === 'small' ? d : d * 0.78;
  const ridge = Math.max(0.06, (cw - cd) / 2 + cw * 0.12);
  const ov = Math.min(0.2, 0.07 + 0.07 * cw);
  const hw = cw / 2 + ov;
  const hd = cd / 2 + ov;
  const rh = grade === 'small' ? h : h * 0.8;
  k.b(hipLoft({ cx: x, cz: z, y: yy - 0.04, hw, hd, tw: ridge, td: 0.001, h: rh, steps: o.simple ? 3 : 4, pi: 1, py: 1.9, lift: 0.15, per: o.simple ? 2 : 3 }), P.roof, 0.05);
  const top = yy - 0.04 + rh;
  const cap = box(ridge * 2 + 0.08, 0.07, 0.09, x, top - 0.03, z);
  if (team) k.t(cap, 1);
  else k.b(cap, P.roofD, 0);
  // ridge-end ornaments (chiwen) and hip-corner tips
  for (const sx of [-1, 1]) {
    k.b(strut([x + sx * ridge, top, z], [x + sx * (ridge + 0.06), top + 0.16, z], 0.06, 0.05), P.accent, 0.03);
    k.b(box(0.05, 0.05, 0.05, x + sx * (ridge + 0.02), top + 0.18, z), P.accent, 0);
  }
  if (!o.simple) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      k.b(cone(0.035, 0.12, 4, x + sx * hw, yy - 0.04 + 0.15, z + sz * hd, true), P.accent, 0);
    }
  }
  return top + 0.16;
}

function roofShikhara(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  const hw = w / 2 + 0.03;
  const hd = d / 2 + 0.03;
  const bands = o.simple ? 3 : grade === 'small' ? 4 : 7;
  const topK = 0.2;
  let prev = null;
  for (let i = 0; i <= bands; i++) {
    const u = i / bands;
    const f = Math.pow(u, 2.1) * (1 - topK);
    const ring = rectRing(hw * (1 - f), hd * (1 - f), y + h * u, x, z, o.simple ? 1 : 2, 0);
    if (prev) k.b(loft([prev, ring], i === bands), i % 2 ? P.roof : P.roofD, 0.03);
    prev = ring;
  }
  const top = y + h;
  const ar = Math.min(hw, hd) * topK * 1.25;
  k.b(cyl(ar, ar, 0.07, 8, x, top, z), P.roofL, 0.08);
  if (!o.simple) k.b(cyl(ar * 0.5, ar * 0.6, 0.04, 6, x, top + 0.07, z), P.roofD, 0);
  k.b(ball(ar * 0.42, x, top + 0.15, z, o.simple ? 5 : 6, o.simple ? 3 : 4, 1.2), P.accent, 0);
  if (!o.simple) k.b(cone(ar * 0.18, 0.12, 4, x, top + 0.2, z, true), P.accent, 0);
  if (grade !== 'small' && !o.simple) {
    // miniature spires clustered on the shoulders
    for (const sx of [-1, 1]) {
      const mw = hw * 0.42;
      let pr = null;
      for (let i = 0; i <= 3; i++) {
        const u = i / 3;
        const f = Math.pow(u, 2) * 0.8;
        const ring = rectRing(mw * (1 - f), mw * (1 - f), y + h * 0.42 * u, x + sx * hw * 0.62, z + hd * 0.25, 1, 0);
        if (pr) k.b(loft([pr, ring], i === 3), i % 2 ? P.roof : P.roofD, 0.03);
        pr = ring;
      }
      k.b(ball(0.04, x + sx * hw * 0.62, y + h * 0.42 + 0.03, z + hd * 0.25, 5, 3), P.accent, 0);
    }
  }
  if (team) {
    k.b(cyl(0.012, 0.012, 0.45, 3, x, top + 0.2, z, true), P.woodD, 0);
    const g = prep(new THREE.BoxGeometry(0.28, 0.15, 0.012, 3, 1, 1));
    g.translate(x + 0.15, top + 0.56, z);
    k.t(g, 1, (vx) => [clamp01((vx - x) / 0.28), 0]);
    k.t(box(2 * hw + 0.03, 0.05, 2 * hd + 0.03, x, y - 0.01, z), 1);
  }
  return top + 0.65;
}

function roofStepped(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, grade = 'small', team = true } = o;
  k.b(box(w + 0.06, 0.08, d + 0.06, x, y, z), P.roof, 0.03);
  let top = y + 0.08;
  const merlon = (mx, mz, s = 1) => {
    k.b(box(0.13 * s, 0.08 * s, 0.07, mx, top, mz), P.roof, 0.03);
    k.b(box(0.07 * s, 0.07 * s, 0.07, mx, top + 0.08 * s, mz), P.roof, 0.03);
  };
  const nf = Math.max(2, Math.round(w / 0.34));
  for (let i = 0; i < nf; i++) merlon(x - w / 2 + (w * (i + 0.5)) / nf, z + d / 2, 1);
  const ns = Math.max(1, Math.round(d / 0.45));
  for (const sx of [-1, 1]) for (let i = 0; i < ns; i++) merlon(x + sx * (w / 2), z - d / 2 + (d * (i + 0.5)) / ns, 0.9);
  if (grade !== 'small') {
    const bw = w * 0.5;
    const bd = d * 0.5;
    k.b(frustum(bw, 0.32, bd, 0.92, x, top, z - d * 0.08), P.wall, 0.04);
    k.b(box(bw * 0.92 + 0.05, 0.06, bd * 0.92 + 0.05, x, top + 0.3, z - d * 0.08), P.trim, 0.02);
    door(k, P, st, x, top, z - d * 0.08 + bd * 0.46, 0.16, 0.2);
    top += 0.36;
  }
  if (team) {
    for (const sx of [-1, 1]) flag(k, P, x + sx * (w / 2 - 0.05), y + 0.08, z + d / 2 - 0.05, 0.55, 0.26, 0.16);
    k.t(box(w + 0.07, 0.035, d + 0.07, x, y + 0.02, z), 1);
  }
  return top + 0.15;
}

function roofFlatDome(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  k.b(box(w + 0.04, 0.06, d + 0.04, x, y, z), P.wallD, 0.03);
  k.b(frustum(w + 0.02, 0.1, d + 0.02, 0.97, x, y + 0.06, z), P.wallL, 0.03);
  const r = Math.min(w, d) * (grade === 'small' ? 0.32 : 0.36);
  k.b(cyl(r + 0.03, r + 0.04, 0.12, 8, x, y + 0.06, z), P.wall, 0.03);
  if (team) k.t(cyl(r + 0.045, r + 0.045, 0.05, 8, x, y + 0.14, z, true), 1);
  k.b(dome(r, Math.max(r * 0.9, h * 0.8), x, y + 0.18, z, 8, 3), P.roof, 0.05);
  const top = y + 0.18 + Math.max(r * 0.9, h * 0.8);
  k.b(cone(0.04, 0.16, 5, x, top - 0.02, z), P.wall, 0);
  k.b(ball(0.035, x, top + 0.16, z, 5, 3, 1.3), P.white, 0);
  if (grade !== 'small') {
    for (const sx of [-1, 1]) {
      const rr = r * 0.45;
      const px = x + sx * (w / 2 - rr - 0.05);
      k.b(dome(rr, rr, px, y + 0.16, z + d * 0.18, 6, 2), P.roof, 0.05);
      k.b(ball(0.03, px, y + 0.16 + rr + 0.02, z + d * 0.18, 4, 3, 1.3), P.white, 0);
    }
  }
  if (st.ornament === 'spikes') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pinnacle(k, P, x + sx * (w / 2 - 0.06), y + 0.06, z + sz * (d / 2 - 0.06), 0.32, 0.12);
  }
  return top + 0.2;
}

function roofThatchHip(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, team = true } = o;
  const alongX = w >= d;
  const ridge = Math.max(0.04, (Math.abs(w - d) / 2) * 0.9);
  k.b(hipLoft({
    cx: x, cz: z, y: y - 0.06, hw: w / 2 + 0.14, hd: d / 2 + 0.14, tw: alongX ? ridge : 0.001, td: alongX ? 0.001 : ridge, h, steps: 3, pi: 1, py: 0.85, per: 2,
  }), P.roof, 0.14);
  const cap = box(alongX ? ridge * 2 + 0.1 : 0.1, 0.07, alongX ? 0.1 : ridge * 2 + 0.1, x, y - 0.06 + h - 0.03, z);
  if (team) k.t(cap, 1);
  else k.b(cap, P.roofD, 0);
  return y - 0.06 + h + 0.05;
}

function roofFlat(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, grade = 'small', team = true } = o;
  k.b(box(w + 0.06, 0.06, d + 0.06, x, y, z), P.roofD, 0.03);
  for (const sz of [-1, 1]) k.b(box(w + 0.06, 0.1, 0.06, x, y + 0.06, z + sz * (d / 2)), P.wallL, 0.03);
  for (const sx of [-1, 1]) k.b(box(0.06, 0.1, d, x + sx * (w / 2), y + 0.06, z), P.wallL, 0.03);
  let top = y + 0.16;
  if (grade !== 'small') {
    k.b(box(w * 0.4, 0.3, d * 0.4, x, y + 0.06, z - d * 0.1), P.wall, 0.03);
    k.b(box(w * 0.4 + 0.06, 0.05, d * 0.4 + 0.06, x, y + 0.36, z - d * 0.1), P.trim, 0);
    top = y + 0.41;
  }
  if (team) {
    k.t(box(w * 0.5, 0.02, d * 0.35, x, y + 0.06, z + d * 0.2), 1);
    flag(k, P, x + w / 2 - 0.08, y + 0.06, z - d / 2 + 0.08, 0.5, 0.26, 0.16);
  }
  return top;
}

const RECT_ROOFS = {
  gable: roofGable, longhouse: roofLonghouse, pyramid: roofPyramid, pagoda: roofPagoda, curved: roofCurved,
  shikhara: roofShikhara, stepped: roofStepped, dome: roofFlatDome, thatch_cone: roofThatchHip, flat: roofFlat,
};

function rectRoof(k, P, st, o) {
  return (RECT_ROOFS[st.roof] || roofFlat)(k, P, st, o);
}

/** Roof for a round building. */
function roundRoof(k, P, st, o) {
  const { x = 0, z = 0, r, y, h, team = true } = o;
  if (st.roof === 'dome') {
    const rr = r * (st.wall === 'mudbrick' ? 0.92 : 1) + 0.02;
    if (team) k.t(cyl(rr + 0.035, rr + 0.035, 0.06, 10, x, y - 0.02, z, true, true), 1);
    k.b(dome(rr, h, x, y, z, 10, 3), P.roof, 0.05);
    k.b(cone(0.045, 0.18, 5, x, y + h - 0.03, z), P.wall, 0);
    k.b(ball(0.04, x, y + h + 0.17, z, 5, 3, 1.3), P.white, 0);
    return y + h + 0.22;
  }
  const R = r + 0.14;
  k.b(cone(R, h, 10, x, y - 0.05, z, true, true), st.roof === 'thatch_cone' ? P.roof : P.roof, st.roof === 'thatch_cone' ? 0.13 : 0.05);
  const ty = y - 0.05;
  k.b(cyl(R * 0.12, R * 0.2, h * 0.14, 6, x, ty + h * 0.8, z, true), P.roofD, 0.05);
  k.b(cone(R * 0.1, h * 0.12, 6, x, ty + h * 0.93, z), P.roofD, 0);
  if (team) {
    const f = 0.42;
    const rb = R * (1 - f) + 0.012;
    const rt = R * (1 - f - 0.09) + 0.012;
    k.t(cyl(rt, rb, h * 0.09, 10, x, ty + h * f, z, true, true), 1);
  }
  return ty + h * 1.05;
}

// ---------------------------------------------------------------------------
// halls, towers, walls
// ---------------------------------------------------------------------------

/**
 * A building block in the pantheon's style: walls (rect or round) and roof.
 * o: { x, z, w, d, y, h (wall height), rh (roof height), grade: small|mid|grand,
 *      round, porch, door, doorW, doorH, windows, team, ridge }
 * Returns the top height.
 */
function hall(k, P, st, o) {
  const { x = 0, z = 0, y = PLINTH, h, grade = 'small', team = true } = o;
  let { w, d } = o;
  const round = o.round ?? isRound(st);
  if (o.lim) {
    const ov = round ? (st.roof === 'dome' ? 0.06 : 0.16) : roofOver(st, w);
    w = Math.min(w, 2 * (o.lim - Math.abs(x) - ov));
    d = Math.min(d, 2 * (o.lim - Math.abs(z) - ov));
  }
  if (round) {
    const r = Math.min(w, d) / 2 - 0.08;
    roundWalls(k, P, st, { x, z, r, y, h, door: o.door, doorW: o.doorW, doorH: o.doorH });
    return roundRoof(k, P, st, { x, z, r, y: y + h, h: o.rh ?? roofH(st, 2 * r, grade), grade, team });
  }
  let porch = 0;
  if (st.ornament === 'columns' && o.porch !== false) porch = Math.max(0.24, Math.min(0.42, d * 0.26));
  const wd = d - porch;
  const wz = z - porch / 2;
  rectWalls(k, P, st, { x, z: wz, w, d: wd, y, h, door: o.door, doorW: o.doorW, doorH: o.doorH, windows: o.windows });
  if (porch) {
    const n = w > 1.7 ? 4 : 2;
    const cz = z + d / 2 - 0.07;
    k.b(box(w, 0.04, porch, x, y, z + d / 2 - porch / 2), P.stoneL, 0.02);
    for (let i = 0; i < n; i++) {
      const cx = n === 2 ? x + (i ? 1 : -1) * w * 0.32 : x - w / 2 + 0.09 + (i * (w - 0.18)) / (n - 1);
      column(k, P, cx, y, cz, h, Math.min(0.075, w * 0.03));
    }
    k.b(box(w + 0.06, 0.1, porch + 0.02, x, y + h - 0.1, z + d / 2 - porch / 2), P.wallL, 0.02);
  }
  if (st.roof === 'longhouse' && team) {
    const n = Math.max(2, Math.floor(w / 0.45));
    for (let i = 0; i < n; i++) {
      const sx = x - w / 2 + (w * (i + 0.5)) / n;
      if (Math.abs(sx - x) < 0.25) continue;
      shield(k, P, sx, y + h * 0.62, wz + wd / 2, 0.1);
    }
  }
  const ridge = o.ridge ?? (st.roof === 'gable' && porch ? 'z' : undefined);
  const span = ridge === 'z' ? w : Math.min(w, d);
  const rh = o.rh ?? roofH(st, span, grade);
  return rectRoof(k, P, st, { x, z, w, d, y: y + h, h: rh, grade, team, ridge, simple: o.simple });
}

/** Watch tower body: shaft, lookout platform and a small roof (or battlements). Returns top height. */
function towerStruct(k, P, st, o) {
  const { x = 0, z = 0, s, h, y = PLINTH, team = true } = o;
  const round = isRound(st);
  const ty = y + h;
  if (st.wall === 'timber') {
    const b = s / 2;
    const t = s * 0.4;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      k.b(strut([x + sx * b, y, z + sz * b], [x + sx * t, ty, z + sz * t], 0.08), P.wood, 0.05);
    }
    for (let lv = o.simple ? 1 : 0; lv < 2; lv++) {
      const y0 = y + h * (0.08 + lv * 0.45);
      const y1 = y + h * (0.48 + lv * 0.45);
      const b0 = b - (b - t) * (0.08 + lv * 0.45);
      const b1 = b - (b - t) * (0.48 + lv * 0.45);
      for (const sz of [-1, 1]) k.b(strut([x - b0, y0, z + sz * b0], [x + b1, y1, z + sz * b1], 0.04), P.woodD, 0.03);
      if (!o.simple) for (const sx of [-1, 1]) k.b(strut([x + sx * b0, y0, z - b0], [x + sx * b1, y1, z + b1], 0.04), P.woodD, 0.03);
    }
  } else if (round) {
    const taper = st.wall === 'mudbrick' ? 0.78 : 0.86;
    k.b(cyl(s / 2 + 0.06, s / 2 + 0.08, 0.12, 10, x, y, z, true, true), P.stoneD, 0.08);
    k.b(cyl((s / 2) * taper, s / 2, h, 10, x, y, z, true, true), P.wall, st.wall === 'stone' ? 0.1 : 0.05);
    if (st.ornament === 'spikes' && !o.simple) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2;
        const rr = (s / 2) * (1 - (1 - taper) * 0.55);
        k.b(pole([x + Math.sin(a) * rr, y + h * 0.55, z + Math.cos(a) * rr], [x + Math.sin(a) * (rr + 0.14), y + h * 0.55, z + Math.cos(a) * (rr + 0.14)], 0.016, 3), P.woodD, 0);
      }
    }
  } else {
    const taper = { sandstone: 0.8, mudbrick: 0.78, stone: 0.92, marble: 0.95, brick: 0.92, lacquer: 0.9 }[st.wall] ?? 0.92;
    k.b(box(s + 0.08, 0.12, s + 0.08, x, y, z), P.stoneD, 0.06);
    k.b(frustum(s, h, s, taper, x, y, z), st.wall === 'lacquer' ? P.infill : P.wall, st.wall === 'stone' ? 0.08 : 0.04);
    if (st.wall === 'lacquer') {
      for (const sx of [-1, 1]) k.b(frustum(0.08, h, 0.08, 0.9, x + sx * (s / 2 - 0.02) * (1 + taper) / 2, y, z + (s / 2) * (1 + taper) / 2 - 0.02), P.wall, 0.03);
      k.b(box(s * taper + 0.04, 0.08, s * taper + 0.04, x, y + h * 0.5, z), P.wall, 0.02);
    }
    if (st.wall === 'sandstone' || st.wall === 'marble' || st.wall === 'brick') {
      k.b(box(s * taper + 0.07, 0.07, s * taper + 0.07, x, y + h - 0.07, z), P.trim, 0.02);
    }
    if (st.ornament === 'spikes' && !o.simple) {
      for (let i = 0; i < 3; i++) {
        const yy = y + h * (0.3 + i * 0.25);
        const ww = (s / 2) * (1 - (1 - taper) * (0.3 + i * 0.25));
        for (const sx of [-1, 0, 1]) k.b(pole([x + sx * ww * 0.6, yy, z + ww - 0.02], [x + sx * ww * 0.6, yy - 0.01, z + ww + 0.12], 0.016, 3), P.woodD, 0);
      }
    }
    if (st.ornament === 'carvings' && !o.simple) frieze(k, P, x, z + (s / 2) * ((1 + taper) / 2) + 0.01, s * 0.8, y + h * 0.78);
  }
  // arrow slits
  if (st.wall !== 'timber') {
    const fz = round ? z + s / 2 - 0.02 : z + s / 2 - 0.03;
    for (const fy of o.simple ? [0.6] : [0.45, 0.75]) k.b(box(0.06, 0.16, 0.06, x, y + h * fy, fz), P.dark, 0);
  }
  // platform
  const pw = s + (st.wall === 'timber' ? 0.18 : 0.22);
  const platColor = st.wall === 'timber' || st.wall === 'lacquer' ? P.woodD : P.stoneD;
  if (round && st.wall !== 'timber') k.b(cyl(pw / 2, pw / 2 - 0.04, 0.1, 10, x, ty, z, false, true), platColor, 0.04);
  else k.b(box(pw, 0.09, pw, x, ty, z), platColor, 0.04);
  const py = ty + 0.09;
  const battlements = st.roof === 'flat' || st.roof === 'stepped' || st.wall === 'sandstone' && st.roof !== 'shikhara' || o.battlements;
  let top;
  if (battlements) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const off = -pw / 2 + 0.06 + (i * (pw - 0.12)) / (n - 1);
      k.b(box(0.11, 0.16, 0.07, x + off, py, z + pw / 2 - 0.035), P.wall, 0.03);
      k.b(box(0.11, 0.16, 0.07, x + off, py, z - pw / 2 + 0.035), P.wall, 0.03);
      if (i === 1) {
        k.b(box(0.07, 0.16, 0.11, x - pw / 2 + 0.035, py, z), P.wall, 0.03);
        k.b(box(0.07, 0.16, 0.11, x + pw / 2 - 0.035, py, z), P.wall, 0.03);
      }
    }
    if (st.roof === 'stepped') k.t(box(pw + 0.01, 0.04, pw + 0.01, x, py - 0.05, z), 1);
    top = py + 0.16;
    if (team) flag(k, P, x, py, z, 0.65, 0.34, 0.2);
    top = py + 0.67;
  } else {
    const ph = 0.38;
    const pi = pw / 2 - 0.05;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(box(0.05, ph, 0.05, x + sx * pi, py, z + sz * pi), P.woodD, 0.03);
    if (!o.simple) k.b(box(pw - 0.04, 0.05, 0.03, x, py + 0.13, z + pi), P.woodD, 0);
    if (round) {
      top = roundRoof(k, P, st, { x, z, r: pw / 2 - (st.roof === 'dome' ? 0.06 : 0.15), y: py + ph, h: roofH(st, pw, 'small') * 0.95, team });
    } else {
      const rw = pw - 2 * roofOver(st, pw) + 0.02;
      top = rectRoof(k, P, st, { x, z, w: rw, d: rw, y: py + ph, h: roofH(st, rw, 'small'), grade: 'small', team, tiers: 1, simple: o.simple });
    }
    if (team && !['shikhara', 'stepped', 'flat'].includes(st.roof)) {
      flag(k, P, x + (st.roof === 'pyramid' ? 0 : 0), top - 0.03, z, 0.42, 0.28, 0.17);
      top += 0.42;
    }
  }
  return top;
}

/** Perimeter wall along the footprint edge with a gate gap on the south side. */
function perimeter(k, P, st, o) {
  const { half, h, gate, y = PLINTH, merlons = false, team = true } = o;
  const t = 0.16;
  const segs = [
    [-half, -half + t / 2, half, -half + t / 2],
    [-half + t / 2, -half, -half + t / 2, half],
    [half - t / 2, -half, half - t / 2, half],
    [-half, half - t / 2, -gate / 2, half - t / 2],
    [gate / 2, half - t / 2, half, half - t / 2],
  ];
  for (const [x0, z0, x1, z1] of segs) {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = alongX ? len : t;
    const d = alongX ? t : len;
    if (st.wall === 'timber') {
      k.b(box(w, h, d, cx, y, cz), P.wood, 0.1);
      const n = Math.max(2, Math.round(len / 0.2));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n - 0.5;
        k.b(cone(t * 0.45, 0.14, 3, cx + (alongX ? f * len : 0), y + h, cz + (alongX ? 0 : f * len), true), P.wood, 0.1);
      }
      continue;
    }
    if (st.wall === 'lacquer') {
      k.b(box(w, h, d, cx, y, cz), P.infill, 0.03);
      k.b(box(w + (alongX ? 0 : 0.04), 0.06, d + (alongX ? 0.04 : 0), cx, y, cz), P.stone, 0.03);
      const cap = alongX ? box(w + 0.04, 0.07, t + 0.1, cx, y + h, cz) : box(t + 0.1, 0.07, d + 0.04, cx, y + h, cz);
      k.b(cap, P.roof, 0.03);
      k.b(alongX ? box(w + 0.04, 0.05, 0.05, cx, y + h + 0.05, cz) : box(0.05, 0.05, d + 0.04, cx, y + h + 0.05, cz), P.roofD, 0);
      continue;
    }
    const color = st.wall === 'mudbrick' || st.wall === 'brick' || st.wall === 'sandstone' ? P.wall : st.wall === 'marble' ? P.wallL : P.stone;
    if (st.wall === 'mudbrick') k.b(frustum(w + 0.04, h, d + 0.04, alongX ? 1 : 0.7, cx, y, cz, alongX ? 0.7 : 1), color, 0.05);
    else k.b(box(w, h, d, cx, y, cz), color, st.wall === 'stone' ? 0.08 : 0.04);
    if (merlons) {
      const n = Math.max(1, Math.round(len / 0.44));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n - 0.5;
        const mx = cx + (alongX ? f * len : 0);
        const mz = cz + (alongX ? 0 : f * len);
        if (st.wall === 'mudbrick') k.b(cone(0.06, 0.13, 4, mx, y + h - 0.01, mz, true), color, 0.04);
        else k.b(box(alongX ? 0.13 : t, 0.11, alongX ? t : 0.13, mx, y + h, mz), color, 0.04);
      }
    } else if (st.wall !== 'mudbrick') {
      k.b(box(w + 0.02, 0.04, d + 0.02, cx, y + h, cz), st.wall === 'marble' ? P.trim : shade(color, 0.85), 0.02);
    }
  }
  // gate posts
  for (const sx of [-1, 1]) {
    const gx = (sx * gate) / 2 + sx * 0.09;
    if (st.wall === 'timber') k.b(box(0.16, h + 0.32, 0.2, gx, y, half - t / 2), P.woodD, 0.04);
    else k.b(box(0.2, h + 0.2, 0.22, gx, y, half - t / 2), st.wall === 'lacquer' ? P.wall : shade(P.stone, 0.95), 0.04);
    if (team) k.t(box(0.13, 0.26, 0.02, gx, y + h - 0.2, half - t / 2 + 0.12), 1);
  }
}

// ---------------------------------------------------------------------------
// buildings
// ---------------------------------------------------------------------------

function buildHouse(k, P, st) {
  const round = isRound(st);
  const y = PLINTH;
  if (round) {
    hall(k, P, st, { x: -0.04, z: -0.06, w: 1.38, d: 1.38, h: st.roof === 'dome' ? 0.62 : 0.55, rh: st.roof === 'dome' ? 0.5 : 0.8, lim: 0.9 });
  } else if (st.roof === 'longhouse') {
    hall(k, P, st, { x: 0, z: -0.12, w: 1.56, d: 0.92, h: 0.6, rh: 0.55, windows: 0, lim: 0.9 });
  } else {
    hall(k, P, st, { x: 0, z: -0.1, w: 1.3, d: 1.05, h: 0.68, windows: 1, porch: st.ornament === 'columns', lim: 0.9 });
  }
  logPile(k, P, 0.62, y, 0.68, 0.34, PI / 2);
  barrel(k, P, -0.7, y, 0.66, 0.24);
  if (st.roof === 'stepped' || st.roof === 'flat' || st.roof === 'pyramid') crate(k, P, -0.48, y, 0.7, 0.16, 0.3);
  if (!['stepped', 'flat', 'shikhara'].includes(st.roof)) flag(k, P, 0.72, y, -0.7, 1.35, 0.28, 0.17);
  else flag(k, P, 0.72, y, -0.7, 1.1, 0.28, 0.17);
}

function buildStorehouse(k, P, st) {
  const y = PLINTH;
  if (isRound(st)) {
    // granaries on stones (dome) or stilts (thatch), with conical straw hats
    const pts = [[-0.45, -0.38, 0.33], [0.4, -0.45, 0.28], [0.05, 0.12, 0.3]];
    for (const [gx, gz, r] of pts) {
      const lift = st.roof === 'thatch_cone' ? 0.16 : 0.08;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * PI * 2 + PI / 4;
        k.b(box(0.06, lift, 0.06, gx + Math.cos(a) * r * 0.6, y, gz + Math.sin(a) * r * 0.6), st.roof === 'thatch_cone' ? P.woodD : P.stoneD, 0.05);
      }
      k.b(cyl(r * 0.92, r, 0.5, 8, gx, y + lift, gz, false, true), P.wall, 0.06);
      k.b(box(0.13, 0.15, 0.04, gx, y + lift + 0.18, gz + r * 0.95), P.dark, 0);
      k.b(cone(r + 0.1, 0.42, 8, gx, y + lift + 0.47, gz, true, true), st.roof === 'dome' ? P.straw : P.roof, 0.14);
      k.t(cyl(r * 0.5, r * 0.62, 0.05, 8, gx, y + lift + 0.6, gz, true, true), 1);
    }
    logPile(k, P, -0.45, y, 0.55, 0.42, PI / 2);
    sack(k, P, 0.55, y, 0.45, 0.24);
    sack(k, P, 0.7, y, 0.3, 0.2);
    goldPile(k, P, 0.55, y, 0.7, 0.28);
    flag(k, P, 0.75, y, -0.75, 1.2, 0.28, 0.17);
    return;
  }
  // open shed: back wall, posts and a roof over the goods
  const ov = roofOver(st, 1.5);
  const sw = Math.min(1.5, 2 * (0.9 - ov));
  const sz = -0.16;
  const sd = Math.min(1.05, 2 * (0.9 + sz - ov));
  const wh = 0.68;
  k.b(box(sw, 0.05, sd, 0, y, sz), P.wood, 0.05);
  rectWallsBack(k, P, st, sw, sd, sz, y, wh);
  for (const sx of [-1, 1]) k.b(box(0.08, wh, 0.08, (sx * sw) / 2 - sx * 0.04, y, sz + sd / 2 - 0.05), st.wall === 'lacquer' ? P.wall : P.woodD, 0.03);
  rectRoof(k, P, st, { x: 0, z: sz, w: sw, d: sd, y: y + wh, h: roofH(st, sd, 'small') * 0.9, grade: 'small', team: true });
  crate(k, P, -0.45, y + 0.05, sz - 0.15, 0.22, 0.2);
  crate(k, P, -0.42, y + 0.27, sz - 0.18, 0.18, -0.3);
  crate(k, P, -0.15, y + 0.05, sz - 0.25, 0.2, 0.5);
  barrel(k, P, 0.25, y + 0.05, sz - 0.25, 0.28);
  barrel(k, P, 0.48, y + 0.05, sz - 0.2, 0.26);
  sack(k, P, 0.4, y + 0.05, sz + 0.2, 0.22);
  sack(k, P, 0.1, y + 0.05, sz + 0.15, 0.2);
  logPile(k, P, -0.45, y, 0.62, 0.44, 0);
  goldPile(k, P, 0.45, y, 0.62, 0.32);
  flag(k, P, 0.78, y, -0.78, 1.25, 0.28, 0.17);
}

// Closed back and side walls of the storehouse shed (south side open).
function rectWallsBack(k, P, st, w, d, z, y, h) {
  const c = st.wall === 'lacquer' ? P.infill : P.wall;
  const t = 0.07;
  k.b(box(w, h, t, 0, y, z - d / 2 + t / 2), c, 0.06);
  for (const sx of [-1, 1]) k.b(box(t, h, d * 0.55, (sx * w) / 2 - sx * t / 2, y, z - d * 0.2), c, 0.06);
  if (st.wall === 'timber' || st.wall === 'lacquer') {
    for (const sx of [-1, 1]) k.b(box(0.08, h, 0.08, (sx * w) / 2 - sx * 0.04, y, z - d / 2 + 0.04), st.wall === 'lacquer' ? P.wall : P.woodD, 0.03);
  }
  if (st.ornament === 'spikes') {
    for (let i = 0; i < 4; i++) k.b(pole([-w / 2 + 0.2 + i * 0.37, y + h * 0.6, z - d / 2], [-w / 2 + 0.2 + i * 0.37, y + h * 0.6, z - d / 2 - 0.12], 0.016, 3), P.woodD, 0);
  }
}

function buildBarracks(k, P, st) {
  const y = PLINTH;
  const hz = -0.45;
  const hw = 2.5;
  const hd = 1.45;
  const round = isRound(st) && st.roof === 'thatch_cone';
  const wh = 0.95;
  let top;
  if (round) {
    hall(k, P, st, { x: -0.32, z: -0.34, w: 1.95, d: 1.95, h: 0.75, rh: 1.05, doorW: 0.34, lim: 1.4 });
    top = hall(k, P, st, { x: 0.8, z: -0.74, w: 1.0, d: 1.0, h: 0.55, rh: 0.65, lim: 1.4 });
  } else {
    top = hall(k, P, st, { x: 0, z: hz, w: hw, d: hd, h: wh, grade: 'mid', round: false, doorW: 0.42, doorH: 0.6, windows: 2, lim: 1.4 });
    const fz = hz + hd / 2 + (st.ornament === 'columns' ? 0 : 0);
    if (st.ornament !== 'columns') {
      banner(k, P, -0.75, y + wh - 0.08, fz + (st.wall === 'mudbrick' ? -0.02 : 0), 0.24, 0.42);
      banner(k, P, 0.75, y + wh - 0.08, fz + (st.wall === 'mudbrick' ? -0.02 : 0), 0.24, 0.42);
    }
  }
  // training yard
  const yz = 0.85;
  k.b(box(2.5, 0.015, 0.95, 0, y, yz), shade(P.yard, 0.92), 0.05);
  // weapon rack
  const rx = -0.85;
  for (const sx of [-1, 1]) k.b(box(0.05, 0.42, 0.05, rx + sx * 0.25, y, yz - 0.1), P.woodD, 0.03);
  k.b(box(0.6, 0.04, 0.05, rx, y + 0.36, yz - 0.1), P.woodD, 0);
  for (let i = 0; i < 4; i++) {
    const sx = rx - 0.2 + i * 0.13;
    k.b(pole([sx, y, yz - 0.02], [sx + 0.02, y + 0.62, yz - 0.13], 0.012, 3), P.wood, 0);
    k.b(cone(0.025, 0.08, 4, sx + 0.02, y + 0.61, yz - 0.13), P.metal, 0);
  }
  // training dummy
  const dx = 0.15;
  k.b(box(0.05, 0.55, 0.05, dx, y, yz + 0.05), P.woodD, 0.03);
  k.b(box(0.36, 0.04, 0.04, dx, y + 0.42, yz + 0.05), P.woodD, 0);
  k.b(dodeca(0.1, dx, y + 0.6, yz + 0.05), P.sack, 0.08);
  k.b(box(0.16, 0.2, 0.1, dx, y + 0.28, yz + 0.05), P.sack, 0.08);
  // archery target (team-colored bullseye)
  const tx = 0.85;
  k.b(strut([tx - 0.12, y, yz - 0.05], [tx, y + 0.45, yz], 0.035), P.woodD, 0);
  k.b(strut([tx + 0.12, y, yz - 0.05], [tx, y + 0.45, yz], 0.035), P.woodD, 0);
  const tg = cyl(0.2, 0.2, 0.05, 8, 0, 0, 0);
  tg.rotateX(PI / 2 - 0.25);
  tg.translate(tx, y + 0.42, yz + 0.04);
  k.b(tg, P.cloth, 0.03);
  const ring = cyl(0.13, 0.13, 0.05, 8, 0, 0, 0);
  ring.rotateX(PI / 2 - 0.25);
  ring.translate(tx, y + 0.42, yz + 0.05);
  k.t(ring, 1);
  // shield wall beside the target
  for (let i = 0; i < 2; i++) shield(k, P, 1.0 + i * 0.0, y + 0.18 + i * 0.25, yz + 0.38, 0.08);
  // fence posts along the yard sides
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) k.b(box(0.05, 0.28, 0.05, sx * 1.28, y, 0.45 + i * 0.4), P.woodD, 0.03);
    k.b(box(0.03, 0.03, 0.85, sx * 1.28, y + 0.2, 0.85), P.wood, 0);
  }
  flag(k, P, 1.22, y, 1.25, 1.5, 0.38, 0.24);
  return top;
}

function buildShrine(k, P, st) {
  const y = PLINTH;
  const sc = st.wall === 'marble' ? P.stoneL : P.stone;
  const py = steps(k, P, 1.62, 1.62, y, 2, 0.08, 0.1, sc);
  switch (st.ornament) {
    case 'knots': {
      // stone circle around a sacred fire and a carved altar stone
      for (let i = 0; i < 7; i++) {
        const a = PI / 2 + ((i + 1) * PI * 2) / 8;
        const r = 0.6;
        standingStone(k, P, Math.cos(a) * r, py, Math.sin(a) * r, 0.62 + (i % 2) * 0.12, Math.atan2(-Math.cos(a), -Math.sin(a)));
      }
      k.b(box(0.42, 0.2, 0.26, 0, py, -0.18), P.stoneD, 0.08);
      firePit(k, P, 0, py, 0.22, 1.1);
      flag(k, P, 0.72, y, 0.72, 1.2, 0.28, 0.17);
      return;
    }
    case 'torii': {
      // small hokora shrine house on a stone base, with a torii in front
      k.b(box(0.62, 0.22, 0.56, 0, py, -0.3), P.stone, 0.04);
      hall(k, P, st, { x: 0, z: -0.3, w: 0.56, d: 0.5, y: py + 0.22, h: 0.36, rh: 0.26, round: false, doorW: 0.18, doorH: 0.22, team: true });
      torii(k, P, 0, py, 0.48, 0.92, 0.82);
      stoneLantern(k, P, -0.58, py, 0.08, 0.42);
      stoneLantern(k, P, 0.58, py, 0.08, 0.42);
      k.t(box(0.4, 0.05, 0.03, 0, py + 0.66, 0.48 + 0.06), 1);
      standard(k, P, -0.74, y, -0.62, 1.15, 0.13, 0.55);
      standard(k, P, 0.6, y, -0.62, 1.15, 0.13, 0.55);
      return;
    }
    default:
      break;
  }
  // canopy shrine: posts or columns carrying a small roof over a golden idol, sacred flame in front
  const cw = 1.08;
  const cd = 0.86;
  const cz = -0.22;
  const ph = 0.72;
  const round = isRound(st);
  if (round) {
    const r = 0.5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + PI / 6;
      k.b(box(0.07, ph, 0.07, Math.sin(a) * r, py, cz + Math.cos(a) * r), st.wall === 'mudbrick' ? P.wall : P.woodD, 0.03);
    }
    roundRoof(k, P, st, { x: 0, z: cz, r: r + 0.02, y: py + ph, h: st.roof === 'dome' ? 0.42 : 0.62, team: true });
  } else {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = (sx * cw) / 2 - sx * 0.06;
      const pz = cz + (sz * cd) / 2 - sz * 0.06;
      if (st.ornament === 'columns' || st.wall === 'marble') column(k, P, px, py, pz, ph, 0.06);
      else k.b(box(0.08, ph, 0.08, px, py, pz), st.wall === 'lacquer' ? P.wall : st.wall === 'timber' ? P.woodD : P.wallD, 0.03);
    }
    k.b(box(cw, 0.07, cd, 0, py + ph - 0.07, cz), st.wall === 'lacquer' ? P.wall : P.wallL, 0.03);
    k.b(box(cw, ph * 0.75, 0.05, 0, py, cz - cd / 2 + 0.04), st.wall === 'lacquer' ? P.infill : P.wallD, 0.04);
    rectRoof(k, P, st, { x: 0, z: cz, w: cw, d: cd, y: py + ph, h: roofH(st, Math.min(cw, cd), 'small'), grade: 'small', team: true, ridge: st.roof === 'gable' ? 'z' : undefined, tiers: 1 });
  }
  idol(k, P, 0, py, cz - 0.08, 0.72);
  brazier(k, P, 0, py, 0.38, 0.75, 0.22);
  if (st.ornament !== 'columns') ornamentPair(k, P, st, 0.6, py, 0.6, 0.5);
  else {
    k.b(box(0.3, 0.12, 0.2, -0.5, py, 0.55), P.stoneL, 0.02);
    k.b(box(0.3, 0.12, 0.2, 0.5, py, 0.55), P.stoneL, 0.02);
    brazier(k, P, -0.5, py + 0.12, 0.55, 0.45, 0.1);
    brazier(k, P, 0.5, py + 0.12, 0.55, 0.45, 0.1);
  }
  flag(k, P, -0.74, y, -0.74, 1.3, 0.28, 0.17);
}

// ---- temples: the pantheon-defining building, one composition per roof style ----

function templeGable(k, P, st) {
  const y = PLINTH;
  const sc = st.wall === 'marble' ? P.stoneL : P.stone;
  const top0 = steps(k, P, 2.72, 2.72, y, 3, 0.08, 0.07, sc);
  const W = 2.3;
  const D = 2.3;
  const ch = 1.12;
  // cella
  rectWalls(k, P, st, { x: 0, z: -0.05, w: 1.3, d: 1.55, y: top0, h: ch, doorW: 0.34, doorH: 0.68 });
  // peristyle
  const cols = [];
  for (let i = 0; i < 6; i++) {
    const cx = -W / 2 + 0.1 + (i * (W - 0.2)) / 5;
    cols.push([cx, D / 2 - 0.1], [cx, -D / 2 + 0.1]);
  }
  for (let i = 1; i < 4; i++) {
    const cz = -D / 2 + 0.1 + (i * (D - 0.2)) / 4;
    cols.push([-W / 2 + 0.1, cz], [W / 2 - 0.1, cz]);
  }
  for (const [cx, cz] of cols) column(k, P, cx, top0, cz, ch, 0.075, st.wall === 'marble' ? P.wallL : P.wall);
  // entablature with frieze
  k.b(box(W + 0.06, 0.16, D + 0.06, 0, top0 + ch, 0), st.wall === 'marble' ? P.wallL : P.wall, 0.02);
  k.b(box(W + 0.08, 0.06, D + 0.08, 0, top0 + ch + 0.05, 0), P.trim, 0.02);
  for (let i = 0; i < 9; i++) k.b(box(0.06, 0.06, 0.02, -W / 2 + 0.15 + (i * (W - 0.3)) / 8, top0 + ch + 0.05, D / 2 + 0.045), P.accent, 0);
  const top = roofGable(k, P, st, { x: 0, z: 0, w: W + 0.04, d: D + 0.04, y: top0 + ch + 0.16, h: 0.58, ridge: 'z', grade: 'grand', team: true });
  // cult statue before the door and team banners between the front columns
  idol(k, P, 0, top0, 0.88, 0.95);
  for (const sx of [-1, 1]) banner(k, P, sx * 0.64, top0 + ch - 0.02, D / 2 - 0.12, 0.2, 0.5);
  brazier(k, P, -0.42, y + 0.24, 1.25, 0.6, 0.15);
  brazier(k, P, 0.42, y + 0.24, 1.25, 0.6, 0.15);
  return top;
}

function templeLonghouse(k, P, st) {
  const y = PLINTH;
  // great hof with a raised clerestory roof, stave-church style
  const top1 = hall(k, P, st, { x: 0, z: -0.25, w: 2.4, d: 1.5, h: 0.9, rh: 0.95, grade: 'mid', doorW: 0.4, doorH: 0.58, lim: 1.4 });
  const y2 = y + 0.9 + 0.62;
  k.b(box(1.2, 0.42, 0.75, 0, y2 - 0.06, -0.25), P.wallD, 0.06);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(box(0.07, 0.42, 0.07, sx * 0.6, y2 - 0.06, -0.25 + sz * 0.375), P.woodD, 0.03);
  const top2 = roofLonghouse(k, P, st, { x: 0, z: -0.25, w: 1.2, d: 0.75, y: y2 + 0.36, h: 0.62, grade: 'grand', team: true });
  // entrance porch
  k.b(box(0.62, 0.5, 0.36, 0, y, 0.62), P.wall, 0.06);
  roofGable(k, P, { ...st, ornament: 'none' }, { x: 0, z: 0.64, w: 0.66, d: 0.42, y: y + 0.5, h: 0.32, ridge: 'z', team: false });
  k.b(box(0.26, 0.38, 0.03, 0, y, 0.82), P.dark, 0);
  // carved pillars with shields, sacred fire
  for (const sx of [-1, 1]) {
    carvedPost(k, P, sx * 0.85, y, 0.95, 1.05);
    shield(k, P, sx * 0.85, y + 0.5, 0.95 + 0.07, 0.11);
    standard(k, P, sx * 1.22, y, 0.62, 1.45, 0.2, 0.62);
  }
  firePit(k, P, 0, y, 1.15, 1.0);
  return Math.max(top1, top2);
}

function templePyramid(k, P, st) {
  const y = PLINTH;
  // pyramid with a golden capstone behind a pylon gateway with flagpoles and obelisks
  const pz = -0.32;
  const ph = 2.0;
  k.b(box(2.1, 0.12, 2.0, 0, y, pz), P.stoneD, 0.04);
  const B = 0.98;
  k.b(hipLoft({ cx: 0, cz: pz, y: y + 0.12, hw: B, hd: B * 0.95, tw: B * 0.16, td: B * 0.16 * 0.95, h: ph * 0.84, steps: 1 }), P.roof, 0.05);
  k.b(hipLoft({ cx: 0, cz: pz, y: y + 0.12 + ph * 0.84, hw: B * 0.16, hd: B * 0.16 * 0.95, h: ph * 0.16, steps: 1 }), P.accent, 0);
  for (let i = 1; i < 5; i++) {
    const f = i / 5;
    k.b(box(2 * B * (1 - f * 0.84) + 0.012, 0.02, 0.02, 0, y + 0.12 + ph * 0.84 * f, pz + B * 0.95 * (1 - f * 0.84)), P.roofD, 0);
  }
  // pylons
  const pyz = 0.82;
  for (const sx of [-1, 1]) {
    const px = sx * 0.62;
    k.b(frustum(0.82, 1.25, 0.42, 0.8, px, y, pyz, 0.85), P.wall, 0.04);
    k.b(box(0.82 * 0.8 + 0.08, 0.1, 0.42 * 0.85 + 0.08, px, y + 1.2, pyz), P.trim, 0.02);
    k.b(box(0.82 * 0.8 + 0.06, 0.03, 0.42 * 0.85 + 0.06, px, y + 1.17, pyz), P.accent, 0);
    k.b(box(0.36, 0.5, 0.02, px, y + 0.42, pyz + 0.19), P.trimD, 0.05);
    k.b(ball(0.05, px, y + 0.82, pyz + 0.2, 5, 3), P.accent, 0);
    flag(k, P, px + sx * 0.18 - 0.08, y, pyz + 0.3, 1.65, 0.32, 0.2);
    obelisk(k, P, sx * 1.18, y, 1.0, 1.15);
  }
  // gate and lintel with a winged sun disk
  k.b(box(0.44, 0.08, 0.4, 0, y + 0.92, pyz), P.trim, 0.02);
  k.b(box(0.42, 0.84, 0.03, 0, y, pyz - 0.1), P.dark, 0);
  k.b(cyl(0.07, 0.07, 0.03, 8, 0, 0, 0).rotateX(PI / 2).translate(0, y + 0.96, pyz + 0.22), P.accent, 0);
  for (const sx of [-1, 1]) k.b(box(0.18, 0.05, 0.02, sx * 0.15, y + 0.95, pyz + 0.215), P.accent, 0);
  return y + 0.12 + ph;
}

function templeShikhara(k, P, st) {
  const y = PLINTH;
  // raised platform (jagati) with steps, sanctum tower and a pillared hall in front
  const top0 = steps(k, P, 2.7, 2.7, y, 2, 0.1, 0.08, P.stoneD);
  k.b(box(2.5, 0.04, 2.5, 0, top0, 0), P.wallD, 0.03);
  const py = top0 + 0.04;
  // sanctum
  const sz = -0.42;
  k.b(box(1.3, 0.75, 1.3, 0, py, sz), P.wall, 0.04);
  frieze(k, P, 0, sz + 0.65, 1.25, py + 0.55);
  k.b(box(1.38, 0.08, 1.38, 0, py + 0.72, sz), P.trim, 0.02);
  const top = roofShikhara(k, P, st, { x: 0, z: sz, w: 1.28, d: 1.28, y: py + 0.8, h: 1.8, grade: 'grand', team: true });
  // mandapa hall
  const mz = 0.62;
  k.b(box(1.15, 0.06, 0.95, 0, py, mz), P.stone, 0.02);
  for (const sx of [-1, 1]) for (const zz of [-0.35, 0.05, 0.42]) k.b(cyl(0.05, 0.06, 0.55, 6, sx * 0.48, py + 0.06, mz + zz, true), P.wallL, 0.03);
  k.b(box(1.15, 0.08, 0.95, 0, py + 0.6, mz), P.trim, 0.02);
  // stepped pyramidal hall roof (phamsana)
  for (let i = 0; i < 4; i++) {
    const s = 1 - i * 0.2;
    k.b(frustum(1.2 * s, 0.11, 1.0 * s, 0.88, 0, py + 0.68 + i * 0.11, mz), i % 2 ? P.roofD : P.roof, 0.03);
  }
  k.b(ball(0.07, 0, py + 1.15, mz, 6, 3), P.accent, 0);
  idol(k, P, 0, py, mz - 0.05, 0.62);
  for (const sx of [-1, 1]) {
    banner(k, P, sx * 0.4, py + 0.58, mz + 0.48, 0.18, 0.34);
    k.b(box(0.14, 0.3, 0.2, sx * 1.12, py, 1.1), P.stone, 0.03);
    brazier(k, P, sx * 1.12, py + 0.3, 1.1, 0.5, 0.1);
  }
  k.t(box(2.52, 0.05, 2.52, 0, top0 - 0.03, 0), 1);
  return top;
}

function templePagoda(k, P, st) {
  const y = PLINTH;
  const top0 = steps(k, P, 2.5, 2.5, y, 1, 0.12, 0, P.stone);
  // three-tier pagoda on the back half, torii and stone lanterns in front, nobori banners
  const pz = -0.38;
  k.b(box(1.3, 0.12, 1.3, 0, top0, pz), P.stoneD, 0.03);
  rectWalls(k, P, st, { x: 0, z: pz, w: 1.08, d: 1.08, y: top0 + 0.12, h: 0.55, doorW: 0.24, doorH: 0.38 });
  const top = roofPagoda(k, P, st, { x: 0, z: pz, w: 1.08, d: 1.08, y: top0 + 0.67, h: 1.15, tiers: 3, grade: 'grand', team: true });
  if (st.ornament === 'torii') torii(k, P, 0, top0, 0.95, 1.5, 1.05);
  else ornamentPair(k, P, st, 0.8, top0, 0.95, 0.7);
  for (const sx of [-1, 1]) {
    stoneLantern(k, P, sx * 0.62, top0, 0.42, 0.5);
    standard(k, P, sx * 1.12, y, -0.2, 1.5, 0.17, 0.75);
  }
  k.t(box(1.32, 0.04, 1.32, 0, top0 + 0.09, pz), 1);
  return top;
}

function templeCurved(k, P, st) {
  const y = PLINTH;
  // terrace with balustrade, red-pillared hall under a double-eaved sweeping roof, lanterns
  const top0 = steps(k, P, 2.72, 2.6, y, 2, 0.12, 0.09, P.stoneL, 0, -0.03);
  for (const sx of [-1, 1]) k.b(box(0.04, 0.12, 2.3, sx * 1.2, top0, -0.03), P.stoneL, 0.02);
  k.b(box(0.7, 0.12, 0.04, -0.85, top0, 1.12), P.stoneL, 0.02);
  k.b(box(0.7, 0.12, 0.04, 0.85, top0, 1.12), P.stoneL, 0.02);
  stair(k, P, 0, y, top0, 1.36, 1.14, 0.5, P.stoneL);
  const hz = -0.18;
  rectWalls(k, P, st, { x: 0, z: hz, w: 1.85, d: 1.2, y: top0, h: 0.85, doorW: 0.36, doorH: 0.58, windows: 1 });
  // front colonnade (red pillars)
  for (let i = 0; i < 4; i++) k.b(cyl(0.05, 0.055, 0.85, 6, -0.82 + i * 0.547, top0, hz + 0.78, true), P.wall, 0.03);
  k.b(box(1.85, 0.08, 0.36, 0, top0 + 0.78, hz + 0.68), P.beam, 0.02);
  const top = roofCurved(k, P, st, { x: 0, z: hz + 0.1, w: 1.95, d: 1.45, y: top0 + 0.85, h: 0.82, grade: 'grand', team: true });
  for (let i = 0; i < 4; i++) hangingLantern(k, P, -0.82 + i * 0.547, top0 + 0.78, hz + 0.82, 0.12);
  for (const sx of [-1, 1]) {
    k.b(box(0.22, 0.12, 0.22, sx * 0.55, y, 1.2), P.stone, 0.03);
    k.b(box(0.15, 0.2, 0.25, sx * 0.55, y + 0.12, 1.2), P.accentD, 0.05);
    k.b(ball(0.08, sx * 0.55, y + 0.37, 1.24, 6, 4), P.accentD, 0.05);
    standard(k, P, sx * 1.2, top0, 0.95, 1.2, 0.16, 0.55);
  }
  return top;
}

function templeStepped(k, P, st) {
  const y = PLINTH;
  const mud = st.wall === 'mudbrick' || st.wall === 'brick';
  if (mud) {
    // ziggurat: buttressed terraces, a long front stairway and a shrine on top
    const tiers = [[2.6, 2.1, 0.5], [1.95, 1.6, 0.45], [1.35, 1.1, 0.4]];
    let yy = y;
    let zc = -0.25;
    for (let i = 0; i < tiers.length; i++) {
      const [tw, td, th] = tiers[i];
      k.b(frustum(tw, th, td, 0.95, 0, yy, zc, 0.95), i % 2 ? P.wallD : P.wall, 0.05);
      const nb = Math.round(tw / 0.32);
      for (let b = 0; b < nb; b++) {
        k.b(box(0.06, th * 0.9, 0.03, -tw / 2 + 0.16 + (b * (tw - 0.32)) / (nb - 1), yy, zc + td / 2 - 0.005), P.wallD, 0);
      }
      k.b(box(tw * 0.95 + 0.04, 0.04, td * 0.95 + 0.04, 0, yy + th - 0.03, zc), P.trim, 0.02);
      yy += th;
      zc -= 0.06;
    }
    stair(k, P, 0, y, yy - 0.42, 1.22, 0.35, 0.32, P.wallL);
    stair(k, P, 0, yy - 0.42, yy, 0.42, 0.0, 0.26, P.wallL);
    // shrine on top with blue glazed walls
    k.b(box(0.7, 0.42, 0.55, 0, yy, zc), P.trim, 0.04);
    k.b(box(0.76, 0.06, 0.6, 0, yy + 0.42, zc), P.accent, 0.02);
    k.b(box(0.18, 0.28, 0.03, 0, yy, zc + 0.28), P.dark, 0);
    for (let i = 0; i < 4; i++) k.b(box(0.1, 0.1, 0.06, -0.3 + i * 0.2, yy + 0.48, zc + 0.27), P.wallL, 0.02);
    flag(k, P, 0.3, yy + 0.48, zc - 0.15, 0.6, 0.3, 0.18);
    k.t(box(2.62, 0.05, 2.12, 0, y + 0.47, -0.25), 1);
    for (const sx of [-1, 1]) {
      if (st.ornament === 'winged_bulls') lamassu(k, P, sx * 0.42, y, 1.0, 0.85);
      else ornament(k, P, st, sx * 0.42, y, 1.0, 0.75, sx);
      banner(k, P, sx * 0.95, y + 0.45, 0.79, 0.22, 0.32);
    }
    return yy + 1.15;
  }
  // Mesoamerican pyramid: steep stepped tiers, twin stair, twin shrines on top
  const tiers = [[2.62, 0.38], [2.22, 0.38], [1.82, 0.38], [1.42, 0.38]];
  let yy = y;
  for (let i = 0; i < tiers.length; i++) {
    const [tw, th] = tiers[i];
    k.b(frustum(tw, th, tw * 0.94, 0.94, 0, yy, -0.1, 0.94), P.wall, 0.05);
    k.b(box(tw * 0.94 + 0.02, 0.05, tw * 0.94 * 0.94 + 0.02, 0, yy + th - 0.08, -0.1), shade(P.wall, 0.82), 0.02);
    yy += th;
  }
  const sw = 0.62;
  stair(k, P, 0, y, yy, 1.26, 0.55, sw, P.stoneL);
  for (const sx of [-1, 1]) k.b(strut([sx * (sw / 2 + 0.05), y + 0.08, 1.2], [sx * (sw / 2 + 0.05), yy + 0.06, 0.55], 0.1, 0.1), P.trim, 0.03);
  // twin shrines (one in roof red, one in trim teal)
  for (const sx of [-1, 1]) {
    const sxp = sx * 0.33;
    const c = sx < 0 ? P.trim : P.roof;
    k.b(box(0.5, 0.42, 0.62, sxp, yy, -0.32), P.wallL, 0.03);
    k.b(box(0.16, 0.26, 0.03, sxp, yy, -0.0), P.dark, 0);
    k.b(frustum(0.54, 0.32, 0.66, 0.85, sxp, yy + 0.42, -0.32), c, 0.04);
    for (let i = 0; i < 3; i++) k.b(box(0.08, 0.1, 0.08, sxp - 0.16 + i * 0.16, yy + 0.74, -0.06), c, 0.03);
    k.t(box(0.5, 0.08, 0.02, sxp, yy + 0.26, -0.005), 1);
    brazier(k, P, sx * 0.62, yy, 0.18, 0.5, 0.12);
  }
  for (const sx of [-1, 1]) {
    if (st.ornament === 'serpents') serpentHead(k, P, sx * (sw / 2 + 0.05), y, 1.02, 0.95);
    else ornament(k, P, st, sx * (sw / 2 + 0.15), y, 1.12, 0.6, sx);
    standard(k, P, sx * 1.25, y, 1.15, 1.25, 0.16, 0.5);
  }
  k.t(box(2.64, 0.05, 2.48, 0, y + 0.3, -0.1), 1);
  return yy + 0.9;
}

function templeThatch(k, P, st) {
  const y = PLINTH;
  // great roundhouse inside a ring of standing stones, sacred fire at the entrance
  const top = hall(k, P, st, { x: 0, z: -0.28, w: 1.72, d: 1.72, h: 0.62, rh: 1.45, grade: 'grand', doorW: 0.3, doorH: 0.45, lim: 1.4 });
  const n = 10;
  for (let i = 1; i < n; i++) {
    const a = PI / 2 + (i * PI * 2) / n;
    const r = 1.15;
    const sx = Math.cos(a) * r;
    const sz = Math.sin(a) * r - 0.05;
    if (st.ornament === 'knots') standingStone(k, P, sx, y, sz, 0.75 + (i % 3) * 0.1, Math.atan2(-Math.cos(a), -Math.sin(a)));
    else ornament(k, P, st, sx, y, sz, 0.6, sx < 0 ? -1 : 1);
  }
  firePit(k, P, 0, y, 0.95, 1.2);
  for (const sx of [-1, 1]) standard(k, P, sx * 0.48, y, 0.85, 1.3, 0.18, 0.55);
  return top;
}

function templeDome(k, P, st) {
  const y = PLINTH;
  // Sudano-Sahelian sanctuary: battered mudbrick walls bristling with toron, buttress towers, domes
  const hz = -0.3;
  const W = 2.3;
  const D = 1.6;
  const h = 1.05;
  rectWalls(k, P, st, { x: 0, z: hz, w: W, d: D, y, h, doorW: 0.34, doorH: 0.62 });
  k.b(box(W + 0.02, 0.06, D + 0.02, 0, y + h, hz), P.wallD, 0.03);
  const top = roofFlatDome(k, P, { ...st, ornament: 'none' }, { x: 0, z: hz - 0.1, w: W * 0.7, d: D * 0.8, y: y + h + 0.06, h: 0.55, grade: 'grand', team: true });
  // buttress towers along the front
  const fz = hz + D / 2;
  for (const bx of [-1.05, -0.5, 0.5, 1.05]) pinnacle(k, P, bx, y, fz + 0.03, 1.5 + (Math.abs(bx) < 0.7 ? 0.25 : 0), 0.26);
  // the central tower over the door
  k.b(frustum(0.5, 1.75, 0.3, 0.6, 0, y, fz + 0.06, 0.7), P.wall, 0.04);
  k.b(cone(0.11, 0.35, 6, 0, y + 1.75, fz + 0.06), P.wall, 0);
  k.b(ball(0.06, 0, y + 2.12, fz + 0.06, 5, 4, 1.3), P.white, 0);
  for (let i = 0; i < 3; i++) k.b(pole([-0.18, y + 0.85 + i * 0.3, fz + 0.2], [0.18, y + 0.85 + i * 0.3, fz + 0.2], 0.018, 3), P.woodD, 0);
  k.b(box(0.34, 0.66, 0.06, 0, y, fz + 0.2), P.trim, 0.03);
  k.b(box(0.26, 0.56, 0.07, 0, y, fz + 0.21), P.dark, 0);
  for (const sx of [-1, 1]) {
    banner(k, P, sx * 0.77, y + 0.95, fz + 0.01, 0.2, 0.4);
    brazier(k, P, sx * 0.35, y, 1.15, 0.55, 0.25);
    standard(k, P, sx * 1.25, y, 1.05, 1.25, 0.16, 0.5);
  }
  return Math.max(top, y + 2.2);
}

function templeFlat(k, P, st) {
  const y = PLINTH;
  const top0 = steps(k, P, 2.7, 2.7, y, 2, 0.1, 0.08, P.stone);
  rectWalls(k, P, st, { x: 0, z: -0.3, w: 2.1, d: 1.5, y: top0, h: 1.15, doorW: 0.4, doorH: 0.7 });
  for (let i = 0; i < 6; i++) column(k, P, -0.95 + i * 0.38, top0, 0.6, 1.15, 0.07, P.wallL);
  k.b(box(2.2, 0.12, 0.4, 0, top0 + 1.15, 0.55), P.wallL, 0.02);
  const top = roofFlat(k, P, st, { x: 0, z: -0.15, w: 2.2, d: 1.85, y: top0 + 1.15, grade: 'grand', team: true });
  idol(k, P, 0, top0, 0.95, 0.8);
  ornamentPair(k, P, st, 1.05, y, 1.04, 0.8);
  for (const sx of [-1, 1]) banner(k, P, sx * 0.55, top0 + 1.1, 0.42, 0.2, 0.45);
  return top;
}

const TEMPLES = {
  gable: templeGable, longhouse: templeLonghouse, pyramid: templePyramid, shikhara: templeShikhara, pagoda: templePagoda,
  curved: templeCurved, stepped: templeStepped, thatch_cone: templeThatch, dome: templeDome, flat: templeFlat,
};

function buildTower(k, P, st) {
  const y = PLINTH;
  k.b(box(1.5, 0.03, 1.5, 0, y, 0), P.yard, 0.04);
  const s = isRound(st) ? 0.95 : 0.9;
  const top = towerStruct(k, P, st, { x: 0, z: 0, s, h: 2.0, team: true });
  if (st.wall !== 'timber') banner(k, P, 0, y + 1.85, isRound(st) ? s / 2 - 0.04 : s / 2 - 0.01, 0.24, 0.5);
  else {
    k.b(box(0.3, 0.04, 0.12, 0.42, y, 0.5), P.wood, 0.05);
    barrel(k, P, -0.55, y, 0.55, 0.24);
  }
  ornament(k, P, st, 0.6, y, 0.6, 0.45, 1);
  return top;
}

// ---- titan gate ----

const GATE = { px: 1.22, pw: 0.66, pd: 0.72, open: 2.9 };

function gatePillars(k, P, st, y) {
  const { px, pw, pd, open } = GATE;
  const H = open;
  for (const sx of [-1, 1]) {
    const x = sx * px;
    switch (st.wall) {
      case 'timber':
        k.b(box(pw, 0.2, pd, x, y, 0), P.stoneD, 0.08);
        k.b(box(pw * 0.7, H, pd * 0.7, x, y + 0.2, 0), P.wood, 0.07);
        for (let i = 0; i < 4; i++) k.b(box(pw * 0.76, 0.08, pd * 0.76, x, y + 0.45 + i * 0.65, 0), i % 2 ? P.accent : P.trim, 0.03);
        break;
      case 'lacquer':
        k.b(cyl(pw * 0.32, pw * 0.36, H + 0.2, 8, x, y, 0, true), P.wall, 0.03);
        k.b(cyl(pw * 0.45, pw * 0.45, 0.18, 8, x, y, 0), P.dark, 0.02);
        break;
      case 'marble':
        for (const ox of [-1, 1]) column(k, P, x + ox * pw * 0.22, y, pd * 0.18 * ox, H + 0.2, 0.13, P.wallL);
        k.b(box(pw + 0.06, 0.12, pd, x, y, 0), P.stoneL, 0.02);
        break;
      case 'sandstone':
      case 'mudbrick':
        k.b(frustum(pw + 0.15, H + 0.2, pd + 0.1, 0.72, x, y, 0, 0.8), P.wall, 0.05);
        k.b(box((pw + 0.15) * 0.72 + 0.08, 0.1, (pd + 0.1) * 0.8 + 0.08, x, y + H + 0.1, 0), st.wall === 'mudbrick' ? P.wallL : P.trim, 0.02);
        if (st.ornament === 'spikes') {
          for (let i = 0; i < 4; i++) {
            const yy = y + 0.6 + i * 0.6;
            const ww = ((pw + 0.15) / 2) * (1 - 0.28 * ((yy - y) / H));
            k.b(pole([x + sx * ww - sx * 0.02, yy, 0.1], [x + sx * (ww + 0.14), yy, 0.1], 0.02, 3), P.woodD, 0);
            k.b(pole([x, yy + 0.25, ((pd + 0.1) / 2) * (1 - 0.2 * ((yy - y) / H)) - 0.02], [x, yy + 0.25, ((pd + 0.1) / 2) + 0.12], 0.02, 3), P.woodD, 0);
          }
        }
        break;
      case 'brick':
        k.b(box(pw, H + 0.2, pd, x, y, 0), P.trim, 0.06);
        for (let i = 0; i < 3; i++) k.b(box(0.3, 0.3, 0.03, x, y + 0.5 + i * 0.85, pd / 2 + 0.005), P.accent, 0.04);
        break;
      case 'stone':
      default:
        k.b(box(pw, H + 0.2, pd, x, y, 0), P.wall, 0.08);
        for (let i = 0; i < 5; i++) k.b(box(pw + 0.04, 0.06, pd + 0.04, x, y + 0.3 + i * 0.6, 0), P.wallD, 0.04);
        break;
    }
  }
  return y + H + 0.2;
}

function gateTop(k, P, st, y) {
  const span = GATE.px * 2 + GATE.pw + 0.2;
  const d = GATE.pd;
  switch (st.roof) {
    case 'gable': {
      k.b(box(span, 0.22, d, 0, y, 0), P.wallL, 0.02);
      k.b(box(span + 0.04, 0.07, d + 0.04, 0, y + 0.08, 0), P.trim, 0.02);
      const ped = solid([
        [[-span / 2, 0, 0.12], [span / 2, 0, 0.12], [0, 0.62, 0.12]],
        [[-span / 2, 0, -0.12], [0, 0.62, -0.12], [span / 2, 0, -0.12]],
        [[-span / 2, 0, 0.12], [0, 0.62, 0.12], [0, 0.62, -0.12]], [[-span / 2, 0, 0.12], [0, 0.62, -0.12], [-span / 2, 0, -0.12]],
        [[span / 2, 0, 0.12], [span / 2, 0, -0.12], [0, 0.62, -0.12]], [[span / 2, 0, 0.12], [0, 0.62, -0.12], [0, 0.62, 0.12]],
      ]);
      ped.translate(0, y + 0.22, 0);
      k.b(ped, P.wallL, 0.02);
      const tym = fromTris([[[-span / 2 + 0.25, 0.06, 0.125], [span / 2 - 0.25, 0.06, 0.125], [0, 0.48, 0.125]]]);
      tym.translate(0, y + 0.22, 0);
      k.b(tym, P.trim, 0);
      k.t(box(span + 0.06, 0.06, 0.28, 0, y + 0.2, 0), 1);
      k.b(cone(0.08, 0.22, 4, 0, y + 0.84, 0), P.accent, 0);
      for (const sx of [-1, 1]) k.b(cone(0.07, 0.2, 4, sx * span / 2, y + 0.22, 0), P.accent, 0);
      return y + 1.06;
    }
    case 'longhouse': {
      // arched beam crowned with dragon heads
      const pts = [];
      const N = 6;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push([-span / 2 + span * t, 0.4 * Math.sin(PI * t)]);
      }
      for (let i = N; i >= 0; i--) {
        const t = i / N;
        pts.push([-span / 2 + span * t, 0.25 + 0.42 * Math.sin(PI * t)]);
      }
      const arch = extrude(pts, 0.3);
      arch.translate(0, y - 0.1, 0);
      k.b(arch, P.wood, 0.06);
      k.t(box(span * 0.5, 0.08, 0.32, 0, y + 0.47, 0), 1);
      for (const sx of [-1, 1]) {
        const hx = sx * span / 2;
        k.b(strut([hx - sx * 0.04, y + 0.1, 0], [hx, y + 0.56, 0], 0.12), P.trim, 0.04);
        k.b(strut([hx, y + 0.56, 0], [hx + sx * 0.16, y + 0.64, 0], 0.13, 0.1), P.trim, 0.04);
        k.b(strut([hx + sx * 0.02, y + 0.48, 0], [hx + sx * 0.13, y + 0.5, 0], 0.05, 0.08), P.trim, 0.04);
        k.b(box(0.04, 0.05, 0.14, hx + sx * 0.08, y + 0.7, 0), P.accent, 0);
      }
      return y + 0.75;
    }
    case 'pyramid': {
      k.b(box(span * 0.62, 0.26, d * 0.8, 0, y, 0), P.wall, 0.03);
      k.b(box(span * 0.62 + 0.08, 0.1, d * 0.8 + 0.08, 0, y + 0.22, 0), P.trim, 0.02);
      k.b(cyl(0.16, 0.16, 0.04, 10, 0, 0, 0).rotateX(PI / 2).translate(0, y + 0.13, d * 0.4 + 0.02), P.accent, 0);
      for (const sx of [-1, 1]) {
        const wing = box(0.55, 0.09, 0.03, sx * 0.43, y + 0.09, d * 0.4 + 0.015);
        k.b(wing, P.accent, 0.04);
      }
      for (const sx of [-1, 1]) k.b(hipLoft({ cx: sx * GATE.px, cz: 0, y: y, hw: 0.32, hd: 0.3, h: 0.35, steps: 1 }), P.accent, 0);
      return y + 0.4;
    }
    case 'shikhara': {
      k.b(box(span, 0.18, d, 0, y, 0), P.wall, 0.03);
      frieze(k, P, 0, d / 2, span * 0.9, y + 0.05);
      let yy = y + 0.18;
      for (let i = 0; i < 5; i++) {
        const s = 1 - i * 0.15;
        k.b(frustum(span * 0.86 * s, 0.17, d * 0.9 * s, 0.94, 0, yy, 0), i % 2 ? P.roofD : P.roof, 0.03);
        for (let j = 0; j < 3; j++) k.b(ball(0.04, -span * 0.3 * s + j * span * 0.3 * s, yy + 0.2, d * 0.42 * s, 4, 3), P.accent, 0);
        yy += 0.17;
      }
      k.b(cyl(0.13, 0.13, 0.07, 8, 0, yy, 0), P.roofL, 0.05);
      k.b(ball(0.08, 0, yy + 0.15, 0, 6, 4, 1.2), P.accent, 0);
      k.t(box(span + 0.02, 0.05, d + 0.02, 0, y + 0.14, 0), 1);
      return yy + 0.25;
    }
    case 'pagoda': {
      if (st.ornament === 'torii') return y;
      k.b(box(span * 0.95, 0.12, d * 0.8, 0, y, 0), P.beam, 0.02);
      return roofPagoda(k, P, st, { x: 0, z: 0, w: span * 0.92, d: d * 0.9, y: y + 0.12, h: 0.7, tiers: 2, grade: 'mid', team: true });
    }
    case 'curved': {
      k.b(box(span, 0.16, d * 0.7, 0, y, 0), P.beam, 0.02);
      k.b(box(span * 0.7, 0.2, 0.04, 0, y - 0.32, d * 0.3), P.accent, 0.03);
      k.b(box(span * 0.4, 0.12, 0.05, 0, y - 0.28, d * 0.3 + 0.01), P.roofD, 0);
      roofCurved(k, P, st, { x: 0, z: 0, w: span * 0.55, d: d * 0.65, y: y + 0.16, h: 0.42, grade: 'small', team: true });
      for (const sx of [-1, 1]) roofCurved(k, P, st, { x: sx * GATE.px, z: 0, w: GATE.pw + 0.1, d: d * 0.62, y: y - 0.05, h: 0.3, grade: 'small', team: false });
      for (const sx of [-1, 1]) hangingLantern(k, P, sx * 0.65, y, d * 0.4, 0.16);
      return y + 0.8;
    }
    case 'stepped': {
      const mud = st.wall === 'mudbrick' || st.wall === 'brick';
      k.b(box(span, 0.3, d, 0, y, 0), mud ? P.trim : P.wall, 0.05);
      k.b(box(span * 0.75, 0.22, d * 0.85, 0, y + 0.3, 0), mud ? P.trim : P.wallD, 0.05);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const mx = -span * 0.375 + (i * span * 0.75) / (n - 1);
        k.b(box(0.13, 0.12, 0.13, mx, y + 0.52, d * 0.3), P.roof, 0.03);
        k.b(box(0.07, 0.08, 0.07, mx, y + 0.64, d * 0.3), P.roof, 0.03);
      }
      if (mud) {
        for (let i = 0; i < 4; i++) k.b(box(0.22, 0.14, 0.02, -0.6 + i * 0.4, y + 0.08, d / 2 + 0.005), P.accent, 0.03);
      } else {
        k.b(box(0.7, 0.14, 0.03, 0, y + 0.09, d / 2), P.trim, 0.03);
        k.b(box(0.18, 0.18, 0.04, 0, y + 0.07, d / 2 + 0.01), P.accent, 0);
      }
      k.t(box(span + 0.02, 0.06, d + 0.02, 0, y + 0.27, 0), 1);
      return y + 0.72;
    }
    case 'thatch_cone': {
      // trilithon lintel stone
      const g = box(span + 0.1, 0.36, d * 0.85, 0, y - 0.05, 0);
      const p = g.attributes.position;
      const rr = new RNG(7);
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + (rr.next() - 0.5) * 0.06);
      k.b(g, P.stone, 0.1);
      k.b(torus(0.15, 0.025, 0, y + 0.13, d * 0.43 + 0.01, 3, 10), P.accent, 0);
      for (const sx of [-1, 1]) k.b(torus(0.08, 0.018, sx * 0.48, y + 0.13, d * 0.43 + 0.01, 3, 8), P.accent, 0);
      k.t(box(span * 0.6, 0.05, d * 0.87, 0, y + 0.31, 0), 1);
      return y + 0.4;
    }
    case 'dome': {
      k.b(frustum(span * 0.85, 0.36, d * 0.85, 0.94, 0, y - 0.05, 0), P.wall, 0.04);
      k.b(dome(0.42, 0.4, 0, y + 0.31, 0, 8, 3), P.roof, 0.05);
      k.t(cyl(0.45, 0.45, 0.06, 8, 0, y + 0.29, 0, true), 1);
      k.b(ball(0.05, 0, y + 0.78, 0, 5, 4, 1.3), P.white, 0);
      for (const sx of [-1, 1]) pinnacle(k, P, sx * GATE.px, y - 0.05, 0, 0.75, 0.32);
      for (let i = 0; i < 5; i++) k.b(pole([-0.6 + i * 0.3, y + 0.15, d * 0.4], [-0.6 + i * 0.3, y + 0.15, d * 0.4 + 0.14], 0.02, 3), P.woodD, 0);
      return y + 1.0;
    }
    case 'flat':
    default:
      k.b(box(span, 0.28, d, 0, y, 0), P.wall, 0.04);
      k.b(box(span + 0.06, 0.08, d + 0.06, 0, y + 0.26, 0), P.trim, 0.02);
      k.t(box(span * 0.4, 0.15, 0.02, 0, y + 0.06, d / 2 + 0.01), 1);
      return y + 0.4;
  }
}

function buildTitanGate(k, P, st) {
  const y = PLINTH;
  const sc = st.wall === 'marble' ? P.stoneL : P.stone;
  const top0 = steps(k, P, 3.75, 3.6, y, 3, 0.09, 0.12, sc, 0, -0.05);
  stair(k, P, 0, y, top0, 1.78, 1.5, 1.2, shade(sc, 0.95));
  let top;
  if (st.ornament === 'torii' || (st.roof === 'pagoda' && st.wall === 'lacquer')) {
    // a colossal torii
    top = torii(k, P, 0, top0, 0, GATE.px * 2, GATE.open + 0.3);
    k.t(box(0.6, 0.35, 0.03, 0, top0 + GATE.open * 0.86, 0.07), 1);
  } else {
    const ty = gatePillars(k, P, st, top0);
    top = gateTop(k, P, st, ty);
  }
  // swirling vortex rim and runes on the ground
  const vy = top0 + 0.05 + GATE.open * 0.5;
  const rim = torus(1, 0.035, 0, 0, 0, 3, 18);
  rim.scale(0.84, (GATE.open * 0.5 - 0.02) / 1, 1);
  rim.translate(0, vy, 0);
  k.g(rim, tint(P.accent, 0.3));
  k.g(box(1.7, 0.012, 0.5, 0, top0, 0.32), shade(P.accent, 0.55));
  // team banners on the pillar fronts
  if (st.ornament !== 'torii') {
    for (const sx of [-1, 1]) banner(k, P, sx * GATE.px, top0 + GATE.open - 0.25, GATE.pd / 2 + (st.wall === 'sandstone' || st.wall === 'mudbrick' ? 0.02 : 0), 0.3, 0.85);
  }
  // braziers and ornaments at the front corners
  for (const sx of [-1, 1]) {
    k.b(box(0.3, 0.32, 0.3, sx * 1.45, top0, 1.25), P.stoneD, 0.04);
    brazier(k, P, sx * 1.45, top0 + 0.32, 1.25, 0.8, 0.12);
    ornament(k, P, st, sx * 1.5, top0, -1.15, 0.85, sx);
  }
  return Math.max(top, top0 + GATE.open);
}

// ---- town center (three tiers) ----

function buildTownCenter(k, P, st, tier) {
  const y = PLINTH;
  const round = isRound(st);
  if (tier <= 1) {
    let top;
    if (round) {
      top = hall(k, P, st, { x: -0.1, z: -0.35, w: 2.3, d: 2.3, h: 0.78, rh: st.roof === 'dome' ? 0.9 : 1.35, grade: 'mid', doorW: 0.4, doorH: 0.55, lim: 1.9 });
      hall(k, P, st, { x: 1.25, z: -1.2, w: 0.95, d: 0.95, h: 0.5, rh: st.roof === 'dome' ? 0.42 : 0.6, lim: 1.9 });
    } else {
      top = hall(k, P, st, { x: 0, z: -0.4, w: 2.55, d: 1.75, h: 0.95, grade: 'mid', doorW: 0.42, doorH: 0.62, windows: 2, lim: 1.9 });
      if (st.ornament !== 'columns') for (const sx of [-1, 1]) banner(k, P, sx * 0.72, y + 0.88, -0.4 + 1.75 / 2 + (st.wall === 'mudbrick' ? -0.02 : 0), 0.22, 0.36);
    }
    // well, firewood, crates, cart
    k.b(cyl(0.22, 0.24, 0.26, 8, -1.25, y, 1.2), P.stone, 0.1);
    k.b(cyl(0.16, 0.16, 0.02, 8, -1.25, y + 0.25, 1.2), C('#2a4a6a'), 0);
    for (const sx of [-1, 1]) k.b(box(0.04, 0.42, 0.04, -1.25 + sx * 0.2, y + 0.2, 1.2), P.woodD, 0);
    k.b(box(0.48, 0.04, 0.04, -1.25, y + 0.6, 1.2), P.woodD, 0);
    k.b(prep(new THREE.ConeGeometry(0.32, 0.18, 4, 1, true)).rotateY(PI / 4).translate(-1.25, y + 0.72, 1.2), P.roof, 0.05);
    logPile(k, P, 1.2, y, 1.25, 0.45, 0);
    crate(k, P, 1.45, y, 0.75, 0.2, 0.3);
    barrel(k, P, 1.2, y, 0.7, 0.26);
    sack(k, P, 0.75, y, 1.35, 0.22);
    firePit(k, P, 0.0, y, 1.25, 0.85);
    flag(k, P, 1.62, y, -0.2, 1.9, 0.44, 0.27);
    return top;
  }
  const half = 1.82;
  const gate = 1.0;
  if (tier === 2) {
    perimeter(k, P, st, { half, h: 0.42, gate, merlons: false });
    let top;
    if (round) {
      top = hall(k, P, st, { x: 0, z: -0.3, w: 2.25, d: 2.25, h: 0.95, rh: st.roof === 'dome' ? 1.0 : 1.55, grade: 'mid', doorW: 0.42, doorH: 0.6, lim: 1.75 });
      for (const sx of [-1, 1]) hall(k, P, st, { x: sx * 1.2, z: -1.15, w: 0.9, d: 0.9, h: 0.5, rh: st.roof === 'dome' ? 0.4 : 0.58, door: false, lim: 1.75 });
    } else {
      top = hall(k, P, st, { x: 0, z: -0.35, w: 2.5, d: 1.85, h: 1.3, grade: 'mid', doorW: 0.44, doorH: 0.66, windows: 2, lim: 1.75 });
      if (st.ornament !== 'columns') for (const sx of [-1, 1]) banner(k, P, sx * 0.75, y + 1.2, -0.35 + 1.85 / 2 + (st.wall === 'mudbrick' ? -0.02 : 0), 0.24, 0.5);
    }
    for (const sx of [-1, 1]) towerStruct(k, P, st, { x: sx * 1.45, z: 1.45, s: 0.62, h: 1.25, team: true, simple: true });
    k.b(cyl(0.2, 0.22, 0.22, 8, -0.95, y, 1.05), P.stone, 0.1);
    crate(k, P, 0.95, y, 1.05, 0.2, 0.2);
    barrel(k, P, 0.95, y, 0.78, 0.24);
    return Math.max(top, y + 1.25 + 1.0);
  }
  // City: walls with four towers and a grand palace
  perimeter(k, P, st, { half, h: 0.58, gate, merlons: true });
  let top;
  if (round) {
    k.b(box(2.6, 0.12, 2.6, 0, y, -0.25), P.stoneD, 0.04);
    top = hall(k, P, st, { x: 0, z: -0.3, w: 2.35, d: 2.35, y: y + 0.12, h: 1.05, rh: st.roof === 'dome' ? 1.15 : 1.9, grade: 'grand', doorW: 0.44, doorH: 0.62, lim: 1.75 });
    if (st.roof === 'dome') {
      for (const sx of [-1, 1]) pinnacle(k, P, sx * 0.62, y + 0.12, 0.62, 1.25, 0.24);
    } else {
      for (const sx of [-1, 1]) ornament(k, P, st, sx * 0.62, y + 0.12, 0.85, 0.7, sx);
    }
  } else {
    const ornamentFront = st.ornament !== 'columns';
    k.b(box(2.6, 0.12, 2.1, 0, y, -0.4), P.stoneD, 0.04);
    hall(k, P, st, { x: 0, z: -0.4, w: 2.5, d: 1.95, y: y + 0.12, h: 1.0, grade: 'mid', team: true, doorW: 0.46, doorH: 0.66, windows: 2, porch: st.ornament === 'columns', lim: 1.75, simple: true });
    const uy = y + 0.12 + 1.0 + (st.roof === 'stepped' || st.roof === 'flat' ? 0.06 : roofH(st, 1.95, 'mid') * 0.42);
    if (st.roof === 'shikhara') {
      k.b(box(1.25, 0.4, 1.0, 0, uy, -0.55), P.wall, 0.04);
      top = roofShikhara(k, P, st, { x: 0, z: -0.55, w: 1.2, d: 0.95, y: uy + 0.4, h: 1.45, grade: 'grand', team: true });
    } else if (st.roof === 'stepped') {
      const mud = st.wall === 'mudbrick' || st.wall === 'brick';
      k.b(frustum(1.6, 0.42, 1.2, 0.93, 0, uy, -0.55), mud ? P.wallD : P.wall, 0.05);
      k.b(frustum(1.05, 0.38, 0.8, 0.9, 0, uy + 0.42, -0.6), mud ? P.wall : P.wallD, 0.05);
      k.b(box(0.6, 0.32, 0.45, 0, uy + 0.8, -0.62), P.trim, 0.04);
      top = roofStepped(k, P, st, { x: 0, z: -0.62, w: 0.62, d: 0.48, y: uy + 1.12, grade: 'small', team: true });
    } else if (st.roof === 'pyramid') {
      k.b(box(1.3, 0.5, 1.0, 0, uy, -0.6), P.wall, 0.04);
      k.b(box(1.36, 0.08, 1.06, 0, uy + 0.5, -0.6), P.trim, 0.02);
      top = roofPyramid(k, P, st, { x: 0, z: -0.6, w: 1.3, d: 1.0, y: uy + 0.58, h: 1.25, grade: 'grand', team: true });
    } else {
      const ux = 1.55;
      const ud = 1.1;
      rectWalls(k, P, st, { x: 0, z: -0.62, w: ux, d: ud, y: uy, h: 0.62, door: false, windows: 1 });
      top = rectRoof(k, P, st, { x: 0, z: -0.62, w: ux, d: ud, y: uy + 0.62, h: roofH(st, st.roof === 'gable' ? ux : ud, 'grand'), grade: st.roof === 'pagoda' ? 'mid' : 'grand', team: true, ridge: st.roof === 'gable' ? 'z' : undefined });
    }
    if (ornamentFront) ornamentPair(k, P, st, 0.62, y, 1.0, 0.75);
    else for (const sx of [-1, 1]) brazier(k, P, sx * 0.55, y, 1.1, 0.7, 0.3);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    towerStruct(k, P, st, { x: sx * 1.45, z: sz * 1.45, s: 0.62, h: sz > 0 ? 1.55 : 1.75, team: true, simple: true });
  }
  // gatehouse lintel with a team banner
  k.b(box(gate + 0.4, 0.2, 0.24, 0, y + 0.95, half - 0.08), st.wall === 'timber' ? P.woodD : st.wall === 'lacquer' ? P.wall : P.stone, 0.04);
  banner(k, P, 0, y + 1.12, half + 0.04, 0.32, 0.3);
  return Math.max(top, y + 1.75 + 1.1);
}

// ---------------------------------------------------------------------------
// scaffold, foundation, gold mine
// ---------------------------------------------------------------------------

function buildFoundation(k, P, st, size) {
  const s = size - 2 * MARGIN;
  k.f(box(s, DEPTH + PLINTH - 0.03, s, 0, -DEPTH, 0), P.stoneD, 0.06);
  k.f(box(s - 0.06, 0.03, s - 0.06, 0, PLINTH - 0.03, 0), P.yard, 0.05);
  // slab edges read as cut stones
  for (const sz of [-1, 1]) k.f(box(s + 0.002, 0.035, 0.06, 0, PLINTH - 0.035, sz * (s / 2 - 0.03)), P.stone, 0.05);
  for (const sx of [-1, 1]) k.f(box(0.06, 0.035, s - 0.12, sx * (s / 2 - 0.03), PLINTH - 0.035, 0), P.stone, 0.05);
}

function scaffoldKit(size, H) {
  const k = new Kit(hashSeed(`scaffold|${size}|${H}`));
  const P = { wood: C('#9c7a52'), woodD: C('#6b4e30'), stone: C('#a39b8c'), plank: C('#b38d5e') };
  const half = size / 2 - MARGIN - 0.05;
  const n = size >= 4 ? 3 : 2;
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(-half + (2 * half * i) / n);
  for (const px of xs) for (const pz of [-half, half]) k.b(box(0.05, H, 0.05, px, 0, pz), P.wood, 0.05);
  for (const pz of xs.slice(1, -1)) for (const px of [-half, half]) k.b(box(0.05, H, 0.05, px, 0, pz), P.wood, 0.05);
  const levels = H > 2.2 ? [0.3, 0.6, 0.95] : [0.45, 0.95];
  for (const f of levels) {
    const ly = H * f;
    for (const sz of [-1, 1]) k.b(box(2 * half + 0.1, 0.03, 0.16, 0, ly, sz * half), P.plank, 0.08);
    for (const sx of [-1, 1]) k.b(box(0.16, 0.03, 2 * half - 0.1, sx * half, ly, 0), P.plank, 0.08);
  }
  for (const sz of [-1, 1]) {
    k.b(strut([-half, 0.05, sz * half], [0, H * levels[0], sz * half], 0.035), P.woodD, 0.03);
    k.b(strut([half, 0.05, sz * half], [0, H * levels[0], sz * half], 0.035), P.woodD, 0.03);
  }
  // ladder on the south face
  for (const sx of [-1, 1]) k.b(strut([0.5 + sx * 0.1, 0, half + 0.12], [0.5 + sx * 0.1, H * levels[0] + 0.1, half + 0.02], 0.03), P.woodD, 0.03);
  for (let i = 1; i < 4; i++) k.b(box(0.2, 0.025, 0.025, 0.5, (H * levels[0] * i) / 4, half + 0.12 - (0.1 * i) / 4), P.woodD, 0);
  // building materials
  for (let i = 0; i < 3; i++) k.b(box(0.5, 0.05, 0.12, -half + 0.45, PLINTH + i * 0.05, half - 0.3 + i * 0.01, 0.05 * i), P.plank, 0.08);
  for (let i = 0; i < 3; i++) k.b(box(0.18, 0.13, 0.13, half - 0.35 + (i % 2) * 0.2, PLINTH + (i > 1 ? 0.13 : 0), half - 0.32 + (i > 1 ? 0.07 : 0)), P.stone, 0.1);
  return finishKit(k);
}

const GOLD_LEVELS = [0.12, 0.38, 0.68, 1];

function buildGoldMineGeometry() {
  const k = new Kit(hashSeed('gold-mine'));
  const rock = C('#7d746a');
  const rockD = C('#5e564e');
  const rockL = C('#9a9084');
  const P = { wood: C('#7b5536'), woodD: C('#4d3421'), dark: C('#140f0a'), gold: C('#f3c63c'), metal: C('#6c7278') };
  const rr = new RNG(hashSeed('gold-mine-rocks'));
  const rockAt = (r, x, y, z, sy, color) => {
    const g = prep(new THREE.DodecahedronGeometry(r, 0));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = 0.85 + rr.next() * 0.3;
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * sy, p.getZ(i) * s);
    }
    g.rotateY(rr.next() * PI);
    g.translate(x, y, z);
    k.b(g, color, 0.12);
    return g;
  };
  // the mound: a big central crag with smaller boulders around (partly below ground)
  rockAt(0.95, 0, 0.25, -0.3, 0.95, rock);
  rockAt(0.68, -0.6, 0.0, -0.55, 0.85, rockD);
  rockAt(0.68, 0.6, 0.02, -0.5, 0.8, rock);
  rockAt(0.52, -0.75, -0.05, 0.35, 0.8, rockL);
  rockAt(0.52, 0.75, -0.05, 0.32, 0.85, rockD);
  rockAt(0.42, -0.3, 0.6, -0.7, 1, rockL);
  rockAt(0.32, 0.35, 1.0, -0.45, 1, rock);
  rockAt(0.32, -0.98, -0.1, -0.95, 0.8, rock);
  rockAt(0.32, 0.98, -0.1, -0.95, 0.8, rockL);
  rockAt(0.28, -1.02, -0.05, 0.95, 0.8, rockD);
  rockAt(0.26, 1.05, -0.06, 0.9, 0.8, rock);
  rockAt(0.2, -0.55, -0.02, 1.1, 1, rockL);
  // timber entrance on the south face
  const ez = 0.32;
  k.b(box(0.7, 0.62, 0.3, 0, 0, ez - 0.05), rockD, 0.08);
  k.b(box(0.48, 0.52, 0.06, 0, 0, ez + 0.12), P.dark, 0);
  for (const sx of [-1, 1]) k.b(box(0.1, 0.62, 0.1, sx * 0.3, 0, ez + 0.14), P.wood, 0.05);
  k.b(box(0.78, 0.11, 0.13, 0, 0.6, ez + 0.14), P.woodD, 0.05);
  k.b(strut([-0.38, 0.5, ez + 0.2], [-0.12, 0.72, ez + 0.2], 0.05), P.wood, 0.04);
  k.b(strut([0.38, 0.5, ez + 0.2], [0.12, 0.72, ez + 0.2], 0.05), P.wood, 0.04);
  k.b(box(0.18, 0.12, 0.03, 0.38, 0.5, ez + 0.22, 0.1), P.wood, 0.04);
  // rails and a cart full of ore
  for (const sx of [-1, 1]) k.b(box(0.03, 0.025, 0.86, sx * 0.13, 0, ez + 0.6), P.metal, 0);
  for (let i = 0; i < 4; i++) k.b(box(0.38, 0.02, 0.06, 0, 0, ez + 0.28 + i * 0.22), P.woodD, 0);
  k.b(frustum(0.42, 0.24, 0.3, 1.15, 0, 0.07, ez + 0.8), P.woodD, 0.05);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(cyl(0.06, 0.06, 0.03, 6, 0, 0, 0).rotateZ(PI / 2).translate(sx * 0.2, 0.07, ez + 0.8 + sz * 0.1), P.metal, 0);
  k.b(cone(0.2, 0.16, 6, 0, 0.31, ez + 0.8), P.gold, 0.12);
  k.b(cone(0.16, 0.12, 5, 0.55, 0, ez + 0.66), P.gold, 0.12);
  // pickaxe leaning on the entrance
  k.b(strut([0.42, 0, ez + 0.3], [0.5, 0.4, ez + 0.22], 0.03), P.wood, 0);
  k.b(strut([0.42, 0.42, ez + 0.2], [0.58, 0.36, ez + 0.24], 0.03), P.metal, 0);
  const body = finishKit(k);
  // keep the mound inside its 3×3 footprint (rock sizes are jittered)
  body.body.computeBoundingBox();
  const bb = body.body.boundingBox;
  const lim = GOLD_MINE.size / 2 - MARGIN;
  const ext = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
  const fit = ext > lim ? lim / ext : 1;
  if (fit < 1) body.body.scale(fit, 1, fit);
  // gold veins (glow, twinkling): sorted so smaller amounts keep fewer veins
  const veinSpots = [];
  const vr = new RNG(hashSeed('gold-veins'));
  const anchors = [[0, 0.25, -0.3, 0.95], [-0.6, 0, -0.55, 0.68], [0.6, 0.02, -0.5, 0.68], [-0.75, -0.05, 0.35, 0.52], [0.75, -0.05, 0.32, 0.52], [-0.3, 0.6, -0.7, 0.42], [0.35, 1.0, -0.45, 0.32]];
  for (let i = 0; i < 22; i++) {
    const [ax, ay, az, ar] = anchors[i % anchors.length];
    const th = vr.next() * PI * 2;
    const ph = 0.25 + vr.next() * 0.9;
    const r = ar * (0.84 + vr.next() * 0.08);
    const px = ax + Math.cos(th) * Math.sin(ph) * r;
    const py = ay + Math.cos(ph) * r * 0.9;
    const pz = az + Math.sin(th) * Math.sin(ph) * r;
    if (py < 0.08 || pz > 0.75) continue;
    veinSpots.push({ x: px, y: py, z: pz, s: 0.05 + vr.next() * 0.05, rank: vr.next(), seed: 0.05 + vr.next() });
  }
  // the two most visible veins (front-most) stay until the mine is empty
  [...veinSpots].sort((a, b) => b.z - a.z).slice(0, 2).forEach((v) => { v.rank = 0; });
  const levels = GOLD_LEVELS.map((lvl) => {
    const kk = new Kit(hashSeed(`gold-level-${lvl}`));
    for (const v of veinSpots) {
      if (v.rank > lvl) continue;
      const g = octa(v.s, 0, 0, 0);
      g.scale(1, 1.5, 1);
      g.rotateZ(v.seed * 3);
      g.translate(v.x, v.y, v.z);
      kk.g(g, C('#ffd23a'), () => [0, v.seed]);
      const g2 = octa(v.s * 0.6, 0, 0, 0);
      g2.translate(v.x + v.s * 0.9, v.y - v.s * 0.4, v.z + v.s * 0.4);
      kk.g(g2, C('#fff1a8'), () => [0, v.seed + 0.37]);
    }
    const glow = finishKit(kk).glow;
    if (glow && fit < 1) glow.scale(fit, 1, fit);
    return glow;
  });
  return { body: body.body, levels, triangles: body.triangles + (levels[3] ? levels[3].attributes.position.count / 3 : 0), height: 1.45 };
}

// ---------------------------------------------------------------------------
// cache, fitting and the public API
// ---------------------------------------------------------------------------

const GEO_CACHE = new Map();
const SCAFFOLD_CACHE = new Map();
let MINE_GEO = null;

function resolveStyle(pantheon) {
  const st = { ...DEFAULT_STYLE, ...(pantheon && pantheon.style) };
  const colors = { ...DEFAULT_COLORS, ...(pantheon && pantheon.colors) };
  return { st, colors };
}

function styleKey(type, st, colors, tier) {
  return `${type}|${tier}|${st.roof}|${st.wall}|${st.ornament}|${colors.wall}|${colors.roof}|${colors.trim}|${colors.accent}`;
}

/** Build (or fetch from the cache) the merged geometry set for a building look. */
function getBuildingGeometry(type, pantheon, tier) {
  const { st, colors } = resolveStyle(pantheon);
  const size = BUILDINGS[type] ? BUILDINGS[type].size : 2;
  const t = type === 'town_center' ? Math.max(1, Math.min(3, tier | 0 || 1)) : 1;
  const key = styleKey(type, st, colors, t);
  let entry = GEO_CACHE.get(key);
  if (entry) return entry;
  const P = makePalette(colors, st);
  const k = new Kit(hashSeed(key));
  buildFoundation(k, P, st, size);
  let top;
  switch (type) {
    case 'town_center': top = buildTownCenter(k, P, st, t); break;
    case 'house': top = buildHouse(k, P, st); break;
    case 'barracks': top = buildBarracks(k, P, st); break;
    case 'storehouse': top = buildStorehouse(k, P, st); break;
    case 'shrine': top = buildShrine(k, P, st); break;
    case 'temple': top = (TEMPLES[st.roof] || templeFlat)(k, P, st); break;
    case 'tower': top = buildTower(k, P, st); break;
    case 'titan_gate': top = buildTitanGate(k, P, st); break;
    default: top = hall(k, P, st, { x: 0, z: 0, w: size - 0.6, d: size - 0.6, h: 0.7 }); break;
  }
  // Dev aid: set globalThis.__BLD_DEBUG = [] to collect the parts that reach past the footprint.
  if (globalThis.__BLD_DEBUG) {
    const lim = size / 2 - MARGIN;
    for (const name of BUCKETS) for (const g of k.parts[name]) {
      g.computeBoundingBox();
      const bb = g.boundingBox;
      const e = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
      if (e > lim + 0.005) globalThis.__BLD_DEBUG.push(`${key} ${name} ext ${e.toFixed(3)} > ${lim} box x[${bb.min.x.toFixed(2)},${bb.max.x.toFixed(2)}] y[${bb.min.y.toFixed(2)},${bb.max.y.toFixed(2)}] z[${bb.min.z.toFixed(2)},${bb.max.z.toFixed(2)}]`);
    }
  }
  const geos = finishKit(k);
  // Safety net: scale any model that overhangs its footprint back inside it.
  const limit = size / 2 - MARGIN + 0.005;
  let ext = 0;
  let maxY = 0;
  for (const name of BUCKETS) {
    const g = geos[name];
    if (!g) continue;
    const bb = g.boundingBox;
    ext = Math.max(ext, -bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
    if (name !== 'base') maxY = Math.max(maxY, bb.max.y);
  }
  let fit = 1;
  if (ext > limit) {
    fit = limit / ext;
    for (const name of BUCKETS) {
      const g = geos[name];
      if (!g) continue;
      g.scale(fit, name === 'base' ? 1 : fit, fit);
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
    maxY *= fit;
  }
  const height = Math.max(maxY, typeof top === 'number' ? top * fit : 0);
  entry = {
    key, size, ...geos, height, fit, extent: ext * fit,
    vortex: type === 'titan_gate' && { cx: 0, cy: (PLINTH + 0.27 + 0.05 + GATE.open * 0.5) * fit, rx: 0.84 * fit, ry: (GATE.open * 0.5 - 0.02) * fit },
    vortexColors: [tint(P.accent, 0.55), P.accent, mix(P.trim, '#5a2a9a', 0.5)],
    scaffoldH: Math.max(0.9, Math.min(height * 0.72, 2.6)),
  };
  GEO_CACHE.set(key, entry);
  return entry;
}

function getScaffold(size, H) {
  const hq = Math.round(H * 10) / 10;
  const key = `${size}|${hq}`;
  let g = SCAFFOLD_CACHE.get(key);
  if (!g) {
    g = scaffoldKit(size, hq).body;
    SCAFFOLD_CACHE.set(key, g);
  }
  return g;
}

let VORTEX_GEO = null;
function vortexGeometry() {
  if (!VORTEX_GEO) VORTEX_GEO = new THREE.CircleGeometry(1, 40);
  return VORTEX_GEO;
}

function makeMesh(geo, mat, name, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/**
 * Build a building model.
 * @param {string} buildingTypeId e.g. 'temple' (see src/data/buildings.js)
 * @param {object|null} pantheon pantheon data (uses .style and .colors); null = neutral style
 * @param {string|number} teamColor owner color for banners, flags and roof trim
 * @param {number} [tier=1] town center tier 1..3 (ignored by other buildings)
 * @returns {{root: THREE.Group, height: number, setProgress: (bp:number)=>void, setTier: (tier:number)=>void,
 *   animate: (timeSec:number)=>void, dispose: ()=>void}}
 */
export function buildBuildingModel(buildingTypeId, pantheon, teamColor, tier = 1) {
  const root = new THREE.Group();
  root.name = `building-${buildingTypeId}`;
  const structure = new THREE.Group(); // body + team + glow; rises during construction
  root.add(structure);
  const teamMat = teamMaterial(teamColor);
  const meshes = {};
  let entry = null;
  let progress = 1;
  let clipBody = null;
  let clipTeam = null;
  let scaffold = null;
  let vortex = null;
  let curTier = tier;

  const model = { root, height: 1, setProgress, setTier, animate, dispose, type: buildingTypeId };

  function apply(e) {
    entry = e;
    const spec = [
      ['base', root, bodyMaterial(), false, true],
      ['body', structure, bodyMaterial(), true, true],
      ['team', structure, teamMat, true, false],
      ['glow', structure, glowMaterial(), false, false],
    ];
    for (const [name, parent, mat, cast, receive] of spec) {
      const geo = e[name];
      if (meshes[name]) {
        if (geo) meshes[name].geometry = geo;
        else {
          parent.remove(meshes[name]);
          meshes[name] = null;
        }
      } else if (geo) {
        meshes[name] = makeMesh(geo, mat, `building-${name}`, cast, receive);
        parent.add(meshes[name]);
      }
    }
    if (e.vortex) {
      if (!vortex) {
        const [a, b, c] = e.vortexColors;
        vortex = new THREE.Mesh(vortexGeometry(), vortexMaterial(a, b, c));
        vortex.name = 'building-vortex';
        vortex.renderOrder = 2;
        structure.add(vortex);
      }
      vortex.scale.set(e.vortex.rx, e.vortex.ry, 1);
      vortex.position.set(0, e.vortex.cy, 0);
    }
    model.height = e.height;
    setProgress(progress);
  }

  function setProgress(bp) {
    progress = bp >= 1 ? 1 : Math.max(0, bp || 0);
    const building = progress < 1;
    if (building) {
      if (!clipBody) {
        clipBody = clipMaterial(bodyMaterial(), null);
        clipTeam = clipMaterial(teamMat, 'team');
        clipTeam.color.copy(teamMat.color);
      }
      const cut = PLINTH + 0.01 + (entry.height + 0.05 - PLINTH) * (0.04 + 0.96 * progress);
      clipBody.userData.uCut.value = cut;
      clipTeam.userData.uCut.value = cut;
      if (meshes.body) {
        meshes.body.material = clipBody;
        meshes.body.castShadow = false;
      }
      if (meshes.team) {
        meshes.team.material = clipTeam;
        meshes.team.castShadow = false;
      }
      if (meshes.glow) meshes.glow.visible = false;
      if (vortex) vortex.visible = false;
      if (!scaffold) {
        scaffold = makeMesh(getScaffold(entry.size, entry.scaffoldH), bodyMaterial(), 'building-scaffold', true, false);
        scaffold.matrixAutoUpdate = true;
        root.add(scaffold);
      } else scaffold.geometry = getScaffold(entry.size, entry.scaffoldH);
      scaffold.visible = true;
      scaffold.scale.y = Math.min(1, 0.45 + 0.6 * progress);
    } else {
      if (meshes.body) {
        meshes.body.material = bodyMaterial();
        meshes.body.castShadow = true;
      }
      if (meshes.team) {
        meshes.team.material = teamMat;
        meshes.team.castShadow = true;
      }
      if (meshes.glow) meshes.glow.visible = true;
      if (vortex) vortex.visible = true;
      if (scaffold) {
        root.remove(scaffold);
        scaffold = null;
      }
      if (clipBody) {
        clipBody.dispose();
        clipTeam.dispose();
        clipBody = null;
        clipTeam = null;
      }
    }
  }

  function setTier(t) {
    if (buildingTypeId !== 'town_center') return;
    const nt = Math.max(1, Math.min(3, t | 0 || 1));
    if (nt === curTier && entry) return;
    curTier = nt;
    apply(getBuildingGeometry(buildingTypeId, pantheon, curTier));
  }

  function animate(timeSec) {
    TIME.value = timeSec;
    if (vortex) vortex.rotation.z = -timeSec * 0.15;
  }

  function dispose() {
    if (root.parent) root.parent.remove(root);
    if (clipBody) {
      clipBody.dispose();
      clipTeam.dispose();
      clipBody = null;
      clipTeam = null;
    }
    scaffold = null;
  }

  apply(getBuildingGeometry(buildingTypeId, pantheon, curTier));
  return model;
}

/**
 * Gold mine: rocky 3×3 mound with glittering gold veins and a timber entrance facing south.
 * @returns {{root: THREE.Group, height: number, setAmountFraction: (f:number)=>void, animate: (t:number)=>void, dispose: ()=>void}}
 */
export function buildGoldMineModel() {
  if (!MINE_GEO) MINE_GEO = buildGoldMineGeometry();
  const root = new THREE.Group();
  root.name = 'gold-mine';
  const body = makeMesh(MINE_GEO.body, bodyMaterial(), 'mine-body', true, true);
  root.add(body);
  const veins = makeMesh(MINE_GEO.levels[3], glowMaterial(), 'mine-gold', false, false);
  root.add(veins);
  let level = 3;
  return {
    root,
    height: MINE_GEO.height,
    setAmountFraction(f) {
      const v = Math.max(0, Math.min(1, Number(f) || 0));
      let l = GOLD_LEVELS.findIndex((x) => v <= x + 1e-6);
      if (l < 0) l = 3;
      const geo = MINE_GEO.levels[l];
      if (v <= 0 || !geo) {
        veins.visible = false;
        return;
      }
      veins.visible = true;
      if (l !== level) {
        level = l;
        veins.geometry = geo;
      }
    },
    animate(timeSec) {
      TIME.value = timeSec;
    },
    dispose() {
      if (root.parent) root.parent.remove(root);
    },
  };
}

/** Advance the shared animation clock (flags, flames, vortices, gold glitter) without a model. */
export function setBuildingTime(timeSec) {
  TIME.value = timeSec;
}

/**
 * Stats for tests and the gallery: triangles, mesh count, height and how far the
 * model reaches from its center (must be ≤ size/2 − 0.1).
 */
export function getBuildingModelInfo(buildingTypeId, pantheon, tier = 1) {
  const e = getBuildingGeometry(buildingTypeId, pantheon, tier);
  let meshes = 0;
  for (const n of BUCKETS) if (e[n]) meshes++;
  if (e.vortex) meshes++;
  const mounted = buildBuildingModel(buildingTypeId, pantheon, '#ffffff', tier);
  mounted.setProgress(0.5);
  let constructionMeshes = 0;
  mounted.root.traverse((o) => { if (o.isMesh) constructionMeshes++; });
  mounted.dispose();
  return {
    triangles: e.triangles, meshes, constructionMeshes, height: e.height, extent: e.extent, fit: e.fit,
    size: e.size, limit: e.size / 2 - MARGIN,
  };
}

/** Gold mine stats (triangles, height). */
export function getGoldMineInfo() {
  if (!MINE_GEO) MINE_GEO = buildGoldMineGeometry();
  return { triangles: MINE_GEO.triangles, height: MINE_GEO.height, size: GOLD_MINE.size };
}

/** Drop every cached geometry and shared material (e.g. when leaving a game for good). */
export function clearBuildingCaches() {
  for (const e of GEO_CACHE.values()) for (const n of BUCKETS) if (e[n]) e[n].dispose();
  GEO_CACHE.clear();
  for (const g of SCAFFOLD_CACHE.values()) g.dispose();
  SCAFFOLD_CACHE.clear();
  if (MINE_GEO) {
    MINE_GEO.body.dispose();
    for (const g of MINE_GEO.levels) if (g) g.dispose();
    MINE_GEO = null;
  }
}
