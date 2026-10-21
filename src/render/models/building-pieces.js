// Building models, layer 3: the palette of a pantheon style and the reusable pieces buildings are
// composed from: team flags and banners, props, ornaments, walls in each wall material and roofs in
// each roof style. Every piece takes the Kit `k`, the palette `P` and the style `st`, in the model's
// local frame (origin = footprint center at ground level, +X east, +Z south).
import * as THREE from 'three';
import { RNG, hashSeed } from '../../sim/rng.js';
import {
  PLINTH, PI, C, mix, shade, tint,
  luma, clamp01, SURF, made, prep, box, bevelBox, courseSlope, shadedTris,
  frustum, cyl, cone, ball, dome, octa,
  dodeca, torus, strut, pole, extrude, fromTris,
  soft, orient, rectRing, loft, hipLoft, GLOW,
} from './building-core.js';

// ---------------------------------------------------------------------------
// palette
// ---------------------------------------------------------------------------

export const STONE_BY_WALL = { marble: '#ddd7ca', timber: '#8e8a80', mudbrick: '#9a7656', brick: '#958a7e', lacquer: '#8e8c86' };
export const YARD_BY_WALL = {
  marble: '#b5ad99', sandstone: '#bb9d6c', stone: '#837c6f', mudbrick: '#a27f58',
  timber: '#6f5f45', brick: '#8a7a64', lacquer: '#948e83',
};

// The cobbled court a building stands on (earth set with stones), per wall style.
export const COURT_BY_WALL = {
  marble: '#8d7a5c', sandstone: '#9c7d4e', stone: '#7b6b53', mudbrick: '#8a6a47',
  timber: '#6e5a3a', brick: '#76604a', lacquer: '#7d705a',
};

// What the palette colors are made of, per wall / roof style.
export const WALL_SURF = {
  marble: SURF.marble, timber: SURF.wood, sandstone: SURF.sandstone, stone: SURF.stone,
  mudbrick: SURF.mudbrick, brick: SURF.brick, lacquer: SURF.lacquer,
};
export const STONE_SURF = { marble: SURF.marble, sandstone: SURF.sandstone, mudbrick: SURF.mudbrick };
export const YARD_SURF = { marble: SURF.marble, sandstone: SURF.sandstone, brick: SURF.brick, mudbrick: SURF.earth, timber: SURF.earth };

export /** The roof's surface where its slopes are laid in real courses (courseSlope). */
function roofCourseSurf(st) {
  switch (st.roof) {
    case 'gable': return SURF.tileC;
    case 'curved': return SURF.glazedTileC;
    case 'pagoda': return SURF.slateTileC;
    default: return roofSurf(st);
  }
}

function roofSurf(st) {
  switch (st.roof) {
    case 'gable': return SURF.tile;
    case 'curved': return SURF.glazedTile;
    case 'pagoda': return SURF.slateTile;
    case 'longhouse': return SURF.turf;
    case 'thatch_cone': return SURF.thatch;
    case 'pyramid': return st.wall === 'sandstone' || st.wall === 'mudbrick' ? SURF.sandstone : SURF.stone;
    case 'shikhara': return SURF.sandstone;
    case 'dome': return SURF.plaster;
    case 'stepped': return st.wall === 'mudbrick' || st.wall === 'brick' ? SURF.mudbrick : SURF.plaster; // painted stucco
    default: return WALL_SURF[st.wall] || SURF.stone;
  }
}

/**
 * A building color graded for the world's light: near-white colors are pulled down a little (up to
 * 14%), so a low golden sun does not burn marble, plaster and sand out to flat white.
 */
export function gradeColor(hex) {
  const c = C(hex);
  const l = luma(c);
  const t = clamp01((l - 0.62) / 0.32);
  return c.multiplyScalar(1 - 0.14 * t * t * (3 - 2 * t));
}

export function makePalette(colors, st) {
  const wall = made(gradeColor(colors.wall), WALL_SURF[st.wall] || SURF.stone);
  const roof = made(gradeColor(colors.roof), roofSurf(st));
  const lacquer = st.wall === 'lacquer';
  const trimSurf = st.wall === 'timber' ? SURF.wood : lacquer ? SURF.lacquer : st.wall === 'mudbrick' && st.roof === 'stepped' ? SURF.glazed : SURF.paint;
  const trim = made(gradeColor(colors.trim), trimSurf);
  // gold-like accents are gold, pale ones silver
  const acc = C(colors.accent).convertLinearToSRGB();
  const accent = made(colors.accent, acc.r - acc.b > 0.25 ? SURF.gold : SURF.metal);
  let stone;
  if (STONE_BY_WALL[st.wall]) stone = gradeColor(STONE_BY_WALL[st.wall]);
  else if (st.wall === 'sandstone') stone = mix(wall, '#b39566', 0.35);
  else stone = shade(wall, 0.88);
  stone.surf = STONE_SURF[st.wall] || SURF.stone;
  const lightTrim = luma(trim) > 0.62;
  return {
    wall, wallD: shade(wall, 0.76), wallL: tint(wall, 0.22),
    roof, roofC: made(gradeColor(colors.roof), roofCourseSurf(st)), roofD: shade(roof, 0.68), roofL: tint(roof, 0.2),
    trim, trimD: shade(trim, 0.72), trimL: tint(trim, 0.3),
    accent, accentD: shade(accent, 0.7),
    stone, stoneD: shade(stone, 0.74), stoneL: tint(stone, 0.18),
    infill: made(lightTrim ? C(colors.trim) : mix(wall, '#2a1410', 0.3), st.wall === 'timber' ? SURF.wood : lightTrim || !lacquer ? SURF.plaster : SURF.lacquer),
    beam: made(lightTrim ? shade(wall, 0.9) : trim, lacquer ? SURF.lacquer : SURF.wood),
    yard: made(YARD_BY_WALL[st.wall] || '#8d877a', YARD_SURF[st.wall] || SURF.stone),
    court: made(COURT_BY_WALL[st.wall] || '#8a8478', SURF.court),
    // the curb stones round the court: matte stone (marble would blow out in a low sun)
    curb: made(shade(stone, st.wall === 'marble' ? 0.93 : 1), st.wall === 'marble' || st.wall === 'stone' || st.wall === 'brick' || st.wall === 'timber' || st.wall === 'lacquer' ? SURF.stone : stone.surf),
    wood: made('#7b5536', SURF.wood), woodD: made('#4d3421', SURF.wood), woodL: made('#a27c54', SURF.wood),
    dark: made('#21180f', SURF.plain), metal: made('#8c949b', SURF.metal), cloth: made('#d6cbb0', SURF.cloth), white: made('#f2ede2', SURF.paint),
    straw: made('#c9a35a', SURF.thatch), leaf: C('#4f7a36'), sack: made('#bfa57a', SURF.cloth),
    fire: C('#ff8a1e'), fireHot: C('#ffe07a'), lantern: C('#ff5a2a'), lamp: C('#ffb04a'),
    gold: made('#f3c63c', SURF.gold),
  };
}

// ---------------------------------------------------------------------------
// team pieces
// ---------------------------------------------------------------------------

/** Flag on a pole: pole foot at (x, y, z); the cloth flies toward the model's center line (dir ±1 along X). */
export function flag(k, P, x, y, z, poleH, fw = 0.4, fh = 0.24, dir = x > 0.001 ? -1 : 1) {
  k.b(cyl(0.016, 0.022, poleH, 4, x, y, z, true), P.woodD, 0);
  k.b(octa(0.035, x, y + poleH + 0.02, z), P.accent, 0);
  const g = prep(new THREE.BoxGeometry(fw, fh, 0.016, 2, 1, 1));
  g.translate(x + dir * (fw / 2 + 0.01), y + poleH - fh / 2 - 0.02, z);
  k.t(g, 1, (vx) => [clamp01(Math.abs(vx - x) / fw), 0]);
}

/** Tall vertical banner on a pole with a crossbar (nobori / war banner), hanging toward the center line. */
export function standard(k, P, x, y, z, h, bw = 0.2, bh = 0.6, dir = x > 0.001 ? -1 : 1) {
  k.b(cyl(0.017, 0.022, h, 4, x, y, z, true), P.woodD, 0);
  k.b(box(bw + 0.05, 0.025, 0.025, x + dir * (bw / 2 + 0.01), y + h - 0.06, z), P.woodD, 0);
  k.b(octa(0.035, x, y + h + 0.02, z), P.accent, 0);
  const g = prep(new THREE.BoxGeometry(bw, bh, 0.016, 1, 3, 1));
  const top = y + h - 0.07;
  g.translate(x + dir * (bw / 2 + 0.02), top - bh / 2, z);
  k.t(g, 1, (vx, vy) => [clamp01((top - vy) / bh) * 0.55, 0]);
}

