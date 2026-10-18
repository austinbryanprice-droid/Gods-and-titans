// Low-level drawing layers for the VFX system. Everything here is pooled and
// preallocated: particles live in typed arrays drawn as one THREE.Points per
// blend mode, persistent glows in a slot batch, decals / ribbons / flares /
// pillars / domes are reusable meshes with their own material clones (shared
// geometry or preallocated buffers), and a fixed set of point lights follows
// the brightest flashes (LightPool).
//
// Colors are linear { r, g, b } (vfx-palette.js). The shaders work in linear
// light and may go past 1 (HDR) at hot cores so post.js blooms them; they end
// with VFX_TONEMAP_GLSL (the tone mapping and color space chunks, which are
// no-ops into the HDR target and tone map + sRGB-encode on the low-quality
// path, straight to the canvas), before the color is premultiplied (vfxPremul),
// so there it blends in sRGB space just as the effects were designed.
import * as THREE from 'three';

const TAU = Math.PI * 2;

/**
 * How much each glowing layer darkens what is behind it. Glows use premultiplied
 * "additive with a little occlusion" blending (src + dst * (1 - occ * coverage)):
 * pure additive washes out to white over bright grass, a little occlusion keeps
 * the element hue saturated while still reading as light.
 */
export const OCCLUSION = { points: 0.3, decal: 0.45, ribbon: 0.35, flare: 0.3, pillar: 0.3, dome: 0.22 };

/** Switch a material to premultiplied glow blending (shader outputs vec4(color * a, a * occ)). */
export function glowBlend(mat) {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return mat;
}

/**
 * Premultiplied output shared by every VFX shader (and fires.js). Usage, with
 * c the un-premultiplied linear color and a its coverage:
 *   gl_FragColor = vec4( c, 1.0 );
 *   <VFX_TONEMAP_GLSL>
 *   gl_FragColor = vfxPremul( gl_FragColor.rgb, a );
 * uOcc: how much of the coverage hides what is behind (1 = alpha blended).
 */
export const VFX_OUT_GLSL = /* glsl */ `
uniform float uOcc;
// true when this pass writes linear values (the HDR target), false on an sRGB canvas
bool vfxLinearOut() { return linearToOutputTexel( vec4( 0.5 ) ).r < 0.6; }
// The Neutral tone mapper (post.js, and the canvas on low quality) has a toe that
// pulls every channel down by about the darkest one (min m becomes 6.25 m^2 below
// 0.08): dark colors come out much darker and more saturated (storm-cloud grey
// turns navy). The effects were authored for the screen as is, so their colors
// are pre-compensated with the toe's inverse and come out as authored. Exact on
// the canvas (tone mapped per fragment). In the HDR target the toe comes after
// blending, so there only alpha-blended colors are compensated: where they cover,
// the pixel is mostly their own color; glows add to whatever is below.
vec3 vfxUntoe( vec3 c ) {
  #ifndef TONE_MAPPING
    if ( !( uOcc >= 0.999 && vfxLinearOut() ) ) return c;
  #endif
  float m = max( min( c.r, min( c.g, c.b ) ), 0.0 );
  return c + ( ( m < 0.04 ? 0.4 * sqrt( m ) : m + 0.04 ) - m );
}
vec4 vfxPremul( vec3 c, float a ) {
  a = clamp( a, 0.0, 1.0 );
  float cov = a * uOcc;
  float w = a;
  if ( vfxLinearOut() ) {
    // Blended in linear light the same coverage hides far less than it did in
    // sRGB (half coverage over black reads ~73% bright, not 50%), so it is
    // curved: cov' = 1 - (1 - cov)^p.
    if ( uOcc < 0.999 ) {
      // glows: only the darkening, by as much as the sRGB blend darkened
      cov = 1.0 - pow( 1.0 - cov, 2.2 );
    } else {
      // alpha blended (smoke, clouds, scorch): color weight and darkening follow
      // the same curve. p was fitted (with vfxUntoe and the tone mapper) so the
      // result matches the sRGB blend over typical ground: 1.55 for dark colors,
      // easing to 1 (plain linear) from mid grey up. Steeper over-weights a dark
      // tinted body (storm clouds turn navy).
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      cov = 1.0 - pow( 1.0 - cov, mix( 1.55, 1.0, smoothstep( 0.08, 0.2, l ) ) );
      w = cov;
    }
  }
  return vec4( c * w, cov );
}`;

/**
 * End of every VFX fragment shader before vfxPremul (needs VFX_OUT_GLSL): the
 * authored color through the tone mapper (vfxUntoe) and into the output's color space.
 */
