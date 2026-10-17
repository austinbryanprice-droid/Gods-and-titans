// Procedural low-poly unit models (DESIGN.md 4.6 and 8).
//
//   const model = buildUnitModel(unitType, '#d63a3a');
//   scene.add(model.root);                 // renderer sets root position / rotation.y = -facing
//   model.animate(st, timeSec, dt, { moving, attackPhase, level, carry });
//   model.height                           // top of the model (health bar placement)
//   model.dispose();                       // detaches; shared geometry stays cached
//
// Geometry is built once per unit type (merged, vertex-colored, with morph
// targets for knees / elbows / wings / waves) and shared by every instance.
// One Lambert material per (team color × morph count × opacity) covers all
// units; team-colored vertices are recolored in the vertex shader.
import * as THREE from 'three';
import { buildTemplate, normalizeVisual } from './unit-bodies.js';
import { animateModel, driveWave } from './unit-anim.js';
import { PartBuilder, TEAM, C, box, cyl, dodeca, seg, T } from './unit-geo.js';

const HOVER = 2.2; // air units fly this high above the ground
const TEMPLATES = new Map();
const MATERIALS = new Map();
const AURA_MATS = new Map();
let shared = null;
let seedCounter = 1;

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

function patchTeamShader(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTeamColor = mat.userData.uTeamColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFx;\nuniform vec3 uTeamColor;\nvarying float vGlow;')
      .replace(
        '#include <color_vertex>',
        '#include <color_vertex>\n#if defined( USE_COLOR )\n\tif ( aFx.x > 0.0 ) vColor.rgb = uTeamColor * aFx.x;\n#endif\n\tvGlow = aFx.y;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * vGlow * 0.85;');
  };
  mat.customProgramCacheKey = () => 'mythicwar-unit-v1';
}

/**
 * Shared unit material for a team color. Materials are split by morph target
 * count (three.js recompiles when that changes between draws) and ghostliness.
 */
export function getUnitMaterial(teamColor, morphCount = 0, ghost = false) {
  const col = C(teamColor);
  const key = `${col.getHexString()}|${morphCount}|${ghost ? 1 : 0}`;
  let m = MATERIALS.get(key);
  if (m) return m;
  m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.userData.uTeamColor = { value: col };
  if (ghost) {
    m.transparent = true;
    m.opacity = 0.62;
    m.depthWrite = true;
  }
  m.name = `unit-${key}`;
  patchTeamShader(m);
  MATERIALS.set(key, m);
  return m;
}

function auraMaterial(color) {
  const col = C(color);
  const key = col.getHexString();
  let m = AURA_MATS.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: col, vertexColors: true, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    m.name = `unit-aura-${key}`;
    AURA_MATS.set(key, m);
  }
  return m;
}

