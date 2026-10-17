// Low-level drawing layers for the VFX system. Everything here is pooled and
// preallocated: particles live in typed arrays drawn as one THREE.Points per
// blend mode, persistent glows in a slot batch, and decals / ribbons / flares /
// pillars / domes are reusable meshes with their own material clones (shared
// geometry or preallocated buffers). Custom shaders work in sRGB directly, so
// colors are plain { r, g, b } in 0..1.
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

const COVER_GLSL = /* glsl */ `
float vfxCover(vec3 c) { return clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0); }`;

// ---------------------------------------------------------------- shaders

const POINT_VS = /* glsl */ `
attribute vec4 aColor;
attribute vec3 aParams; // world size, rotation, atlas cell
uniform float uScale;
uniform float uMaxSize;
varying vec4 vColor;
varying vec2 vCell;
varying vec2 vRot;
varying float vHot;
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
  // only glow / star / spark sprites get a white-hot centre; smoke, flames, rings and shards keep their color
  vHot = (aParams.z < 1.5 || abs(aParams.z - 3.0) < 0.5) ? 1.0 : 0.0;
}`;

const POINT_FS = /* glsl */ `
uniform sampler2D uMap;
uniform float uCore;
uniform float uOcc;
varying vec4 vColor;
varying vec2 vCell;
varying vec2 vRot;
varying float vHot;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  p = vec2(vRot.x * p.x - vRot.y * p.y, vRot.y * p.x + vRot.x * p.y) + 0.5;
  vec4 t = texture2D(uMap, (vCell + clamp(p, 0.004, 0.996)) * vec2(0.25, 0.5));
  float a = t.a * vColor.a;
  if (a < 0.003) discard;
  vec3 c = mix(vColor.rgb * t.rgb, vec3(1.0), t.a * t.a * t.a * uCore * vHot);
  gl_FragColor = vec4(c * a, a * uOcc);
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
uniform float uOcc;
uniform float uEdge;  // ragged outline amount (clouds, smoke underlays)
varying vec2 vP;
${NOISE_GLSL}
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
  float A = clamp(a, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col * A, A * uOcc);
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

const RIBBON_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uTime;
uniform float uStripes;
uniform vec2 uFade;
uniform float uOcc;
varying vec2 vUv;
${COVER_GLSL}
void main() {
  float v = abs(vUv.y);
  float core = exp(-v * v * 20.0);
  float halo = (1.0 - v) * (1.0 - v);
  float ends = smoothstep(0.0, uFade.x, vUv.x) * (1.0 - smoothstep(1.0 - uFade.y, 1.0, vUv.x));
  float st = 1.0 - uStripes * (0.5 + 0.5 * sin(vUv.x * 34.0 - uTime * 16.0));
  vec3 col = uColor * halo * 0.9 * st + uCore * core;
  col *= uOpacity * ends;
  gl_FragColor = vec4(col, vfxCover(col) * uOcc);
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

const FLARE_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uRays;
uniform float uSpin;
uniform float uOcc;
varying vec2 vUv;
${COVER_GLSL}
void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  float e = 1.0 - d;
  float glow = exp(-d * d * 5.0) * e;
  float core = exp(-d * d * 34.0);
  float a = atan(vUv.y, vUv.x) + uSpin;
  float rays = uRays * (pow(abs(cos(a * 4.0)), 14.0) * e * e + 0.55 * pow(abs(cos(a * 4.0 + 0.3927)), 24.0) * e * e * e);
  vec3 col = uColor * (glow + rays) + uCore * core;
  col *= uOpacity;
  gl_FragColor = vec4(col, vfxCover(col) * uOcc);
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
uniform float uOcc;
varying vec2 vUv;
varying float vF;
${COVER_GLSL}
void main() {
  float y = vUv.y;
  float fade = pow(1.0 - y, 1.5) * smoothstep(0.0, 0.05, y);
  float edge = 0.3 + 0.7 * pow(1.0 - vF, 1.8);
  float s1 = 0.5 + 0.5 * sin(vUv.x * 37.699 + y * 9.0 - uTime * 6.0);
  float s2 = 0.5 + 0.5 * sin(vUv.x * 18.85 - y * 5.0 + uTime * 3.1);
  float streak = 0.55 + 0.45 * s1 * s2;
  vec3 col = uColor * edge * streak + uCore * pow(vF, 3.0) * 0.55 * (1.0 - y);
  col *= fade * uOpacity;
  gl_FragColor = vec4(col, vfxCover(col) * uOcc);
}`;

