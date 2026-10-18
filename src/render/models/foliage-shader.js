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

const FOLIAGE_VERTEX_PARS = `attribute vec3 aFol;\nvarying float vLeaf;\nuniform vec3 uSunDirW;\n${WIND_GLSL}`;

// Leaves on the far side of a crown look their sun shadow up on the crown's
// sunlit side: the lookup point moves toward the sun by about a crown's depth
// (FOLIAGE_CROWN, local units, times the instance height scale), so it skips
// the crown's shadow on itself but still lands in the shadow of other trees.
// The wrapped light and the translucency on that far side (FOLIAGE_LIGHTS)
// then glow wherever the crown is in sunlight, as they do without shadows
// (low). Only the shadow coordinates move, not the vertex.
const FOLIAGE_CROWN = '1.1';
const FOLIAGE_SHADOW_VERTEX = /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  vec4 folWorldPos = worldPosition;
  {
    float away = saturate( 0.2 - 1.2 * dot( inverseTransformDirection( transformedNormal, viewMatrix ), uSunDirW ) );
    #ifdef USE_INSTANCING
      away *= length( instanceMatrix[ 1 ].xyz );
    #endif
    worldPosition.xyz += uSunDirW * ( away * aFol.x * ${FOLIAGE_CROWN} );
  }
#endif
#include <shadowmap_vertex>
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  worldPosition = folWorldPos;
#endif`;

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
// yellow-green instead of dropping to ambient. directLight.color carries the
// shadow looked up on the crown's sunlit side (FOLIAGE_SHADOW_VERTEX), so a
// crown in another tree's shadow transmits little but its own far side does.
// Shadows on leaves are partial (uFoliage.z = how much light still filters
// through): blended toward folLightColor, the light before its shadow.
const FOLIAGE_LIGHTS = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
  /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;/,
  `float rawNL = dot( geometryNormal, directLight.direction );
  float wrap = uFoliage.x * vLeaf;
  float dotNL = saturate( ( rawNL + wrap ) / ( 1.0 + wrap ) );
  vec3 lightColor = mix( directLight.color, folLightColor, uFoliage.z * vLeaf );
  vec3 irradiance = dotNL * lightColor;
  irradiance += lightColor * vec3( 1.0, 1.06, 0.62 ) * ( uFoliage.y * vLeaf * saturate( - rawNL ) );`,
);

// The light loop, remembering each light's color before its shadow is applied.
const FOLIAGE_LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace(
  /(get(?:Point|Spot|Sun|Directional)LightInfo\([^;]*\);)/g,
  '$1\n\t\tfolLightColor = directLight.color;',
);

/**
 * Wind, per-leaf instance tint and soft foliage light for a MeshLambertMaterial
 * used by instanced plants (geometry with an `aFol` attribute). Call before
 * patchWorldMaterial / patchFowMaterial (they keep this hook). Idempotent.
 * @param {THREE.MeshLambertMaterial} mat
 * @param {{ wrap?: number, translucency?: number, filter?: number }} [o] filter: share of the
 *   light that still reaches leaves in shadow (0 = hard shadows)
 */
export function patchFoliageMaterial(mat, { wrap = 0.45, translucency = 0.35, filter = 0.4 } = {}) {
  if (!mat || mat.userData.__foliage) return mat;
  if (!FOLIAGE_LIGHTS.includes('uFoliage') || !FOLIAGE_LIGHTS_BEGIN.includes('folLightColor = directLight.color')) {
    throw new Error('foliage lighting patch did not apply');
  }
  mat.userData.__foliage = true;
  const uFoliage = { value: new THREE.Vector3(wrap, translucency, filter) };
  mat.userData.uFoliage = uFoliage;
  const prev = mat.onBeforeCompile;
  const prevKey = typeof mat.customProgramCacheKey === 'function' ? String(mat.customProgramCacheKey()) : '';
  mat.onBeforeCompile = function foliageCompile(shader, renderer) {
    if (typeof prev === 'function') prev.call(this, shader, renderer);
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.uniforms.uSunDirW = WORLD_UNIFORMS.uSunDirW;
    shader.uniforms.uWind = WIND_UNIFORMS.uWind;
    shader.uniforms.uFoliage = uFoliage;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FOLIAGE_VERTEX_PARS}`)
      .replace('#include <color_vertex>', FOLIAGE_COLOR_VERTEX)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${INSTANCED_WIND}`)
      .replace('#include <shadowmap_vertex>', FOLIAGE_SHADOW_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLeaf;\nuniform vec3 uFoliage;\nvec3 folLightColor = vec3( 0.0 );')
      .replace('#include <lights_lambert_pars_fragment>', FOLIAGE_LIGHTS)
      .replace('#include <lights_fragment_begin>', FOLIAGE_LIGHTS_BEGIN);
  };
  mat.customProgramCacheKey = () => `${prevKey}|foliage3`;
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
