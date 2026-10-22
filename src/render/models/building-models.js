// Procedural building models (DESIGN.md 4.7 and 8): the buildings themselves and the public API.
//
//   const m = buildBuildingModel('temple', pantheon, '#d63a3a', 1);
//   scene.add(m.root);   // origin = footprint center at ground level, +X east, +Z south
//   m.setProgress(bp);   // 0..1 construction: foundation + scaffolding, walls rising; 1 = complete
//   m.setTier(2);        // town centers: 1 Village, 2 Town, 3 City
//   m.setConnections(m); // wall segments: which neighbours the wall runs on to (data/walls.js wallConnections)
//   m.animate(timeSec);  // flames, waving flags, the titan gate vortex
//   m.refresh();         // after setBuildingDetail(level): rebuild at the new detail level
//   m.height             // top of the model (health bar placement)
//   m.dispose();         // detaches; cached geometry and shared materials stay
//
// Every building is merged into at most four vertex-colored buffers (stone
// foundation, body, team-colored parts, glowing parts), plus a scaffold while
// under construction and the titan gate's vortex: ≤ 6 meshes. Geometry is cached
// per (building, pantheon style + colors, tier). Team-colored parts store a gray
// shade that a shared per-team-color material multiplies.
//
// Materials are physically based: every part also carries what it is made of
// (`aSurf`: roughness, metalness, a surface class and how high the vertex sits
// above the part's own foot). Without UVs, the fragment shader draws stylized
// detail from the object-space position and normal per surface class (stone
// courses, bricks, planks, roof-tile rows, thatch), plus grime and ambient
// occlusion near the ground and where a part stands on another. Glowing parts
// (fires, lanterns, runes) store HDR colors so they bloom; doorways and windows
// are body parts that show only a faint warm light from inside.
//
// Styles (pantheon.style): roof drives the silhouette, wall the materials and
// ornament the signature details. All values of DESIGN 4.7 are supported.
import * as THREE from 'three';
import { RNG, hashSeed } from '../../sim/rng.js';
import { BUILDINGS, GOLD_MINE } from '../../data/buildings.js';
import {
  PLINTH, DEPTH, MARGIN, PI, BUCKETS, DEFAULT_STYLE,
  DEFAULT_COLORS, C, mix, shade, tint, SURF,
  made, prep, box, bevelBox, courseLoft, courseCone, frustum, cyl, cone,
  ball, dome, octa, dodeca, torus, strut,
  pole, extrude, fromTris, soft, solid, hipLoft,
  GLOW, Kit, finishKit,
} from './building-core.js';
import {
  TIME, bodyMaterial, baseMaterial, glowMaterial, mineGoldMaterial, teamMaterial,
  clipMaterial, vortexMaterial,
} from './building-materials.js';
import {
  makePalette, flag, standard, banner, shield, crate,
  barrel, sack, logPile, goldPile, brazier, firePit,
  idol, steps, stair, column, obelisk, carvedPost,
  torii, stoneLantern, hangingLantern, serpentHead, standingStone, lamassu,
  pinnacle, ornament, ornamentPair, isRound, door, frieze,
  rectWalls, roundWalls, roofH, roofOver, roofGable, roofLonghouse,
  roofPyramid, roofPagoda, roofCurved, roofShikhara, roofStepped, roofFlatDome,
  roofFlat, rectRoof, roundRoof, bx, bfr, domeCuts, postLamp,
} from './building-pieces.js';

// the toolkit's public names stay importable from here
export {
  PLINTH, DEFAULT_STYLE, DEFAULT_COLORS, box, frustum, cyl, cone, ball, dome, octa, ico, dodeca, torus,
  strut, pole, extrude, fromTris, soft, solid, rectRing, circleRing, loft,
} from './building-core.js';

// ---------------------------------------------------------------------------
// halls, towers, walls
// ---------------------------------------------------------------------------

/**
 * A building block in the pantheon's style: walls (rect or round) and roof.
 * o: { x, z, w, d, y, h (wall height), rh (roof height), grade: small|mid|grand,
 *      round, porch, door, doorW, doorH, windows, team, ridge }
 * Returns the top height.
 */
function hall(k, P, st, o) {
  const { x = 0, z = 0, y = PLINTH, h, grade = 'small', team = true } = o;
  let { w, d } = o;
  const round = o.round ?? isRound(st);
  if (o.lim) {
    const ov = round ? (st.roof === 'dome' ? 0.06 : 0.16) : roofOver(st, w);
    w = Math.min(w, 2 * (o.lim - Math.abs(x) - ov));
    d = Math.min(d, 2 * (o.lim - Math.abs(z) - ov));
  }
  if (round) {
    const r = Math.min(w, d) / 2 - 0.08;
    roundWalls(k, P, st, { x, z, r, y, h, door: o.door, doorW: o.doorW, doorH: o.doorH });
    return roundRoof(k, P, st, { x, z, r, y: y + h, h: o.rh ?? roofH(st, 2 * r, grade), grade, team });
  }
  let porch = 0;
  if (st.ornament === 'columns' && o.porch !== false) porch = Math.max(0.24, Math.min(0.42, d * 0.26));
  const wd = d - porch;
  const wz = z - porch / 2;
  rectWalls(k, P, st, { x, z: wz, w, d: wd, y, h, door: o.door, doorW: o.doorW, doorH: o.doorH, windows: o.windows, simple: o.simple });
  if (porch) {
    const n = w > 1.7 ? 4 : 2;
    const cz = z + d / 2 - 0.07;
    k.b(box(w, 0.04, porch, x, y, z + d / 2 - porch / 2), P.stoneL, 0.02);
    for (let i = 0; i < n; i++) {
      const cx = n === 2 ? x + (i ? 1 : -1) * w * 0.32 : x - w / 2 + 0.09 + (i * (w - 0.18)) / (n - 1);
      column(k, P, cx, y, cz, h, Math.min(0.075, w * 0.03));
    }
    k.b(box(w + 0.06, 0.1, porch + 0.02, x, y + h - 0.1, z + d / 2 - porch / 2), P.wallL, 0.02);
  }
  if (st.roof === 'longhouse' && team) {
    const n = Math.max(2, Math.floor(w / 0.45));
    for (let i = 0; i < n; i++) {
      const sx = x - w / 2 + (w * (i + 0.5)) / n;
      if (Math.abs(sx - x) < 0.25) continue;
      shield(k, P, sx, y + h * 0.62, wz + wd / 2, 0.1);
    }
  }
  const ridge = o.ridge ?? (st.roof === 'gable' && porch ? 'z' : undefined);
  const span = ridge === 'z' ? w : Math.min(w, d);
  const rh = o.rh ?? roofH(st, span, grade);
  return rectRoof(k, P, st, { x, z, w, d, y: y + h, h: rh, grade, team, ridge, simple: o.simple });
}

/** Watch tower body: shaft, lookout platform and a small roof (or battlements). Returns top height. */
function towerStruct(k, P, st, o) {
  const { x = 0, z = 0, s, h, y = PLINTH, team = true } = o;
  const round = isRound(st);
  const ty = y + h;
  if (st.wall === 'timber') {
    const b = s / 2;
    const t = s * 0.4;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      k.b(strut([x + sx * b, y, z + sz * b], [x + sx * t, ty, z + sz * t], 0.08), P.wood, 0.05);
    }
    for (let lv = o.simple ? 1 : 0; lv < 2; lv++) {
      const y0 = y + h * (0.08 + lv * 0.45);
      const y1 = y + h * (0.48 + lv * 0.45);
      const b0 = b - (b - t) * (0.08 + lv * 0.45);
      const b1 = b - (b - t) * (0.48 + lv * 0.45);
      for (const sz of [-1, 1]) k.b(strut([x - b0, y0, z + sz * b0], [x + b1, y1, z + sz * b1], 0.04), P.woodD, 0.03);
      if (!o.simple) for (const sx of [-1, 1]) k.b(strut([x + sx * b0, y0, z - b0], [x + sx * b1, y1, z + b1], 0.04), P.woodD, 0.03);
    }
  } else if (round) {
    const taper = st.wall === 'mudbrick' ? 0.78 : 0.86;
    k.b(cyl(s / 2 + 0.06, s / 2 + 0.08, 0.12, 10, x, y, z, true, true), P.stoneD, 0.08);
    k.b(cyl((s / 2) * taper, s / 2, h, 10, x, y, z, true, true), P.wall, st.wall === 'stone' ? 0.1 : 0.05);
    if (st.ornament === 'spikes' && !o.simple) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2;
        const rr = (s / 2) * (1 - (1 - taper) * 0.55);
        k.b(pole([x + Math.sin(a) * rr, y + h * 0.55, z + Math.cos(a) * rr], [x + Math.sin(a) * (rr + 0.14), y + h * 0.55, z + Math.cos(a) * (rr + 0.14)], 0.016, 3), P.woodD, 0);
      }
    }
  } else {
    const taper = { sandstone: 0.8, mudbrick: 0.78, stone: 0.92, marble: 0.95, brick: 0.92, lacquer: 0.9 }[st.wall] ?? 0.92;
    k.b(o.simple ? box(s + 0.08, 0.12, s + 0.08, x, y, z) : bx(k, 0.03, s + 0.08, 0.12, s + 0.08, x, y, z), P.stoneD, 0.06);
    k.b(o.simple ? frustum(s, h, s, taper, x, y, z) : bfr(k, 0.04, s, h, s, taper, x, y, z), st.wall === 'lacquer' ? P.infill : P.wall, st.wall === 'stone' ? 0.08 : 0.04);
    if (st.wall === 'lacquer') {
      for (const sx of [-1, 1]) k.b(frustum(0.08, h, 0.08, 0.9, x + sx * (s / 2 - 0.02) * (1 + taper) / 2, y, z + (s / 2) * (1 + taper) / 2 - 0.02), P.wall, 0.03);
      k.b(box(s * taper + 0.04, 0.08, s * taper + 0.04, x, y + h * 0.5, z), P.wall, 0.02);
    }
    if (st.wall === 'sandstone' || st.wall === 'marble' || st.wall === 'brick') {
      k.b(box(s * taper + 0.07, 0.07, s * taper + 0.07, x, y + h - 0.07, z), P.trim, 0.02);
    }
    if (st.ornament === 'spikes' && !o.simple) {
      for (let i = 0; i < 3; i++) {
        const yy = y + h * (0.3 + i * 0.25);
        const ww = (s / 2) * (1 - (1 - taper) * (0.3 + i * 0.25));
        for (const sx of [-1, 0, 1]) k.b(pole([x + sx * ww * 0.6, yy, z + ww - 0.02], [x + sx * ww * 0.6, yy - 0.01, z + ww + 0.12], 0.016, 3), P.woodD, 0);
      }
    }
    if (st.ornament === 'carvings' && !o.simple) frieze(k, P, x, z + (s / 2) * ((1 + taper) / 2) + 0.01, s * 0.8, y + h * 0.78);
  }
  // arrow slits
  if (st.wall !== 'timber') {
    const fz = round ? z + s / 2 - 0.02 : z + s / 2 - 0.03;
    for (const fy of o.simple ? [0.6] : [0.45, 0.75]) k.hole(box(0.06, 0.16, 0.06, x, y + h * fy, fz), y + h * fy, 0.16);
  }
  // platform
  const pw = s + (st.wall === 'timber' ? 0.18 : 0.22);
  const platColor = st.wall === 'timber' || st.wall === 'lacquer' ? P.woodD : P.stoneD;
  if (round && st.wall !== 'timber') k.b(cyl(pw / 2, pw / 2 - 0.04, 0.1, 10, x, ty, z, false, true), platColor, 0.04);
  else k.b(o.simple ? box(pw, 0.09, pw, x, ty, z) : bx(k, 0.03, pw, 0.09, pw, x, ty, z), platColor, 0.04);
  const py = ty + 0.09;
  const battlements = st.roof === 'flat' || st.roof === 'stepped' || st.wall === 'sandstone' && st.roof !== 'shikhara' || o.battlements;
  // a lamp lit after dusk on the lookout (between two merlons, or by a post of the roofed one); the City's corner towers leave it out
  if (!o.simple) postLamp(k, P, battlements ? x + pw * 0.25 : x - (pw / 2 - 0.05) + 0.09, py, z + pw / 2 - (battlements ? 0.045 : 0.1), 1.3);
  let top;
  if (battlements) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const off = -pw / 2 + 0.06 + (i * (pw - 0.12)) / (n - 1);
      k.b(box(0.11, 0.16, 0.07, x + off, py, z + pw / 2 - 0.035), P.wall, 0.03);
      k.b(box(0.11, 0.16, 0.07, x + off, py, z - pw / 2 + 0.035), P.wall, 0.03);
      if (i === 1) {
        k.b(box(0.07, 0.16, 0.11, x - pw / 2 + 0.035, py, z), P.wall, 0.03);
        k.b(box(0.07, 0.16, 0.11, x + pw / 2 - 0.035, py, z), P.wall, 0.03);
      }
    }
    if (st.roof === 'stepped') k.t(box(pw + 0.01, 0.04, pw + 0.01, x, py - 0.05, z), 1);
    top = py + 0.16;
    if (team) flag(k, P, x, py, z, 0.65, 0.34, 0.2);
    top = py + 0.67;
  } else {
    const ph = 0.38;
    const pi = pw / 2 - 0.05;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(box(0.05, ph, 0.05, x + sx * pi, py, z + sz * pi), P.woodD, 0.03);
    if (!o.simple) k.b(box(pw - 0.04, 0.05, 0.03, x, py + 0.13, z + pi), P.woodD, 0);
    if (round) {
      top = roundRoof(k, P, st, { x, z, r: pw / 2 - (st.roof === 'dome' ? 0.06 : 0.15), y: py + ph, h: roofH(st, pw, 'small') * 0.95, team });
    } else {
      const rw = pw - 2 * roofOver(st, pw) + 0.02;
      top = rectRoof(k, P, st, { x, z, w: rw, d: rw, y: py + ph, h: roofH(st, rw, 'small'), grade: 'small', team, tiers: 1, simple: o.simple });
    }
    if (team && !['shikhara', 'stepped', 'flat'].includes(st.roof)) {
      flag(k, P, x + (st.roof === 'pyramid' ? 0 : 0), top - 0.03, z, 0.42, 0.28, 0.17);
      top += 0.42;
    }
  }
  return top;
}

