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
import { leafTexture, needleTexture, NEEDLE_SPRAYS } from './leaf-texture.js';

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

// ---------------------------------------------------------------------------
// Spruce family: one shared spruce geometry (props.js pineGeo) is reshaped per
// instance in the vertex shader (no extra draw calls, no extra triangles). Each
// tree carries aShape = (preset, a, b, c): a preset index into PINE_PRESETS plus
// three small jitters in -1..1, all derived from its tile in props.js. A preset
// sets how many of the geometry's tiers are used (the others collapse onto the
// axis), how wide the skirts are, how steeply they narrow, how the tiers are
// spaced, and how far the branch tips droop.
// ---------------------------------------------------------------------------

/** Tier count of the shared spruce geometry (the most any preset can use). */
export const PINE_TIERS = 8;
/** Height of the top tier's base and of the lowest tier's base (default), geometry units. */
export const PINE_TOP = 1.6;
export const PINE_BOTTOM = 0.26;
/**
 * [tiers, droop, profile, wide, spacing, lift, tierHeight, height] per preset.
 * profile: skirt radius ~ (1 - t)^profile (1 straight cone, < 1 rounded, > 1 spire);
 * spacing: tier base height ~ t^spacing (> 1 packs the tiers low); lift: bare trunk added
 * under the lowest tier; height: instance height multiplier (used by props.js).
 */
export const PINE_PRESETS = [
  [7, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0], // classic spruce
  [8, 0.7, 1.2, 0.68, 0.92, 0.05, 0.95, 1.25], // tall narrow fir, short drooping tips
  [6, 1.4, 0.8, 1.28, 1.1, 0.0, 1.1, 0.84], // broad old spruce, heavy skirts
  [5, 1.8, 1.0, 1.0, 1.0, 0.22, 0.55, 0.98], // open: few wide tiers with the trunk showing between
  [7, 1.1, 0.5, 1.08, 1.3, 0.04, 0.95, 0.88], // rounded egg, tiers packed low
  [8, 0.9, 1.7, 0.8, 0.85, 0.02, 0.9, 1.12], // thin spire
];
export const PINE_UNIFORMS = {
  uPine: { value: PINE_PRESETS.flatMap((p) => [new THREE.Vector4(p[0], p[1], p[2], p[3]), new THREE.Vector4(p[4], p[5], p[6], p[7])]) },
};

/**
 * Layout of tier i of a spruce (same maths as the vertex shader's pineMorph, minus the
 * per-tree jitter): base height, skirt radius and skirt height, geometry units.
 */
export function pineLayout(i, preset = PINE_PRESETS[0]) {
  const [n, , profile, wide, spacing, lift, tierH] = preset;
  const t = Math.min(1, i / (n - 1));
  const yb = PINE_BOTTOM + lift;
  const y = yb + (PINE_TOP - yb) * Math.pow(t, spacing);
  const R = (0.18 + 0.42 * Math.pow(1 - t, profile)) * wide;
  const h = ((PINE_TOP - yb) / (n - 1)) * 2.2 * tierH * (1 - 0.22 * t);
  return { t, y, R, h };
}

