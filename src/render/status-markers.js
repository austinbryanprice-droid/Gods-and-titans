// Persistent status markers over units (EntityView `fx`): small camera-facing
// icons above the head for buff (golden up-chevrons), debuff (red
// down-chevrons), slow (ice snowflake) and damage over time (a green drip),
// and a translucent bubble around shielded units. Both are single
// InstancedMeshes refilled every frame (two draw calls in all), the glyphs
// drawn procedurally in the fragment shader; nothing is allocated per frame.
// A ranked soldier (EntityView `rk`) also wears one to three small diamonds in a row, in
// bronze / silver / gold (addRank, colours from data/ranks.js). Diamonds, not chevrons: a buff
// is already a pair of gold chevrons and must not read as a rank.
// Stun stars and the slow / invulnerable ground rings live in overlays.js.
import * as THREE from 'three';
import { RANK_COLORS } from '../data/ranks.js';

/** Icon kinds, in the order they are laid out left to right. */
export const STATUS_ICONS = Object.freeze({ buff: 0, debuff: 1, slow: 2, dot: 3 });
/** Rank pips (diamonds) are icon kinds RANK_ICON + rank (4, 5, 6). */
export const RANK_ICON = 3;
const ICON_ORDER = ['buff', 'debuff', 'slow', 'dot'];
// Buffs come mostly from god / hero auras and sit over much of an army in a
// fight: drawn a little lighter so debuffs, slows and damage over time stand out.
const ICON_ALPHA = [0.75, 1, 1, 1];

const ICON_VS = `
attribute vec4 aIcon; // kind, alpha, phase, x offset (in icon sizes)
varying vec2 vUv;
varying vec4 vIcon;
void main() {
  vec4 c = modelViewMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 );
  float s = instanceMatrix[ 0 ][ 0 ];
  c.xy += ( position.xy + vec2( aIcon.w, 0.0 ) ) * s;
  gl_Position = projectionMatrix * c;
  vUv = uv * 2.0 - 1.0;
  vIcon = aIcon;
}`;

