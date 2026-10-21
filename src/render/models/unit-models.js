// Procedural low-poly unit models (DESIGN.md 4.6 and 8).
//
//   const model = buildUnitModel(unitType, '#d63a3a');
//   scene.add(model.root);                 // renderer sets root position / rotation.y = -facing
//   model.animate(st, timeSec, dt, { moving, attackPhase, level, carry });
//   model.height                           // top of the model (health bar placement)
//   model.dispose();                       // detaches; shared geometry stays cached
//
// Geometry is built once per unit type (merged, vertex-colored, with morph
// targets for knees / elbows / wings / waves and baked ambient occlusion) and
// shared by every instance. One physically based material per (team color ×
// morph count × opacity) covers all units: team-colored vertices are
// recolored in the vertex shader, and every vertex carries its own roughness,
// metalness, self-glow and occlusion (unit-geo.js), so metal reflects the sky
// while cloth stays matte under the same material.
//
// On high and ultra (detail 'rich') humanoids the rich builder can dress are one
// smooth skinned mesh on a bone rig instead of rigid parts (rich-humanoid.js,
// rich-anim.js); everything else, and every unit on low and medium, keeps the
// low-poly model.
import * as THREE from 'three';
import { buildTemplate, normalizeVisual } from './unit-bodies.js';
import { animateModel, driveWave } from './unit-anim.js';
import { buildRichTemplate, richSupported } from './rich-humanoid.js';
import { instantiate, mountOn, bindInstance, B } from './rich-kit.js';
import { PartBuilder, TEAM, C, withMat, box, cyl, dodeca, seg, T, bakeAO } from './unit-geo.js';
import { patchWorldMaterial } from '../shading.js';

const HOVER = 2.2; // air units fly this high above the ground
const TEMPLATES = new Map();
const RICH_TEMPLATES = new Map(); // rich templates outlive clearUnitModelCache (only their GPU buffers are freed): the build and bake are the slow part
const AO_CACHE = new Map(); // template key → baked aAo arrays (outlives clearUnitModelCache, see templateAO)
const MATERIALS = new Map();
const AURA_MATS = new Map();
let shared = null;
let seedCounter = 1;

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

/**
 * Shared by every unit material (uUnitLook): x = emissive gain of full glow
 * (eyes, runes, flames, orbs reach up to ~2.5x their albedo, above the bloom
 * threshold of the HDR pipeline; see UNIT_EMISSIVE for the per-channel cap),
 * y = how much of the baked occlusion also
 * dims direct sunlight (indirect light always gets all of it), z = extra sky
 * reflection on metal (an RTS camera sees little bright sky in reflections;
 * without it metal reads darker than cloth), w = diffuse gain (makes up for
 * the light the PBR model moves from diffuse into Fresnel, so cloth and skin
 * stay as bright as the old Lambert units).
 * uUnitSheen: x = specular strength left on rough non-metals, y = strength
 * of the sky reflection on all non-metals (a full Fresnel reflection of sun
 * and sky lays a grey film over saturated cloth, paint and team colors).
 */
const UNIT_UNIFORMS = {
  uUnitLook: { value: new THREE.Vector4(1.65, 0.3, 2.4, 1.06) },
  uUnitSheen: { value: new THREE.Vector2(0.25, 0.4) },
};

const UNIT_PARS_VERTEX = `
attribute vec4 aFx;
attribute float aAo;
uniform vec3 uTeamColor;
varying vec4 vUnitFx; // glow, roughness, metalness, occlusion
varying vec3 vUnitP; // part-local position (surface detail coordinates)`;
const UNIT_VERTEX = `
#if defined( USE_COLOR )
  if ( aFx.x > 0.0 ) vColor.rgb = uTeamColor * aFx.x;
#endif
  vUnitFx = vec4( aFx.yzw, aAo );`;
// (skinned meshes keep the noise on the surface: their rest position, not the posed one)
const UNIT_POS_VERTEX = `
#ifdef USE_SKINNING
  vUnitP = position;
#else
  vUnitP = transformed;
#endif
#include <project_vertex>`;
const UNIT_PARS_FRAGMENT = `
uniform vec4 uUnitLook;
uniform vec2 uUnitSheen;
varying vec4 vUnitFx;
varying vec3 vUnitP;
float unitHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float unitNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( unitHash( i ), unitHash( i + vec3( 1, 0, 0 ) ), f.x ),
                   mix( unitHash( i + vec3( 0, 1, 0 ) ), unitHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( unitHash( i + vec3( 0, 0, 1 ) ), unitHash( i + vec3( 1, 0, 1 ) ), f.x ),
                   mix( unitHash( i + vec3( 0, 1, 1 ) ), unitHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}`;
