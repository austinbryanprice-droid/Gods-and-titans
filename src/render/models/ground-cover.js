// Ground cover (DESIGN 8): grass tufts, small flowers, pebbles and mushrooms
// scattered over the walkable land: meadows, forest edges and floors, the grassy
// borders of dirt and sand. Never in water or on rock. Purely cosmetic.
//
//   const cover = createGroundCover(mapData, heightFn, { quality: 'medium' });
//   scene.add(cover.object3d);             // then patchFowObject(cover.object3d)
//   cover.hideInRect(x0, y0, x1, y1);      // under a building footprint or a mine
//   cover.setQuality('high');              // low: none, medium: light, high / ultra: dense
//   cover.dispose();
//
// Thousands of tiny instances per chunk, so instead of InstancedMesh (64-byte
// matrices) every instance is one vec4 (x, ground height, z, packed scale + rank)
// plus four color bytes; rotation comes from a hash of its position. Two kinds
// per 16×16-tile chunk (one draw call each, frustum culled): grass tufts, and
// "accents" (flower clumps, pebbles, mushrooms: three shapes padded to the same
// vertex count and stored side by side in one geometry, so each instance runs
// the vertex shader only for its own shape, picked by its class). Each chunk
// keeps its instances sorted by a random rank, so a lower quality or a far chunk
// just draws a shorter prefix (geometry.instanceCount, set per frame in
// onBeforeRender), and the vertex shader shrinks the instances near that cut so
// thinning with distance has no popping. Grass and flowers sway with the trees'
// wind (foliage-shader.js). The cover does not write depth (see
// groundCoverMaterial), so it stays out of the SSAO input.
import * as THREE from 'three';
import { TERRAIN } from '../../config.js';
import { heightAt } from '../height.js';
import { patchWorldMaterial } from '../shading.js';
import { WATER_LEVEL } from '../terrain.js';
import { WIND_GLSL, WIND_UNIFORMS } from './foliage-shader.js';
import { WORLD_UNIFORMS } from '../shading.js';

const CHUNK = 16;
const PI = Math.PI;

/** Share of the full instance set drawn per quality. */
export const GROUND_COVER_DENSITY = { low: 0, medium: 0.4, high: 0.7, ultra: 1 };

/**
 * Uniforms of the ground-cover materials. uGcThin: x / y = camera distance
 * where thinning starts / ends, z = share kept at y and beyond, w = quality density.
 */
export const GROUND_COVER_UNIFORMS = {
  uGcThin: { value: new THREE.Vector4(30, 64, 0.3, GROUND_COVER_DENSITY.medium) },
};

// Grass tufts per tile at full density, by ground class.
const TUFTS = { meadow: 12, edge: 15, forest: 3.5, border: 3.5, sand: 1.6 };
// Accents per tile at full density.
const FLOWERS = 3; // in flowering meadow patches
const PEBBLES = { meadow: 0.04, edge: 0.06, border: 0.3, dirt: 0.12, sand: 0.12, forest: 0.04 };
const MUSHROOMS = { edge: 0.16, forest: 0.3 };

// Accent classes (instance color alpha): which of the accent geometry's three shapes it draws.
const CLS_FLOWERS = 0;
const CLS_PEBBLES = 1;
const CLS_MUSHROOMS = 2;
// aGc.y: 1 = takes the instance tint (flower heads, pebbles, caps, grass), 0 = keeps its own color (stems)
const OWN = 0;
const TINT = 1;

const lin = (hex) => new THREE.Color(hex); // sRGB hex → linear working color
const FLOWER_COLORS = ['#f4f1e6', '#f2cc3a', '#dc4a3a', '#9a62d6', '#e676b4', '#5a8fe6', '#f6a63a'].map(lin);
const PEBBLE_COLORS = ['#a39e94', '#ada28e', '#c2bbab', '#948f86'].map(lin);
const SAND_PEBBLES = ['#c9b58e', '#b8a582', '#d8cbb0'].map(lin);
const CAP_COLORS = ['#8a5a3a', '#b8352c', '#c9a36e', '#a06a42'].map(lin);
// grass blade tints (roughly the terrain's own palette, a touch fresher)
const GRASS = { base: lin('#5c8a35'), lush: lin('#6f9a3e'), dry: lin('#87a046'), forest: lin('#41602a'), forest2: lin('#566a2e'), straw: lin('#a3a058'), straw2: lin('#8c9a4e') };

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