/** Perimeter wall along the footprint edge with a gate gap on the south side. */
function perimeter(k, P, st, o) {
  const { half, h, gate, y = PLINTH, merlons = false, team = true } = o;
  const t = 0.16;
  const segs = [
    [-half, -half + t / 2, half, -half + t / 2],
    [-half + t / 2, -half, -half + t / 2, half],
    [half - t / 2, -half, half - t / 2, half],
    [-half, half - t / 2, -gate / 2, half - t / 2],
    [gate / 2, half - t / 2, half, half - t / 2],
  ];
  for (const [x0, z0, x1, z1] of segs) {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = alongX ? len : t;
    const d = alongX ? t : len;
    if (st.wall === 'timber') {
      k.b(box(w, h, d, cx, y, cz), P.wood, 0.1);
      const n = Math.max(2, Math.round(len / 0.2));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n - 0.5;
        k.b(cone(t * 0.45, 0.14, 3, cx + (alongX ? f * len : 0), y + h, cz + (alongX ? 0 : f * len), true), P.wood, 0.1);
      }
      continue;
    }
    if (st.wall === 'lacquer') {
      k.b(box(w, h, d, cx, y, cz), P.infill, 0.03);
      k.b(box(w + (alongX ? 0 : 0.04), 0.06, d + (alongX ? 0.04 : 0), cx, y, cz), P.stone, 0.03);
      const cap = alongX ? box(w + 0.04, 0.07, t + 0.1, cx, y + h, cz) : box(t + 0.1, 0.07, d + 0.04, cx, y + h, cz);
      k.b(cap, P.roof, 0.03);
      k.b(alongX ? box(w + 0.04, 0.05, 0.05, cx, y + h + 0.05, cz) : box(0.05, 0.05, d + 0.04, cx, y + h + 0.05, cz), P.roofD, 0);
      continue;
    }
    const color = st.wall === 'mudbrick' || st.wall === 'brick' || st.wall === 'sandstone' ? P.wall : st.wall === 'marble' ? P.wallL : P.stone;
    if (st.wall === 'mudbrick') k.b(frustum(w + 0.04, h, d + 0.04, alongX ? 1 : 0.7, cx, y, cz, alongX ? 0.7 : 1), color, 0.05);
    else k.b(box(w, h, d, cx, y, cz), color, st.wall === 'stone' ? 0.08 : 0.04);
    if (merlons) {
      const n = Math.max(1, Math.round(len / 0.44));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n - 0.5;
        const mx = cx + (alongX ? f * len : 0);
        const mz = cz + (alongX ? 0 : f * len);
        if (st.wall === 'mudbrick') k.b(cone(0.06, 0.13, 4, mx, y + h - 0.01, mz, true), color, 0.04);
        else k.b(box(alongX ? 0.13 : t, 0.11, alongX ? t : 0.13, mx, y + h, mz), color, 0.04);
      }
    } else if (st.wall !== 'mudbrick') {
      k.b(box(w + 0.02, 0.04, d + 0.02, cx, y + h, cz), st.wall === 'marble' ? P.trim : shade(color, 0.85), 0.02);
    }
  }
  // gate posts
  for (const sx of [-1, 1]) {
    const gx = (sx * gate) / 2 + sx * 0.09;
    if (st.wall === 'timber') k.b(box(0.16, h + 0.32, 0.2, gx, y, half - t / 2), P.woodD, 0.04);
    else k.b(box(0.2, h + 0.2, 0.22, gx, y, half - t / 2), st.wall === 'lacquer' ? P.wall : shade(P.stone, 0.95), 0.04);
    if (team) k.t(box(0.13, 0.26, 0.02, gx, y + h - 0.2, half - t / 2 + 0.12), 1);
  }
}

// ---------------------------------------------------------------------------
// buildings
// ---------------------------------------------------------------------------

function buildHouse(k, P, st) {
  const round = isRound(st);
  const y = PLINTH;
  if (round) {
    hall(k, P, st, { x: -0.04, z: -0.06, w: 1.38, d: 1.38, h: st.roof === 'dome' ? 0.62 : 0.55, rh: st.roof === 'dome' ? 0.5 : 0.8, lim: 0.9 });
  } else if (st.roof === 'longhouse') {
    hall(k, P, st, { x: 0, z: -0.12, w: 1.56, d: 0.92, h: 0.6, rh: 0.55, windows: 0, lim: 0.9 });
  } else {
    hall(k, P, st, { x: 0, z: -0.1, w: 1.3, d: 1.05, h: 0.68, windows: 1, porch: st.ornament === 'columns', lim: 0.9 });
  }
  logPile(k, P, 0.62, y, 0.68, 0.34, PI / 2);
  barrel(k, P, -0.7, y, 0.66, 0.24);
  if (st.roof === 'stepped' || st.roof === 'flat' || st.roof === 'pyramid') crate(k, P, -0.48, y, 0.7, 0.16, 0.3);
  if (!['stepped', 'flat', 'shikhara'].includes(st.roof)) flag(k, P, 0.72, y, -0.7, 1.35, 0.28, 0.17);
  else flag(k, P, 0.72, y, -0.7, 1.1, 0.28, 0.17);
}

function buildStorehouse(k, P, st) {
  const y = PLINTH;
  if (isRound(st)) {
    // granaries on stones (dome) or stilts (thatch), with conical straw hats
    const pts = [[-0.45, -0.38, 0.33], [0.4, -0.45, 0.28], [0.05, 0.12, 0.3]];
    for (const [gx, gz, r] of pts) {
      const lift = st.roof === 'thatch_cone' ? 0.16 : 0.08;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * PI * 2 + PI / 4;
        k.b(box(0.06, lift, 0.06, gx + Math.cos(a) * r * 0.6, y, gz + Math.sin(a) * r * 0.6), st.roof === 'thatch_cone' ? P.woodD : P.stoneD, 0.05);
      }
      k.b(cyl(r * 0.92, r, 0.5, 8, gx, y + lift, gz, false, true), P.wall, 0.06);
      k.hole(box(0.13, 0.15, 0.04, gx, y + lift + 0.18, gz + r * 0.95), y + lift + 0.18, 0.15);
      k.b(cone(r + 0.1, 0.42, 8, gx, y + lift + 0.47, gz, true, true), st.roof === 'dome' ? P.straw : P.roof, 0.14);
      k.t(cyl(r * 0.5, r * 0.62, 0.05, 8, gx, y + lift + 0.6, gz, true, true), 1);
    }
    logPile(k, P, -0.45, y, 0.55, 0.42, PI / 2);
    sack(k, P, 0.55, y, 0.45, 0.24);
    sack(k, P, 0.7, y, 0.3, 0.2);
    goldPile(k, P, 0.55, y, 0.7, 0.28);
    flag(k, P, 0.75, y, -0.75, 1.2, 0.28, 0.17);
    return;
  }
  // open shed: back wall, posts and a roof over the goods
  const ov = roofOver(st, 1.5);
  const sw = Math.min(1.5, 2 * (0.9 - ov));
  const sz = -0.16;
  const sd = Math.min(1.05, 2 * (0.9 + sz - ov));
  const wh = 0.68;
  k.b(box(sw, 0.05, sd, 0, y, sz), P.wood, 0.05);
  rectWallsBack(k, P, st, sw, sd, sz, y, wh);
  for (const sx of [-1, 1]) k.b(box(0.08, wh, 0.08, (sx * sw) / 2 - sx * 0.04, y, sz + sd / 2 - 0.05), st.wall === 'lacquer' ? P.wall : P.woodD, 0.03);
  rectRoof(k, P, st, { x: 0, z: sz, w: sw, d: sd, y: y + wh, h: roofH(st, sd, 'small') * 0.9, grade: 'small', team: true });
  crate(k, P, -0.45, y + 0.05, sz - 0.15, 0.22, 0.2);
  crate(k, P, -0.42, y + 0.27, sz - 0.18, 0.18, -0.3);
  crate(k, P, -0.15, y + 0.05, sz - 0.25, 0.2, 0.5);
  barrel(k, P, 0.25, y + 0.05, sz - 0.25, 0.28);
  barrel(k, P, 0.48, y + 0.05, sz - 0.2, 0.26);
  sack(k, P, 0.4, y + 0.05, sz + 0.2, 0.22);
  sack(k, P, 0.1, y + 0.05, sz + 0.15, 0.2);
  logPile(k, P, -0.45, y, 0.62, 0.44, 0);
  goldPile(k, P, 0.45, y, 0.62, 0.32);
  flag(k, P, 0.78, y, -0.78, 1.25, 0.28, 0.17);
}

// Closed back and side walls of the storehouse shed (south side open).
function rectWallsBack(k, P, st, w, d, z, y, h) {
  const c = st.wall === 'lacquer' ? P.infill : P.wall;
  const t = 0.07;
  k.b(box(w, h, t, 0, y, z - d / 2 + t / 2), c, 0.06);
  for (const sx of [-1, 1]) k.b(box(t, h, d * 0.55, (sx * w) / 2 - sx * t / 2, y, z - d * 0.2), c, 0.06);
  if (st.wall === 'timber' || st.wall === 'lacquer') {
    for (const sx of [-1, 1]) k.b(box(0.08, h, 0.08, (sx * w) / 2 - sx * 0.04, y, z - d / 2 + 0.04), st.wall === 'lacquer' ? P.wall : P.woodD, 0.03);
  }
  if (st.ornament === 'spikes') {
    for (let i = 0; i < 4; i++) k.b(pole([-w / 2 + 0.2 + i * 0.37, y + h * 0.6, z - d / 2], [-w / 2 + 0.2 + i * 0.37, y + h * 0.6, z - d / 2 - 0.12], 0.016, 3), P.woodD, 0);
  }
}

function buildBarracks(k, P, st) {
  const y = PLINTH;
  const hz = -0.45;
  const hw = 2.5;
  const hd = 1.45;
  const round = isRound(st) && st.roof === 'thatch_cone';
  const wh = 0.95;
  let top;
  if (round) {
    hall(k, P, st, { x: -0.32, z: -0.34, w: 1.95, d: 1.95, h: 0.75, rh: 1.05, doorW: 0.34, lim: 1.4 });
    top = hall(k, P, st, { x: 0.8, z: -0.74, w: 1.0, d: 1.0, h: 0.55, rh: 0.65, lim: 1.4 });
  } else {
    top = hall(k, P, st, { x: 0, z: hz, w: hw, d: hd, h: wh, grade: 'mid', round: false, doorW: 0.42, doorH: 0.6, windows: 2, lim: 1.4 });
    const fz = hz + hd / 2 + (st.ornament === 'columns' ? 0 : 0);
    if (st.ornament !== 'columns') {
      banner(k, P, -0.75, y + wh - 0.08, fz + (st.wall === 'mudbrick' ? -0.02 : 0), 0.24, 0.42);
      banner(k, P, 0.75, y + wh - 0.08, fz + (st.wall === 'mudbrick' ? -0.02 : 0), 0.24, 0.42);
    }
  }
  // training yard
  const yz = 0.85;
  k.b(box(2.5, 0.015, 0.95, 0, y, yz), shade(P.yard, 0.92), 0.05);
  // weapon rack
  const rx = -0.85;
  for (const sx of [-1, 1]) k.b(box(0.05, 0.42, 0.05, rx + sx * 0.25, y, yz - 0.1), P.woodD, 0.03);
  k.b(box(0.6, 0.04, 0.05, rx, y + 0.36, yz - 0.1), P.woodD, 0);
  for (let i = 0; i < 4; i++) {
    const sx = rx - 0.2 + i * 0.13;
    k.b(pole([sx, y, yz - 0.02], [sx + 0.02, y + 0.62, yz - 0.13], 0.012, 3), P.wood, 0);
    k.b(cone(0.025, 0.08, 4, sx + 0.02, y + 0.61, yz - 0.13), P.metal, 0);
  }
  // training dummy
  const dx = 0.15;
  k.b(box(0.05, 0.55, 0.05, dx, y, yz + 0.05), P.woodD, 0.03);
  k.b(box(0.36, 0.04, 0.04, dx, y + 0.42, yz + 0.05), P.woodD, 0);
  k.b(dodeca(0.1, dx, y + 0.6, yz + 0.05), P.sack, 0.08);
  k.b(box(0.16, 0.2, 0.1, dx, y + 0.28, yz + 0.05), P.sack, 0.08);
  // archery target (team-colored bullseye)
  const tx = 0.85;
  k.b(strut([tx - 0.12, y, yz - 0.05], [tx, y + 0.45, yz], 0.035), P.woodD, 0);
  k.b(strut([tx + 0.12, y, yz - 0.05], [tx, y + 0.45, yz], 0.035), P.woodD, 0);
  const tg = cyl(0.2, 0.2, 0.05, 8, 0, 0, 0);
  tg.rotateX(PI / 2 - 0.25);
  tg.translate(tx, y + 0.42, yz + 0.04);
  k.b(tg, P.cloth, 0.03);
  const ring = cyl(0.13, 0.13, 0.05, 8, 0, 0, 0);
  ring.rotateX(PI / 2 - 0.25);
  ring.translate(tx, y + 0.42, yz + 0.05);
  k.t(ring, 1);
  // shield wall beside the target
  for (let i = 0; i < 2; i++) shield(k, P, 1.0 + i * 0.0, y + 0.18 + i * 0.25, yz + 0.38, 0.08);
  // fence posts along the yard sides
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) k.b(box(0.05, 0.28, 0.05, sx * 1.28, y, 0.45 + i * 0.4), P.woodD, 0.03);
    k.b(box(0.03, 0.03, 0.85, sx * 1.28, y + 0.2, 0.85), P.wood, 0);
  }
  flag(k, P, 1.22, y, 1.25, 1.5, 0.38, 0.24);
  return top;
}

