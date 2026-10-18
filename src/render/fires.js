// Burning buildings (DESIGN 8 polish): flickering flames, rising embers and
// smoke on damaged buildings, Warcraft III style — one fire below two thirds
// health, two below 40 %, three below 20 %. Everything moves on the GPU from a
// shared clock; the CPU only lists where fires burn this frame. Three draw
// calls total (flames, embers, smoke).
//
// The shaders work in linear light like the VFX (vfx-layers.js): flame cores
// and embers go past 1 so post.js blooms them, the smoke is lit by the sun
// (SUN_DIR) with an orange underglow from the flames, and each building
// offers one warm, flickering light to the VFX light pool (when given one).
import * as THREE from 'three';
import { VFX_OUT_GLSL, VFX_TONEMAP_GLSL, glowBlend } from './vfx-layers.js';
import { SUN_DIR, CLOUD_TEXTURE } from './shading.js';

const SMOKE_PER_FIRE = 4;
const EMBERS_PER_FIRE = 6;
/** Flames hide a little of what is behind them (see OCCLUSION in vfx-layers.js). */
const FLAME_OCCLUSION = 0.35;
/** Warm light of a burning building (linear), its priority against spell flashes. */
const FIRE_LIGHT = { r: 1, g: 0.32, b: 0.06 };
const FIRE_LIGHT_WEIGHT = 0.6;

const OUT = VFX_TONEMAP_GLSL;

const NOISE = /* glsl */ `
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float noise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`;

const FLAME_VS = /* glsl */ `
attribute vec3 aFire; // seed, size, alpha
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
varying float vFlick;
void main() {
  float s = aFire.y;
  float flick = 1.0 + 0.12 * sin( uTime * 13.0 + aFire.x * 17.0 ) + 0.08 * sin( uTime * 23.0 + aFire.x * 5.0 );
  vec4 c = modelViewMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 );
  // anchored at the bottom center, a bit taller than wide; pulled a little toward
  // the camera so the roof it burns on does not swallow its base
  c.xy += vec2( position.x * s * 0.95, ( position.y + 0.5 ) * s * 1.3 * flick );
  c.z += 0.3 * s;
  gl_Position = projectionMatrix * c;
  vUv = uv;
  vSeed = aFire.x;
  vAlpha = aFire.z;
  vFlick = flick;
}`;