const smooth01 = (t) => {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

function ihash(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = ihash(x0, y0, seed);
  const b = ihash(x0 + 1, y0, seed);
  const c = ihash(x0, y0 + 1, seed);
  const d = ihash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a + (d - c - b + a) * sx) * sy;
}

/** Deterministic little generator for building geometry. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// geometry (built once, shared): position, normal, color, aGc (bend amplitude, tint weight)
// ---------------------------------------------------------------------------

/** Accumulates triangles with per-vertex color, bend and tint weight, normals bent toward `soft`. */
class TriBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.gc = [];
  }

  /**
   * @param {number[][]} tri three [x, y, z]
   * @param {(p: number[]) => number[]} color linear rgb per vertex
   * @param {(p: number[]) => number} bend wind amplitude per vertex
   * @param {number} tint 1: multiplied by the instance tint, 0: keeps its own color
   * @param {{ up?: number, center?: number[] }} [n] normals: blend of the face normal (oriented up) toward
   *   straight up (`up`) or toward the direction away from `center`
   */
  add(tri, color, bend, tint, n = {}) {
    const [a, b, c] = tri.map((p) => new THREE.Vector3(...p));
    const fn = new THREE.Vector3().subVectors(b, a).cross(_d.subVectors(c, a)).normalize();
    if (fn.y < 0) fn.negate();
    for (const p of [a, b, c]) {
      _v.copy(fn);
      if (n.up) _v.lerp(_d.set(0, 1, 0), n.up).normalize();
      if (n.center) _v.lerp(_d.set(p.x - n.center[0], p.y - n.center[1], p.z - n.center[2]).normalize(), n.soft ?? 0.7).normalize();
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(_v.x, _v.y, _v.z);
      const col = color([p.x, p.y, p.z]);
      this.col.push(col[0], col[1], col[2]);
      this.gc.push(bend([p.x, p.y, p.z]), tint);
    }
  }

  /** Every face of a geometry (disposed afterwards). */
  addGeometry(g, color, bend, tint, n) {
    const f = g.index ? g.toNonIndexed() : g;
    const p = f.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const tri = [0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)]);
      this.add(tri, color, bend, tint, n);
    }
    f.dispose();
    g.dispose();
  }

  get triangles() {
    return this.pos.length / 9;
  }

  /** Pad with degenerate (zero-area, never rasterized) triangles up to n. */
  pad(n) {
    while (this.triangles < n) {
      for (let k = 0; k < 3; k++) {
        this.pos.push(0, 0, 0);
        this.nor.push(0, 1, 0);
        this.col.push(0, 0, 0);
        this.gc.push(0, 0);
      }
    }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGc', new THREE.Float32BufferAttribute(this.gc, 2));
    g.computeBoundingSphere();
    return g;
  }

  /**
   * The same shape as packed attributes for one of the accent geometry's extra
   * slots: aPB = position + bend, aNT = normal + tint weight, aCol = color.
   */
  packed() {
    const n = this.pos.length / 3;
    const pb = new Float32Array(n * 4);
    const nt = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pb.set([this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2], this.gc[i * 2]], i * 4);
      nt.set([this.nor[i * 3], this.nor[i * 3 + 1], this.nor[i * 3 + 2], this.gc[i * 2 + 1]], i * 4);
    }
    return { pb: new THREE.BufferAttribute(pb, 4), nt: new THREE.BufferAttribute(nt, 4), col: new THREE.Float32BufferAttribute(this.col, 3) };
  }
}