const ICON_FS = `
uniform float uTime;
uniform vec3 uRank[ 3 ]; // display (sRGB) colours of rank 1, 2, 3
varying vec2 vUv;
varying vec4 vIcon;
float sdSeg( vec2 p, vec2 a, vec2 b ) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 );
  return length( pa - ba * h );
}
float chevron( vec2 p, float y ) {
  p.x = abs( p.x );
  return sdSeg( p, vec2( 0.0, y + 0.27 ), vec2( 0.6, y - 0.27 ) );
}
vec2 rot( vec2 p, float a ) {
  float c = cos( a );
  float s = sin( a );
  return vec2( c * p.x - s * p.y, s * p.x + c * p.y );
}
float drop( vec2 p ) {
  // a teardrop: circle below, a cone up to the tip
  float circle = length( p - vec2( 0.0, -0.22 ) ) - 0.42;
  vec2 n = normalize( vec2( 0.98, 0.42 ) );
  float cone = max( dot( vec2( abs( p.x ), p.y ) - vec2( 0.0, 0.74 ), n ), -p.y - 0.22 );
  return min( circle, cone );
}
void main() {
  float kind = vIcon.x;
  float t = uTime + vIcon.z;
  vec2 p = vUv * 1.08;
  float d;
  vec3 col;
  vec3 col2;
  float shade = clamp( 0.55 + 0.6 * vUv.y, 0.0, 1.0 );
  if ( kind < 0.5 ) {
    // buff: two golden chevrons drifting up
    float b = 0.06 * sin( t * 4.0 );
    d = min( chevron( p, 0.3 + b ), chevron( p, -0.3 + b ) ) - 0.15;
    col = vec3( 1.0, 0.9, 0.3 );
    col2 = vec3( 1.0, 0.62, 0.05 );
  } else if ( kind < 1.5 ) {
    // debuff: two red chevrons sinking
    float b = 0.06 * sin( t * 4.0 );
    vec2 q = vec2( p.x, -p.y );
    d = min( chevron( q, 0.3 + b ), chevron( q, -0.3 + b ) ) - 0.15;
    col = vec3( 1.0, 0.36, 0.3 );
    col2 = vec3( 0.82, 0.06, 0.04 );
  } else if ( kind < 2.5 ) {
    // slow: a snowflake, turning slowly
    vec2 q0 = rot( p, t * 0.6 );
    d = 1e3;
    for ( int i = 0; i < 3; i++ ) {
      vec2 q = abs( rot( q0, float( i ) * 1.0472 ) );
      d = min( d, sdSeg( q, vec2( 0.0 ), vec2( 0.84, 0.0 ) ) );
      d = min( d, sdSeg( q, vec2( 0.46, 0.0 ), vec2( 0.68, 0.22 ) ) );
    }
    d -= 0.1;
    col = vec3( 0.88, 0.97, 1.0 );
    col2 = vec3( 0.42, 0.78, 1.0 );
  } else if ( kind < 3.5 ) {
    // damage over time: a venom drop, with a small drop falling from it
    float f = fract( t * 0.9 );
    d = drop( p * 1.12 + vec2( 0.0, -0.12 ) );
    float small = length( p - vec2( 0.0, -0.62 - f * 0.32 ) ) - 0.13 * ( 1.0 - f );
    d = min( d, small );
    col = vec3( 0.5, 1.0, 0.22 );
    col2 = vec3( 0.62, 0.25, 0.9 );
  } else {
    // rank: kind 4 / 5 / 6 = one / two / three diamonds side by side, bronze / silver / gold
    float n = kind - 3.0;
    d = 1e3;
    for ( int i = 0; i < 3; i++ ) {
      if ( float( i ) < n - 0.5 ) {
        vec2 q = p - vec2( ( float( i ) - ( n - 1.0 ) * 0.5 ) * 0.64, 0.0 );
        d = min( d, ( abs( q.x ) + abs( q.y ) - 0.27 ) * 0.7071 );
      }
    }
    shade = clamp( 0.5 + 2.0 * p.y, 0.0, 1.0 ); // lit from above: a faceted gem
    vec3 rc = kind < 4.5 ? uRank[ 0 ] : kind < 5.5 ? uRank[ 1 ] : uRank[ 2 ];
    col = min( rc * 1.12 + 0.06, vec3( 1.0 ) );
    col2 = rc * 0.72;
  }
  float aa = fwidth( d ) * 1.2 + 1e-4;
  float fill = 1.0 - smoothstep( -aa, aa, d );
  float outline = 1.0 - smoothstep( 0.09 - aa, 0.09 + aa, d );
  float a = max( fill, outline * 0.88 ) * vIcon.y;
  if ( a < 0.01 ) discard;
  // colors above are display (sRGB) values; the output is converted from linear
  vec3 c = mix( col2, col, shade );
  c = mix( vec3( 0.04, 0.025, 0.03 ), c, fill );
  gl_FragColor = vec4( pow( c, vec3( 2.2 ) ), a );
  #include <colorspace_fragment>
}`;

const BUBBLE_VS = `
attribute vec2 aBubble; // alpha, phase
varying vec2 vUv;
varying vec2 vB;
void main() {
  vec4 c = modelViewMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 );
  float r = instanceMatrix[ 0 ][ 0 ];
  c.xy += position.xy * r;
  c.z += r * 0.85; // in front of the unit it surrounds
  gl_Position = projectionMatrix * c;
  vUv = uv * 2.0 - 1.0;
  vB = aBubble;
}`;