function buildShrine(k, P, st) {
  const y = PLINTH;
  const sc = st.wall === 'marble' ? P.stoneL : P.stone;
  const py = steps(k, P, 1.62, 1.62, y, 2, 0.08, 0.1, sc);
  switch (st.ornament) {
    case 'knots': {
      // stone circle around a sacred fire and a carved altar stone
      for (let i = 0; i < 7; i++) {
        const a = PI / 2 + ((i + 1) * PI * 2) / 8;
        const r = 0.6;
        standingStone(k, P, Math.cos(a) * r, py, Math.sin(a) * r, 0.62 + (i % 2) * 0.12, Math.atan2(-Math.cos(a), -Math.sin(a)));
      }
      k.b(box(0.42, 0.2, 0.26, 0, py, -0.18), P.stoneD, 0.08);
      firePit(k, P, 0, py, 0.22, 1.1);
      flag(k, P, 0.72, y, 0.72, 1.2, 0.28, 0.17);
      return;
    }
    case 'torii': {
      // small hokora shrine house on a stone base, with a torii in front
      k.b(bx(k, 0.03, 0.62, 0.22, 0.56, 0, py, -0.3), P.stone, 0.04);
      hall(k, P, st, { x: 0, z: -0.3, w: 0.56, d: 0.5, y: py + 0.22, h: 0.36, rh: 0.26, round: false, doorW: 0.18, doorH: 0.22, team: true });
      torii(k, P, 0, py, 0.48, 0.92, 0.82);
      stoneLantern(k, P, -0.58, py, 0.08, 0.42);
      stoneLantern(k, P, 0.58, py, 0.08, 0.42);
      k.t(box(0.4, 0.05, 0.03, 0, py + 0.66, 0.48 + 0.06), 1);
      standard(k, P, -0.74, y, -0.62, 1.15, 0.13, 0.55);
      standard(k, P, 0.6, y, -0.62, 1.15, 0.13, 0.55);
      return;
    }
    default:
      break;
  }
  // canopy shrine: posts or columns carrying a small roof over a golden idol, sacred flame in front
  const cw = 1.08;
  const cd = 0.86;
  const cz = -0.22;
  const ph = 0.72;
  const round = isRound(st);
  if (round) {
    const r = 0.5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + PI / 6;
      k.b(box(0.07, ph, 0.07, Math.sin(a) * r, py, cz + Math.cos(a) * r), st.wall === 'mudbrick' ? P.wall : P.woodD, 0.03);
    }
    roundRoof(k, P, st, { x: 0, z: cz, r: r + 0.02, y: py + ph, h: st.roof === 'dome' ? 0.42 : 0.62, team: true });
  } else {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = (sx * cw) / 2 - sx * 0.06;
      const pz = cz + (sz * cd) / 2 - sz * 0.06;
      if (st.ornament === 'columns' || st.wall === 'marble') column(k, P, px, py, pz, ph, 0.06);
      else k.b(box(0.08, ph, 0.08, px, py, pz), st.wall === 'lacquer' ? P.wall : st.wall === 'timber' ? P.woodD : P.wallD, 0.03);
    }
    k.b(bx(k, 0.025, cw, 0.07, cd, 0, py + ph - 0.07, cz), st.wall === 'lacquer' ? P.wall : P.wallL, 0.03);
    k.b(box(cw, ph * 0.75, 0.05, 0, py, cz - cd / 2 + 0.04), st.wall === 'lacquer' ? P.infill : P.wallD, 0.04);
    rectRoof(k, P, st, { x: 0, z: cz, w: cw, d: cd, y: py + ph, h: roofH(st, Math.min(cw, cd), 'small'), grade: 'small', team: true, ridge: st.roof === 'gable' ? 'z' : undefined, tiers: 1 });
  }
  idol(k, P, 0, py, cz - 0.08, 0.72);
  brazier(k, P, 0, py, 0.38, 0.75, 0.22);
  if (st.ornament !== 'columns') ornamentPair(k, P, st, 0.6, py, 0.6, 0.5);
  else {
    k.b(box(0.3, 0.12, 0.2, -0.5, py, 0.55), P.stoneL, 0.02);
    k.b(box(0.3, 0.12, 0.2, 0.5, py, 0.55), P.stoneL, 0.02);
    brazier(k, P, -0.5, py + 0.12, 0.55, 0.45, 0.1);
    brazier(k, P, 0.5, py + 0.12, 0.55, 0.45, 0.1);
  }
  flag(k, P, -0.74, y, -0.74, 1.3, 0.28, 0.17);
}

// ---- temples: the pantheon-defining building, one composition per roof style ----

function templeGable(k, P, st) {
  const y = PLINTH;
  const sc = st.wall === 'marble' ? P.stoneL : P.stone;
  const top0 = steps(k, P, 2.72, 2.72, y, 3, 0.08, 0.07, sc);
  const W = 2.3;
  const D = 2.3;
  const ch = 1.12;
  // cella
  rectWalls(k, P, st, { x: 0, z: -0.05, w: 1.3, d: 1.55, y: top0, h: ch, doorW: 0.34, doorH: 0.68 });
  // peristyle
  const cols = [];
  for (let i = 0; i < 6; i++) {
    const cx = -W / 2 + 0.1 + (i * (W - 0.2)) / 5;
    cols.push([cx, D / 2 - 0.1], [cx, -D / 2 + 0.1]);
  }
  for (let i = 1; i < 4; i++) {
    const cz = -D / 2 + 0.1 + (i * (D - 0.2)) / 4;
    cols.push([-W / 2 + 0.1, cz], [W / 2 - 0.1, cz]);
  }
  for (const [cx, cz] of cols) column(k, P, cx, top0, cz, ch, 0.075, st.wall === 'marble' ? P.wallL : P.wall);
  // entablature with frieze
  k.b(bx(k, 0.025, W + 0.06, 0.16, D + 0.06, 0, top0 + ch, 0), st.wall === 'marble' ? P.wallL : P.wall, 0.02);
  k.b(bx(k, 0.018, W + 0.08, 0.06, D + 0.08, 0, top0 + ch + 0.05, 0), P.trim, 0.02);
  for (let i = 0; i < 9; i++) k.b(box(0.06, 0.06, 0.02, -W / 2 + 0.15 + (i * (W - 0.3)) / 8, top0 + ch + 0.05, D / 2 + 0.045), P.accent, 0);
  const top = roofGable(k, P, st, { x: 0, z: 0, w: W + 0.04, d: D + 0.04, y: top0 + ch + 0.16, h: 0.58, ridge: 'z', grade: 'grand', team: true });
  // cult statue before the door and team banners between the front columns
  idol(k, P, 0, top0, 0.88, 0.95);
  for (const sx of [-1, 1]) banner(k, P, sx * 0.64, top0 + ch - 0.02, D / 2 - 0.12, 0.2, 0.5);
  brazier(k, P, -0.42, y + 0.24, 1.25, 0.6, 0.15);
  brazier(k, P, 0.42, y + 0.24, 1.25, 0.6, 0.15);
  return top;
}

function templeLonghouse(k, P, st) {
  const y = PLINTH;
  // great hof with a raised clerestory roof, stave-church style
  const top1 = hall(k, P, st, { x: 0, z: -0.25, w: 2.4, d: 1.5, h: 0.9, rh: 0.95, grade: 'mid', doorW: 0.4, doorH: 0.58, lim: 1.4 });
  const y2 = y + 0.9 + 0.62;
  k.b(bx(k, 0.03, 1.2, 0.42, 0.75, 0, y2 - 0.06, -0.25), P.wallD, 0.06);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(box(0.07, 0.42, 0.07, sx * 0.6, y2 - 0.06, -0.25 + sz * 0.375), P.woodD, 0.03);
  const top2 = roofLonghouse(k, P, st, { x: 0, z: -0.25, w: 1.2, d: 0.75, y: y2 + 0.36, h: 0.62, grade: 'grand', team: true });
  // entrance porch
  k.b(bx(k, 0.03, 0.62, 0.5, 0.36, 0, y, 0.62), P.wall, 0.06);
  roofGable(k, P, { ...st, ornament: 'none' }, { x: 0, z: 0.64, w: 0.66, d: 0.42, y: y + 0.5, h: 0.32, ridge: 'z', team: false });
  k.hole(box(0.26, 0.38, 0.03, 0, y, 0.82), y, 0.38);
  // carved pillars with shields, sacred fire
  for (const sx of [-1, 1]) {
    carvedPost(k, P, sx * 0.85, y, 0.95, 1.05);
    shield(k, P, sx * 0.85, y + 0.5, 0.95 + 0.07, 0.11);
    standard(k, P, sx * 1.22, y, 0.62, 1.45, 0.2, 0.62);
  }
  firePit(k, P, 0, y, 1.15, 1.0);
  return Math.max(top1, top2);
}

function templePyramid(k, P, st) {
  const y = PLINTH;
  // pyramid with a golden capstone behind a pylon gateway with flagpoles and obelisks
  const pz = -0.32;
  const ph = 2.0;
  k.b(bx(k, 0.04, 2.1, 0.12, 2.0, 0, y, pz), P.stoneD, 0.04);
  const B = 0.98;
  // the great pyramid in courses of dressed stone, each set back from the one below
  k.b(courseLoft({
    cx: 0, cz: pz, y: y + 0.12, hw: B, hd: B * 0.95, tw: B * 0.16, td: B * 0.16 * 0.95, h: ph * 0.84,
    n: k.lod ? 12 : 6, lip: 0.03, shadow: 0.14, butt: 0.62, tint: 0.05, rnd: () => k.rng.next(),
  }), P.roofC, 0.04);
  k.b(hipLoft({ cx: 0, cz: pz, y: y + 0.12 + ph * 0.84, hw: B * 0.16, hd: B * 0.16 * 0.95, h: ph * 0.16, steps: 1 }), P.accent, 0);
  // pylons
  const pyz = 0.82;
  for (const sx of [-1, 1]) {
    const px = sx * 0.62;
    k.b(bfr(k, 0.04, 0.82, 1.25, 0.42, 0.8, px, y, pyz, 0.85), P.wall, 0.04);
    k.b(bx(k, 0.02, 0.82 * 0.8 + 0.08, 0.1, 0.42 * 0.85 + 0.08, px, y + 1.2, pyz), P.trim, 0.02);
    k.b(box(0.82 * 0.8 + 0.06, 0.03, 0.42 * 0.85 + 0.06, px, y + 1.17, pyz), P.accent, 0);
    k.b(box(0.36, 0.5, 0.02, px, y + 0.42, pyz + 0.19), P.trimD, 0.05);
    k.b(ball(0.05, px, y + 0.82, pyz + 0.2, 5, 3), P.accent, 0);
    flag(k, P, px + sx * 0.18 - 0.08, y, pyz + 0.3, 1.65, 0.32, 0.2);
    obelisk(k, P, sx * 1.18, y, 1.0, 1.15);
  }
  // gate and lintel with a winged sun disk
  k.b(box(0.44, 0.08, 0.4, 0, y + 0.92, pyz), P.trim, 0.02);
  k.hole(box(0.42, 0.84, 0.03, 0, y, pyz - 0.1), y, 0.84);
  k.b(cyl(0.07, 0.07, 0.03, 8, 0, 0, 0).rotateX(PI / 2).translate(0, y + 0.96, pyz + 0.22), P.accent, 0);
  for (const sx of [-1, 1]) k.b(box(0.18, 0.05, 0.02, sx * 0.15, y + 0.95, pyz + 0.215), P.accent, 0);
  return y + 0.12 + ph;
}

function templeShikhara(k, P, st) {
  const y = PLINTH;
  // raised platform (jagati) with steps, sanctum tower and a pillared hall in front
  const top0 = steps(k, P, 2.7, 2.7, y, 2, 0.1, 0.08, P.stoneD);
  k.b(bx(k, 0.015, 2.5, 0.04, 2.5, 0, top0, 0), P.wallD, 0.03);
  const py = top0 + 0.04;
  // sanctum
  const sz = -0.42;
  k.b(bx(k, 0.04, 1.3, 0.75, 1.3, 0, py, sz), P.wall, 0.04);
  frieze(k, P, 0, sz + 0.65, 1.25, py + 0.55);
  k.b(bx(k, 0.02, 1.38, 0.08, 1.38, 0, py + 0.72, sz), P.trim, 0.02);
  const top = roofShikhara(k, P, st, { x: 0, z: sz, w: 1.28, d: 1.28, y: py + 0.8, h: 1.8, grade: 'grand', team: true });
  // mandapa hall
  const mz = 0.62;
  k.b(bx(k, 0.02, 1.15, 0.06, 0.95, 0, py, mz), P.stone, 0.02);
  for (const sx of [-1, 1]) for (const zz of [-0.35, 0.05, 0.42]) k.b(cyl(0.05, 0.06, 0.55, 6, sx * 0.48, py + 0.06, mz + zz, true), P.wallL, 0.03);
  k.b(bx(k, 0.025, 1.15, 0.08, 0.95, 0, py + 0.6, mz), P.trim, 0.02);
  // stepped pyramidal hall roof (phamsana)
  for (let i = 0; i < 4; i++) {
    const s = 1 - i * 0.2;
    k.b(bfr(k, 0.03, 1.2 * s, 0.11, 1.0 * s, 0.88, 0, py + 0.68 + i * 0.11, mz), i % 2 ? P.roofD : P.roof, 0.03);
  }
  k.b(ball(0.07, 0, py + 1.15, mz, 6, 3), P.accent, 0);
  idol(k, P, 0, py, mz - 0.05, 0.62);
  for (const sx of [-1, 1]) {
    banner(k, P, sx * 0.4, py + 0.58, mz + 0.48, 0.18, 0.34);
    k.b(box(0.14, 0.3, 0.2, sx * 1.12, py, 1.1), P.stone, 0.03);
    brazier(k, P, sx * 1.12, py + 0.3, 1.1, 0.5, 0.1);
  }
  k.t(box(2.52, 0.05, 2.52, 0, top0 - 0.03, 0), 1);
  return top;
}

function templePagoda(k, P, st) {
  const y = PLINTH;
  const top0 = steps(k, P, 2.5, 2.5, y, 1, 0.12, 0, P.stone);
  // three-tier pagoda on the back half, torii and stone lanterns in front, nobori banners
  const pz = -0.38;
  k.b(bx(k, 0.035, 1.3, 0.12, 1.3, 0, top0, pz), P.stoneD, 0.03);
  rectWalls(k, P, st, { x: 0, z: pz, w: 1.08, d: 1.08, y: top0 + 0.12, h: 0.55, doorW: 0.24, doorH: 0.38 });
  const top = roofPagoda(k, P, st, { x: 0, z: pz, w: 1.08, d: 1.08, y: top0 + 0.67, h: 1.15, tiers: 3, grade: 'grand', team: true });
  if (st.ornament === 'torii') torii(k, P, 0, top0, 0.95, 1.5, 1.05);
  else ornamentPair(k, P, st, 0.8, top0, 0.95, 0.7);
  for (const sx of [-1, 1]) {
    stoneLantern(k, P, sx * 0.62, top0, 0.42, 0.5);
    standard(k, P, sx * 1.12, y, -0.2, 1.5, 0.17, 0.75);
  }
  k.t(box(1.32, 0.04, 1.32, 0, top0 + 0.09, pz), 1);
  return top;
}

