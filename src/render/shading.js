// Shared lighting for the game view (DESIGN 8): the key light's direction, a
// procedural sky turned into an image-based-lighting environment (PMREM) so
// physically based materials (metal, polished stone, lacquer) have something
// to reflect, drifting cloud shadows and a rim light, plus the one shader
// patch every lit world material uses to get them.
//
//   const env = createEnvironment(webglRenderer);   // { texture, update(state), dispose } or null in Node
//   scene.environment = env.texture;
//   patchWorldMaterial(material, { rim: 0.35, cloud: true });   // before patchFowMaterial
//   WORLD_UNIFORMS.uTime.value = t;                              // once per frame
//   applyAtmosphere(atmosphere.state);                           // once per frame: the time of day
//
// The uniforms are module-level (like the fog of war's) so cached materials
// that outlive one match keep working in the next. They are shared objects
// rewritten in place every frame: read them by reference (never clone them,
// never replace `.value`).
//
// Time of day (atmosphere.js): the *key light* is the sun by day and the moon
// at night. SUN_DIR / uSunDirW point toward it and uSunColor is its radiance
// (hue × intensity, linear), so a shader that shades with those two follows the
// sun, the golden hour and the moonlight without knowing which it is.
import * as THREE from 'three';
import { createState, resolveHour, START_HOUR } from './atmosphere.js';

const INITIAL = resolveHour(createState(), START_HOUR);

/**
 * Unit vector toward the key light (the sun by day, the moon at night), world
 * space, never below MIN_KEY_ELEVATION. One live object: it is rewritten in place
 * every frame (and is the very vector behind WORLD_UNIFORMS.uSunDirW), so a
 * `.clone()` taken at construction goes stale.
 */
export const SUN_DIR = INITIAL.keyDir.clone();

/** Tileable value-noise texture (R channel), shared by cloud shadows and the fog shroud. */
function makeCloudTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const hash = (x, y, s) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const per = (x, y, s, p) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const m = (v) => ((v % p) + p) % p;
    const a = hash(m(x0), m(y0), s);
    const b = hash(m(x0 + 1), m(y0), s);
    const c = hash(m(x0), m(y0 + 1), s);
    const d = hash(m(x0 + 1), m(y0 + 1), s);
    return a + (b - a) * sx + (c - a + (d - c - b + a) * sx) * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.5;
      let norm = 0;
      for (let o = 0; o < 4; o++) {
        const p = 4 << o;
        v += per((x / size) * p, (y / size) * p, 31 + o, p) * amp;
        norm += amp;
        amp *= 0.5;
      }
      v /= norm;
      const g = Math.round(Math.max(0, Math.min(1, v)) * 255);
      const i = (y * size + x) * 4;
      // R: fbm (clouds), G: a second, offset field for the fog shroud
      data[i] = g;
      data[i + 1] = Math.round(per((x / size) * 8 + 3.1, (y / size) * 8 + 1.7, 47, 8) * 255);
      data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'cloud-noise';
  tex.needsUpdate = true;
  return tex;
}

export const CLOUD_TEXTURE = makeCloudTexture();

/**
 * Uniforms shared by every patched world material. uCloud: x = strength
 * (0 = off), y = 1 / scale (tiles), zw = drift (tiles / s).
 *   uSunDirW / uSunColor    the key light: direction toward it, linear radiance (hue × intensity)
 *   uMoonDirW / uMoonColor  the moon alone (color is black unless the moon is the key light)
 *   uSkyZenith / uSkyHorizon  the sky overhead and at the horizon (the horizon color is the haze)
 *   uSkyAmbient / uGroundAmbient  what the hemisphere light adds (color × intensity)
 *   uRimColor               silhouette light, follows the time of day
 *   uNight                  0 day .. 1 deep night; uLamp 0..1 how brightly lanterns and windows glow
 */