/** Cloth banner hanging on a wall face that looks south (+Z). */
export function banner(k, P, x, yTop, zFace, w, h) {
  k.b(box(w + 0.06, 0.03, 0.03, x, yTop, zFace + 0.03), P.woodD, 0);
  const g = prep(new THREE.BoxGeometry(w, h, 0.02, 1, 2, 1));
  g.translate(x, yTop - h / 2, zFace + 0.025);
  k.t(g, 1, (vx, vy) => [clamp01((yTop - vy) / h) * 0.25, 0]);
  // pointed tail in a darker shade
  const tail = fromTris([
    [[x + w / 2, yTop - h, zFace + 0.035], [x - w / 2, yTop - h, zFace + 0.035], [x, yTop - h - w * 0.45, zFace + 0.035]],
  ]);
  k.t(tail, 0.75);
  k.b(box(w * 0.5, w * 0.5, 0.02, x, yTop - h * 0.45, zFace + 0.03), P.accent, 0);
}

/** Round shield on a south-facing wall. */
export function shield(k, P, x, y, zFace, r) {
  const g = cyl(r, r, 0.03, 8, 0, 0, 0);
  g.rotateX(PI / 2);
  g.translate(x, y, zFace + 0.02);
  k.t(g, 1);
  k.b(ball(r * 0.28, x, y, zFace + 0.04, 5, 3), P.accent, 0);
}

// ---------------------------------------------------------------------------
// small props
// ---------------------------------------------------------------------------

export function crate(k, P, x, y, z, s, ry = 0) {
  k.b(box(s, s, s, x, y, z, ry), P.woodL, 0.08);
  k.b(box(s * 1.04, s * 0.14, s * 1.04, x, y + s * 0.43, z, ry), P.woodD, 0.05);
}

export function barrel(k, P, x, y, z, s) {
  k.b(cyl(s * 0.42, s * 0.4, s, 6, x, y, z), P.wood, 0.06);
  k.b(cyl(s * 0.44, s * 0.44, s * 0.08, 6, x, y + s * 0.62, z, true), P.woodD, 0);
}

export function sack(k, P, x, y, z, s, color) {
  k.b(dodeca(s * 0.5, x, y + s * 0.38, z).scale(1, 1, 1), color ?? P.sack, 0.1);
}

export function logPile(k, P, x, y, z, len, ry = 0) {
  const rows = [[-0.12, 0], [0, 0], [0.12, 0], [-0.06, 0.1], [0.06, 0.1]];
  for (const [ox, oy] of rows) {
    const g = cyl(0.06, 0.06, len, 5, 0, -len / 2, 0, false);
    g.rotateZ(PI / 2);
    g.translate(0, 0.06 + oy, ox);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    k.b(g, P.wood, 0.1);
  }
}

export function goldPile(k, P, x, y, z, s) {
  k.b(cone(s * 0.5, s * 0.45, 6, x, y, z), P.gold, 0.12);
  k.b(box(s * 0.36, s * 0.12, s * 0.2, x + s * 0.4, y, z + s * 0.25, 0.4), P.gold, 0.05);
}

/**
 * Flames (glowing, flickering) rising from y: a ring of curled tongues of
 * different heights around a hot core, white-yellow at the root, orange in the
 * body and red at the tips, on a bed of glowing coals. Each tongue flickers on
 * its own phase (the flicker shader keys on position).
 */
export const TONGUES = [
  // x, z offset, height, lean toward x, lean toward z
  [0, 0, 1, 0.05, 0.03],
  [-0.07, 0.04, 0.72, -0.28, 0.1],
  [0.07, 0.03, 0.62, 0.3, 0.08],
  [0.02, -0.07, 0.56, 0.06, -0.3],
  [-0.03, 0.08, 0.42, -0.1, 0.34],
];
export function flames(k, P, x, y, z, s) {
  const fh = 0.36 * s;
  const root = P.fireHot;
  const body = P.fire;
  const tip = mix(P.fire, '#b81400', 0.75);
  const n = s < 0.7 ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const [ox, oz, hs, lx, lz] = TONGUES[i];
    const h = fh * hs;
    const g = cone(0.09 * s * (0.65 + 0.35 * hs), h, 4, 0, 0, 0, true);
    g.rotateZ(-lx);
    g.rotateX(lz);
    g.translate(x + ox * s, y, z + oz * s);
    const fg = k.g(g, body, (vx, vy) => [clamp01((vy - y) / fh), 0], GLOW.flame);
    // root to tip gradient (the vertex colors are linear HDR)
    const col = fg.attributes.color;
    const pos = fg.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const t = clamp01((pos.getY(v) - y) / h);
      const c = t < 0.4 ? mix(root, body, t / 0.4) : mix(body, tip, (t - 0.4) / 0.6);
      const gain = (t < 0.4 ? GLOW.core + (GLOW.flame - GLOW.core) * (t / 0.4) : GLOW.flame * (1 - 0.3 * ((t - 0.4) / 0.6)));
      col.setXYZ(v, c.r * gain, c.g * gain, c.b * gain);
    }
  }
  // the hot core
  k.g(cone(0.05 * s, fh * 0.6, 3, x, y, z, true), P.fireHot, (vx, vy) => [clamp01((vy - y) / fh), 0], GLOW.core);
}

/** Brazier on a short stand with a sacred flame. */
export function brazier(k, P, x, y, z, s = 1, standH = 0.3) {
  k.b(cyl(0.035 * s, 0.06 * s, standH * s, 5, x, y, z), P.metal, 0.04);
  k.b(cyl(0.15 * s, 0.07 * s, 0.1 * s, 6, x, y + standH * s, z), P.accentD, 0.04);
  flames(k, P, x, y + (standH + 0.07) * s, z, s);
  return y + (standH + 0.4) * s;
}

/** Fire pit ringed with stones. */
export function firePit(k, P, x, y, z, s = 1) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    k.b(dodeca(0.06 * s, x + Math.cos(a) * 0.15 * s, y + 0.03 * s, z + Math.sin(a) * 0.15 * s), P.stoneD, 0.1);
  }
  flames(k, P, x, y, z, s * 0.9);
}

/** Golden idol: a stylized god statue on a pedestal, facing south. */
export function idol(k, P, x, y, z, s = 1, head = 'halo') {
  k.b(box(0.3 * s, 0.22 * s, 0.26 * s, x, y, z), P.stone, 0.04);
  const by = y + 0.22 * s;
  const gold = P.accent;
  k.b(frustum(0.2 * s, 0.32 * s, 0.13 * s, 0.75, x, by, z), gold, 0.05);
  k.b(frustum(0.16 * s, 0.18 * s, 0.11 * s, 1.25, x, by + 0.3 * s, z), gold, 0.05);
  k.b(ball(0.065 * s, x, by + 0.55 * s, z, 6, 4), gold, 0.03);
  k.b(strut([x - 0.09 * s, by + 0.44 * s, z], [x - 0.16 * s, by + 0.62 * s, z + 0.03 * s], 0.04 * s), gold, 0.03);
  k.b(strut([x + 0.09 * s, by + 0.44 * s, z], [x + 0.14 * s, by + 0.28 * s, z + 0.06 * s], 0.04 * s), gold, 0.03);
  if (head === 'halo') {
    const halo = torus(0.11 * s, 0.014 * s, x, by + 0.57 * s, z - 0.03 * s, 3, 10);
    k.g(halo, tint(P.accent, 0.35), null, GLOW.halo);
  }
  return by + 0.7 * s;
}

/** Stone platform with `steps` stacked slabs; returns the top height. */
export function steps(k, P, w, d, y, n, stepH, inset, color, x = 0, z = 0) {
  let yy = y;
  for (let i = 0; i < n; i++) {
    const ww = w - i * inset * 2;
    const dd = d - i * inset * 2;
    k.b(box(ww, stepH, dd, x, yy, z), i % 2 ? shade(color, 1.06) : color, 0.03);
    yy += stepH;
  }
  return yy;
}

/** Wooden or stone stairway ramp rising toward -Z (front foot at zFront). */
export function stair(k, P, x, y0, y1, zFront, zBack, w, color) {
  const n = Math.max(2, Math.round((y1 - y0) / 0.09));
  const run = (zFront - zBack) / n;
  for (let i = 0; i < n; i++) {
    const h = ((i + 1) * (y1 - y0)) / n;
    k.b(box(w, h, run + 0.001, x, y0, zFront - run * (i + 0.5)), i % 2 ? color : shade(color, 0.92), 0.02);
  }
}

// ---------------------------------------------------------------------------
// ornament pieces
// ---------------------------------------------------------------------------

/** Classical column: base, shaft, capital. */
export function column(k, P, x, y, z, h, r, color = P.wallL) {
  k.b(box(r * 2.5, 0.05, r * 2.5, x, y, z), color, 0.02);
  k.b(cyl(r * 0.88, r, h - 0.11, 6, x, y + 0.05, z, true), color, 0.03);
  k.b(box(r * 2.7, 0.06, r * 2.7, x, y + h - 0.06, z), color, 0.02);
}

export function obelisk(k, P, x, y, z, h) {
  const w = h * 0.13;
  k.b(box(w * 1.7, h * 0.07, w * 1.7, x, y, z), P.stoneD, 0.03);
  k.b(frustum(w, h * 0.82, w, 0.62, x, y + h * 0.07, z), P.wall, 0.03);
  k.b(cone(w * 0.44, h * 0.13, 4, x, y + h * 0.89, z, true, true), P.accent, 0);
  k.b(box(w * 0.5, h * 0.4, 0.01, x, y + h * 0.3, z + w * 0.42), P.trimD, 0);
}