export const VFX_TONEMAP_GLSL = /* glsl */ `
  gl_FragColor.rgb = vfxUntoe( gl_FragColor.rgb );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

const OUT = VFX_TONEMAP_GLSL;

// ---------------------------------------------------------------- shaders

const POINT_VS = /* glsl */ `
attribute vec4 aColor;
attribute vec4 aParams; // world size, rotation, atlas cell, heat
uniform float uScale;
uniform float uMaxSize;
varying vec4 vColor;
varying vec2 vCell;
varying vec2 vRot;
varying float vHeat;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(0.5, -mv.z);
  // pull toward the camera so big glows near the ground are not cut in half
  mv.xyz += normalize(-mv.xyz) * min(aParams.x * 0.35, dist * 0.5);
  gl_Position = projectionMatrix * mv;
  float ps = aParams.x * uScale / max(0.25, -mv.z);
  gl_PointSize = min(ps, uMaxSize);
  vColor = aColor;
  if (aColor.a < 0.004 || ps < 0.3) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vRot = vec2(cos(aParams.y), sin(aParams.y));
  vCell = vec2(mod(aParams.z, 4.0), floor(aParams.z / 4.0 + 0.01));
  vHeat = aParams.w;
}`;

const POINT_FS = /* glsl */ `
uniform sampler2D uMap;
uniform float uCore;  // how far the hot centre whitens
uniform float uBoost; // HDR gain of the hot centre per unit of heat
varying vec4 vColor;
varying vec2 vCell;
varying vec2 vRot;
varying float vHeat;
${VFX_OUT_GLSL}
void main() {
  vec2 p = gl_PointCoord - 0.5;
  p = vec2(vRot.x * p.x - vRot.y * p.y, vRot.y * p.x + vRot.x * p.y) + 0.5;
  vec4 t = texture2D(uMap, (vCell + clamp(p, 0.004, 0.996)) * vec2(0.25, 0.5));
  float a = t.a * vColor.a;
  if (a < 0.003) discard;
  // white-hot centre: the dense middle of a glow / star / spark (heat > 0) whitens
  // and goes past 1, so it blooms; smoke, rings and shards (heat 0) keep their color.
  // Blue whitens last, like a heating flame (orange → yellow → white): whitening
  // red-orange evenly in linear light turns it salmon pink.
  float hot = t.a * t.a * t.a * vHeat;
  vec3 c = mix(vColor.rgb * t.rgb, vec3(1.0), min(hot, 1.0) * uCore * vec3(1.0, 1.0, 0.55)) * (1.0 + hot * uBoost);
  gl_FragColor = vec4(c, 1.0);
  ${OUT}
  gl_FragColor = vfxPremul(gl_FragColor.rgb, a);
}`;

const DECAL_VS = /* glsl */ `
attribute vec2 aPolar;
varying vec2 vP;
void main() {
  vP = aPolar;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NOISE_GLSL = /* glsl */ `
float vfxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vfxNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = vfxHash(i), b = vfxHash(i + vec2(1.0, 0.0)), c = vfxHash(i + vec2(0.0, 1.0)), d = vfxHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;

// Ground decals are big and can last: their color stays at or below 1 (no bloom).
const DECAL_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform vec3 uRing;   // centre (0..1 of radius), half width, strength
uniform vec3 uFill;   // strength, falloff power, core mix
uniform float uRunes;
uniform float uNoise;
uniform float uCrack;
uniform float uTime;
uniform float uSpin;
uniform vec3 uArc;    // start angle, angle span, 1 = partial sector
uniform float uSeed;
uniform float uEdge;  // ragged outline amount (clouds, smoke underlays)
varying vec2 vP;
${NOISE_GLSL}
${VFX_OUT_GLSL}
float band(float x, float c, float w) { return exp(-((x - c) * (x - c)) / (w * w)); }
void main() {
  float r = vP.y;
  float ang = uArc.x + vP.x * uArc.y;
  vec2 q = vec2(cos(ang), sin(ang)) * r;
  float ring = uRing.z * band(r, uRing.x, max(uRing.y, 0.002));
  float fill = uFill.x * pow(max(0.0, 1.0 - r), uFill.y);
  float a = ring + fill;
  if (uNoise > 0.0) {
    vec2 o = vec2(uSeed * 7.3, uSeed * 3.1);
    float n = vfxNoise(q * 2.6 + o + vec2(uTime * 0.21, -uTime * 0.17)) * 0.6 + vfxNoise(q * 6.5 - o - vec2(uTime * 0.37, uTime * 0.29)) * 0.4;
    a *= mix(1.0, 0.25 + n * 1.5, uNoise);
  }
  if (uRunes > 0.0) {
    float s = sin(uSpin), c = cos(uSpin);
    vec2 w = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    float wa = atan(w.y, w.x);
    float runes = band(r, 0.95, 0.022) + 0.8 * band(r, 0.78, 0.014);
    runes += band(r, 0.865, 0.03) * step(0.42, fract(wa * 3.8197));
    float hx = 0.0;
    for (int k = 0; k < 6; k++) {
      float th = float(k) * 1.0471976;
      hx = max(hx, band(dot(w, vec2(cos(th), sin(th))), 0.39, 0.013));
    }
    runes += 0.85 * hx * step(r, 0.78);
    runes += 0.6 * band(r, 0.3, 0.012);
    a += uRunes * runes;
  }
  if (uCrack > 0.0) {
    // polar cells: long radial cracks with a few cross breaks, denser at the centre
    vec2 p = vec2(atan(q.y, q.x) * 1.75, sqrt(r) * 4.4) + uSeed * 11.0;
    vec2 g = floor(p); vec2 f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 b = vec2(float(i), float(j));
      vec2 o = vec2(vfxHash(g + b), vfxHash(g + b + 17.31));
      vec2 rr = b + o - f;
      float d = dot(rr, rr);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    float edge = sqrt(d2) - sqrt(d1);
    float cr = 1.0 - smoothstep(0.0, 0.09, edge);
    a += uCrack * cr * (1.0 - smoothstep(0.55, 1.0, r));
  }
  float rim = 1.0;
  if (uEdge > 0.0) {
    vec2 dir = q / max(r, 1e-4);
    rim = 1.0 - uEdge * (0.1 + 0.32 * vfxNoise(dir * 2.3 + vec2(uSeed * 5.1 + uTime * 0.12, uSeed)));
    a *= 1.0 - smoothstep(rim - 0.1 - 0.2 * uEdge, rim, r);
  }
  a *= 1.0 - smoothstep(0.96, 1.0, r);
  if (uArc.z > 0.5) a *= smoothstep(0.0, 0.14, vP.x) * (1.0 - smoothstep(0.86, 1.0, vP.x));
  vec3 col = mix(uColor, uCore, clamp(ring * 0.6 + fill * fill * uFill.z, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
  gl_FragColor = vfxPremul(gl_FragColor.rgb, a * uOpacity);
}`;

const RIBBON_VS = /* glsl */ `
attribute vec3 aDir;
attribute vec3 aSUW; // side (-1 / 1), u along 0..1, width multiplier
uniform float uWidth;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 d = (modelViewMatrix * vec4(aDir, 0.0)).xyz;
  vec3 s = cross(d, normalize(mv.xyz));
  float l = length(s);
  s = l > 1e-6 ? s / l : vec3(1.0, 0.0, 0.0);
  mv.xyz += s * (aSUW.x * aSUW.z * uWidth * 0.5);
  vUv = vec2(aSUW.y, aSUW.x);
  gl_Position = projectionMatrix * mv;
}`;

// The bright line down the middle of a ribbon is HDR (uHot): bolts and beams bloom.
const RIBBON_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uTime;
uniform float uStripes;
uniform vec2 uFade;
uniform float uHot;
varying vec2 vUv;
${VFX_OUT_GLSL}
void main() {
  float v = abs(vUv.y);
  float core = exp(-v * v * 20.0);
  float halo = (1.0 - v) * (1.0 - v);
  float ends = smoothstep(0.0, uFade.x, vUv.x) * (1.0 - smoothstep(1.0 - uFade.y, 1.0, vUv.x));
  float st = 1.0 - uStripes * (0.5 + 0.5 * sin(vUv.x * 34.0 - uTime * 16.0));
  float wHalo = halo * 0.9 * st;
  float cover = min(1.0, wHalo + core);
  gl_FragColor = vec4((uColor * wHalo + uCore * core * uHot) / max(cover, 1e-3), 1.0);
  ${OUT}
  gl_FragColor = vfxPremul(gl_FragColor.rgb, cover * uOpacity * ends);
}`;

const FLARE_VS = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float dist = max(0.5, -mv.z);
  mv.xyz += normalize(-mv.xyz) * min(uSize * 0.5, dist * 0.6);
  mv.xy += position.xy * uSize;
  vUv = position.xy * 2.0;
  gl_Position = projectionMatrix * mv;
}`;

// Short flashes: a white-hot HDR core (uHot) and slightly hot rays bloom.
const FLARE_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uRays;
uniform float uSpin;
uniform float uHot;
varying vec2 vUv;
${VFX_OUT_GLSL}
void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  float e = 1.0 - d;
  float glow = exp(-d * d * 5.0) * e;
  float core = exp(-d * d * 34.0);
  float a = atan(vUv.y, vUv.x) + uSpin;
  float rays = uRays * (pow(abs(cos(a * 4.0)), 14.0) * e * e + 0.55 * pow(abs(cos(a * 4.0 + 0.3927)), 24.0) * e * e * e);
  float cover = min(1.0, glow + rays + core);
  gl_FragColor = vec4((uColor * (glow + rays * 1.8) + uCore * core * uHot) / max(cover, 1e-3), 1.0);
  ${OUT}
  gl_FragColor = vfxPremul(gl_FragColor.rgb, cover * uOpacity);
}`;

const FRESNEL_VS = /* glsl */ `
varying vec2 vUv;
varying float vF;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vF = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