function sharedAssets() {
  if (shared) return shared;
  // aura: soft ground glow (vertex color falloff, additive) + ring + orbiting motes
  const pos = [];
  const colr = [];
  const push = (x, y, z, c) => {
    pos.push(x, y, z);
    colr.push(c, c, c);
  };
  const rings = [0, 0.28, 0.56, 0.8];
  const inten = [0.4, 0.27, 0.1, 0];
  const N = 20;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const r0 = rings[r];
      const r1 = rings[r + 1];
      const p00 = [Math.cos(a0) * r0, 0, Math.sin(a0) * r0];
      const p01 = [Math.cos(a1) * r0, 0, Math.sin(a1) * r0];
      const p10 = [Math.cos(a0) * r1, 0, Math.sin(a0) * r1];
      const p11 = [Math.cos(a1) * r1, 0, Math.sin(a1) * r1];
      push(...p00, inten[r]); push(...p10, inten[r + 1]); push(...p11, inten[r + 1]);
      if (r0 > 0) { push(...p00, inten[r]); push(...p11, inten[r + 1]); push(...p01, inten[r]); }
    }
  }
  // thin ring at r 0.62 with brighter dashes
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const ri = 0.6;
    const ro = 0.65;
    const q = [[Math.cos(a0) * ri, Math.sin(a0) * ri], [Math.cos(a0) * ro, Math.sin(a0) * ro], [Math.cos(a1) * ro, Math.sin(a1) * ro], [Math.cos(a1) * ri, Math.sin(a1) * ri]];
    const c = i % 4 === 0 ? 0.7 : 0.3;
    push(q[0][0], 0.005, q[0][1], c); push(q[1][0], 0.005, q[1][1], c); push(q[2][0], 0.005, q[2][1], c);
    push(q[0][0], 0.005, q[0][1], c); push(q[2][0], 0.005, q[2][1], c); push(q[3][0], 0.005, q[3][1], c);
  }
  // motes: small vertical diamonds orbiting at various heights
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = 0.5 + (i % 2) * 0.1;
    const y = 0.25 + ((i * 37) % 9) * 0.1;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.07;
    const w = 0.03;
    const tx = -Math.sin(a) * w;
    const tz = Math.cos(a) * w;
    push(x, y + h, z, 1); push(x + tx, y, z + tz, 0.6); push(x, y - h, z, 1);
    push(x, y + h, z, 1); push(x, y - h, z, 1); push(x - tx, y, z - tz, 0.6);
  }
  const aura = new THREE.BufferGeometry();
  aura.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  aura.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  aura.computeBoundingSphere();

  // blob shadow for flyers (rgba vertex colors → alpha falloff)
  const sp = [];
  const sc = [];
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = ((i + 1) / 16) * Math.PI * 2;
    sp.push(0, 0, 0, Math.cos(a1) * 0.6, 0, Math.sin(a1) * 0.6, Math.cos(a0) * 0.6, 0, Math.sin(a0) * 0.6);
    sc.push(0, 0, 0, 0.42, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  const shadow = new THREE.BufferGeometry();
  shadow.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  shadow.setAttribute('color', new THREE.Float32BufferAttribute(sc, 4));
  shadow.computeBoundingSphere();
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false });
  shadowMat.name = 'unit-blob-shadow';

  // carried cargo
  const sack = new PartBuilder();
  const bag = dodeca(0.105);
  T(bag, [0, 0, 0], [0, 0, 0], [1, 0.85, 1]);
  sack.add(bag, '#a8865a');
  const tie = cyl(0.03, 0.04, 0.04, 5);
  T(tie, [0, 0.092, 0]);
  sack.add(tie, '#6a4a2a');
  for (let i = 0; i < 3; i++) {
    const coin = cyl(0.028, 0.028, 0.012, 6);
    T(coin, [Math.cos(i * 2.1) * 0.03, 0.12, Math.sin(i * 2.1) * 0.03], [0.4, 0, 0.3 * i]);
    sack.add(coin, '#ffd040', { glow: 0.6 });
  }
  const wood = new PartBuilder();
  // a bundle of logs lying front-to-back on the shoulder (reads from above)
  for (let i = 0; i < 3; i++) {
    const log = seg([-0.2, -0.03, 0], [0.17, 0.04, 0], 0.036, 0.032, 5);
    T(log, [0, i === 2 ? 0.055 : 0, i === 2 ? 0 : (i - 0.5) * 0.065]);
    wood.add(log, i % 2 ? '#8a5e34' : '#6e4a2a');
  }
  const strap = cyl(0.075, 0.075, 0.03, 6, true);
  T(strap, [0, 0.02, 0], [0, 0, Math.PI / 2], [1, 1, 1.1]);
  wood.add(strap, TEAM(0.8));
  shared = { aura, shadow, shadowMat, sack: sack.build(), wood: wood.build() };
  return shared;
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

function templateKey(unitType) {
  return `${unitType.id}|${unitType.class}|${unitType.air ? 1 : 0}|${JSON.stringify(unitType.visual || {})}`;
}

function getTemplate(unitType) {
  const key = templateKey(unitType);
  let tpl = TEMPLATES.get(key);
  if (!tpl) {
    tpl = buildTemplate(unitType);
    tpl.visual = normalizeVisual(unitType.visual);
    tpl.triangles = 0;
    tpl.meshes = 0;
    for (const p of tpl.parts) {
      if (p.geo) {
        tpl.triangles += p.geo.userData.triangles;
        tpl.meshes++;
      }
    }
    if (tpl.rig.tools) {
      let extra = 0;
      for (const g of Object.values(tpl.rig.tools)) extra = Math.max(extra, g.userData.triangles);
      tpl.triangles += extra - tpl.parts.find((p) => p.name === 'armR').geo.userData.triangles;
    }
    TEMPLATES.set(key, tpl);
  }
  return tpl;
}

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