// Surface detail in place of textures: two octaves of value noise in the
// part's own coordinates. The coarse one (unitWear) mottles cloth and tarnishes
// metal in patches; the fine one (unitGrain: weave, leather grain, brushed
// scratches) fades to its mean where it would shimmer below a pixel. Metal
// gets the most, glowing parts none. The same noise varies roughness, so
// metal catches the light unevenly instead of reading as flat plastic. (A
// derivative bump was tried: at unit size it shows the 2x2 pixel quads.)
const UNIT_DETAIL = `
float unitWear = unitNoise( vUnitP * 7.0 );
float unitGrain = 0.5;
float unitDetailK = 1.0 - saturate( vUnitFx.x * 3.0 );
{
  // each octave fades to its mean once a noise cell gets near pixel size
  vec3 unitQ = vUnitP * 22.0;
  float unitFw = length( fwidth( unitQ ) );
  float unitFadeA = 1.0 - smoothstep( 0.22, 0.5, unitFw );
  float unitFadeB = 1.0 - smoothstep( 0.22, 0.5, unitFw * 2.3 );
  unitGrain = 0.5 + ( unitNoise( unitQ ) - 0.5 ) * 0.65 * unitFadeA + ( unitNoise( unitQ * 2.3 + 3.7 ) - 0.5 ) * 0.35 * unitFadeB;
  float unitMetalK = saturate( vUnitFx.z * 2.0 );
  float unitAmp = mix( mix( 0.2, 0.28, smoothstep( 0.75, 0.9, vUnitFx.y ) ), 0.42, unitMetalK );
  diffuseColor.rgb *= 1.0 + ( ( unitWear - 0.5 ) * 2.6 + ( unitGrain - 0.5 ) * 3.0 ) * unitAmp * unitDetailK;
}`;
const UNIT_DETAIL_ROUGHNESS = `
roughnessFactor = clamp( roughnessFactor + ( ( unitWear - 0.5 ) * 0.4 * saturate( vUnitFx.z * 2.0 ) + ( unitGrain - 0.5 ) * 0.16 ) * unitDetailK, 0.05, 1.0 );`;
// Glow: g * (0.85 + gain * g^2) keeps faint glints (jewelry, 0.15) subtle and
// pushes full glow into HDR. The gain stops where the strongest channel
// reaches 1.6, so pale glow (lightning, souls, gold) blooms while saturated
// fire keeps its hue instead of washing out to pink in the tone mapper.
const UNIT_EMISSIVE = `
{
  float unitGlow = vUnitFx.x;
  float unitPeak = max( max( diffuseColor.r, diffuseColor.g ), max( diffuseColor.b, 0.05 ) );
  float unitGain = min( 0.85 + uUnitLook.x * unitGlow * unitGlow, max( 0.85, 1.6 / unitPeak ) );
  totalEmissiveRadiance += diffuseColor.rgb * unitGlow * unitGain;
}`;
// Occlusion as an aoMap would apply it (indirect diffuse and specular), plus
// part of the direct light so crevices still read in full sun. Metal keeps the
// strength of its sky reflection but takes the hue of its albedo (scaled so
// the brightest channel matches): the grey Fresnel / multi-scatter terms and
// the sky's own tint would otherwise wash saturated gold or copper out to tan.
// Non-metals keep a weaker sky reflection, and rough ones (cloth, fur, wood:
// roughness 0.85 and up) only a faint sheen of the sun too (uUnitSheen), so
// cloth, paint and team colors stay about as saturated as their albedo while
// smooth surfaces (skin, leather, lacquer, gems) keep their sun highlights.
const UNIT_AO = `
{
  float unitAo = vUnitFx.w;
  float unitAoDirect = mix( 1.0, unitAo, uUnitLook.y );
  reflectedLight.indirectDiffuse *= unitAo * uUnitLook.w;
  reflectedLight.directDiffuse *= unitAoDirect * uUnitLook.w;
  float unitMetal = saturate( material.metalness * 2.5 );
  float unitSheen = mix( 1.0, uUnitSheen.x, smoothstep( 0.45, 0.85, material.roughness ) );
  reflectedLight.directSpecular *= unitAoDirect * mix( unitSheen, 1.0, unitMetal );
  float unitNV = saturate( dot( geometryNormal, geometryViewDir ) );
  vec3 unitSpec = reflectedLight.indirectSpecular;
  vec3 unitHue = diffuseColor.rgb / max( max3( diffuseColor.rgb ), 1e-3 );
  unitSpec = mix( unitSpec * unitSheen * uUnitSheen.y, max3( unitSpec ) * unitHue, unitMetal );
  reflectedLight.indirectSpecular = unitSpec * computeSpecularOcclusion( unitNV, unitAo, material.roughness );
}`;
// Units reflect the sky, never the ground under them: reflection vectors that
// point down are mirrored up, so metal turned toward the (high) camera shows
// sky instead of dark soil. The reflected sky is mostly desaturated (it
// tints the sheen of non-metals; metal takes its own hue in UNIT_AO).
const SKY_REFLECTION = THREE.ShaderChunk.envmap_physical_pars_fragment
  .replace(
    'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );',
    'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );\n\t\t\treflectVec.y = abs( reflectVec.y );',
  )
  .replace(
    'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );\n\t\t\treturn envMapColor.rgb * envMapIntensity;',
    'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );\n\t\t\treturn mix( envMapColor.rgb, vec3( dot( envMapColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 0.7 ) * envMapIntensity;',
  );
// The extra sky reflection on metal (uUnitLook.z) boosts the reflected
// radiance only, not the irradiance-driven multi-scatter term.
const UNIT_IBL = THREE.ShaderChunk.lights_fragment_maps.replace(
  'radiance += iblRadiance;',
  'radiance += iblRadiance * ( 1.0 + uUnitLook.z * material.metalness );',
);

