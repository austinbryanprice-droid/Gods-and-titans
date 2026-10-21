// Terrain for the game renderer (DESIGN 8): one smooth-shaded surface over the
// ground field (ground-field.js: the sim's cosmetic vertex heights as a smooth
// Catmull-Rom surface, rounded organic shorelines, rock tiles raised into
// sandstone outcrops), built as 16x16 tile chunks over shared vertices (FIELD_RES
// samples a tile, so a tile edge is never a facet and the light flows over it) so
// only the chunks in view are drawn. It is textured per pixel from a procedural
// texture array (terrain-textures.js: lush and dry grass, dirt, sand, rock,
// forest floor, lake bed, cliff face). A one-texel-per-tile map of ground types
// is looked up through a noise-warped grid, so borders meander instead of
// following tile edges, and neighboring types blend by their texture heights
// (grass tufts poke through dirt, sand fills between pebbles); roads stay
// connected across diagonal steps, and lush and dry grass cross-fade along a
// smooth per-pixel dryness field. A small data texture carries what the field
// knows per sample (distance to the shore, outcrop rise, forest share, cavity)
// so the shader can put the shore where the field put it: the lake bed only
// under the water, a pale sand band that darkens to damp sand at the waterline
// and a sand shelf in the shallows, whatever the tile map says. On top: macro
// color variation and a repetition breaker against visible tiling, sandstone on
// steep slopes (the top texture on the flat, strata and grooves on the faces,
// shaded dark at the foot and light on the crest), per-pixel bump lighting from
// the texture heights (screen-space derivatives, no tangents), animated
// caustics on the lake bed; the water (terrain-water.js) and a misty dark border
// beyond the map edge. Every material samples the fog of war; the lit ones get
// the drifting cloud shadows (shading.js).
//
//   const t = createTerrain(mapData, { quality: 'medium' });
//   scene.add(t.group); t.update(timeSec); t.setQuality('high'); t.dispose();
import * as THREE from 'three';
import { TERRAIN } from '../config.js';
import { heightAt } from './height.js';
import { patchFowMaterial, FOW_UNIFORMS } from './fog.js';
import { patchWorldMaterial } from './shading.js';
import { LAYER, LAYER_COUNT, createTerrainTextures } from './terrain-textures.js';
import { WATER_LEVEL, buildWater, setWaterQuality } from './terrain-water.js';
import { FIELD_RES, SHORE_MIN, SHORE_MAX, RISE_MAX, groundField } from './ground-field.js';

export { WATER_LEVEL, buildWater };

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, s) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, s);
  const b = hash2(x0 + 1, y0, s);
  const c = hash2(x0, y0 + 1, s);
  const d = hash2(x0 + 1, y0 + 1, s);
  return a + (b - a) * sx + (c - a + (d - c - b + a) * sx) * sy;
}

/**
 * Per-layer shading parameters: x = texture repeats per tile, y = height-blend
 * bias (how readily the type wins at a border), z = bump depth (world units
 * for the full texture height range), w = roughness.
 */
const LAYER_PARAMS = [];
LAYER_PARAMS[LAYER.GRASS] = [1 / 3, 0.04, 0.024, 0.93];
LAYER_PARAMS[LAYER.DRY] = [1 / 3, 0.02, 0.024, 0.95];
LAYER_PARAMS[LAYER.DIRT] = [1 / 3.5, 0, 0.04, 0.9];
LAYER_PARAMS[LAYER.SAND] = [1 / 4, -0.02, 0.03, 0.86];
LAYER_PARAMS[LAYER.ROCK] = [1 / 4.5, 0.1, 0.07, 0.78];
LAYER_PARAMS[LAYER.FOREST] = [1 / 3, 0.03, 0.04, 0.96];
LAYER_PARAMS[LAYER.BED] = [1 / 3.5, 0, 0.04, 0.7];
// sandstone strata on the outcrop walls: x repeats per tile along the wall (the rest as above)
LAYER_PARAMS[LAYER.FACE] = [1 / 3, 0.1, 0.035, 0.8];
/** Wall texture repeats per world unit of height (a texture tile of strata is 1.5 units tall). */
const FACE_V = 1 / 1.5;

/** Shader detail per quality tier (GLSL defines). */
const QUALITY_DEFINES = {
  low: {},
  medium: { TERRAIN_BUMP: '', TERRAIN_CAUSTICS: '', TERRAIN_FACE: '' },
  high: { TERRAIN_BUMP: '', TERRAIN_CAUSTICS: '', TERRAIN_ANTITILE: '', TERRAIN_FACE: '' },
  ultra: { TERRAIN_BUMP: '', TERRAIN_CAUSTICS: '', TERRAIN_ANTITILE: '', TERRAIN_FACE: '' },
};
const ANISOTROPY = { low: 2, medium: 4, high: 8, ultra: 16 };

/** Tile dryness above which grass counts as a dry meadow. */
const DRY_AT = 0.64;

/**
 * Meadow dryness of every tile (row-major, roughly 0..1): a broad noise, drier
 * next to sand, lusher next to forest. Grass tiles above DRY_AT are dry
 * meadows; the ground shader interpolates the field per pixel, so lush and dry
 * grass meet along smooth curves instead of tile edges.
 * @returns {Float32Array}
 */