const FLAME_FS = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
varying float vFlick;
${VFX_OUT_GLSL}
${NOISE}
// linear light: a white-hot heart, a yellow base going orange, deep red licking tips
const vec3 HOT = vec3( 1.0, 0.72, 0.3 );
const vec3 BASE = vec3( 1.0, 0.42, 0.05 );
const vec3 BODY = vec3( 1.0, 0.22, 0.016 );
const vec3 TIP = vec3( 0.6, 0.04, 0.004 );
void main() {
  vec2 p = vUv;
  float t = uTime * 2.4 + vSeed * 9.0;
  float n = noise( vec2( p.x * 4.0 + vSeed * 3.0, p.y * 3.0 - t ) ) * 0.6 + noise( vec2( p.x * 9.0, p.y * 7.0 - t * 1.7 ) ) * 0.4;
  // teardrop: wide at the base, narrowing and wavering toward the tip
  float h = p.y;
  float hw = 0.42 * ( 1.0 - h ) * ( 0.75 + 0.5 * n ) + 0.02;
  float dx = abs( p.x - 0.5 + ( n - 0.5 ) * 0.18 * h );
  float body = smoothstep( hw, hw * 0.45, dx ) * smoothstep( 1.0, 0.55, h + n * 0.25 ) * smoothstep( 0.0, 0.08, h );
  if ( body < 0.01 ) discard;
  // the heart of the tongue burns past 1 (bloom), breathing with the flicker
  float core = smoothstep( hw * 0.55, hw * 0.05, dx ) * smoothstep( 0.5, 0.1, h + n * 0.2 ) * smoothstep( 0.0, 0.1, h );
  // (additive light at partial coverage reads dimmer in linear than it did in
  // sRGB, hence the gain on the whole tongue)
  float up = h + dx * 0.8 + ( n - 0.5 ) * 0.3;
  vec3 col = mix( mix( BASE, BODY, smoothstep( 0.05, 0.45, up ) ), TIP, smoothstep( 0.4, 0.95, up ) ) * 1.9;
  col = mix( col, HOT * ( 2.0 + 2.2 * vFlick * vFlick ), core );
  gl_FragColor = vec4( col, 1.0 );
  ${OUT}
  gl_FragColor = vfxPremul( gl_FragColor.rgb, body * vAlpha );
}`;

const EMBER_VS = /* glsl */ `
attribute vec3 aFire; // seed, size, alpha
uniform float uTime;
varying vec2 vUv;
varying float vA;
varying float vHeat;
void main() {
  // each instance is one spark on its own 1.4–2.2 s loop, on a new path every loop
  float seed = aFire.x;
  float s = aFire.y;
  float life = 1.4 + 0.8 * fract( seed * 7.13 );
  float cyc = uTime / life + seed;
  float ph = fract( cyc );
  float k = floor( cyc ) + seed * 17.0;
  float r1 = fract( sin( k * 12.9898 ) * 43758.5453 );
  float r2 = fract( sin( k * 78.233 + 1.3 ) * 43758.5453 );
  float sw = ph * ( 0.12 + 0.12 * r2 ) * s;
  vec3 wpos = instanceMatrix[ 3 ].xyz + vec3(
    ( r1 - 0.5 ) * 0.7 * s + 0.75 * ph * ph + sw * sin( uTime * 5.0 + seed * 40.0 ),
    ( 0.15 + ph * ( 2.0 + 1.6 * r1 ) ) * s,
    ( r2 - 0.5 ) * 0.6 * s - 0.4 * ph * ph + sw * cos( uTime * 4.1 + seed * 29.0 ) );
  vec4 c = modelViewMatrix * vec4( wpos, 1.0 );
  c.z += 0.3 * s;
  float size = ( 0.07 + 0.05 * r2 ) * ( 1.0 - 0.45 * ph ) * max( s, 0.8 );
  c.xy += position.xy * size;
  gl_Position = projectionMatrix * c;
  vUv = uv * 2.0 - 1.0;
  // pop in, cool down, wink out; a twinkle on the way up
  vA = aFire.z * smoothstep( 0.0, 0.06, ph ) * ( 1.0 - ph ) * ( 0.65 + 0.35 * sin( uTime * 23.0 + seed * 61.0 ) );
  vHeat = 1.0 - ph;
}`;

const EMBER_FS = /* glsl */ `
varying vec2 vUv;
varying float vA;
varying float vHeat;
${VFX_OUT_GLSL}
void main() {
  float a = ( 1.0 - smoothstep( 0.0, 1.0, dot( vUv, vUv ) ) ) * vA;
  if ( a < 0.01 ) discard;
  // yellow-hot sparks cooling to red, bright enough to bloom while hot
  vec3 col = mix( vec3( 0.9, 0.07, 0.006 ), vec3( 1.0, 0.5, 0.1 ), vHeat ) * ( 1.2 + 3.5 * vHeat * vHeat );
  gl_FragColor = vec4( col, 1.0 );
  ${OUT}
  gl_FragColor = vfxPremul( gl_FragColor.rgb, a );
}`;

const SMOKE_VS = /* glsl */ `
attribute vec3 aFire; // seed, size, alpha
uniform float uTime;
uniform vec3 uSunDir;
varying vec2 vUv;
varying float vA;
varying float vSeed;
varying float vPh;
varying vec3 vSun;
varying vec3 vDown;
void main() {
  // each instance is one puff on a 3 s loop: rises, drifts with the wind, grows, fades
  float ph = fract( uTime / 3.0 + aFire.x );
  vec3 base = instanceMatrix[ 3 ].xyz;
  float s = aFire.y;
  vec3 wpos = base + vec3( 0.65 * ph * ph + 0.12 * sin( aFire.x * 31.0 + uTime ), ph * 2.9 * s + 0.25 * s, -0.35 * ph * ph );
  vec4 c = modelViewMatrix * vec4( wpos, 1.0 );
  float size = s * ( 0.55 + 1.6 * ph );
  c.xy += position.xy * size;
  gl_Position = projectionMatrix * c;
  vUv = uv * 2.0 - 1.0;
  vA = aFire.z * smoothstep( 0.0, 0.15, ph ) * ( 1.0 - ph );
  vSeed = aFire.x;
  vPh = ph;
  // the sun and "down" in view space: the billboard is shaded as a ball
  vSun = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
  vDown = normalize( ( viewMatrix * vec4( 0.0, -1.0, 0.0, 0.0 ) ).xyz );
}`;

const SMOKE_FS = /* glsl */ `
uniform sampler2D uNoise;
varying vec2 vUv;
varying float vA;
varying float vSeed;
varying float vPh;
varying vec3 vSun;
varying vec3 vDown;
${VFX_OUT_GLSL}
// linear light: sunlit and shaded sides, sooty fresh smoke, the fire's glow from below
const vec3 LIT = vec3( 0.21, 0.2, 0.185 );
const vec3 SHADE = vec3( 0.03, 0.031, 0.036 );
const vec3 SOOT = vec3( 0.012, 0.011, 0.01 );
const vec3 GLOW = vec3( 1.0, 0.28, 0.04 );
void main() {
  float r2 = dot( vUv, vUv );
  if ( r2 >= 1.0 ) discard;
  // wispy edges: noise eats into the disc and rolls through it as the puff rises
  vec2 q = vUv * 0.4 + vec2( vSeed * 3.7, vSeed * 1.9 - vPh * 0.3 );
  float nz = texture2D( uNoise, q ).r * 0.65 + texture2D( uNoise, q * 2.3 + 0.37 ).r * 0.35;
  float a = ( 1.0 - smoothstep( 0.2, 1.0, sqrt( r2 ) + ( nz - 0.5 ) * 0.55 ) ) * vA;
  if ( a < 0.01 ) discard;
  vec3 nrm = normalize( vec3( vUv * 0.85 + ( nz - 0.5 ) * 0.7, sqrt( 1.0 - r2 * 0.72 ) ) );
  float sun = clamp( dot( nrm, vSun ) * 0.6 + 0.4, 0.0, 1.0 );
  vec3 col = mix( SHADE, LIT, sun * sun );
  col = mix( SOOT, col, smoothstep( 0.0, 0.5, vPh ) );
  float under = clamp( dot( nrm, vDown ) * 0.5 + 0.5, 0.0, 1.0 );
  col += GLOW * ( ( 0.3 + 0.7 * under * under ) * ( 1.0 - smoothstep( 0.0, 0.4, vPh ) ) * 0.8 );
  gl_FragColor = vec4( col, 1.0 );
  ${OUT}
  gl_FragColor = vfxPremul( gl_FragColor.rgb, a );
}`;

const _m = new THREE.Matrix4();

function layer(parent, max, vs, fs, occ, name, order, extra = {}) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFire', attr);
  const material = glowBlend(new THREE.ShaderMaterial({
    vertexShader: vs,
    fragmentShader: fs,
    uniforms: { uTime: { value: 0 }, uOcc: { value: occ }, ...extra },
    transparent: true,
    depthWrite: false,
  }));
  material.name = name;
  const mesh = new THREE.InstancedMesh(geo, material, max);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  parent.add(mesh);
  return { mesh, attr, material, n: 0, max };
}

function put(l, x, y, z, seed, size, alpha) {
  if (l.n >= l.max) return;
  const i = l.n++;
  _m.makeTranslation(x, y, z);
  l.mesh.setMatrixAt(i, _m);
  const a = l.attr.array;
  a[i * 3] = seed;
  a[i * 3 + 1] = size;
  a[i * 3 + 2] = alpha;
}

function flush(l) {
  l.mesh.count = l.n;
  if (l.n > 0) {
    l.mesh.instanceMatrix.clearUpdateRanges();
    l.mesh.instanceMatrix.addUpdateRange(0, l.n * 16);
    l.mesh.instanceMatrix.needsUpdate = true;
    l.attr.clearUpdateRanges();
    l.attr.addUpdateRange(0, l.n * 3);
    l.attr.needsUpdate = true;
  }
}

/** Deterministic 0..1 hash of an integer pair. */
function rnd(a, b) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Number of fires for a health fraction (0 when healthy). */
export function fireCount(frac) {
  if (!(frac < 0.66)) return 0;
  if (frac < 0.2) return 3;
  if (frac < 0.4) return 2;
  return 1;
}

export class FireLayer {
  /**
   * @param {THREE.Object3D} parent
   * @param {number} [maxFires]
   * @param {import('./vfx-layers.js').LightPool|null} [lights] pool the burning buildings offer their light to
   */
  constructor(parent, maxFires = 160, lights = null) {
    this.flames = layer(parent, maxFires * 2, FLAME_VS, FLAME_FS, FLAME_OCCLUSION, 'building-flames', 9);
    this.embers = layer(parent, maxFires * EMBERS_PER_FIRE, EMBER_VS, EMBER_FS, 0, 'building-embers', 9);
    // smoke first: the flames and sparks at its foot burn in front of it
    this.smoke = layer(parent, maxFires * SMOKE_PER_FIRE, SMOKE_VS, SMOKE_FS, 1, 'building-smoke', 8, {
      uNoise: { value: CLOUD_TEXTURE },
      uSunDir: { value: SUN_DIR },
    });
    this.lights = lights;
    this.time = 0;
    this.fires = 0;
  }

  begin(time) {
    this.flames.n = 0;
    this.embers.n = 0;
    this.smoke.n = 0;
    this.fires = 0;
    this.time = time;
    this.flames.material.uniforms.uTime.value = time;
    this.embers.material.uniforms.uTime.value = time;
    this.smoke.material.uniforms.uTime.value = time;
  }

  /**
   * Fires on one building.
   * @param {number} id entity id (fire spots are stable per building)
   * @param {number} x footprint center (sim x)
   * @param {number} baseY ground height of the model root
   * @param {number} y footprint center (sim y)
   * @param {number} size footprint size in tiles
   * @param {number} height model height
   * @param {number} frac health fraction
   */
  addBuilding(id, x, baseY, y, size, height, frac) {
    const n = fireCount(frac);
    if (!n) return;
    const big = Math.min(1.6, 0.55 + size * 0.17);
    let lx = 0;
    let ly = 0;
    let lz = 0;
    for (let k = 0; k < n; k++) {
      const a = rnd(id, k * 3 + 1);
      const b = rnd(id, k * 3 + 2);
      const c = rnd(id, k * 3 + 3);
      const fx = x + (a - 0.5) * size * 0.55;
      const fz = y + (b - 0.5) * size * 0.5;
      const fy = baseY + height * (0.45 + 0.25 * c);
      const s = big * (0.75 + 0.35 * c) * (frac < 0.2 ? 1.2 : 1);
      put(this.flames, fx, fy, fz, a * 7.31 + k, s, 0.9);
      put(this.flames, fx + (c - 0.5) * s * 0.7, fy - s * 0.05, fz + 0.12, a * 3.7 + k + 0.5, s * 0.6, 0.8);
      for (let j = 0; j < EMBERS_PER_FIRE; j++) put(this.embers, fx, fy, fz, (j + a) / EMBERS_PER_FIRE, s, 0.9);
      for (let j = 0; j < SMOKE_PER_FIRE; j++) put(this.smoke, fx, fy + s * 0.6, fz, (j + a) / SMOKE_PER_FIRE, s * 0.8, frac < 0.2 ? 0.95 : 0.75);
      lx += fx;
      ly = Math.max(ly, fy + s * 1.5);
      lz += fz;
      this.fires++;
    }
    if (this.lights) {
      // one flickering light per building, well above its fires so it washes
      // over the roof and the ground around instead of making a hot spot
      const t = this.time;
      const fl = 1 + 0.16 * Math.sin(t * 13.1 + id * 1.7) + 0.1 * Math.sin(t * 23.3 + id * 0.9) + 0.06 * Math.sin(t * 37.9 + id * 2.3);
      const L = FIRE_LIGHT;
      this.lights.offer(id, lx / n, ly, lz / n, L.r, L.g, L.b, (3.5 + 2.5 * n) * big * fl, 4.5 + size * 0.9 + n * 0.6, FIRE_LIGHT_WEIGHT);
    }
  }

  end() {
    flush(this.flames);
    flush(this.embers);
    flush(this.smoke);
  }

  dispose() {
    for (const l of [this.flames, this.embers, this.smoke]) {
      l.mesh.removeFromParent();
      l.mesh.geometry.dispose();
      l.material.dispose();
      l.mesh.dispose();
    }
    this.lights = null;
  }
}
