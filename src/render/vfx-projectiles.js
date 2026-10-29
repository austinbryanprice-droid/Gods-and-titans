// Projectile meshes for the VFX system: small low-poly models (built along +X)
// drawn through one InstancedMesh per kind, plus the per-kind flight specs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const lin = (hex) => new THREE.Color(hex);

/** Non-indexed copy of geo with a flat vertex color (optionally per face from a list). */
function colored(geo, hex, faceHexes = null) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const base = lin(hex);
  const faces = faceHexes ? faceHexes.map(lin) : null;
  for (let v = 0; v < n; v++) {
    const c = faces ? faces[Math.floor(v / 3) % faces.length] : base;
    col[v * 3] = c.r;
    col[v * 3 + 1] = c.g;
    col[v * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g !== geo) geo.dispose();
  return g;
}

function merge(parts) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

/** Flat polygon in the XZ plane (fan from the first point), double-sided material expected. */
function flatShape(points, hexCenter, hexEdge) {
  const pos = [];
  const col = [];
  const cc = lin(hexCenter);
  const ce = lin(hexEdge);
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cz = points.reduce((s, p) => s + p[1], 0) / points.length;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    pos.push(cx, 0, cz, a[0], 0, a[1], b[0], 0, b[1]);
    col.push(cc.r, cc.g, cc.b, ce.r, ce.g, ce.b, ce.r, ce.g, ce.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function arrowGeo() {
  const shaft = colored(new THREE.CylinderGeometry(0.026, 0.026, 0.66, 4).rotateZ(-Math.PI / 2), '#8a6a42');
  const head = colored(new THREE.ConeGeometry(0.065, 0.17, 4).rotateZ(-Math.PI / 2).translate(0.41, 0, 0), '#d0d4da');
  const f1 = colored(new THREE.BoxGeometry(0.2, 0.1, 0.006).translate(-0.27, 0, 0), '#f2eee2');
  const f2 = colored(new THREE.BoxGeometry(0.2, 0.006, 0.1).translate(-0.27, 0, 0), '#e8e0d0');
  return merge([shaft, head, f1, f2]);
}

function spearGeo() {
  const shaft = colored(new THREE.CylinderGeometry(0.035, 0.035, 1.15, 5).rotateZ(-Math.PI / 2), '#7a5a36');
  const head = colored(new THREE.ConeGeometry(0.085, 0.32, 4).rotateZ(-Math.PI / 2).translate(0.73, 0, 0), '#e2e6ea');
  const collar = colored(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 5).rotateZ(-Math.PI / 2).translate(0.56, 0, 0), '#c8a040');
  return merge([shaft, head, collar]);
}

function rockGeo() {
  const g = new THREE.IcosahedronGeometry(0.27, 0);
  // squash a little so it tumbles visibly
  g.scale(1.15, 0.9, 1);
  return colored(g, '#857563', ['#8a7a66', '#6e604e', '#9a8a72', '#7a6a58', '#a09078']);
}

function featherGeo() {
  const vane = flatShape([[-0.3, 0], [-0.16, 0.06], [0.06, 0.085], [0.24, 0.05], [0.32, 0], [0.24, -0.05], [0.06, -0.08], [-0.16, -0.055]], '#ffffff', '#d8d0c0');
  const quill = colored(new THREE.BoxGeometry(0.66, 0.012, 0.012).translate(-0.02, 0.004, 0), '#c8b890');
  quill.deleteAttribute('normal');
  vane.deleteAttribute('normal');
  return merge([vane, quill]);
}

function leafGeo() {
  const blade = flatShape([[-0.22, 0], [-0.1, 0.09], [0.08, 0.11], [0.24, 0.04], [0.28, 0], [0.24, -0.04], [0.08, -0.11], [-0.1, -0.09]], '#8ad860', '#3f8a2a');
  const stem = colored(new THREE.BoxGeometry(0.5, 0.01, 0.014).translate(-0.02, 0.004, 0), '#c8f090');
  stem.deleteAttribute('normal');
  blade.deleteAttribute('normal');
  return merge([blade, stem]);
}

function iceGeo() {
  const g = new THREE.OctahedronGeometry(1, 0);
  g.scale(0.42, 0.12, 0.12);
  return colored(g, '#cfefff', ['#e8fbff', '#a8dcff', '#ffffff', '#88c8f0', '#d0f2ff', '#b8e4ff', '#f0fcff', '#9ad4f8']);
}

function skullGeo() {
  const cranium = colored(new THREE.IcosahedronGeometry(0.19, 1).scale(0.95, 0.92, 0.85), '#e8e2cc');
  const jaw = colored(new THREE.BoxGeometry(0.15, 0.08, 0.17).translate(0.07, -0.15, 0), '#d8d0b8');
  const eyeL = colored(new THREE.BoxGeometry(0.06, 0.06, 0.06).translate(0.155, 0.02, 0.065), '#2a0a30');
  const eyeR = colored(new THREE.BoxGeometry(0.06, 0.06, 0.06).translate(0.155, 0.02, -0.065), '#2a0a30');
  const nose = colored(new THREE.BoxGeometry(0.04, 0.05, 0.035).translate(0.175, -0.06, 0), '#3a1a30');
  return merge([cranium, jaw, eyeL, eyeR, nose]);
}

/**
 * Curved wall for waves: an arc bowed toward +X, ~1.8 wide (Z) and 1 tall at
 * scale 1, vertex brightness for additive blending (black = transparent).
 */
function crescentGeo() {
  const COLS = 24;
  // a breaking wave in profile: a sloped back (visible from the RTS camera),
  // a bright crest and a lip that curls forward and fades out
  const ROWS = [
    { y: 0, dx: -0.42, b: 0.0 },
    { y: 0.12, dx: -0.3, b: 0.35 },
    { y: 0.38, dx: -0.1, b: 0.75 },
    { y: 0.66, dx: 0.1, b: 1.0 },
    { y: 0.84, dx: 0.3, b: 0.85 },
    { y: 0.8, dx: 0.5, b: 0.0 },
  ];
  const pos = [];
  const col = [];
  const span = (65 * Math.PI) / 180;
  ROWS.forEach((r, j) => {
    for (let i = 0; i <= COLS; i++) {
      const th = -span + (2 * span * i) / COLS;
      const edge = Math.sin(((i / COLS) * Math.PI)) ** 0.8;
      pos.push((Math.cos(th) - 1) * 0.55 + r.dx, r.y, Math.sin(th));
      // streaks of foam so the sheet does not read as a flat plate
      const streak = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(i * 2.3 + j * 1.1));
      const b = r.b * edge * streak;
      col.push(b, b, b);
    }
  });
  const idx = [];
  const W = COLS + 1;
  for (let j = 0; j < ROWS.length - 1; j++) {
    for (let i = 0; i < COLS; i++) {
      const a = j * W + i;
      idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);

/** One InstancedMesh with slot allocation; free slots hold a zero-scale matrix. */
export class InstancedBatch {
  constructor(root, geo, mat, cap, name) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) {
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, WHITE);
    }
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.freeList = [];
    for (let i = cap - 1; i >= 0; i--) this.freeList.push(i);
    this.used = new Uint8Array(cap);
    this.high = 0;
    this.active = 0;
    this.dirty = false;
    this.colorDirty = false;
    root.add(this.mesh);
  }

  alloc() {
    if (!this.freeList.length) return -1;
    const i = this.freeList.pop();
    this.used[i] = 1;
    this.active++;
    if (i + 1 > this.high) this.high = i + 1;
    return i;
  }

  setMatrix(i, m) {
    if (i < 0) return;
    this.mesh.setMatrixAt(i, m);
    this.dirty = true;
  }

  setColor(i, c) {
    if (i < 0) return;
    this.mesh.setColorAt(i, c);
    this.colorDirty = true;
  }

  free(i) {
    if (i < 0 || !this.used[i]) return;
    this.used[i] = 0;
    this.active--;
    this.mesh.setMatrixAt(i, ZERO);
    this.dirty = true;
    this.freeList.push(i);
    while (this.high > 0 && !this.used[this.high - 1]) this.high--;
  }

  flush() {
    this.mesh.count = this.high;
    this.mesh.visible = this.high > 0;
    if (this.dirty) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, Math.max(1, this.high) * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
    if (this.colorDirty) {
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, Math.max(1, this.high) * 3);
      this.mesh.instanceColor.needsUpdate = true;
      this.colorDirty = false;
    }
  }

  clear() {
    for (let i = 0; i < this.cap; i++) if (this.used[i]) this.free(i);
    this.flush();
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

/**
 * Build the instanced batches, keyed by mesh name.
 * @returns {{ batches: Object<string, InstancedBatch>, materials: THREE.Material[] }}
 */
export function createProjectileBatches(root, scale = 1) {
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const unlit = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const crystal = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 });
  const glowWall = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  // additive, no depth writes: one pass draws what three.js's back-then-front two passes would
  glowWall.forceSinglePass = true;
  const cap = (n) => Math.max(8, Math.round(n * scale));
  const batches = {
    arrow: new InstancedBatch(root, arrowGeo(), solid, cap(256), 'vfx-arrows'),
    spear: new InstancedBatch(root, spearGeo(), solid, cap(64), 'vfx-spears'),
    rock: new InstancedBatch(root, rockGeo(), solid, cap(96), 'vfx-rocks'),
    feather: new InstancedBatch(root, featherGeo(), unlit, cap(64), 'vfx-feathers'),
    leaf: new InstancedBatch(root, leafGeo(), unlit, cap(64), 'vfx-leaves'),
    ice: new InstancedBatch(root, iceGeo(), crystal, cap(64), 'vfx-ice'),
    skull: new InstancedBatch(root, skullGeo(), solid, cap(48), 'vfx-skulls'),
    crescent: new InstancedBatch(root, crescentGeo(), glowWall, cap(192), 'vfx-crescents'),
  };
  batches.crescent.mesh.renderOrder = 12;
  return { batches, materials: [solid, unlit, crystal, glowWall] };
}