const PILLAR_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uTime;
uniform float uHot;
varying vec2 vUv;
varying float vF;
${VFX_OUT_GLSL}
void main() {
  float y = vUv.y;
  float fade = pow(1.0 - y, 1.5) * smoothstep(0.0, 0.05, y);
  float edge = 0.3 + 0.7 * pow(1.0 - vF, 1.8);
  float s1 = 0.5 + 0.5 * sin(vUv.x * 37.699 + y * 9.0 - uTime * 6.0);
  float s2 = 0.5 + 0.5 * sin(vUv.x * 18.85 - y * 5.0 + uTime * 3.1);
  float wEdge = edge * (0.55 + 0.45 * s1 * s2);
  float wCore = pow(vF, 3.0) * 0.55 * (1.0 - y);
  float cover = min(1.0, wEdge + wCore);
  gl_FragColor = vec4((uColor * wEdge + uCore * wCore * uHot) / max(cover, 1e-3), 1.0);
  ${OUT}
  gl_FragColor = vfxPremul(gl_FragColor.rgb, cover * fade * uOpacity);
}`;

// Shield domes stay up for seconds: a weighted mix of the two colors, never past 1.
const DOME_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
varying float vF;
${VFX_OUT_GLSL}
void main() {
  float rim = pow(1.0 - vF, 2.2);
  float lon = smoothstep(0.86, 1.0, abs(sin(vUv.x * 3.14159 * 10.0)));
  float lat = smoothstep(0.86, 1.0, abs(sin(vUv.y * 3.14159 * 6.0)));
  float scan = smoothstep(0.0, 0.06, 0.06 - abs(fract(vUv.y * 1.5 - uTime * 0.6) - 0.5));
  float base = smoothstep(0.0, 0.08, vUv.y);
  float grid = (lon + lat) * 0.22;
  float wBody = 0.1 + rim * 1.05 + grid * (0.35 + rim) + scan * 0.35;
  float wCore = pow(rim, 5.0) * 0.6;
  float sum = wBody + wCore;
  gl_FragColor = vec4((uColor * wBody + uCore * wCore) / sum, 1.0);
  ${OUT}
  gl_FragColor = vfxPremul(gl_FragColor.rgb, min(sum, 1.0) * uOpacity * (0.4 + 0.6 * base));
}`;

// ---------------------------------------------------------------- helpers

const tmpV2 = new THREE.Vector2();
const tmpV4 = new THREE.Vector4();
let maxPointSize = 0;

/** HDR gain of a point sprite's hot centre per unit of heat (see POINT_FS). */
export const POINT_BOOST = 2.6;

function makePointsMaterial(map, additive) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uScale: { value: 800 },
      uMaxSize: { value: 256 },
      uCore: { value: additive ? 0.55 : 0 },
      uBoost: { value: additive ? POINT_BOOST : 0 },
      uOcc: { value: additive ? OCCLUSION.points : 1 },
    },
    vertexShader: POINT_VS,
    fragmentShader: POINT_FS,
    transparent: true,
    depthWrite: false,
  });
  return glowBlend(mat);
}

/**
 * onBeforeRender hook: point size scale from the camera and the viewport being
 * drawn into. post.js draws the world into its own target, smaller than the
 * canvas under adaptive resolution, so the drawing buffer is the wrong size.
 */
function pointScaleHook(mat) {
  return (renderer, scene, camera) => {
    let h = typeof renderer.getCurrentViewport === 'function' ? renderer.getCurrentViewport(tmpV4).w : 0;
    if (!(h > 0)) h = renderer.getDrawingBufferSize(tmpV2).y;
    const proj = camera.projectionMatrix.elements[5] || 1;
    mat.uniforms.uScale.value = h * proj * 0.5;
    if (!maxPointSize) {
      try {
        const gl = renderer.getContext();
        const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
        maxPointSize = (range && range[1]) || 256;
      } catch {
        maxPointSize = 256;
      }
    }
    mat.uniforms.uMaxSize.value = maxPointSize;
  };
}

function dynAttr(array, size) {
  const a = new THREE.BufferAttribute(array, size);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}

function markRange(attr, count) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, Math.max(1, count) * attr.itemSize);
  attr.needsUpdate = true;
}

// ---------------------------------------------------------------- particles

/**
 * Default heat (HDR hot centre, see POINT_FS) per atlas cell: glows, stars and
 * sparks burn white-hot, plus signs and flames a little (flame puffs pile up),
 * smoke / rings / shards not at all.
 */
export const CELL_HEAT = [0.8, 1, 0, 1.4, 0, 0, 0.25, 0.15];

/**
 * Dense particle buffer drawn as one THREE.Points. Dead particles are swapped
 * with the last live one, so the draw range is exactly the live count.
 */
export class ParticleLayer {
  /**
   * @param {THREE.Object3D} root
   * @param {THREE.Texture} atlas
   * @param {number} capacity
   * @param {boolean} additive
   */
  constructor(root, atlas, capacity, additive) {
    const n = capacity;
    this.cap = n;
    this.count = 0;
    this.additive = additive;
    const F = () => new Float32Array(n);
    this.px = F(); this.py = F(); this.pz = F();
    this.vx = F(); this.vy = F(); this.vz = F();
    this.age = F(); this.life = F();
    this.s0 = F(); this.s1 = F();
    this.r0 = F(); this.g0 = F(); this.b0 = F();
    this.r1 = F(); this.g1 = F(); this.b1 = F();
    this.al = F(); this.grav = F(); this.drag = F();
    this.rot = F(); this.spin = F(); this.fin = F(); this.floor = F();
    this.heat = F();
    this.cell = new Uint8Array(n);
    this.aPos = new Float32Array(n * 3);
    this.aCol = new Float32Array(n * 4);
    this.aPar = new Float32Array(n * 4);
    const geo = new THREE.BufferGeometry();
    this.posAttr = dynAttr(this.aPos, 3);
    this.colAttr = dynAttr(this.aCol, 4);
    this.parAttr = dynAttr(this.aPar, 4);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aParams', this.parAttr);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = makePointsMaterial(atlas, additive);
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 12 : 10;
    this.points.onBeforeRender = pointScaleHook(this.mat);
    this.points.name = additive ? 'vfx-particles-add' : 'vfx-particles-alpha';
    root.add(this.points);
  }