/** Carved wooden post topped with a beast head facing south. */
export function carvedPost(k, P, x, y, z, h) {
  const w = h * 0.12;
  k.b(box(w, h * 0.78, w, x, y, z), P.wood, 0.06);
  for (let i = 0; i < 3; i++) k.b(box(w * 1.25, h * 0.06, w * 1.25, x, y + h * (0.18 + i * 0.2), z), i % 2 ? P.accent : P.trim, 0.03);
  const hy = y + h * 0.78;
  k.b(box(w * 1.2, h * 0.16, w * 1.3, x, hy, z), P.trim, 0.05);
  k.b(box(w * 0.9, h * 0.07, w * 1.0, x, hy + h * 0.02, z + w * 0.9), P.trim, 0.05);
  k.b(cone(w * 0.25, h * 0.12, 4, x - w * 0.4, hy + h * 0.15, z), P.accent, 0);
  k.b(cone(w * 0.25, h * 0.12, 4, x + w * 0.4, hy + h * 0.15, z), P.accent, 0);
  k.b(box(w * 0.22, w * 0.22, 0.02, x - w * 0.3, hy + h * 0.1, z + w * 0.66), P.accent, 0);
  k.b(box(w * 0.22, w * 0.22, 0.02, x + w * 0.3, hy + h * 0.1, z + w * 0.66), P.accent, 0);
}

/** Stone lamp pillar (deepastambha) ringed with small flames. */
export function lampPillar(k, P, x, y, z, h) {
  k.b(box(h * 0.22, h * 0.08, h * 0.22, x, y, z), P.stoneD, 0.04);
  k.b(cyl(h * 0.05, h * 0.075, h * 0.82, 6, x, y + h * 0.08, z, true), P.stone, 0.04);
  for (let i = 0; i < 2; i++) {
    const yy = y + h * (0.36 + i * 0.26);
    const r = h * (0.14 - i * 0.035);
    k.b(cyl(r, r * 0.8, h * 0.03, 6, x, yy, z), P.accentD, 0.03);
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * PI * 2 + i * 0.4;
      k.g(cone(h * 0.025, h * 0.07, 3, x + Math.cos(a) * r * 0.85, yy + h * 0.03, z + Math.sin(a) * r * 0.85, true), P.fireHot, null, GLOW.lamp);
    }
  }
  k.b(cone(h * 0.07, h * 0.12, 6, x, y + h * 0.9, z), P.accent, 0);
  flames(k, P, x, y + h * 1.0, z, h * 0.35);
}

/** Torii gate spanning `span` at z, facing south. */
export function torii(k, P, cx, y, z, span, h) {
  const r = 0.035 + span * 0.025;
  const red = luma(P.wall) > 0.25 && P.wall.r > P.wall.g * 1.3 ? made(P.wall, SURF.lacquer) : made('#d8462c', SURF.lacquer);
  for (const sx of [-1, 1]) {
    k.b(cyl(r * 0.9, r, h, 6, cx + (sx * span) / 2, y, z, true), red, 0.03);
    k.b(cyl(r * 1.25, r * 1.25, 0.06, 6, cx + (sx * span) / 2, y, z), P.dark, 0);
  }
  // kasagi: gently curved top beam with upturned ends
  const L = span / 2 + 0.22;
  const pts = [];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const px = -L + 2 * L * t;
    pts.push([px, 0.05 * Math.pow(Math.abs(2 * t - 1), 2.5)]);
  }
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    const px = -L * 1.04 + 2 * L * 1.04 * t;
    pts.push([px, 0.11 + 0.08 * Math.pow(Math.abs(2 * t - 1), 2.5)]);
  }
  const kasagi = extrude(pts, r * 2.6);
  kasagi.translate(cx, y + h - 0.02, z);
  k.b(kasagi, made(P.roofD.r + P.roofD.g + P.roofD.b < 0.3 ? P.roofD : '#2a2a2e', SURF.lacquer), 0.02);
  k.b(box(span + 0.16, 0.06, r * 1.6, cx, y + h * 0.78, z), red, 0.02);
  k.b(box(0.06, h * 0.2, r * 1.4, cx, y + h * 0.8, z), red, 0.02);
  return y + h + 0.17;
}

/** Stone lantern (toro). */
export function stoneLantern(k, P, x, y, z, h) {
  k.b(cyl(h * 0.12, h * 0.16, h * 0.12, 6, x, y, z), P.stoneD, 0.04);
  k.b(cyl(h * 0.05, h * 0.06, h * 0.38, 6, x, y + h * 0.12, z), P.stone, 0.04);
  k.b(box(h * 0.24, h * 0.06, h * 0.24, x, y + h * 0.5, z), P.stone, 0.03);
  k.g(box(h * 0.15, h * 0.16, h * 0.15, x, y + h * 0.56, z), P.fireHot, null, GLOW.lamp);
  k.b(cone(h * 0.22, h * 0.16, 4, x, y + h * 0.72, z, true, true), P.stoneD, 0.03);
  k.b(ball(h * 0.04, x, y + h * 0.9, z, 4, 3), P.stone, 0);
}

/** Post with an arm and a hanging red paper lantern. */
export function lanternPost(k, P, x, y, z, h, dir = 1) {
  k.b(cyl(0.02, 0.026, h, 4, x, y, z, true), P.wall, 0.03);
  k.b(box(0.22, 0.03, 0.03, x + dir * 0.09, y + h - 0.04, z), P.woodD, 0);
  hangingLantern(k, P, x + dir * 0.17, y + h - 0.05, z, 0.11);
}

export function hangingLantern(k, P, x, yTop, z, s) {
  k.g(ball(s * 0.5, x, yTop - s * 0.65, z, 6, 4, 1.25), P.lantern, null, GLOW.paper);
  k.b(cyl(s * 0.28, s * 0.28, s * 0.08, 5, x, yTop - s * 0.18, z), P.dark, 0);
  k.b(cyl(s * 0.28, s * 0.28, s * 0.08, 5, x, yTop - s * 1.3, z), P.dark, 0);
  k.b(cyl(s * 0.03, s * 0.03, s * 0.3, 3, x, yTop - s * 1.6, z, true), P.accent, 0);
}

/** Feathered serpent head at ground level facing south. */
export function serpentHead(k, P, x, y, z, s) {
  const c = P.trim;
  k.b(box(0.3 * s, 0.24 * s, 0.38 * s, x, y, z), P.stone, 0.06);
  k.b(box(0.26 * s, 0.14 * s, 0.22 * s, x, y + 0.08 * s, z + 0.24 * s), c, 0.05);
  k.b(box(0.24 * s, 0.06 * s, 0.2 * s, x, y + 0.01 * s, z + 0.25 * s), c, 0.05);
  k.b(box(0.2 * s, 0.03 * s, 0.03 * s, x, y + 0.07 * s, z + 0.35 * s), P.white, 0);
  for (const sx of [-1, 1]) {
    k.b(box(0.05 * s, 0.05 * s, 0.05 * s, x + sx * 0.1 * s, y + 0.2 * s, z + 0.27 * s), P.accent, 0);
    k.b(strut([x + sx * 0.12 * s, y + 0.2 * s, z - 0.1 * s], [x + sx * 0.2 * s, y + 0.42 * s, z - 0.15 * s], 0.06 * s, 0.03 * s), P.accent, 0.05);
  }
  k.b(strut([x, y + 0.22 * s, z - 0.1 * s], [x, y + 0.45 * s, z - 0.18 * s], 0.06 * s, 0.03 * s), c, 0.05);
}

/** Standing stone with a carved knot disc. */
export function standingStone(k, P, x, y, z, h, ry = 0) {
  const g = frustum(0.24 * (h / 0.85), h, 0.15 * (h / 0.85), 0.72, 0, 0, 0, 0.8);
  const p = g.attributes.position;
  const rr = new RNG(hashSeed(`${x.toFixed(2)},${z.toFixed(2)}`));
  for (let i = 0; i < p.count; i++) if (p.getY(i) > h * 0.5) p.setY(i, p.getY(i) + (rr.next() - 0.5) * 0.08);
  g.rotateY(ry);
  g.translate(x, y, z);
  k.b(g, P.stone, 0.1);
  const disc = torus(0.055 * (h / 0.85), 0.012, 0, 0, 0, 3, 8);
  disc.rotateY(ry);
  const fx = Math.sin(ry) * 0.08 * (h / 0.85);
  const fz = Math.cos(ry) * 0.08 * (h / 0.85);
  disc.translate(x + fx, y + h * 0.62, z + fz);
  k.b(disc, P.accent, 0);
}

