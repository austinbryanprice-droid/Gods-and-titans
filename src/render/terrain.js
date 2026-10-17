// Terrain for the game renderer (DESIGN 8): one vertex-colored, flat-shaded
// mesh built from mapData.heights and the terrain codes (grass with color
// noise, dirt, sand, rock, forest floor, lake bed) with a generated detail
// texture sampled at two scales, a translucent animated water surface at the
// level the map generator lines up with tile edges, and a dark ground plane
// beyond the map edge. Every material samples the fog of war.
import * as THREE from 'three';
import { TERRAIN } from '../config.js';
import { heightAt } from './height.js';
import { patchFowMaterial, FOW_UNIFORMS, FOW_PARS_FRAGMENT } from './fog.js';

/** Water surface height (notes/decisions.md [map]: lines up with the tile edges). */
export const WATER_LEVEL = -0.2;

const DETAIL_SCALE = 1 / 5; // detail texture repeats every 5 tiles (second sample at ~1/18)
const DETAIL_MEAN = 0.9;

// sRGB palette per terrain code
const PALETTE = {
  grass: ['#5c8a35', '#6f9a3e', '#7f9a44'], // base, lush, dry patch
  dirt: ['#8c6c45', '#7a5c3a'],
  sand: ['#d2bb84', '#c4a970'],
  rock: ['#8d8b82', '#6e6c66'],
  forest: ['#3b5525', '#4a5a2c'],
  water: ['#5f6a4c', '#3c4b42'], // lake bed: shallow, deep
};

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

const lin = (hex) => new THREE.Color(hex); // THREE.Color converts sRGB hex to the linear working space

/** Grayscale detail texture (RGBA, mipmapped, repeating). */
export function makeDetailTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const cell = size / 8; // value-noise lattice must tile: use periodic lattice coordinates
  const per = (x, y, s, p) => {
    // periodic value noise with period p lattice cells
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const m = (v) => ((v % p) + p) % p;
    const a = hash2(m(x0), m(y0), s);
    const b = hash2(m(x0 + 1), m(y0), s);
    const c = hash2(m(x0), m(y0 + 1), s);
    const d = hash2(m(x0 + 1), m(y0 + 1), s);
    return a + (b - a) * sx + (c - a + (d - c - b + a) * sx) * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n1 = per(x / cell, y / cell, 11, 8);
      const n2 = per(x / (cell / 2), y / (cell / 2), 12, 16);
      const n3 = per(x / (cell / 4), y / (cell / 4), 13, 32);
      const grain = hash2(x, y, 14);
      let v = 0.8 + 0.1 * n1 + 0.06 * n2 + 0.05 * n3 + 0.06 * (grain - 0.5);
      // short dark "blade" flecks and light specks
      const fleck = hash2(x >> 1, y >> 2, 15);
      if (fleck > 0.965) v -= 0.09;
      else if (fleck < 0.02) v += 0.07;
      v = Math.max(0, Math.min(1, v));
      const i = (y * size + x) * 4;
      const b = Math.round(v * 255);
      data[i] = b;
      data[i + 1] = b;
      data[i + 2] = b;
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
  tex.name = 'terrain-detail';
  tex.needsUpdate = true;
  return tex;
}

/**
 * Per-vertex terrain colors (linear RGB): the corner grid, tile centers and the
 * midpoints of horizontal (top/bottom) and vertical (left/right) tile edges.
 * Corners average their four tiles, edge midpoints their two, and centers lean
 * a little toward their neighbors, so a lone dirt tile reads as a soft patch.
 * @returns {{corner: Float32Array, center: Float32Array, hEdge: Float32Array, vEdge: Float32Array}}
 */