export const WORLD_UNIFORMS = {
  uTime: { value: 0 },
  uCloudTex: { value: CLOUD_TEXTURE },
  uCloud: { value: new THREE.Vector4(0.34, 1 / 34, 0.55, 0.32) },
  uSunDirW: { value: SUN_DIR },
  uSunColor: { value: INITIAL.keyColor.clone() },
  uMoonDirW: { value: INITIAL.moonDir.clone() },
  uMoonColor: { value: INITIAL.moonColor.clone() },
  uSkyZenith: { value: INITIAL.skyZenith.clone() },
  uSkyHorizon: { value: INITIAL.skyHorizon.clone() },
  uSkyAmbient: { value: INITIAL.ambientSky.clone() },
  uGroundAmbient: { value: INITIAL.ambientGround.clone() },
  uRimColor: { value: INITIAL.rimColor.clone() },
  uNight: { value: INITIAL.night },
  uLamp: { value: INITIAL.lamp },
};

let cloudBase = 0.34;
let cloudScale = INITIAL.cloudScale;

/** Cloud shadows on or off (quality), strength 0..1; the time of day scales it. */
export function setCloudShadows(strength) {
  cloudBase = strength;
  WORLD_UNIFORMS.uCloud.value.x = strength * cloudScale;
}

/**
 * Copy a resolved time of day (atmosphere.js) into the shared uniforms. Call once
 * per frame, before drawing.
 * @param {import('./atmosphere.js').AtmosphereState} s
 */
export function applyAtmosphere(s) {
  const U = WORLD_UNIFORMS;
  SUN_DIR.copy(s.keyDir);
  U.uSunColor.value.copy(s.keyColor);
  U.uMoonDirW.value.copy(s.moonDir);
  U.uMoonColor.value.copy(s.moonColor);
  U.uSkyZenith.value.copy(s.skyZenith);
  U.uSkyHorizon.value.copy(s.skyHorizon);
  U.uSkyAmbient.value.copy(s.ambientSky);
  U.uGroundAmbient.value.copy(s.ambientGround);
  U.uRimColor.value.copy(s.rimColor);
  U.uNight.value = s.night;
  U.uLamp.value = s.lamp;
  cloudScale = s.cloudScale;
  U.uCloud.value.x = cloudBase * cloudScale;
}

const DIR_LIGHT_LINE = 'getDirectionalLightInfo( directionalLight, directLight );';
// The first light evaluation in three's light loop: the point lights'.
const POINT_LIGHT_DIRECT = 'RE_Direct( directLight, geometryPosition';
const PARS_VERTEX = 'varying vec3 vWorldPos;';
const VERTEX = `
{
  vec4 wpP = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    wpP = batchingMatrix * wpP;
  #endif
  #ifdef USE_INSTANCING
    wpP = instanceMatrix * wpP;
  #endif
  vWorldPos = ( modelMatrix * wpP ).xyz;
}`;

export const WORLD_PARS_FRAGMENT = `
varying vec3 vWorldPos;
uniform float uTime;
uniform sampler2D uCloudTex;
uniform vec4 uCloud;
uniform vec3 uSunDirW;
uniform vec3 uRimColor;
float cloudShade( vec3 wp ) {
  if ( uCloud.x <= 0.0 ) return 1.0;
  // project along the sun so tall things are shaded where their shadow would fall
  vec2 p = wp.xz - uSunDirW.xz * ( wp.y / max( uSunDirW.y, 0.2 ) );
  p = p * uCloud.y + uCloud.zw * uTime * uCloud.y;
  float n = texture2D( uCloudTex, p ).r * 0.65 + texture2D( uCloudTex, p * 2.3 + 0.37 ).r * 0.35;
  // the noise sits mostly in 0.5..0.7: this threshold leaves about a third of the
  // ground in clear sun (0.46..0.68 shaded ~95% of it, a dimmer sun rather than clouds)
  return 1.0 - uCloud.x * smoothstep( 0.58, 0.72, n );
}`;

/**
 * Give a built-in lit material (Lambert, Standard, Phong) drifting cloud
 * shadows on its direct light and an optional view-dependent rim light. Call
 * before patchFowMaterial (which keeps this hook and its cache key).
 * Idempotent.
 * @param {THREE.Material} mat
 * @param {{ rim?: number, cloud?: boolean, key?: string }} [o]
 */
