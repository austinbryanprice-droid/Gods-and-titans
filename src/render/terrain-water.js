// Lake surface for the terrain (DESIGN 8): one flat mesh at WATER_LEVEL over
// every tile that dips below it, built with the terrain's own 8-triangle fan
// per tile so the per-vertex depth (water level − ground height) interpolates
// to the exact depth of the ground under every pixel. The shader then has a
// precise shoreline without reading the depth buffer:
//
//   - animated normals: two scrolling ripple layers (fx texture slopes) on a
//     few analytic swells, calmer in the shallows;
//   - Fresnel reflection of the sky gradient the environment map is built
//     from, with the drifting clouds mirrored in it;
//   - sun glints from SUN_DIR (the sun is behind the RTS camera, so a mirror
//     reflection never shows: glints come from an exaggerated ripple normal);
//   - depth-based absorption color and opacity, a slight refraction-like
//     wobble of the opacity, soft foam bands rolling in to the shore.
//
// Output is premultiplied (reflections add light, the body absorbs what is
// behind), linear in the HDR target and tone mapped on the low path; the fog
// of war goes through fowApply like every other world material.
import * as THREE from 'three';
import { TERRAIN } from '../config.js';
import { FOW_UNIFORMS, FOW_PARS_FRAGMENT } from './fog.js';
import { SUN_DIR, WORLD_UNIFORMS } from './shading.js';

/** Water surface height (notes/decisions.md [map]: lines up with the tile edges). */
export const WATER_LEVEL = -0.2;

const lin = (hex) => new THREE.Color(hex); // sRGB hex → linear working space

const WATER_VS = /* glsl */ `
attribute float aDepth;
varying float vDepth;
varying vec3 vWPos;
#include <common>
#include <fog_pars_vertex>
void main() {
  vDepth = aDepth;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FS = /* glsl */ `
uniform float uTime;
uniform sampler2D uFx;
uniform sampler2D uNoise;
uniform sampler2D uCloudTex;
uniform vec4 uCloud;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uZenith;
uniform vec3 uHorizon;
varying float vDepth;
varying vec3 vWPos;
#include <common>
#include <fog_pars_fragment>
${FOW_PARS_FRAGMENT.replace('varying vec2 vFowXZ;', '')}

// broad swells: analytic slope of a few long sine trains (direction, wavelength, speed)
vec2 swell( vec2 p, float t ) {
  vec2 s = vec2( 0.0 );
  vec2 d1 = vec2( 0.8, 0.6 );
  vec2 d2 = vec2( -0.45, 0.9 );
  vec2 d3 = vec2( 0.96, -0.28 );
  s += d1 * cos( dot( d1, p ) * 1.9 + t * 1.15 ) * 0.035;
  s += d2 * cos( dot( d2, p ) * 2.7 - t * 1.4 ) * 0.025;
  s += d3 * cos( dot( d3, p ) * 4.3 + t * 2.1 ) * 0.015;
  return s;
}