/** A grass tuft: blades fanning out of one root, dark at the base, sunlit yellow-green tips. */
function tuftGeo() {
  const r = rng(71);
  const t = new TriBuilder();
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2 + r() * 0.6;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const h = 0.11 + r() * 0.12;
    const out = 0.015 + r() * 0.035;
    const lean = out + 0.03 + r() * 0.06;
    const w = 0.022 + r() * 0.01;
    const bx = ca * out;
    const bz = sa * out;
    const tri = [[bx - sa * w, 0, bz + ca * w], [bx + sa * w, 0, bz - ca * w], [ca * lean, h, sa * lean]];
    // dark only right at the root, sunlit yellow-green toward the tip
    const color = (p) => {
      const k = smooth01(p[1] / 0.16);
      return [0.68 + 0.62 * k * 1.04, 0.68 + 0.62 * k * 1.06, 0.68 + 0.62 * k * 0.8];
    };
    // lit like the ground it grows from: normals almost straight up
    t.add(tri, color, (p) => 0.05 * Math.pow(p[1] / 0.2, 1.5), TINT, { up: 0.75 });
  }
  return t.build();
}

/**
 * The three accent shapes in one geometry: flower clump in the standard
 * attributes (position, normal, color, aGc), pebbles in aPB1 / aNT1 / aCol1,
 * mushrooms in aPB2 / aNT2 / aCol2, each padded to the same triangle count. The
 * vertex shader reads the slot of the instance's class, so an instance costs
 * only its own shape's vertices.
 */
function accentGeo() {
  const r = rng(73);
  const flowers = new TriBuilder();
  const stemCol = lin('#3e7a2c');
  const stem = (p) => {
    const k = 0.6 + 0.5 * smooth01(p[1] / 0.15);
    return [stemCol.r * k, stemCol.g * k, stemCol.b * k];
  };
  const sway = (p) => 0.045 * Math.pow(Math.max(0, p[1]) / 0.18, 1.5);
  // flowers: four stems with a little pyramid head each, two leaves at the foot
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + r() * 0.8;
    const d = 0.02 + r() * 0.055;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = 0.12 + r() * 0.1;
    const tx = x + (r() - 0.5) * 0.03;
    const tz = z + (r() - 0.5) * 0.03;
    flowers.add([[x - 0.007, 0, z], [x + 0.007, 0, z], [tx, h, tz]], stem, sway, OWN, { up: 0.6 });
    const s = 0.03 + r() * 0.01;
    const top = [tx, h + 0.014, tz];
    const ring = [0, 1, 2, 3].map((k) => [tx + Math.cos(k * PI / 2 + a) * s, h - 0.004, tz + Math.sin(k * PI / 2 + a) * s]);
    for (let k = 0; k < 4; k++) {
      flowers.add([top, ring[k], ring[(k + 1) % 4]], (p) => (p[1] > h + 0.005 ? [1.12, 1.12, 1.05] : [0.86, 0.86, 0.86]), sway, TINT, { up: 0.55 });
    }
  }
  for (let i = 0; i < 2; i++) {
    const a = i * 2.6 + 0.5;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    flowers.add([[-sa * 0.015, 0.005, ca * 0.015], [sa * 0.015, 0.005, -ca * 0.015], [ca * 0.08, 0.02, sa * 0.08]], stem, () => 0, OWN, { up: 0.5 });
  }
  // pebbles: three squashed, wobbled octahedra half sunk into the ground, close together
  const pebbles = new TriBuilder();
  for (let i = 0; i < 3; i++) {
    const rad = 0.028 + r() * 0.02;
    const g = new THREE.OctahedronGeometry(rad, 0);
    g.scale(1, 0.55, 0.8 + r() * 0.4);
    g.rotateY(r() * PI);
    const a = i * 2.1 + r() * 0.8;
    const d = 0.018 + r() * 0.022;
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    g.translate(cx, rad * 0.1, cz);
    const k0 = 0.92 + r() * 0.22;
    pebbles.addGeometry(g, (q) => {
      const k = k0 * (0.72 + 0.4 * smooth01((q[1] + 0.005) / 0.025));
      return [k, k, k];
    }, () => 0, TINT, { center: [cx, -0.01, cz], soft: 0.75 });
  }
  // mushrooms: a pale stem under a conical cap
  const mushrooms = new TriBuilder();
  const cream = lin('#e3d8c0');
  for (const [x, z, h, cr] of [[0.02, 0.01, 0.06, 0.035], [-0.045, 0.03, 0.04, 0.025]]) {
    const s = new THREE.CylinderGeometry(0.008, 0.011, h, 3, 1, true).translate(x, h / 2, z);
    mushrooms.addGeometry(s, (q) => {
      const k = 0.7 + 0.35 * smooth01(q[1] / h);
      return [cream.r * k, cream.g * k, cream.b * k];
    }, () => 0, OWN, { center: [x, h / 2, z], soft: 0.6 });
    const c = new THREE.ConeGeometry(cr, cr * 0.75, 6, 1, true).translate(x, h + cr * 0.3, z);
    mushrooms.addGeometry(c, (q) => (q[1] > h + cr * 0.4 ? [1.05, 1.05, 1.05] : [0.8, 0.8, 0.8]), () => 0, TINT, { center: [x, h - cr * 0.3, z], soft: 0.5 });
  }
  const shapes = { flowers: flowers.triangles, pebbles: pebbles.triangles, mushrooms: mushrooms.triangles };
  const n = Math.max(shapes.flowers, shapes.pebbles, shapes.mushrooms);
  const g = flowers.pad(n).build();
  for (const [slot, t] of [[1, pebbles], [2, mushrooms]]) {
    const { pb, nt, col } = t.pad(n).packed();
    g.setAttribute(`aPB${slot}`, pb);
    g.setAttribute(`aNT${slot}`, nt);
    g.setAttribute(`aCol${slot}`, col);
  }
  g.userData.shapes = shapes;
  return g;
}

