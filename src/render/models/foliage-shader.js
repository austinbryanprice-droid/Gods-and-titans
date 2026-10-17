// Shader patches for the nature props (DESIGN 8): wind for trees, bushes,
// grass and flowers, soft foliage lighting, and per-face roughness for stone.
//
//   patchFoliageMaterial(lambert);          // then patchWorldMaterial, then the fog patch
//   mesh.customDepthMaterial = foliageDepthMaterial();   // shadows sway too
//   patchStoneMaterial(standard);           // rocks, ruins, stumps: roughness per face
//
// Wind is vertex-only and driven by WORLD_UNIFORMS.uTime (the renderer clock),
// so it costs nothing on the CPU. Plants lean downwind in slow gusts that
// travel across the map, sway around that lean with a phase taken from their
// root position, and their leaves flutter. Geometry carries the weights in an
// `aFol` attribute: x = leaf (0 bark / 1 foliage), y = bend amplitude in local
// units (0 at the roots, growing with height), z = flutter amplitude.
import * as THREE from 'three';
import { WORLD_UNIFORMS } from '../shading.js';

/** Wind shared by every plant: xy = direction (x east, y south; unit), z = strength, w = unused. */
export const WIND_UNIFORMS = {
  uWind: { value: new THREE.Vector4(0.93, 0.36, 1, 0) },
};

/** Wind strength (0 = calm); direction stays. */
export function setWindStrength(s) {
  WIND_UNIFORMS.uWind.value.z = s;
}

/**
 * GLSL: windOffset(root, p, bend, flutter) → world-space displacement of point
 * `p` (local coordinates, only used for the flutter's phase) of a plant rooted
 * at world xz `root`. `bend` is the lean amplitude at that point, `flutter` the
 * leaf-flutter amplitude (both world units at full strength).
 */
export const WIND_GLSL = /* glsl */ `
uniform float uTime;
uniform vec4 uWind;
vec3 windOffset( vec2 root, vec3 p, float bend, float flutter ) {
  float t = uTime;
  vec2 dir = uWind.xy;
  vec2 crossDir = vec2( - dir.y, dir.x );
  float along = dot( root, dir );
  float across = dot( root, crossDir );
  // gust fronts: bands moving downwind at ~3.5 tiles/s, bent where they run across the map
  float front = sin( along * 0.17 - t * 0.6 + 1.7 * sin( across * 0.075 + t * 0.05 ) );
  float gust = smoothstep( - 0.35, 1.0, front );
  float ph = fract( sin( dot( root, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2832;
  float sway = sin( t * 1.7 + ph ) * 0.6 + sin( t * 2.9 + ph * 1.7 ) * 0.4;
  float lean = uWind.z * ( 0.3 + 0.7 * gust ) * ( 0.75 + 0.35 * sway );
  vec3 o;
  o.xz = ( dir * lean + crossDir * ( sin( t * 1.3 + ph * 2.3 ) * 0.22 * uWind.z ) ) * bend;
  // a bent stem gets a little shorter
  o.y = - 0.35 * lean * lean * bend;
  float f = flutter * uWind.z * ( 0.45 + 0.8 * gust );
  o += f * vec3(
    sin( t * 8.7 + ph + p.y * 9.0 + p.x * 5.0 ),
    0.6 * sin( t * 7.9 + ph * 1.3 + p.z * 8.0 ),
    sin( t * 9.6 + ph * 0.7 + p.x * 7.0 + p.z * 4.0 ) );
  return o;
}`;

// Instanced meshes: the displacement is computed in world space and brought
// back into the instance's local frame (inverse of rotation · scale =
// scale⁻² · transpose), so everything after begin_vertex (shadow coordinates,
// fog of war, cloud shadows) sees the swaying position. Zero-scale (hidden)
// instances stay collapsed. Assumes the parent group is not rotated or scaled.
const INSTANCED_WIND = /* glsl */ `
#ifdef USE_INSTANCING
{
  mat3 im = mat3( instanceMatrix );
  vec2 root = ( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xz;
  float sy = length( im[ 1 ] );
  vec3 w = windOffset( root, transformed, aFol.y * sy, aFol.z * sy );
  vec3 s2 = max( vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) ), vec3( 1e-6 ) );
  transformed += ( transpose( im ) * w ) / s2;
}
#endif`;

const FOLIAGE_VERTEX_PARS = `attribute vec3 aFol;\nvarying float vLeaf;\n${WIND_GLSL}`;