function tileDryness(map) {
  const W = map.width;
  const H = map.height;
  const T = map.terrain;
  const seed = (Number(map.seed) | 0) || 7;
  const out = new Float32Array(W * H);
  const near = (tx, ty, code) => {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const x = tx + ox;
        const y = ty + oy;
        if (x >= 0 && y >= 0 && x < W && y < H && T[y * W + x] === code) return true;
      }
    }
    return false;
  };
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      let dry = vnoise((tx + 0.5) / 15, (ty + 0.5) / 15, seed + 1) * 0.75 + vnoise((tx + 0.5) / 4, (ty + 0.5) / 4, seed + 2) * 0.25;
      if (near(tx, ty, TERRAIN.SAND)) dry += 0.12;
      if (near(tx, ty, TERRAIN.FOREST)) dry -= 0.1;
      out[ty * W + tx] = dry;
    }
  }
  return out;
}

/**
 * Ground layer of every tile (LAYER codes, row-major): the terrain type, with
 * grass split into lush and dry meadows by tileDryness.
 * @param {object} map mapData
 * @param {Float32Array} [dryness] tileDryness(map), when already computed
 * @returns {Uint8Array}
 */
export function tileLayers(map, dryness = tileDryness(map)) {
  const T = map.terrain;
  const out = new Uint8Array(map.width * map.height);
  for (let i = 0; i < out.length; i++) {
    switch (T[i]) {
      case TERRAIN.DIRT: out[i] = LAYER.DIRT; break;
      case TERRAIN.SAND: out[i] = LAYER.SAND; break;
      case TERRAIN.ROCK: out[i] = LAYER.ROCK; break;
      case TERRAIN.FOREST: out[i] = LAYER.FOREST; break;
      case TERRAIN.WATER: out[i] = LAYER.BED; break;
      default: out[i] = dryness[i] > DRY_AT ? LAYER.DRY : LAYER.GRASS;
    }
  }
  return out;
}

/** Tiles per terrain chunk (a chunk is one draw call, culled on its own). */
const CHUNK = 16;

/**
 * Terrain geometry from the ground field (ground-field.js): one vertex per field
 * sample (FIELD_RES per tile), normals from the field's slope so the shading is
 * continuous over tile and chunk edges, two triangles per cell with the diagonal
 * alternating, counter-clockwise seen from above. The index runs chunk after chunk
 * (CHUNK × CHUNK tiles): geometry.userData.chunks lists { start, count, box } of
 * each, so the renderer can draw and cull them separately over shared vertices.
 * @param {object} map mapData
 * @param {import('./ground-field.js').GroundField} [field]
 */
export function buildTerrainGeometry(map, field = groundField(map)) {
  const W = map.width;
  const H = map.height ?? map.width;
  const R = FIELD_RES;
  const nx = field.nx;
  const ny = field.ny;
  const pos = new Float32Array(nx * ny * 3);
  const nor = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      pos[k] = i / R;
      pos[k + 1] = field.hgt[j * nx + i];
      pos[k + 2] = j / R;
      field.normalAt(i, j, nor, k);
    }
  }
  const idx = new Uint32Array(W * H * R * R * 6);
  const chunks = [];
  let n = 0;
  for (let cy = 0; cy < H; cy += CHUNK) {
    for (let cx = 0; cx < W; cx += CHUNK) {
      const i0 = cx * R;
      const i1 = Math.min(W, cx + CHUNK) * R;
      const j0 = cy * R;
      const j1 = Math.min(H, cy + CHUNK) * R;
      const start = n;
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          const tl = j * nx + i;
          const tr = tl + 1;
          const bl = tl + nx;
          const br = bl + 1;
          // counter-clockwise from above (+Y): x east, z south
          if ((i + j) & 1) {
            idx[n++] = tl; idx[n++] = bl; idx[n++] = br;
            idx[n++] = tl; idx[n++] = br; idx[n++] = tr;
          } else {
            idx[n++] = tl; idx[n++] = bl; idx[n++] = tr;
            idx[n++] = tr; idx[n++] = bl; idx[n++] = br;
          }
        }
      }
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const h = field.hgt[j * nx + i];
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      const box = new THREE.Box3(new THREE.Vector3(i0 / R, lo, j0 / R), new THREE.Vector3(i1 / R, hi, j1 / R));
      chunks.push({ cx, cy, start, count: n - start, box });
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.userData.chunks = chunks;
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/**
 * The ground data texture the shader reads per pixel (one texel per field sample,
 * bilinear): R shore distance (SHORE_MIN..SHORE_MAX tiles, + on land), G outcrop
 * rise (0..RISE_MAX), B forest share, A cavity (0.5 flat, below it a crest).
 */