// Received sun shadows ignore occluders within UNIT_SHADOW_REACH (in model
// units, about a third of a humanoid's height) of the surface along the sun
// ray: a unit's own head, arms and weapon, which the soft shadow map cannot
// resolve at unit size (it would put a god's whole front in grey shade). The
// lookup depth moves toward the light by that distance in world units; the
// shadow camera is orthographic, so that is a constant shift of the shadow
// coordinate's depth by the length of its gradient (the z row of the shadow
// matrix). Trees, buildings and big neighbours still shade units, at
// UNIT_SHADOW strength.
const UNIT_SHADOW = 0.85;
const UNIT_SHADOW_REACH = 0.42;
const UNIT_SHADOW_VERTEX = `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  float unitShadowReach = ${UNIT_SHADOW_REACH.toFixed(2)} * length( modelMatrix[ 1 ].xyz );
  #ifdef USE_REVERSED_DEPTH_BUFFER
    unitShadowReach = - unitShadowReach;
  #endif
#endif
${THREE.ShaderChunk.shadowmap_vertex.replace(
    'vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;',
    `vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
			vDirectionalShadowCoord[ i ].z -= unitShadowReach * length( vec3( directionalShadowMatrix[ i ][ 0 ].z, directionalShadowMatrix[ i ][ 1 ].z, directionalShadowMatrix[ i ][ 2 ].z ) );`,
  )}`;
const UNIT_LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  'directionalLightShadow.shadowIntensity,',
  `directionalLightShadow.shadowIntensity * ${UNIT_SHADOW.toFixed(2)},`,
);

function patchUnitShader(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTeamColor = mat.userData.uTeamColor;
    shader.uniforms.uUnitLook = UNIT_UNIFORMS.uUnitLook;
    shader.uniforms.uUnitSheen = UNIT_UNIFORMS.uUnitSheen;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${UNIT_PARS_VERTEX}`)
      .replace('#include <color_vertex>', `#include <color_vertex>\n${UNIT_VERTEX}`)
      .replace('#include <project_vertex>', UNIT_POS_VERTEX)
      .replace('#include <shadowmap_vertex>', UNIT_SHADOW_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNIT_PARS_FRAGMENT}`)
      .replace('#include <envmap_physical_pars_fragment>', SKY_REFLECTION)
      .replace('#include <lights_fragment_begin>', UNIT_LIGHTS)
      .replace('#include <lights_fragment_maps>', UNIT_IBL)
      // per-vertex surface: the material's own roughness / metalness are 1
      .replace('#include <color_fragment>', `#include <color_fragment>\n${UNIT_DETAIL}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n\troughnessFactor *= vUnitFx.y;${UNIT_DETAIL_ROUGHNESS}`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tmetalnessFactor *= vUnitFx.z;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${UNIT_EMISSIVE}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${UNIT_AO}`);
  };
  mat.customProgramCacheKey = () => 'mythicwar-unit-v4';
}

/**
 * Shared unit material for a team color. Materials are split by morph target
 * count (three.js recompiles when that changes between draws) and ghostliness.
 */
export function getUnitMaterial(teamColor, morphCount = 0, ghost = false, skinned = false) {
  const col = C(teamColor);
  // skinned and plain meshes keep apart: a material used by both flips programs on every draw
  const key = `${col.getHexString()}|${morphCount}|${ghost ? 1 : 0}${skinned ? '|skin' : ''}`;
  let m = MATERIALS.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  m.userData.uTeamColor = { value: col };
  if (ghost) {
    m.transparent = true;
    m.opacity = 0.62;
    m.depthWrite = true;
  }
  m.name = `unit-${key}`;
  patchUnitShader(m);
  // drifting cloud shadows like the ground, and a cool rim so units stand off it
  patchWorldMaterial(m, { rim: 0.3, cloud: true });
  MATERIALS.set(key, m);
  return m;
}

function auraMaterial(color) {
  const col = C(color);
  const key = col.getHexString();
  let m = AURA_MATS.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: col, vertexColors: true, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    // The aura was tuned for adding onto the sRGB canvas (low quality). Added in the
    // linear HDR target (medium and up) and then tone mapped + sRGB encoded, the same
    // light reads about half as bright, so it is doubled there.
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <colorspace_fragment>',
        '#include <colorspace_fragment>\n\tif ( linearToOutputTexel( vec4( 0.5 ) ).r < 0.6 ) gl_FragColor.rgb *= 2.0;',
      );
    };
    m.customProgramCacheKey = () => 'unit-aura-hdr2';
    m.name = `unit-aura-${key}`;
    AURA_MATS.set(key, m);
  }
  return m;
}