export function terrainColors(map) {
  const W = map.width;
  const H = map.height;
  const T = map.terrain;
  const seed = (Number(map.seed) | 0) || 7;
  const C = {};
  for (const [k, list] of Object.entries(PALETTE)) C[k] = list.map(lin);
  const tmp = new THREE.Color();
  const tileCol = new Float32Array(W * H * 3);
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const i = ty * W + tx;
      const t = T[i];
      const cx = tx + 0.5;
      const cy = ty + 0.5;
      const big = vnoise(cx / 14, cy / 14, seed + 1);
      const mid = vnoise(cx / 4.5, cy / 4.5, seed + 2);
      switch (t) {
        case TERRAIN.DIRT:
          tmp.copy(C.dirt[0]).lerp(C.dirt[1], mid);
          break;
        case TERRAIN.SAND:
          tmp.copy(C.sand[0]).lerp(C.sand[1], mid * 0.7);
          break;
        case TERRAIN.ROCK:
          tmp.copy(C.rock[0]).lerp(C.rock[1], mid);
          break;
        case TERRAIN.FOREST:
          tmp.copy(C.forest[0]).lerp(C.forest[1], mid);
          break;
        case TERRAIN.WATER:
          tmp.copy(C.water[0]);
          break;
        default: {
          tmp.copy(C.grass[0]).lerp(C.grass[1], Math.min(1, mid * 1.2));
          const dry = Math.max(0, big - 0.58) * 2.4;
          tmp.lerp(C.grass[2], Math.min(0.75, dry));
        }
      }
      tileCol[i * 3] = tmp.r;
      tileCol[i * 3 + 1] = tmp.g;
      tileCol[i * 3 + 2] = tmp.b;
    }
  }
  const hs = map.heights;
  const VW = W + 1;
  const hAt = (vx, vy) => (hs ? hs[vy * VW + vx] : 0);
  // brightness factor of a vertex: detail-texture compensation, a little
  // per-vertex variation, shade at forest edges, sunlit hilltops, deep lake beds
  const shade = (h, forestShare, hash) => {
    let k = (1 / DETAIL_MEAN) * (0.94 + 0.12 * hash);
    k *= 1 - 0.28 * forestShare;
    if (h > 0.25) k *= 1 + (h - 0.25) * 0.12;
    if (h < -0.3) k *= 0.82 + 0.3 * Math.max(0, h + 0.6);
    return k;
  };
  // average of the tiles (tx, ty) for (tx, ty) in the list that exist, written to out[o..o+2]
  const acc = [0, 0, 0, 0, 0]; // r g b n forest
  const addTile = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return;
    const i = ty * W + tx;
    acc[0] += tileCol[i * 3];
    acc[1] += tileCol[i * 3 + 1];
    acc[2] += tileCol[i * 3 + 2];
    acc[3]++;
    if (T[i] === TERRAIN.FOREST) acc[4]++;
  };
  const flush = (out, o, h, hash) => {
    const n = acc[3] || 1;
    const k = shade(h, acc[4] / n, hash);
    out[o] = (acc[0] / n) * k;
    out[o + 1] = (acc[1] / n) * k;
    out[o + 2] = (acc[2] / n) * k;
    acc[0] = acc[1] = acc[2] = acc[3] = acc[4] = 0;
  };

  const corner = new Float32Array(VW * (H + 1) * 3);
  for (let vy = 0; vy <= H; vy++) {
    for (let vx = 0; vx <= W; vx++) {
      addTile(vx - 1, vy - 1);
      addTile(vx, vy - 1);
      addTile(vx - 1, vy);
      addTile(vx, vy);
      flush(corner, (vy * VW + vx) * 3, hAt(vx, vy), hash2(vx, vy, seed + 3));
    }
  }
  // horizontal edges: on grid line vy, between corners (tx, vy) and (tx + 1, vy)
  const hEdge = new Float32Array(W * (H + 1) * 3);
  for (let vy = 0; vy <= H; vy++) {
    for (let tx = 0; tx < W; tx++) {
      addTile(tx, vy - 1);
      addTile(tx, vy);
      flush(hEdge, (vy * W + tx) * 3, (hAt(tx, vy) + hAt(tx + 1, vy)) / 2, hash2(tx * 2 + 1, vy * 2, seed + 5));
    }
  }
  // vertical edges: on grid line vx, between corners (vx, ty) and (vx, ty + 1)
  const vEdge = new Float32Array(VW * H * 3);
  for (let ty = 0; ty < H; ty++) {
    for (let vx = 0; vx <= W; vx++) {
      addTile(vx - 1, ty);
      addTile(vx, ty);
      flush(vEdge, (ty * VW + vx) * 3, (hAt(vx, ty) + hAt(vx, ty + 1)) / 2, hash2(vx * 2, ty * 2 + 1, seed + 5));
    }
  }
  // centers: the tile's own color, leaning 25% toward its four neighbors
  const center = new Float32Array(W * H * 3);
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const i = ty * W + tx;
      addTile(tx - 1, ty);
      addTile(tx + 1, ty);
      addTile(tx, ty - 1);
      addTile(tx, ty + 1);
      const n = acc[3] || 1;
      const own = T[i] === TERRAIN.FOREST ? 1 : 0;
      const forestShare = 0.75 * own + 0.25 * (acc[4] / n);
      const h = (hAt(tx, ty) + hAt(tx + 1, ty) + hAt(tx, ty + 1) + hAt(tx + 1, ty + 1)) / 4;
      const k = shade(h, forestShare, hash2(i, 77, seed + 4));
      for (let c = 0; c < 3; c++) center[i * 3 + c] = (tileCol[i * 3 + c] * 0.75 + (acc[c] / n) * 0.25) * k;
      acc[0] = acc[1] = acc[2] = acc[3] = acc[4] = 0;
    }
  }
  return { corner, center, hEdge, vEdge };
}