function templeCurved(k, P, st) {
  const y = PLINTH;
  // terrace with balustrade, red-pillared hall under a double-eaved sweeping roof, lanterns
  const top0 = steps(k, P, 2.72, 2.6, y, 2, 0.12, 0.09, P.stoneL, 0, -0.03);
  for (const sx of [-1, 1]) k.b(box(0.04, 0.12, 2.3, sx * 1.2, top0, -0.03), P.stoneL, 0.02);
  k.b(box(0.7, 0.12, 0.04, -0.85, top0, 1.12), P.stoneL, 0.02);
  k.b(box(0.7, 0.12, 0.04, 0.85, top0, 1.12), P.stoneL, 0.02);
  stair(k, P, 0, y, top0, 1.36, 1.14, 0.5, P.stoneL);
  const hz = -0.18;
  rectWalls(k, P, st, { x: 0, z: hz, w: 1.85, d: 1.2, y: top0, h: 0.85, doorW: 0.36, doorH: 0.58, windows: 1 });
  // front colonnade (red pillars)
  for (let i = 0; i < 4; i++) k.b(cyl(0.05, 0.055, 0.85, 6, -0.82 + i * 0.547, top0, hz + 0.78, true), P.wall, 0.03);
  k.b(box(1.85, 0.08, 0.36, 0, top0 + 0.78, hz + 0.68), P.beam, 0.02);
  const top = roofCurved(k, P, st, { x: 0, z: hz + 0.1, w: 1.95, d: 1.45, y: top0 + 0.85, h: 0.82, grade: 'grand', team: true });
  for (let i = 0; i < 4; i++) hangingLantern(k, P, -0.82 + i * 0.547, top0 + 0.78, hz + 0.82, 0.12);
  for (const sx of [-1, 1]) {
    k.b(box(0.22, 0.12, 0.22, sx * 0.55, y, 1.2), P.stone, 0.03);
    k.b(box(0.15, 0.2, 0.25, sx * 0.55, y + 0.12, 1.2), P.accentD, 0.05);
    k.b(ball(0.08, sx * 0.55, y + 0.37, 1.24, 6, 4), P.accentD, 0.05);
    standard(k, P, sx * 1.2, top0, 0.95, 1.2, 0.16, 0.55);
  }
  return top;
}

function templeStepped(k, P, st) {
  const y = PLINTH;
  const mud = st.wall === 'mudbrick' || st.wall === 'brick';
  if (mud) {
    // ziggurat: buttressed terraces, a long front stairway and a shrine on top
    const tiers = [[2.6, 2.1, 0.5], [1.95, 1.6, 0.45], [1.35, 1.1, 0.4]];
    let yy = y;
    let zc = -0.25;
    for (let i = 0; i < tiers.length; i++) {
      const [tw, td, th] = tiers[i];
      k.b(bfr(k, 0.05, tw, th, td, 0.95, 0, yy, zc, 0.95), i % 2 ? P.wallD : P.wall, 0.05);
      const nb = Math.round(tw / 0.32);
      for (let b = 0; b < nb; b++) {
        k.b(box(0.06, th * 0.9, 0.03, -tw / 2 + 0.16 + (b * (tw - 0.32)) / (nb - 1), yy, zc + td / 2 - 0.005), P.wallD, 0);
      }
      k.b(bx(k, 0.016, tw * 0.95 + 0.04, 0.04, td * 0.95 + 0.04, 0, yy + th - 0.03, zc), P.trim, 0.02);
      yy += th;
      zc -= 0.06;
    }
    stair(k, P, 0, y, yy - 0.42, 1.22, 0.35, 0.32, P.wallL);
    stair(k, P, 0, yy - 0.42, yy, 0.42, 0.0, 0.26, P.wallL);
    // shrine on top with blue glazed walls
    k.b(bx(k, 0.035, 0.7, 0.42, 0.55, 0, yy, zc), P.trim, 0.04);
    k.b(bx(k, 0.022, 0.76, 0.06, 0.6, 0, yy + 0.42, zc), P.accent, 0.02);
    k.hole(box(0.18, 0.28, 0.03, 0, yy, zc + 0.28), yy, 0.28);
    for (let i = 0; i < 4; i++) k.b(box(0.1, 0.1, 0.06, -0.3 + i * 0.2, yy + 0.48, zc + 0.27), P.wallL, 0.02);
    flag(k, P, 0.3, yy + 0.48, zc - 0.15, 0.6, 0.3, 0.18);
    k.t(box(2.62, 0.05, 2.12, 0, y + 0.47, -0.25), 1);
    for (const sx of [-1, 1]) {
      if (st.ornament === 'winged_bulls') lamassu(k, P, sx * 0.42, y, 1.0, 0.85);
      else ornament(k, P, st, sx * 0.42, y, 1.0, 0.75, sx);
      banner(k, P, sx * 0.95, y + 0.45, 0.79, 0.22, 0.32);
    }
    return yy + 1.15;
  }
  // Mesoamerican pyramid: steep stepped tiers, twin stair, twin shrines on top
  const tiers = [[2.62, 0.38], [2.22, 0.38], [1.82, 0.38], [1.42, 0.38]];
  let yy = y;
  for (let i = 0; i < tiers.length; i++) {
    const [tw, th] = tiers[i];
    k.b(bfr(k, 0.045, tw, th, tw * 0.94, 0.94, 0, yy, -0.1, 0.94), P.wall, 0.05);
    k.b(bx(k, 0.02, tw * 0.94 + 0.02, 0.05, tw * 0.94 * 0.94 + 0.02, 0, yy + th - 0.08, -0.1), shade(P.wall, 0.82), 0.02);
    yy += th;
  }
  const sw = 0.62;
  stair(k, P, 0, y, yy, 1.26, 0.55, sw, P.stoneL);
  for (const sx of [-1, 1]) k.b(strut([sx * (sw / 2 + 0.05), y + 0.08, 1.2], [sx * (sw / 2 + 0.05), yy + 0.06, 0.55], 0.1, 0.1), P.trim, 0.03);
  // twin shrines (one in roof red, one in trim teal)
  for (const sx of [-1, 1]) {
    const sxp = sx * 0.33;
    const c = sx < 0 ? P.trim : P.roof;
    k.b(bx(k, 0.03, 0.5, 0.42, 0.62, sxp, yy, -0.32), P.wallL, 0.03);
    k.hole(box(0.16, 0.26, 0.03, sxp, yy, -0.0), yy, 0.26);
    k.b(bfr(k, 0.03, 0.54, 0.32, 0.66, 0.85, sxp, yy + 0.42, -0.32), c, 0.04);
    for (let i = 0; i < 3; i++) k.b(box(0.08, 0.1, 0.08, sxp - 0.16 + i * 0.16, yy + 0.74, -0.06), c, 0.03);
    k.t(box(0.5, 0.08, 0.02, sxp, yy + 0.26, -0.005), 1);
    brazier(k, P, sx * 0.62, yy, 0.18, 0.5, 0.12);
  }
  for (const sx of [-1, 1]) {
    if (st.ornament === 'serpents') serpentHead(k, P, sx * (sw / 2 + 0.05), y, 1.02, 0.95);
    else ornament(k, P, st, sx * (sw / 2 + 0.15), y, 1.12, 0.6, sx);
    standard(k, P, sx * 1.25, y, 1.15, 1.25, 0.16, 0.5);
  }
  k.t(box(2.64, 0.05, 2.48, 0, y + 0.3, -0.1), 1);
  return yy + 0.9;
}

function templeThatch(k, P, st) {
  const y = PLINTH;
  // great roundhouse inside a ring of standing stones, sacred fire at the entrance
  const top = hall(k, P, st, { x: 0, z: -0.28, w: 1.72, d: 1.72, h: 0.62, rh: 1.45, grade: 'grand', doorW: 0.3, doorH: 0.45, lim: 1.4 });
  const n = 10;
  for (let i = 1; i < n; i++) {
    const a = PI / 2 + (i * PI * 2) / n;
    const r = 1.15;
    const sx = Math.cos(a) * r;
    const sz = Math.sin(a) * r - 0.05;
    if (st.ornament === 'knots') standingStone(k, P, sx, y, sz, 0.75 + (i % 3) * 0.1, Math.atan2(-Math.cos(a), -Math.sin(a)));
    else ornament(k, P, st, sx, y, sz, 0.6, sx < 0 ? -1 : 1);
  }
  firePit(k, P, 0, y, 0.95, 1.2);
  for (const sx of [-1, 1]) standard(k, P, sx * 0.48, y, 0.85, 1.3, 0.18, 0.55);
  return top;
}

function templeDome(k, P, st) {
  const y = PLINTH;
  // Sudano-Sahelian sanctuary: battered mudbrick walls bristling with toron, buttress towers, domes
  const hz = -0.3;
  const W = 2.3;
  const D = 1.6;
  const h = 1.05;
  rectWalls(k, P, st, { x: 0, z: hz, w: W, d: D, y, h, doorW: 0.34, doorH: 0.62 });
  k.b(bx(k, 0.025, W + 0.02, 0.06, D + 0.02, 0, y + h, hz), P.wallD, 0.03);
  const top = roofFlatDome(k, P, { ...st, ornament: 'none' }, { x: 0, z: hz - 0.1, w: W * 0.7, d: D * 0.8, y: y + h + 0.06, h: 0.55, grade: 'grand', team: true });
  // buttress towers along the front
  const fz = hz + D / 2;
  for (const px of [-1.05, -0.5, 0.5, 1.05]) pinnacle(k, P, px, y, fz + 0.03, 1.5 + (Math.abs(px) < 0.7 ? 0.25 : 0), 0.26);
  // the central tower over the door
  k.b(bfr(k, 0.04, 0.5, 1.75, 0.3, 0.6, 0, y, fz + 0.06, 0.7), P.wall, 0.04);
  k.b(cone(0.11, 0.35, 6, 0, y + 1.75, fz + 0.06), P.wall, 0);
  k.b(ball(0.06, 0, y + 2.12, fz + 0.06, 5, 4, 1.3), P.white, 0);
  for (let i = 0; i < 3; i++) k.b(pole([-0.18, y + 0.85 + i * 0.3, fz + 0.2], [0.18, y + 0.85 + i * 0.3, fz + 0.2], 0.018, 3), P.woodD, 0);
  k.b(box(0.34, 0.66, 0.06, 0, y, fz + 0.2), P.trim, 0.03);
  k.hole(box(0.26, 0.56, 0.07, 0, y, fz + 0.21), y, 0.56);
  for (const sx of [-1, 1]) {
    banner(k, P, sx * 0.77, y + 0.95, fz + 0.01, 0.2, 0.4);
    brazier(k, P, sx * 0.35, y, 1.15, 0.55, 0.25);
    standard(k, P, sx * 1.25, y, 1.05, 1.25, 0.16, 0.5);
  }
  return Math.max(top, y + 2.2);
}

function templeFlat(k, P, st) {
  const y = PLINTH;
  const top0 = steps(k, P, 2.7, 2.7, y, 2, 0.1, 0.08, P.stone);
  rectWalls(k, P, st, { x: 0, z: -0.3, w: 2.1, d: 1.5, y: top0, h: 1.15, doorW: 0.4, doorH: 0.7 });
  for (let i = 0; i < 6; i++) column(k, P, -0.95 + i * 0.38, top0, 0.6, 1.15, 0.07, P.wallL);
  k.b(bx(k, 0.03, 2.2, 0.12, 0.4, 0, top0 + 1.15, 0.55), P.wallL, 0.02);
  const top = roofFlat(k, P, st, { x: 0, z: -0.15, w: 2.2, d: 1.85, y: top0 + 1.15, grade: 'grand', team: true });
  idol(k, P, 0, top0, 0.95, 0.8);
  ornamentPair(k, P, st, 1.05, y, 1.04, 0.8);
  for (const sx of [-1, 1]) banner(k, P, sx * 0.55, top0 + 1.1, 0.42, 0.2, 0.45);
  return top;
}

const TEMPLES = {
  gable: templeGable, longhouse: templeLonghouse, pyramid: templePyramid, shikhara: templeShikhara, pagoda: templePagoda,
  curved: templeCurved, stepped: templeStepped, thatch_cone: templeThatch, dome: templeDome, flat: templeFlat,
};

function buildTower(k, P, st) {
  const y = PLINTH;
  k.b(box(1.5, 0.03, 1.5, 0, y, 0), P.yard, 0.04);
  const s = isRound(st) ? 0.95 : 0.9;
  const top = towerStruct(k, P, st, { x: 0, z: 0, s, h: 2.0, team: true });
  if (st.wall !== 'timber') banner(k, P, 0, y + 1.85, isRound(st) ? s / 2 - 0.04 : s / 2 - 0.01, 0.24, 0.5);
  else {
    k.b(box(0.3, 0.04, 0.12, 0.42, y, 0.5), P.wood, 0.05);
    barrel(k, P, -0.55, y, 0.55, 0.24);
  }
  ornament(k, P, st, 0.6, y, 0.6, 0.45, 1);
  return top;
}

// ---- walls ----

// N, E, S, W as (x, z) steps: the order of the connection bits (data/walls.js WALL_N..WALL_W).
const ARM_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const WALL_REACH = 0.5; // an arm to the next segment runs to the tile edge
const TOWER_REACH = 1.1; // an arm to a tower runs on into its footprint: the tower stands well inside it

/** The arms of a segment from its connection mask: [{ dx, dz, reach }]. */
function wallArms(mask) {
  const arms = [];
  for (let d = 0; d < 4; d++) {
    if (mask & (1 << d)) arms.push({ dx: ARM_DIRS[d][0], dz: ARM_DIRS[d][1], reach: mask & (16 << d) ? TOWER_REACH : WALL_REACH });
  }
  return arms;
}

/** A box along an arm from distance a to b from the tile center, `w` wide across it and `h` tall from y, `off` to one side. */
function armBox(arm, a, b, w, y, h, off = 0) {
  const mid = (a + b) / 2;
  return box(arm.dx ? b - a : w, h, arm.dz ? b - a : w, arm.dx ? arm.dx * mid : off, y, arm.dz ? arm.dz * mid : off);
}

/**
 * Wooden wall: a palisade of sharpened stakes round a stouter post at the tile center, two rails
 * lashed along each face (the upper one in the team's color). Arms reach the next segment or tower.
 */
