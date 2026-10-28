// Relics in the 3D view (DESIGN 5.15): a glowing jewel in a gold ring, tinted by its relic, spinning
// over the ground under a pale beam of light while it is guarded or lies free (so a camp worth
// clearing reads from afar), smaller over the head of the Worshipper or god that carries it, and
// floating over the Temple where it rests. One small group per relic (a map has a handful).
import * as THREE from 'three';
import { getRelic } from '../data/relics.js';
import { patchFowObject } from './fog.js';

const BEAM_HEIGHT = 6;
const GROUND_LIFT = 0.65; // the jewel's height over the ground while it lies there
const HEAD_GAP = 0.45; // over a carrier's head
const TEMPLE_GAP = 0.9; // over a Temple's roof

let shared = null;
function sharedParts() {
  if (shared) return shared;
  const beam = new THREE.CylinderGeometry(0.16, 0.42, BEAM_HEIGHT, 14, 1, true);
  beam.translate(0, BEAM_HEIGHT / 2, 0);
  // fade the beam out toward its top (vertex alpha through the colour's red channel times the opacity)
  const pos = beam.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 - pos.getY(i) / BEAM_HEIGHT;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k * k;
  }
  beam.setAttribute('color', new THREE.BufferAttribute(col, 3));
  shared = {
    gem: new THREE.OctahedronGeometry(0.2, 0),
    ring: new THREE.TorusGeometry(0.3, 0.035, 6, 24),
    beam,
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a63a, metalness: 0.85, roughness: 0.3, emissive: 0x3a2400, emissiveIntensity: 0.6 }),
  };
  return shared;
}

class RelicView {
  constructor(parent, type) {
    const parts = sharedParts();
    const def = getRelic(type);
    const color = new THREE.Color(def ? def.color : '#ffd34a');
    this.type = type;
    this.root = new THREE.Group();
    this.root.name = `relic-${type}`;
    this.jewel = new THREE.Group();
    this.gemMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8, metalness: 0.2, roughness: 0.25 });
    const gem = new THREE.Mesh(parts.gem, this.gemMat);
    gem.scale.set(1, 1.35, 1);
    const ring = new THREE.Mesh(parts.ring, parts.gold);
    ring.rotation.x = Math.PI / 2;
    const ring2 = new THREE.Mesh(parts.ring, parts.gold);
    ring2.scale.setScalar(0.8);
    this.ring = ring2;
    this.jewel.add(gem, ring, ring2);
    for (const m of [gem, ring, ring2]) m.castShadow = true;
    patchFowObject(this.jewel);
    this.beamMat = new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beam = new THREE.Mesh(parts.beam, this.beamMat);
    this.beam.renderOrder = 2;
    this.root.add(this.jewel, this.beam);
    parent.add(this.root);
  }

  dispose() {
    this.root.removeFromParent();
    this.gemMat.dispose();
    this.beamMat.dispose();
  }
}

export class RelicLayer {
  /**
   * @param {THREE.Object3D} parent
   * @param {(x: number, y: number) => number} heightFn
   */
  constructor(parent, heightFn) {
    this.parent = parent;
    this.heightFn = heightFn;
    this.views = new Map(); // relic index → RelicView
  }

  /**
   * Place every relic for this frame.
   * @param {object} vs ViewState
   * @param {number} time renderer clock (s)
   * @param {Map} units id → UnitView
   * @param {Map} buildings id → BuildingView
   */
  update(vs, time, units, buildings) {
    const seen = new Set();
    for (const r of vs.relics || []) {
      if (!Number.isInteger(r.i)) continue;
      seen.add(r.i);
      let v = this.views.get(r.i);
      if (!v || v.type !== r.t) {
        if (v) v.dispose();
        v = new RelicView(this.parent, r.t);
        this.views.set(r.i, v);
      }
      v.root.visible = this.place(v, r, vs, time, units, buildings);
    }
    for (const [i, v] of this.views) {
      if (seen.has(i)) continue;
      v.dispose();
      this.views.delete(i);
    }
  }

  place(v, r, vs, time, units, buildings) {
    const spin = time * 1.4 + r.i * 1.7;
    const bob = Math.sin(time * 2.1 + r.i) * 0.06;
    v.jewel.rotation.y = spin;
    v.ring.rotation.y = -spin * 1.6;
    if (r.s === 'c') {
      const u = units.get(r.c);
      if (!u || !u.visible || u.fade < 0.5 || u.far) return false;
      const p = u.model.root.position;
      v.root.position.set(p.x, p.y + u.height + HEAD_GAP + bob, p.z);
      v.jewel.scale.setScalar(0.7);
      v.jewel.position.y = 0;
      v.beam.visible = false;
      return true;
    }
    if (r.s === 'h') {
      const b = buildings.get(r.b);
      if (!b || !vs.isEntityVisible(b.e)) return false;
      // several relics in one Temple circle its roof
      const list = vs.relicsIn(r.b);
      const k = Math.max(0, list.indexOf(r));
      const a = (k / Math.max(1, list.length)) * Math.PI * 2 + time * 0.4;
      const rr = list.length > 1 ? 0.7 : 0;
      v.root.position.set(b.x + Math.cos(a) * rr, b.baseY + b.height + TEMPLE_GAP + bob, b.y + Math.sin(a) * rr);
      v.jewel.scale.setScalar(0.85);
      v.jewel.position.y = 0;
      v.beam.visible = false;
      return true;
    }
    if (!vs.relicKnown(r)) return false;
    v.root.position.set(r.x, this.heightFn(r.x, r.y), r.y);
    v.jewel.position.y = GROUND_LIFT + bob;
    v.jewel.scale.setScalar(1);
    v.beam.visible = true;
    // a free relic pulses brighter than a guarded one
    v.beamMat.opacity = r.s === 'g' ? 0.3 + 0.12 * Math.sin(time * 3.2) : 0.2;
    return true;
  }

  dispose() {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
  }
}