  /** Free slots left. */
  get free() {
    return this.cap - this.count;
  }

  /**
   * Add one particle. Returns its index (valid until the next update) or -1 when full.
   * c = { r, g, b } linear start (and end) color, a = peak alpha, cell = atlas cell.
   */
  add(x, y, z, vx, vy, vz, life, s0, s1, c, a, cell, grav = 0, drag = 0) {
    if (this.count >= this.cap || life <= 0) return -1;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    this.r0[i] = this.r1[i] = c.r; this.g0[i] = this.g1[i] = c.g; this.b0[i] = this.b1[i] = c.b;
    this.al[i] = a; this.grav[i] = grav; this.drag[i] = drag;
    this.rot[i] = 0; this.spin[i] = 0; this.fin[i] = 0.08; this.floor[i] = -1e9;
    this.heat[i] = CELL_HEAT[cell] || 0;
    this.cell[i] = cell;
    return i;
  }

  /** How white-hot (HDR) the centre burns: 0 none, 1 a spark (defaults per cell, CELL_HEAT). */
  setHeat(i, h) {
    if (i >= 0) this.heat[i] = h;
  }

  /** Color the particle fades to over its life. */
  setEnd(i, c) {
    if (i < 0) return;
    this.r1[i] = c.r; this.g1[i] = c.g; this.b1[i] = c.b;
  }

  setSpin(i, rot, spin) {
    if (i < 0) return;
    this.rot[i] = rot; this.spin[i] = spin;
  }

  /** Fraction of the life spent fading in (default 0.08). */
  setFadeIn(i, f) {
    if (i >= 0) this.fin[i] = f;
  }

  /** World height the particle bounces / settles on (debris). */
  setFloor(i, y) {
    if (i >= 0) this.floor[i] = y;
  }