/** Lamassu: winged human-headed bull guardian facing south. */
export function lamassu(k, P, x, y, z, s) {
  const c = P.stoneL;
  k.b(box(0.32 * s, 0.1 * s, 0.56 * s, x, y, z), P.stoneD, 0.04);
  const by = y + 0.1 * s;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(box(0.08 * s, 0.22 * s, 0.08 * s, x + sx * 0.09 * s, by, z + sz * 0.18 * s), c, 0.04);
  k.b(box(0.26 * s, 0.2 * s, 0.5 * s, x, by + 0.2 * s, z), c, 0.04);
  k.b(box(0.18 * s, 0.2 * s, 0.16 * s, x, by + 0.34 * s, z + 0.27 * s), c, 0.04);
  k.b(frustum(0.16 * s, 0.14 * s, 0.06 * s, 0.6, x, by + 0.22 * s, z + 0.36 * s), P.dark, 0.05);
  k.b(cyl(0.08 * s, 0.07 * s, 0.13 * s, 6, x, by + 0.54 * s, z + 0.27 * s), P.accent, 0.02);
  for (const sx of [-1, 1]) {
    const wx = x + sx * 0.14 * s;
    const a = [wx, by + 0.3 * s, z + 0.18 * s];
    const b = [wx, by + 0.3 * s, z - 0.25 * s];
    const c = [wx, by + 0.62 * s, z - 0.28 * s];
    const d = [wx, by + 0.5 * s, z + 0.1 * s];
    k.b(fromTris([[a, b, c], [a, c, d], [a, c, b], [a, d, c]]), P.accentD, 0.08);
  }
}

/** Mudbrick pinnacle with wooden spikes and an ostrich-egg finial. */
export function pinnacle(k, P, x, y, z, h, w = 0.22) {
  k.b(frustum(w, h, w, 0.55, x, y, z), P.wall, 0.05);
  k.b(cone(w * 0.32, h * 0.22, 6, x, y + h, z), P.wall, 0.04);
  k.b(ball(w * 0.15, x, y + h + h * 0.22, z, 5, 4, 1.3), P.white, 0);
  for (let i = 0; i < 2; i++) {
    const yy = y + h * (0.35 + i * 0.3);
    const ww = w * (1 - 0.45 * (0.35 + i * 0.3)) * 0.5;
    k.b(box(0.03, 0.03, 0.16, x, yy, z + ww), P.woodD, 0);
    k.b(box(0.16, 0.03, 0.03, x + ww * (i ? -1 : 1), yy, z), P.woodD, 0);
  }
}

/** One ornament item of the pantheon's kind at (x, z), scaled by s. */
export function ornament(k, P, st, x, y, z, s, side = 1) {
  switch (st.ornament) {
    case 'columns':
      column(k, P, x, y, z, 0.85 * s, 0.07 * s);
      k.b(ball(0.06 * s, x, y + 0.9 * s, z, 6, 3, 1.2), P.accent, 0);
      break;
    case 'carvings':
      if (st.wall === 'timber') carvedPost(k, P, x, y, z, 0.9 * s);
      else lampPillar(k, P, x, y, z, 0.95 * s);
      break;
    case 'obelisks':
      obelisk(k, P, x, y, z, 1.15 * s);
      break;
    case 'torii':
      stoneLantern(k, P, x, y, z, 0.62 * s);
      break;
    case 'lanterns':
      lanternPost(k, P, x, y, z, 0.75 * s, -side);
      break;
    case 'serpents':
      serpentHead(k, P, x, y, z, 0.85 * s);
      break;
    case 'knots':
      standingStone(k, P, x, y, z, 0.85 * s, side * 0.2);
      break;
    case 'winged_bulls':
      lamassu(k, P, x, y, z, 0.95 * s);
      break;
    case 'spikes':
      pinnacle(k, P, x, y, z, 0.85 * s, 0.2 * s);
      break;
    case 'banners':
    default:
      standard(k, P, x, y, z, 1.1 * s, 0.18 * s, 0.5 * s);
      break;
  }
}

/** A matching pair of ornaments flanking an entrance (torii spans the gap instead). */
export function ornamentPair(k, P, st, x, y, z, s) {
  if (st.ornament === 'torii') return torii(k, P, 0, y, z, x * 2, 0.95 * s);
  ornament(k, P, st, -x, y, z, s, -1);
  ornament(k, P, st, x, y, z, s, 1);
  return y + s;
}

// ---------------------------------------------------------------------------
// walls
// ---------------------------------------------------------------------------

export const isRound = (st) => st.roof === 'thatch_cone' || st.roof === 'dome';

/**
 * A box of the kit's detail level: rounded off by r at lod 1 (where the rounding can be seen: a
 * thin post stays a plain box), a plain box at lod 0.
 */
export function bx(k, r, w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  return k.lod && r > 0 && Math.min(w, d) >= 0.2 ? bevelBox(w, h, d, r, x, y, z, ry) : box(w, h, d, x, y, z, ry);
}

/** A lantern hung from a bracket on a south-facing wall: iron cage, glowing body (lod 1). */
export function wallLantern(k, P, x, y, fz, s = 1) {
  if (!k.lod) return;
  k.b(box(0.014 * s, 0.014 * s, 0.075 * s, x, y + 0.095 * s, fz + 0.035 * s), P.dark, 0);
  k.b(box(0.05 * s, 0.012 * s, 0.05 * s, x, y + 0.085 * s, fz + 0.075 * s), P.dark, 0);
  k.g(box(0.036 * s, 0.056 * s, 0.036 * s, x, y + 0.03 * s, fz + 0.075 * s), P.lamp, null, GLOW.lamp);
  k.b(box(0.05 * s, 0.01 * s, 0.05 * s, x, y + 0.02 * s, fz + 0.075 * s), P.dark, 0);
}

export function door(k, P, st, x, y, fz, w, h, rich = true) {
  const frame = st.wall === 'timber' ? P.woodD : st.wall === 'lacquer' ? P.beam : P.trim;
  k.b(box(w + 0.1, h + 0.06, 0.05, x, y, fz + 0.005), frame, 0.03);
  k.hole(box(w, h, 0.06, x, y, fz + 0.012), y, h);
  if (st.wall === 'mudbrick' || st.wall === 'sandstone') k.b(box(w + 0.14, 0.05, 0.07, x, y + h + 0.06, fz + 0.01), P.wallD, 0.03);
  if (!rich) return;
  // a worn stone threshold, and a stone lintel over doors set in timber or plaster
  k.b(box(w + 0.12, 0.022, 0.07, x, y, fz + 0.035), P.stoneL, 0.04);
  if (st.wall === 'timber' || st.wall === 'marble' || st.wall === 'stone') k.b(box(w + 0.15, 0.04, 0.065, x, y + h + 0.05, fz + 0.015), P.stone, 0.04);
}

export function windowHole(k, P, x, y, fz, w = 0.12, h = 0.16, rich = true, shutters = true) {
  k.b(box(w + 0.05, h + 0.05, 0.03, x, y - 0.025, fz + 0.004), P.wallD, 0);
  k.hole(box(w, h, 0.04, x, y, fz + 0.008), y, h);
  if (!rich) return;
  // projecting sill and lintel give the opening a recess
  k.b(box(w + 0.1, 0.028, 0.06, x, y - 0.052, fz + 0.022), P.stoneL, 0.03);
  k.b(box(w + 0.09, 0.03, 0.05, x, y + h + 0.012, fz + 0.016), P.wallD, 0.02);
  if (k.lod && shutters) {
    // shutters in the trim color, hung open against the wall at a slight angle
    const a = 0.05;
    const ang = 0.5;
    for (const sx of [-1, 1]) {
      const hx = x + sx * (w / 2 + 0.03);
      k.b(box(a, h + 0.03, 0.014, hx + sx * (a / 2) * Math.cos(ang), y - 0.012, fz + 0.016 + (a / 2) * Math.sin(ang), -sx * ang), P.trim, 0.05);
    }
  }
}

/** Wooden spikes (toron) protruding from a south and side walls. */
export function torons(k, P, x, z, w, d, y, h) {
  const rows = h > 0.75 ? 2 : 1;
  for (let r = 0; r < rows; r++) {
    const yy = y + h * (rows === 1 ? 0.62 : 0.38 + r * 0.38);
    const nf = Math.max(2, Math.round(w / 0.4));
    for (let i = 0; i < nf; i++) {
      const px = x - w / 2 + (w * (i + 0.5)) / nf;
      k.b(pole([px, yy, z + d / 2 - 0.02], [px, yy - 0.01, z + d / 2 + 0.12], 0.016, 3), P.woodD, 0);
    }
    const ns = Math.max(1, Math.round(d / 0.45));
    for (const sx of [-1, 1]) {
      for (let i = 0; i < ns; i++) {
        const pz = z - d / 2 + (d * (i + 0.5)) / ns;
        k.b(pole([x + (sx * w) / 2 - sx * 0.02, yy, pz], [x + sx * (w / 2 + 0.12), yy - 0.01, pz], 0.016, 3), P.woodD, 0);
      }
    }
  }
}

/** Carved frieze along the top of the south face. */
export function frieze(k, P, x, fz, w, y) {
  k.b(box(w, 0.07, 0.03, x, y, fz + 0.01), P.trim, 0.03);
  const n = Math.max(2, Math.round(w / 0.24));
  for (let i = 0; i < n; i++) {
    const px = x - w / 2 + (w * (i + 0.5)) / n;
    k.b(box(0.07, 0.05, 0.03, px, y + 0.01, fz + 0.025), P.accent, 0.04);
  }
}