function buildWoodenWall(k, P, mask) {
  const arms = wallArms(mask);
  const H = 0.9;
  const sunk = 0.35;
  // round logs shaded smooth at the detailed level (a sixth side), faceted at the plain one; a segment
  // with a tower on every side (the most stakes it can have) keeps five to stay under the wall budget
  const sides = k.lod && arms.filter((a) => a.reach > WALL_REACH).length < 4 ? 6 : 5;
  const stake = (x, z, h, r, color) => {
    k.b(cyl(r * 0.9, r, h + sunk, sides, x, -sunk, z, true), color, 0.06);
    k.b(cone(r * 0.9, 0.2, sides, x, h, z, true), P.woodL, 0.05);
  };
  stake(0, 0, H + 0.15, 0.1, P.woodD);
  k.t(box(0.23, 0.07, 0.23, 0, H * 0.62, 0), 1);
  if (!arms.length) for (const sx of [-1, 1]) for (const sz of [-1, 1]) stake(sx * 0.16, sz * 0.16, H - 0.08 + k.rand(-0.06, 0.04), 0.07, P.wood);
  for (const a of arms) {
    let i = 0;
    for (let t = 0.17; t <= a.reach - 0.03; t += 0.145) stake(a.dx * t, a.dz * t, H + k.rand(-0.09, 0.05), 0.07, i++ % 2 ? P.woodD : P.wood);
    for (const side of [-1, 1]) {
      k.b(armBox(a, 0, a.reach, 0.035, 0.26, 0.055, side * 0.085), P.woodD, 0.04);
      k.t(armBox(a, 0, a.reach, 0.035, 0.62, 0.055, side * 0.085), 1);
    }
  }
  return H + 0.35;
}

/**
 * Stone wall: a pier with a cap at the tile center and a coped wall with a merlon every so often
 * along each arm, a band in the team's color on both faces. A footing sunk below ground hides slopes
 * (in the body mesh: a segment is two draw calls, a long wall is hundreds of them).
 */
function buildStoneWall(k, P, mask) {
  const arms = wallArms(mask);
  const H = 0.9;
  // the pier, the wall and its cope are rounded off at the detailed level (the worst mask stays well under the budget)
  const bev = (w, h, d, r, x, y, z) => (k.lod ? bevelBox(w, h, d, r, x, y, z) : box(w, h, d, x, y, z));
  const armBev = (arm, a, b, w, y, h, r) => {
    const mid = (a + b) / 2;
    return arm.dx ? bev(b - a, h, w, r, arm.dx * mid, y, 0) : bev(w, h, b - a, r, 0, y, arm.dz * mid);
  };
  k.b(box(0.5, 0.5, 0.5, 0, -0.5, 0), P.stoneD, 0.06);
  k.b(bev(0.46, H + 0.18, 0.46, 0.04, 0, 0, 0), P.stone, 0.08);
  k.b(bev(0.56, 0.07, 0.56, 0.025, 0, H + 0.18, 0), P.stoneL, 0.05);
  k.t(box(0.48, 0.07, 0.48, 0, H * 0.58, 0), 1);
  for (const a of arms) {
    k.b(armBox(a, 0.2, a.reach, 0.36, -0.5, 0.5), P.stoneD, 0.06);
    k.b(armBev(a, 0.2, a.reach, 0.32, 0, H, 0.03), P.stone, 0.08);
    k.b(armBev(a, 0.2, a.reach, 0.38, H, 0.07, 0.022), P.stoneL, 0.04);
    for (let t = 0.42; t <= a.reach - 0.1; t += 0.4) k.b(armBox(a, t - 0.07, t + 0.07, 0.3, H + 0.07, 0.13), P.stone, 0.06);
    for (const side of [-1, 1]) k.t(armBox(a, 0.2, a.reach, 0.02, H * 0.58, 0.07, side * 0.165), 1);
  }
  return H + 0.25;
}

// ---- titan gate ----

const GATE = { px: 1.22, pw: 0.66, pd: 0.72, open: 2.9 };

function gatePillars(k, P, st, y) {
  const { px, pw, pd, open } = GATE;
  const H = open;
  for (const sx of [-1, 1]) {
    const x = sx * px;
    switch (st.wall) {
      case 'timber':
        k.b(bx(k, 0.035, pw, 0.2, pd, x, y, 0), P.stoneD, 0.08);
        k.b(bx(k, 0.045, pw * 0.7, H, pd * 0.7, x, y + 0.2, 0), P.wood, 0.07);
        for (let i = 0; i < 4; i++) k.b(bx(k, 0.022, pw * 0.76, 0.08, pd * 0.76, x, y + 0.45 + i * 0.65, 0), i % 2 ? P.accent : P.trim, 0.03);
        break;
      case 'lacquer':
        k.b(cyl(pw * 0.32, pw * 0.36, H + 0.2, 8, x, y, 0, true), P.wall, 0.03);
        k.b(cyl(pw * 0.45, pw * 0.45, 0.18, 8, x, y, 0), P.dark, 0.02);
        break;
      case 'marble':
        for (const ox of [-1, 1]) column(k, P, x + ox * pw * 0.22, y, pd * 0.18 * ox, H + 0.2, 0.13, P.wallL);
        k.b(bx(k, 0.03, pw + 0.06, 0.12, pd, x, y, 0), P.stoneL, 0.02);
        break;
      case 'sandstone':
      case 'mudbrick':
        k.b(bfr(k, 0.06, pw + 0.15, H + 0.2, pd + 0.1, 0.72, x, y, 0, 0.8), P.wall, 0.05);
        k.b(bx(k, 0.03, (pw + 0.15) * 0.72 + 0.08, 0.1, (pd + 0.1) * 0.8 + 0.08, x, y + H + 0.1, 0), st.wall === 'mudbrick' ? P.wallL : P.trim, 0.02);
        if (st.ornament === 'spikes') {
          for (let i = 0; i < 4; i++) {
            const yy = y + 0.6 + i * 0.6;
            const ww = ((pw + 0.15) / 2) * (1 - 0.28 * ((yy - y) / H));
            k.b(pole([x + sx * ww - sx * 0.02, yy, 0.1], [x + sx * (ww + 0.14), yy, 0.1], 0.02, 3), P.woodD, 0);
            k.b(pole([x, yy + 0.25, ((pd + 0.1) / 2) * (1 - 0.2 * ((yy - y) / H)) - 0.02], [x, yy + 0.25, ((pd + 0.1) / 2) + 0.12], 0.02, 3), P.woodD, 0);
          }
        }
        break;
      case 'brick':
        k.b(bx(k, 0.04, pw, H + 0.2, pd, x, y, 0), P.trim, 0.06);
        for (let i = 0; i < 3; i++) k.b(box(0.3, 0.3, 0.03, x, y + 0.5 + i * 0.85, pd / 2 + 0.005), P.accent, 0.04);
        break;
      case 'stone':
      default:
        k.b(bx(k, 0.045, pw, H + 0.2, pd, x, y, 0), P.wall, 0.08);
        for (let i = 0; i < 5; i++) k.b(box(pw + 0.04, 0.06, pd + 0.04, x, y + 0.3 + i * 0.6, 0), P.wallD, 0.04);
        break;
    }
  }
  return y + H + 0.2;
}

function gateTop(k, P, st, y) {
  const span = GATE.px * 2 + GATE.pw + 0.2;
  const d = GATE.pd;
  switch (st.roof) {
    case 'gable': {
      k.b(bx(k, 0.035, span, 0.22, d, 0, y, 0), P.wallL, 0.02);
      k.b(bx(k, 0.02, span + 0.04, 0.07, d + 0.04, 0, y + 0.08, 0), P.trim, 0.02);
      const ped = solid([
        [[-span / 2, 0, 0.12], [span / 2, 0, 0.12], [0, 0.62, 0.12]],
        [[-span / 2, 0, -0.12], [0, 0.62, -0.12], [span / 2, 0, -0.12]],
        [[-span / 2, 0, 0.12], [0, 0.62, 0.12], [0, 0.62, -0.12]], [[-span / 2, 0, 0.12], [0, 0.62, -0.12], [-span / 2, 0, -0.12]],
        [[span / 2, 0, 0.12], [span / 2, 0, -0.12], [0, 0.62, -0.12]], [[span / 2, 0, 0.12], [0, 0.62, -0.12], [0, 0.62, 0.12]],
      ]);
      ped.translate(0, y + 0.22, 0);
      k.b(ped, P.wallL, 0.02);
      const tym = fromTris([[[-span / 2 + 0.25, 0.06, 0.125], [span / 2 - 0.25, 0.06, 0.125], [0, 0.48, 0.125]]]);
      tym.translate(0, y + 0.22, 0);
      k.b(tym, P.trim, 0);
      k.t(box(span + 0.06, 0.06, 0.28, 0, y + 0.2, 0), 1);
      k.b(cone(0.08, 0.22, 4, 0, y + 0.84, 0), P.accent, 0);
      for (const sx of [-1, 1]) k.b(cone(0.07, 0.2, 4, sx * span / 2, y + 0.22, 0), P.accent, 0);
      return y + 1.06;
    }
    case 'longhouse': {
      // arched beam crowned with dragon heads
      const pts = [];
      const N = 6;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push([-span / 2 + span * t, 0.4 * Math.sin(PI * t)]);
      }
      for (let i = N; i >= 0; i--) {
        const t = i / N;
        pts.push([-span / 2 + span * t, 0.25 + 0.42 * Math.sin(PI * t)]);
      }
      const arch = extrude(pts, 0.3);
      arch.translate(0, y - 0.1, 0);
      k.b(arch, P.wood, 0.06);
      k.t(box(span * 0.5, 0.08, 0.32, 0, y + 0.47, 0), 1);
      for (const sx of [-1, 1]) {
        const hx = sx * span / 2;
        k.b(strut([hx - sx * 0.04, y + 0.1, 0], [hx, y + 0.56, 0], 0.12), P.trim, 0.04);
        k.b(strut([hx, y + 0.56, 0], [hx + sx * 0.16, y + 0.64, 0], 0.13, 0.1), P.trim, 0.04);
        k.b(strut([hx + sx * 0.02, y + 0.48, 0], [hx + sx * 0.13, y + 0.5, 0], 0.05, 0.08), P.trim, 0.04);
        k.b(box(0.04, 0.05, 0.14, hx + sx * 0.08, y + 0.7, 0), P.accent, 0);
      }
      return y + 0.75;
    }
    case 'pyramid': {
      k.b(bx(k, 0.035, span * 0.62, 0.26, d * 0.8, 0, y, 0), P.wall, 0.03);
      k.b(bx(k, 0.022, span * 0.62 + 0.08, 0.1, d * 0.8 + 0.08, 0, y + 0.22, 0), P.trim, 0.02);
      k.b(cyl(0.16, 0.16, 0.04, 10, 0, 0, 0).rotateX(PI / 2).translate(0, y + 0.13, d * 0.4 + 0.02), P.accent, 0);
      for (const sx of [-1, 1]) {
        const wing = box(0.55, 0.09, 0.03, sx * 0.43, y + 0.09, d * 0.4 + 0.015);
        k.b(wing, P.accent, 0.04);
      }
      for (const sx of [-1, 1]) k.b(hipLoft({ cx: sx * GATE.px, cz: 0, y: y, hw: 0.32, hd: 0.3, h: 0.35, steps: 1 }), P.accent, 0);
      return y + 0.4;
    }
    case 'shikhara': {
      k.b(bx(k, 0.03, span, 0.18, d, 0, y, 0), P.wall, 0.03);
      frieze(k, P, 0, d / 2, span * 0.9, y + 0.05);
      let yy = y + 0.18;
      for (let i = 0; i < 5; i++) {
        const s = 1 - i * 0.15;
        k.b(bfr(k, 0.03, span * 0.86 * s, 0.17, d * 0.9 * s, 0.94, 0, yy, 0), i % 2 ? P.roofD : P.roof, 0.03);
        for (let j = 0; j < 3; j++) k.b(ball(0.04, -span * 0.3 * s + j * span * 0.3 * s, yy + 0.2, d * 0.42 * s, 4, 3), P.accent, 0);
        yy += 0.17;
      }
      k.b(cyl(0.13, 0.13, 0.07, 8, 0, yy, 0), P.roofL, 0.05);
      k.b(ball(0.08, 0, yy + 0.15, 0, 6, 4, 1.2), P.accent, 0);
      k.t(box(span + 0.02, 0.05, d + 0.02, 0, y + 0.14, 0), 1);
      return yy + 0.25;
    }
    case 'pagoda': {
      if (st.ornament === 'torii') return y;
      k.b(bx(k, 0.03, span * 0.95, 0.12, d * 0.8, 0, y, 0), P.beam, 0.02);
      return roofPagoda(k, P, st, { x: 0, z: 0, w: span * 0.92, d: d * 0.9, y: y + 0.12, h: 0.7, tiers: 2, grade: 'mid', team: true });
    }
    case 'curved': {
      k.b(bx(k, 0.03, span, 0.16, d * 0.7, 0, y, 0), P.beam, 0.02);
      k.b(box(span * 0.7, 0.2, 0.04, 0, y - 0.32, d * 0.3), P.accent, 0.03);
      k.b(box(span * 0.4, 0.12, 0.05, 0, y - 0.28, d * 0.3 + 0.01), P.roofD, 0);
      roofCurved(k, P, st, { x: 0, z: 0, w: span * 0.55, d: d * 0.65, y: y + 0.16, h: 0.42, grade: 'small', team: true });
      for (const sx of [-1, 1]) roofCurved(k, P, st, { x: sx * GATE.px, z: 0, w: GATE.pw + 0.1, d: d * 0.62, y: y - 0.05, h: 0.3, grade: 'small', team: false });
      for (const sx of [-1, 1]) hangingLantern(k, P, sx * 0.65, y, d * 0.4, 0.16);
      return y + 0.8;
    }
    case 'stepped': {
      const mud = st.wall === 'mudbrick' || st.wall === 'brick';
      k.b(bx(k, 0.04, span, 0.3, d, 0, y, 0), mud ? P.trim : P.wall, 0.05);
      k.b(bx(k, 0.035, span * 0.75, 0.22, d * 0.85, 0, y + 0.3, 0), mud ? P.trim : P.wallD, 0.05);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const mx = -span * 0.375 + (i * span * 0.75) / (n - 1);
        k.b(box(0.13, 0.12, 0.13, mx, y + 0.52, d * 0.3), P.roof, 0.03);
        k.b(box(0.07, 0.08, 0.07, mx, y + 0.64, d * 0.3), P.roof, 0.03);
      }
      if (mud) {
        for (let i = 0; i < 4; i++) k.b(box(0.22, 0.14, 0.02, -0.6 + i * 0.4, y + 0.08, d / 2 + 0.005), P.accent, 0.03);
      } else {
        k.b(box(0.7, 0.14, 0.03, 0, y + 0.09, d / 2), P.trim, 0.03);
        k.b(box(0.18, 0.18, 0.04, 0, y + 0.07, d / 2 + 0.01), P.accent, 0);
      }
      // the team's color runs round the edge of the lower block (a whole flat top of it burned in the sun)
      for (const sz of [-1, 1]) k.t(box(span + 0.02, 0.06, 0.11, 0, y + 0.27, sz * (d / 2 - 0.045)), 1);
      for (const sx of [-1, 1]) k.t(box(0.11, 0.06, d - 0.2, sx * (span / 2 - 0.045), y + 0.27, 0), 1);
      return y + 0.72;
    }
    case 'thatch_cone': {
      // trilithon lintel stone
      const g = box(span + 0.1, 0.36, d * 0.85, 0, y - 0.05, 0);
      const p = g.attributes.position;
      const rr = new RNG(7);
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + (rr.next() - 0.5) * 0.06);
      k.b(g, P.stone, 0.1);
      k.b(torus(0.15, 0.025, 0, y + 0.13, d * 0.43 + 0.01, 3, 10), P.accent, 0);
      for (const sx of [-1, 1]) k.b(torus(0.08, 0.018, sx * 0.48, y + 0.13, d * 0.43 + 0.01, 3, 8), P.accent, 0);
      k.t(box(span * 0.6, 0.05, d * 0.87, 0, y + 0.31, 0), 1);
      return y + 0.4;
    }
    case 'dome': {
      k.b(bfr(k, 0.045, span * 0.85, 0.36, d * 0.85, 0.94, 0, y - 0.05, 0), P.wall, 0.04);
      k.b(courseCone({ cx: 0, cz: 0, y: y + 0.31, r: 0.42, h: 0.4, ...domeCuts(k, 0.42), dome: true, lip: 0.022, shadow: 0.2, butt: 0.55, tint: 0.05, rnd: () => k.rng.next() }), P.roof, 0.05);
      k.t(cyl(0.45, 0.45, 0.06, 8, 0, y + 0.29, 0, true), 1);
      k.b(ball(0.05, 0, y + 0.78, 0, 5, 4, 1.3), P.white, 0);
      for (const sx of [-1, 1]) pinnacle(k, P, sx * GATE.px, y - 0.05, 0, 0.75, 0.32);
      for (let i = 0; i < 5; i++) k.b(pole([-0.6 + i * 0.3, y + 0.15, d * 0.4], [-0.6 + i * 0.3, y + 0.15, d * 0.4 + 0.14], 0.02, 3), P.woodD, 0);
      return y + 1.0;
    }
    case 'flat':
    default:
      k.b(bx(k, 0.04, span, 0.28, d, 0, y, 0), P.wall, 0.04);
      k.b(bx(k, 0.025, span + 0.06, 0.08, d + 0.06, 0, y + 0.26, 0), P.trim, 0.02);
      k.t(box(span * 0.4, 0.15, 0.02, 0, y + 0.06, d / 2 + 0.01), 1);
      return y + 0.4;
  }
}