let GEO = null;
function geometries() {
  if (!GEO) GEO = { tuft: tuftGeo(), accent: accentGeo() };
  return GEO;
}

/**
 * Triangle counts of the ground-cover geometries (tests, budgets): `accent` is
 * what one accent instance draws (its shape, padded), `shapes` the real
 * triangles of each.
 */
export function getGroundCoverInfo() {
  const g = geometries();
  return { tuft: g.tuft.attributes.position.count / 3, accent: g.accent.attributes.position.count / 3, shapes: { ...g.accent.userData.shapes } };
}

// ---------------------------------------------------------------------------
// material: Lambert + instance placement, distance thinning, wind
// ---------------------------------------------------------------------------

const GC_PARS = /* glsl */ `
attribute vec4 aInst;
attribute vec4 aTint;
attribute vec2 aGc;
#ifdef GC_ACCENT
attribute vec4 aPB1;
attribute vec4 aNT1;
attribute vec3 aCol1;
attribute vec4 aPB2;
attribute vec4 aNT2;
attribute vec3 aCol2;
#endif
uniform vec4 uGcThin;
${WIND_GLSL}`;

// First in main() (after color_vertex): this instance's shape, as position +
// bend, normal + tint weight and color. Accents take the slot of their class
// (instance color alpha). The tint colors grass blades, flower heads, pebbles
// and mushroom caps; stems keep their own green / cream.
const GC_SHAPE = /* glsl */ `
vec4 gcPB = vec4( position, aGc.x );
vec4 gcNT = vec4( normal, aGc.y );
vec3 gcCol = color;
#ifdef GC_ACCENT
  float gcCls = floor( aTint.a * 255.0 + 0.5 );
  if ( gcCls > 1.5 ) {
    gcPB = aPB2;
    gcNT = aNT2;
    gcCol = aCol2;
  } else if ( gcCls > 0.5 ) {
    gcPB = aPB1;
    gcNT = aNT1;
    gcCol = aCol1;
  }
#endif
vColor.rgb = gcCol * mix( vec3( 1.0 ), aTint.rgb, gcNT.w );`;