/**
 * Terrain geometry: every tile is an 8-triangle fan around a center vertex,
 * through its four corners and four edge midpoints. Corner heights come from
 * map.heights, edge midpoints and centers from the bilinear surface, so the mesh
 * matches heightAt() at every vertex.
 */
export function buildTerrainGeometry(map) {
  const W = map.width;
  const H = map.height;
  const VW = W + 1;
  const nCorner = VW * (H + 1);
  const cBase = nCorner; // tile centers
  const hBase = cBase + W * H; // horizontal edge midpoints
  const vBase = hBase + W * (H + 1); // vertical edge midpoints
  const nVert = vBase + VW * H;
  const pos = new Float32Array(nVert * 3);
  const col = new Float32Array(nVert * 3);
  const uv = new Float32Array(nVert * 2);
  const hs = map.heights;
  const hAt = (vx, vy) => (hs ? hs[vy * VW + vx] : 0);
  const { corner, center, hEdge, vEdge } = terrainColors(map);
  const put = (i, x, y, z) => {
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    uv[i * 2] = x * DETAIL_SCALE;
    uv[i * 2 + 1] = z * DETAIL_SCALE;
  };
  for (let vy = 0; vy <= H; vy++) for (let vx = 0; vx <= W; vx++) put(vy * VW + vx, vx, hAt(vx, vy), vy);
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const h = (hAt(tx, ty) + hAt(tx + 1, ty) + hAt(tx, ty + 1) + hAt(tx + 1, ty + 1)) / 4;
      put(cBase + ty * W + tx, tx + 0.5, h, ty + 0.5);
    }
  }
  for (let vy = 0; vy <= H; vy++) {
    for (let tx = 0; tx < W; tx++) put(hBase + vy * W + tx, tx + 0.5, (hAt(tx, vy) + hAt(tx + 1, vy)) / 2, vy);
  }
  for (let ty = 0; ty < H; ty++) {
    for (let vx = 0; vx <= W; vx++) put(vBase + ty * VW + vx, vx, (hAt(vx, ty) + hAt(vx, ty + 1)) / 2, ty + 0.5);
  }
  col.set(corner, 0);
  col.set(center, cBase * 3);
  col.set(hEdge, hBase * 3);
  col.set(vEdge, vBase * 3);

  const idx = new Uint32Array(W * H * 24);
  let k = 0;
  const tri = (a, b, c) => {
    idx[k++] = a;
    idx[k++] = b;
    idx[k++] = c;
  };
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const c = cBase + ty * W + tx;
      const tl = ty * VW + tx;
      const tr = tl + 1;
      const bl = tl + VW;
      const br = bl + 1;
      const top = hBase + ty * W + tx;
      const bottom = top + W;
      const left = vBase + ty * VW + tx;
      const right = left + 1;
      // counter-clockwise seen from above (+Y): x east, z south
      tri(c, tr, top);
      tri(c, top, tl);
      tri(c, br, right);
      tri(c, right, tr);
      tri(c, bl, bottom);
      tri(c, bottom, br);
      tri(c, tl, left);
      tri(c, left, bl);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

function terrainMaterial(detail) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: detail });
  mat.name = 'terrain';
  // second, larger-scale detail sample breaks up visible tiling
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        vec4 detail2 = texture2D( map, vMapUv * 0.27 + vec2( 0.37, 0.61 ) );
        diffuseColor.rgb *= sampledDiffuseColor.rgb * ( 0.55 + 0.5 * detail2.r );
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => 'mythicwar-terrain-v1';
  patchFowMaterial(mat);
  return mat;
}

// ---------------------------------------------------------------------------
// water
// ---------------------------------------------------------------------------

const WATER_VS = `
attribute float aDepth;
varying float vDepth;
varying vec2 vXZ;
#include <fog_pars_vertex>
void main() {
  vDepth = aDepth;
  vec3 transformed = position;
  vXZ = position.xz;
  float w = sin( position.x * 1.7 + uTime * 1.3 ) * cos( position.z * 1.3 - uTime * 1.1 );
  transformed.y += w * 0.025;
  vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FS = `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSky;
