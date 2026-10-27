// Building placement ghost (translucent model + per-tile green/red footprint
// grid), the ghost of a dragged wall line, the ground a Decade of Peace keeps
// clear around enemy Town Centers, and ghost outlines of own workers'
// pending build orders.
import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings.js';
import { wallConnections } from '../data/walls.js';
import { MAX_WALL_LINE } from '../config.js';
import { buildBuildingModel } from './models/building-models.js';
import { footprintHeight, heightAt } from './height.js';
import { NoBuildZone } from './no-build-zone.js';

const GRID_VS = `
attribute vec3 aCol;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = uv;
  vCol = aCol;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const GRID_FS = `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vec2 d = min( vUv, 1.0 - vUv );
  float edge = 1.0 - smoothstep( 0.05, 0.11, min( d.x, d.y ) );
  float a = ( 0.26 + 0.06 * sin( uTime * 5.0 ) + edge * 0.6 ) * uAlpha;
  gl_FragColor = vec4( vCol * ( 0.9 + 0.5 * edge ), a );
  #include <colorspace_fragment>
}`;

const OK_COLOR = new THREE.Color('#3cff5a');
const BAD_COLOR = new THREE.Color('#ff3328');
const MAX_TILES = 36; // up to 6×6

/** Footprint tile grid draped on the terrain. */
class FootprintGrid {
  constructor(parent, map, capacity = MAX_TILES) {
    this.map = map;
    const n = (this.capacity = capacity);
    this.n = 0;
    this.pos = new Float32Array(n * 4 * 3);
    this.col = new Float32Array(n * 4 * 3);
    const uv = new Float32Array(n * 4 * 2);
    const idx = [];
    for (let i = 0; i < n; i++) {
      uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
      const a = i * 4;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aCol', this.colAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.uniforms = { uTime: { value: 0 }, uAlpha: { value: 1 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: GRID_VS,
      fragmentShader: GRID_FS,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.material.name = 'placement-grid';
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'placement-grid';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.key = '';
  }

  set(tx, ty, size, valid, tiles) {
    let key = `${tx},${ty},${size},${valid ? 1 : 0}`;
    if (tiles) for (let i = 0; i < tiles.length; i++) key += tiles[i] ? '1' : '0';
    this.mesh.visible = true;
    if (key === this.key) return;
    this.key = key;
    this.n = 0;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const k = j * size + i;
        const ok = tiles && tiles.length === size * size ? !!tiles[k] && valid !== false : !!valid;
        this.cell(tx + i, ty + j, ok);
      }
    }
    this.flush();
  }

  /** Single tiles, each green (ok) or red: [{ tx, ty, ok }] (a dragged wall line). */
  setCells(cells) {
    let key = 'c';
    for (const c of cells) key += `${c.tx},${c.ty},${c.ok ? 1 : 0};`;
    this.mesh.visible = cells.length > 0;
    if (key === this.key) return;
    this.key = key;
    this.n = 0;
    for (const c of cells) this.cell(c.tx, c.ty, c.ok);
    this.flush();
  }

  /** The next tile's quad, draped on the terrain. */
  cell(tx, ty, ok) {
    if (this.n >= this.capacity) return;
    const map = this.map;
    const inset = 0.03;
    const c = ok ? OK_COLOR : BAD_COLOR;
    const x0 = tx + inset;
    const x1 = tx + 1 - inset;
    const z0 = ty + inset;
    const z1 = ty + 1 - inset;
    const corners = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]];
    for (let v = 0; v < 4; v++) {
      const [x, z] = corners[v];
      const o = (this.n * 4 + v) * 3;
      this.pos[o] = x;
      this.pos[o + 1] = Math.max(heightAt(map, x, z), -0.2) + 0.05;
      this.pos[o + 2] = z;
      this.col[o] = c.r;
      this.col[o + 1] = c.g;
      this.col[o + 2] = c.b;
    }
    this.n++;
  }

  flush() {
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.n * 6);
    this.mesh.geometry.computeBoundingSphere();
  }

  hide() {
    this.mesh.visible = false;
    this.key = '';
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// Glowing parts store HDR colors (they bloom in the world); the ghosts are
// drawn straight to the canvas, so they are scaled back into range.
const GHOST_GLOW_SCALE = 0.45;

/**
 * A fresnel edge in the ghost's tint: faces turned away from the camera light
 * up, so the translucent silhouette stays readable on any ground.
 */
function ghostEdge(mat, edge) {
  const uEdge = { value: edge };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGhostEdge = uEdge;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGhostEdge;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGhostEdge * pow( 1.0 - saturate( abs( dot( normal, normalize( vViewPosition ) ) ) ), 2.5 );`,
      );
  };
  mat.customProgramCacheKey = () => 'mythicwar-ghost-edge';
  return mat;
}