/** Rectangular walls in the pantheon's wall material, with door and windows on the south face. */
export function rectWalls(k, P, st, o) {
  const { x = 0, z = 0, w, d, y = PLINTH, h } = o;
  const fz = z + d / 2;
  let face = fz;
  switch (st.wall) {
    case 'timber': {
      k.b(bx(k, 0.02, w + 0.05, 0.08, d + 0.05, x, y, z), P.stone, 0.1);
      k.b(bx(k, 0.025, w, h - 0.08, d, x, y + 0.08, z), P.wall, 0.07);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(bx(k, 0.02, 0.08, h, 0.08, x + (sx * w) / 2, y, z + (sz * d) / 2), P.woodD, 0.03);
      k.b(bx(k, 0.022, w + 0.07, 0.07, d + 0.07, x, y + h - 0.07, z), P.woodD, 0.03);
      const n = Math.max(1, Math.round(w / 0.3));
      for (let i = 1; i < n; i++) k.b(box(0.022, h - 0.16, 0.02, x - w / 2 + (w * i) / n, y + 0.08, fz), P.woodD, 0);
      // a tie rail and diagonal braces make the front read as a framed wall
      if (!o.simple) k.b(box(w, 0.035, 0.03, x, y + h * 0.5, fz + 0.004), P.woodD, 0.02);
      if (w > 0.9 && !o.simple) {
        const bays = Math.max(2, Math.round(w / 0.6));
        for (let i = 0; i < bays; i++) {
          const x0 = x - w / 2 + (w * i) / bays;
          const x1 = x - w / 2 + (w * (i + 1)) / bays;
          const lo = y + 0.09;
          const hi = y + h * 0.5;
          k.b(strut(i % 2 ? [x1 - 0.05, lo, fz + 0.012] : [x0 + 0.05, lo, fz + 0.012], i % 2 ? [x0 + 0.05, hi, fz + 0.012] : [x1 - 0.05, hi, fz + 0.012], 0.03, 0.018), P.woodD, 0.02);
        }
      }
      break;
    }
    case 'marble':
      k.b(bx(k, 0.022, w + 0.08, 0.06, d + 0.08, x, y, z), P.stoneL, 0.02);
      k.b(bx(k, 0.03, w, h, d, x, y, z), P.wall, 0.025);
      k.b(bx(k, 0.022, w + 0.06, 0.1, d + 0.06, x, y + h - 0.1, z), P.wallL, 0.02);
      k.b(bx(k, 0.012, w + 0.075, 0.035, d + 0.075, x, y + h - 0.07, z), P.trim, 0.02);
      break;
    case 'sandstone':
      k.b(box(w + 0.06, 0.06, d + 0.06, x, y, z), P.wallD, 0.03);
      k.b(frustum(w, h, d, 0.94, x, y, z), P.wall, 0.04);
      k.b(box(w * 0.94 + 0.09, 0.08, d * 0.94 + 0.09, x, y + h - 0.06, z), P.trim, 0.02);
      k.b(box(w * 0.94 + 0.03, 0.025, d * 0.94 + 0.03, x, y + h - 0.1, z), P.accent, 0.02);
      face = z + (d / 2) * 0.97;
      break;
    case 'mudbrick':
      k.b(box(w + 0.12, 0.12, d + 0.12, x, y, z), P.wallD, 0.04);
      k.b(frustum(w + 0.04, h, d + 0.04, 0.92, x, y, z), P.wall, 0.05);
      k.b(frustum(w * 0.92 + 0.02, 0.07, d * 0.92 + 0.02, 0.9, x, y + h, z), P.wallL, 0.04);
      face = z + (d / 2) * 0.97;
      break;
    case 'brick':
      k.b(bx(k, 0.025, w, h, d, x, y, z), P.wall, 0.05);
      for (let i = 1; i <= 2; i++) k.b(box(w + 0.02, 0.025, d + 0.02, x, y + (i * h) / 3, z), P.wallD, 0);
      k.b(bx(k, 0.02, w + 0.06, 0.06, d + 0.06, x, y + h - 0.06, z), P.trim, 0.02);
      break;
    case 'lacquer': {
      k.b(bx(k, 0.025, w + 0.08, 0.09, d + 0.08, x, y, z), P.stone, 0.06);
      k.b(bx(k, 0.02, w - 0.04, h - 0.09, d - 0.04, x, y + 0.09, z), P.infill, 0.03);
      const n = Math.max(2, Math.round(w / 0.55) + 1);
      for (let i = 0; i < n; i++) {
        const px = x - w / 2 + (w * i) / (n - 1);
        k.b(bx(k, 0.025, 0.08, h - 0.09, 0.08, px, y + 0.09, fz - 0.02), P.wall, 0.03);
        k.b(bx(k, 0.025, 0.08, h - 0.09, 0.08, px, y + 0.09, z - d / 2 + 0.02), P.wall, 0.03);
      }
      k.b(bx(k, 0.02, w + 0.04, 0.08, d + 0.04, x, y + h - 0.08, z), P.wall, 0.02);
      k.b(bx(k, 0.02, w + 0.1, 0.05, d + 0.1, x, y + h - 0.02, z), P.beam, 0.02);
      break;
    }
    case 'stone':
    default: {
      k.b(bx(k, 0.025, w + 0.06, 0.1, d + 0.06, x, y, z), P.stoneD, 0.08);
      k.b(bx(k, 0.03, w, h, d, x, y, z), P.wall, 0.08);
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const qy = y + 0.12 + (i * (h - 0.22)) / 3;
          k.b(box(0.1 + (i % 2) * 0.06, 0.1, 0.05, x + sx * (w / 2 - 0.04 - (i % 2) * 0.03), qy, fz + 0.004), P.wallL, 0.03);
        }
      }
      k.b(bx(k, 0.02, w + 0.04, 0.05, d + 0.04, x, y + h - 0.05, z), P.wallD, 0.04);
      break;
    }
  }
  if (o.door !== false) {
    const dw = o.doorW ?? Math.min(0.32, w * 0.24);
    const dh = o.doorH ?? Math.min(h * 0.62, 0.5);
    door(k, P, st, x, y, face, dw, dh, !o.simple);
    if (!o.simple && o.lantern !== false) wallLantern(k, P, x + dw / 2 + 0.12, y + dh * 0.58, face + 0.01);
  }
  const nw = o.windows ?? 0;
  if (nw > 0) {
    const wy = y + h * 0.55;
    for (const sx of [-1, 1]) windowHole(k, P, x + sx * w * 0.3, wy, face, 0.12, 0.16, !o.simple);
    if (nw > 1 && d > 0.7) {
      for (const sx of [-1, 1]) {
        const g = box(0.04, 0.16, 0.12, x + sx * (w / 2 + 0.005), wy, z);
        k.hole(g, wy, 0.16);
      }
    }
  }
  if (st.ornament === 'spikes') torons(k, P, x, z, w, d, y, h);
  if (st.ornament === 'carvings' && st.wall !== 'timber') frieze(k, P, x, face, w * 0.9, y + h - 0.2);
  if (st.ornament === 'carvings' && st.wall === 'timber' && o.door !== false) { // the boards flank the door
    for (const sx of [-1, 1]) carvedBoard(k, P, x + sx * (o.doorW ?? Math.min(0.32, w * 0.24)) * 0.5 + sx * 0.08, y, face, Math.min(h * 0.72, 0.6));
  }
}

/** Carved door-side board for timber halls. */
export function carvedBoard(k, P, x, y, fz, h) {
  k.b(box(0.07, h, 0.04, x, y, fz + 0.02), P.trim, 0.04);
  for (let i = 0; i < 3; i++) k.b(box(0.09, 0.04, 0.05, x, y + h * (0.25 + i * 0.27), fz + 0.025), P.accent, 0);
}

/** Round walls (a flat face looks south) in the wall material. */
export function roundWalls(k, P, st, o) {
  const { x = 0, z = 0, r, y = PLINTH, h } = o;
  const seg = o.seg ?? 10;
  const taper = st.wall === 'mudbrick' || st.wall === 'sandstone' ? 0.9 : 1;
  k.b(cyl(r + 0.05, r + 0.07, 0.09, seg, x, y, z, true, true), st.wall === 'mudbrick' ? P.wallD : P.stoneD, 0.08);
  k.b(cyl(r * taper, r, h, seg, x, y, z, true, true), P.wall, st.wall === 'stone' ? 0.1 : 0.05);
  if (st.wall === 'timber' || st.wall === 'lacquer') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + PI / 6;
      k.b(box(0.07, h, 0.07, x + Math.sin(a) * r, y, z + Math.cos(a) * r, a), st.wall === 'lacquer' ? P.wall : P.woodD, 0.03);
    }
  }
  const face = z + r * Math.cos(PI / seg) * (taper < 1 ? 0.97 : 1);
  if (o.door !== false) door(k, P, st, x, y, face, o.doorW ?? Math.min(0.3, r * 0.42), o.doorH ?? Math.min(h * 0.7, 0.48));
  if (st.ornament === 'spikes') {
    for (let row = 0; row < (h > 0.7 ? 2 : 1); row++) {
      const yy = y + h * (0.45 + row * 0.3);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2 + PI / 8;
        const rr = r * (1 - (1 - taper) * ((yy - y) / h));
        k.b(pole([x + Math.sin(a) * (rr - 0.02), yy, z + Math.cos(a) * (rr - 0.02)], [x + Math.sin(a) * (rr + 0.13), yy - 0.01, z + Math.cos(a) * (rr + 0.13)], 0.016, 3), P.woodD, 0);
      }
    }
  }
  if (st.ornament === 'knots') {
    k.b(torus(r * 0.16, 0.014, x, y + h * 0.7, face + 0.02, 3, 8), P.accent, 0);
  }
}