const DOME_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uTime;
uniform float uOcc;
varying vec2 vUv;
varying float vF;
${COVER_GLSL}
void main() {
  float rim = pow(1.0 - vF, 2.2);
  float lon = smoothstep(0.86, 1.0, abs(sin(vUv.x * 3.14159 * 10.0)));
  float lat = smoothstep(0.86, 1.0, abs(sin(vUv.y * 3.14159 * 6.0)));
  float scan = smoothstep(0.0, 0.06, 0.06 - abs(fract(vUv.y * 1.5 - uTime * 0.6) - 0.5) + 0.0);
  float base = smoothstep(0.0, 0.08, vUv.y) ;
  float grid = (lon + lat) * 0.22;
  vec3 col = uColor * (0.1 + rim * 1.05 + grid * (0.35 + rim) + scan * 0.35) + uCore * pow(rim, 5.0) * 0.6;
  col *= uOpacity * (0.4 + 0.6 * base);
  gl_FragColor = vec4(col, vfxCover(col) * uOcc);
}`;

// ---------------------------------------------------------------- helpers

const tmpV2 = new THREE.Vector2();
let maxPointSize = 0;

function makePointsMaterial(map, additive) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uScale: { value: 800 },
      uMaxSize: { value: 256 },
      uCore: { value: additive ? 0.55 : 0 },
      uOcc: { value: additive ? OCCLUSION.points : 1 },
    },
    vertexShader: POINT_VS,
    fragmentShader: POINT_FS,
    transparent: true,
    depthWrite: false,
  });
  return glowBlend(mat);
}

/** onBeforeRender hook: point size scale from the viewport and camera. */
function pointScaleHook(mat) {
  return (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(tmpV2);
    const proj = camera.projectionMatrix.elements[5] || 1;
    mat.uniforms.uScale.value = tmpV2.y * proj * 0.5;
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
    this.cell = new Uint8Array(n);
    this.aPos = new Float32Array(n * 3);
    this.aCol = new Float32Array(n * 4);
    this.aPar = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    this.posAttr = dynAttr(this.aPos, 3);
    this.colAttr = dynAttr(this.aCol, 4);
    this.parAttr = dynAttr(this.aPar, 3);
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
   * c = { r, g, b } start (and end) color, a = peak alpha, cell = atlas cell.
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
    this.cell[i] = cell;
    return i;
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
      this.aPar[p3] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.aPar[p3 + 1] = this.rot[i];
      this.aPar[p3 + 2] = this.cell[i];
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
    this.aPar = new Float32Array(capacity * 3);
    const geo = new THREE.BufferGeometry();
    this.posAttr = dynAttr(this.aPos, 3);
    this.colAttr = dynAttr(this.aCol, 4);
    this.parAttr = dynAttr(this.aPar, 3);
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

  set(i, x, y, z, size, c, a, cell = 0, rot = 0) {
    if (i < 0) return;
    const p3 = i * 3;
    const p4 = i * 4;
    this.aPos[p3] = x; this.aPos[p3 + 1] = y; this.aPos[p3 + 2] = z;
    this.aCol[p4] = c.r; this.aCol[p4 + 1] = c.g; this.aCol[p4 + 2] = c.b; this.aCol[p4 + 3] = a;
    this.aPar[p3] = size; this.aPar[p3 + 1] = rot; this.aPar[p3 + 2] = cell;
  }

  free(i) {
    if (i < 0 || !this.used[i]) return;
    this.used[i] = 0;
    this.active--;
    this.aCol[i * 4 + 3] = 0;
    this.aPar[i * 3] = 0;
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
        pos[k * 3 + 1] = flatY === null ? getHeight(wx, wy) + lift : flatY;
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
    this.n = 0;
    this.geo.setDrawRange(0, 0);
    return this;
  }

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