function baseBox(geo) {
  if (!geo.userData.baseBox) {
    const p = geo.attributes.position;
    const b = new THREE.Box3();
    for (let i = 0; i < p.count; i++) b.expandByPoint(_v.fromBufferAttribute(p, i));
    geo.userData.baseBox = b;
  }
  return geo.userData.baseBox;
}

// ---------------------------------------------------------------------------
// instances
// ---------------------------------------------------------------------------

const RANGED_THROW = new Set(['spear', 'rock', 'bolt', 'ice', 'leaf']);

class UnitModel {
  constructor(unitType, teamColor) {
    const tpl = getTemplate(unitType);
    const v = tpl.visual;
    const assets = sharedAssets();
    this.unitType = unitType;
    this.template = tpl;
    this.kind = tpl.kind;
    this.rig = tpl.rig;
    this.scale = v.scale;
    this.air = !!unitType.air;
    this.root = new THREE.Group();
    this.root.name = `unit:${unitType.id}`;
    this.rigGroup = new THREE.Group();
    this.rigGroup.scale.setScalar(v.scale);
    this.root.add(this.rigGroup);
    this.parts = {};
    this.teamColor = C(teamColor ?? '#8a8a8a');
    for (const p of tpl.parts) {
      let obj;
      if (p.geo) {
        const count = p.geo.morphAttributes.position ? p.geo.morphAttributes.position.length : 0;
        obj = new THREE.Mesh(p.geo, getUnitMaterial(this.teamColor, count, !!p.ghost));
        obj.castShadow = true;
      } else obj = new THREE.Group();
      obj.name = p.name;
      obj.position.fromArray(p.pos);
      if (p.rot) obj.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
      this.parts[p.name] = obj;
      (p.parent ? this.parts[p.parent] : this.rigGroup).add(obj);
    }
    this.rest = {
      torsoRz: this.parts.torso ? this.parts.torso.rotation.z : 0,
      armRx: this.parts.armR ? this.parts.armR.position.x : 0,
      armLx: this.parts.armL ? this.parts.armL.position.x : 0,
    };
    // worker cargo
    if (this.parts.carry) {
      this.carryMesh = new THREE.Mesh(assets.sack, getUnitMaterial(this.teamColor, 0, false));
      this.carryMesh.visible = false;
      this.carryMesh.castShadow = true;
      this.parts.carry.add(this.carryMesh);
    }
    this.toolKind = 'none';
    // aura glow
    if (v.aura) {
      this.aura = new THREE.Mesh(assets.aura, auraMaterial(v.aura));
      this.aura.name = 'aura';
      this.aura.position.y = this.air ? 0.15 : 0.04;
      this.aura.renderOrder = 2;
      // the rig is scaled by visual.scale; keep the glow from swamping big units
      this.auraBase = (0.55 + 0.35 * v.scale) / v.scale;
      this.aura.scale.setScalar(this.auraBase);
      this.rigGroup.add(this.aura);
    }
    if (this.air) {
      this.shadow = new THREE.Mesh(assets.shadow, assets.shadowMat);
      this.shadow.name = 'shadow';
      this.shadow.position.y = 0.05;
      this.shadow.scale.setScalar(v.scale * (this.kind === 'bird' || this.kind === 'dragon' ? 1.2 : 0.9));
      this.shadow.renderOrder = 1;
      this.root.add(this.shadow);
    }
    // animation state
    this.seed = ((seedCounter++ * 2654435761) % 1000) / 1000 * 6.283;
    this.target = {};
    this.cur = {};
    this.walkPhase = this.seed;
    this.wavePhase = this.seed;
    this.wheelAngle = 0;
    this.time = 0;
    this.state = 'idle';
    this.deadTime = 0;
    this.sawPhase = false;
    this.lastAp = 1;
    this.punchSide = 1;
    this.moving = false;
    this.carry = 0;
    this.speed = unitType.speed || 2.5;
    const strideBase = this.rig.stride || 1.25;
    this.strideLen = strideBase * v.scale;
    this.hasWings = v.extras.includes('wings');
    this.ranged = !!(unitType.attack && unitType.attack.projectile);
    const w = v.weapon;
    this.rangedStyle = w === 'bow' ? 'bow' : ['lightning_bolt', 'discus', 'spear', 'club', 'axe', 'hammer', 'trident', 'cauldron'].includes(w) || RANGED_THROW.has(unitType.attack?.projectile) ? 'throw' : 'cast';
    this.hoverY = this.air ? HOVER : 0;
    this.rigGroup.position.y = this.hoverY;
    this.root.updateMatrixWorld(true);
    this.height = this.computeHeight();
    this.disposed = false;
  }