const PINE_VERTEX_PARS = /* glsl */ `
attribute vec4 aPine; // tier index (-1 trunk, 99 leader), base height, radius, skirt height of the default tier
attribute vec4 aShape;
uniform vec4 uPine[ ${PINE_PRESETS.length * 2} ];
vec3 pineMorph( vec3 p, out float gain ) {
  gain = 1.0;
  float i = aPine.x;
  if ( i < - 0.5 ) return p;
  int k = int( aShape.x + 0.5 ) * 2;
  vec4 A = uPine[ k ];
  vec4 B = uPine[ k + 1 ];
  float n = A.x;
  float wide = A.w * ( 1.0 + 0.09 * aShape.z );
  if ( i > 50.0 ) { // the leader follows the top tier
    gain = 1.1;
    return vec3( p.x * wide, p.y, p.z * wide );
  }
  if ( i > n - 0.5 ) { // unused tiers collapse onto the axis (zero-area triangles)
    return vec3( 0.0, ${PINE_TOP.toFixed(2)}, 0.0 );
  }
  float t = i / ( n - 1.0 );
  float yb = ${PINE_BOTTOM.toFixed(2)} + B.y * ( 1.0 + 0.3 * aShape.w );
  float y = yb + ( ${PINE_TOP.toFixed(2)} - yb ) * pow( t, B.x );
  float R = ( 0.18 + 0.42 * pow( 1.0 - t, A.z ) ) * wide * ( 1.0 + 0.13 * sin( i * 5.3 + aShape.y * 9.0 ) );
  float h = ( ( ${PINE_TOP.toFixed(2)} - yb ) / ( n - 1.0 ) ) * 2.2 * B.z * ( 1.0 - 0.22 * t );
  vec3 q = p - vec3( 0.0, aPine.y, 0.0 );
  float kr = R / aPine.z;
  vec2 xz = q.xz * kr;
  float ry = q.y >= 0.0 ? q.y * h / aPine.w : q.y * A.y * ( 1.0 + 0.3 * aShape.y ) * sqrt( kr );
  // a slow twist and a little lean from tier to tier: no two crowns stack alike
  float ang = i * aShape.w * 0.3;
  float ca = cos( ang );
  float sa = sin( ang );
  xz = vec2( ca * xz.x - sa * xz.y, sa * xz.x + ca * xz.y );
  xz += vec2( sin( i * 12.9 + aShape.y * 5.0 ), cos( i * 7.3 + aShape.z * 5.0 ) ) * ( 0.035 * R );
  gain = mix( 0.8, 1.14, t );
  return vec3( xz.x, y + ry, xz.y );
}`;

// the depth pass has no vertex colors
const PINE_DEPTH_MORPH = /* glsl */ `
{
  float pineGain;
  transformed = pineMorph( transformed, pineGain );
}`;