  _kill(i) {
    const j = --this.count;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.r0[i] = this.r0[j]; this.g0[i] = this.g0[j]; this.b0[i] = this.b0[j];
    this.r1[i] = this.r1[j]; this.g1[i] = this.g1[j]; this.b1[i] = this.b1[j];
    this.al[i] = this.al[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j];
    this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j]; this.fin[i] = this.fin[j]; this.floor[i] = this.floor[j];
    this.heat[i] = this.heat[j];
    this.cell[i] = this.cell[j];
  }

  /** Advance and upload. */
  update(dt) {
    const quad = this.additive;
    let i = 0;
    while (i < this.count) {
      const age = this.age[i] + dt;
      const life = this.life[i];
      if (age >= life) {
        this._kill(i);
        continue;
      }
      this.age[i] = age;
      const dr = this.drag[i];
      if (dr > 0) {
        const k = dr * dt < 0.95 ? 1 - dr * dt : 0.05;
        this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      let y = this.py[i] + this.vy[i] * dt;
      if (y < this.floor[i]) {
        y = this.floor[i];
        this.vy[i] = -this.vy[i] * 0.25;
        this.vx[i] *= 0.4; this.vz[i] *= 0.4;
        this.spin[i] *= 0.5;
      }
      this.py[i] = y;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      const t = age / life;
      const fi = this.fin[i];
      const fade = t < fi ? t / fi : quad ? 1 - ((t - fi) / (1 - fi)) ** 2 : 1 - (t - fi) / (1 - fi);
      const p3 = i * 3;
      const p4 = i * 4;
      this.aPos[p3] = this.px[i];
      this.aPos[p3 + 1] = y;
      this.aPos[p3 + 2] = this.pz[i];
      this.aCol[p4] = this.r0[i] + (this.r1[i] - this.r0[i]) * t;
      this.aCol[p4 + 1] = this.g0[i] + (this.g1[i] - this.g0[i]) * t;
      this.aCol[p4 + 2] = this.b0[i] + (this.b1[i] - this.b0[i]) * t;
      this.aCol[p4 + 3] = this.al[i] * fade;
      this.aPar[p4] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.aPar[p4 + 1] = this.rot[i];
      this.aPar[p4 + 2] = this.cell[i];
      this.aPar[p4 + 3] = this.heat[i];
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    if (this.count > 0 || this._lastCount > 0) {
      markRange(this.posAttr, this.count);
      markRange(this.colAttr, this.count);
      markRange(this.parAttr, this.count);
    }
    this._lastCount = this.count;
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Slot-allocated point sprites for glows that follow something (projectile heads, beam ends). */
export class GlowBatch {
  constructor(root, atlas, capacity) {
    this.cap = capacity;
    this.high = 0; // slots in use are < high
    this.freeList = [];
    for (let i = capacity - 1; i >= 0; i--) this.freeList.push(i);
    this.used = new Uint8Array(capacity);
    this.aPos = new Float32Array(capacity * 3);
    this.aCol = new Float32Array(capacity * 4);
    this.aPar = new Float32Array(capacity * 4);
    const geo = new THREE.BufferGeometry();
    this.posAttr = dynAttr(this.aPos, 3);
    this.colAttr = dynAttr(this.aCol, 4);
    this.parAttr = dynAttr(this.aPar, 4);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aParams', this.parAttr);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = makePointsMaterial(atlas, true);
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 13;
    this.points.onBeforeRender = pointScaleHook(this.mat);
    this.points.name = 'vfx-glows';
    root.add(this.points);
    this.active = 0;
  }

  /** @returns {number} slot or -1 */
  alloc() {
    if (!this.freeList.length) return -1;
    const i = this.freeList.pop();
    this.used[i] = 1;
    this.active++;
    if (i + 1 > this.high) this.high = i + 1;
    this.aCol[i * 4 + 3] = 0;
    return i;
  }

  /** Place glow i: world position, size, linear color, alpha, atlas cell, rotation, heat (HDR centre). */
  set(i, x, y, z, size, c, a, cell = 0, rot = 0, heat = 1) {
    if (i < 0) return;
    const p3 = i * 3;
    const p4 = i * 4;
    this.aPos[p3] = x; this.aPos[p3 + 1] = y; this.aPos[p3 + 2] = z;
    this.aCol[p4] = c.r; this.aCol[p4 + 1] = c.g; this.aCol[p4 + 2] = c.b; this.aCol[p4 + 3] = a;
    this.aPar[p4] = size; this.aPar[p4 + 1] = rot; this.aPar[p4 + 2] = cell; this.aPar[p4 + 3] = heat;
  }

  free(i) {
    if (i < 0 || !this.used[i]) return;
    this.used[i] = 0;
    this.active--;
    this.aCol[i * 4 + 3] = 0;
    this.aPar[i * 4] = 0;
    this.freeList.push(i);
    while (this.high > 0 && !this.used[this.high - 1]) this.high--;
  }

  flush() {
    this.geo.setDrawRange(0, this.high);
    if (this.high > 0 || this._lastHigh > 0) {
      markRange(this.posAttr, this.high);
      markRange(this.colAttr, this.high);
      markRange(this.parAttr, this.high);
    }
    this._lastHigh = this.high;
  }

  clear() {
    for (let i = 0; i < this.cap; i++) if (this.used[i]) this.free(i);
    this.flush();
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------- mesh pools

/** Grow-on-demand pool of reusable items with a `.mesh`. */
class MeshPool {
  constructor(root, max, factory) {
    this.root = root;
    this.max = max;
    this.factory = factory;
    this.items = [];
    this.freeItems = [];
    this.active = 0;
  }

  acquire() {
    let it = this.freeItems.pop();
    if (!it) {
      if (this.items.length >= this.max) return null;
      it = this.factory();
      it.mesh.visible = false;
      it.mesh.frustumCulled = false;
      this.items.push(it);
      this.root.add(it.mesh);
    }
    it.mesh.visible = true;
    it.inUse = true;
    this.active++;
    return it;
  }

  release(it) {
    if (!it || !it.inUse) return;
    it.inUse = false;
    it.mesh.visible = false;
    this.active--;
    this.freeItems.push(it);
  }

  dispose() {
    for (const it of this.items) {
      it.mesh.removeFromParent();
      if (it.ownGeo) it.mesh.geometry.dispose();
      it.mesh.material.dispose();
    }
    this.items.length = 0;
    this.freeItems.length = 0;
    this.active = 0;
  }
}

// --- decals: terrain-conforming polar grids

const DECAL_A = 48;
const DECAL_R = 6;
const DECAL_V = (DECAL_A + 1) * (DECAL_R + 1);
const COS = new Float32Array(DECAL_A + 1);
const SIN = new Float32Array(DECAL_A + 1);
for (let i = 0; i <= DECAL_A; i++) {
  COS[i] = Math.cos((i / DECAL_A) * TAU);
  SIN[i] = Math.sin((i / DECAL_A) * TAU);
}

function decalIndex() {
  const idx = [];
  const W = DECAL_A + 1;
  for (let j = 0; j < DECAL_R; j++) {
    for (let i = 0; i < DECAL_A; i++) {
      const a = j * W + i;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
}

const decalUniforms = () => ({
  uColor: { value: new THREE.Vector3(1, 1, 1) },
  uCore: { value: new THREE.Vector3(1, 1, 1) },
  uOpacity: { value: 1 },
  uRing: { value: new THREE.Vector3(0.9, 0.08, 1) },
  uFill: { value: new THREE.Vector3(0, 1, 0) },
  uRunes: { value: 0 },
  uNoise: { value: 0 },
  uCrack: { value: 0 },
  uTime: { value: 0 },
  uSpin: { value: 0 },
  uArc: { value: new THREE.Vector3(0, TAU, 0) },
  uSeed: { value: 0 },
  uOcc: { value: OCCLUSION.decal },
  uEdge: { value: 0 },
});

/** A pooled ground decal. Configure the look with the setters, place it with layout(). */
export class Decal {
  constructor(index, baseMat) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(DECAL_V * 3);
    this.polar = new Float32Array(DECAL_V * 2);
    this.posAttr = dynAttr(this.pos, 3);
    this.polarAttr = dynAttr(this.polar, 2);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aPolar', this.polarAttr);
    geo.setIndex(index);
    this.mat = baseMat.clone();
    this.u = this.mat.uniforms;
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 5;
    this.ownGeo = true;
    this.inUse = false;
  }

  /** Reset to a plain additive ring. */
  reset(additive = true) {
    const u = this.u;
    u.uOpacity.value = 1;
    u.uRing.value.set(0.9, 0.08, 1);
    u.uFill.value.set(0, 1, 0);
    u.uRunes.value = 0;
    u.uNoise.value = 0;
    u.uCrack.value = 0;
    u.uEdge.value = 0;
    u.uTime.value = 0;
    u.uSpin.value = 0;
    u.uSeed.value = Math.random() * 10;
    u.uOcc.value = additive ? OCCLUSION.decal : 1;
    this.mesh.renderOrder = additive ? 6 : 4;
    return this;
  }

  /** Linear colors (vfx-palette.js). */
  color(c, core) {
    this.u.uColor.value.set(c.r, c.g, c.b);
    const k = core || c;
    this.u.uCore.value.set(k.r, k.g, k.b);
    return this;
  }

  /**
   * Lay the grid on the terrain: annulus rIn..rOut around (cx, cy) (sim coords),
   * optionally a sector a0..a0+aLen. flatY puts it at a fixed world height instead.
   */
  layout(getHeight, cx, cy, rOut, rIn = 0, a0 = 0, aLen = TAU, lift = 0.06, flatY = null) {
    const full = aLen >= TAU - 1e-4;
    const flat = flatY !== null;
    const W = DECAL_A + 1;
    const pos = this.pos;
    const polar = this.polar;
    if (rOut < 0.01) rOut = 0.01;
    if (rIn > rOut) rIn = rOut;
    for (let j = 0; j <= DECAL_R; j++) {
      const rad = rIn + ((rOut - rIn) * j) / DECAL_R;
      const nr = rad / rOut;
      for (let i = 0; i <= DECAL_A; i++) {
        let c;
        let s;
        if (full) {
          c = COS[i];
          s = SIN[i];
        } else {
          const ang = a0 + (aLen * i) / DECAL_A;
          c = Math.cos(ang);
          s = Math.sin(ang);
        }
        const wx = cx + c * rad;
        const wy = cy + s * rad;
        const k = j * W + i;
        pos[k * 3] = wx;
        // two separate stores: a `flatY === null ? h : flatY` select merged a
        // number with a maybe-null value and boxed every sampled height
        if (flat) pos[k * 3 + 1] = flatY;
        else pos[k * 3 + 1] = getHeight(wx, wy) + lift;
        pos[k * 3 + 2] = wy;
        polar[k * 2] = i / DECAL_A;
        polar[k * 2 + 1] = nr;
      }
    }
    this.posAttr.needsUpdate = true;
    this.polarAttr.needsUpdate = true;
    this.u.uArc.value.set(full ? 0 : a0, full ? TAU : aLen, full ? 0 : 1);
    return this;
  }
}

export function createDecalPool(root, max) {
  const index = decalIndex();
  const base = glowBlend(new THREE.ShaderMaterial({
    uniforms: decalUniforms(),
    vertexShader: DECAL_VS,
    fragmentShader: DECAL_FS,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  }));
  const pool = new MeshPool(root, max, () => new Decal(index, base));
  pool.baseMat = base;
  return pool;
}

// --- ribbons: camera-facing strips along a polyline

export const RIBBON_MAX = 24;

export class Ribbon {
  constructor(index, baseMat) {
    const M = RIBBON_MAX;
    this.pts = new Float32Array(M * 3);
    this.wid = new Float32Array(M);
    this.pos = new Float32Array(M * 6);
    this.dir = new Float32Array(M * 6);
    this.suw = new Float32Array(M * 6);
    for (let i = 0; i < M; i++) {
      this.suw[i * 6] = -1;
      this.suw[i * 6 + 3] = 1;
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = dynAttr(this.pos, 3);
    this.dirAttr = dynAttr(this.dir, 3);
    this.suwAttr = dynAttr(this.suw, 3);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aDir', this.dirAttr);
    geo.setAttribute('aSUW', this.suwAttr);
    geo.setIndex(index);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = baseMat.clone();
    this.u = this.mat.uniforms;
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 14;
    this.ownGeo = true;
    this.inUse = false;
    this.n = 0;
  }

  reset() {
    this.u.uOpacity.value = 1;
    this.u.uStripes.value = 0;
    this.u.uTime.value = 0;
    this.u.uFade.value.set(0.06, 0.06);
    this.u.uWidth.value = 0.3;
    this.u.uHot.value = 1;
    this.n = 0;
    this.geo.setDrawRange(0, 0);
    return this;
  }

  /** Linear colors (vfx-palette.js). */
  color(c, core) {
    this.u.uColor.value.set(c.r, c.g, c.b);
    const k = core || c;
    this.u.uCore.value.set(k.r, k.g, k.b);
    return this;
  }

  /** Set point i (world coords) with a width multiplier. */
  set(i, x, y, z, w = 1) {
    const p = i * 3;
    this.pts[p] = x;
    this.pts[p + 1] = y;
    this.pts[p + 2] = z;
    this.wid[i] = w;
  }

  /** Upload the first n points. */
  commit(n) {
    if (n > RIBBON_MAX) n = RIBBON_MAX;
    this.n = n;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    const P = this.pts;
    let total = 0;
    for (let i = 1; i < n; i++) {
      const dx = P[i * 3] - P[i * 3 - 3];
      const dy = P[i * 3 + 1] - P[i * 3 - 2];
      const dz = P[i * 3 + 2] - P[i * 3 - 1];
      total += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    if (total < 1e-6) total = 1e-6;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? i - 1 : 0;
      const b = i < n - 1 ? i + 1 : n - 1;
      const dx = P[b * 3] - P[a * 3];
      const dy = P[b * 3 + 1] - P[a * 3 + 1];
      const dz = P[b * 3 + 2] - P[a * 3 + 2];
      if (i > 0) {
        const ex = P[i * 3] - P[i * 3 - 3];
        const ey = P[i * 3 + 1] - P[i * 3 - 2];
        const ez = P[i * 3 + 2] - P[i * 3 - 1];
        acc += Math.sqrt(ex * ex + ey * ey + ez * ez);
      }
      const u = acc / total;
      const v = i * 6;
      for (let k = 0; k < 2; k++) {
        const o = v + k * 3;
        this.pos[o] = P[i * 3];
        this.pos[o + 1] = P[i * 3 + 1];
        this.pos[o + 2] = P[i * 3 + 2];
        this.dir[o] = dx;
        this.dir[o + 1] = dy;
        this.dir[o + 2] = dz;
        this.suw[o + 1] = u;
        this.suw[o + 2] = this.wid[i];
      }
    }
    this.posAttr.needsUpdate = true;
    this.dirAttr.needsUpdate = true;
    this.suwAttr.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }
}

export function createRibbonPool(root, max) {
  const idx = [];
  for (let i = 0; i < RIBBON_MAX - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const index = new THREE.BufferAttribute(new Uint16Array(idx), 1);
  const base = glowBlend(new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(1, 1, 1) },
      uCore: { value: new THREE.Vector3(1, 1, 1) },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uStripes: { value: 0 },
      uFade: { value: new THREE.Vector2(0.06, 0.06) },
      uWidth: { value: 0.3 },
      uHot: { value: 1 },
      uOcc: { value: OCCLUSION.ribbon },
    },
    vertexShader: RIBBON_VS,
    fragmentShader: RIBBON_FS,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  const pool = new MeshPool(root, max, () => new Ribbon(index, base));
  pool.baseMat = base;
  return pool;
}

// --- flares: big camera-facing glows (too large for point sprites)

/** Default HDR gain of a flare's white-hot core (uHot); set again on every acquire, pooled flares keep the last value. */
export const FLARE_HOT = 3.5;

export function createFlarePool(root, max) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const base = glowBlend(new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(1, 1, 1) },
      uCore: { value: new THREE.Vector3(1, 1, 1) },
      uOpacity: { value: 1 },
      uSize: { value: 1 },
      uRays: { value: 0 },
      uSpin: { value: 0 },
      uHot: { value: FLARE_HOT },
      uOcc: { value: OCCLUSION.flare },
    },
    vertexShader: FLARE_VS,
    fragmentShader: FLARE_FS,
    transparent: true,
    depthWrite: false,
  }));
  const pool = new MeshPool(root, max, () => {
    const mat = base.clone();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 15;
    return { mesh, u: mat.uniforms, inUse: false };
  });
  pool.sharedGeo = geo;
  pool.baseMat = base;
  return pool;
}

// --- pillars: open cylinders of light

export function createPillarPool(root, max) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
  geo.translate(0, 0.5, 0);
  const base = glowBlend(new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(1, 1, 1) },
      uCore: { value: new THREE.Vector3(1, 1, 1) },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uHot: { value: 2 },
      uOcc: { value: OCCLUSION.pillar },
    },
    vertexShader: FRESNEL_VS,
    fragmentShader: PILLAR_FS,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  const pool = new MeshPool(root, max, () => {
    const mat = base.clone();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 11;
    return { mesh, u: mat.uniforms, inUse: false };
  });
  pool.sharedGeo = geo;
  pool.baseMat = base;
  return pool;
}