// rotation about +y from a hash of the instance position
const GC_NORMAL = /* glsl */ `
float gcAng = fract( sin( dot( aInst.xz, vec2( 41.37, 17.13 ) ) ) * 43758.5453 ) * 6.2832;
mat3 gcRot = mat3( cos( gcAng ), 0.0, - sin( gcAng ), 0.0, 1.0, 0.0, sin( gcAng ), 0.0, cos( gcAng ) );
objectNormal = gcRot * gcNT.xyz;`;

// aInst.w = round(scale × 256) + rank (0..1). Instances ranked past the share
// kept at this distance shrink to nothing; the survivors grow a little so a
// thinned far meadow keeps its coverage.
const GC_VERTEX = /* glsl */ `
float gcScale = floor( aInst.w ) * ( 1.0 / 256.0 );
{
  float keepD = mix( 1.0, uGcThin.z, smoothstep( uGcThin.x, uGcThin.y, distance( cameraPosition, aInst.xyz ) ) );
  float keep = uGcThin.w * keepD;
  gcScale *= ( 1.0 - smoothstep( keep - 0.04, keep, fract( aInst.w ) ) ) * ( 1.0 + 0.5 * ( 1.0 - keepD ) );
}
vec3 gcLocal = gcRot * ( gcPB.xyz * gcScale );
transformed = aInst.xyz + gcLocal;
if ( gcScale > 0.0 ) transformed += windOffset( aInst.xz, gcLocal, gcPB.w * gcScale, 0.0 );`;

function groundCoverMaterial(accent) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.name = accent ? 'ground-cover-accent' : 'ground-cover-grass';
  // No depth writes: thousands of thin blades in the depth buffer would give
  // every tuft a dark SSAO halo (high / ultra). The meshes draw after the
  // opaque world (renderOrder 1) and still depth-test against it; overlapping
  // tufts lose their order among themselves, which at this size does not show.
  mat.depthWrite = false;
  if (accent) mat.defines = { GC_ACCENT: '' };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.uniforms.uWind = WIND_UNIFORMS.uWind;
    shader.uniforms.uGcThin = GROUND_COVER_UNIFORMS.uGcThin;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GC_PARS}`)
      .replace('#include <color_vertex>', `#include <color_vertex>\n${GC_SHAPE}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${GC_NORMAL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GC_VERTEX}`);
    // both sides of a blade are lit like its front (double-sided, but no flipped normal)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\nnormal = normalize( vNormal );\nnonPerturbedNormal = normal;',
    );
  };
  mat.customProgramCacheKey = () => `groundcover2${accent ? 'a' : 'g'}`;
  patchWorldMaterial(mat, { cloud: true });
  return mat;
}

let MATS = null;
function materials() {
  if (!MATS) MATS = { grass: groundCoverMaterial(false), accent: groundCoverMaterial(true) };
  return MATS;
}

// ---------------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------------

/**
 * Lay out every instance with rank < `density` (ranks are fixed per instance,
 * so a denser build is a superset of a sparser one).
 * @returns {Map<number, {grass: number[], accent: number[]}>} chunk index → flat
 *   records [x, y, z, scale, rank, r, g, b, class]
 */
