// The ground a Decade of Peace keeps clear of building (DESIGN 5.10, 8): while a building is
// being placed, every tile within PEACE_BUILD_GAP of an enemy Town Center I know of is tinted red
// and hatched, with a brighter line along its outer edge, so the limit can be seen before the
// ghost turns red against it. One mesh of tile quads draped on the terrain (the footprint grid's
// way), rebuilt only when the Town Centers change; the same rule as the sim and the ghost's tiles
// (sim/peace.js peaceBlocksFootprint), so what is tinted is exactly what is refused.
import * as THREE from 'three';
import { PEACE_BUILD_GAP } from '../config.js';
import { peaceBlocksFootprint } from '../sim/peace.js';
import { heightAt } from './height.js';

const ZONE_VS = `
attribute vec4 aSides; // 1 where the neighbour tile west / east / north / south is not in the zone
varying vec2 vUv;
varying vec4 vSides;
varying vec2 vWorld;
void main() {
  vUv = uv;
  vSides = aSides;
  vWorld = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const ZONE_FS = `
uniform float uTime;
varying vec2 vUv;
varying vec4 vSides;
varying vec2 vWorld;
void main() {
  float w = 0.2;
  float line = max(
    max( vSides.x * ( 1.0 - smoothstep( 0.0, w, vUv.x ) ), vSides.y * ( 1.0 - smoothstep( 0.0, w, 1.0 - vUv.x ) ) ),
    max( vSides.z * ( 1.0 - smoothstep( 0.0, w, vUv.y ) ), vSides.w * ( 1.0 - smoothstep( 0.0, w, 1.0 - vUv.y ) ) ) );
  float band = abs( fract( ( vWorld.x + vWorld.y ) * 0.5 ) - 0.5 ) * 2.0; // diagonal stripes, a tile and a half apart
  float hatch = 1.0 - smoothstep( 0.22, 0.4, band );
  float pulse = 0.5 + 0.5 * sin( uTime * 2.2 );
  float a = 0.12 + 0.17 * hatch + line * ( 0.55 + 0.3 * pulse );
  gl_FragColor = vec4( mix( vec3( 1.0, 0.18, 0.12 ), vec3( 1.0, 0.55, 0.42 ), line ), min( a, 0.95 ) );
  #include <colorspace_fragment>
}`;

/**
 * Which tiles are inside the kept-clear ground of these Town Centers.
 * @param {number} width map width in tiles
 * @param {number} height map height in tiles
 * @param {{ tx: number, ty: number, size: number }[]} anchors
 * @returns {Uint8Array} width×height, 1 = kept clear
 */
export function zoneMask(width, height, anchors) {
  const mask = new Uint8Array(width * height);
  for (const a of anchors) {
    const one = [a];
    const x0 = Math.max(0, a.tx - PEACE_BUILD_GAP);
    const x1 = Math.min(width - 1, a.tx + a.size + PEACE_BUILD_GAP);
    const y0 = Math.max(0, a.ty - PEACE_BUILD_GAP);
    const y1 = Math.min(height - 1, a.ty + a.size + PEACE_BUILD_GAP);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (peaceBlocksFootprint(one, x, y, 1)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** The kept-clear ground of the enemy Town Centers, draped on the terrain while a building is placed. */
export class NoBuildZone {
  /**
   * @param {THREE.Object3D} parent
   * @param {object} map mapData (heights, width, height)
   */
  constructor(parent, map) {
    this.parent = parent;
    this.map = map;
    this.uniforms = { uTime: { value: 0 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: ZONE_VS,
      fragmentShader: ZONE_FS,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.material.name = 'no-build-zone';
    this.mesh = null; // made when there is a zone to draw
    this.key = '';
    this.cells = 0;
    this.shown = false;
  }

  /** Draw the ground kept clear around these Town Centers ([{ tx, ty, size }]; none = no zone). A no-op for the ones already drawn. */
  set(anchors) {
    const key = anchors.map((a) => `${a.tx},${a.ty},${a.size}`).join(';');
    if (key === this.key) return;
    this.key = key;
    this.build(anchors);
    this.apply();
  }

  build(anchors) {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.cells = 0;
    if (!anchors.length) return;
    const { width: W, height: H } = this.map;
    const mask = zoneMask(W, H, anchors);
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    if (!n) return;
    const pos = new Float32Array(n * 4 * 3);
    const uv = new Float32Array(n * 4 * 2);
    const sides = new Float32Array(n * 4 * 4);
    const idx = new Uint32Array(n * 6);
    const open = (x, y) => (x >= 0 && y >= 0 && x < W && y < H && !mask[y * W + x] ? 1 : 0);
    let c = 0;
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        if (!mask[ty * W + tx]) continue;
        const corners = [[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]]; // quads share their edges: no seams in the tint
        const side = [open(tx - 1, ty), open(tx + 1, ty), open(tx, ty - 1), open(tx, ty + 1)];
        for (let v = 0; v < 4; v++) {
          const [x, z] = corners[v];
          const o = (c * 4 + v) * 3;
          pos[o] = x;
          pos[o + 1] = Math.max(heightAt(this.map, x, z), -0.2) + 0.05;
          pos[o + 2] = z;
          sides.set(side, (c * 4 + v) * 4);
        }
        uv.set([0, 0, 1, 0, 0, 1, 1, 1], c * 8);
        const a = c * 4;
        idx.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], c * 6);
        c++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aSides', new THREE.BufferAttribute(sides, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'no-build-zone';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4; // under the footprint grid (5) and the ghost
    this.cells = n;
    this.parent.add(this.mesh);
  }

  apply() {
    if (this.mesh) this.mesh.visible = this.shown;
  }

  /** Show the zone that was set (with the placement ghost). */
  show() {
    this.shown = true;
    this.apply();
  }

  hide() {
    this.shown = false;
    this.apply();
  }

  update(dt) {
    this.uniforms.uTime.value += dt;
  }

  dispose() {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.material.dispose();
  }
}
