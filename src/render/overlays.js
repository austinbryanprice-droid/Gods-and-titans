// Screen-reading overlays for the game renderer (DESIGN 8): selection / hover
// rings, health + progress bars, command markers, floating text and rally
// flags. Rings, bars and markers are single InstancedMeshes refilled every
// frame (a few draw calls for hundreds of units, no per-frame allocations).
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

// ---------------------------------------------------------------------------
// selection rings
// ---------------------------------------------------------------------------

const RING_VS = `
attribute vec3 aRing; // alpha, thickness (world), pulse
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vRing;
varying float vRadius;
void main() {
  vUv = uv * 2.0 - 1.0;
  vCol = instanceColor;
  vRing = aRing;
  vRadius = length( instanceMatrix[ 0 ].xyz );
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
}`;

const RING_FS = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vRing;
varying float vRadius;
void main() {
  float r = length( vUv );
  float t = clamp( vRing.y / vRadius, 0.02, 0.5 );
  float aa = fwidth( r ) * 1.3;
  float outer = 1.0 - smoothstep( 1.0 - aa, 1.0, r );
  float inner = smoothstep( 1.0 - t - aa, 1.0 - t, r );
  float ring = outer * inner;
  float glow = smoothstep( 1.0 - t * 4.5, 1.0 - t, r ) * outer * 0.22;
  float pulse = 1.0 - vRing.z * ( 0.35 + 0.35 * sin( uTime * 6.0 ) );
  float a = max( ring, glow ) * vRing.x * pulse;
  if ( a < 0.004 ) discard;
  vec3 c = mix( vCol * 0.8, vCol * 1.15 + 0.08, ring );
  gl_FragColor = vec4( c, a );
  #include <colorspace_fragment>
}`;

/** Instanced ground rings (selection, hover). */
export class RingLayer {
  constructor(parent, max = 768) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.aRing = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aRing.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aRing', this.aRing);
    this.uniforms = { uTime: { value: 0 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: RING_VS,
      fragmentShader: RING_FS,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.material.name = 'overlay-rings';
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.name = 'selection-rings';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    parent.add(this.mesh);
    this.n = 0;
  }

  begin(time) {
    this.n = 0;
    this.uniforms.uTime.value = time;
  }

  /**
   * @param {number} x world X
   * @param {number} y world Y (ground height + lift)
   * @param {number} z world Z (sim y)
   * @param {THREE.Vector3|null} normal ground normal (null = up)
   * @param {number} radius
   * @param {THREE.Color} color
   * @param {number} alpha
   * @param {number} thickness world units
   * @param {number} pulse 0..1
   */
  add(x, y, z, normal, radius, color, alpha, thickness, pulse = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    if (normal) _q.setFromUnitVectors(UP, normal);
    else _q.identity();
    _p.set(x, y, z);
    _s.set(radius, radius, radius);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.setColorAt(i, color);
    const a = this.aRing.array;
    a[i * 3] = alpha;
    a[i * 3 + 1] = thickness;
    a[i * 3 + 2] = pulse;
  }

  end() {
    this.mesh.count = this.n;
    if (this.n > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, this.n * 3);
      this.mesh.instanceColor.needsUpdate = true;
      this.aRing.clearUpdateRanges();
      this.aRing.addUpdateRange(0, this.n * 3);
      this.aRing.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// blob shadows (contact shadows under ground units)
// ---------------------------------------------------------------------------

const BLOB_VS = `
attribute float aAlpha;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = uv * 2.0 - 1.0;
  vA = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
}`;

const BLOB_FS = `
varying vec2 vUv;
varying float vA;
void main() {
  float r = length( vUv );
  float a = ( 1.0 - smoothstep( 0.25, 1.0, r ) ) * vA;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( 0.02, 0.025, 0.015, a );
}`;

/** Instanced soft dark ellipses under units (one draw call). */
export class BlobLayer {
  constructor(parent, max = 1024) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAlpha', this.aAlpha);
    this.material = new THREE.ShaderMaterial({
      vertexShader: BLOB_VS,
      fragmentShader: BLOB_FS,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.material.name = 'overlay-blobs';
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.name = 'blob-shadows';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  add(x, y, z, normal, rx, rz, rot, alpha) {
    if (this.n >= this.max) return;
    const i = this.n++;
    if (normal) _q.setFromUnitVectors(UP, normal);
    else _q.identity();
    _q2.setFromAxisAngle(UP, rot);
    _q.multiply(_q2);
    _p.set(x, y, z);
    _s.set(rx, 1, rz);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.aAlpha.array[i] = alpha;
  }

  end() {
    this.mesh.count = this.n;
    if (this.n > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.aAlpha.clearUpdateRanges();
      this.aAlpha.addUpdateRange(0, this.n);
      this.aAlpha.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// stun stars
// ---------------------------------------------------------------------------

const STAR_VS = `
attribute float aSpin;
varying vec2 vUv;
varying float vSpin;
void main() {
  vec4 c = modelViewMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 );
  c.xy += position.xy * instanceMatrix[ 0 ][ 0 ];
  gl_Position = projectionMatrix * c;
  vUv = uv * 2.0 - 1.0;
  vSpin = aSpin;
}`;

const STAR_FS = `
varying vec2 vUv;
varying float vSpin;
void main() {
  float r = length( vUv );
  float a = atan( vUv.y, vUv.x ) + vSpin;
  float k = pow( 0.5 + 0.5 * cos( 5.0 * a ), 1.6 );
  float edge = mix( 0.36, 0.95, k );
  float aa = fwidth( r ) * 1.2;
  float alpha = 1.0 - smoothstep( edge - aa, edge + aa, r );
  if ( alpha < 0.01 ) discard;
  vec3 col = mix( vec3( 1.0, 0.98, 0.75 ), vec3( 1.0, 0.78, 0.12 ), smoothstep( 0.1, 0.7, r ) );
  col = mix( col, vec3( 0.55, 0.3, 0.0 ), smoothstep( edge - 0.16, edge - 0.02, r ) * 0.7 ); // amber rim
  gl_FragColor = vec4( col, alpha );
  #include <colorspace_fragment>
}`;

/** Little yellow stars circling over stunned units (instanced billboards, one draw call). */
export class StarLayer {
  constructor(parent, max = 384) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aSpin = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.aSpin.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSpin', this.aSpin);
    this.material = new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false });
    this.material.name = 'overlay-stars';
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.name = 'stun-stars';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    parent.add(this.mesh);
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  /** A ring of `count` stars of `size` world units circling (x, y, z) with radius r. */
  addRing(x, y, z, r, size, count, time) {
    for (let k = 0; k < count && this.n < this.max; k++) {
      const a = time * 3.2 + (k * Math.PI * 2) / count;
      const i = this.n++;
      const e = _m.elements;
      e[0] = size; e[1] = 0; e[2] = 0; e[3] = 0;
      e[4] = 0; e[5] = size; e[6] = 0; e[7] = 0;
      e[8] = 0; e[9] = 0; e[10] = 1; e[11] = 0;
      e[12] = x + Math.cos(a) * r; e[13] = y + Math.sin(a * 2 + k) * 0.05; e[14] = z + Math.sin(a) * r * 0.8; e[15] = 1;
      this.mesh.setMatrixAt(i, _m);
      this.aSpin.array[i] = time * 2.5 + k;
    }
  }

  end() {
    this.mesh.count = this.n;
    if (this.n > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.aSpin.clearUpdateRanges();
      this.aSpin.addUpdateRange(0, this.n);
      this.aSpin.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// bars
// ---------------------------------------------------------------------------

const BAR_VS = `
attribute vec4 aBar; // fill fraction, shield fraction, style (0 health, 1 progress), alpha
varying vec2 vUv;
varying vec4 vBar;
varying vec3 vCol;
varying vec2 vSize;
void main() {
  vec4 c = modelViewMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 );
  vec2 size = vec2( instanceMatrix[ 0 ][ 0 ], instanceMatrix[ 1 ][ 1 ] );
  c.xy += position.xy * size;
  gl_Position = projectionMatrix * c;
  vUv = uv;
  vBar = aBar;
  vCol = instanceColor;
  vSize = size;
}`;

const BAR_FS = `
varying vec2 vUv;
varying vec4 vBar;
varying vec3 vCol;
varying vec2 vSize;
void main() {
  vec2 p = vUv * vSize;
  float b = min( 0.03, vSize.y * 0.24 );
  vec3 col;
  if ( p.x < b || p.y < b || p.x > vSize.x - b || p.y > vSize.y - b ) {
    col = vec3( 0.015, 0.012, 0.01 );
  } else {
    float x = ( p.x - b ) / max( 1e-4, vSize.x - 2.0 * b );
    float y = ( p.y - b ) / max( 1e-4, vSize.y - 2.0 * b );
    float shade = 0.72 + 0.42 * smoothstep( 0.0, 1.0, y ) - 0.18 * smoothstep( 0.55, 1.0, y );
    if ( x <= vBar.x ) {
      col = vCol * shade;
      // progress bars: a brighter leading edge
      if ( vBar.z > 0.5 ) col += vCol * 0.5 * smoothstep( vBar.x - 0.06, vBar.x, x );
    } else if ( x <= vBar.x + vBar.y ) {
      col = vec3( 0.72, 0.86, 1.0 ) * shade;
    } else {
      col = vec3( 0.07, 0.06, 0.05 ) * ( 0.8 + 0.4 * y );
    }
  }
  gl_FragColor = vec4( col, vBar.w );
  #include <colorspace_fragment>
}`;

/** Instanced camera-facing bars (health, shield, construction, training). */
export class BarLayer {
  constructor(parent, max = 1024) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aBar = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aBar.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBar', this.aBar);
    this.material = new THREE.ShaderMaterial({
      vertexShader: BAR_VS,
      fragmentShader: BAR_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.material.name = 'overlay-bars';
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.name = 'bars';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    parent.add(this.mesh);
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  /**
   * One bar centered at world (x, y, z), w × h world units.
   * @param {number} frac fill 0..1
   * @param {number} shield extra fraction drawn after the fill (light blue)
   * @param {THREE.Color} color fill color
   * @param {number} style 0 health, 1 progress
   * @param {number} alpha
   */
  add(x, y, z, w, h, frac, shield, color, style = 0, alpha = 1) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const e = _m.elements;
    e[0] = w; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = h; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[10] = 1; e[11] = 0;
    e[12] = x; e[13] = y; e[14] = z; e[15] = 1;
    this.mesh.setMatrixAt(i, _m);
    this.mesh.setColorAt(i, color);
    const a = this.aBar.array;
    a[i * 4] = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    a[i * 4 + 1] = shield > 0 ? Math.min(shield, 1 - a[i * 4]) : 0;
    a[i * 4 + 2] = style;
    a[i * 4 + 3] = alpha;
  }

  end() {
    this.mesh.count = this.n;
    if (this.n > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, this.n * 3);
      this.mesh.instanceColor.needsUpdate = true;
      this.aBar.clearUpdateRanges();
      this.aBar.addUpdateRange(0, this.n * 4);
      this.aBar.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

/** WC3-style health color: green → yellow → red. Writes into out. */
export function healthColor(frac, out) {
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  if (f > 0.5) {
    const k = (f - 0.5) / 0.5;
    out.setRGB(0.95 - 0.85 * k, 0.78 + 0.1 * k, 0.08);
  } else {
    const k = f / 0.5;
    out.setRGB(0.92, 0.12 + 0.66 * k, 0.06);
  }
  return out;
}

// ---------------------------------------------------------------------------
// command markers
// ---------------------------------------------------------------------------

const MARK_VS = `
attribute vec2 aMark; // age 0..1, kind
varying vec2 vUv;
varying vec3 vCol;
varying vec2 vMark;
void main() {
  vUv = uv * 2.0 - 1.0;
  vCol = instanceColor;
  vMark = aMark;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
}`;

const MARK_FS = `
varying vec2 vUv;
varying vec3 vCol;
varying vec2 vMark;
void main() {
  float age = vMark.x;
  float e = 1.0 - pow( 1.0 - age, 2.2 );
  vec2 p = vUv;
  float r = length( p );
  float aa = fwidth( r ) * 1.4;
  // contracting ring
  float rr = mix( 0.62, 0.2, e );
  float ring = 1.0 - smoothstep( 0.035, 0.035 + aa, abs( r - rr ) );
  // four chevrons converging on the point
  float ang = atan( p.y, p.x ) + ( vMark.y > 0.5 && vMark.y < 1.5 ? 0.7854 : 0.0 );
  float sec = mod( ang + 0.7854, 1.5708 ) - 0.7854;
  float tang = sec * r;
  float d = mix( 0.98, 0.34, e );
  float v = ( r - d ) - abs( tang ) * 1.1;
  float chev = ( 1.0 - smoothstep( 0.05, 0.05 + aa * 1.5, abs( v ) ) ) * ( 1.0 - smoothstep( 0.17, 0.2, abs( tang ) ) );
  float core = ( 1.0 - smoothstep( 0.0, 0.12, r ) ) * ( 1.0 - e ) * 0.6;
  float fade = 1.0 - age * age;
  float a = clamp( ring * 0.85 + chev + core, 0.0, 1.0 ) * fade;
  if ( a < 0.01 ) discard;
  gl_FragColor = vec4( vCol * ( 0.85 + 0.4 * chev ), a );
  #include <colorspace_fragment>
}`;

export const MARKER_COLORS = { move: '#4dff5a', attack: '#ff3a2a', gather: '#ffd23a' };
const MARKER_KIND = { move: 0, attack: 1, gather: 2 };
const MARKER_LIFE = 0.75;

/** Animated command markers on the ground. */
export class MarkerLayer {
  constructor(parent, max = 24) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.aMark = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    this.aMark.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aMark', this.aMark);
    this.material = new THREE.ShaderMaterial({
      vertexShader: MARK_VS,
      fragmentShader: MARK_FS,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.material.name = 'overlay-markers';
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.name = 'command-markers';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    parent.add(this.mesh);
    this.items = [];
    for (let i = 0; i < max; i++) this.items.push({ live: false, t: 0, x: 0, y: 0, z: 0, kind: 0, nx: 0, ny: 1, nz: 0 });
    this.colors = Object.fromEntries(Object.entries(MARKER_COLORS).map(([k, v]) => [k, new THREE.Color(v)]));
    this.next = 0;
  }

  spawn(x, y, z, kind, normal) {
    let it = this.items.find((m) => !m.live);
    if (!it) {
      it = this.items[this.next];
      this.next = (this.next + 1) % this.max;
    }
    it.live = true;
    it.t = 0;
    it.x = x;
    it.y = y;
    it.z = z;
    it.kind = MARKER_KIND[kind] ?? 0;
    it.color = this.colors[kind] || this.colors.move;
    if (normal) {
      it.nx = normal.x;
      it.ny = normal.y;
      it.nz = normal.z;
    } else {
      it.nx = 0;
      it.ny = 1;
      it.nz = 0;
    }
  }

  update(dt) {
    let n = 0;
    const a = this.aMark.array;
    for (const it of this.items) {
      if (!it.live) continue;
      it.t += dt / MARKER_LIFE;
      if (it.t >= 1) {
        it.live = false;
        continue;
      }
      _n.set(it.nx, it.ny, it.nz);
      _q.setFromUnitVectors(UP, _n);
      _p.set(it.x, it.y, it.z);
      const s = it.kind === 1 ? 0.95 : 0.85;
      _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, it.color);
      a[n * 2] = it.t;
      a[n * 2 + 1] = it.kind;
      n++;
    }
    this.mesh.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
      this.aMark.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// floating text
// ---------------------------------------------------------------------------

const TEXT_LIFE = 1.5;
const TEXT_W = 256;
const TEXT_H = 64;
const TEXT_FONT = 'bold 40px "Trebuchet MS", "Segoe UI", system-ui, sans-serif';

/** Pooled camera-facing text sprites ("+25", "Level 3"). Needs a DOM canvas (no-op in Node). */
export class FloatingTextLayer {
  constructor(parent, max = 24) {
    this.parent = parent;
    this.max = max;
    this.items = [];
    this.enabled = typeof document !== 'undefined' && typeof document.createElement === 'function';
    // Warm the text pipeline now: the first text drawn with a font list can
    // stall for tens of milliseconds (font fallback lookup) mid-battle.
    if (this.enabled) {
      const it = this.make();
      this.items.push(it);
      if (it.ctx) {
        it.ctx.font = TEXT_FONT;
        it.ctx.measureText('+0123456789 Level');
        it.ctx.fillText('+0', 0, 0);
        it.ctx.clearRect(0, 0, TEXT_W, TEXT_H);
      }
    }
  }

  make() {
    const canvas = document.createElement('canvas');
    canvas.width = TEXT_W;
    canvas.height = TEXT_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    mat.name = 'floating-text';
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 30;
    sprite.visible = false;
    this.parent.add(sprite);
    return { canvas, ctx: canvas.getContext('2d'), tex, mat, sprite, live: false, t: 0, x: 0, y: 0, z: 0, w: 1, scale: 1 };
  }

  spawn(x, y, z, text, color = '#ffd84a', scale = 1) {
    if (!this.enabled) return;
    let it = this.items.find((s) => !s.live);
    if (!it) {
      if (this.items.length < this.max) this.items.push((it = this.make()));
      else it = this.items.reduce((a, b) => (a.t > b.t ? a : b));
    }
    const ctx = it.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, TEXT_W, TEXT_H);
    ctx.font = TEXT_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const str = String(text).slice(0, 18);
    const w = Math.min(TEXT_W - 8, ctx.measureText(str).width + 16);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(str, TEXT_W / 2, TEXT_H / 2 + 2);
    ctx.fillStyle = color;
    ctx.fillText(str, TEXT_W / 2, TEXT_H / 2 + 2);
    it.tex.needsUpdate = true;
    it.live = true;
    it.t = 0;
    it.x = x;
    it.y = y;
    it.z = z;
    it.w = w / TEXT_W;
    it.scale = scale;
    it.sprite.visible = true;
  }

  /** @param {number} dt @param {number} zoomK size factor for the current zoom */
  update(dt, zoomK = 1) {
    for (const it of this.items) {
      if (!it.live) continue;
      it.t += dt;
      const u = it.t / TEXT_LIFE;
      if (u >= 1) {
        it.live = false;
        it.sprite.visible = false;
        continue;
      }
      const rise = 1 - (1 - u) * (1 - u);
      it.sprite.position.set(it.x, it.y + rise * 1.1, it.z);
      const pop = u < 0.12 ? 0.6 + 0.4 * (u / 0.12) * 1.15 : u < 0.2 ? 1.15 - 0.15 * ((u - 0.12) / 0.08) : 1;
      const s = 0.42 * zoomK * it.scale * pop;
      it.sprite.scale.set(s * 4, s, 1);
      it.mat.opacity = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
    }
  }

  dispose() {
    for (const it of this.items) {
      it.sprite.removeFromParent();
      it.tex.dispose();
      it.mat.dispose();
    }
    this.items.length = 0;
  }
}

// ---------------------------------------------------------------------------
// rally flags
// ---------------------------------------------------------------------------

/** Team-colored rally flags for selected own buildings (pooled). */
export class RallyFlags {
  /**
   * @param {THREE.Object3D} parent
   * @param {number} [max] flags
   * @param {(x:number, y:number)=>number} [groundFn] ground height (sim coords) for the dotted rally line
   */
  constructor(parent, max = 12, groundFn = null) {
    this.parent = parent;
    this.max = max;
    this.groundFn = groundFn;
    // dotted line from the building to its flag (instanced, one draw call)
    this.maxDots = 480;
    const dot = new THREE.CircleGeometry(0.09, 8);
    dot.rotateX(-Math.PI / 2);
    this.dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.dots = new THREE.InstancedMesh(dot, this.dotMat, this.maxDots);
    this.dots.name = 'rally-line';
    this.dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dots.setColorAt(0, _c.set(1, 1, 1));
    this.dots.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 4;
    parent.add(this.dots);
    this.nDots = 0;
    this.pole = new THREE.CylinderGeometry(0.025, 0.035, 1.25, 5);
    this.pole.translate(0, 0.625, 0);
    const flag = new THREE.BufferGeometry();
    // a small pennant subdivided so it can wave
    const pos = [];
    const segs = 6;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const half = 0.19 * (1 - u * 0.55);
      pos.push(u * 0.55, 1.18 + half - 0.19, 0, u * 0.55, 1.18 - half - 0.19, 0);
    }
    const idx = [];
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    flag.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    flag.setIndex(idx);
    flag.computeVertexNormals();
    this.flagBase = Float32Array.from(pos);
    this.flagGeo = flag;
    this.disc = new THREE.CircleGeometry(0.22, 12);
    this.disc.rotateX(-Math.PI / 2);
    this.poleMat = new THREE.MeshLambertMaterial({ color: '#5a3d22', flatShading: true });
    this.discMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false });
    this.mats = new Map();
    this.items = [];
    this.n = 0;
  }

  flagMat(color) {
    const key = String(color);
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, flatShading: true, emissive: new THREE.Color(color).multiplyScalar(0.25) });
      this.mats.set(key, m);
    }
    return m;
  }

  begin() {
    this.n = 0;
    this.nDots = 0;
  }

  /**
   * Marching dotted line on the ground from (x0, z0) to (x1, z1), starting
   * `skip` world units from the start (outside the building) and stopping
   * short of the flag.
   */
  addLine(x0, z0, x1, z1, skip, color, time) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    const end = len - 0.3;
    if (end <= skip) return;
    const step = 0.5;
    const ux = dx / len;
    const uz = dz / len;
    _c.set(color);
    const g = this.groundFn;
    for (let d = skip + ((time * 1.1) % step); d < end && this.nDots < this.maxDots; d += step) {
      const x = x0 + ux * d;
      const z = z0 + uz * d;
      const y = (g ? Math.max(g(x, z), -0.2) : 0) + 0.05;
      _m.makeTranslation(x, y, z);
      // fade in at the building and out at the flag
      const k = Math.min(1, (d - skip) / 0.8, (end - d) / 0.6 + 0.35);
      _m.elements[0] = _m.elements[10] = 0.55 + 0.45 * k;
      const i = this.nDots++;
      this.dots.setMatrixAt(i, _m);
      this.dots.setColorAt(i, _c);
    }
  }

  makeItem(color) {
    const g = new THREE.Group();
    g.name = 'rally-flag';
    const pole = new THREE.Mesh(this.pole, this.poleMat);
    const geo = this.flagGeo.clone();
    const flag = new THREE.Mesh(geo, this.flagMat(color));
    const disc = new THREE.Mesh(this.disc, this.discMat);
    disc.position.y = 0.02;
    g.add(pole, flag, disc);
    this.parent.add(g);
    const it = { g, flag, geo };
    this.items.push(it);
    return it;
  }

  /** One hidden flag, so the renderer's warm-up compile sees the pole and flag shaders (the first rally point would otherwise link them). */
  prewarm() {
    if (this.items.length) return;
    this.makeItem('#ffffff').g.visible = false;
  }

  add(x, y, z, color, time) {
    if (this.n >= this.max) return;
    const it = this.items[this.n] || this.makeItem(color);
    this.n++;
    it.g.visible = true;
    it.g.position.set(x, y, z);
    it.flag.material = this.flagMat(color);
    // wave
    const p = it.geo.attributes.position;
    const base = this.flagBase;
    for (let i = 0; i < p.count; i++) {
      const u = base[i * 3] / 0.55;
      p.array[i * 3 + 2] = Math.sin(time * 6 + u * 3.2) * 0.07 * u;
    }
    p.needsUpdate = true;
  }

  end() {
    for (let i = this.n; i < this.items.length; i++) this.items[i].g.visible = false;
    this.dots.count = this.nDots;
    if (this.nDots) {
      this.dots.instanceMatrix.clearUpdateRanges();
      this.dots.instanceMatrix.addUpdateRange(0, this.nDots * 16);
      this.dots.instanceMatrix.needsUpdate = true;
      this.dots.instanceColor.clearUpdateRanges();
      this.dots.instanceColor.addUpdateRange(0, this.nDots * 3);
      this.dots.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const it of this.items) {
      it.g.removeFromParent();
      it.geo.dispose();
    }
    this.items.length = 0;
    this.dots.removeFromParent();
    this.dots.geometry.dispose();
    this.dots.dispose();
    this.dotMat.dispose();
    this.pole.dispose();
    this.flagGeo.dispose();
    this.disc.dispose();
    this.poleMat.dispose();
    this.discMat.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}