function buildTitanGate(k, P, st) {
  const y = PLINTH;
  // marble steps a shade down: a broad flat top of near-white stone burns out in a low sun
  const sc = st.wall === 'marble' ? shade(P.stone, 0.86) : P.stone;
  const top0 = steps(k, P, 3.75, 3.6, y, 3, 0.09, 0.12, sc, 0, -0.05);
  stair(k, P, 0, y, top0, 1.78, 1.5, 1.2, shade(sc, 0.95));
  let top;
  if (st.ornament === 'torii' || (st.roof === 'pagoda' && st.wall === 'lacquer')) {
    // a colossal torii
    top = torii(k, P, 0, top0, 0, GATE.px * 2, GATE.open + 0.3);
    k.t(box(0.6, 0.35, 0.03, 0, top0 + GATE.open * 0.86, 0.07), 1);
  } else {
    const ty = gatePillars(k, P, st, top0);
    top = gateTop(k, P, st, ty);
  }
  // swirling vortex rim and runes on the ground
  const vy = top0 + 0.05 + GATE.open * 0.5;
  const rim = torus(1, 0.035, 0, 0, 0, 3, 18);
  rim.scale(0.84, (GATE.open * 0.5 - 0.02) / 1, 1);
  rim.translate(0, vy, 0);
  k.g(rim, tint(P.accent, 0.3), null, GLOW.portal);
  k.g(box(1.7, 0.012, 0.5, 0, top0, 0.32), shade(P.accent, 0.55), null, GLOW.rune);
  // team banners on the pillar fronts
  if (st.ornament !== 'torii') {
    for (const sx of [-1, 1]) banner(k, P, sx * GATE.px, top0 + GATE.open - 0.25, GATE.pd / 2 + (st.wall === 'sandstone' || st.wall === 'mudbrick' ? 0.02 : 0), 0.3, 0.85);
  }
  // braziers and ornaments at the front corners
  for (const sx of [-1, 1]) {
    k.b(box(0.3, 0.32, 0.3, sx * 1.45, top0, 1.25), P.stoneD, 0.04);
    brazier(k, P, sx * 1.45, top0 + 0.32, 1.25, 0.8, 0.12);
    ornament(k, P, st, sx * 1.5, top0, -1.15, 0.85, sx);
  }
  return Math.max(top, top0 + GATE.open);
}

// ---- town center (three tiers) ----

function buildTownCenter(k, P, st, tier) {
  const y = PLINTH;
  const round = isRound(st);
  if (tier <= 1) {
    let top;
    if (round) {
      top = hall(k, P, st, { x: -0.1, z: -0.35, w: 2.3, d: 2.3, h: 0.78, rh: st.roof === 'dome' ? 0.9 : 1.35, grade: 'mid', doorW: 0.4, doorH: 0.55, lim: 1.9 });
      hall(k, P, st, { x: 1.25, z: -1.2, w: 0.95, d: 0.95, h: 0.5, rh: st.roof === 'dome' ? 0.42 : 0.6, lim: 1.9 });
    } else {
      top = hall(k, P, st, { x: 0, z: -0.4, w: 2.55, d: 1.75, h: 0.95, grade: 'mid', doorW: 0.42, doorH: 0.62, windows: 2, lim: 1.9 });
      if (st.ornament !== 'columns') for (const sx of [-1, 1]) banner(k, P, sx * 0.72, y + 0.88, -0.4 + 1.75 / 2 + (st.wall === 'mudbrick' ? -0.02 : 0), 0.22, 0.36);
    }
    // well, firewood, crates, cart
    k.b(cyl(0.22, 0.24, 0.26, 8, -1.25, y, 1.2), P.stone, 0.1);
    k.b(cyl(0.16, 0.16, 0.02, 8, -1.25, y + 0.25, 1.2), made('#2a4a6a', SURF.water), 0);
    for (const sx of [-1, 1]) k.b(box(0.04, 0.42, 0.04, -1.25 + sx * 0.2, y + 0.2, 1.2), P.woodD, 0);
    k.b(box(0.48, 0.04, 0.04, -1.25, y + 0.6, 1.2), P.woodD, 0);
    k.b(prep(new THREE.ConeGeometry(0.32, 0.18, 4, 1, true)).rotateY(PI / 4).translate(-1.25, y + 0.72, 1.2), P.roof, 0.05);
    logPile(k, P, 1.2, y, 1.25, 0.45, 0);
    crate(k, P, 1.45, y, 0.75, 0.2, 0.3);
    barrel(k, P, 1.2, y, 0.7, 0.26);
    sack(k, P, 0.75, y, 1.35, 0.22);
    firePit(k, P, 0.0, y, 1.25, 0.85);
    flag(k, P, 1.62, y, -0.2, 1.9, 0.44, 0.27);
    return top;
  }
  const half = 1.82;
  const gate = 1.0;
  if (tier === 2) {
    perimeter(k, P, st, { half, h: 0.42, gate, merlons: false });
    let top;
    if (round) {
      top = hall(k, P, st, { x: 0, z: -0.3, w: 2.25, d: 2.25, h: 0.95, rh: st.roof === 'dome' ? 1.0 : 1.55, grade: 'mid', doorW: 0.42, doorH: 0.6, lim: 1.75 });
      for (const sx of [-1, 1]) hall(k, P, st, { x: sx * 1.2, z: -1.15, w: 0.9, d: 0.9, h: 0.5, rh: st.roof === 'dome' ? 0.4 : 0.58, door: false, lim: 1.75 });
    } else {
      top = hall(k, P, st, { x: 0, z: -0.35, w: 2.5, d: 1.85, h: 1.3, grade: 'mid', doorW: 0.44, doorH: 0.66, windows: 2, lim: 1.75 });
      if (st.ornament !== 'columns') for (const sx of [-1, 1]) banner(k, P, sx * 0.75, y + 1.2, -0.35 + 1.85 / 2 + (st.wall === 'mudbrick' ? -0.02 : 0), 0.24, 0.5);
    }
    for (const sx of [-1, 1]) towerStruct(k, P, st, { x: sx * 1.45, z: 1.45, s: 0.62, h: 1.25, team: true, simple: true });
    k.b(cyl(0.2, 0.22, 0.22, 8, -0.95, y, 1.05), P.stone, 0.1);
    crate(k, P, 0.95, y, 1.05, 0.2, 0.2);
    barrel(k, P, 0.95, y, 0.78, 0.24);
    return Math.max(top, y + 1.25 + 1.0);
  }
  // City: walls with four towers and a grand palace
  perimeter(k, P, st, { half, h: 0.58, gate, merlons: true });
  let top;
  if (round) {
    k.b(box(2.6, 0.12, 2.6, 0, y, -0.25), P.stoneD, 0.04);
    top = hall(k, P, st, { x: 0, z: -0.3, w: 2.35, d: 2.35, y: y + 0.12, h: 1.05, rh: st.roof === 'dome' ? 1.15 : 1.9, grade: 'grand', doorW: 0.44, doorH: 0.62, lim: 1.75 });
    if (st.roof === 'dome') {
      for (const sx of [-1, 1]) pinnacle(k, P, sx * 0.62, y + 0.12, 0.62, 1.25, 0.24);
    } else {
      for (const sx of [-1, 1]) ornament(k, P, st, sx * 0.62, y + 0.12, 0.85, 0.7, sx);
    }
  } else {
    const ornamentFront = st.ornament !== 'columns';
    k.b(box(2.6, 0.12, 2.1, 0, y, -0.4), P.stoneD, 0.04);
    hall(k, P, st, { x: 0, z: -0.4, w: 2.5, d: 1.95, y: y + 0.12, h: 1.0, grade: 'mid', team: true, doorW: 0.46, doorH: 0.66, windows: 2, porch: st.ornament === 'columns', lim: 1.75, simple: true });
    const uy = y + 0.12 + 1.0 + (st.roof === 'stepped' || st.roof === 'flat' ? 0.06 : roofH(st, 1.95, 'mid') * 0.42);
    if (st.roof === 'shikhara') {
      k.b(box(1.25, 0.4, 1.0, 0, uy, -0.55), P.wall, 0.04);
      top = roofShikhara(k, P, st, { x: 0, z: -0.55, w: 1.2, d: 0.95, y: uy + 0.4, h: 1.45, grade: 'grand', team: true });
    } else if (st.roof === 'stepped') {
      const mud = st.wall === 'mudbrick' || st.wall === 'brick';
      k.b(bfr(k, 0.045, 1.6, 0.42, 1.2, 0.93, 0, uy, -0.55), mud ? P.wallD : P.wall, 0.05);
      k.b(bfr(k, 0.04, 1.05, 0.38, 0.8, 0.9, 0, uy + 0.42, -0.6), mud ? P.wall : P.wallD, 0.05);
      k.b(bx(k, 0.03, 0.6, 0.32, 0.45, 0, uy + 0.8, -0.62), P.trim, 0.04);
      top = roofStepped(k, P, st, { x: 0, z: -0.62, w: 0.62, d: 0.48, y: uy + 1.12, grade: 'small', team: true });
    } else if (st.roof === 'pyramid') {
      k.b(box(1.3, 0.5, 1.0, 0, uy, -0.6), P.wall, 0.04);
      k.b(box(1.36, 0.08, 1.06, 0, uy + 0.5, -0.6), P.trim, 0.02);
      top = roofPyramid(k, P, st, { x: 0, z: -0.6, w: 1.3, d: 1.0, y: uy + 0.58, h: 1.25, grade: 'grand', team: true });
    } else {
      const ux = 1.55;
      const ud = 1.1;
      rectWalls(k, P, st, { x: 0, z: -0.62, w: ux, d: ud, y: uy, h: 0.62, door: false, windows: 1, simple: true });
      top = rectRoof(k, P, st, { x: 0, z: -0.62, w: ux, d: ud, y: uy + 0.62, h: roofH(st, st.roof === 'gable' ? ux : ud, 'grand'), grade: st.roof === 'pagoda' ? 'mid' : 'grand', team: true, ridge: st.roof === 'gable' ? 'z' : undefined });
    }
    if (ornamentFront) ornamentPair(k, P, st, 0.62, y, 1.0, 0.75);
    else for (const sx of [-1, 1]) brazier(k, P, sx * 0.55, y, 1.1, 0.7, 0.3);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    towerStruct(k, P, st, { x: sx * 1.45, z: sz * 1.45, s: 0.62, h: sz > 0 ? 1.55 : 1.75, team: true, simple: true });
  }
  // gatehouse lintel with a team banner
  k.b(box(gate + 0.4, 0.2, 0.24, 0, y + 0.95, half - 0.08), st.wall === 'timber' ? P.woodD : st.wall === 'lacquer' ? P.wall : P.stone, 0.04);
  banner(k, P, 0, y + 1.12, half + 0.04, 0.32, 0.3);
  return Math.max(top, y + 1.75 + 1.1);
}

// ---------------------------------------------------------------------------
// scaffold, foundation, gold mine
// ---------------------------------------------------------------------------

const cw0 = 0.085; // width of the curb stones round a court