function sharedAssets() {
  if (shared) return shared;
  // aura: soft ground glow (vertex color falloff, additive) + ring + orbiting motes
  const pos = [];
  const colr = [];
  const push = (x, y, z, c) => {
    pos.push(x, y, z);
    colr.push(c, c, c);
  };
  const rings = [0, 0.28, 0.56, 0.8];
  const inten = [0.4, 0.27, 0.1, 0];
  const N = 20;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const r0 = rings[r];
      const r1 = rings[r + 1];
      const p00 = [Math.cos(a0) * r0, 0, Math.sin(a0) * r0];
      const p01 = [Math.cos(a1) * r0, 0, Math.sin(a1) * r0];
      const p10 = [Math.cos(a0) * r1, 0, Math.sin(a0) * r1];
      const p11 = [Math.cos(a1) * r1, 0, Math.sin(a1) * r1];
      push(...p00, inten[r]); push(...p10, inten[r + 1]); push(...p11, inten[r + 1]);
      if (r0 > 0) { push(...p00, inten[r]); push(...p11, inten[r + 1]); push(...p01, inten[r]); }
    }
  }
  // thin ring at r 0.62 with brighter dashes
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const ri = 0.6;
    const ro = 0.65;
    const q = [[Math.cos(a0) * ri, Math.sin(a0) * ri], [Math.cos(a0) * ro, Math.sin(a0) * ro], [Math.cos(a1) * ro, Math.sin(a1) * ro], [Math.cos(a1) * ri, Math.sin(a1) * ri]];
    const c = i % 4 === 0 ? 0.7 : 0.3;
    push(q[0][0], 0.005, q[0][1], c); push(q[1][0], 0.005, q[1][1], c); push(q[2][0], 0.005, q[2][1], c);
    push(q[0][0], 0.005, q[0][1], c); push(q[2][0], 0.005, q[2][1], c); push(q[3][0], 0.005, q[3][1], c);
  }
  // motes: small vertical diamonds orbiting at various heights
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = 0.5 + (i % 2) * 0.1;
    const y = 0.25 + ((i * 37) % 9) * 0.1;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.07;
    const w = 0.03;
    const tx = -Math.sin(a) * w;
    const tz = Math.cos(a) * w;
    push(x, y + h, z, 1); push(x + tx, y, z + tz, 0.6); push(x, y - h, z, 1);
    push(x, y + h, z, 1); push(x, y - h, z, 1); push(x - tx, y, z - tz, 0.6);
  }
  const aura = new THREE.BufferGeometry();
  aura.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  aura.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  aura.computeBoundingSphere();

  // blob shadow for flyers (rgba vertex colors → alpha falloff)
  const sp = [];
  const sc = [];
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = ((i + 1) / 16) * Math.PI * 2;
    sp.push(0, 0, 0, Math.cos(a1) * 0.6, 0, Math.sin(a1) * 0.6, Math.cos(a0) * 0.6, 0, Math.sin(a0) * 0.6);
    sc.push(0, 0, 0, 0.42, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  const shadow = new THREE.BufferGeometry();
  shadow.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  shadow.setAttribute('color', new THREE.Float32BufferAttribute(sc, 4));
  shadow.computeBoundingSphere();
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false });
  shadowMat.name = 'unit-blob-shadow';

  // carried cargo
  const sack = new PartBuilder();
  const bag = dodeca(0.105);
  T(bag, [0, 0, 0], [0, 0, 0], [1, 0.85, 1]);
  sack.add(bag, '#a8865a');
  const tie = cyl(0.03, 0.04, 0.04, 5);
  T(tie, [0, 0.092, 0]);
  sack.add(tie, '#6a4a2a', { mat: 'leather' });
  for (let i = 0; i < 3; i++) {
    const coin = cyl(0.028, 0.028, 0.012, 6);
    T(coin, [Math.cos(i * 2.1) * 0.03, 0.12, Math.sin(i * 2.1) * 0.03], [0.4, 0, 0.3 * i]);
    sack.add(coin, withMat('#ffd040', 'gold'), { glow: 0.6 });
  }
  const wood = new PartBuilder();
  // a bundle of logs lying front-to-back on the shoulder (reads from above)
  for (let i = 0; i < 3; i++) {
    const log = seg([-0.2, -0.03, 0], [0.17, 0.04, 0], 0.036, 0.032, 5);
    T(log, [0, i === 2 ? 0.055 : 0, i === 2 ? 0 : (i - 0.5) * 0.065]);
    wood.add(log, i % 2 ? '#8a5e34' : '#6e4a2a', { mat: 'wood' });
  }
  const strap = cyl(0.075, 0.075, 0.03, 6, true);
  T(strap, [0, 0.02, 0], [0, 0, Math.PI / 2], [1, 1, 1.1]);
  wood.add(strap, TEAM(0.8, 'leather'));
  const sackGeo = sack.build();
  const woodGeo = wood.build();
  bakeAO([{ geo: sackGeo }], { ground: 0 });
  bakeAO([{ geo: woodGeo }], { ground: 0 });
  shared = { aura, shadow, shadowMat, sack: sackGeo, wood: woodGeo };
  return shared;
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

function templateKey(unitType) {
  return `${unitType.id}|${unitType.class}|${unitType.air ? 1 : 0}|${JSON.stringify(unitType.visual || {})}`;
}

/** Whether a unit type is drawn with the rich skinned builder at this detail ('rich' | 'base'). */
function useRich(unitType, detail) {
  return detail === 'rich' && !!unitType.visual && richSupported(unitType);
}