function layout(mapData, hf, density) {
  const W = mapData.width;
  const H = mapData.height ?? mapData.width;
  const T = mapData.terrain;
  const { GRASS: G, DIRT, WATER, FOREST, ROCK, SAND } = TERRAIN;
  const seed = (Number(mapData.seed) | 0) || 7;
  const cw = Math.ceil(W / CHUNK);
  const chunks = new Map();
  const near = (tx, ty, test) => {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const x = tx + ox;
        const y = ty + oy;
        if (x >= 0 && y >= 0 && x < W && y < H && test(T[y * W + x])) return true;
      }
    }
    return false;
  };
  const isForest = (t) => t === FOREST;
  const isGreen = (t) => t === G || t === FOREST;
  const minH = WATER_LEVEL + 0.05;
  const push = (list, x, y, s, rank, col, cls) => {
    const h = hf(x, y);
    if (h < minH) return;
    list.push(x, h - 0.012, y, s, rank, col.r, col.g, col.b, cls);
  };
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const i = ty * W + tx;
      const t = T[i];
      if (t === WATER || t === ROCK) continue;
      let cls;
      if (t === G) cls = near(tx, ty, isForest) ? 'edge' : 'meadow';
      else if (t === FOREST) cls = 'forest';
      else if (t === DIRT) cls = near(tx, ty, isGreen) ? 'border' : 'dirt';
      else if (t === SAND) cls = near(tx, ty, isGreen) ? 'sand' : 'beach';
      else continue;
      const chunk = Math.floor(ty / CHUNK) * cw + Math.floor(tx / CHUNK);
      let c = chunks.get(chunk);
      if (!c) chunks.set(chunk, (c = { grass: [], accent: [] }));
      const cx = tx + 0.5;
      const cy = ty + 0.5;
      // clumps: denser and sparser patches of grass
      const clump = 0.45 + 1.1 * vnoise(cx / 3.2, cy / 3.2, seed + 31);
      const big = vnoise(cx / 14, cy / 14, seed + 1);
      const mid = vnoise(cx / 4.5, cy / 4.5, seed + 2);
      // tufts
      const nT = (TUFTS[cls] || 0) * clump;
      const count = Math.floor(nT + ihash(tx, ty, seed + 33));
      for (let k = 0; k < count; k++) {
        const rank = ihash(tx * 13 + k, ty * 7 + k * 5, seed + 35);
        if (rank >= density) continue;
        const x = tx + ihash(tx * 3 + k, ty * 11 + k, seed + 36);
        const y = ty + ihash(tx * 17 + k, ty * 5 + k * 3, seed + 37);
        const rs = ihash(tx * 5 + k * 3, ty * 19 + k, seed + 38);
        let s;
        if (cls === 'meadow') {
          _c.copy(GRASS.base).lerp(GRASS.lush, Math.min(1, mid * 1.2)).lerp(GRASS.dry, Math.min(0.75, Math.max(0, big - 0.58) * 2.4));
          s = 0.75 + rs * 0.5;
        } else if (cls === 'edge') {
          _c.copy(GRASS.base).lerp(GRASS.lush, 0.6 + 0.4 * mid);
          s = 0.95 + rs * 0.55;
        } else if (cls === 'forest') {
          _c.copy(GRASS.forest).lerp(GRASS.forest2, mid);
          s = 0.7 + rs * 0.35;
        } else {
          _c.copy(GRASS.straw).lerp(GRASS.straw2, mid);
          s = 0.6 + rs * 0.35;
        }
        const v = 0.9 + 0.2 * ihash(tx * 7 + k, ty * 3 + k, seed + 39);
        _c.multiplyScalar(v);
        push(c.grass, x, y, s, rank, _c, 0);
      }
      // accents
      const acc = (n, salt, make) => {
        const m = Math.floor(n + ihash(tx * 29 + salt, ty * 31, seed + 40 + salt));
        for (let k = 0; k < m; k++) {
          const rank = ihash(tx * 23 + k, ty * 29 + k * 3 + salt, seed + 41);
          if (rank >= density) continue;
          const x = tx + 0.1 + 0.8 * ihash(tx * 37 + k, ty + k * 13 + salt, seed + 42);
          const y = ty + 0.1 + 0.8 * ihash(tx + k * 11, ty * 41 + k + salt, seed + 43);
          const rs = ihash(tx * 43 + k, ty * 47 + salt, seed + 44);
          make(x, y, rs, rank);
        }
      };
      if (cls === 'meadow' || cls === 'edge') {
        // flowering patches; one colour per patch, a few strays
        const bloom = vnoise(cx / 6.5, cy / 6.5, seed + 51);
        if (bloom > 0.52) {
          acc(FLOWERS * smooth01((bloom - 0.52) / 0.25), 1, (x, y, rs, rank) => {
            const pick = rs < 0.85 ? vnoise(cx / 4, cy / 4, seed + 53) : rs;
            const col = FLOWER_COLORS[Math.min(FLOWER_COLORS.length - 1, Math.floor(pick * FLOWER_COLORS.length))];
            push(c.accent, x, y, 0.8 + rs * 0.5, rank, col, CLS_FLOWERS);
          });
        }
      }
      const peb = PEBBLES[cls === 'beach' ? 'sand' : cls] || 0;
      if (peb) {
        acc(peb, 2, (x, y, rs, rank) => {
          const list = cls === 'sand' || cls === 'beach' ? SAND_PEBBLES : PEBBLE_COLORS;
          push(c.accent, x, y, 0.7 + rs * 0.7, rank, list[Math.floor(rs * list.length) % list.length], CLS_PEBBLES);
        });
      }
      const mush = MUSHROOMS[cls] || 0;
      if (mush) {
        acc(mush, 3, (x, y, rs, rank) => {
          push(c.accent, x, y, 0.75 + rs * 0.6, rank, CAP_COLORS[Math.floor(rs * CAP_COLORS.length) % CAP_COLORS.length], CLS_MUSHROOMS);
        });
      }
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// ground cover
// ---------------------------------------------------------------------------