export function patchWorldMaterial(mat, { rim = 0, cloud = true, key = '' } = {}) {
  if (!mat || mat.userData.__world) return mat;
  mat.userData.__world = true;
  const prev = mat.onBeforeCompile;
  const prevKey = typeof mat.customProgramCacheKey === 'function' ? String(mat.customProgramCacheKey()) : '';
  const rimStrength = { value: rim };
  mat.userData.uRimStrength = rimStrength;
  mat.onBeforeCompile = function worldCompile(shader, renderer) {
    if (typeof prev === 'function') prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, WORLD_UNIFORMS);
    shader.uniforms.uRimStrength = rimStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PARS_VERTEX}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX}`);
    let fs = shader.fragmentShader.replace('#include <common>', `#include <common>\n${WORLD_PARS_FRAGMENT}\nuniform float uRimStrength;`);
    if (cloud) {
      // shade only the sunlight (not the spell and fire point lights): expand the light
      // loop if no earlier patch did, then dim the directional light where it is read
      const lit = fs.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin);
      if (lit.includes(DIR_LIGHT_LINE)) {
        fs = lit.split(DIR_LIGHT_LINE).join(`${DIR_LIGHT_LINE}\n\t\tdirectLight.color *= cloudShade( vWorldPos );`);
      } else {
        fs = fs.replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          {
            float cs = cloudShade( vWorldPos );
            reflectedLight.directDiffuse *= cs;
            reflectedLight.directSpecular *= cs;
          }`,
        );
      }
    }
    if (rim > 0) {
      fs = fs.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float ndv = saturate( dot( normal, normalize( vViewPosition ) ) );
          float rimF = pow( 1.0 - ndv, 3.0 );
          // stronger on surfaces facing up / toward the sky
          vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
          rimF *= 0.45 + 0.55 * saturate( dot( normal, upV ) * 0.5 + 0.6 );
          totalEmissiveRadiance += uRimColor * rimF * uRimStrength * diffuseColor.rgb * 1.6;
        }`,
      );
    }
    // The VFX point lights stay in the scene at intensity 0 while idle (a fixed light
    // count keeps the programs), yet three evaluates the whole BRDF for each of them on
    // every lit pixel. Skip the ones that do not reach this fragment: getPointLightInfo
    // sets visible = ( color != 0 ), which is false at intensity 0 and past their range.
    fs = fs
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin)
      .replace(POINT_LIGHT_DIRECT, `if ( directLight.visible ) ${POINT_LIGHT_DIRECT}`);
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `${prevKey}|world${cloud ? 'c' : ''}${rim > 0 ? 'r' : ''}${key}`;
  mat.needsUpdate = true;
  return mat;
}

// ---------------------------------------------------------------------------
// environment (image-based lighting)
// ---------------------------------------------------------------------------