function groundDataTexture(field) {
  const tex = new THREE.DataTexture(field.dataBytes(), field.nx, field.ny, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'terrain-ground-data';
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// ground material
// ---------------------------------------------------------------------------

const TERRAIN_PARS_VERTEX = /* glsl */ `
varying vec3 vTerrainW;
varying vec3 vTerrainN;`;

const TERRAIN_VERTEX = /* glsl */ `
vTerrainW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vTerrainN = normalize( mat3( modelMatrix ) * objectNormal );`;

const TERRAIN_PARS_FRAGMENT = /* glsl */ `
uniform sampler2DArray uGround;
uniform sampler2D uTNoise;
uniform sampler2D uTFx;
uniform sampler2D uTiles;
uniform sampler2D uGData;
uniform vec4 uGMap;
uniform vec4 uTileSize; // width, height (tiles)
uniform vec4 uLayer[ ${LAYER_COUNT} ];
uniform float uTTime;
uniform float uWaterLevel;
varying vec3 vTerrainW;
varying vec3 vTerrainN;

// tile texel: r = ground layer (lush and dry grass are both GRASS), g = dryness,
// b = share of dirt around the tile (trodden routes), a = building yard contact
vec4 tileAt( ivec2 c ) {
  c = clamp( c, ivec2( 0 ), ivec2( uTileSize.xy ) - 1 );
  return texelFetch( uTiles, c, 0 );
}

int layerOf( vec4 k ) {
  return int( k.x * 255.0 + 0.5 );
}

// Which of two diagonal tile pairs stays connected through their shared
// corner: roads (dirt) first, then beaches and fords (sand).
int connectRank( int layer ) {
  return layer == ${LAYER.DIRT} ? 2 : layer == ${LAYER.SAND} ? 1 : 0;
}

// One ground layer at world point p (tiles), with explicit gradients so it can
// be sampled inside the per-pixel branches below.
vec4 groundTex( int layer, vec2 p, vec2 dx, vec2 dy, float sel ) {
  float s = uLayer[ layer ].x;
  vec2 uv = p * s;
  float fl = float( layer );
  #ifdef TERRAIN_ANTITILE
    // repetition breaker (after I. Quilez): a slow noise picks one of a series
    // of random offsets, neighboring picks cross-fade, preferring the higher texel
    float l = sel * 6.0;
    float ia = floor( l );
    float f = l - ia;
    vec2 oa = sin( vec2( 3.0, 7.0 ) * ia + fl );
    vec2 ob = sin( vec2( 3.0, 7.0 ) * ( ia + 1.0 ) + fl );
    vec4 a = textureGrad( uGround, vec3( uv + oa, fl ), dx * s, dy * s );
    vec4 b = textureGrad( uGround, vec3( uv + ob, fl ), dx * s, dy * s );
    return mix( a, b, smoothstep( 0.3, 0.7, f + ( b.a - a.a ) * 0.12 ) );
  #else
    return textureGrad( uGround, vec3( uv, fl ), dx * s, dy * s );
  #endif
}

// One ground type; the grass family cross-fades lush into dry meadow by the
// per-pixel dryness, the taller texels of either side poking through.
vec4 layerTex( int layer, vec2 p, vec2 dx, vec2 dy, float sel, float dry ) {
  if ( layer != ${LAYER.GRASS} ) return groundTex( layer, p, dx, dy, sel );
  vec4 a = vec4( 0.0 );
  vec4 b = vec4( 0.0 );
  if ( dry < 0.997 ) a = groundTex( ${LAYER.GRASS}, p, dx, dy, sel );
  if ( dry > 0.003 ) b = groundTex( ${LAYER.DRY}, p, dx, dy, sel );
  return mix( a, b, saturate( dry + ( b.a - a.a ) * 0.45 * dry * ( 1.0 - dry ) ) );
}

vec4 layerParams( int layer, float dry ) {
  return layer == ${LAYER.GRASS} ? mix( uLayer[ ${LAYER.GRASS} ], uLayer[ ${LAYER.DRY} ], dry ) : uLayer[ layer ];
}

// Sandstone: slabs seen from above; on the walls the strata, mapped from the side
// (triplanar over the two vertical planes, its beds running level along the wall).
vec4 rockTex( vec2 p, vec2 dx, vec2 dy, float sel, vec3 w, vec3 wdx, vec3 wdy, vec3 n, float wall, float warp ) {
  vec4 top = groundTex( ${LAYER.ROCK}, p, dx, dy, sel );
  #ifdef TERRAIN_FACE
    if ( wall < 0.003 ) return top;
    vec2 fs = vec2( uLayer[ ${LAYER.FACE} ].x, ${FACE_V.toFixed(4)} );
    // the beds wander up and down a little along the wall (a slow noise on the height), so they
    // do not trace perfect contour lines around the rock
    float wy = w.y + warp;
    vec4 fx = textureGrad( uGround, vec3( vec2( w.z, wy ) * fs + 0.37, ${LAYER.FACE}.0 ), vec2( wdx.z, wdx.y ) * fs, vec2( wdy.z, wdy.y ) * fs );
    vec4 fz = textureGrad( uGround, vec3( vec2( w.x, wy ) * fs, ${LAYER.FACE}.0 ), vec2( wdx.x, wdx.y ) * fs, vec2( wdy.x, wdy.y ) * fs );
    float bx = n.x * n.x;
    float bz = n.z * n.z;
    vec4 face = ( fx * bx + fz * bz ) / max( bx + bz, 1e-4 );
    return mix( top, face, wall );
  #else
    return top;
  #endif
}`;

// replaces <map_fragment>: picks and blends the ground layers into the albedo
const TERRAIN_ALBEDO = /* glsl */ `
vec2 tp = vTerrainW.xz;
vec2 tdx = dFdx( tp );
vec2 tdy = dFdy( tp );
vec4 tnA = texture2D( uTNoise, tp * 0.029 ); // ~34-tile features
vec4 tnB = texture2D( uTNoise, tp * 0.13 + 0.37 ); // ~8-tile features
vec4 tnC = texture2D( uTNoise, tp * 0.41 + 0.71 ); // ~2-tile features: ragged, hand-drawn edges
// the ground field's smooth per-pixel data (ground-field.js): shore distance (tiles, + on
// land), outcrop rise, forest share, cavity (+ hollows, - crests)
vec4 gd = texture2D( uGData, tp * uGMap.xy + uGMap.zw );
float gShore = gd.r * ${(SHORE_MAX - SHORE_MIN).toFixed(1)} + ${SHORE_MIN.toFixed(1)};
float gRise = gd.g * ${RISE_MAX.toFixed(2)};
float gForest = gd.b;
float gCav = gd.a * 2.0 - 1.0;
// The tile map is looked up through a warped grid, so type borders meander
// across tiles instead of tracing the grid; the four tiles around the warped
// point give bilinear weights, merged where they share a type.
vec2 tg = tp + ( tnB.xy - 0.5 ) * 1.1 + ( tnA.zw - 0.5 ) * 0.8 + ( tnC.xy - 0.5 ) * 0.5 - 0.5;
vec2 ti = floor( tg );
vec2 tf = tg - ti;
// smoothed weights: rounded borders instead of the diamonds plain bilinear draws
tf = tf * tf * ( 3.0 - 2.0 * tf );
ivec2 t0 = ivec2( ti );
vec4 k0 = tileAt( t0 );
vec4 k1 = tileAt( t0 + ivec2( 1, 0 ) );
vec4 k2 = tileAt( t0 + ivec2( 0, 1 ) );
vec4 k3 = tileAt( t0 + ivec2( 1, 1 ) );
int c0 = layerOf( k0 );
int c1 = layerOf( k1 );
int c2 = layerOf( k2 );
int c3 = layerOf( k3 );
// the field's shoreline (rounder than the tile grid) decides where the lake is: lake bed only out
// in the water, sand in its shallows and on dry ground that the warped tile map still calls lake
if ( gShore < - 0.6 ) {
  c0 = c1 = c2 = c3 = ${LAYER.BED};
} else if ( gShore < 0.0 ) {
  c0 = c1 = c2 = c3 = ${LAYER.SAND};
} else {
  if ( c0 == ${LAYER.BED} ) c0 = ${LAYER.SAND};
  if ( c1 == ${LAYER.BED} ) c1 = ${LAYER.SAND};
  if ( c2 == ${LAYER.BED} ) c2 = ${LAYER.SAND};
  if ( c3 == ${LAYER.BED} ) c3 = ${LAYER.SAND};
}
vec4 tw = vec4( ( 1.0 - tf.x ) * ( 1.0 - tf.y ), tf.x * ( 1.0 - tf.y ), ( 1.0 - tf.x ) * tf.y, tf.x * tf.y );
// meadow dryness: the tiles' field interpolated like the weights (continuous,
// so lush and dry grass meet along soft curves, not tile edges), noise-broken
vec4 tw0 = tw;
float tDry = smoothstep( ${(DRY_AT - 0.05).toFixed(3)}, ${(DRY_AT + 0.05).toFixed(3)}, dot( tw, vec4( k0.y, k1.y, k2.y, k3.y ) ) + ( tnB.z - 0.5 ) * 0.14 );
if ( c1 == c0 ) { tw.x += tw.y; tw.y = 0.0; }
if ( c2 == c0 ) { tw.x += tw.z; tw.z = 0.0; } else if ( c2 == c1 ) { tw.y += tw.z; tw.z = 0.0; }
if ( c3 == c0 ) { tw.x += tw.w; tw.w = 0.0; } else if ( c3 == c1 ) { tw.y += tw.w; tw.w = 0.0; } else if ( c3 == c2 ) { tw.z += tw.w; tw.w = 0.0; }
// Diagonal pairs (a checkerboard of two types): roads are 8-connected paths,
// so two dirt tiles often meet only at a corner, where bilinear weights leave a
// 50/50 saddle that pinches the road off. The pair that should stay connected
// takes 1 - |fx - fy| (or 1 - |fx + fy - 1|) instead: a band along its
// diagonal that equals the bilinear weight on the cell's border, so it joins
// the neighboring cells seamlessly.
if ( c0 == c3 && c1 == c2 && c0 != c1 ) {
  int r03 = connectRank( c0 );
  int r12 = connectRank( c1 );
  if ( r03 != r12 ) {
    float w = r03 > r12 ? 1.0 - abs( tf.x - tf.y ) : abs( tf.x + tf.y - 1.0 );
    tw = vec4( w, 1.0 - w, 0.0, 0.0 );
  }
}
// sandstone: the raised outcrops (their rise from the field, whatever the warped tile map
// says) and any steep slope; the steeper, the more the side texture takes over
vec3 wn = normalize( vTerrainN );
vec3 wdx = dFdx( vTerrainW );
vec3 wdy = dFdy( vTerrainW );
float tWall = smoothstep( 0.72, 0.45, wn.y );
float tSlopeRock = max( smoothstep( 0.9, 0.78, wn.y ), smoothstep( 0.06, 0.3, gRise ) );
tw *= 1.0 - tSlopeRock;
float tSel = tnB.z;
vec4 s0 = vec4( 0.0 );
vec4 s1 = vec4( 0.0 );
vec4 s2 = vec4( 0.0 );
vec4 s3 = vec4( 0.0 );
vec4 sR = vec4( 0.0 );
if ( tw.x > 0.003 ) s0 = layerTex( c0, tp, tdx, tdy, tSel, tDry );
if ( tw.y > 0.003 ) s1 = layerTex( c1, tp, tdx, tdy, tSel, tDry );
if ( tw.z > 0.003 ) s2 = layerTex( c2, tp, tdx, tdy, tSel, tDry );
if ( tw.w > 0.003 ) s3 = layerTex( c3, tp, tdx, tdy, tSel, tDry );
if ( tSlopeRock > 0.003 ) sR = rockTex( tp, tdx, tdy, tSel, vTerrainW, wdx, wdy, wn, tWall, ( tnB.x - 0.5 ) * 0.14 + ( tnC.w - 0.5 ) * 0.08 );
vec4 L0 = layerParams( c0, tDry );
vec4 L1 = layerParams( c1, tDry );
vec4 L2 = layerParams( c2, tDry );
vec4 L3 = layerParams( c3, tDry );
vec4 LR = mix( uLayer[ ${LAYER.ROCK} ], uLayer[ ${LAYER.FACE} ], tWall );
// Height blend: each type scores its weight plus a little of its texel height,
// and the types within a wide band of the best score show, weighted by how close
// they are. Borders stay irregular (tufts poke over soil) without the hard
// threshold that turned the texel noise into pixel speckle.
vec4 tsc = tw + ( vec4( s0.a, s1.a, s2.a, s3.a ) + vec4( L0.y, L1.y, L2.y, L3.y ) ) * 0.4;
tsc = mix( vec4( -9.0 ), tsc, step( 0.003, tw ) );
float tscR = tSlopeRock > 0.003 ? tSlopeRock + ( sR.a + LR.y ) * 0.4 : -9.0;
float tm = max( max( max( tsc.x, tsc.y ), max( tsc.z, tsc.w ) ), tscR ) - 0.24;
vec4 tb = max( tsc - tm, 0.0 );
float tbR = max( tscR - tm, 0.0 );
float tbs = 1.0 / max( tb.x + tb.y + tb.z + tb.w + tbR, 1e-4 );
tb *= tbs;
tbR *= tbs;
vec3 tAlbedo = s0.rgb * tb.x + s1.rgb * tb.y + s2.rgb * tb.z + s3.rgb * tb.w + sR.rgb * tbR;
float tBump = dot( tb, vec4( s0.a * L0.z, s1.a * L1.z, s2.a * L2.z, s3.a * L3.z ) ) + tbR * sR.a * LR.z * ( 1.0 - 0.96 * tWall );
float tRough = dot( tb, vec4( L0.w, L1.w, L2.w, L3.w ) ) + tbR * LR.w;
// share of the pixel that is soil / meadow (by layer), and of the border band
// between them (from the plain weights, before the texel heights roughen it)
float tDirtShow = ( c0 == ${LAYER.DIRT} ? tb.x : 0.0 ) + ( c1 == ${LAYER.DIRT} ? tb.y : 0.0 ) + ( c2 == ${LAYER.DIRT} ? tb.z : 0.0 ) + ( c3 == ${LAYER.DIRT} ? tb.w : 0.0 );
float tGrassW = ( c0 == ${LAYER.GRASS} ? tw.x : 0.0 ) + ( c1 == ${LAYER.GRASS} ? tw.y : 0.0 ) + ( c2 == ${LAYER.GRASS} ? tw.z : 0.0 ) + ( c3 == ${LAYER.GRASS} ? tw.w : 0.0 );
float tSandShow = ( c0 == ${LAYER.SAND} ? tb.x : 0.0 ) + ( c1 == ${LAYER.SAND} ? tb.y : 0.0 ) + ( c2 == ${LAYER.SAND} ? tb.z : 0.0 ) + ( c3 == ${LAYER.SAND} ? tb.w : 0.0 );
// moist soil: a short darker, smoother band on the dirt side of a meadow border
float tMoist = smoothstep( 0.0, 0.18, tGrassW ) * ( 1.0 - smoothstep( 0.3, 0.62, tGrassW ) );
tMoist *= tDirtShow * ( 0.75 + 0.25 * tnC.z );
tAlbedo *= 1.0 - 0.22 * tMoist;
tAlbedo = mix( tAlbedo, tAlbedo * vec3( 0.95, 0.9, 0.84 ), tMoist * 0.5 );
tRough = mix( tRough, 0.74, tMoist );
tBump *= 1.0 - 0.45 * tMoist;
// trodden earth: packed darker and smoother along routes (dirt density around
// the tile) and right around buildings (yard contact), nothing raised
float tWear = saturate( dot( tw0, vec4( k0.z, k1.z, k2.z, k3.z ) ) * 1.25 - 0.45 ) * 0.55 + saturate( dot( tw0, vec4( k0.w, k1.w, k2.w, k3.w ) ) ) * 0.85;
tWear = saturate( tWear ) * tDirtShow * ( 0.8 + 0.2 * tnC.w );
tAlbedo *= 1.0 - 0.2 * tWear;
tRough = mix( tRough, 0.8, tWear * 0.6 );
tBump *= 1.0 - 0.35 * tWear;
// sandstone beds on the walls: layers about a hand high, each one a shade of its own, lighter
// at its top lip and darker where the soft rock has weathered back under the bed above
float tBedY = ( vTerrainW.y + ( tnB.x - 0.5 ) * 0.14 + ( tnC.w - 0.5 ) * 0.08 ) * 7.0 + tnC.y * 0.6;
float tBedH = fract( sin( floor( tBedY ) * 12.9898 + 4.1 ) * 43758.5453 );
vec3 tBed = mix( vec3( 1.0 ), vec3( 1.06, 0.97, 0.87 ), tBedH ) * ( 0.92 + 0.14 * fract( tBedY ) );
tAlbedo *= mix( vec3( 1.0 ), tBed, tbR * tWall );
// the foot of a cliff sits in its own shade
tAlbedo *= 1.0 - 0.4 * tbR * smoothstep( 0.0, 0.05, gRise ) * ( 1.0 - smoothstep( 0.06, 0.34, gRise ) );
// moss and a little meadow soil on the level tops, mostly low down where the grass creeps up
float tMossTop = smoothstep( 0.5, 0.78, tnB.w * 0.6 + tnC.x * 0.4 ) * smoothstep( 0.88, 0.97, wn.y ) * ( 1.0 - 0.5 * smoothstep( 0.2, 0.7, gRise ) );
tAlbedo = mix( tAlbedo, vec3( 0.2, 0.3, 0.1 ) * ( 0.8 + 0.4 * tnA.x ), tbR * tMossTop * 0.7 );
// the finest relief only reads while a pixel covers about a texel or less: fade
// it out beyond that so panning and zooming do not shimmer
float tFoot = max( length( tdx ), length( tdy ) ) * 90.0;
tBump *= 1.0 - smoothstep( 0.7, 2.6, tFoot );
// macro variation: broad brightness and hue drift hides what repetition is left
// (the layers carry little low-frequency content of their own for that reason)
float tMacro = tnA.x * 0.6 + tnB.x * 0.25 + tnB.w * 0.15;
tAlbedo *= 0.8 + 0.4 * tMacro;
tAlbedo = mix( tAlbedo, tAlbedo * vec3( 1.08, 1.03, 0.88 ), smoothstep( 0.45, 0.85, tnA.y ) * 0.5 );
// painted meadow: on grass only, broad russet / olive autumn drifts and darker
// teal moss hollows break the single green into a hand-painted patchwork
float tGreen = clamp( ( tAlbedo.g - max( tAlbedo.r, tAlbedo.b ) ) * 9.0, 0.0, 1.0 );
float tAut = smoothstep( 0.38, 0.74, tnA.w * 0.7 + tnB.y * 0.3 );
tAlbedo = mix( tAlbedo, tAlbedo * vec3( 1.42, 0.98, 0.62 ), tAut * tGreen * 0.75 );
float tMoss = smoothstep( 0.5, 0.82, tnA.z * 0.75 + tnB.w * 0.25 );
tAlbedo = mix( tAlbedo, tAlbedo * vec3( 0.74, 0.9, 0.86 ), tMoss * tGreen * 0.6 );
// shore: damp sand along the waterline (a little darker, glossier, a deeper gold) that the
// water laps up and down and that dries out to pale, sun-bleached sand a tile further up,
// dustier and warmer up the beach
float tAbove = vTerrainW.y - uWaterLevel;
float tLap = 0.12 * sin( uTTime * 1.3 + tp.x * 0.7 + tp.y * 0.5 ) + 0.07 * sin( uTTime * 0.8 - tp.x * 1.7 + tp.y * 1.1 );
float tUnder = 1.0 - smoothstep( -0.02, 0.0, tAbove );
float tWet = ( 1.0 - smoothstep( 0.0, 0.8, gShore + tLap ) ) * ( 1.0 - tUnder );
tAlbedo *= 1.0 - 0.14 * tWet;
tAlbedo = mix( tAlbedo, tAlbedo * vec3( 1.04, 0.95, 0.84 ), tWet * 0.55 );
tRough = mix( mix( tRough, 0.42, tWet ), 0.9, tUnder );
tBump *= 1.0 - 0.5 * tWet;
tAlbedo = mix( tAlbedo, tAlbedo * vec3( 1.03, 1.03, 1.01 ), tSandShow * smoothstep( 0.6, 1.2, gShore ) * ( 1.0 - smoothstep( 1.4, 2.8, gShore ) ) );
tAlbedo = mix( tAlbedo, tAlbedo * vec3( 0.97, 0.9, 0.78 ), tSandShow * smoothstep( 1.8, 3.6, gShore ) * 0.7 );
// under the water the lake bed is sand in the shallows (a shade darker the deeper), dark silt and
// pebbles out in the deep; the bump gives way at the seam between the two
float tShelf = smoothstep( - 1.8, - 0.65, gShore );
if ( tShelf > 0.003 && gShore < 0.0 ) tAlbedo = mix( tAlbedo, groundTex( ${LAYER.SAND}, tp, tdx, tdy, tSel ).rgb * mix( vec3( 1.0 ), vec3( 0.78, 0.74, 0.66 ), smoothstep( 0.0, 0.5, - gShore ) ), tShelf );
tBump *= smoothstep( 0.0, 0.06, abs( gShore + 0.6 ) );
// under the canopy the ground is darker and a touch cooler; hollows and cliff feet are
// shaded, crests catch more light (from the smooth field, so no tile-sized blotches)
tAlbedo *= 1.0 - 0.22 * gForest;
tAlbedo *= vec3( 1.0 - 0.04 * gForest, 1.0, 1.0 + 0.03 * gForest );
tAlbedo *= 1.0 - 0.3 * max( gCav, 0.0 ) + 0.12 * max( - gCav, 0.0 );
diffuseColor.rgb *= tAlbedo;`;

const TERRAIN_BUMP = /* glsl */ `
#ifdef TERRAIN_BUMP
{
  // bump from the blended texture height: its screen-space gradient tilts the
  // normal (Mikkelsen's surface-gradient bump; no tangents needed)
  vec3 sx = dFdx( - vViewPosition );
  vec3 sy = dFdy( - vViewPosition );
  vec2 dh = vec2( dFdx( tBump ), dFdy( tBump ) );
  // keep the tilt gentle: the height field is 8 bit and one pixel-quad wide, so
  // unbounded slopes would show as black and white speckle
  float dhMax = 0.5 * max( length( tdx ), length( tdy ) );
  dh *= min( 1.0, dhMax / max( length( dh ), 1e-6 ) );
  vec3 r1 = cross( sy, normal );
  vec3 r2 = cross( normal, sx );
  float det = dot( sx, r1 ) * faceDirection;
  vec3 grad = sign( det ) * ( dh.x * r1 + dh.y * r2 );
  normal = normalize( abs( det ) * normal - grad );
}
#endif`;

const TERRAIN_CAUSTICS = /* glsl */ `
#ifdef TERRAIN_CAUSTICS
if ( tUnder > 0.0 ) {
  // two scrolling caustic webs, wobbled by the water's ripple texture; they
  // brighten the sunlight reaching the lake bed, strongest in the shallows
  vec2 cw = textureGrad( uTFx, tp * 0.11 + vec2( uTTime * 0.013, uTTime * 0.009 ), tdx * 0.11, tdy * 0.11 ).rg - 0.5;
  vec2 cq = tp * 0.19 + cw * 0.35;
  float ca = textureGrad( uTFx, cq + vec2( - uTTime * 0.009, uTTime * 0.006 ), tdx * 0.19, tdy * 0.19 ).b;
  float cb = textureGrad( uTFx, cq * 1.37 + vec2( uTTime * 0.007, uTTime * 0.01 ) + 0.5, tdx * 0.26, tdy * 0.26 ).b;
  float caust = ( ca + cb ) * 0.5 + ca * cb * 1.6;
  float cfade = smoothstep( 0.0, 0.08, - tAbove ) * ( 1.0 - smoothstep( 0.2, 0.6, - tAbove ) );
  reflectedLight.directDiffuse *= 1.0 + caust * 1.0 * cfade;
}
#endif`;

/**
 * The ground material: a MeshStandardMaterial (rough, so it takes the sky's
 * image-based light like the models) with the layer blending patched in.
 */
function terrainMaterial(textures, tiles, gdata, field, map, time, quality) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0 });
  mat.name = 'terrain';
  const uniforms = {
    uGround: { value: textures.ground },
    uTNoise: { value: textures.noise },
    uTFx: { value: textures.fx },
    uTiles: { value: tiles },
    uTileSize: { value: new THREE.Vector4(map.width, map.height, 1 / map.width, 1 / map.height) },
    uGData: { value: gdata },
    // world (tiles) → ground data uv: one texel per field sample, texel centers on the samples
    uGMap: { value: new THREE.Vector4(FIELD_RES / field.nx, FIELD_RES / field.ny, 0.5 / field.nx, 0.5 / field.ny) },
    uLayer: { value: LAYER_PARAMS.map((p) => new THREE.Vector4(...p)) },
    uTTime: time,
    uWaterLevel: { value: WATER_LEVEL },
  };
  mat.userData.terrainUniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_PARS_VERTEX}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${TERRAIN_VERTEX}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_PARS_FRAGMENT}`)
      .replace('#include <map_fragment>', TERRAIN_ALBEDO)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${TERRAIN_BUMP}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${TERRAIN_CAUSTICS}`);
  };
  mat.customProgramCacheKey = () => 'mythicwar-terrain-v5';
  setTerrainQuality(mat, quality);
  // order matters: the fog-of-war patch keeps the hooks installed before it
  patchWorldMaterial(mat, { cloud: true });
  patchFowMaterial(mat);
  return mat;
}