const REC = 9; // floats per layout record

/** Camera distance → share kept (CPU mirror of the shader's thinning). */
function keepAt(d) {
  const u = GROUND_COVER_UNIFORMS.uGcThin.value;
  return u.w * (1 + (u.z - 1) * smooth01((d - u.x) / (u.y - u.x)));
}

/**
 * Instanced ground cover for a map.
 * @param {{width:number, height:number, terrain:Uint8Array, heights?:Float32Array, seed?:number|string}} mapData
 * @param {(x:number, y:number)=>number} [heightFn] terrain height at sim (x, y)
 * @param {{ quality?: 'low'|'medium'|'high'|'ultra' }} [o]
 * @returns {{ object3d: THREE.Group, setQuality: (q:string)=>void, hideInRect: (x0:number, y0:number, x1:number, y1:number)=>number,
 *   count: () => number, dispose: () => void }}
 */
export function createGroundCover(mapData, heightFn, { quality = 'medium' } = {}) {
  const hf = typeof heightFn === 'function' ? heightFn : (x, y) => heightAt(mapData, x, y);
  const W = mapData.width;
  const cw = Math.ceil(W / CHUNK);
  const group = new THREE.Group();
  group.name = 'ground-cover';
  const meshes = [];
  const hidden = []; // [x0, y0, x1, y1] rects, re-applied after a rebuild
  let built = 0; // density of the current instance set
  let density = 0;

  function onBeforeRender(renderer, scene, camera) {
    const c = this.userData.cover;
    const e = camera.matrixWorld.elements;
    const dx = Math.max(c.x0 - e[12], 0, e[12] - c.x1);
    const dy = Math.max(c.y0 - e[13], 0, e[13] - c.y1);
    const dz = Math.max(c.z0 - e[14], 0, e[14] - c.z1);
    const keep = Math.min(1, keepAt(Math.sqrt(dx * dx + dy * dy + dz * dz)));
    // ranks are sorted: binary search the first instance past the kept share
    const ranks = c.ranks;
    let lo = 0;
    let hi = ranks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ranks[mid] < keep) lo = mid + 1;
      else hi = mid;
    }
    this.geometry.instanceCount = lo;
  }

  function makeMesh(kind, recs, chunk) {
    const n = recs.length / REC;
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => recs[a * REC + 4] - recs[b * REC + 4]);
    const inst = new Float32Array(n * 4);
    const tint = new Uint8Array(n * 4);
    const ranks = new Float32Array(n);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const o = order[i] * REC;
      const x = recs[o];
      const y = recs[o + 1];
      const z = recs[o + 2];
      const rank = Math.min(recs[o + 4], 0.999);
      inst[i * 4] = x;
      inst[i * 4 + 1] = y;
      inst[i * 4 + 2] = z;
      inst[i * 4 + 3] = Math.round(recs[o + 3] * 256) + rank;
      ranks[i] = rank;
      tint[i * 4] = Math.round(Math.min(1, recs[o + 5]) * 255);
      tint[i * 4 + 1] = Math.round(Math.min(1, recs[o + 6]) * 255);
      tint[i * 4 + 2] = Math.round(Math.min(1, recs[o + 7]) * 255);
      tint[i * 4 + 3] = recs[o + 8];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const G = geometries();
    const base = kind === 'grass' ? G.tuft : G.accent;
    const geo = new THREE.InstancedBufferGeometry();
    for (const name of Object.keys(base.attributes)) geo.setAttribute(name, base.attributes[name]);
    const aInst = new THREE.InstancedBufferAttribute(inst, 4);
    geo.setAttribute('aInst', aInst);
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 4, true));
    geo.instanceCount = n;
    // bounds of the instances plus the tallest tuft (scaled, swaying)
    const pad = 0.45;
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0 - pad, y0 - pad, z0 - pad), new THREE.Vector3(x1 + pad, y1 + pad, z1 + pad));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geo, materials()[kind]);
    mesh.name = `ground-cover-${kind}`;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1; // after the opaque world: it does not write depth (groundCoverMaterial)
    mesh.userData.cover = { chunk, kind, n, inst, aInst, ranks, x0, x1, y0, y1, z0, z1 };
    mesh.onBeforeRender = onBeforeRender;
    return mesh;
  }

  function clear() {
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    meshes.length = 0;
  }

  function build(d) {
    clear();
    built = d;
    const chunks = layout(mapData, hf, d);
    for (const [chunk, c] of chunks) {
      for (const kind of ['grass', 'accent']) {
        if (!c[kind].length) continue;
        const mesh = makeMesh(kind, c[kind], chunk);
        meshes.push(mesh);
        group.add(mesh);
      }
    }
    for (const r of hidden) hide(r[0], r[1], r[2], r[3]);
  }

  function hide(x0, y0, x1, y1) {
    let count = 0;
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK));
    const cx1 = Math.floor(x1 / CHUNK);
    const cy0 = Math.max(0, Math.floor(y0 / CHUNK));
    const cy1 = Math.floor(y1 / CHUNK);
    for (const m of meshes) {
      const c = m.userData.cover;
      const ccx = c.chunk % cw;
      const ccy = Math.floor(c.chunk / cw);
      if (ccx < cx0 || ccx > cx1 || ccy < cy0 || ccy > cy1) continue;
      const inst = c.inst;
      let any = false;
      for (let i = 0; i < c.n; i++) {
        const o = i * 4;
        if (inst[o + 3] === 0) continue;
        const x = inst[o];
        const z = inst[o + 2];
        if (x < x0 || x > x1 || z < y0 || z > y1) continue;
        inst[o + 3] = 0; // zero scale
        any = true;
        count++;
      }
      if (any) c.aInst.needsUpdate = true;
    }
    return count;
  }

  const api = {
    object3d: group,
    /** Instances in the current set (all qualities' shares up to the densest built so far). */
    count() {
      let n = 0;
      for (const m of meshes) n += m.userData.cover.n;
      return n;
    },
    setQuality(q) {
      density = GROUND_COVER_DENSITY[q] ?? GROUND_COVER_DENSITY.medium;
      GROUND_COVER_UNIFORMS.uGcThin.value.w = density;
      group.visible = density > 0;
      if (density > built) build(density);
    },
    hideInRect(x0, y0, x1, y1) {
      hidden.push([x0, y0, x1, y1]);
      return hide(x0, y0, x1, y1);
    },
    dispose() {
      group.removeFromParent();
      clear();
    },
  };
  api.setQuality(quality);
  return api;
}