function buildFoundation(k, P, st, size, corners = true) {
  const s = size - 2 * MARGIN;
  if (!k.lod) {
    k.f(box(s, DEPTH + PLINTH - 0.03, s, 0, -DEPTH, 0), P.stoneD, 0.06);
    k.f(box(s - 0.06, 0.03, s - 0.06, 0, PLINTH - 0.03, 0), P.court, 0.05);
    // a raised curb of cut stones frames the slab, with a heavier block at each
    // corner, so the building stands on a built plinth rather than a flat pad
    for (const sz of [-1, 1]) k.f(box(s + 0.002, 0.07, 0.07, 0, PLINTH - 0.035, sz * (s / 2 - 0.035)), P.curb, 0.05);
    for (const sx of [-1, 1]) k.f(box(0.07, 0.07, s - 0.14, sx * (s / 2 - 0.035), PLINTH - 0.035, 0), P.curb, 0.05);
    if (corners) for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.f(box(0.12, 0.09, 0.12, sx * (s / 2 - 0.06), PLINTH - 0.035, sz * (s / 2 - 0.06)), shade(P.curb, 1.1), 0.05);
    return;
  }
  // a built plinth with soft edges: footing below the ground, a cobbled court, a rounded curb of cut
  // stones round it and a heavier rounded block at each corner
  k.f(box(s, DEPTH + PLINTH - 0.05, s, 0, -DEPTH, 0), P.stoneD, 0.06);
  k.f(bevelBox(s - 0.02, 0.07, s - 0.02, 0.03, 0, PLINTH - 0.07, 0), P.court, 0.05);
  const cw = cw0;
  const ch = 0.078;
  for (const sz of [-1, 1]) k.f(bevelBox(s - 0.01, ch, cw, 0.028, 0, PLINTH - 0.04, sz * (s / 2 - cw / 2)), P.curb, 0.05);
  for (const sx of [-1, 1]) k.f(bevelBox(cw, ch, s - 2 * cw + 0.02, 0.028, sx * (s / 2 - cw / 2), PLINTH - 0.04, 0), P.curb, 0.05);
  if (corners) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.f(bevelBox(0.13, 0.1, 0.13, 0.04, sx * (s / 2 - 0.065), PLINTH - 0.05, sz * (s / 2 - 0.065)), shade(P.curb, 1.1), 0.05);
    strew(k, P, s);
  }
}

/** Loose stones and tufts of grass along the edges of the court, so a plinth looks lived in rather than laid out. */
function strew(k, P, s) {
  const rock = made(shade(P.stoneD, 0.95), SURF.rock);
  const grass = made(mix(P.leaf, '#9ab84a', 0.3), SURF.plain);
  const inner = s / 2 - cw0 - 0.05;
  for (let i = 0; i < 9; i++) {
    const side = (k.rng.next() * 4) | 0;
    const t = k.rand(-0.92, 0.92) * inner;
    const x = side < 2 ? t : (side === 2 ? -inner : inner) - Math.sign(side - 2.5) * k.rand(0, 0.03);
    const z = side < 2 ? (side === 0 ? -inner : inner) : t;
    if (z > 0.2 && Math.abs(x) < 0.5) continue; // the doorstep stays clear
    if (i % 3 === 2) {
      k.f(cone(0.02, 0.07, 3, x, PLINTH - 0.005, z, true), grass, 0.12);
    } else {
      const r = k.rand(0.035, 0.07);
      k.f(octa(r, 0, 0, 0).scale(1, 0.55, k.rand(0.7, 1)).rotateY(k.rand(0, PI)).translate(x, PLINTH + r * 0.15, z), rock, 0.1);
    }
  }
}

function scaffoldKit(size, H) {
  const k = new Kit(hashSeed(`scaffold|${size}|${H}`));
  const P = { wood: made('#9c7a52', SURF.wood), woodD: made('#6b4e30', SURF.wood), stone: made('#a39b8c', SURF.stone), plank: made('#b38d5e', SURF.wood) };
  const half = size / 2 - MARGIN - 0.05;
  const n = size >= 4 ? 3 : 2;
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(-half + (2 * half * i) / n);
  for (const px of xs) for (const pz of [-half, half]) k.b(box(0.05, H, 0.05, px, 0, pz), P.wood, 0.05);
  for (const pz of xs.slice(1, -1)) for (const px of [-half, half]) k.b(box(0.05, H, 0.05, px, 0, pz), P.wood, 0.05);
  const levels = H > 2.2 ? [0.3, 0.6, 0.95] : [0.45, 0.95];
  for (const f of levels) {
    const ly = H * f;
    for (const sz of [-1, 1]) k.b(box(2 * half + 0.1, 0.03, 0.16, 0, ly, sz * half), P.plank, 0.08);
    for (const sx of [-1, 1]) k.b(box(0.16, 0.03, 2 * half - 0.1, sx * half, ly, 0), P.plank, 0.08);
  }
  for (const sz of [-1, 1]) {
    k.b(strut([-half, 0.05, sz * half], [0, H * levels[0], sz * half], 0.035), P.woodD, 0.03);
    k.b(strut([half, 0.05, sz * half], [0, H * levels[0], sz * half], 0.035), P.woodD, 0.03);
  }
  // ladder on the south face
  for (const sx of [-1, 1]) k.b(strut([0.5 + sx * 0.1, 0, half + 0.12], [0.5 + sx * 0.1, H * levels[0] + 0.1, half + 0.02], 0.03), P.woodD, 0.03);
  for (let i = 1; i < 4; i++) k.b(box(0.2, 0.025, 0.025, 0.5, (H * levels[0] * i) / 4, half + 0.12 - (0.1 * i) / 4), P.woodD, 0);
  // building materials
  for (let i = 0; i < 3; i++) k.b(box(0.5, 0.05, 0.12, -half + 0.45, PLINTH + i * 0.05, half - 0.3 + i * 0.01, 0.05 * i), P.plank, 0.08);
  for (let i = 0; i < 3; i++) k.b(box(0.18, 0.13, 0.13, half - 0.35 + (i % 2) * 0.2, PLINTH + (i > 1 ? 0.13 : 0), half - 0.32 + (i > 1 ? 0.07 : 0)), P.stone, 0.1);
  return finishKit(k);
}

const GOLD_LEVELS = [0.12, 0.38, 0.68, 1];

function buildGoldMineGeometry() {
  const k = new Kit(hashSeed('gold-mine'));
  const rock = made('#7d746a', SURF.rock);
  const rockD = made('#5e564e', SURF.rock);
  const rockL = made('#9a9084', SURF.rock);
  const P = { wood: made('#7b5536', SURF.wood), woodD: made('#4d3421', SURF.wood), gold: made('#f3c63c', SURF.gold), metal: made('#6c7278', SURF.metal) };
  const rr = new RNG(hashSeed('gold-mine-rocks'));
  const rockAt = (r, x, y, z, sy, color) => {
    // an icosphere pushed into a crag by smooth low-frequency waves (the same
    // for every vertex at one spot, so the surface stays closed), then shaded
    // smooth except at the sharper breaks
    const g = prep(new THREE.IcosahedronGeometry(r, 1));
    const p = g.attributes.position;
    const a = rr.next() * PI * 2;
    const b = rr.next() * PI * 2;
    const c = rr.next() * PI * 2;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i);
      const py = p.getY(i);
      const pz = p.getZ(i);
      const len = Math.hypot(px, py, pz) || 1;
      const dx = px / len;
      const dy = py / len;
      const dz = pz / len;
      const s = 0.93 + 0.07 * Math.sin(dx * 4.1 + a) * Math.cos(dz * 3.7 + b) + 0.05 * Math.sin(dy * 5.9 + c + dx * 2.3) - 0.03 * Math.cos(dz * 7.3 + a * 2);
      p.setXYZ(i, px * s, py * s * sy, pz * s);
    }
    g.rotateY(rr.next() * PI);
    g.translate(x, y, z);
    k.b(soft(g, 30), color, 0.05);
    return g;
  };
  // the mound: a big central crag with smaller boulders around (partly below ground)
  rockAt(0.95, 0, 0.25, -0.3, 0.95, rock);
  rockAt(0.68, -0.6, 0.0, -0.55, 0.85, rockD);
  rockAt(0.68, 0.6, 0.02, -0.5, 0.8, rock);
  rockAt(0.52, -0.75, -0.05, 0.35, 0.8, rockL);
  rockAt(0.52, 0.75, -0.05, 0.32, 0.85, rockD);
  rockAt(0.42, -0.3, 0.6, -0.7, 1, rockL);
  rockAt(0.32, 0.35, 1.0, -0.45, 1, rock);
  rockAt(0.32, -0.98, -0.1, -0.95, 0.8, rock);
  rockAt(0.32, 0.98, -0.1, -0.95, 0.8, rockL);
  rockAt(0.28, -1.02, -0.05, 0.95, 0.8, rockD);
  rockAt(0.26, 1.05, -0.06, 0.9, 0.8, rock);
  rockAt(0.2, -0.55, -0.02, 1.1, 1, rockL);
  // timber entrance on the south face
  const ez = 0.32;
  k.b(box(0.7, 0.62, 0.3, 0, 0, ez - 0.05), rockD, 0.08);
  // the mine has no glow mesh: its mouth stays a dark, unlit shaft
  k.b(box(0.48, 0.52, 0.06, 0, 0, ez + 0.12), made('#0d0907', SURF.earth), 0);
  for (const sx of [-1, 1]) k.b(box(0.1, 0.62, 0.1, sx * 0.3, 0, ez + 0.14), P.wood, 0.05);
  k.b(box(0.78, 0.11, 0.13, 0, 0.6, ez + 0.14), P.woodD, 0.05);
  k.b(strut([-0.38, 0.5, ez + 0.2], [-0.12, 0.72, ez + 0.2], 0.05), P.wood, 0.04);
  k.b(strut([0.38, 0.5, ez + 0.2], [0.12, 0.72, ez + 0.2], 0.05), P.wood, 0.04);
  k.b(box(0.18, 0.12, 0.03, 0.38, 0.5, ez + 0.22, 0.1), P.wood, 0.04);
  // rails and a cart full of ore
  for (const sx of [-1, 1]) k.b(box(0.03, 0.025, 0.86, sx * 0.13, 0, ez + 0.6), P.metal, 0);
  for (let i = 0; i < 4; i++) k.b(box(0.38, 0.02, 0.06, 0, 0, ez + 0.28 + i * 0.22), P.woodD, 0);
  k.b(frustum(0.42, 0.24, 0.3, 1.15, 0, 0.07, ez + 0.8), P.woodD, 0.05);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.b(cyl(0.06, 0.06, 0.03, 6, 0, 0, 0).rotateZ(PI / 2).translate(sx * 0.2, 0.07, ez + 0.8 + sz * 0.1), P.metal, 0);
  k.b(cone(0.2, 0.16, 6, 0, 0.31, ez + 0.8), P.gold, 0.12);
  k.b(cone(0.16, 0.12, 5, 0.55, 0, ez + 0.66), P.gold, 0.12);
  // pickaxe leaning on the entrance
  k.b(strut([0.42, 0, ez + 0.3], [0.5, 0.4, ez + 0.22], 0.03), P.wood, 0);
  k.b(strut([0.42, 0.42, ez + 0.2], [0.58, 0.36, ez + 0.24], 0.03), P.metal, 0);
  const body = finishKit(k);
  // keep the mound inside its 3×3 footprint (rock sizes are jittered)
  body.body.computeBoundingBox();
  const bb = body.body.boundingBox;
  const lim = GOLD_MINE.size / 2 - MARGIN;
  const ext = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
  const fit = ext > lim ? lim / ext : 1;
  if (fit < 1) body.body.scale(fit, 1, fit);
  // gold veins (glow, twinkling): sorted so smaller amounts keep fewer veins
  const veinSpots = [];
  const vr = new RNG(hashSeed('gold-veins'));
  const anchors = [[0, 0.25, -0.3, 0.95], [-0.6, 0, -0.55, 0.68], [0.6, 0.02, -0.5, 0.68], [-0.75, -0.05, 0.35, 0.52], [0.75, -0.05, 0.32, 0.52], [-0.3, 0.6, -0.7, 0.42], [0.35, 1.0, -0.45, 0.32]];
  for (let i = 0; i < 22; i++) {
    const [ax, ay, az, ar] = anchors[i % anchors.length];
    const th = vr.next() * PI * 2;
    const ph = 0.25 + vr.next() * 0.9;
    const r = ar * (0.84 + vr.next() * 0.08);
    const px = ax + Math.cos(th) * Math.sin(ph) * r;
    const py = ay + Math.cos(ph) * r * 0.9;
    const pz = az + Math.sin(th) * Math.sin(ph) * r;
    if (py < 0.08 || pz > 0.75) continue;
    veinSpots.push({ x: px, y: py, z: pz, s: 0.05 + vr.next() * 0.05, rank: vr.next(), seed: 0.05 + vr.next() });
  }
  // the two most visible veins (front-most) stay until the mine is empty
  [...veinSpots].sort((a, b) => b.z - a.z).slice(0, 2).forEach((v) => { v.rank = 0; });
  const levels = GOLD_LEVELS.map((lvl) => {
    const kk = new Kit(hashSeed(`gold-level-${lvl}`));
    for (const v of veinSpots) {
      if (v.rank > lvl) continue;
      const g = octa(v.s, 0, 0, 0);
      g.scale(1, 1.5, 1);
      g.rotateZ(v.seed * 3);
      g.translate(v.x, v.y, v.z);
      kk.g(g, C('#ffd23a'), () => [0, v.seed]);
      const g2 = octa(v.s * 0.6, 0, 0, 0);
      g2.translate(v.x + v.s * 0.9, v.y - v.s * 0.4, v.z + v.s * 0.4);
      kk.g(g2, C('#fff1a8'), () => [0, v.seed + 0.37]);
    }
    const glow = finishKit(kk).glow;
    if (glow && fit < 1) glow.scale(fit, 1, fit);
    return glow;
  });
  return { body: body.body, levels, triangles: body.triangles + (levels[3] ? levels[3].attributes.position.count / 3 : 0), height: 1.45 };
}

// ---------------------------------------------------------------------------
// cache, fitting and the public API
// ---------------------------------------------------------------------------

const GEO_CACHE = new Map();
const SCAFFOLD_CACHE = new Map();
let MINE_GEO = null;

/** The triangle budgets of the models (a building; a wall segment). */
export const TRI_BUDGET = 3000;
export const WALL_BUDGET = 700;

/** Detail level new geometry is built at (see Kit): 0 low quality, 1 medium and up. */
let DETAIL = 1;

/**
 * Switch the detail level (the renderer's quality tier). Returns whether it changed; models already
 * built keep their geometry until they `refresh()`, and `pruneBuildingCaches()` then drops the old level's.
 */
export function setBuildingDetail(level) {
  const l = level ? 1 : 0;
  if (l === DETAIL) return false;
  DETAIL = l;
  return true;
}

export const getBuildingDetail = () => DETAIL;

/** Dispose the cached geometry of every detail level but the current one. */
export function pruneBuildingCaches() {
  for (const [key, e] of GEO_CACHE) {
    if (e.lod === DETAIL) continue;
    for (const n of BUCKETS) if (e[n]) e[n].dispose();
    GEO_CACHE.delete(key);
  }
}

function resolveStyle(pantheon) {
  const st = { ...DEFAULT_STYLE, ...(pantheon && pantheon.style) };
  const colors = { ...DEFAULT_COLORS, ...(pantheon && pantheon.colors) };
  return { st, colors };
}