// ---------------------------------------------------------------------------
// roofs (each returns the top height)
// ---------------------------------------------------------------------------

/** Pleasing roof height for a style and span. */
export function roofH(st, span, grade = 'small') {
  const g = grade === 'grand' ? 1.25 : grade === 'mid' ? 1.1 : 1;
  switch (st.roof) {
    case 'gable': return span * 0.34 * g;
    case 'longhouse': return span * 0.42 * g;
    case 'pyramid': return span * (grade === 'small' ? 0.36 : 0.55) * g;
    case 'pagoda': return span * 0.3 * g;
    case 'curved': return span * 0.36 * g;
    case 'shikhara': return span * (grade === 'small' ? 0.55 : 0.85) * g;
    case 'thatch_cone': return span * 0.62 * g;
    case 'dome': return span * 0.4 * g;
    case 'stepped': return 0.12;
    default: return 0.1;
  }
}

/** How far a style's roof (and its ornaments) reaches past the walls. */
export function roofOver(st, w = 2) {
  switch (st.roof) {
    case 'gable': return 0.11;
    case 'longhouse': return 0.22;
    case 'pyramid': return 0.08;
    case 'pagoda': return Math.min(0.24, 0.1 + 0.08 * w) + 0.02;
    case 'curved': return Math.min(0.22, 0.09 + 0.07 * w) + 0.03;
    case 'thatch_cone': return 0.15;
    case 'shikhara': return 0.04;
    case 'stepped': return 0.05;
    case 'dome': return 0.04;
    default: return 0.04;
  }
}

/** Collect parts in a local frame, then turn and move them. */
export function placer(k, x, y, z, ry) {
  return (bucket, g, color, jit, anim) => {
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return k.add(bucket, g, color, jit, anim);
  };
}

export function roofGable(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  const alongX = (o.ridge ?? (w >= d ? 'x' : 'z')) === 'x';
  const len = alongX ? w : d;
  const span = alongX ? d : w;
  const over = 0.1;
  const overEnd = 0.08;
  const L = len / 2 + overEnd;
  const S = span / 2 + over;
  const ye = (-over * h) / (span / 2);
  const put = placer(k, x, y, z, alongX ? 0 : PI / 2);
  // each slope laid in courses, so the rows are real: a dark butt edge, a face shadowed under the next row
  const rows = Math.max(4, Math.min(12, Math.round(Math.hypot(S, h - ye) / 0.12)));
  const lip = Math.min(0.034, 0.02 + h * 0.03);
  const rnd = () => k.rng.next();
  put('body', courseSlope([-L, ye, S], [L, ye, S], [-L, h, 0], [L, h, 0], rows, lip, { rnd }), P.roofC, 0.02);
  put('body', courseSlope([L, ye, -S], [-L, ye, -S], [L, h, 0], [-L, h, 0], rows, lip, { rnd }), P.roofC, 0.02);
  const hl = len / 2;
  const sp = span / 2;
  const ends = fromTris(orient([
    [[hl, 0, sp], [hl, 0, -sp], [hl, h - 0.02, 0]],
    [[-hl, 0, -sp], [-hl, 0, sp], [-hl, h - 0.02, 0]],
  ], () => [0, 0.01, 0]));
  put('body', ends, st.wall === 'marble' ? P.wallL : P.wall, 0.02);
  if (st.ornament === 'columns' || grade !== 'small') {
    const ih = (h - 0.02) * 0.62;
    const isp = sp * 0.62;
    const yb = (h - 0.02) * 0.14;
    const tymp = fromTris([
      [[hl + 0.012, yb, isp], [hl + 0.012, yb, -isp], [hl + 0.012, yb + ih, 0]],
      [[-hl - 0.012, yb, -isp], [-hl - 0.012, yb, isp], [-hl - 0.012, yb + ih, 0]],
    ]);
    put('body', tymp, P.trim, 0.02);
  }
  const slopeLen = Math.hypot(S, h - ye);
  const ang = Math.atan2(h - ye, S);
  for (const sz of [-1, 1]) {
    put('body', box(2 * L + 0.02, 0.05, 0.05, 0, ye - 0.035, sz * S), P.roofD, 0.02);
    for (const sx of [-1, 1]) {
      const rake = box(0.05, 0.05, slopeLen, 0, -0.025, 0);
      rake.translate(0, 0, -slopeLen / 2);
      rake.rotateX(ang);
      if (sz < 0) rake.rotateY(PI);
      rake.translate(sx * L, ye, sz * S);
      put('body', rake, P.roofD, 0.02);
    }
  }
  // a rounded ridge
  const cap = pole([-L - 0.015, h - 0.002, 0], [L + 0.015, h - 0.002, 0], 0.056, 6);
  if (team) put('team', cap, 1);
  else put('body', cap, P.roofD, 0.02);
  if (grade === 'grand' || st.ornament === 'columns') {
    for (const sx of [-1, 1]) put('body', cone(0.05, 0.14, 4, sx * (L - 0.02), h + 0.02, 0, true), P.accent, 0);
  }
  return y + h + 0.05;
}

export function roofLonghouse(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  const alongX = w >= d;
  const len = alongX ? w : d;
  const span = alongX ? d : w;
  const put = placer(k, x, y, z, alongX ? 0 : PI / 2);
  const L = len / 2 + 0.04;
  const S = span / 2 + 0.12;
  const ye = -0.06;
  // the sod laid in thick overlapping strips, each shadowed under the next, with a dark underside
  const rows = o.simple ? 4 : Math.max(5, Math.min(9, Math.round(Math.hypot(S, h - ye) / 0.14)));
  const rnd = () => k.rng.next();
  const opts = { shadow: 0.28, butt: 0.5, tint: 0.1, rnd };
  put('body', courseSlope([-L, ye, S], [L, ye, S], [-L, h, 0], [L, h, 0], rows, 0.04, opts), P.roof, 0.03);
  put('body', courseSlope([L, ye, -S], [-L, ye, -S], [L, h, 0], [-L, h, 0], rows, 0.04, opts), P.roof, 0.03);
  // the edge of the turf: a thick, dark roll (round from a hall's roof on, a square beam on a lookout's)
  const sg = o.simple ? 4 : 6;
  const roll = shade(P.roofD, 0.8);
  for (const sz of [-1, 1]) put('body', pole([-L, ye + 0.03, sz * S * 0.985], [L, ye + 0.03, sz * S * 0.985], 0.05, sg), roll, 0.03);
  const sp = span / 2;
  const hl = len / 2;
  put('body', fromTris(orient([
    [[hl, 0, sp], [hl, 0, -sp], [hl, h - 0.05, 0]],
    [[-hl, 0, -sp], [-hl, 0, sp], [-hl, h - 0.05, 0]],
  ], () => [0, 0, 0])), P.wallD, 0.04);
  // ridge: a round beam in the team's color
  const ridge = pole([-L, h, 0], [L, h, 0], 0.045, sg);
  if (team) put('team', ridge, 1);
  else put('body', ridge, P.roofD, 0.02);
  // grass takes root along the ridge of a sod roof and hangs over its eaves in strands
  if (k.lod && !o.simple && !k.tight) {
    const grass = made(mix(P.roof, '#a8c24e', 0.35), SURF.plain);
    const nh = Math.max(3, Math.round(len / 0.2));
    for (const sz of [-1, 1]) {
      for (let i = 0; i < nh; i++) {
        const px = (((i + 0.5) / nh) * 2 - 1) * L * 0.96 + k.rand(-0.04, 0.04);
        const drop = k.rand(0.045, 0.085);
        put('body', pole([px, ye + 0.03, sz * S * 0.985], [px + k.rand(-0.02, 0.02), ye + 0.03 - drop, sz * (S + 0.005)], 0.016, 3), grass, 0.1);
      }
    }
    const nt = Math.max(4, Math.round(len / 0.2));
    for (let i = 0; i < nt; i++) {
      const sc = k.rand(0.6, 1.15);
      put('body', cone(0.024 * sc, 0.09 * sc, 3, (((i + 0.5) / nt) * 2 - 1) * L * 0.94 + k.rand(-0.03, 0.03), h - 0.012, k.rand(-0.06, 0.06), true), grass, 0.1);
    }
  }
  // crossed gable boards, carved into dragon heads on grander halls
  const dragons = !o.simple && (grade !== 'small' || st.ornament === 'carvings');
  for (const sx of [-1, 1]) {
    const ex = sx * L;
    const tip = dragons ? 0.08 : 0.14;
    if (!o.simple) {
      for (const sz of [-1, 1]) {
        const t = (h + tip - ye) / (h - ye);
        put('body', strut([ex, ye, sz * S], [ex, ye + (h - ye) * t, sz * S * (1 - t)], 0.05, 0.05), P.trim, 0.03);
      }
    }
    if (dragons) {
      const hy = h + 0.04;
      put('body', strut([ex, hy - 0.04, 0], [ex + sx * 0.05, hy + 0.13, 0], 0.07), P.trim, 0.04);
      put('body', strut([ex + sx * 0.03, hy + 0.13, 0], [ex + sx * 0.17, hy + 0.15, 0], 0.075, 0.065), P.trim, 0.04);
      put('body', strut([ex + sx * 0.05, hy + 0.08, 0], [ex + sx * 0.15, hy + 0.07, 0], 0.03, 0.05), P.trim, 0.04);
      put('body', cone(0.025, 0.08, 4, ex + sx * 0.04, hy + 0.17, 0, true), P.accent, 0);
    }
  }
  return y + h + (dragons ? 0.24 : 0.16);
}