  computeHeight() {
    let top = 0;
    this.rigGroup.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    this.rigGroup.traverse((o) => {
      if (!o.isMesh || o === this.aura || o === this.carryMesh) return;
      _box.copy(baseBox(o.geometry)).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      top = Math.max(top, _box.max.y);
    });
    return top;
  }

  /** Lateral traveling wave on a mesh (tails, serpents, banners). */
  waveA(mesh, amp) {
    driveWave(mesh, this.wavePhase, amp);
  }

  setTool(kind) {
    if (!this.rig.tools || this.toolKind === kind) return;
    const g = this.rig.tools[kind] || this.rig.tools.none;
    this.parts.armR.geometry = g;
    this.toolKind = kind;
  }

  /**
   * Advance the procedural animation.
   * @param {string} state idle|move|attack|gather|return|build|pray|cast|dead
   * @param {number} timeSec global time in seconds
   * @param {number} dt seconds since the last call
   * @param {{moving?: boolean, attackPhase?: number, level?: number, carry?: 0|'g'|'w', speed?: number}} [extra]
   */
  animate(state, timeSec, dt, extra = {}) {
    if (this.disposed) return;
    const st = state || 'idle';
    if (st !== this.state) {
      if (this.state === 'dead') this.resetDeath();
      this.state = st;
      if (st === 'dead') this.deadTime = 0;
    }
    const ex = extra || {};
    this.moving = st === 'dead' ? false : ex.moving ?? (st === 'move' || st === 'return');
    this.carry = ex.carry || (st === 'return' && this.parts.carry ? 'g' : 0);
    // attack timing
    let ap = ex.attackPhase;
    if (ap !== undefined && ap !== null) {
      this.sawPhase = true;
      if (ap < this.lastAp - 0.2) this.punchSide = -this.punchSide;
      this.lastAp = ap;
    } else if (st === 'attack' && !this.sawPhase) {
      const cd = this.unitType.attack?.cooldown || 1.5;
      const x = (timeSec + this.seed) % cd;
      ap = x < 0.5 ? x / 0.5 : undefined;
      if (ap !== undefined && ap < this.lastAp - 0.2) this.punchSide = -this.punchSide;
      this.lastAp = ap ?? 1;
    }
    this.ap = st === 'attack' && ap !== null ? ap : undefined;
    // worker tools and cargo
    if (this.parts.carry) {
      const gatherKind = ex.gather || ex.carry || 'g';
      this.setTool(st === 'build' ? 'hammer' : st === 'gather' ? (gatherKind === 'w' ? 'axe' : 'pick') : 'none');
      const showCargo = this.carry && st !== 'gather' && st !== 'build' && st !== 'dead';
      this.carryMesh.visible = !!showCargo;
      if (showCargo) {
        const g = this.carry === 'w' ? sharedAssets().wood : sharedAssets().sack;
        if (this.carryMesh.geometry !== g) this.carryMesh.geometry = g;
      }
    }
    animateModel(this, st, timeSec, dt, ex);
    this.animateCommon(st, timeSec, dt, ex);
  }