/** Ghost materials: the model's vertex colors (smooth where the model is round), translucent, tinted. */
function ghostMaterials(tint, opacity, teamColor) {
  const edge = tint.clone().multiplyScalar(0.35);
  const body = ghostEdge(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity, color: tint.clone(), depthWrite: true }), edge);
  body.name = 'ghost-body';
  const team = ghostEdge(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity, color: new THREE.Color(teamColor).multiply(tint), depthWrite: true }), edge);
  team.name = 'ghost-team';
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: opacity * 0.8, color: tint.clone().multiplyScalar(GHOST_GLOW_SCALE), depthWrite: false });
  glow.name = 'ghost-glow';
  return { body, team, glow };
}

function applyGhost(model, mats) {
  model.root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    o.renderOrder = 6;
    if (o.name === 'building-vortex') o.visible = false;
    else if (o.name === 'building-team') o.material = mats.team;
    else if (o.name === 'building-glow') o.material = mats.glow;
    else o.material = mats.body;
  });
}

/** Placement ghost + pending build-order ghosts for one local player. */
export class PlacementLayer {
  /**
   * @param {THREE.Object3D} parent
   * @param {object} map mapData (heights)
   * @param {() => {pantheon: object|null, color: string}} getStyle the local player's pantheon data and color
   */
  constructor(parent, map, getStyle) {
    this.parent = parent;
    this.map = map;
    this.getStyle = getStyle;
    this.grid = new FootprintGrid(parent, map);
    this.lineGrid = new FootprintGrid(parent, map, MAX_WALL_LINE);
    this.zone = new NoBuildZone(parent, map); // shown with the ghost, whichever kind
    this.ghost = null; // { type, model, mats }
    this.line = { type: null, ghosts: [] }; // the segments of a dragged wall line: { model, valid, mask }
    this.valid = true;
    this.matsOk = null;
    this.matsBad = null;
    this.orderMats = null;
    this.orders = new Map(); // key → { model, used }
    this.orderPool = new Map(); // type → [models]
    this.time = 0;
  }

  ensureMats() {
    if (this.matsOk) return;
    const { color } = this.getStyle();
    this.matsOk = ghostMaterials(new THREE.Color(0.8, 1.15, 0.85), 0.62, color);
    this.matsBad = ghostMaterials(new THREE.Color(1.35, 0.5, 0.45), 0.6, color);
    this.orderMats = ghostMaterials(new THREE.Color(0.85, 0.95, 1.1), 0.38, color);
  }

  /**
   * Build one hidden ghost (of a building with glow parts, so every ghost
   * material is used) for the renderer's warm-up compile; otherwise the first
   * build placement of a match links the ghost shaders. The first show() of
   * that type reuses it.
   */
  prewarm() {
    if (this.ghost) return;
    const typeId = ['shrine', 'temple', 'town_center'].find((t) => BUILDINGS[t]);
    if (!typeId) return;
    this.ensureMats();
    const { pantheon, color } = this.getStyle();
    const model = buildBuildingModel(typeId, pantheon, color, 1);
    applyGhost(model, this.matsOk);
    model.root.visible = false;
    this.parent.add(model.root);
    this.ghost = { type: typeId, model, valid: true };
  }

  /**
   * Show the ghost for a building type with its top-left tile at (tx, ty).
   * @param {boolean[]|Uint8Array} [tiles] per-tile validity (row-major, size×size)
   */
  show(typeId, tx, ty, valid, tiles) {
    const def = BUILDINGS[typeId];
    if (!def) {
      this.hide();
      return;
    }
    this.hideLine();
    this.ensureMats();
    if (!this.ghost || this.ghost.type !== typeId) {
      if (this.ghost) this.ghost.model.dispose();
      const { pantheon, color } = this.getStyle();
      const model = buildBuildingModel(typeId, pantheon, color, 1);
      applyGhost(model, valid ? this.matsOk : this.matsBad);
      this.parent.add(model.root);
      this.ghost = { type: typeId, model, valid: !!valid };
    }
    const g = this.ghost;
    const allOk = valid && (!tiles || Array.prototype.every.call(tiles, Boolean));
    if (g.valid !== allOk) {
      applyGhost(g.model, allOk ? this.matsOk : this.matsBad);
      g.valid = allOk;
    }
    const size = def.size;
    g.model.root.visible = true;
    g.model.root.position.set(tx + size / 2, footprintHeight(this.map, tx, ty, size), ty + size / 2);
    this.grid.set(tx, ty, size, valid, tiles);
    this.zone.show();
  }

  /**
   * The ground kept clear of building around these enemy Town Centers ([{ tx, ty, size }], none to
   * clear it): drawn under the ghost, whenever one is shown (the Decade of Peace, DESIGN 5.10).
   */
  setZones(anchors) {
    this.zone.set(anchors || []);
  }

  hide() {
    if (this.ghost) this.ghost.model.root.visible = false;
    this.grid.hide();
    this.hideLine();
    this.zone.hide();
  }

