// Far markers for units (DESIGN 8, "Far zoom"; zoom-lod.js unitFar). A unit under about 11 pixels tall is a
// few colored dots to the eye, but its model is five or six draw calls and, on high and ultra, a skinned
// mesh with its own animation: a few hundred of them are what a wide view of an army costs. Those units
// are drawn here instead, every one a small figure in its team's color, all of them in ONE instanced draw
// (a few thousand triangles), and their models are hidden and not animated until the camera comes back.
import * as THREE from 'three';
import { patchWorldMaterial } from './shading.js';
import { patchFowMaterial } from './fog.js';

/** Height of the figure at scale 1 and its radius at the foot, as a share of the unit's height. */
const HALF_WIDTH = 0.17;

const PI = Math.PI;

/**
 * A small figure of height 1: a robed body, a neck and a round head, darker at the foot and lighter
 * toward the head (the instance color, the team's, multiplies it). 54 triangles.
 */
export function farUnitGeometry() {
  // [y, radius, shade]
  const rings = [[0, HALF_WIDTH, 0.46], [0.5, 0.13, 0.72], [0.62, 0.09, 0.76], [0.7, 0.12, 0.85], [0.88, 0.12, 0.9], [1, 0, 0.95]];
  const sides = 6;
  const pos = [];
  const col = [];
  const idx = [];
  const start = [];
  for (const [y, r, k] of rings) {
    start.push(pos.length / 3);
    if (r === 0) {
      pos.push(0, y, 0);
      col.push(k, k, k);
      continue;
    }
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      col.push(k, k, k);
    }
  }
  for (let k = 0; k + 1 < rings.length; k++) {
    const a0 = start[k];
    const b0 = start[k + 1];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (rings[k + 1][1] === 0) idx.push(a0 + j, a0 + i, b0);
      else idx.push(a0 + j, a0 + i, b0 + i, a0 + j, b0 + i, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The instanced far markers of the units in view. */
export class FarUnits {
  /** @param {THREE.Object3D} parent where the instanced mesh goes (the entity root) */
  constructor(parent) {
    this.parent = parent;
    this.geometry = farUnitGeometry();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.name = 'far-units';
    patchWorldMaterial(m, { cloud: true, rim: 0.3 });
    patchFowMaterial(m);
    this.material = m;
    this.mesh = null;
    this.capacity = 0;
    this.count = 0;
    this.grow(128);
  }

  grow(capacity) {
    const old = this.mesh;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.name = 'far-units';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, this.count * 16));
      mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, this.count * 3));
      this.parent.remove(old);
      old.dispose();
    }
    this.parent.add(mesh);
    this.mesh = mesh;
    this.capacity = capacity;
  }

  /** Start a frame's list. */
  begin() {
    this.count = 0;
  }

  /**
   * One unit: the figure's foot at (x, y, z) in the world, `height` tall, `width` times as wide as a person
   * of that height, in `color` (a THREE.Color); `k` (0..1) scales it for a unit fading in or out.
   */
  add(x, y, z, height, width, color, k = 1) {
    if (this.count >= this.capacity) this.grow(this.capacity * 2);
    const a = this.mesh.instanceMatrix.array;
    const o = this.count * 16;
    const sy = height * k;
    const sx = height * width * k;
    a[o] = sx; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
    a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = sx; a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
    const c = this.mesh.instanceColor.array;
    c[this.count * 3] = color.r;
    c[this.count * 3 + 1] = color.g;
    c[this.count * 3 + 2] = color.b;
    this.count++;
  }

  /** Finish the list: draw what was added. */
  end() {
    const mesh = this.mesh;
    mesh.count = this.count;
    mesh.visible = this.count > 0;
    if (this.count > 0) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, this.count * 3);
      mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
