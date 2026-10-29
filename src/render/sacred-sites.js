// Sacred sites on the map (DESIGN 5.11, 8): a paved circle ringed by weathered standing
// stones around a stepped altar, with a crystal floating over it. A neutral site glows a pale
// white-gold; a held one takes its holder's colour in the crystal, the runes on the stones,
// a ring set in the paving and a faint beam of light. While a site is being captured (or a
// rival's hold torn down) an arc on the ground fills in the capturer's colour; when rivals
// stand on it together the arc flickers. The stone is one geometry shared by every site; each
// site owns only its few small glowing materials. Sites never move, so the layer is built once
// from the map and only recoloured from the view state's rows ({ x, y, o, p?, c?, cn? }).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITE_RADIUS } from '../config.js';
import { patchWorldMaterial } from './shading.js';
import { patchFowObject } from './fog.js';

/** The glow of a site nobody holds. */
export const NEUTRAL_GLOW = '#fff0c4';

const STONES = 7;
const STONE_R = 2.35; // the stone ring's radius (tiles)
const PAVE_R = 2.75;
const CRYSTAL_Y = 1.75;

const ARC_VS = `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const ARC_FS = `
uniform vec3 uColor;
uniform float uProg;
uniform float uPulse;
uniform float uTime;
varying vec2 vPos;
void main() {
  // angle from the top of the circle, clockwise as seen from above, 0..1
  float a = fract( atan( vPos.x, vPos.y ) / 6.2831853 + 1.0 );
  float r = length( vPos );
  float edge = 1.0 - abs( ( r - ${(SITE_RADIUS - 0.1).toFixed(2)} ) / 0.16 );
  edge = clamp( edge, 0.0, 1.0 );
  float filled = step( a, uProg );
  float flick = mix( 1.0, 0.45 + 0.55 * step( 0.5, fract( uTime * 3.5 ) ), uPulse );
  float alpha = edge * mix( 0.22, 0.9, filled ) * flick;
  vec3 col = mix( vec3( 0.95, 0.92, 0.85 ), uColor * 1.6, filled );
  gl_FragColor = vec4( col, alpha );
  #include <colorspace_fragment>
}`;

let SHARED = null;

/** Deterministic jitter so every site's stones look the same weathered way. */
function jit(i, k) {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const MOSS = new THREE.Color('#4f5a33');

/**
 * Vertex colours: the stone's colour, varied per vertex, and with `moss` > 0 greened and darkened
 * toward the ground (up to `mossH` above it), as old stone that has stood in the grass for ages.
 */
function paint(geo, hex, vary = 0.08, seed = 0, moss = 0, mossH = 0.6) {
  const base = new THREE.Color(hex);
  const pos = geo.attributes.position;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const v = 1 + (jit(i + seed * 13, 3) - 0.5) * 2 * vary;
    c.copy(base).multiplyScalar(v);
    if (moss > 0) c.lerp(MOSS, moss * Math.max(0, 1 - pos.getY(i) / mossH));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Strip a primitive down to position, normal and colour so the parts merge. */
function flat(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

function buildShared() {
  const stone = [];
  const runes = [];
  // the paved circle: a low drum sunk into the ground (hides the slope), slabs of two greys
  stone.push(paint(flat(new THREE.CylinderGeometry(PAVE_R, PAVE_R + 0.1, 0.5, 18).translate(0, -0.13, 0)), '#8a8170', 0.1, 1, 0.35, 0.2));
  stone.push(paint(flat(new THREE.CylinderGeometry(1.25, 1.3, 0.1, 12).translate(0, 0.16, 0)), '#6f6758', 0.08, 2));
  for (let i = 0; i < 8; i++) {
    // radial joints between the outer slabs
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const g = new THREE.BoxGeometry(0.06, 0.03, PAVE_R - 1.3).translate(0, 0.125, (PAVE_R + 1.3) / 2);
    g.rotateY(a);
    stone.push(paint(flat(g), '#4e483e', 0.05, 3 + i));
  }
  // the standing stones: tapered four-sided menhirs, a little tilted, of varied height
  for (let i = 0; i < STONES; i++) {
    const a = (i / STONES) * Math.PI * 2 + 0.25;
    const h = 1.15 + 0.55 * jit(i, 1);
    const w = 0.34 + 0.1 * jit(i, 2);
    const g = new THREE.CylinderGeometry(w * 0.62, w, h, 4, 1);
    g.rotateY(Math.PI / 4);
    g.scale(1, 1, 0.68);
    g.translate(0, h / 2 + 0.05, 0);
    g.rotateZ((jit(i, 4) - 0.5) * 0.16);
    g.rotateX((jit(i, 5) - 0.5) * 0.12 - 0.05);
    g.rotateY(-a + Math.PI / 2);
    g.translate(Math.cos(a) * STONE_R, 0, Math.sin(a) * STONE_R);
    stone.push(paint(flat(g), jit(i, 6) > 0.5 ? '#7d786b' : '#6c675d', 0.12, 20 + i, 0.55, 0.7));
    // a glowing rune on the stone's inner face
    const r = new THREE.PlaneGeometry(0.16, 0.42);
    r.translate(0, h * 0.55, 0);
    r.rotateY(-a - Math.PI / 2);
    const inner = STONE_R - w * 0.36;
    r.translate(Math.cos(a) * inner, 0, Math.sin(a) * inner);
    runes.push(flat(r));
  }
  // the altar: a stepped hexagonal plinth with a dished top
  stone.push(paint(flat(new THREE.CylinderGeometry(0.82, 0.9, 0.3, 6).translate(0, 0.3, 0)), '#857c6b', 0.06, 40, 0.3, 0.5));
  stone.push(paint(flat(new THREE.CylinderGeometry(0.55, 0.62, 0.5, 6).translate(0, 0.7, 0)), '#918774', 0.06, 41));
  stone.push(paint(flat(new THREE.CylinderGeometry(0.66, 0.5, 0.14, 6).translate(0, 1.02, 0)), '#9d9480', 0.05, 42));
  const ring = new THREE.RingGeometry(PAVE_R - 0.28, PAVE_R - 0.1, 36, 1).rotateX(-Math.PI / 2).translate(0, 0.135, 0);
  const crystal = new THREE.OctahedronGeometry(0.3, 0).scale(1, 1.9, 1);
  const bowl = new THREE.CylinderGeometry(0.34, 0.2, 0.06, 6).translate(0, 1.11, 0); // the glowing dish under the crystal
  const beam = new THREE.CylinderGeometry(0.12, 0.42, 5, 8, 1, true).translate(0, CRYSTAL_Y + 2.5, 0);
  const arc = new THREE.RingGeometry(SITE_RADIUS - 0.3, SITE_RADIUS + 0.1, 64, 1);
  const geo = {
    stone: mergeGeometries(stone, false),
    runes: mergeGeometries(runes, false),
    glowParts: mergeGeometries([flat(ring), flat(bowl)], false),
    crystal,
    beam,
    arc,
  };
  for (const g of [...stone, ...runes]) g.dispose();
  const stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
  patchWorldMaterial(stoneMat, { cloud: true, rim: 0.2 });
  stoneMat.name = 'sacred-stone';
  let tris = 0;
  for (const g of [geo.stone, geo.runes, geo.glowParts, geo.crystal]) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  SHARED = { geo, stoneMat, tris };
  return SHARED;
}

function glowColor(hex) {
  const c = new THREE.Color(hex);
  // lift dark team colours so the glow still reads
  const hsl = {};
  c.getHSL(hsl);
  return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), Math.max(0.55, hsl.l));
}

/** One site: its meshes and its own glow materials. */
class SiteView {
  constructor(parent, x, y, ground) {
    const S = SHARED || buildShared();
    const root = (this.root = new THREE.Group());
    root.name = 'sacred-site';
    root.position.set(x, ground, y);
    this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(NEUTRAL_GLOW).multiplyScalar(0.6) });
    this.crystalMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: NEUTRAL_GLOW, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.1, flatShading: true });
    this.beamMat = new THREE.MeshBasicMaterial({ color: NEUTRAL_GLOW, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.beamMat.forceSinglePass = true; // additive, no depth writes: one pass draws what two would
    this.arcUniforms = { uColor: { value: new THREE.Color(NEUTRAL_GLOW) }, uProg: { value: 0 }, uPulse: { value: 0 }, uTime: { value: 0 } };
    this.arcMat = new THREE.ShaderMaterial({
      uniforms: this.arcUniforms, vertexShader: ARC_VS, fragmentShader: ARC_FS,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const stone = new THREE.Mesh(S.geo.stone, S.stoneMat);
    stone.castShadow = true;
    stone.receiveShadow = true;
    stone.name = 'site-stone';
    const runes = new THREE.Mesh(S.geo.runes, this.glowMat);
    runes.name = 'site-runes';
    const glow = new THREE.Mesh(S.geo.glowParts, this.glowMat);
    glow.name = 'site-glow';
    this.crystal = new THREE.Mesh(S.geo.crystal, this.crystalMat);
    this.crystal.name = 'site-crystal';
    this.crystal.position.y = CRYSTAL_Y;
    this.beam = new THREE.Mesh(S.geo.beam, this.beamMat);
    this.beam.name = 'site-beam';
    this.beam.visible = false;
    this.arc = new THREE.Mesh(S.geo.arc, this.arcMat);
    this.arc.name = 'site-arc';
    this.arc.rotation.x = -Math.PI / 2;
    this.arc.position.y = 0.16;
    this.arc.visible = false;
    root.add(stone, runes, glow, this.crystal, this.beam, this.arc);
    patchFowObject(root);
    parent.add(root);
    this.phase = (x * 0.37 + y * 0.61) % (Math.PI * 2);
    this.owner = -2;
    this.colorKey = '';
  }

  /** Recolour for a holder (colour string, or null when neutral). */
  setHolder(color) {
    const key = color || 'neutral';
    if (key === this.colorKey) return;
    this.colorKey = key;
    const c = color ? glowColor(color) : new THREE.Color(NEUTRAL_GLOW);
    // a neutral site's runes and ring smoulder; a held one's burn in the holder's colour
    this.glowMat.color.copy(c).multiplyScalar(color ? 1 : 0.6);
    this.crystalMat.emissive.copy(c);
    this.beamMat.color.copy(c);
    this.beam.visible = !!color;
  }

  setCapture(prog, color, contested) {
    const on = prog > 0;
    this.arc.visible = on;
    if (!on) return;
    this.arcUniforms.uProg.value = Math.min(1, prog);
    this.arcUniforms.uColor.value.set(color ? glowColor(color) : NEUTRAL_GLOW);
    this.arcUniforms.uPulse.value = contested ? 1 : 0;
  }

  animate(t) {
    const p = t + this.phase;
    this.crystal.position.y = CRYSTAL_Y + Math.sin(p * 1.3) * 0.08;
    this.crystal.rotation.y = p * 0.6;
    this.crystalMat.emissiveIntensity = 1.4 + 0.35 * Math.sin(p * 2.1);
    this.beamMat.opacity = 0.09 + 0.04 * Math.sin(p * 1.7);
    this.arcUniforms.uTime.value = t;
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.glowMat.dispose();
    this.crystalMat.dispose();
    this.beamMat.dispose();
    this.arcMat.dispose();
  }
}

/** Every sacred site of the map, drawn from the view state each frame. */
export class SacredSiteLayer {
  /**
   * @param {THREE.Object3D} parent
   * @param {{x:number,y:number}[]} points site centres (tile coords)
   * @param {(x:number, y:number) => number} heightFn ground height
   */
  constructor(parent, points, heightFn) {
    this.views = (points || []).map((p) => {
      // sit on the highest of a few points under the paving, so no edge floats
      let g = -Infinity;
      for (const [dx, dy] of [[0, 0], [1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) g = Math.max(g, heightFn(p.x + dx, p.y + dy));
      return new SiteView(parent, p.x, p.y, Number.isFinite(g) ? g : 0);
    });
    this.time = 0;
  }

  /**
   * @param {number} dt seconds
   * @param {object[]} rows view-state sites { o, p?, c?, cn? } in map order
   * @param {(owner:number) => string|null} colorOf player colour (null / undefined for neutral)
   */
  update(dt, rows, colorOf) {
    this.time += dt || 0;
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      const r = (rows && rows[i]) || null;
      const o = r && Number.isInteger(r.o) && r.o >= 0 ? r.o : -1;
      v.setHolder(o >= 0 ? colorOf(o) : null);
      const c = r && Number.isInteger(r.c) && r.c >= 0 ? r.c : -1;
      v.setCapture(r && r.p > 0 ? r.p : 0, c >= 0 ? colorOf(c) : null, !!(r && r.cn));
      v.animate(this.time);
    }
  }

  dispose() {
    for (const v of this.views) v.dispose();
    this.views = [];
  }
}

/** Triangles of one site (tests, budgets). */
export function sacredSiteTriangles() {
  return (SHARED || buildShared()).tris;
}