function getRichTemplate(unitType) {
  const key = templateKey(unitType);
  let tpl = RICH_TEMPLATES.get(key);
  if (!tpl) {
    tpl = buildRichTemplate(unitType);
    tpl.visual = normalizeVisual(unitType.visual);
    RICH_TEMPLATES.set(key, tpl);
  }
  return tpl;
}

/**
 * Bake ambient occlusion over the whole model, so parts occlude each other
 * (arms on the torso, legs under the body). Arms are posed as they idle
 * (unit-anim.js restArms: swung a little forward, elbow at its rest bend), so
 * a spear held forward is not baked as if it pointed into the ground. Worker
 * tool arms are baked against the rest of the body in place of the bare arm.
 */
function bakeTemplateAO(tpl, unitType) {
  const rig = tpl.rig;
  const mats = new Map();
  const byName = new Map(tpl.parts.map((p) => [p.name, p]));
  const restRot = (p) => {
    if (p.name === 'armL' && rig.holdAloft) return [-0.3, 0, 2.5];
    if (p.name === 'armR' || p.name === 'armL') return [p.name === 'armR' ? -0.1 : 0.1, 0, 0.14];
    return p.rot || [0, 0, 0];
  };
  const matrixOf = (p) => {
    let m = mats.get(p.name);
    if (m) return m;
    const r = restRot(p);
    _e.set(r[0], r[1], r[2]);
    m = new THREE.Matrix4().compose(_v.fromArray(p.pos), _q.setFromEuler(_e), _one);
    const parent = p.parent && byName.get(p.parent);
    if (parent) m.premultiply(matrixOf(parent));
    mats.set(p.name, m);
    return m;
  };
  const entry = (p, geo = p.geo) => {
    const e = { geo, matrix: matrixOf(p) };
    if (p.name === 'armR' || p.name === 'armL') {
      const bend = p.name === 'armL' && rig.holdAloft ? 0.55 : ((p.name === 'armR' ? rig.rightElbow : rig.leftElbow) ?? 0.25) * (Math.PI / 2);
      e.positions = elbowPose(geo, bend);
    }
    return e;
  };
  const entries = [];
  for (const p of tpl.parts) if (p.geo) entries.push(entry(p));
  const ground = unitType.air ? 0 : 1; // flyers hover: no darkening toward their (absent) feet
  bakeAO(entries, { ground });
  const arm = byName.get('armR');
  if (!rig.tools || !arm) return;
  const body = entries.filter((e) => e.geo !== arm.geo).map((e) => ({ ...e, receive: false }));
  for (const g of new Set(Object.values(rig.tools))) {
    if (g !== arm.geo) bakeAO([...body, entry(arm, g)], { ground });
  }
}

/** Positions of an arm geometry with its elbow morphs (e45 / e90) bent by `angle` radians, or null. */
function elbowPose(geo, angle) {
  const names = geo.userData.morphNames || [];
  const morphs = geo.morphAttributes.position;
  const i45 = names.indexOf('e45');
  const i90 = names.indexOf('e90');
  if (!morphs || (i45 < 0 && i90 < 0) || !(angle > 0)) return null;
  const q = Math.PI / 4;
  const a = Math.min(angle, 2 * q);
  const w45 = a <= q ? a / q : 2 - a / q;
  const w90 = a <= q ? 0 : a / q - 1;
  const base = geo.attributes.position.array;
  const out = new Float32Array(base);
  const d45 = i45 >= 0 ? morphs[i45].array : null;
  const d90 = i90 >= 0 ? morphs[i90].array : null;
  for (let i = 0; i < out.length; i++) out[i] += (d45 ? d45[i] * w45 : 0) + (d90 ? d90[i] * w90 : 0);
  return new THREE.BufferAttribute(out, 3);
}

/** Every geometry of a template (parts, then worker tool arms), each once, in build order. */
function templateGeometries(tpl) {
  const geos = new Set();
  for (const p of tpl.parts) if (p.geo) geos.add(p.geo);
  if (tpl.rig.tools) for (const g of Object.values(tpl.rig.tools)) geos.add(g);
  return [...geos];
}

/**
 * Bake the template's occlusion, or copy it from an earlier bake of the same
 * template key: templates are rebuilt after clearUnitModelCache (every match),
 * the bake is the slow part of building one, and its result only depends on
 * the key. Only the plain arrays are kept.
 */
function templateAO(tpl, unitType, key) {
  const geos = templateGeometries(tpl);
  const cached = AO_CACHE.get(key);
  if (cached && cached.length === geos.length && geos.every((g, i) => g.attributes.aAo.count === cached[i].length)) {
    geos.forEach((g, i) => g.attributes.aAo.array.set(cached[i]));
    return;
  }
  bakeTemplateAO(tpl, unitType);
  AO_CACHE.set(key, geos.map((g) => g.attributes.aAo.array));
}