export function roofPyramid(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  const hw = w / 2 + 0.07;
  const hd = d / 2 + 0.07;
  const capF = grade === 'small' ? 0.7 : 0.82;
  k.b(hipLoft({ cx: x, cz: z, y: y - 0.02, hw, hd, tw: hw * (1 - capF), td: hd * (1 - capF), h: h * capF, steps: 1 }), P.roof, 0.04);
  if (grade === 'small') {
    k.b(box(hw * 2 * (1 - capF), 0.03, hd * 2 * (1 - capF), x, y - 0.02 + h * capF, z), P.roofD, 0);
    k.b(hipLoft({ cx: x, cz: z, y: y - 0.02 + h * capF + 0.03, hw: hw * 0.2, hd: hd * 0.2, h: h * 0.3, steps: 1 }), P.accent, 0);
  } else {
    k.b(hipLoft({ cx: x, cz: z, y: y - 0.02 + h * capF, hw: hw * (1 - capF), hd: hd * (1 - capF), h: h * (1 - capF), steps: 1 }), P.accent, 0);
  }
  if (team) {
    for (const sz of [-1, 1]) k.t(box(2 * hw + 0.02, 0.06, 0.04, x, y - 0.03, z + sz * hd), 1);
    for (const sx of [-1, 1]) k.t(box(0.04, 0.06, 2 * hd, x + sx * hw, y - 0.03, z), 1);
  }
  return y + h + (grade === 'small' ? 0.07 : 0);
}

export function roofPagoda(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  const tiers = o.tiers ?? (grade === 'grand' ? 3 : grade === 'mid' ? 2 : 1);
  let cw = w;
  let cd = d;
  let yy = y;
  const rh = h / (1 + (tiers - 1) * 0.75);
  for (let t = 0; t < tiers; t++) {
    const last = t === tiers - 1;
    const over = Math.min(0.2, 0.08 + 0.08 * cw) + 0.04 * (t === 0);
    const hw = cw / 2 + over;
    const hd = cd / 2 + over;
    const th = rh * (t === 0 ? 1 : 0.82);
    const ridge = last ? Math.max(0, (cw - cd) / 2) + cw * 0.06 : 0;
    k.b(hipLoft({
      cx: x, cz: z, y: yy - 0.04, hw, hd, tw: last ? ridge : cw * 0.3, td: last ? 0.001 : cd * 0.3, h: th, steps: 3, pi: 1, py: 1.7, lift: 0.1, per: 3, cap: !last,
    }), P.roof, 0.025);
    // eave fascia in trim
    if (!o.simple) for (const sz of [-1, 1]) k.b(box(2 * hw * 0.8, 0.035, 0.035, x, yy - 0.06, z + sz * hd * 0.99), P.roofD, 0);
    if (last) {
      const cap = box(ridge * 2 + 0.12, 0.05, 0.08, x, yy - 0.04 + th - 0.01, z);
      if (team) k.t(cap, 1);
      else k.b(cap, P.roofD, 0);
      const top = yy - 0.04 + th + 0.03;
      if (grade !== 'small') {
        k.b(cyl(0.025, 0.025, 0.5 * (grade === 'grand' ? 1.2 : 0.8), 4, x, top, z, true), P.accentD, 0);
        for (let i = 0; i < 3; i++) k.b(cyl(0.06 - i * 0.01, 0.06 - i * 0.01, 0.03, 5, x, top + 0.1 + i * 0.1, z), P.accent, 0);
        k.b(octa(0.05, x, top + 0.5 * (grade === 'grand' ? 1.2 : 0.8), z), P.accent, 0);
        return top + 0.65;
      }
      if (!o.simple) {
        k.b(box(0.05, 0.1, 0.05, x - ridge, top - 0.02, z), P.roofD, 0);
        k.b(box(0.05, 0.1, 0.05, x + ridge, top - 0.02, z), P.roofD, 0);
      }
      return top + 0.06;
    }
    // next tier wall band
    const band = 0.22 + 0.04 * (tiers - t);
    cw *= 0.74;
    cd *= 0.74;
    const by = yy - 0.04 + th * 0.45;
    k.b(box(cw, band, cd, x, by, z), P.wall, 0.03);
    k.b(box(cw * 0.6, band * 0.5, 0.02, x, by + band * 0.25, z + cd / 2), P.infill, 0);
    k.b(box(cw + 0.06, 0.04, cd + 0.06, x, by + band - 0.02, z), P.beam, 0);
    yy = by + band;
  }
  return yy;
}

export function roofCurved(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  let yy = y;
  if (grade !== 'small') {
    // lower skirt roof (double eave) around the walls
    const sh = Math.min(0.32, h * 0.45);
    const so = Math.min(0.22, 0.08 + 0.07 * w);
    k.b(hipLoft({ cx: x, cz: z, y: y - 0.04, hw: w / 2 + so, hd: d / 2 + so, tw: w / 2 * 0.86, td: d / 2 * 0.8, h: sh * 0.55, steps: 2, py: 1.6, lift: 0.1, per: 3 }), P.roof, 0.025);
    const by = y - 0.04 + sh * 0.5;
    k.b(box(w * 0.84, sh * 0.75, d * 0.78, x, by, z), P.wall, 0.03);
    k.b(box(w * 0.84 + 0.05, 0.05, d * 0.78 + 0.05, x, by + sh * 0.75 - 0.05, z), P.beam, 0.02);
    yy = by + sh * 0.75;
  }
  const cw = grade === 'small' ? w : w * 0.84;
  const cd = grade === 'small' ? d : d * 0.78;
  const ridge = Math.max(0.06, (cw - cd) / 2 + cw * 0.12);
  const ov = Math.min(0.2, 0.07 + 0.07 * cw);
  const hw = cw / 2 + ov;
  const hd = cd / 2 + ov;
  const rh = grade === 'small' ? h : h * 0.8;
  k.b(hipLoft({ cx: x, cz: z, y: yy - 0.04, hw, hd, tw: ridge, td: 0.001, h: rh, steps: o.simple ? 3 : 4, pi: 1, py: 1.9, lift: 0.15, per: o.simple ? 2 : 3 }), P.roof, 0.025);
  const top = yy - 0.04 + rh;
  const cap = box(ridge * 2 + 0.08, 0.07, 0.09, x, top - 0.03, z);
  if (team) k.t(cap, 1);
  else k.b(cap, P.roofD, 0);
  // ridge-end ornaments (chiwen) and hip-corner tips
  for (const sx of [-1, 1]) {
    k.b(strut([x + sx * ridge, top, z], [x + sx * (ridge + 0.06), top + 0.16, z], 0.06, 0.05), P.accent, 0.03);
    k.b(box(0.05, 0.05, 0.05, x + sx * (ridge + 0.02), top + 0.18, z), P.accent, 0);
  }
  if (!o.simple) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      k.b(cone(0.035, 0.12, 4, x + sx * hw, yy - 0.04 + 0.15, z + sz * hd, true), P.accent, 0);
    }
  }
  return top + 0.16;
}