// --- domes: translucent shield hemispheres

export function createDomePool(root, max) {
  const geo = new THREE.SphereGeometry(1, 28, 12, 0, TAU, 0, Math.PI / 2);
  const base = glowBlend(new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(1, 1, 1) },
      uCore: { value: new THREE.Vector3(1, 1, 1) },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uOcc: { value: OCCLUSION.dome },
    },
    vertexShader: FRESNEL_VS,
    fragmentShader: DOME_FS,
    transparent: true,
    depthWrite: false,
  }));
  const pool = new MeshPool(root, max, () => {
    const mat = base.clone();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 9;
    return { mesh, u: mat.uniforms, inUse: false };
  });
  pool.sharedGeo = geo;
  pool.baseMat = base;
  return pool;
}

/** Dispose a pool and its shared resources. */
export function disposePool(pool) {
  pool.dispose();
  if (pool.sharedGeo) pool.sharedGeo.dispose();
  if (pool.baseMat) pool.baseMat.dispose();
}

// ---------------------------------------------------------------- lights

const EMITTERS = 64;
const SOURCES = 48;
const SOURCE_KEY = 1e12; // keys of per-frame sources sit above every emitter key
const FADE_RATE = 40; // 1/s: how fast a light follows its source and hands over

/**
 * Dynamic point lights for the VFX. The pool owns a fixed set of PointLights
 * (no shadows); `count` of them are in the scene. The light count is part of
 * every lit material's shader program, so it only changes through setCount()
 * (when the renderer rebuilds every shader anyway) and idle lights just sit at
 * intensity 0. Emitters are requested freely, either
 * flashes with an envelope (strikes, explosions, level ups) or held lights
 * that follow something until released (a fireball's head, a beam's end);
 * per-frame sources (burning buildings) are offered anew every frame. update()
 * hands the lights to the strongest candidates near the camera focus, keeps a
 * light on the same source while it stays in the top set (incumbents get a
 * bonus, so two similar sources do not make it flip) and fades a light out
 * before it moves to another source. Allocation-free.
 *
 *   const pool = new LightPool(root, 4);
 *   pool.flash(x, y, z, color, 15, 8, 0.6);        // a strike
 *   const h = pool.hold(x, y, z, color, 5, 5);      // a fireball's head …
 *   pool.move(h, x, y, z); pool.release(h);         // … follows it, then fades out
 *   pool.offer(id, x, y, z, r, g, b, 4, 6, 0.6);    // a burning building, this frame
 *   pool.update(dt, focusX, focusY, focusRadius, 1);
 */