function getTemplate(unitType, detail = 'base') {
  if (useRich(unitType, detail)) return getRichTemplate(unitType);
  const key = templateKey(unitType);
  let tpl = TEMPLATES.get(key);
  if (!tpl) {
    tpl = buildTemplate(unitType);
    templateAO(tpl, unitType, key);
    tpl.visual = normalizeVisual(unitType.visual);
    tpl.triangles = 0;
    tpl.meshes = 0;
    for (const p of tpl.parts) {
      if (p.geo) {
        tpl.triangles += p.geo.userData.triangles;
        tpl.meshes++;
      }
    }
    if (tpl.rig.tools) {
      let extra = 0;
      for (const g of Object.values(tpl.rig.tools)) extra = Math.max(extra, g.userData.triangles);
      tpl.triangles += extra - tpl.parts.find((p) => p.name === 'armR').geo.userData.triangles;
    }
    TEMPLATES.set(key, tpl);
  }
  return tpl;
}

const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);

function baseBox(geo) {
  if (!geo.userData.baseBox) {
    const p = geo.attributes.position;
    const b = new THREE.Box3();
    for (let i = 0; i < p.count; i++) b.expandByPoint(_v.fromBufferAttribute(p, i));
    geo.userData.baseBox = b;
  }
  return geo.userData.baseBox;
}

// ---------------------------------------------------------------------------
// instances
// ---------------------------------------------------------------------------

const RANGED_THROW = new Set(['spear', 'rock', 'bolt', 'ice', 'leaf']);

class UnitModel {
  constructor(unitType, teamColor, detail = 'base') {
    const tpl = getTemplate(unitType, detail);
    const v = tpl.visual;
    const assets = sharedAssets();
    this.unitType = unitType;
    this.template = tpl;
    this.kind = tpl.kind;
    this.rig = tpl.rig;
    this.scale = v.scale;
    this.air = !!unitType.air;
    this.root = new THREE.Group();
    this.root.name = `unit:${unitType.id}`;
    this.rigGroup = new THREE.Group();
    this.rigGroup.scale.setScalar(v.scale);
    this.root.add(this.rigGroup);
    this.parts = {};
    this.teamColor = C(teamColor ?? '#8a8a8a');
    this.rich = null;
    if (tpl.rich) this.buildRichParts(tpl);
    for (const p of tpl.parts) {
      let obj;
      if (p.geo) {
        const count = p.geo.morphAttributes.position ? p.geo.morphAttributes.position.length : 0;
        obj = new THREE.Mesh(p.geo, getUnitMaterial(this.teamColor, count, !!p.ghost));
        obj.castShadow = true;
        // trees, buildings (and on high / ultra other units) shade units too
        obj.receiveShadow = true;
      } else obj = new THREE.Group();
      obj.name = p.name;
      obj.position.fromArray(p.pos);
      if (p.rot) obj.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
      this.parts[p.name] = obj;
      (p.parent ? this.parts[p.parent] : this.rigGroup).add(obj);
    }
    this.rest = {
      torsoRz: this.parts.torso ? this.parts.torso.rotation.z : 0,
      armRx: this.parts.armR ? this.parts.armR.position.x : 0,
      armLx: this.parts.armL ? this.parts.armL.position.x : 0,
    };
    // worker cargo
    if (this.parts.carry) {
      this.carryMesh = new THREE.Mesh(assets.sack, getUnitMaterial(this.teamColor, 0, false));
      this.carryMesh.visible = false;
      this.carryMesh.castShadow = true;
      this.carryMesh.receiveShadow = true;
      this.parts.carry.add(this.carryMesh);
    }
    this.toolKind = 'none';
    // aura glow
    if (v.aura) {
      this.aura = new THREE.Mesh(assets.aura, auraMaterial(v.aura));
      this.aura.name = 'aura';
      this.aura.position.y = this.air ? 0.15 : 0.04;
      this.aura.renderOrder = 2;
      // the rig is scaled by visual.scale; keep the glow from swamping big units
      this.auraBase = (0.55 + 0.35 * v.scale) / v.scale;
      this.aura.scale.setScalar(this.auraBase);
      this.rigGroup.add(this.aura);
    }
    if (this.air) {
      this.shadow = new THREE.Mesh(assets.shadow, assets.shadowMat);
      this.shadow.name = 'shadow';
      this.shadow.position.y = 0.05;
      this.shadow.scale.setScalar(v.scale * (this.kind === 'bird' || this.kind === 'dragon' ? 1.2 : 0.9));
      this.shadow.renderOrder = 1;
      this.root.add(this.shadow);
    }
    // animation state
    this.seed = ((seedCounter++ * 2654435761) % 1000) / 1000 * 6.283;
    this.target = {};
    this.cur = null; // current (blended) pose, created on the first frame (unit-anim.js blendPose)
    this.blendFns = null;
    this.walkPhase = this.seed;
    this.wavePhase = this.seed;
    this.wheelAngle = 0;
    this.time = 0;
    this.state = 'idle';
    this.deadTime = 0;
    this.sawPhase = false;
    this.lastAp = 1;
    this.punchSide = 1;
    this.moving = false;
    this.carry = 0;
    this.speed = unitType.speed || 2.5;
    const strideBase = this.rig.stride || 1.25;
    this.strideLen = strideBase * v.scale;
    this.hasWings = v.extras.includes('wings');
    this.ranged = !!(unitType.attack && unitType.attack.projectile);
    const w = v.weapon;
    this.rangedStyle = w === 'bow' ? 'bow' : ['lightning_bolt', 'discus', 'spear', 'club', 'axe', 'hammer', 'trident', 'cauldron'].includes(w) || RANGED_THROW.has(unitType.attack?.projectile) ? 'throw' : 'cast';
    this.hoverY = this.air ? HOVER : 0;
    this.rigGroup.position.y = this.hoverY;
    this.root.updateMatrixWorld(true);
    if (this.rich) bindInstance(this.rich);
    this.height = this.computeHeight();
    this.disposed = false;
  }