void main() {
  if ( vDepth < -0.03 ) discard; // over dry ground (hidden by it anyway)
  vec2 p = vWPos.xz;
  float t = uTime;
  // The ground's contour at the water level follows the tile grid; letting the
  // water thin out over a noisy margin in the shallows gives an organic shoreline.
  float depth = vDepth - 0.1 * texture2D( uNoise, p * 0.23 ).b;
  float calm = 0.35 + 0.65 * smoothstep( 0.0, 0.18, depth );

  // ---- surface normal
  vec2 slope = ( texture2D( uFx, p * 0.19 + vec2( t * 0.027, t * 0.016 ) ).rg - 0.5 ) * 0.28;
  #ifdef WATER_HQ
    slope += ( texture2D( uFx, p * vec2( 0.31, 0.29 ) + vec2( - t * 0.021, t * 0.033 ) + 0.41 ).gr - 0.5 ) * 0.2;
  #endif
  slope = slope * calm + swell( p, t ) * calm;
  vec3 N = normalize( vec3( - slope.x, 1.0, - slope.y ) );
  vec3 V = normalize( cameraPosition - vWPos );
  float NdV = saturate( dot( N, V ) );

  // ---- cloud shade (the same drifting clouds that shade the ground)
  float shade = 1.0;
  vec2 cp = ( p - uSunDir.xz * ( vWPos.y / max( uSunDir.y, 0.2 ) ) ) * uCloud.y + uCloud.zw * t * uCloud.y;
  if ( uCloud.x > 0.0 ) {
    float n = texture2D( uCloudTex, cp ).r;
    shade = 1.0 - uCloud.x * smoothstep( 0.46, 0.68, n );
  }

  // ---- body: absorption deepens the color and the opacity with depth
  float dd = 1.0 - exp( - max( depth, 0.0 ) * 4.2 );
  vec3 body = mix( uShallow, uDeep, smoothstep( 0.0, 0.85, dd ) ) * ( 0.55 + 0.45 * shade );
  float alpha = mix( 0.22, 0.9, dd );
  // refraction-like wobble: the ripples tilt how much of the bed shows through
  alpha = saturate( alpha + ( slope.x - slope.y ) * 0.6 * dd );

  // ---- reflection: Fresnel (water F0 0.02, a little lifted so it reads from above)
  vec3 R = reflect( - V, N );
  float ry = saturate( R.y );
  vec3 sky = mix( uHorizon, uZenith, pow( ry, 0.55 ) );
  #ifdef WATER_HQ
    // clouds mirrored in the water drift with the ones overhead
    vec2 rc = ( p + R.xz / max( R.y, 0.2 ) * 8.0 ) * uCloud.y * 1.3 + uCloud.zw * t * uCloud.y;
    float cl = texture2D( uCloudTex, rc ).r;
    sky = mix( sky, uHorizon * 1.25, smoothstep( 0.48, 0.72, cl ) * 0.55 );
  #endif
  float F = 0.02 + 0.98 * pow( 1.0 - NdV, 5.0 );
  F = min( 1.0, F * 1.8 + 0.035 );
  vec3 refl = sky * F;

  // ---- sun: a soft sheen on the swells, sparse glints from an exaggerated ripple normal
  vec3 H = normalize( uSunDir + V );
  vec3 Ng = normalize( vec3( - slope.x * 7.0, 1.0, - slope.y * 7.0 ) );
  float glint = pow( saturate( dot( Ng, H ) ), 220.0 ) * 6.0;
  float sheen = pow( saturate( dot( N, H ) ), 24.0 ) * 0.05;
  // twinkle: glints come and go with a fast-moving noise, which also breaks the
  // broad highlights of the smoother single-layer ripples into sparkles
  glint *= smoothstep( 0.45, 0.8, texture2D( uFx, p * 0.83 + vec2( t * 0.11, - t * 0.07 ) ).a );
  vec3 sun = uSunColor * ( glint + sheen ) * shade * calm;

  // ---- foam: a lapping line at the shore and bands rolling in over the shallows
  float fn = texture2D( uFx, p * 0.45 + vec2( t * 0.02, - t * 0.015 ) ).a;
  float edge = 1.0 - smoothstep( 0.0, 0.022 + 0.01 * sin( t * 1.3 + p.x * 0.7 + p.y * 0.5 ), depth );
  float phase = depth * 26.0 + t * 0.55 + fn * 1.2;
  float band = smoothstep( 0.72, 0.86, fract( phase ) ) * ( 1.0 - smoothstep( 0.86, 1.0, fract( phase ) ) );
  band *= ( 1.0 - smoothstep( 0.03, 0.13, depth ) ) * smoothstep( 0.35, 0.6, fn );
  float foam = saturate( edge * smoothstep( 0.15, 0.65, fn + 0.25 * edge ) + band * 0.8 );
  // a faint shadow just behind each band reads as a wave lip
  alpha = saturate( alpha + band * 0.12 );

  vec3 col = body * alpha + refl + sun; // premultiplied
  col = mix( col, uFoam * ( 0.6 + 0.4 * shade ), foam );
  alpha = mix( alpha, 1.0, foam );
  // thin out over the noisy margin (premultiplied: color and alpha together)
  float fade = smoothstep( -0.012, 0.004, depth );
  col *= fade;
  alpha *= fade;
  if ( alpha < 0.004 ) discard; // nothing to show

  // straight color for the tone map / color space / fog / fog-of-war chunks,
  // premultiplied again at the end (premultiplied_alpha_fragment)
  gl_FragColor = vec4( col / max( alpha, 1e-3 ), alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  gl_FragColor.rgb = fowApply( gl_FragColor.rgb, p );
  #include <premultiplied_alpha_fragment>
}`;

/**
 * Water surface over every tile that dips below the water level, as 8-triangle
 * fans like the terrain (corner, edge midpoint and center vertices shared).
 * @param {object} map mapData
 * @param {object} o
 * @param {THREE.Texture} o.fx ripple / foam texture (terrain-textures.js)
 * @param {THREE.Texture} o.noise tileable fbm noise texture (terrain-textures.js)
 * @param {{ value: number }} [o.time] clock uniform (seconds), driven by the owner
 * @param {boolean} [o.hq] a second ripple layer and cloud reflections
 * @returns {THREE.Mesh|null}
 */
export function buildWater(map, { fx, noise, time = { value: 0 }, hq = true } = {}) {
  const W = map.width;
  const H = map.height;
  const VW = W + 1;
  const hs = map.heights;
  if (!hs) return null;
  const pos = [];
  const depth = [];
  const idx = [];
  const cornerOf = new Int32Array(VW * (H + 1)).fill(-1);
  const hEdgeOf = new Int32Array(W * (H + 1)).fill(-1);
  const vEdgeOf = new Int32Array(VW * H).fill(-1);
  const add = (x, z, h) => {
    const n = pos.length / 3;
    pos.push(x, WATER_LEVEL, z);
    depth.push(WATER_LEVEL - h);
    return n;
  };
  const hAt = (vx, vy) => hs[vy * VW + vx];
  const corner = (vx, vy) => {
    const i = vy * VW + vx;
    if (cornerOf[i] < 0) cornerOf[i] = add(vx, vy, hAt(vx, vy));
    return cornerOf[i];
  };
  const hEdge = (tx, vy) => {
    const i = vy * W + tx;
    if (hEdgeOf[i] < 0) hEdgeOf[i] = add(tx + 0.5, vy, (hAt(tx, vy) + hAt(tx + 1, vy)) / 2);
    return hEdgeOf[i];
  };
  const vEdge = (vx, ty) => {
    const i = ty * VW + vx;
    if (vEdgeOf[i] < 0) vEdgeOf[i] = add(vx, ty + 0.5, (hAt(vx, ty) + hAt(vx, ty + 1)) / 2);
    return vEdgeOf[i];
  };
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const a = ty * VW + tx;
      const lo = Math.min(hs[a], hs[a + 1], hs[a + VW], hs[a + VW + 1]);
      if (lo > WATER_LEVEL - 0.01 && map.terrain[ty * W + tx] !== TERRAIN.WATER) continue;
      const c = add(tx + 0.5, ty + 0.5, (hs[a] + hs[a + 1] + hs[a + VW] + hs[a + VW + 1]) / 4);
      const tl = corner(tx, ty);
      const tr = corner(tx + 1, ty);
      const bl = corner(tx, ty + 1);
      const br = corner(tx + 1, ty + 1);
      const top = hEdge(tx, ty);
      const bottom = hEdge(tx, ty + 1);
      const left = vEdge(tx, ty);
      const right = vEdge(tx + 1, ty);
      // the terrain's fan, counter-clockwise from above
      idx.push(c, tr, top, c, top, tl, c, br, right, c, right, tr, c, bl, bottom, c, bottom, br, c, tl, left, c, left, bl);
    }
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uShallow: { value: lin('#3d8f8a') },
    uDeep: { value: lin('#123f5c') },
    uFoam: { value: lin('#e4eeea') },
    // the sky gradient createEnvironment() lights the world with
    uZenith: { value: lin('#5d8fd0') },
    uHorizon: { value: lin('#cfdbe6') },
    uSunColor: { value: lin('#fff1dc') },
  }]);
  // shared uniforms by reference: no per-material updates
  uniforms.uTime = time;
  uniforms.uCloudTex = WORLD_UNIFORMS.uCloudTex;
  uniforms.uCloud = WORLD_UNIFORMS.uCloud;
  uniforms.uSunDir = { value: SUN_DIR.clone() };
  uniforms.uFx = { value: fx };
  uniforms.uNoise = { value: noise };
  uniforms.uFowTex = FOW_UNIFORMS.uFowTex;
  uniforms.uFowSize = FOW_UNIFORMS.uFowSize;
  uniforms.uFowPow = FOW_UNIFORMS.uFowPow;
  uniforms.uFowNoise = FOW_UNIFORMS.uFowNoise;
  uniforms.uFowTime = FOW_UNIFORMS.uFowTime;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VS,
    fragmentShader: WATER_FS,
    transparent: true,
    premultipliedAlpha: true,
    // no depth writes: selection rings, blob shadows, markers and ground spell
    // effects of units at the shore (whose ground dips below the water level)
    // depth-test against the ground and stay whole
    depthWrite: false,
    fog: true,
  });
  mat.name = 'water';
  setWaterQuality(mat, hq);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/** Switch the water shader's detail (recompiles once). */
export function setWaterQuality(mat, hq) {
  const want = !!hq;
  const has = !!mat.defines && 'WATER_HQ' in mat.defines;
  if (want === has && mat.defines) return;
  mat.defines = want ? { WATER_HQ: '' } : {};
  mat.needsUpdate = true;
}