export class LightPool {
  /**
   * @param {THREE.Object3D} root
   * @param {number} capacity lights owned (built up front)
   * @param {number} [count] of them in the scene (0 = none: the pool accepts requests and does nothing)
   */
  constructor(root, capacity, count = capacity) {
    this.root = root;
    this.count = 0;
    this.lights = [];
    for (let i = 0; i < Math.max(0, capacity | 0); i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 2);
      l.castShadow = false;
      l.name = 'vfx-light';
      this.lights.push(l);
    }
    const N = Math.max(1, this.lights.length);
    this.key = new Float64Array(N).fill(-1);
    this.cur = new Float32Array(N);
    this.want = new Int16Array(N);
    this.top = new Int16Array(N);
    const n = EMITTERS;
    const F = () => new Float32Array(n);
    this.ex = F(); this.ey = F(); this.ez = F();
    this.er = F(); this.eg = F(); this.eb = F();
    this.ePeak = F(); this.eRange = F(); this.eFlick = F();
    this.eAge = F(); this.eLife = F(); this.eAttack = F();
    this.eDecay = F(); // age at which the fade-out starts
    this.eState = new Uint8Array(n); // 0 free, 1 flash (fades out over its life), 2 held
    this.eGen = new Float64Array(n);
    this.freeList = new Int16Array(n);
    for (let i = 0; i < n; i++) this.freeList[i] = n - 1 - i;
    this.nFree = n;
    const m = SOURCES;
    const G = () => new Float32Array(m);
    this.sx = G(); this.sy = G(); this.sz = G();
    this.sr = G(); this.sg = G(); this.sb = G();
    this.sI = G(); this.sRange = G(); this.sW = G();
    this.sKey = new Float64Array(m);
    this.ns = 0;
    const c = n + m;
    this.cKey = new Float64Array(c);
    this.cScore = new Float32Array(c);
    this.cI = new Float32Array(c);
    this.cRef = new Int16Array(c); // >= 0 emitter index, < 0: source -1 - ref
    this.time = 0;
    this.lit = 0;
    this.setCount(count);
  }

  /**
   * Put the first n lights in the scene and take the rest out (dark). This
   * changes every lit shader's light count, so the caller does it only when
   * all the shaders are being rebuilt anyway (VFXSystem.setQuality).
   */
  setCount(n) {
    n = Math.min(this.lights.length, Math.max(0, n | 0));
    if (n === this.count) return;
    for (let j = 0; j < this.lights.length; j++) {
      const l = this.lights[j];
      if (j < n) {
        if (l.parent !== this.root) this.root.add(l);
      } else {
        l.removeFromParent();
        l.intensity = 0;
        this.cur[j] = 0;
        this.key[j] = -1;
      }
    }
    this.count = n;
  }

  /** A flash: rises over `attack` s, then fades out (quadratic) until `life`. Returns its index or -1. */
  flash(x, y, z, c, intensity, range, life, attack = 0.04, flicker = 0) {
    if (!this.count || !(intensity > 0) || !(life > 0)) return -1;
    const i = this.alloc(x, y, z, c, intensity, range, flicker);
    if (i < 0) return -1;
    this.eState[i] = 1;
    this.eLife[i] = life;
    this.eAttack[i] = Math.min(attack, life * 0.5);
    this.eDecay[i] = this.eAttack[i];
    return i;
  }

  /** A light that stays on (follow it with move()) until release(). Returns its index or -1. */
  hold(x, y, z, c, intensity, range, attack = 0.08, flicker = 0) {
    if (!this.count || !(intensity > 0)) return -1;
    const i = this.alloc(x, y, z, c, intensity, range, flicker);
    if (i < 0) return -1;
    this.eState[i] = 2;
    this.eLife[i] = 0;
    this.eAttack[i] = attack;
    this.eDecay[i] = 0;
    return i;
  }

  move(i, x, y, z) {
    if (i < 0 || !this.eState[i]) return;
    this.ex[i] = x;
    this.ey[i] = y;
    this.ez[i] = z;
  }

  /** Let a held light fade out over `fade` seconds (it frees itself). */
  release(i, fade = 0.15) {
    if (i < 0 || this.eState[i] !== 2) return;
    this.eState[i] = 1;
    this.eDecay[i] = this.eAge[i];
    this.eLife[i] = this.eAge[i] + Math.max(0.01, fade);
  }

  /**
   * A light source for this frame only (key: stable id, so it keeps its light).
   * Color is linear; weight scales its priority (not its intensity), so steady
   * sources can yield to the flashes of a fight.
   */
  offer(key, x, y, z, r, g, b, intensity, range, weight = 1) {
    if (!this.count || this.ns >= SOURCES || !(intensity > 0)) return;
    const s = this.ns++;
    this.sKey[s] = key;
    this.sx[s] = x; this.sy[s] = y; this.sz[s] = z;
    const k = 1 / Math.max(r, g, b, 1e-4);
    this.sr[s] = r * k; this.sg[s] = g * k; this.sb[s] = b * k;
    this.sI[s] = intensity;
    this.sW[s] = weight;
    this.sRange[s] = range;
  }

  alloc(x, y, z, c, intensity, range, flicker) {
    if (!this.nFree) return -1;
    const i = this.freeList[--this.nFree];
    this.eGen[i]++;
    this.ex[i] = x; this.ey[i] = y; this.ez[i] = z;
    // store the hue at full brightness; the intensity says how bright
    const k = 1 / Math.max(c.r, c.g, c.b, 1e-4);
    this.er[i] = c.r * k; this.eg[i] = c.g * k; this.eb[i] = c.b * k;
    this.ePeak[i] = intensity;
    this.eRange[i] = range;
    this.eFlick[i] = flicker;
    this.eAge[i] = 0;
    return i;
  }

  kill(i) {
    this.eState[i] = 0;
    this.freeList[this.nFree++] = i;
  }

  /** Current intensity of emitter i. */
  level(i) {
    const a = this.eAge[i];
    const at = this.eAttack[i];
    let k = at > 0 && a < at ? a / at : 1;
    if (this.eState[i] === 1 && a > this.eDecay[i]) {
      const u = Math.min(1, (a - this.eDecay[i]) / Math.max(1e-3, this.eLife[i] - this.eDecay[i]));
      k *= (1 - u) * (1 - u);
    }
    const f = this.eFlick[i];
    if (f > 0) k *= 1 + f * (0.6 * Math.sin(this.time * 31 + i * 2.1) + 0.4 * Math.sin(this.time * 17.3 + i));
    return this.ePeak[i] * k;
  }

  /** Score one candidate (strength × weight, how near the focus, incumbency) and append it. */
  candidate(nc, key, I, w, x, z, fx, fy, fr, ref) {
    let rel = 1;
    if (Number.isFinite(fx) && Number.isFinite(fy)) {
      const d = Math.hypot(x - fx, z - fy);
      rel = d <= fr ? 1 : d >= 2 * fr ? 0 : 2 - d / fr;
    }
    if (rel <= 0) return nc;
    let score = I * w * rel;
    for (let j = 0; j < this.count; j++) {
      if (this.key[j] === key) {
        score *= 1.35;
        break;
      }
    }
    this.cKey[nc] = key;
    this.cScore[nc] = score;
    this.cI[nc] = I;
    this.cRef[nc] = ref;
    return nc + 1;
  }

  /**
   * Age the emitters, consume this frame's sources and drive the lights.
   * @param {number} dt seconds
   * @param {number} fx camera focus (sim x; NaN = no preference)
   * @param {number} fy camera focus (sim y)
   * @param {number} fr radius around the focus where everything is relevant
   * @param {number} scale intensity multiplier (0 = lights off, e.g. low quality)
   */
  update(dt, fx, fy, fr, scale) {
    this.time += dt;
    let nc = 0;
    for (let i = 0; i < EMITTERS; i++) {
      const st = this.eState[i];
      if (!st) continue;
      this.eAge[i] += dt;
      if (st === 1 && this.eAge[i] >= this.eLife[i]) {
        this.kill(i);
        continue;
      }
      const I = this.level(i);
      if (I > 0.02) nc = this.candidate(nc, this.eGen[i] * EMITTERS + i, I, 1, this.ex[i], this.ez[i], fx, fy, fr, i);
    }
    for (let s = 0; s < this.ns; s++) nc = this.candidate(nc, SOURCE_KEY + this.sKey[s], this.sI[s], this.sW[s], this.sx[s], this.sz[s], fx, fy, fr, -1 - s);
    const N = this.count;
    // the N best candidates, best first
    let t = 0;
    for (let c = 0; c < nc; c++) {
      const sc = this.cScore[c];
      if (t === N && (N === 0 || sc <= this.cScore[this.top[t - 1]])) continue;
      let k = t < N ? t++ : t - 1;
      while (k > 0 && this.cScore[this.top[k - 1]] < sc) {
        this.top[k] = this.top[k - 1];
        k--;
      }
      this.top[k] = c;
    }
    // lights keep their source when it is still wanted; the rest go to the dimmest free lights
    for (let j = 0; j < N; j++) this.want[j] = -1;
    for (let k = 0; k < t; k++) {
      const key = this.cKey[this.top[k]];
      for (let j = 0; j < N; j++) {
        if (this.key[j] === key) {
          this.want[j] = this.top[k];
          this.top[k] = -1;
          break;
        }
      }
    }
    for (let k = 0; k < t; k++) {
      const c = this.top[k];
      if (c < 0) continue;
      let best = -1;
      for (let j = 0; j < N; j++) if (this.want[j] < 0 && (best < 0 || this.cur[j] < this.cur[best])) best = j;
      if (best >= 0) this.want[best] = c;
    }
    const follow = 1 - Math.exp(-dt * FADE_RATE);
    const out = Math.exp(-dt * FADE_RATE);
    let lit = 0;
    for (let j = 0; j < N; j++) {
      const c = this.want[j];
      if (c >= 0 && this.key[j] === this.cKey[c]) {
        this.place(j, c);
        this.cur[j] += (this.cI[c] - this.cur[j]) * follow;
      } else if (this.cur[j] > 0.05) {
        this.cur[j] *= out; // hand-over: the old source fades out where it was
      } else if (c >= 0) {
        this.key[j] = this.cKey[c];
        this.place(j, c);
        this.cur[j] += (this.cI[c] - this.cur[j]) * follow;
      } else {
        this.cur[j] = 0;
        this.key[j] = -1;
      }
      this.lights[j].intensity = this.cur[j] * scale;
      if (this.cur[j] * scale > 0.01) lit++;
    }
    this.lit = lit;
    this.ns = 0;
  }

  place(j, c) {
    const l = this.lights[j];
    const ref = this.cRef[c];
    if (ref >= 0) {
      l.position.set(this.ex[ref], this.ey[ref], this.ez[ref]);
      l.color.setRGB(this.er[ref], this.eg[ref], this.eb[ref]);
      l.distance = this.eRange[ref];
    } else {
      const s = -1 - ref;
      l.position.set(this.sx[s], this.sy[s], this.sz[s]);
      l.color.setRGB(this.sr[s], this.sg[s], this.sb[s]);
      l.distance = this.sRange[s];
    }
  }

  /** Drop every emitter and source; the lights go dark at once. */
  clear() {
    for (let i = 0; i < EMITTERS; i++) if (this.eState[i]) this.kill(i);
    this.ns = 0;
    for (let j = 0; j < this.lights.length; j++) {
      this.cur[j] = 0;
      this.key[j] = -1;
      this.lights[j].intensity = 0;
    }
    this.lit = 0;
  }

  dispose() {
    for (const l of this.lights) {
      l.removeFromParent();
      l.dispose();
    }
    this.lights.length = 0;
    this.count = 0;
  }
}