function setTerrainQuality(mat, quality) {
  mat.defines = { ...(QUALITY_DEFINES[quality] || QUALITY_DEFINES.medium) };
  mat.needsUpdate = true;
}

/**
 * Share of dirt among the tile and its 8 neighbors (0 off dirt): high in the
 * middle of roads and yards, low on their margins. The ground shader reads it
 * as "trodden" and packs the earth a little darker there. Writes the B channel
 * of the tile texture for the tiles in the rectangle (inclusive-exclusive).
 */
function writeDirtDensity(data, W, H, x0, y0, x1, y1) {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
      const i = y * W + x;
      if (data[i * 4] !== LAYER.DIRT) {
        data[i * 4 + 2] = 0;
        continue;
      }
      let n = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = Math.min(W - 1, Math.max(0, x + ox));
          const ny = Math.min(H - 1, Math.max(0, y + oy));
          if (data[(ny * W + nx) * 4] === LAYER.DIRT) n++;
        }
      }
      data[i * 4 + 2] = Math.round((n / 9) * 255);
    }
  }
}

/**
 * Ground per tile as a texture (texelFetch'ed by the ground shader): R the
 * layer, with lush and dry grass both stored as GRASS (one family, split per
 * pixel), G the meadow dryness (0..1), B the dirt density around the tile
 * (trodden routes), A contact with a building yard (paintYard).
 */