export function roofShikhara(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  const hw = w / 2 + 0.03;
  const hd = d / 2 + 0.03;
  const bands = o.simple ? 3 : grade === 'small' ? 4 : 7;
  const topK = 0.2;
  let prev = null;
  for (let i = 0; i <= bands; i++) {
    const u = i / bands;
    const f = Math.pow(u, 2.1) * (1 - topK);
    const ring = rectRing(hw * (1 - f), hd * (1 - f), y + h * u, x, z, o.simple ? 1 : 2, 0);
    if (prev) k.b(loft([prev, ring], i === bands), i % 2 ? P.roof : P.roofD, 0.03);
    prev = ring;
  }
  const top = y + h;
  const ar = Math.min(hw, hd) * topK * 1.25;
  k.b(cyl(ar, ar, 0.07, 8, x, top, z), P.roofL, 0.08);
  if (!o.simple) k.b(cyl(ar * 0.5, ar * 0.6, 0.04, 6, x, top + 0.07, z), P.roofD, 0);
  k.b(ball(ar * 0.42, x, top + 0.15, z, o.simple ? 5 : 6, o.simple ? 3 : 4, 1.2), P.accent, 0);
  if (!o.simple) k.b(cone(ar * 0.18, 0.12, 4, x, top + 0.2, z, true), P.accent, 0);
  if (grade !== 'small' && !o.simple) {
    // miniature spires clustered on the shoulders
    for (const sx of [-1, 1]) {
      const mw = hw * 0.42;
      let pr = null;
      for (let i = 0; i <= 3; i++) {
        const u = i / 3;
        const f = Math.pow(u, 2) * 0.8;
        const ring = rectRing(mw * (1 - f), mw * (1 - f), y + h * 0.42 * u, x + sx * hw * 0.62, z + hd * 0.25, 1, 0);
        if (pr) k.b(loft([pr, ring], i === 3), i % 2 ? P.roof : P.roofD, 0.03);
        pr = ring;
      }
      k.b(ball(0.04, x + sx * hw * 0.62, y + h * 0.42 + 0.03, z + hd * 0.25, 5, 3), P.accent, 0);
    }
  }
  if (team) {
    k.b(cyl(0.012, 0.012, 0.45, 3, x, top + 0.2, z, true), P.woodD, 0);
    const g = prep(new THREE.BoxGeometry(0.28, 0.15, 0.012, 3, 1, 1));
    g.translate(x + 0.15, top + 0.56, z);
    k.t(g, 1, (vx) => [clamp01((vx - x) / 0.28), 0]);
    k.t(box(2 * hw + 0.03, 0.05, 2 * hd + 0.03, x, y - 0.01, z), 1);
  }
  return top + 0.65;
}

export function roofStepped(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, grade = 'small', team = true } = o;
  k.b(box(w + 0.06, 0.08, d + 0.06, x, y, z), P.roof, 0.03);
  let top = y + 0.08;
  const merlon = (mx, mz, s = 1) => {
    k.b(box(0.13 * s, 0.08 * s, 0.07, mx, top, mz), P.roof, 0.03);
    k.b(box(0.07 * s, 0.07 * s, 0.07, mx, top + 0.08 * s, mz), P.roof, 0.03);
  };
  const nf = Math.max(2, Math.round(w / 0.34));
  for (let i = 0; i < nf; i++) merlon(x - w / 2 + (w * (i + 0.5)) / nf, z + d / 2, 1);
  const ns = Math.max(1, Math.round(d / 0.45));
  for (const sx of [-1, 1]) for (let i = 0; i < ns; i++) merlon(x + sx * (w / 2), z - d / 2 + (d * (i + 0.5)) / ns, 0.9);
  if (grade !== 'small') {
    const bw = w * 0.5;
    const bd = d * 0.5;
    k.b(frustum(bw, 0.32, bd, 0.92, x, top, z - d * 0.08), P.wall, 0.04);
    k.b(box(bw * 0.92 + 0.05, 0.06, bd * 0.92 + 0.05, x, top + 0.3, z - d * 0.08), P.trim, 0.02);
    door(k, P, st, x, top, z - d * 0.08 + bd * 0.46, 0.16, 0.2, !o.simple);
    top += 0.36;
  }
  if (team) {
    for (const sx of [-1, 1]) flag(k, P, x + sx * (w / 2 - 0.05), y + 0.08, z + d / 2 - 0.05, 0.55, 0.26, 0.16);
    k.t(box(w + 0.07, 0.035, d + 0.07, x, y + 0.02, z), 1);
  }
  return top + 0.15;
}

export function roofFlatDome(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, grade = 'small', team = true } = o;
  k.b(box(w + 0.04, 0.06, d + 0.04, x, y, z), P.wallD, 0.03);
  k.b(frustum(w + 0.02, 0.1, d + 0.02, 0.97, x, y + 0.06, z), P.wallL, 0.03);
  const r = Math.min(w, d) * (grade === 'small' ? 0.32 : 0.36);
  k.b(cyl(r + 0.03, r + 0.04, 0.12, 8, x, y + 0.06, z), P.wall, 0.03);
  if (team) k.t(cyl(r + 0.045, r + 0.045, 0.05, 8, x, y + 0.14, z, true), 1);
  k.b(dome(r, Math.max(r * 0.9, h * 0.8), x, y + 0.18, z, 8, 3), P.roof, 0.05);
  const top = y + 0.18 + Math.max(r * 0.9, h * 0.8);
  k.b(cone(0.04, 0.16, 5, x, top - 0.02, z), P.wall, 0);
  k.b(ball(0.035, x, top + 0.16, z, 5, 3, 1.3), P.white, 0);
  if (grade !== 'small') {
    for (const sx of [-1, 1]) {
      const rr = r * 0.45;
      const px = x + sx * (w / 2 - rr - 0.05);
      k.b(dome(rr, rr, px, y + 0.16, z + d * 0.18, 6, 2), P.roof, 0.05);
      k.b(ball(0.03, px, y + 0.16 + rr + 0.02, z + d * 0.18, 4, 3, 1.3), P.white, 0);
    }
  }
  if (st.ornament === 'spikes') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pinnacle(k, P, x + sx * (w / 2 - 0.06), y + 0.06, z + sz * (d / 2 - 0.06), 0.32, 0.12);
  }
  return top + 0.2;
}

export function roofThatchHip(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, h, team = true } = o;
  const alongX = w >= d;
  const ridge = Math.max(0.04, (Math.abs(w - d) / 2) * 0.9);
  k.b(hipLoft({
    cx: x, cz: z, y: y - 0.06, hw: w / 2 + 0.14, hd: d / 2 + 0.14, tw: alongX ? ridge : 0.001, td: alongX ? 0.001 : ridge, h, steps: 3, pi: 1, py: 0.85, per: 2,
  }), P.roof, 0.14);
  const cap = box(alongX ? ridge * 2 + 0.1 : 0.1, 0.07, alongX ? 0.1 : ridge * 2 + 0.1, x, y - 0.06 + h - 0.03, z);
  if (team) k.t(cap, 1);
  else k.b(cap, P.roofD, 0);
  return y - 0.06 + h + 0.05;
}

export function roofFlat(k, P, st, o) {
  const { x = 0, z = 0, w, d, y, grade = 'small', team = true } = o;
  k.b(box(w + 0.06, 0.06, d + 0.06, x, y, z), P.roofD, 0.03);
  for (const sz of [-1, 1]) k.b(box(w + 0.06, 0.1, 0.06, x, y + 0.06, z + sz * (d / 2)), P.wallL, 0.03);
  for (const sx of [-1, 1]) k.b(box(0.06, 0.1, d, x + sx * (w / 2), y + 0.06, z), P.wallL, 0.03);
  let top = y + 0.16;
  if (grade !== 'small') {
    k.b(box(w * 0.4, 0.3, d * 0.4, x, y + 0.06, z - d * 0.1), P.wall, 0.03);
    k.b(box(w * 0.4 + 0.06, 0.05, d * 0.4 + 0.06, x, y + 0.36, z - d * 0.1), P.trim, 0);
    top = y + 0.41;
  }
  if (team) {
    k.t(box(w * 0.5, 0.02, d * 0.35, x, y + 0.06, z + d * 0.2), 1);
    flag(k, P, x + w / 2 - 0.08, y + 0.06, z - d / 2 + 0.08, 0.5, 0.26, 0.16);
  }
  return top;
}

export const RECT_ROOFS = {
  gable: roofGable, longhouse: roofLonghouse, pyramid: roofPyramid, pagoda: roofPagoda, curved: roofCurved,
  shikhara: roofShikhara, stepped: roofStepped, dome: roofFlatDome, thatch_cone: roofThatchHip, flat: roofFlat,
};

export function rectRoof(k, P, st, o) {
  return (RECT_ROOFS[st.roof] || roofFlat)(k, P, st, o);
}

/** Roof for a round building. */
export function roundRoof(k, P, st, o) {
  const { x = 0, z = 0, r, y, h, team = true } = o;
  if (st.roof === 'dome') {
    const rr = r * (st.wall === 'mudbrick' ? 0.92 : 1) + 0.02;
    if (team) k.t(cyl(rr + 0.035, rr + 0.035, 0.06, 10, x, y - 0.02, z, true, true), 1);
    k.b(dome(rr, h, x, y, z, 10, 3), P.roof, 0.05);
    k.b(cone(0.045, 0.18, 5, x, y + h - 0.03, z), P.wall, 0);
    k.b(ball(0.04, x, y + h + 0.17, z, 5, 3, 1.3), P.white, 0);
    return y + h + 0.22;
  }
  const R = r + 0.14;
  k.b(cone(R, h, 10, x, y - 0.05, z, true, true), st.roof === 'thatch_cone' ? P.roof : P.roof, st.roof === 'thatch_cone' ? 0.13 : 0.05);
  const ty = y - 0.05;
  k.b(cyl(R * 0.12, R * 0.2, h * 0.14, 6, x, ty + h * 0.8, z, true), P.roofD, 0.05);
  k.b(cone(R * 0.1, h * 0.12, 6, x, ty + h * 0.93, z), P.roofD, 0);
  if (team) {
    const f = 0.42;
    const rb = R * (1 - f) + 0.012;
    const rt = R * (1 - f - 0.09) + 0.012;
    k.t(cyl(rt, rb, h * 0.09, 10, x, ty + h * f, z, true, true), 1);
  }
  return ty + h * 1.05;
}
