// Plain crowns for the forest at the far zoom (DESIGN 8, "Far zoom"; zoom-lod.js forestFar). Seen from
// 100 tiles up a tree is a dozen pixels tall: its leaf quads, needle tiers and trunk cost 76 to 144
// triangles a tree and mean nothing, while 12 000 of them are the biggest bill of a wide view. Here each
// variant is a few dozen triangles of smooth vertex-colored shape (a squashed ball, a cone of three bands,
// a spoked umbrella on a stick) in the leaf colors of the full tree, lit by the same foliage light (wrap,
// translucency, cool shade, night grade, cloud shadows, fog of war) with no wind and no shadow pass.
// The instances are the forest's own, copied from the chunk meshes (matrices and tints), so a tree stands
// where it stood; createForest builds them when the far crowns are first wanted and keeps them in step
// with fell().
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchWorldMaterial } from '../shading.js';
import { patchFowMaterial } from '../fog.js';
import { patchFoliageMaterial } from './foliage-shader.js';

/** Triangle counts of the far crowns by variant (for tests and budgets). */
export const FAR_TREE_TRIS = { pine: 30, broadleaf: 20, birch: 20, palm: 18 };

const PI = Math.PI;
const _c = new THREE.Color();
/** The far crowns' colors are the full trees' leaf colors times this: the full crowns' leaf texture and their
 *  shaded undersides average a little darker than the flat vertex colors. */
const TONE = 0.93;

/** One shape of a crown: position, smooth normal, color and the plain leaf weights (aFol = 1, 0, 0). */
function finishCrown(pos, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = pos.length / 3;
  const fol = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) fol[i * 3] = 1;
  g.setAttribute('aFol', new THREE.BufferAttribute(fol, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * A shape turned around the vertical axis: `rings` run from the bottom up as [y, radius, color]; a radius
 * of 0 is a single vertex (a pole). Counter-clockwise seen from outside.
 */
function lathe(rings, sides, rot = 0) {
  const pos = [];
  const col = [];
  const idx = [];
  const start = [];
  for (const [y, r, color] of rings) {
    _c.set(color).multiplyScalar(TONE);
    start.push(pos.length / 3);
    if (r === 0) {
      pos.push(0, y, 0);
      col.push(_c.r, _c.g, _c.b);
      continue;
    }
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      col.push(_c.r, _c.g, _c.b);
    }
  }
  for (let k = 0; k + 1 < rings.length; k++) {
    const a0 = start[k];
    const b0 = start[k + 1];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (rings[k][1] === 0) idx.push(a0, b0 + i, b0 + j);
      else if (rings[k + 1][1] === 0) idx.push(a0 + j, a0 + i, b0);
      else idx.push(a0 + j, a0 + i, b0 + i, a0 + j, b0 + i, b0 + j);
    }
  }
  return finishCrown(pos, col, idx);
}

/** A squashed ball (20 triangles) centered at height cy, colored from `low` at the bottom to `high` at the top. */
function ball(cy, rx, ry, low, high) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g);
  const p = m.attributes.position;
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Color(low);
  const b = new THREE.Color(high);
  for (let i = 0; i < p.count; i++) {
    const k = THREE.MathUtils.clamp((p.getY(i) + 1) / 2, 0, 1);
    _c.copy(a).lerp(b, k).multiplyScalar(TONE);
    col.set([_c.r, _c.g, _c.b], i * 3);
    p.setXYZ(i, p.getX(i) * rx, cy + p.getY(i) * ry, p.getZ(i) * rx);
  }
  return finishCrown(Array.from(p.array), Array.from(col), Array.from(m.index.array));
}

const BUILD = {
  // the oak: a dark underside, mid greens, a bright top (the crown's own occlusion, as in the full tree)
  broadleaf: () => ball(1.28, 0.72, 0.64, '#2d6a29', '#5ba63a'),
  // the birch: narrower and lighter
  birch: () => ball(1.32, 0.46, 0.6, '#6f9835', '#9bc150'),
  // the spruce: three bands narrowing to a point, dark at the foot, fresher up the tree
  pine: () => lathe([[0.3, 0.62, '#1f4223'], [1.05, 0.42, '#2a5429'], [1.75, 0.22, '#35693a'], [2.25, 0, '#49803f']], 6, 0.3),
  // the palm: a six-spoked umbrella of fronds on a thin stem
  palm: () => mergeGeometries([
    lathe([[1.42, 0.86, '#2e6a28'], [1.74, 0, '#4f8f33']], 6),
    lathe([[0, 0.07, '#6b4f30'], [1.45, 0.05, '#8a6b45'], [1.5, 0, '#8a6b45']], 4),
  ]),
};

const GEOS = new Map();
let MAT = null;

/** The shared far-crown geometry of a tree variant ('pine', 'broadleaf', 'birch', 'palm'). */
export function farTreeGeometry(variant) {
  let g = GEOS.get(variant);
  if (!g) {
    g = BUILD[variant]();
    GEOS.set(variant, g);
  }
  return g;
}

/**
 * The shared material of the far crowns: Lambert with the foliage light (soft terminator, light through the
 * leaves, cool shade, night grade) on the plain shapes, the world light and the fog of war.
 */
export function farTreeMaterial() {
  if (MAT) return MAT;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.name = 'props-plant-far';
  patchWorldMaterial(patchFoliageMaterial(m, { wrap: 0.35, translucency: 0.25, rim: 0.4, shade: [0.84, 1.0, 1.12] }), { cloud: true, rim: 0.12 });
  patchFowMaterial(m);
  MAT = m;
  return m;
}

/** Triangles of a far crown geometry. */
export function farTreeTriangles(variant) {
  const g = farTreeGeometry(variant);
  return g.index.count / 3;
}

/**
 * One InstancedMesh of far crowns for a list of trees. `trees` are the forest's tree records
 * ({ bucket: { mesh }, index }); each takes its near mesh's matrix and tint at that moment (felled trees
 * have the zero matrix there and stay gone).
 * @param {string} variant
 * @param {{ bucket: { mesh: THREE.InstancedMesh }, index: number }[]} trees
 * @returns {THREE.InstancedMesh}
 */
export function createFarCrowns(variant, trees) {
  const mesh = new THREE.InstancedMesh(farTreeGeometry(variant), farTreeMaterial(), Math.max(1, trees.length));
  mesh.name = `forest-far-${variant}`;
  mesh.count = trees.length;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // the whole map in one draw: the crowns are only wanted when most of it is on screen anyway
  mesh.frustumCulled = false;
  const mats = mesh.instanceMatrix.array;
  const cols = new Float32Array(Math.max(1, trees.length) * 3);
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const near = t.bucket.mesh;
    mats.set(near.instanceMatrix.array.subarray(t.index * 16, t.index * 16 + 16), i * 16);
    if (near.instanceColor) cols.set(near.instanceColor.array.subarray(t.index * 3, t.index * 3 + 3), i * 3);
    else cols.set([1, 1, 1], i * 3);
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