function tileTexture(map) {
  const dryness = tileDryness(map);
  const layers = tileLayers(map, dryness);
  const data = new Uint8Array(layers.length * 4);
  for (let i = 0; i < layers.length; i++) {
    data[i * 4] = layers[i] === LAYER.DRY ? LAYER.GRASS : layers[i];
    data[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, dryness[i])) * 255);
  }
  writeDirtDensity(data, map.width, map.height, 0, 0, map.width, map.height);
  const tex = new THREE.DataTexture(data, map.width, map.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'terrain-tiles';
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// beyond the map edge
// ---------------------------------------------------------------------------

const BORDER_VS = /* glsl */ `
varying vec2 vXZ;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// The world ends in the same drifting dark mist that covers unexplored land
// (fog.js fowApply): it rises out of the black rim the fog of war gives the
// last tile and thins out into darkness further away.
const BORDER_FS = /* glsl */ `
uniform vec2 uMapSize;
uniform sampler2D uFowNoise;
uniform float uFowTime;
uniform float uFowPow;
varying vec2 vXZ;
void main() {
  vec2 d = max( max( - vXZ, vXZ - uMapSize ), 0.0 );
  float dist = length( d );
  vec2 q = vXZ * 0.045 + vec2( uFowTime * 0.006, uFowTime * 0.0035 );
  float m = texture2D( uFowNoise, q ).g * 0.6 + texture2D( uFowNoise, q * 2.7 + 0.3 ).r * 0.4;
  vec3 mist = vec3( 0.075, 0.085, 0.1 ) * ( 0.35 + 0.9 * smoothstep( 0.3, 0.8, m ) );
  mist *= smoothstep( 0.2, 3.0, dist ) * ( 1.0 - smoothstep( 6.0, 34.0, dist ) * 0.85 );
  gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // the mist is tuned in display space like the shroud's (see fowApply)
  gl_FragColor.rgb += pow( mist, vec3( uFowPow ) );
}`;

function borderMesh(map) {
  const geo = new THREE.PlaneGeometry(map.width + 600, map.height + 600);
  geo.rotateX(-Math.PI / 2);
  geo.translate(map.width / 2, -0.9, map.height / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMapSize: { value: new THREE.Vector2(map.width, map.height) },
      uFowNoise: FOW_UNIFORMS.uFowNoise,
      uFowTime: FOW_UNIFORMS.uFowTime,
      uFowPow: FOW_UNIFORMS.uFowPow,
    },
    vertexShader: BORDER_VS,
    fragmentShader: BORDER_FS,
  });
  mat.name = 'terrain-border';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain-border';
  // after the ground and everything else opaque: the depth test then skips the
  // (large) part of the plane hidden under the map
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/**
 * Build terrain, water and the border beyond the map edge for a map.
 * @param {object} map mapData (width, height, terrain, heights, seed)
 * @param {{ quality?: 'low'|'medium'|'high'|'ultra' }} [o]
 * @returns {{group: THREE.Group, terrain: THREE.Group, chunks: THREE.Mesh[], material: THREE.Material, field: object, water: THREE.Mesh|null, border: THREE.Mesh,
 *   height: (x:number,y:number)=>number, update: (timeSec:number)=>void, setQuality: (q:string)=>void, dispose: ()=>void}}
 */
export function createTerrain(map, { quality = 'medium' } = {}) {
  const q = QUALITY_DEFINES[quality] ? quality : 'medium';
  const group = new THREE.Group();
  group.name = 'terrain-group';
  const textures = createTerrainTextures(ANISOTROPY[q]);
  const tiles = tileTexture(map);
  const time = { value: 0 };
  const field = groundField(map);
  const gdata = groundDataTexture(field);
  const geo = buildTerrainGeometry(map, field);
  const mat = terrainMaterial(textures, tiles, gdata, field, map, time, q);
  // one mesh per chunk over the shared vertices, so only the chunks in view are drawn
  const terrain = new THREE.Group();
  terrain.name = 'terrain';
  const chunks = [];
  const chunkGeos = [];
  for (const c of geo.userData.chunks) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.attributes.position);
    g.setAttribute('normal', geo.attributes.normal);
    g.setIndex(new THREE.BufferAttribute(geo.index.array.subarray(c.start, c.start + c.count), 1));
    g.boundingBox = c.box.clone();
    g.boundingSphere = c.box.getBoundingSphere(new THREE.Sphere());
    const m = new THREE.Mesh(g, mat);
    m.name = `terrain-${c.cx}-${c.cy}`;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    terrain.add(m);
    chunks.push(m);
    chunkGeos.push(g);
  }
  group.add(terrain);

  const water = buildWater(map, { fx: textures.fx, noise: textures.noise, time, hq: q !== 'low', field });
  if (water) group.add(water);

  const border = borderMesh(map);
  group.add(border);

  return {
    group,
    terrain,
    chunks,
    material: mat,
    field,
    water,
    border,
    height: (x, y) => heightAt(map, x, y),
    update(timeSec) {
      time.value = timeSec;
    },
    /**
     * Wear the meadow around a building down to bare earth: the footprint and a
     * ring around it (ragged corners) turn to dirt, so towns stand in trodden
     * yards rather than on clean grass. Other ground (sand, rock, forest) keeps
     * its look. Cosmetic only; the yard stays after the building is gone.
     */
    paintYard(tx, ty, size, ring = 1) {
      const W = map.width;
      const H = map.height;
      const data = tiles.image.data;
      let changed = false;
      let touched = false;
      for (let y = ty - ring; y < ty + size + ring; y++) {
        for (let x = tx - ring; x < tx + size + ring; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const corner = (x < tx || x >= tx + size) && (y < ty || y >= ty + size);
          const i = y * W + x;
          // contact: the packed earth right at the walls (footprint and the ring
          // beside it), a little less at the ragged corners; shader-only
          const contact = corner ? 150 : x < tx || x >= tx + size || y < ty || y >= ty + size ? 215 : 255;
          if (data[i * 4 + 3] < contact) {
            data[i * 4 + 3] = contact;
            touched = true;
          }
          if (corner && ((x * 7 + y * 13) & 3) !== 0) continue;
          if (data[i * 4] !== LAYER.GRASS) continue;
          data[i * 4] = LAYER.DIRT;
          changed = true;
        }
      }
      if (changed) writeDirtDensity(data, W, H, tx - ring - 1, ty - ring - 1, tx + size + ring + 1, ty + size + ring + 1);
      if (changed || touched) tiles.needsUpdate = true;
      return changed;
    },
    /** Shader detail and texture filtering for a quality tier. */
    setQuality(next) {
      if (!QUALITY_DEFINES[next]) return;
      setTerrainQuality(mat, next);
      if (water) setWaterQuality(water.material, next !== 'low');
      if (textures.ground.anisotropy !== ANISOTROPY[next]) {
        textures.ground.anisotropy = ANISOTROPY[next];
        textures.ground.needsUpdate = true;
      }
    },
    dispose() {
      group.removeFromParent();
      for (const g of chunkGeos) g.dispose();
      geo.dispose();
      mat.dispose();
      gdata.dispose();
      tiles.dispose();
      textures.dispose();
      if (water) {
        water.geometry.dispose();
        water.material.dispose();
      }
      border.geometry.dispose();
      border.material.dispose();
    },
  };
}