/**
 * Flight look per projectile kind.
 * mesh: instanced batch or null; arc: apex height = arc0 + arcK × distance (capped arcMax);
 * glow: head glow size (0 = none); trail: particle trail style; spin: tumble rad/s.
 */
export const PROJECTILE_SPECS = {
  arrow: { mesh: 'arrow', arc0: 0.25, arcK: 0.11, arcMax: 2.2, glow: 0, trail: null, spin: 0, impact: 'spark' },
  spear: { mesh: 'spear', arc0: 0.15, arcK: 0.06, arcMax: 1.4, glow: 0.35, trail: 'streak', spin: 0, impact: 'spark' },
  orb: { mesh: null, arc0: 0, arcK: 0, arcMax: 0, glow: 0.8, trail: 'motes', spin: 0, impact: 'burst' },
  bolt: { mesh: null, arc0: 0, arcK: 0, arcMax: 0, glow: 0.7, trail: 'lightning', spin: 0, impact: 'zap' },
  rock: { mesh: 'rock', arc0: 1, arcK: 0.22, arcMax: 3.2, glow: 0, trail: 'dust', spin: 7, impact: 'rock' },
  fireball: { mesh: null, arc0: 0.1, arcK: 0.03, arcMax: 0.6, glow: 0.95, trail: 'fire', spin: 0, impact: 'explode' },
  feather: { mesh: 'feather', arc0: 0.2, arcK: 0.06, arcMax: 1, glow: 0.35, trail: 'sparkle', spin: 0, impact: 'puff' },
  wave: { mesh: 'crescent', arc0: 0, arcK: 0, arcMax: 0, glow: 0, trail: 'spray', spin: 0, impact: 'splash' },
  skull: { mesh: 'skull', arc0: 0.1, arcK: 0.02, arcMax: 0.5, glow: 0.75, trail: 'ghost', spin: 0, impact: 'wisp' },
  sunray: { mesh: null, arc0: 0, arcK: 0, arcMax: 0, glow: 0.75, trail: 'ray', spin: 0, impact: 'flash' },
  moonbeam: { mesh: null, arc0: 0, arcK: 0, arcMax: 0, glow: 0.65, trail: 'ray', spin: 0, impact: 'flash' },
  leaf: { mesh: 'leaf', arc0: 0.15, arcK: 0.04, arcMax: 0.8, glow: 0.3, trail: 'leaves', spin: 12, impact: 'puff' },
  ice: { mesh: 'ice', arc0: 0.1, arcK: 0.03, arcMax: 0.6, glow: 0.45, trail: 'frost', spin: 5, impact: 'shatter' },
};