// Per-instance tint on the leaves only; bark takes just its brightness (green
// channel: autumn tints push red, not green).
const FOLIAGE_COLOR_VERTEX = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR
  vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix( vec3( clamp( instanceColor.g, 0.75, 1.25 ) ), instanceColor.rgb, aFol.x );
#endif
vLeaf = aFol.x;`;

// Lambert with wrapped diffuse on the leaves (soft terminator) and light
// shining through them: faces turned away from the sun glow a little
// yellow-green instead of dropping to ambient. Shadowed leaves transmit
// nothing (directLight.color is already shadowed here).
const FOLIAGE_LIGHTS = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
  /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;/,
  `float rawNL = dot( geometryNormal, directLight.direction );
  float wrap = uFoliage.x * vLeaf;
  float dotNL = saturate( ( rawNL + wrap ) / ( 1.0 + wrap ) );
  vec3 irradiance = dotNL * directLight.color;
  irradiance += directLight.color * vec3( 1.0, 1.06, 0.62 ) * ( uFoliage.y * vLeaf * saturate( - rawNL ) );`,
);

/**
 * Wind, per-leaf instance tint and soft foliage light for a MeshLambertMaterial
 * used by instanced plants (geometry with an `aFol` attribute). Call before
 * patchWorldMaterial / patchFowMaterial (they keep this hook). Idempotent.
 * @param {THREE.MeshLambertMaterial} mat
 * @param {{ wrap?: number, translucency?: number }} [o]
 */
export function patchFoliageMaterial(mat, { wrap = 0.45, translucency = 0.35 } = {}) {
  if (!mat || mat.userData.__foliage) return mat;
  if (!FOLIAGE_LIGHTS.includes('uFoliage')) throw new Error('foliage lighting patch did not apply');
  mat.userData.__foliage = true;
  const uFoliage = { value: new THREE.Vector2(wrap, translucency) };
  mat.userData.uFoliage = uFoliage;
  const prev = mat.onBeforeCompile;
  const prevKey = typeof mat.customProgramCacheKey === 'function' ? String(mat.customProgramCacheKey()) : '';
  mat.onBeforeCompile = function foliageCompile(shader, renderer) {
    if (typeof prev === 'function') prev.call(this, shader, renderer);
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.uniforms.uWind = WIND_UNIFORMS.uWind;
    shader.uniforms.uFoliage = uFoliage;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FOLIAGE_VERTEX_PARS}`)
      .replace('#include <color_vertex>', FOLIAGE_COLOR_VERTEX)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${INSTANCED_WIND}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLeaf;\nuniform vec2 uFoliage;')
      .replace('#include <lights_lambert_pars_fragment>', FOLIAGE_LIGHTS);
  };
  mat.customProgramCacheKey = () => `${prevKey}|foliage1`;
  mat.needsUpdate = true;
  return mat;
}

let DEPTH = null;
/**
 * Shadow-map material that sways like the foliage (shared; set it as
 * `customDepthMaterial` on every casting instanced plant mesh).
 * @returns {THREE.MeshDepthMaterial}
 */
export function foliageDepthMaterial() {
  if (DEPTH) return DEPTH;
  const mat = new THREE.MeshDepthMaterial();
  mat.name = 'foliage-depth';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.uniforms.uWind = WIND_UNIFORMS.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aFol;\n${WIND_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${INSTANCED_WIND}`);
  };
  mat.customProgramCacheKey = () => 'foliage-depth1';
  DEPTH = mat;
  return mat;
}

/**
 * Per-vertex roughness for a MeshStandardMaterial: geometry attribute `aRough`
 * (0..1) multiplies the material roughness. Call before the world / fog patches.
 * @param {THREE.MeshStandardMaterial} mat
 */
export function patchStoneMaterial(mat) {
  if (!mat || mat.userData.__stone) return mat;
  mat.userData.__stone = true;
  const prev = mat.onBeforeCompile;
  const prevKey = typeof mat.customProgramCacheKey === 'function' ? String(mat.customProgramCacheKey()) : '';
  mat.onBeforeCompile = function stoneCompile(shader, renderer) {
    if (typeof prev === 'function') prev.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRough;\nvarying float vRough;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = aRough;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRough;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vRough;');
  };
  mat.customProgramCacheKey = () => `${prevKey}|stone1`;
  mat.needsUpdate = true;
  return mat;
}
