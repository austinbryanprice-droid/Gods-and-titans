// Burning buildings (DESIGN 8 polish): flickering flames and rising smoke on
// damaged buildings, Warcraft III style — one fire below two thirds health,
// two below 40 %, three below 20 %. Everything moves on the GPU from a shared
// clock; the CPU only lists where fires burn this frame. Two draw calls total
// (additive flames, alpha-blended smoke).
import * as THREE from 'three';

const SMOKE_PER_FIRE = 4;

const FLAME_VS = `
attribute vec3 aFire; // seed, size, alpha
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
void main() {
  float s = aFire.y;
  float flick = 1.0 + 0.12 * sin( uTime * 13.0 + aFire.x * 17.0 ) + 0.08 * sin( uTime * 23.0 + aFire.x * 5.0 );
  vec4 c = modelViewMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 );
  // anchored at the bottom center, a bit taller than wide
  c.xy += vec2( position.x * s * 0.95, ( position.y + 0.5 ) * s * 1.3 * flick );
  gl_Position = projectionMatrix * c;
  vUv = uv;
  vSeed = aFire.x;
  vAlpha = aFire.z;
}`;

const FLAME_FS = `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float noise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
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
  vec3 col = mix( vec3( 1.0, 0.95, 0.6 ), vec3( 1.0, 0.45, 0.06 ), smoothstep( 0.05, 0.5, h + dx ) );
  col = mix( col, vec3( 0.75, 0.12, 0.02 ), smoothstep( 0.45, 0.9, h + dx * 0.6 ) );
  gl_FragColor = vec4( col * body * vAlpha * 1.4, 1.0 );
  #include <colorspace_fragment>
}`;

const SMOKE_VS = `
attribute vec3 aFire; // seed, size, alpha
uniform float uTime;
varying vec2 vUv;
varying float vA;
varying float vSeed;
void main() {
  // each instance is one puff on a 2.6 s loop: rises, drifts with the wind, grows, fades
  float ph = fract( uTime / 2.6 + aFire.x );
  vec3 base = instanceMatrix[ 3 ].xyz;
  float s = aFire.y;
  vec3 wpos = base + vec3( 0.55 * ph * ph + 0.12 * sin( aFire.x * 31.0 + uTime ), ph * 2.6 * s + 0.25 * s, -0.3 * ph * ph );
  vec4 c = modelViewMatrix * vec4( wpos, 1.0 );
  float size = s * ( 0.5 + 1.3 * ph );
  c.xy += position.xy * size;
  gl_Position = projectionMatrix * c;
  vUv = uv * 2.0 - 1.0;
  vA = aFire.z * smoothstep( 0.0, 0.15, ph ) * ( 1.0 - ph );
  vSeed = aFire.x;
}`;

const SMOKE_FS = `
varying vec2 vUv;
varying float vA;
varying float vSeed;
void main() {
  float r = length( vUv + 0.12 * vec2( sin( vSeed * 40.0 ), cos( vSeed * 23.0 ) ) * ( 1.0 - length( vUv ) ) );
  float a = ( 1.0 - smoothstep( 0.3, 1.0, r ) ) * vA * 0.8;
  if ( a < 0.01 ) discard;
  gl_FragColor = vec4( vec3( 0.2, 0.19, 0.18 ), a );
  #include <colorspace_fragment>
}`;

const _m = new THREE.Matrix4();

function layer(parent, max, vs, fs, blending, name, order) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFire', attr);
  const material = new THREE.ShaderMaterial({
    vertexShader: vs,
    fragmentShader: fs,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending,
  });
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
  constructor(parent, maxFires = 160) {
    this.flames = layer(parent, maxFires * 2, FLAME_VS, FLAME_FS, THREE.AdditiveBlending, 'building-flames', 9);
    this.smoke = layer(parent, maxFires * SMOKE_PER_FIRE, SMOKE_VS, SMOKE_FS, THREE.NormalBlending, 'building-smoke', 10);
    this.fires = 0;
  }

  begin(time) {
    this.flames.n = 0;
    this.smoke.n = 0;
    this.fires = 0;
    this.flames.material.uniforms.uTime.value = time;
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
      for (let j = 0; j < SMOKE_PER_FIRE; j++) put(this.smoke, fx, fy + s * 0.6, fz, (j + a) / SMOKE_PER_FIRE, s * 0.8, frac < 0.2 ? 0.95 : 0.75);
      this.fires++;
    }
  }

  end() {
    flush(this.flames);
    flush(this.smoke);
  }

  dispose() {
    for (const l of [this.flames, this.smoke]) {
      l.mesh.removeFromParent();
      l.mesh.geometry.dispose();
      l.material.dispose();
      l.mesh.dispose();
    }
  }
}
