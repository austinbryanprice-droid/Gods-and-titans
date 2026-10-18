// Element palettes for the VFX system. Base hues come from config ELEMENT_COLORS;
// dark hues are lifted so they still read with additive blending, and each element
// gets a hot core, a secondary hue, a smoke/dust color and an optional dark
// underlay (normal-blended) color for shadowy ground effects.
//
// Colors are authored (and lifted / mixed) in sRGB, then handed out LINEAR: the
// VFX shaders work in linear light like every other world material (post.js
// draws the world into a linear HDR target; on low quality the shaders tone map
// and sRGB-encode at the end).
import * as THREE from 'three';
import { ELEMENT_COLORS } from '../config.js';

// core, secondary, smoke, dark (scorch / cracks / clouds, null = none), jagged lightning strikes
const EXTRA = {
  lightning: ['#ffffff', '#c8b8ff', '#5a6478', '#0c1424', true],
  fire: ['#ffe68a', '#ff3a10', '#3a302a', '#1c0e06', false],
  water: ['#e4f8ff', '#2ad8ff', '#d4ecff', null, false],
  holy: ['#fffcea', '#fff2a8', '#fff4d0', null, false],
  sun: ['#fff6cc', '#ff8a1a', '#fff0c0', null, false],
  shadow: ['#ecdcff', '#3a1a9a', '#2a1a40', '#12062a', false],
  death: ['#eedcff', '#52e08a', '#2a2030', '#0e0618', false],
  nature: ['#eeffd8', '#c8f060', '#7a9a50', null, false],
  wind: ['#ffffff', '#a0e8ff', '#e8f6f4', null, false],
  earth: ['#ffe2b8', '#8a5a2c', '#8a6e50', '#24160a', false],
  ice: ['#ffffff', '#7ad0ff', '#e8f6ff', null, false],
  war: ['#ffd8c0', '#ff8a2a', '#3a2a28', '#280606', false],
  moon: ['#ffffff', '#8aa4ff', '#c8d0e8', null, false],
  chaos: ['#ffd8f4', '#7a3cff', '#3a1a30', '#1e0818', true],
  physical: ['#ffffff', '#b8b0a0', '#a89a88', null, false],
  sand: ['#fff6dc', '#c89850', '#c8aa78', null, false],
  poison: ['#f2ffc8', '#4aa820', '#5a6a30', '#121e06', false],
  arcane: ['#fff0ff', '#8a60ff', '#4a3a60', null, true],
};

/** sRGB hex → { r, g, b } in 0..1, still sRGB-encoded (see linear()). */
export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** sRGB { r, g, b } → linear { r, g, b } (what the shaders and lights take). */
export function linear(c) {
  return { r: toLinear(c.r), g: toLinear(c.g), b: toLinear(c.b) };
}

/** sRGB hex → linear { r, g, b }. */
export const hexToLinear = (hex) => linear(hexToRgb(hex));

function lift(c, minLum) {
  const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  if (lum >= minLum || lum <= 0) return c;
  const k = Math.min(3, minLum / lum);
  return { r: Math.min(1, c.r * k), g: Math.min(1, c.g * k), b: Math.min(1, c.b * k) };
}

const mixRgb = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
const sat = (c) => {
  const mx = Math.max(c.r, c.g, c.b);
  return mx > 0 ? (mx - Math.min(c.r, c.g, c.b)) / mx : 0;
};

// Tinted normal-blended underlay under shadowy effects (null = none): reads as
// "darkness" without the muddy grey a plain black decal gives on grass.
const GLOOM = {
  shadow: '#260a5c',
  death: '#2a0c4a',
  chaos: '#3a0a34',
  poison: '#1e3808',
};

const cache = new Map();

/**
 * Palette for an element id (unknown ids fall back to arcane). Every color is
 * linear { r, g, b } in 0..1 (base keeps the authored sRGB hue).
 * @param {string} el
 * `tint` is the most saturated of glow / alt, used for large glowing areas so pale
 * elements (ice, wind, moon) still read as their hue over bright ground.
 * @returns {{ el: string, glow: {r,g,b}, core: {r,g,b}, mid: {r,g,b}, alt: {r,g,b}, tint: {r,g,b}, smoke: {r,g,b},
 *   dark: {r,g,b}|null, gloom: {r,g,b}|null, jagged: boolean, base: {r,g,b},
 *   linGlow: THREE.Color, linAlt: THREE.Color, linCore: THREE.Color, linTint: THREE.Color }}
 */
export function getPalette(el) {
  let p = cache.get(el);
  if (p) return p;
  const key = ELEMENT_COLORS[el] ? el : 'arcane';
  const ex = EXTRA[key] || ['#ffffff', ELEMENT_COLORS[key], '#808080', null, false];
  const base = hexToRgb(ELEMENT_COLORS[key]);
  const glow = lift(base, 0.42);
  const core = mixRgb(hexToRgb(ex[0]), glow, 0.15);
  const alt = lift(hexToRgb(ex[1]), 0.3);
  const tint = sat(glow) >= 0.35 || sat(alt) <= sat(glow) ? glow : mixRgb(glow, alt, 0.75);
  p = {
    el: key,
    base,
    glow: linear(glow),
    core: linear(core),
    mid: linear(mixRgb(core, glow, 0.55)),
    alt: linear(alt),
    tint: linear(tint),
    smoke: hexToLinear(ex[2]),
    dark: ex[3] ? hexToLinear(ex[3]) : null,
    gloom: GLOOM[key] ? hexToLinear(GLOOM[key]) : null,
    jagged: ex[4],
    linGlow: new THREE.Color().setRGB(glow.r, glow.g, glow.b, THREE.SRGBColorSpace),
    linAlt: new THREE.Color().setRGB(alt.r, alt.g, alt.b, THREE.SRGBColorSpace),
    linCore: new THREE.Color().setRGB(core.r, core.g, core.b, THREE.SRGBColorSpace),
    linTint: new THREE.Color().setRGB(tint.r, tint.g, tint.b, THREE.SRGBColorSpace),
  };
  cache.set(el, p);
  return p;
}

/** Fixed colors (linear) used by the non-elemental effects (dust, death, level up). */
export const COLORS = {
  dust: hexToLinear('#a08a6c'),
  dustDark: hexToLinear('#6e5c48'),
  debris: hexToLinear('#4a3a2c'),
  soul: hexToLinear('#d8e8ff'),
  gold: hexToLinear('#ffd24a'),
  goldCore: hexToLinear('#fff6c8'),
  white: { r: 1, g: 1, b: 1 },
  heal: hexToLinear('#7dff7a'),
  healGold: hexToLinear('#ffe27a'),
  scorch: hexToLinear('#140c08'),
  cloud: hexToLinear('#2a3040'),
  cloudLit: hexToLinear('#56607a'),
  ember: hexToLinear('#ff9a3a'),
};