const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const SKY_FS = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uGroundFar;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uMoon;
uniform vec3 uMoonDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  float y = d.y;
  vec3 col;
  if ( y >= 0.0 ) {
    col = mix( uHorizon, uZenith, pow( y, 0.55 ) );
    // a few soft cloud bands so reflections are not a flat gradient
    float band = sin( d.x * 7.0 + d.z * 3.0 ) * sin( d.z * 5.0 - d.x * 2.0 );
    col = mix( col, uHorizon * 1.15, smoothstep( 0.35, 0.9, band ) * 0.35 * ( 1.0 - y ) );
  } else {
    col = mix( uGroundFar, uGround, pow( -y, 0.6 ) );
  }
  float s = max( dot( d, uSunDir ), 0.0 );
  col += uSun * ( pow( s, 900.0 ) * 40.0 + pow( s, 24.0 ) * 0.6 + pow( s, 4.0 ) * 0.12 );
  float m = max( dot( d, uMoonDir ), 0.0 );
  col += uMoon * ( pow( m, 1400.0 ) * 14.0 + pow( m, 40.0 ) * 0.2 + pow( m, 6.0 ) * 0.03 );
  gl_FragColor = vec4( col, 1.0 );
}`;

/** Size of the baked environment cube (per face): the reflections are soft, so small is plenty. */
const ENV_SIZE = 128;
/** The environment is baked again once the sky has drifted this far (linear color / direction components). */
const ENV_DRIFT = 0.035;
/** … and never more often than this (ms). */
const ENV_MIN_INTERVAL = 1500;

const _moonHue = new THREE.Color('#a9c9ff');

/**
 * Build the scene environment from a procedural sky (needs a real WebGLRenderer).
 * The sky follows the time of day: `update(state)` bakes it again when it has
 * moved on (at most every 1.5 s), and returns true when `texture` changed (point
 * `scene.environment` at it again).
 * @param {THREE.WebGLRenderer} renderer
 * @param {import('./atmosphere.js').AtmosphereState} [state] the look to start from
 * @returns {{ texture: THREE.Texture, update: (state: object, force?: boolean) => boolean, dispose: () => void } | null}
 */
export function createEnvironment(renderer, state = INITIAL) {
  if (!renderer || typeof renderer.setRenderTarget !== 'function' || typeof THREE.PMREMGenerator !== 'function') return null;
  // PMREM draws into half-float targets: without a float color buffer every draw
  // fails (GL errors, no exception) and the environment stays black
  const ext = renderer.extensions;
  if (!ext || !(ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'))) return null;
  // One generator for the renderer's life: disposing it would drop its compiled
  // shaders, and a time-of-day bake every few seconds must not recompile them.
  let pmrem = null;
  try {
    pmrem = new THREE.PMREMGenerator(renderer);
  } catch (err) {
    console.warn('[render] environment map unavailable', err);
    return null;
  }
  const geo = new THREE.SphereGeometry(10, 48, 24);
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VS,
    fragmentShader: SKY_FS,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uGroundFar: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoon: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    },
  });
  const sky = new THREE.Scene();
  sky.add(new THREE.Mesh(geo, mat));
  const baked = new Float32Array(18); // what the last bake looked like
  const now = new Float32Array(18);
  let rt = null;
  let lastBake = -Infinity;

  /** The sky's inputs as they are now. */
  const read = (st, out) => {
    const u = mat.uniforms;
    u.uZenith.value.copy(st.skyZenith);
    u.uHorizon.value.copy(st.skyHorizon);
    u.uGround.value.copy(st.skyGround);
    u.uGroundFar.value.copy(st.skyGround).lerp(st.skyHorizon, 0.55);
    // the sun's disc and glow fade out as it drops below the horizon; the moon's rise with it
    const sunUp = Math.min(1, Math.max(0, (st.sunElevation + 6) / 10));
    const moonUp = Math.min(1, Math.max(0, (st.moonElevation + 4) / 10));
    u.uSun.value.copy(st.keyHue).multiplyScalar(sunUp);
    u.uSunDir.value.copy(st.sunDir);
    u.uMoon.value.copy(_moonHue).multiplyScalar(moonUp * (0.35 + 0.65 * st.night));
    u.uMoonDir.value.copy(st.moonDir);
    let k = 0;
    for (const c of [u.uZenith.value, u.uHorizon.value, u.uGround.value, u.uSun.value, u.uMoon.value]) {
      out[k++] = c.r;
      out[k++] = c.g;
      out[k++] = c.b;
    }
    out[k++] = st.sunDir.x;
    out[k++] = st.sunDir.y;
    out[k++] = st.sunDir.z;
  };

  const env = {
    texture: null,
    update(st, force = false) {
      if (!pmrem) return false;
      read(st, now);
      if (!force) {
        const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (t - lastBake < ENV_MIN_INTERVAL) return false;
        let drift = 0;
        for (let i = 0; i < now.length; i++) drift = Math.max(drift, Math.abs(now[i] - baked[i]));
        if (drift < ENV_DRIFT) return false;
      }
      let next = null;
      try {
        next = pmrem.fromScene(sky, 0, 0.1, 100, { size: ENV_SIZE });
      } catch (err) {
        console.warn('[render] environment map unavailable', err);
        return false;
      }
      lastBake = typeof performance !== 'undefined' ? performance.now() : Date.now();
      baked.set(now);
      const old = rt;
      rt = next;
      rt.texture.name = 'sky-environment';
      env.texture = rt.texture;
      if (old) old.dispose();
      return true;
    },
    dispose() {
      if (rt) rt.dispose();
      rt = null;
      env.texture = null;
      if (pmrem) pmrem.dispose();
      pmrem = null;
      geo.dispose();
      mat.dispose();
    },
  };
  env.update(state, true);
  if (!rt) {
    env.dispose();
    return null;
  }
  return env;
}