  /**
   * Ghost of a dragged wall line: a translucent segment on every tile that would be built (red
   * where it cannot be), running on to its neighbours and to the walls and towers already standing.
   * Tiles that already hold a wall are left as they are.
   * @param {string} typeId wall segment type
   * @param {Array<{tx: number, ty: number, state: 'build'|'held'|'blocked'}>} tiles the line (game/placement.js checkWallLine)
   * @param {(tx: number, ty: number) => number} [kindAt] 1 where a segment of the same wall stands, 2 a tower that joined it
   */
  showLine(typeId, tiles, kindAt) {
    const def = BUILDINGS[typeId];
    if (!def || !def.wall) {
      this.hide();
      return;
    }
    if (this.ghost) this.ghost.model.root.visible = false;
    this.grid.hide();
    this.ensureMats();
    const line = this.line;
    if (line.type !== typeId) {
      this.clearLine();
      line.type = typeId;
    }
    const planned = new Set();
    for (const t of tiles) if (t.state !== 'blocked') planned.add(t.ty * 4096 + t.tx);
    const kind = (x, y) => (kindAt && kindAt(x, y)) || (planned.has(y * 4096 + x) ? 1 : 0);
    const cells = [];
    let n = 0;
    for (const t of tiles) {
      if (t.state === 'held') continue;
      const ok = t.state === 'build';
      cells.push({ tx: t.tx, ty: t.ty, ok });
      let g = line.ghosts[n];
      if (!g) {
        const { pantheon, color } = this.getStyle();
        g = { model: buildBuildingModel(typeId, pantheon, color, 1), valid: null, mask: 0 };
        this.parent.add(g.model.root);
        line.ghosts[n] = g;
      }
      n++;
      const mask = wallConnections(t.tx, t.ty, kind);
      if (mask !== g.mask) {
        g.mask = mask;
        g.model.setConnections(mask);
        g.valid = null; // the new geometry may have brought meshes of its own
      }
      if (g.valid !== ok) {
        applyGhost(g.model, ok ? this.matsOk : this.matsBad);
        g.valid = ok;
      }
      g.model.root.position.set(t.tx + 0.5, footprintHeight(this.map, t.tx, t.ty, 1), t.ty + 0.5);
      g.model.root.visible = true;
    }
    for (let i = n; i < line.ghosts.length; i++) line.ghosts[i].model.root.visible = false;
    this.lineGrid.setCells(cells);
    this.zone.show();
  }

  hideLine() {
    for (const g of this.line.ghosts) g.model.root.visible = false;
    this.lineGrid.hide();
  }

  clearLine() {
    for (const g of this.line.ghosts) g.model.dispose();
    this.line.ghosts.length = 0;
  }

  /**
   * Pending build orders of own workers.
   * @param {Iterable<{b: string, tx: number, ty: number}>} list
   */
  setOrders(list) {
    for (const o of this.orders.values()) o.used = false;
    for (const bo of list) {
      const def = BUILDINGS[bo.b];
      if (!def) continue;
      const key = `${bo.b}|${bo.tx}|${bo.ty}`;
      let o = this.orders.get(key);
      if (!o) {
        this.ensureMats();
        const pool = this.orderPool.get(bo.b);
        let model = pool && pool.pop();
        if (!model) {
          const { pantheon, color } = this.getStyle();
          model = buildBuildingModel(bo.b, pantheon, color, 1);
          applyGhost(model, this.orderMats);
        }
        this.parent.add(model.root);
        model.root.position.set(bo.tx + def.size / 2, footprintHeight(this.map, bo.tx, bo.ty, def.size), bo.ty + def.size / 2);
        o = { model, type: bo.b, used: true };
        this.orders.set(key, o);
      }
      o.used = true;
    }
    for (const [key, o] of this.orders) {
      if (o.used) continue;
      o.model.root.removeFromParent();
      let pool = this.orderPool.get(o.type);
      if (!pool) this.orderPool.set(o.type, (pool = []));
      pool.push(o.model);
      this.orders.delete(key);
    }
  }

  update(dt) {
    this.time += dt;
    this.grid.uniforms.uTime.value = this.time;
    this.lineGrid.uniforms.uTime.value = this.time;
    this.zone.update(dt);
    if (this.orderMats) {
      const k = 0.3 + 0.08 * Math.sin(this.time * 3);
      this.orderMats.body.opacity = k;
      this.orderMats.team.opacity = k;
      this.orderMats.glow.opacity = k * 0.8;
    }
  }

  dispose() {
    this.grid.dispose();
    this.lineGrid.dispose();
    this.zone.dispose();
    this.clearLine();
    if (this.ghost) this.ghost.model.dispose();
    this.ghost = null;
    for (const o of this.orders.values()) o.model.dispose();
    this.orders.clear();
    for (const pool of this.orderPool.values()) for (const m of pool) m.dispose();
    this.orderPool.clear();
    for (const set of [this.matsOk, this.matsBad, this.orderMats]) {
      if (!set) continue;
      for (const m of Object.values(set)) m.dispose();
    }
    this.matsOk = this.matsBad = this.orderMats = null;
  }
}