  animateCommon(st, t, dt, ex) {
    const rg = this.rigGroup;
    // flyers bob
    let y = this.hoverY;
    if (this.air) y += 0.12 * Math.sin(t * 1.7 + this.seed) + (this.moving ? -0.05 : 0);
    // death: fall (flyers), topple sideways, then sink into the ground
    if (st === 'dead') {
      this.deadTime += dt;
      const d = this.deadTime;
      if (this.air) y = this.hoverY * Math.max(0, 1 - (d / 0.55) ** 2);
      const fallT = this.air ? Math.max(0, d - 0.45) : d;
      const topple = Math.min(1, fallT / 0.6) ** 2;
      const side = this.seed > 3.14 ? 1 : -1;
      rg.rotation.x = side * topple * (this.kind === 'humanoid' || this.kind === 'naga' || this.kind === 'spirit' ? 1.45 : 1.2);
      rg.rotation.z = topple * 0.15;
      // lie still for a moment, then sink out of sight by ~1.55 s
      const sink = Math.min(1, Math.max(0, (d - 0.95) / 0.6));
      y -= sink * sink * Math.max(0.35, this.height * 0.6);
      if (this.aura) this.aura.scale.setScalar(this.auraBase * Math.max(0.001, 1 - d / 0.8));
      if (this.shadow) this.shadow.visible = d < 1.2;
    }
    rg.position.y = y;
    if (this.shadow) {
      const k = 1 - 0.08 * Math.sin(t * 1.7 + this.seed);
      this.shadow.scale.setScalar(this.scale * (this.kind === 'bird' || this.kind === 'dragon' ? 1.2 : 0.9) * k);
    }
    if (this.aura && st !== 'dead') {
      const lvl = Math.max(1, ex.level || 1);
      const flare = st === 'cast' ? 1.45 + 0.1 * Math.sin(t * 14) : 1;
      const pulse = 1 + 0.05 * Math.sin(t * 2.3 + this.seed);
      this.aura.scale.setScalar(this.auraBase * (1 + 0.06 * (lvl - 1)) * pulse * flare);
      this.aura.rotation.y = t * (st === 'cast' ? 3.2 : 0.6) + this.seed;
    }
  }

  resetDeath() {
    this.deadTime = 0;
    this.rigGroup.rotation.set(0, 0, 0);
    this.rigGroup.position.y = this.hoverY;
    if (this.aura) this.aura.scale.setScalar(this.auraBase);
    if (this.shadow) this.shadow.visible = true;
  }

  /** Detach from the scene. Shared cached geometry and materials stay alive. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.root.clear();
    this.parts = {};
  }
}

/**
 * Build an animated low-poly model for a unit type in a team color.
 * @param {object} unitType unit type from the data registry (needs visual)
 * @param {string|number|THREE.Color} teamColor owner color
 * @returns {{root: THREE.Group, height: number, animate: Function, dispose: Function}}
 */
export function buildUnitModel(unitType, teamColor) {
  const m = new UnitModel(unitType, teamColor);
  return m;
}

/** Build (and cache) templates up front to avoid hitches on first spawn. */
export function preloadUnitModels(unitTypes) {
  for (const u of unitTypes) if (u && u.visual) getTemplate(u);
}

/** Triangle / mesh counts and base height (at visual scale) for a unit type. */
export function getUnitModelInfo(unitType) {
  const tpl = getTemplate(unitType);
  const m = new UnitModel(unitType, '#ffffff');
  let meshes = 0;
  m.root.traverse((o) => {
    if (o.isMesh) meshes++;
  });
  const info = { triangles: tpl.triangles, meshes, height: m.height, kind: tpl.kind, morphs: {} };
  for (const p of tpl.parts) if (p.geo) info.morphs[p.name] = p.geo.userData.morphNames.slice();
  m.dispose();
  return info;
}

/** Free every cached geometry and material (renderer teardown). */
export function clearUnitModelCache() {
  for (const tpl of TEMPLATES.values()) {
    for (const p of tpl.parts) if (p.geo) p.geo.dispose();
    if (tpl.rig.tools) for (const g of Object.values(tpl.rig.tools)) g.dispose();
  }
  TEMPLATES.clear();
  for (const m of MATERIALS.values()) m.dispose();
  MATERIALS.clear();
  for (const m of AURA_MATS.values()) m.dispose();
  AURA_MATS.clear();
  if (shared) {
    shared.aura.dispose();
    shared.shadow.dispose();
    shared.shadowMat.dispose();
    shared.sack.dispose();
    shared.wood.dispose();
    shared = null;
  }
}

export { HOVER as AIR_HOVER_HEIGHT };