  /** The rich body: one skinned mesh on its own bones, plus rigid pieces (weapon, shield, tools, flames) riding bones. */
  buildRichParts(tpl) {
    const R = tpl.rich;
    const inst = instantiate(R.geo, R.spec, getUnitMaterial(this.teamColor, 0, false, true));
    inst.mesh.name = 'body';
    inst.mesh.castShadow = true;
    inst.mesh.receiveShadow = true;
    this.rigGroup.add(inst.mesh);
    inst.tools = {};
    inst.flames = [];
    inst.restUpper = [inst.bones[B.upperR].position.x, inst.bones[B.upperL].position.x];
    // the bones live outside the scene graph (see rich-kit.js instantiate): pieces ride a mount per bone
    const mounts = {};
    const mount = (bone) => mounts[bone] || (mounts[bone] = mountOn(inst, this.rigGroup, bone, `mount:${bone}`));
    for (const a of R.attach) {
      const count = a.geo.morphAttributes.position ? a.geo.morphAttributes.position.length : 0;
      const mesh = new THREE.Mesh(a.geo, getUnitMaterial(this.teamColor, count, false));
      mesh.name = a.name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mount(a.bone).add(mesh);
      if (a.tool) {
        mesh.visible = false;
        inst.tools[a.tool] = mesh;
      }
      if (a.flicker) inst.flames.push(mesh);
    }
    this.rich = inst;
    if (this.rig.tools) {
      // cargo rides on the left shoulder
      const carry = new THREE.Group();
      carry.name = 'carry';
      const chest = R.carryAt;
      carry.position.set(-0.04, R.dims.shoulderY + 0.08 - chest[1], -R.dims.shoulderZ * 1.02);
      mount(B.chest).add(carry);
      this.parts.carry = carry;
    }
  }

  computeHeight() {
    let top = 0;
    this.rigGroup.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    this.rigGroup.traverse((o) => {
      if (!o.isMesh || !o.visible || o === this.aura || o === this.carryMesh) return;
      _box.copy(baseBox(o.geometry)).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      top = Math.max(top, _box.max.y);
    });
    return top;
  }

  /** Lateral traveling wave on a mesh (tails, serpents, banners). */
  waveA(mesh, amp) {
    driveWave(mesh, this.wavePhase, amp);
  }

  setTool(kind) {
    if (!this.rig.tools || this.toolKind === kind) return;
    if (this.rich) {
      for (const k in this.rich.tools) this.rich.tools[k].visible = k === kind;
      this.toolKind = kind;
      return;
    }
    const g = this.rig.tools[kind] || this.rig.tools.none;
    this.parts.armR.geometry = g;
    this.toolKind = kind;
  }

  /**
   * Advance the procedural animation.
   * @param {string} state idle|move|attack|gather|return|build|pray|cast|dead
   * @param {number} timeSec global time in seconds
   * @param {number} dt seconds since the last call
   * @param {{moving?: boolean, attackPhase?: number, level?: number, carry?: 0|'g'|'w', speed?: number}} [extra]
   */
  animate(state, timeSec, dt, extra = {}) {
    if (this.disposed) return;
    const st = state || 'idle';
    if (st !== this.state) {
      if (this.state === 'dead') this.resetDeath();
      this.state = st;
      if (st === 'dead') this.deadTime = 0;
    }
    const ex = extra || {};
    this.moving = st === 'dead' ? false : ex.moving ?? (st === 'move' || st === 'return');
    this.carry = ex.carry || (st === 'return' && this.parts.carry ? 'g' : 0);
    // attack timing
    let ap = ex.attackPhase;
    if (ap !== undefined && ap !== null) {
      this.sawPhase = true;
      if (ap < this.lastAp - 0.2) this.punchSide = -this.punchSide;
      this.lastAp = ap;
    } else if (st === 'attack' && !this.sawPhase) {
      const cd = this.unitType.attack?.cooldown || 1.5;
      const x = (timeSec + this.seed) % cd;
      ap = x < 0.5 ? x / 0.5 : undefined;
      if (ap !== undefined && ap < this.lastAp - 0.2) this.punchSide = -this.punchSide;
      this.lastAp = ap ?? 1;
    }
    this.ap = st === 'attack' && ap !== null ? ap : undefined;
    // worker tools and cargo
    if (this.parts.carry) {
      const gatherKind = ex.gather || ex.carry || 'g';
      this.setTool(st === 'build' ? 'hammer' : st === 'gather' ? (gatherKind === 'w' ? 'axe' : 'pick') : 'none');
      const showCargo = this.carry && st !== 'gather' && st !== 'build' && st !== 'dead';
      this.carryMesh.visible = !!showCargo;
      if (showCargo) {
        const g = this.carry === 'w' ? sharedAssets().wood : sharedAssets().sack;
        if (this.carryMesh.geometry !== g) this.carryMesh.geometry = g;
      }
    }
    animateModel(this, st, timeSec, dt, ex);
    this.animateCommon(st, timeSec, dt, ex);
  }