const BUBBLE_FS = `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying vec2 vB;
void main() {
  float r = length( vUv );
  if ( r > 1.0 ) discard;
  float aa = fwidth( r ) * 1.5;
  float edge = 1.0 - smoothstep( 1.0 - aa, 1.0, r );
  float rim = pow( r, 6.0 ) * 0.75 + 0.07;
  // a soft highlight up-left and a shimmer band sweeping across
  float hl = smoothstep( 0.42, 0.0, length( vUv - vec2( -0.36, 0.42 ) ) ) * 0.45;
  float band = smoothstep( 0.12, 0.0, abs( vUv.y + vUv.x * 0.35 - sin( uTime * 1.3 + vB.y ) * 0.8 ) ) * 0.12;
  float a = ( rim + hl + band ) * edge * vB.x;
  vec3 c = mix( uColor, vec3( 1.0 ), hl * 1.6 + band );
  gl_FragColor = vec4( c, a );
  #include <colorspace_fragment>
}`;

/** Instanced status icons + shield bubbles. */
export class StatusLayer {
  /**
   * @param {THREE.Object3D} parent
   * @param {number} [maxIcons]
   * @param {number} [maxBubbles]
   */
  constructor(parent, maxIcons = 768, maxBubbles = 256) {
    this.maxIcons = maxIcons;
    this.maxBubbles = maxBubbles;
    this.uniforms = { uTime: { value: 0 } };

    const geo = new THREE.PlaneGeometry(1, 1);
    this.aIcon = new THREE.InstancedBufferAttribute(new Float32Array(maxIcons * 4), 4);
    this.aIcon.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aIcon', this.aIcon);
    // The shader works in display colours; RANK_COLORS[0] is the Recruit, who wears nothing.
    const rankRgb = RANK_COLORS.slice(1).map((hex) => new THREE.Vector3(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)));
    this.iconMaterial = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uRank: { value: rankRgb } },
      vertexShader: ICON_VS,
      fragmentShader: ICON_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.iconMaterial.name = 'overlay-status-icons';
    this.icons = new THREE.InstancedMesh(geo, this.iconMaterial, maxIcons);
    this.icons.name = 'status-icons';
    this.icons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.icons.count = 0;
    this.icons.frustumCulled = false;
    this.icons.renderOrder = 21; // over health bars
    parent.add(this.icons);

    const bgeo = new THREE.PlaneGeometry(2, 2);
    this.aBubble = new THREE.InstancedBufferAttribute(new Float32Array(maxBubbles * 2), 2);
    this.aBubble.setUsage(THREE.DynamicDrawUsage);
    bgeo.setAttribute('aBubble', this.aBubble);
    this.bubbleMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uniforms.uTime, uColor: { value: new THREE.Color('#8fd6ff') } },
      vertexShader: BUBBLE_VS,
      fragmentShader: BUBBLE_FS,
      transparent: true,
      depthWrite: false,
    });
    this.bubbleMaterial.name = 'overlay-shield-bubbles';
    this.bubbles = new THREE.InstancedMesh(bgeo, this.bubbleMaterial, maxBubbles);
    this.bubbles.name = 'shield-bubbles';
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bubbles.count = 0;
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 9;
    parent.add(this.bubbles);

    this.nIcons = 0;
    this.nBubbles = 0;
    this._m = new THREE.Matrix4();
  }

  begin(time) {
    this.uniforms.uTime.value = time;
    this.nIcons = 0;
    this.nBubbles = 0;
  }

  /** Number of icons `fx` asks for (buff, debuff, slow, dot). */
  static iconCount(fx) {
    let n = 0;
    for (let i = 0; i < fx.length; i++) if (STATUS_ICONS[fx[i]] !== undefined) n++;
    return n;
  }

  /**
   * The icons for a unit's status list in one row centered on (x, y, z).
   * @param {number} x world X
   * @param {number} y world Y (row center)
   * @param {number} z world Z
   * @param {ArrayLike<string>} fx EntityView status codes
   * @param {number} size icon size, world units
   * @param {number} alpha
   * @param {number} phase animation offset (per unit)
   * @returns {number} icons added
   */
  addIcons(x, y, z, fx, size, alpha, phase) {
    const n = StatusLayer.iconCount(fx);
    if (!n) return 0;
    let k = 0;
    const a = this.aIcon.array;
    const e = this._m.elements;
    for (let j = 0; j < ICON_ORDER.length; j++) {
      const name = ICON_ORDER[j];
      let has = false;
      for (let i = 0; i < fx.length; i++) {
        if (fx[i] === name) {
          has = true;
          break;
        }
      }
      if (!has || this.nIcons >= this.maxIcons) continue;
      const i = this.nIcons++;
      e[0] = size; e[1] = 0; e[2] = 0; e[3] = 0;
      e[4] = 0; e[5] = size; e[6] = 0; e[7] = 0;
      e[8] = 0; e[9] = 0; e[10] = 1; e[11] = 0;
      e[12] = x; e[13] = y; e[14] = z; e[15] = 1;
      this.icons.setMatrixAt(i, this._m);
      a[i * 4] = STATUS_ICONS[name];
      a[i * 4 + 1] = alpha * ICON_ALPHA[j];
      a[i * 4 + 2] = phase;
      a[i * 4 + 3] = (k - (n - 1) / 2) * 1.12;
      k++;
    }
    return k;
  }

  /**
   * A soldier's rank pips (1..3 diamonds, bronze / silver / gold) centered on (x, y, z).
   * @param {number} size icon size, world units
   * @returns {boolean} added (false for a Recruit or when the cap is reached)
   */
  addRank(x, y, z, rank, size, alpha) {
    const r = Math.min(3, rank | 0);
    if (r < 1 || this.nIcons >= this.maxIcons) return false;
    const i = this.nIcons++;
    const e = this._m.elements;
    e[0] = size; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = size; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[10] = 1; e[11] = 0;
    e[12] = x; e[13] = y; e[14] = z; e[15] = 1;
    this.icons.setMatrixAt(i, this._m);
    const a = this.aIcon.array;
    a[i * 4] = RANK_ICON + r;
    a[i * 4 + 1] = alpha;
    a[i * 4 + 2] = 0;
    a[i * 4 + 3] = 0;
    return true;
  }

  /** A shield bubble of radius r centered on (x, y, z). */
  addBubble(x, y, z, r, alpha, phase) {
    if (this.nBubbles >= this.maxBubbles) return;
    const i = this.nBubbles++;
    const e = this._m.elements;
    e[0] = r; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = r; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[10] = 1; e[11] = 0;
    e[12] = x; e[13] = y; e[14] = z; e[15] = 1;
    this.bubbles.setMatrixAt(i, this._m);
    this.aBubble.array[i * 2] = alpha;
    this.aBubble.array[i * 2 + 1] = phase;
  }

  end() {
    this.icons.count = this.nIcons;
    if (this.nIcons) {
      this.icons.instanceMatrix.clearUpdateRanges();
      this.icons.instanceMatrix.addUpdateRange(0, this.nIcons * 16);
      this.icons.instanceMatrix.needsUpdate = true;
      this.aIcon.clearUpdateRanges();
      this.aIcon.addUpdateRange(0, this.nIcons * 4);
      this.aIcon.needsUpdate = true;
    }
    this.bubbles.count = this.nBubbles;
    if (this.nBubbles) {
      this.bubbles.instanceMatrix.clearUpdateRanges();
      this.bubbles.instanceMatrix.addUpdateRange(0, this.nBubbles * 16);
      this.bubbles.instanceMatrix.needsUpdate = true;
      this.aBubble.clearUpdateRanges();
      this.aBubble.addUpdateRange(0, this.nBubbles * 2);
      this.aBubble.needsUpdate = true;
    }
  }

  dispose() {
    for (const m of [this.icons, this.bubbles]) {
      m.removeFromParent();
      m.geometry.dispose();
      m.dispose();
    }
    this.iconMaterial.dispose();
    this.bubbleMaterial.dispose();
  }
}