function styleKey(type, st, colors, tier) {
  return `${type}|${tier}|${st.roof}|${st.wall}|${st.ornament}|${colors.wall}|${colors.roof}|${colors.trim}|${colors.accent}|L${DETAIL}`;
}

/**
 * Build (or fetch from the cache) the merged geometry set for a building look. `mask` is a wall
 * segment's connection mask (data/walls.js wallConnections); every mask is a geometry of its own.
 */
function getBuildingGeometry(type, pantheon, tier, mask = 0) {
  const { st, colors } = resolveStyle(pantheon);
  const size = BUILDINGS[type] ? BUILDINGS[type].size : 2;
  const wall = !!(BUILDINGS[type] && BUILDINGS[type].wall);
  const t = type === 'town_center' ? Math.max(1, Math.min(3, tier | 0 || 1)) : 1;
  const key = wall ? `${styleKey(type, st, colors, 1)}|${mask & 255}` : styleKey(type, st, colors, t);
  let entry = GEO_CACHE.get(key);
  if (entry) return entry;
  const P = makePalette(colors, st);
  // A style the detailed build cannot fit in its triangle budget is built at the plain level instead.
  const cap = wall ? WALL_BUDGET : TRI_BUDGET;
  let level = DETAIL;
  let k;
  let top;
  let geos;
  for (;;) {
    k = new Kit(hashSeed(key), level);
    k.tight = type === 'town_center' && t === 3;
    // the city's walls and towers carry the corners; its triangle budget goes there. Wall segments stand on no foundation.
    if (!wall) buildFoundation(k, P, st, size, !k.tight);
    switch (type) {
      case 'wooden_wall': top = buildWoodenWall(k, P, mask & 255); break;
      case 'stone_wall': top = buildStoneWall(k, P, mask & 255); break;
      case 'town_center': top = buildTownCenter(k, P, st, t); break;
      case 'house': top = buildHouse(k, P, st); break;
      case 'barracks': top = buildBarracks(k, P, st); break;
      case 'storehouse': top = buildStorehouse(k, P, st); break;
      case 'shrine': top = buildShrine(k, P, st); break;
      case 'temple': top = (TEMPLES[st.roof] || templeFlat)(k, P, st); break;
      case 'tower': top = buildTower(k, P, st); break;
      case 'titan_gate': top = buildTitanGate(k, P, st); break;
      default: top = hall(k, P, st, { x: 0, z: 0, w: size - 0.6, d: size - 0.6, h: 0.7 }); break;
    }
    geos = finishKit(k);
    if (!level || geos.triangles <= cap) break;
    for (const name of BUCKETS) if (geos[name]) geos[name].dispose();
    level = 0;
  }
  // Dev aid: set globalThis.__BLD_DEBUG = [] to collect the parts that reach past the footprint.
  if (globalThis.__BLD_DEBUG && !wall) {
    const lim = size / 2 - MARGIN;
    for (const name of BUCKETS) for (const g of k.parts[name]) {
      g.computeBoundingBox();
      const bb = g.boundingBox;
      const e = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
      if (e > lim + 0.005) globalThis.__BLD_DEBUG.push(`${key} ${name} ext ${e.toFixed(3)} > ${lim} box x[${bb.min.x.toFixed(2)},${bb.max.x.toFixed(2)}] y[${bb.min.y.toFixed(2)},${bb.max.y.toFixed(2)}] z[${bb.min.z.toFixed(2)},${bb.max.z.toFixed(2)}]`);
    }
  }
  // Safety net: scale any model that overhangs its footprint back inside it (a wall segment's arms
  // run on to the next tile on purpose).
  const limit = wall ? Infinity : size / 2 - MARGIN + 0.005;
  let ext = 0;
  let maxY = 0;
  for (const name of BUCKETS) {
    const g = geos[name];
    if (!g) continue;
    const bb = g.boundingBox;
    ext = Math.max(ext, -bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
    if (name !== 'base') maxY = Math.max(maxY, bb.max.y);
  }
  let fit = 1;
  if (ext > limit) {
    fit = limit / ext;
    for (const name of BUCKETS) {
      const g = geos[name];
      if (!g) continue;
      g.scale(fit, name === 'base' ? 1 : fit, fit);
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
    maxY *= fit;
  }
  const height = Math.max(maxY, typeof top === 'number' ? top * fit : 0);
  entry = {
    key, size, lod: DETAIL, level, ...geos, height, fit, extent: ext * fit,
    vortex: type === 'titan_gate' && { cx: 0, cy: (PLINTH + 0.27 + 0.05 + GATE.open * 0.5) * fit, rx: 0.84 * fit, ry: (GATE.open * 0.5 - 0.02) * fit },
    vortexColors: [tint(P.accent, 0.55), P.accent, mix(P.trim, '#5a2a9a', 0.5)],
    scaffoldH: Math.max(0.9, Math.min(height * 0.72, 2.6)),
    wall,
  };
  GEO_CACHE.set(key, entry);
  return entry;
}

function getScaffold(size, H) {
  const hq = Math.round(H * 10) / 10;
  const key = `${size}|${hq}`;
  let g = SCAFFOLD_CACHE.get(key);
  if (!g) {
    g = scaffoldKit(size, hq).body;
    SCAFFOLD_CACHE.set(key, g);
  }
  return g;
}

let VORTEX_GEO = null;
function vortexGeometry() {
  if (!VORTEX_GEO) VORTEX_GEO = new THREE.CircleGeometry(1, 40);
  return VORTEX_GEO;
}

function makeMesh(geo, mat, name, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/**
 * Build a building model.
 * @param {string} buildingTypeId e.g. 'temple' (see src/data/buildings.js)
 * @param {object|null} pantheon pantheon data (uses .style and .colors); null = neutral style
 * @param {string|number} teamColor owner color for banners, flags and roof trim
 * @param {number} [tier=1] town center tier 1..3 (ignored by other buildings)
 * @returns {{root: THREE.Group, height: number, setProgress: (bp:number)=>void, setTier: (tier:number)=>void,
 *   animate: (timeSec:number)=>void, dispose: ()=>void}}
 */
export function buildBuildingModel(buildingTypeId, pantheon, teamColor, tier = 1) {
  const root = new THREE.Group();
  root.name = `building-${buildingTypeId}`;
  const structure = new THREE.Group(); // body + team + glow; rises during construction
  root.add(structure);
  const teamMat = teamMaterial(teamColor);
  const meshes = {};
  let entry = null;
  let progress = 1;
  let clipBody = null;
  let clipTeam = null;
  let scaffold = null;
  let vortex = null;
  let curTier = tier;
  let curMask = 0;

  const model = { root, height: 1, setProgress, setTier, setConnections, refresh, animate, dispose, type: buildingTypeId };

  function apply(e) {
    entry = e;
    const spec = [
      ['base', root, baseMaterial(), false, true],
      ['body', structure, bodyMaterial(), true, true],
      ['team', structure, teamMat, true, false],
      ['glow', structure, glowMaterial(), false, false],
    ];
    for (const [name, parent, mat, cast, receive] of spec) {
      const geo = e[name];
      if (meshes[name]) {
        if (geo) meshes[name].geometry = geo;
        else {
          parent.remove(meshes[name]);
          meshes[name] = null;
        }
      } else if (geo) {
        meshes[name] = makeMesh(geo, mat, `building-${name}`, cast, receive);
        parent.add(meshes[name]);
      }
    }
    if (e.vortex) {
      if (!vortex) {
        const [a, b, c] = e.vortexColors;
        vortex = new THREE.Mesh(vortexGeometry(), vortexMaterial(a, b, c));
        vortex.name = 'building-vortex';
        vortex.renderOrder = 2;
        structure.add(vortex);
      }
      vortex.scale.set(e.vortex.rx, e.vortex.ry, 1);
      vortex.position.set(0, e.vortex.cy, 0);
    }
    model.height = e.height;
    setProgress(progress);
  }

  function setProgress(bp) {
    progress = bp >= 1 ? 1 : Math.max(0, bp || 0);
    const building = progress < 1;
    if (building) {
      if (!clipBody) {
        clipBody = clipMaterial(bodyMaterial(), null);
        clipTeam = clipMaterial(teamMat, 'team');
        clipTeam.color.copy(teamMat.color);
      }
      const cut = PLINTH + 0.01 + (entry.height + 0.05 - PLINTH) * (0.04 + 0.96 * progress);
      clipBody.userData.uCut.value = cut;
      clipTeam.userData.uCut.value = cut;
      if (meshes.body) {
        meshes.body.material = clipBody;
        meshes.body.castShadow = false;
      }
      if (meshes.team) {
        meshes.team.material = clipTeam;
        meshes.team.castShadow = false;
      }
      if (meshes.glow) meshes.glow.visible = false;
      if (vortex) vortex.visible = false;
      // (a one-tile wall segment simply rises out of the ground)
      if (!entry.wall) {
        if (!scaffold) {
          scaffold = makeMesh(getScaffold(entry.size, entry.scaffoldH), bodyMaterial(), 'building-scaffold', true, false);
          scaffold.matrixAutoUpdate = true;
          root.add(scaffold);
        } else scaffold.geometry = getScaffold(entry.size, entry.scaffoldH);
        scaffold.visible = true;
        scaffold.scale.y = Math.min(1, 0.45 + 0.6 * progress);
      }
    } else {
      if (meshes.body) {
        meshes.body.material = bodyMaterial();
        meshes.body.castShadow = true;
      }
      if (meshes.team) {
        meshes.team.material = teamMat;
        meshes.team.castShadow = true;
      }
      if (meshes.glow) meshes.glow.visible = true;
      if (vortex) vortex.visible = true;
      if (scaffold) {
        root.remove(scaffold);
        scaffold = null;
      }
      if (clipBody) {
        clipBody.dispose();
        clipTeam.dispose();
        clipBody = null;
        clipTeam = null;
      }
    }
  }

  function setTier(t) {
    if (buildingTypeId !== 'town_center') return;
    const nt = Math.max(1, Math.min(3, t | 0 || 1));
    if (nt === curTier && entry) return;
    curTier = nt;
    apply(getBuildingGeometry(buildingTypeId, pantheon, curTier));
  }

  /** Wall segments: the neighbours the wall runs on to (a no-op for other buildings). */
  function setConnections(mask) {
    if (!entry || !entry.wall) return;
    const m = (mask | 0) & 255;
    if (m === curMask) return;
    curMask = m;
    apply(getBuildingGeometry(buildingTypeId, pantheon, curTier, curMask));
  }

  /** Rebuild from the geometry of the current detail level (after setBuildingDetail). */
  function refresh() {
    apply(getBuildingGeometry(buildingTypeId, pantheon, curTier, curMask));
  }

  function animate(timeSec) {
    TIME.value = timeSec;
    if (vortex) vortex.rotation.z = -timeSec * 0.15;
  }

  function dispose() {
    if (root.parent) root.parent.remove(root);
    if (clipBody) {
      clipBody.dispose();
      clipTeam.dispose();
      clipBody = null;
      clipTeam = null;
    }
    scaffold = null;
  }

  apply(getBuildingGeometry(buildingTypeId, pantheon, curTier));
  return model;
}

/**
 * Gold mine: rocky 3×3 mound with glittering gold veins and a timber entrance facing south.
 * @returns {{root: THREE.Group, height: number, setAmountFraction: (f:number)=>void, animate: (t:number)=>void, dispose: ()=>void}}
 */
export function buildGoldMineModel() {
  if (!MINE_GEO) MINE_GEO = buildGoldMineGeometry();
  const root = new THREE.Group();
  root.name = 'gold-mine';
  const body = makeMesh(MINE_GEO.body, bodyMaterial(), 'mine-body', true, true);
  root.add(body);
  const veins = makeMesh(MINE_GEO.levels[3], mineGoldMaterial(), 'mine-gold', false, false);
  root.add(veins);
  let level = 3;
  return {
    root,
    height: MINE_GEO.height,
    setAmountFraction(f) {
      const v = Math.max(0, Math.min(1, Number(f) || 0));
      let l = GOLD_LEVELS.findIndex((x) => v <= x + 1e-6);
      if (l < 0) l = 3;
      const geo = MINE_GEO.levels[l];
      if (v <= 0 || !geo) {
        veins.visible = false;
        return;
      }
      veins.visible = true;
      if (l !== level) {
        level = l;
        veins.geometry = geo;
      }
    },
    animate(timeSec) {
      TIME.value = timeSec;
    },
    dispose() {
      if (root.parent) root.parent.remove(root);
    },
  };
}

/** Advance the shared animation clock (flags, flames, vortices, gold glitter) without a model. */
export function setBuildingTime(timeSec) {
  TIME.value = timeSec;
}

/**
 * Stats for tests and the gallery: triangles, mesh count, height and how far the
 * model reaches from its center (must be ≤ `limit`: size/2 − 0.1, or for a wall segment how far
 * its arms may run into a tower).
 */
export function getBuildingModelInfo(buildingTypeId, pantheon, tier = 1, mask = 0) {
  const e = getBuildingGeometry(buildingTypeId, pantheon, tier, mask);
  let meshes = 0;
  for (const n of BUCKETS) if (e[n]) meshes++;
  if (e.vortex) meshes++;
  const mounted = buildBuildingModel(buildingTypeId, pantheon, '#ffffff', tier);
  mounted.setConnections(mask);
  mounted.setProgress(0.5);
  let constructionMeshes = 0;
  mounted.root.traverse((o) => { if (o.isMesh) constructionMeshes++; });
  mounted.dispose();
  return {
    triangles: e.triangles, level: e.level, meshes, constructionMeshes, height: e.height, extent: e.extent, fit: e.fit,
    size: e.size, limit: e.wall ? TOWER_REACH + 0.05 : e.size / 2 - MARGIN,
  };
}

/** Gold mine stats (triangles, height). */
export function getGoldMineInfo() {
  if (!MINE_GEO) MINE_GEO = buildGoldMineGeometry();
  return { triangles: MINE_GEO.triangles, height: MINE_GEO.height, size: GOLD_MINE.size };
}

/** Drop every cached geometry and shared material (e.g. when leaving a game for good). */
export function clearBuildingCaches() {
  for (const e of GEO_CACHE.values()) for (const n of BUCKETS) if (e[n]) e[n].dispose();
  GEO_CACHE.clear();
  for (const g of SCAFFOLD_CACHE.values()) g.dispose();
  SCAFFOLD_CACHE.clear();
  if (MINE_GEO) {
    MINE_GEO.body.dispose();
    for (const g of MINE_GEO.levels) if (g) g.dispose();
    MINE_GEO = null;
  }
}