  animateCommon(st, t, dt, ex) {
    const rg = this.rigGroup;
    // flyers bob
    let y = this.hoverY;
    if (this.air) y += 0.12 * Math.sin(t * 1.7 + this.seed) + (this.moving ? -0.05 : 0);
    // death: fall (flyers), topple sideways, then sink into the ground
    if (st === 'dead') {
      this.deadTime += dt;
      const d = this.deadTime;
      if (this.air) y = this.hoverY * Math.max(0, 1 - (d / 0.55) ** 2);
      const fallT = this.air ? Math.max(0, d - 0.45) : d;
      const topple = Math.min(1, fallT / 0.6) ** 2;
      const side = this.seed > 3.14 ? 1 : -1;
      rg.rotation.x = side * topple * (this.kind === 'humanoid' || this.kind === 'naga' || this.kind === 'spirit' ? 1.45 : 1.2);
      rg.rotation.z = topple * 0.15;
      // lie still for a moment, then sink out of sight by ~1.55 s
      const sink = Math.min(1, Math.max(0, (d - 0.95) / 0.6));
      y -= sink * sink * Math.max(0.35, this.height * 0.6);
      if (this.aura) this.aura.scale.setScalar(this.auraBase * Math.max(0.001, 1 - d / 0.8));
      if (this.shadow) this.shadow.visible = d < 1.2;
    }
    rg.position.y = y;
    if (this.shadow) {
      const k = 1 - 0.08 * Math.sin(t * 1.7 + this.seed);
      this.shadow.scale.setScalar(this.scale * (this.kind === 'bird' || this.kind === 'dragon' ? 1.2 : 0.9) * k);
    }
    if (this.aura && st !== 'dead') {
      const lvl = Math.max(1, ex.level || 1);
      const flare = st === 'cast' ? 1.45 + 0.1 * Math.sin(t * 14) : 1;
      const pulse = 1 + 0.05 * Math.sin(t * 2.3 + this.seed);
      this.aura.scale.setScalar(this.auraBase * (1 + 0.06 * (lvl - 1)) * pulse * flare);
      this.aura.rotation.y = t * (st === 'cast' ? 3.2 : 0.6) + this.seed;
    }
  }

  resetDeath() {
    this.deadTime = 0;
    this.rigGroup.rotation.set(0, 0, 0);
    this.rigGroup.position.y = this.hoverY;
    if (this.aura) this.aura.scale.setScalar(this.auraBase);
    if (this.shadow) this.shadow.visible = true;
  }

  /** Detach from the scene. Shared cached geometry and materials stay alive. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rich) this.rich.mesh.skeleton.dispose();
    this.root.removeFromParent();
    this.root.clear();
    this.parts = {};
  }
}

/**
 * Build an animated low-poly model for a unit type in a team color.
 * @param {object} unitType unit type from the data registry (needs visual)
 * @param {string|number|THREE.Color} teamColor owner color
 * @returns {{root: THREE.Group, height: number, animate: Function, dispose: Function}}
 */
export function buildUnitModel(unitType, teamColor, opts = {}) {
  const m = new UnitModel(unitType, teamColor, opts.detail);
  return m;
}

/** Build (and cache) templates up front to avoid hitches on first spawn. */
export function preloadUnitModels(unitTypes, detail = 'base') {
  for (const u of unitTypes) if (u && u.visual) getTemplate(u, detail);
}

/** Triangle / mesh counts and base height (at visual scale) for a unit type. */
export function getUnitModelInfo(unitType, detail = 'base') {
  const tpl = getTemplate(unitType, detail);
  const m = new UnitModel(unitType, '#ffffff', detail);
  let meshes = 0;
  m.root.traverse((o) => {
    if (o.isMesh) meshes++;
  });
  const info = { triangles: tpl.triangles, meshes, height: m.height, kind: tpl.kind, morphs: {} };
  for (const p of tpl.parts) if (p.geo) info.morphs[p.name] = p.geo.userData.morphNames.slice();
  info.rich = !!tpl.rich;
  m.dispose();
  return info;
}

/** Free every cached geometry and material (renderer teardown). */
export function clearUnitModelCache() {
  for (const tpl of TEMPLATES.values()) {
    for (const p of tpl.parts) if (p.geo) p.geo.dispose();
    if (tpl.rig.tools) for (const g of Object.values(tpl.rig.tools)) g.dispose();
  }
  TEMPLATES.clear();
  for (const tpl of RICH_TEMPLATES.values()) {
    tpl.rich.geo.dispose();
    for (const a of tpl.rich.attach) a.geo.dispose();
  }
  for (const m of MATERIALS.values()) m.dispose();
  MATERIALS.clear();
  for (const m of AURA_MATS.values()) m.dispose();
  AURA_MATS.clear();
  if (shared) {
    shared.aura.dispose();
    shared.shadow.dispose();
    shared.shadowMat.dispose();
    shared.sack.dispose();
    shared.wood.dispose();
    shared = null;
  }
}

export { HOVER as AIR_HOVER_HEIGHT };