const PINE_MORPH = /* glsl */ `
{
  float pineGain;
  transformed = pineMorph( transformed, pineGain );
  #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
    vColor.rgb *= pineGain;
  #endif
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

const FOLIAGE_VERTEX_PARS = `attribute vec3 aFol;\nvarying float vLeaf;\nvarying vec3 vFolP;\nuniform vec3 uSunDirW;\n${WIND_GLSL}`;

// ---------------------------------------------------------------------------
// Leaf puffs: the round clumps that make up broadleaf crowns and bushes. A puff is
// one quad (two triangles) whose four vertices all sit at the puff's center and carry
// aBb = (corner x, corner y, radius in local units, 1). The vertex shader spreads the
// corners over a quad facing the camera (the shadow camera in the shadow pass, so a
// shadow is a disc across the light) and pushes it toward the viewer by half a
// radius; the fragment shader shades it as a sphere (a smooth round normal, bent a
// little toward the crown's outward direction in the vertex normal), cuts the disc
// with an anti-aliased edge and a leafy, ragged one, and takes its leaf noise from
// the sphere surface. Parts that are not puffs (trunks, branches) carry aBb.w = 0.
// ---------------------------------------------------------------------------

// A puff's own random numbers: from its center and the position of its tree (the same in the
// color and the shadow pass, so a puff's shadow is where the puff is).
const PUFF_HASH = /* glsl */ `
attribute vec4 aBb;
vec4 puffHash( vec3 center, vec2 tree ) {
  vec3 s = center * 17.3 + vec3( tree.x * 0.61, tree.y * 0.37, tree.x * 0.23 + tree.y * 0.47 );
  return fract( sin( vec4( dot( s, vec3( 12.9898, 78.233, 37.719 ) ), dot( s, vec3( 39.346, 11.135, 83.155 ) ),
    dot( s, vec3( 73.156, 52.235, 9.151 ) ), dot( s, vec3( 27.917, 61.402, 45.288 ) ) ) ) * 43758.5453 );
}`;

const PUFF_VERTEX_PARS = /* glsl */ `${PUFF_HASH}
varying vec4 vBb;
varying vec4 vBbSeed;
varying float vPuffK;`;

const PUFF_DEPTH_PARS = PUFF_HASH;

// Per puff: where its leaf texture starts and how it is turned (the same for all six vertices:
// they sit at the puff's center).
const PUFF_SEED_VERTEX = /* glsl */ `
{
  float bbH1 = fract( sin( dot( vFolP, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
  float bbH2 = fract( sin( dot( vFolP, vec3( 39.346, 11.135, 83.155 ) ) ) * 24634.6345 );
  float bbA = bbH2 * 6.2832;
  vBbSeed = vec4( bbH1, fract( bbH1 * 7.31 + bbH2 * 3.17 ), cos( bbA ), sin( bbA ) );
}`;

// Before the wind: each tree arranges its puffs a little differently (center and size jittered).
const PUFF_JITTER = /* glsl */ `
#ifdef USE_INSTANCING
float puffSize = 1.0;
if ( aBb.w > 0.5 ) {
  vec4 ph = puffHash( position, instanceMatrix[ 3 ].xz );
  transformed += ( ph.xyz - 0.5 ) * vec3( 0.14, 0.1, 0.14 ) * min( aBb.z * 3.0, 1.0 );
  puffSize = 0.86 + 0.28 * ph.w;
}
#endif`;

// After the wind: the corners of a puff, in world space along the camera's right and up
// axes, brought back into the instance's local frame (as the wind is). `push` moves the
// quad along the view axis in radii: toward the viewer in the color pass, away from the
// light in the shadow pass (the back of the crown casts, as the back faces of the old meshes
// did, so a lit puff never shadows itself). Zero-scale (hidden) instances stay collapsed.
const puffExpand = (push, radiusVarying) => /* glsl */ `
#ifdef USE_INSTANCING
${radiusVarying ? 'vPuffK = 0.0;' : ''}
if ( aBb.w > 0.5 ) {
  mat3 pim = mat3( instanceMatrix );
  vec3 ps2 = vec3( dot( pim[ 0 ], pim[ 0 ] ), dot( pim[ 1 ], pim[ 1 ] ), dot( pim[ 2 ], pim[ 2 ] ) );
  float pk = aBb.z * puffSize * ( sqrt( ps2.x ) + sqrt( ps2.y ) + sqrt( ps2.z ) ) * ( 1.0 / 3.0 );
  vec3 pr = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
  vec3 pu = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
  vec3 pb = vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] );
  ${radiusVarying ? 'vPuffK = pk;' : ''}
  vec3 pw = ( pr * aBb.x + pu * aBb.y + pb * ${push} ) * pk;
  transformed += ( transpose( pim ) * pw ) / max( ps2, vec3( 1e-6 ) );
}
#endif`;
const PUFF_EXPAND = puffExpand('0.55', true);
const PUFF_EXPAND_DEPTH = puffExpand('- 0.55', false);

// Leaf detail coordinates: the plant's own local position (before wind, so the pattern does
// not swim), shifted per instance so neighbours differ. Puffs derive their texture offset from it.
const FOLIAGE_DETAIL_VERTEX = /* glsl */ `
vFolP = position;
#ifdef USE_INSTANCING
  vFolP += vec3( instanceMatrix[ 3 ].x * 0.37, 0.0, instanceMatrix[ 3 ].z * 0.29 );
#endif`;

const FOLIAGE_DETAIL_PARS = /* glsl */ `
uniform vec4 uFolDetail;
varying vec3 vFolP;`;

// Needle sprays (spruce tiers, fern fronds): the geometry carries aUv = (along the texture's width,
// out along the spray, 1; 0 for trunk and leader). Each spruce and each of its tiers starts its
// texture somewhere else; a fern shifts by whole sprays, so every frond keeps one spray's outline.
const NEEDLE_PARS_VERTEX = /* glsl */ `
attribute vec3 aUv;
varying vec3 vNeedle;`;
const needleVertex = (pine) => /* glsl */ `
vNeedle = aUv;
#ifdef USE_INSTANCING
  ${pine
    ? 'vNeedle.x += fract( instanceMatrix[ 3 ].x * 0.173 + instanceMatrix[ 3 ].z * 0.291 ) * 8.0 + aPine.x * 0.37;'
    : `vNeedle.x += floor( fract( instanceMatrix[ 3 ].x * 0.173 + instanceMatrix[ 3 ].z * 0.291 ) * ${NEEDLE_SPRAYS.toFixed(1)} ) * ${(1 / NEEDLE_SPRAYS).toFixed(4)};`}
#endif`;

// The end of every detail block: coverage becomes alpha to coverage on the multisampled target
// (soft one-pixel edges), a plain cut elsewhere.
const FOLIAGE_COVERAGE = /* glsl */ `
if ( uFolMS > 0.5 ) {
  if ( folCov <= 0.0 ) discard;
  diffuseColor.a = folCov;
} else if ( folCov < 0.5 ) discard;`;

/**
 * Leaf puffs (fragment): the disc of the puff with its sphere normal, the leaf texture laid over
 * it (brightness and warmth per leaf, turned and shifted per puff), the outline broken up into
 * leaf tips toward the rim, tops lighter and undersides darker, and optionally the depth of the
 * sphere. uFolDetail: x = texture repeats across one radius, y = albedo contrast,
 * z = how much of the outline is cut into leaves (0..1).
 */
const puffDetailFragment = (sphereDepth) => /* glsl */ `
float folCov = 1.0; // coverage of this fragment: the disc of a puff cut into leaves
${sphereDepth ? 'gl_FragDepth = gl_FragCoord.z;' : ''}
vec3 bbN = vec3( 0.0, 0.0, 1.0 ); // a puff's sphere normal (view space: x right, y up, z toward the viewer)
if ( vBb.w > 0.5 ) {
  float bbR = length( vBb.xy );
  bbN = vec3( vBb.xy, sqrt( max( 1.0 - bbR * bbR, 0.0 ) ) );
  vec2 bbQ = vBb.xy * uFolDetail.x;
  vec4 lf = texture2D( uLeafTex, vec2( bbQ.x * vBbSeed.z - bbQ.y * vBbSeed.w, bbQ.x * vBbSeed.w + bbQ.y * vBbSeed.z ) + vBbSeed.xy );
  float bbCov = clamp( ( 1.0 - bbR ) / max( fwidth( bbR ), 1e-4 ) + 0.5, 0.0, 1.0 );
  // inside the disc every texel stays; toward the rim only the leaves do
  float bbKeep = mix( 1.0, lf.a, uFolDetail.z * vLeaf * smoothstep( 0.5, 0.95, bbR ) ) - 0.5;
  folCov = min( bbCov, clamp( bbKeep / max( fwidth( bbKeep ) * 1.25, 0.02 ) + 0.5, 0.0, 1.0 ) );
  // round volume: tops catch the sky, undersides turn dark
  float bbUp = dot( bbN, ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  diffuseColor.rgb *= mix( 0.55, 1.12, smoothstep( -0.75, 0.9, bbUp ) );
  // each leaf its own brightness, lighter at the tip, dark where they overlap; some lean warm
  diffuseColor.rgb *= mix( 1.0, lf.r * 1.5, uFolDetail.y * vLeaf );
  diffuseColor.rgb += vec3( 0.05, 0.035, -0.04 ) * ( lf.g - 0.45 ) * diffuseColor.g * 3.0 * uFolDetail.y * vLeaf;
  diffuseColor.rgb = max( diffuseColor.rgb, vec3( 0.0 ) );
  ${sphereDepth ? `
  // the sphere's own depth (the quad stands 0.55 radii in front of the center): crowns meet
  // buildings, the ground and each other along round intersections, and AO sees spheres
  float bbZ = - vViewPosition.z + ( bbN.z - 0.55 ) * vPuffK;
  float bbD = projectionMatrix[ 2 ][ 2 ] * bbZ + projectionMatrix[ 3 ][ 2 ];
  gl_FragDepth = ( isOrthographic ? bbD : bbD / - bbZ ) * 0.5 + 0.5;` : ''}
}
${FOLIAGE_COVERAGE}`;

/**
 * Needle sprays (fragment): the needle texture on a spruce skirt (sprays running out from the
 * trunk, fresher at their tips) or a fern frond, the outline cut into sprays from where the
 * hem starts, a skirt closed toward the trunk. uFolDetail: y = albedo contrast, z = how much of
 * the outline is cut (0..1), w = where along the spray the cut starts (a fern's whole frond is
 * cut: below 0).
 */
const NEEDLE_DETAIL_FRAGMENT = /* glsl */ `
float folCov = 1.0; // coverage of this fragment: the skirt cut into sprays
if ( vLeaf > 0.5 && vNeedle.z > 0.5 ) {
  vec4 nt = texture2D( uNeedleTex, vNeedle.xy );
  float nKeep = mix( 1.0, nt.a, uFolDetail.z * smoothstep( uFolDetail.w, uFolDetail.w + 0.25, vNeedle.y ) ) - 0.5;
  folCov = clamp( nKeep / max( fwidth( nKeep ) * 1.25, 0.02 ) + 0.5, 0.0, 1.0 );
  diffuseColor.rgb *= mix( 1.0, nt.r * 1.5, uFolDetail.y );
  // fresh growth at the tips leans yellow
  diffuseColor.rgb += vec3( 0.06, 0.05, -0.04 ) * ( nt.g - 0.3 ) * diffuseColor.g * 3.0 * uFolDetail.y;
  diffuseColor.rgb = max( diffuseColor.rgb, vec3( 0.0 ) );
}
${FOLIAGE_COVERAGE}`;

// At night leaves lose their saturation and lean blue-green (moonlight).
const FOLIAGE_GRADE = /* glsl */ `
if ( vLeaf > 0.5 && uFolNight > 0.0 ) {
  float folLuma = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, folLuma * vec3( 0.8, 1.0, 1.18 ), 0.4 * uFolNight );
}`;

// The light that fills the shade (sky and ground ambient) is tinted: cool, blue-green shadows.
const FOLIAGE_SHADE = /* glsl */ `
reflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), uFolShade, vLeaf );`;

// A puff's normal: the sphere's, bent a little toward the crown's outward direction (vNormal)
const PUFF_NORMAL_FRAGMENT = /* glsl */ `
if ( vBb.w > 0.5 ) {
  normal = normalize( mix( bbN, normalize( vNormal ), 0.3 ) );
  nonPerturbedNormal = normal;
}`;

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
  irradiance += lightColor * vec3( 1.0, 1.06, 0.62 ) * ( uFoliage.y * vLeaf * saturate( - rawNL ) );
  // back-lit crowns: looking toward the sun, the thin outer leaves glow a little (view dependent)
  float backLit = saturate( - dot( geometryViewDir, directLight.direction ) );
  float thinLeaf = 1.0 - saturate( dot( geometryNormal, geometryViewDir ) );
  irradiance += lightColor * vec3( 1.0, 0.92, 0.5 ) * ( uFoliage.y * vLeaf * 0.8 * backLit * backLit * ( 0.3 + 0.7 * thinLeaf ) );
  // rim light: the edge of a crown on the sun's side glows with the light's own color
  float rimEdge = pow( thinLeaf, 2.2 ) * saturate( rawNL * 0.6 + 0.55 );
  irradiance += lightColor * vec3( 1.0, 0.9, 0.55 ) * ( uFoliage.w * vLeaf * rimEdge );`,
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
 * @param {{ wrap?: number, translucency?: number, filter?: number, rim?: number, shade?: number[], detail?: number[], pine?: boolean, needles?: boolean, puff?: boolean, sphereDepth?: boolean }} [o]
 *   rim: strength of the sun-side edge light of crowns; shade: tint of the light that fills the shade (cool: blue-green shadows);
 *   detail: [texture repeats (puffs: across one radius), albedo contrast, how much of the outline is cut
 *   into leaves / sprays, where along a spray the cut starts (needles)] for puffs and needle sprays;
 *   leaf and needle textures (leaf-texture.js);
 *   filter: share of the light that still reaches leaves in shadow (0 = hard shadows);
 *   pine: reshape the shared spruce geometry per instance (aPine / aShape attributes, PINE_PRESETS); also needles
 *   needles: the geometry carries aUv: the needle texture cuts its surfaces into sprays (a spruce, a fern);
 *   puff: the geometry carries leaf puffs (aBb attribute): quads turned toward the camera and shaded as spheres;
 *   sphereDepth: puffs also write the depth of the sphere (round intersections; the fragment shader
 *   loses early depth testing, so only where the crowns are worth it)
 */
export function patchFoliageMaterial(mat, { wrap = 0.45, translucency = 0.35, filter = 0.4, rim = 0.3, shade = [1, 1, 1], detail = null, pine = false, needles = false, puff = false, sphereDepth = false } = {}) {
  if (!mat || mat.userData.__foliage) return mat;
  if (!FOLIAGE_LIGHTS.includes('uFoliage') || !FOLIAGE_LIGHTS_BEGIN.includes('folLightColor = directLight.color')) {
    throw new Error('foliage lighting patch did not apply');
  }
  mat.userData.__foliage = true;
  const uFoliage = { value: new THREE.Vector4(wrap, translucency, filter, rim) };
  mat.userData.uFoliage = uFoliage;
  // texture detail of puffs and needle sprays: [texture repeats, contrast, outline cut, hem start]; null = flat
  needles = needles || pine;
  const textured = !!detail && (puff || needles);
  const d = detail || [1, 0, 0, 0];
  const uFolDetail = { value: new THREE.Vector4(d[0], d[1], d[2], d[3]) };
  mat.userData.uFolDetail = uFolDetail;
  // Cut leaf edges ride on alpha to coverage where the target is multisampled (post.js
  // MSAA); on the plain canvas (low) the shader falls back to a hard cut.
  const uFolMS = { value: 0 };
  const uFolShade = { value: new THREE.Vector3(shade[0], shade[1], shade[2]) };
  mat.userData.uFolShade = uFolShade;
  if (textured) {
    mat.alphaToCoverage = true;
    const prevBefore = mat.onBeforeRender;
    mat.onBeforeRender = function foliageBeforeRender(renderer, ...rest) {
      const rt = renderer.getRenderTarget ? renderer.getRenderTarget() : null;
      uFolMS.value = rt && rt.samples > 0 ? 1 : 0;
      if (typeof prevBefore === 'function') prevBefore.call(this, renderer, ...rest);
    };
  }
  const prev = mat.onBeforeCompile;
  const prevKey = typeof mat.customProgramCacheKey === 'function' ? String(mat.customProgramCacheKey()) : '';
  mat.onBeforeCompile = function foliageCompile(shader, renderer) {
    if (typeof prev === 'function') prev.call(this, shader, renderer);
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.uniforms.uSunDirW = WORLD_UNIFORMS.uSunDirW;
    shader.uniforms.uWind = WIND_UNIFORMS.uWind;
    shader.uniforms.uFoliage = uFoliage;
    shader.uniforms.uFolDetail = uFolDetail;
    shader.uniforms.uFolMS = uFolMS;
    shader.uniforms.uFolShade = uFolShade;
    // the time of day (the Lighting thread's shared uniforms); day where it is not there yet
    shader.uniforms.uFolNight = WORLD_UNIFORMS.uNight || NIGHT_DAY;
    if (puff) shader.uniforms.uLeafTex = { value: leafTexture() };
    if (pine) shader.uniforms.uPine = PINE_UNIFORMS.uPine;
    if (needles) shader.uniforms.uNeedleTex = { value: needleTexture() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FOLIAGE_VERTEX_PARS}${pine ? PINE_VERTEX_PARS : ''}${needles ? NEEDLE_PARS_VERTEX : ''}${puff ? PUFF_VERTEX_PARS : ''}`)
      .replace('#include <color_vertex>', `${FOLIAGE_COLOR_VERTEX}\n${FOLIAGE_DETAIL_VERTEX}${puff ? `\nvBb = aBb;${PUFF_SEED_VERTEX}` : ''}${needles ? needleVertex(pine) : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${pine ? PINE_MORPH : ''}${puff ? PUFF_JITTER : ''}${INSTANCED_WIND}${puff ? PUFF_EXPAND : ''}`)
      .replace('#include <shadowmap_vertex>', FOLIAGE_SHADOW_VERTEX);
    const fragmentPars = [
      'varying float vLeaf;', 'uniform vec4 uFoliage;', 'uniform float uFolMS;', 'uniform vec3 uFolShade;', 'uniform float uFolNight;', 'vec3 folLightColor = vec3( 0.0 );',
      puff && 'varying vec4 vBb;\nvarying vec4 vBbSeed;\nvarying float vPuffK;\nuniform sampler2D uLeafTex;',
      puff && sphereDepth && 'uniform mat4 projectionMatrix;',
      needles && 'varying vec3 vNeedle;\nuniform sampler2D uNeedleTex;',
      FOLIAGE_DETAIL_PARS,
    ].filter(Boolean).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentPars}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${!textured ? '' : puff ? puffDetailFragment(sphereDepth) : NEEDLE_DETAIL_FRAGMENT}${FOLIAGE_GRADE}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FOLIAGE_SHADE}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${puff ? PUFF_NORMAL_FRAGMENT : ''}`)
      .replace('#include <lights_lambert_pars_fragment>', FOLIAGE_LIGHTS)
      .replace('#include <lights_fragment_begin>', FOLIAGE_LIGHTS_BEGIN);
  };
  mat.customProgramCacheKey = () => `${prevKey}|foliage8${pine ? 'p' : needles ? 'n' : ''}${puff ? 'b' : ''}${puff && sphereDepth ? 'd' : ''}${textured ? 't' : ''}`;
  mat.needsUpdate = true;
  return mat;
}

const NIGHT_DAY = { value: 0 };

const DEPTH = {};
/**
 * Shadow-map material that sways like the foliage (shared; set it as
 * `customDepthMaterial` on every casting instanced plant mesh). `pine` reshapes
 * the spruce geometry like its colour pass does, `puff` turns leaf puffs toward the light.
 * @param {{ pine?: boolean, puff?: boolean }} [o]
 * @returns {THREE.MeshDepthMaterial}
 */
export function foliageDepthMaterial({ pine = false, puff = false } = {}) {
  const key = pine ? 'pine' : puff ? 'puff' : 'plain';
  if (DEPTH[key]) return DEPTH[key];
  const mat = new THREE.MeshDepthMaterial();
  mat.name = pine ? 'foliage-depth-pine' : puff ? 'foliage-depth-puff' : 'foliage-depth';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.uniforms.uWind = WIND_UNIFORMS.uWind;
    if (pine) shader.uniforms.uPine = PINE_UNIFORMS.uPine;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aFol;\n${WIND_GLSL}${pine ? PINE_VERTEX_PARS : ''}${puff ? PUFF_DEPTH_PARS : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${pine ? PINE_DEPTH_MORPH : ''}${puff ? PUFF_JITTER : ''}${INSTANCED_WIND}${puff ? PUFF_EXPAND_DEPTH : ''}`);
  };
  mat.customProgramCacheKey = () => (pine ? 'foliage-depth1p' : puff ? 'foliage-depth1b' : 'foliage-depth1');
  DEPTH[key] = mat;
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