varying float vDepth;
varying vec2 vXZ;
#include <common>
#include <fog_pars_fragment>
${FOW_PARS_FRAGMENT.replace('varying vec2 vFowXZ;', '')}
void main() {
  float d = clamp( vDepth / 0.42, 0.0, 1.0 );
  vec3 col = mix( uShallow, uDeep, smoothstep( 0.0, 1.0, d ) );
  // drifting ripples: two crossing wave trains, highlights on the crests
  float r1 = sin( vXZ.x * 2.3 + vXZ.y * 1.1 + uTime * 1.6 );
  float r2 = sin( vXZ.x * -1.2 + vXZ.y * 2.7 - uTime * 1.25 );
  float r3 = sin( ( vXZ.x + vXZ.y ) * 5.1 + uTime * 2.4 );
  float ripple = r1 * 0.5 + r2 * 0.5;
  col += uSky * ( 0.06 * ripple + 0.1 * pow( max( 0.0, ripple * 0.5 + r3 * 0.25 ), 4.0 ) );
  // sun glints
  float g = sin( vXZ.x * 7.3 + uTime * 0.9 ) * sin( vXZ.y * 6.1 - uTime * 1.3 ) * sin( ( vXZ.x - vXZ.y ) * 3.7 + uTime );
  col += vec3( 1.0, 0.96, 0.85 ) * smoothstep( 0.82, 0.98, g ) * 0.55;
  // foam where the water meets the shore
  float shore = 1.0 - smoothstep( 0.0, 0.09, vDepth + 0.015 * sin( vXZ.x * 6.0 + vXZ.y * 4.0 + uTime * 2.0 ) );
  col = mix( col, uFoam, shore * 0.8 );
  float alpha = mix( 0.55, 0.86, d );
  alpha = max( alpha, shore * 0.85 );
  if ( vDepth < -0.04 ) discard;
  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  gl_FragColor.rgb *= fowFactor( vXZ );
}`;

/** Water surface over every tile that dips below the water level. */
export function buildWater(map) {
  const W = map.width;
  const H = map.height;
  const VW = W + 1;
  const hs = map.heights;
  if (!hs) return null;
  const pos = [];
  const depth = [];
  const idx = [];
  const vertOf = new Int32Array(VW * (H + 1)).fill(-1);
  const vert = (vx, vy) => {
    const i = vy * VW + vx;
    if (vertOf[i] >= 0) return vertOf[i];
    const n = pos.length / 3;
    pos.push(vx, WATER_LEVEL, vy);
    depth.push(WATER_LEVEL - hs[i]);
    vertOf[i] = n;
    return n;
  };
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const a = ty * VW + tx;
      const lo = Math.min(hs[a], hs[a + 1], hs[a + VW], hs[a + VW + 1]);
      if (lo > WATER_LEVEL - 0.01 && map.terrain[ty * W + tx] !== TERRAIN.WATER) continue;
      const tl = vert(tx, ty);
      const tr = vert(tx + 1, ty);
      const bl = vert(tx, ty + 1);
      const br = vert(tx + 1, ty + 1);
      idx.push(tl, bl, tr, tr, bl, br);
    }
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uShallow: { value: lin('#3f9fb0') },
    uDeep: { value: lin('#1c5574') },
    uFoam: { value: lin('#e8f4f0') },
    uSky: { value: lin('#cfe8ff') },
  }]);
  uniforms.uFowTex = FOW_UNIFORMS.uFowTex;
  uniforms.uFowSize = FOW_UNIFORMS.uFowSize;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `uniform float uTime;\n${WATER_VS}`,
    fragmentShader: WATER_FS,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  mat.name = 'water';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.renderOrder = 1;
  return mesh;
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/**
 * Build terrain, water and the dark border plane for a map.
 * @param {object} map mapData (width, height, terrain, heights, seed)
 * @returns {{group: THREE.Group, terrain: THREE.Mesh, water: THREE.Mesh|null, height: (x:number,y:number)=>number,
 *   update: (timeSec:number)=>void, dispose: ()=>void}}
 */
export function createTerrain(map) {
  const group = new THREE.Group();
  group.name = 'terrain-group';
  const detail = makeDetailTexture();
  const geo = buildTerrainGeometry(map);
  const mat = terrainMaterial(detail);
  const terrain = new THREE.Mesh(geo, mat);
  terrain.name = 'terrain';
  terrain.receiveShadow = true;
  terrain.matrixAutoUpdate = false;
  terrain.updateMatrix();
  group.add(terrain);

  const water = buildWater(map);
  if (water) group.add(water);

  // dark ground beyond the map edge (the fog fades the last tile into it)
  const bGeo = new THREE.PlaneGeometry(map.width + 600, map.height + 600);
  bGeo.rotateX(-Math.PI / 2);
  bGeo.translate(map.width / 2, -0.9, map.height / 2);
  const bMat = new THREE.MeshBasicMaterial({ color: 0x050605, fog: false });
  bMat.name = 'terrain-border';
  const border = new THREE.Mesh(bGeo, bMat);
  border.name = 'terrain-border';
  border.matrixAutoUpdate = false;
  border.updateMatrix();
  group.add(border);

  return {
    group,
    terrain,
    water,
    border,
    height: (x, y) => heightAt(map, x, y),
    update(timeSec) {
      if (water) water.material.uniforms.uTime.value = timeSec;
    },
    dispose() {
      group.removeFromParent();
      geo.dispose();
      mat.dispose();
      detail.dispose();
      if (water) {
        water.geometry.dispose();
        water.material.dispose();
      }
      bGeo.dispose();
      bMat.dispose();
    },
  };
}
