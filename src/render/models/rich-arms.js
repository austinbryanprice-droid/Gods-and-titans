// More hand-held gear for the rich humanoids, beyond the common swords, axes, spears and bows of
// rich-gear.js: the signature weapons and emblems of the gods and their people (tridents, bolts,
// scepters, scythes ...). Same grip frame as rich-gear.js (origin = palm, +Y along the weapon,
// blade width along X, thickness along Z). Anything not built here keeps its low-poly model.
import { ps } from './rich-kit.js';
import { shadeC, mixC, tintC } from './unit-geo.js';
import { grip, grain, sstep } from './rich-gear.js';
import { mul, lerp, tint } from './rich-paint.js';

const PI = Math.PI;
const TAU = PI * 2;

/** Rows of [y, rx, rz] to stations on the weapon's axis. */
const along = (rows, s) => rows.map(([y, rx, rz]) => ps(0, y * s, 0, rx * s, (rz ?? rx) * s));

/** A trident: a long shaft and three barbed prongs, the outer two curving out and up from a socket. */
function trident(kit, pal, s, { shaftColor = null } = {}) {
  const shaft = shaftColor || pal.wood;
  const metal = pal.accentMetal;
  kit.loft(along([[-0.46, 0.016], [-0.12, 0.0195], [0.4, 0.0185], [0.86, 0.0165]], s), {
    ref: [1, 0, 0], rings: 9, sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: shaft, mat: 'wood', paint: grain(),
  });
  grip(kit, -0.1 * s, 0.1 * s, 0.0235 * s, pal.leather, 5);
  kit.loft(along([[0.82, 0.0215], [0.875, 0.031], [0.935, 0.0215]], s), { ref: [1, 0, 0], rings: 5, sides: 10, start: null, end: null, color: shadeC(metal, 0.74), mat: 'metal' });
  // the middle prong: a long leaf with a barbed head
  kit.loft(along([[0.93, 0.016, 0.012], [1.08, 0.0125, 0.0105], [1.22, 0.0105, 0.009], [1.275, 0.027, 0.0105], [1.34, 0.019, 0.008], [1.42, 0.003, 0.003]], s), {
    ref: [1, 0, 0], rings: 12, sides: 8, start: null, end: 'round', capDepth: 0.02 * s, color: metal, mat: 'metal',
    paint: (o, x, y, z, u) => mul(o, 0.92 + 0.14 * sstep(0.6, 1, u)),
  });
  // the outer prongs sweep out from the socket, then straight up, each ending in a barb
  for (const side of [1, -1]) {
    const pts = [[0.0, 0.935], [0.045, 0.955], [0.088, 1.0], [0.104, 1.07], [0.104, 1.16], [0.1, 1.24]];
    const st = pts.map(([x, y], i) => ps(side * x * s, y * s, 0, (0.0125 - i * 0.0006) * s, (0.0115 - i * 0.0005) * s));
    st.push(ps(side * 0.1 * s, 1.275 * s, 0, 0.0085 * s, 0.026 * s));
    st.push(ps(side * 0.1 * s, 1.33 * s, 0, 0.005 * s, 0.014 * s));
    st.push(ps(side * 0.1 * s, 1.38 * s, 0, 0.002 * s, 0.002 * s));
    kit.loft(st, { ref: [0, 0, 1], rings: 12, sides: 8, start: 'round', end: 'round', capDepth: [0.008 * s, 0.012 * s], color: metal, mat: 'metal' });
  }
}

/** A bolt of lightning: a glowing, jagged, double pointed plate on a short gold grip. */
function lightningBolt(kit, pal, s, { color = null } = {}) {
  const edge = color || pal.glow;
  const core = mixC(edge, '#fff2b0', 0.7);
  const glow = edge;
  const metal = pal.accentMetal;
  grip(kit, -0.12 * s, 0.1 * s, 0.021 * s, pal.leather, 3);
  kit.loft(along([[0.09, 0.027], [0.115, 0.034], [0.14, 0.027]], s), { ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: null, color: metal, mat: 'metal' });
  kit.loft(along([[-0.12, 0.024], [-0.15, 0.02]], s), { ref: [1, 0, 0], sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: metal, mat: 'metal' });
  // the classic zigzag: a long bolt, a shorter broken spark beside it
  const bolt = [[0.62, 1.0], [0.18, 0.46], [0.44, 0.46], [0.3, 0.0], [0.86, 0.6], [0.58, 0.6], [0.8, 1.0]].map(([x, y]) => [(x - 0.55) * 0.32 * s, 0.17 * s + y * 0.66 * s]);
  kit.slab(bolt, {
    depth: 0.034 * s, bevel: 0.012 * s, color: glow, mat: 'gem', glow: 0.8,
    paint: (o, x, y, z) => {
      // a hot yellow-white face, the color of the bolt along the bevelled rim
      const k = sstep(0.4, 1, Math.abs(z) / (0.017 * s));
      o.r = lerp(edge.r, core.r, k);
      o.g = lerp(edge.g, core.g, k);
      o.b = lerp(edge.b, core.b, k);
      o.glow = 0.45 + 0.4 * k;
    },
  });
}

/** A scepter: a gold rod with a jeweled head held in two horns. */
function scepter(kit, pal, s, { gem = null } = {}) {
  const metal = pal.accentMetal;
  const dark = shadeC(pal.darkMetal, 1.15);
  const jewel = gem || tintC(pal.glow, 0.22);
  kit.loft(along([[-0.22, 0.015], [0.0, 0.0175], [0.4, 0.0165], [0.62, 0.0155]], s), {
    ref: [1, 0, 0], rings: 8, sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: shadeC(metal, 0.9), mat: 'metal',
  });
  grip(kit, -0.08 * s, 0.1 * s, 0.021 * s, pal.leather, 4);
  for (const y of [0.28, 0.6]) {
    kit.loft(along([[y - 0.022, 0.0175], [y, 0.026], [y + 0.022, 0.0175]], s), { ref: [1, 0, 0], rings: 4, sides: 10, start: null, end: null, color: metal, mat: 'gold' });
  }
  kit.loft(along([[0.7, 0.026], [0.745, 0.046], [0.8, 0.05], [0.855, 0.04], [0.89, 0.016]], s), {
    ref: [1, 0, 0], rings: 8, sides: 12, start: 'round', end: 'round', capDepth: 0.014 * s, color: jewel, mat: 'gem', glow: 0.85,
    paint: (o, x, y, z, u) => mul(o, 0.86 + 0.3 * Math.sin(u * PI)),
  });
  // two horns of dark metal curling up around the stone
  for (const side of [1, -1]) {
    const pts = [[0.012, 0.64], [0.05, 0.68], [0.082, 0.76], [0.08, 0.86], [0.052, 0.95], [0.02, 0.99]];
    kit.loft(pts.map(([x, y], i) => ps(side * x * s, y * s, 0, (0.011 - i * 0.0012) * s)), {
      ref: [0, 0, 1], rings: 9, sides: 6, start: 'round', end: 'round', capDepth: [0.008 * s, 0.003 * s], color: dark, mat: 'iron',
    });
  }
}

/** A scythe: a long ash shaft and a great curved blade set on a socket, edge toward +X. */
function scythe(kit, pal, s, { shaftColor = null } = {}) {
  const shaft = shaftColor || pal.wood;
  const steel = mixC(pal.accentMetal, '#cfd6dc', 0.35);
  kit.loft(along([[-0.4, 0.0165], [-0.1, 0.0195], [0.5, 0.0185], [1.02, 0.017]], s), {
    ref: [1, 0, 0], rings: 10, sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: shaft, mat: 'wood', paint: grain(0.09),
  });
  grip(kit, -0.1 * s, 0.1 * s, 0.0235 * s, pal.leather, 5);
  // a second hand grip further up (the snath's peg), and the socket collar
  kit.loft([ps(0.012 * s, 0.38 * s, 0, 0.013 * s), ps(0.075 * s, 0.4 * s, 0, 0.01 * s)], { ref: [0, 0, 1], sides: 6, start: 'round', end: 'round', capDepth: 0.008 * s, color: shaft, mat: 'wood' });
  kit.loft(along([[0.98, 0.021], [1.03, 0.03], [1.09, 0.021]], s), { ref: [1, 0, 0], rings: 5, sides: 10, start: null, end: null, color: shadeC(pal.accentMetal, 0.7), mat: 'iron' });
  // the blade: a long crescent, thick at the heel, drawn out to a point; the cutting edge on the inside curve
  const outer = [[0.0, 1.2], [0.1, 1.285], [0.26, 1.33], [0.43, 1.31], [0.58, 1.23], [0.68, 1.12], [0.73, 1.0]];
  const inner = [[0.64, 1.15], [0.52, 1.215], [0.38, 1.24], [0.22, 1.235], [0.1, 1.2], [0.0, 1.13]];
  kit.slab([...outer, ...inner].map(([x, y]) => [x * s, y * s]), {
    depth: 0.02 * s, bevel: 0.007 * s, color: steel, mat: 'metal',
    paint: (o, x, y, z, u, a) => {
      // the cutting edge (inner curve) is brighter, the back darker
      mul(o, 0.84 + 0.3 * sstep(0.2, 1, 1 - a));
    },
  });
  // a rib along the back of the blade
  kit.loft([ps(0.04 * s, 1.215 * s, 0, 0.013 * s), ps(0.26 * s, 1.318 * s, 0, 0.011 * s), ps(0.52 * s, 1.265 * s, 0, 0.009 * s)], {
    ref: [0, 0, 1], rings: 6, sides: 6, start: 'round', end: 'round', capDepth: 0.006 * s, color: shadeC(steel, 0.7), mat: 'iron',
  });
}

/** A conch: a spiral shell, wide at the lip and drawn out to a point, ridged along its whorls, held mouth down. */
function conch(kit, pal, s0) {
  const s = s0 * 0.8;
  const body = mixC(pal.white, '#f4e4d4', 0.5);
  const lip = mixC(pal.white, '#f0a898', 0.55);
  const at = (y, rx, rz = rx) => ps(-(y - 0.03) * 0.3 * s, y * s, 0, rx * s, rz * s);
  kit.loft([at(0.03, 0.058, 0.05), at(0.09, 0.063, 0.057), at(0.15, 0.049, 0.045), at(0.2, 0.031, 0.029), at(0.245, 0.014, 0.013), at(0.28, 0.002)], {
    ref: [1, 0, 0], rings: 12, sides: 14, start: null, end: 'round', capDepth: 0.02 * s, color: body, mat: 'bone',
    warp: (p, a, u) => {
      const k = 0.006 * s * Math.sin(a * 2 - u * 17);
      p[0] += Math.cos(a) * k;
      p[2] += Math.sin(a) * k;
    },
    paint: (o, x, y, z, u, a) => mul(o, 0.88 + 0.16 * Math.sin(a * TAU * 2 - u * 17 + 1.2)),
  });
  // the flared lip, pink inside, rolled over at the edge
  kit.loft([at(0.04, 0.056, 0.048), at(0.005, 0.07, 0.064), at(-0.02, 0.079, 0.07), at(-0.034, 0.072, 0.063)], {
    ref: [1, 0, 0], rings: 6, sides: 14, start: null, end: 'round', capDepth: 0.01 * s, color: lip, mat: 'bone',
    paint: (o, x, y, z, u) => mul(o, 1.04 - 0.14 * u),
  });
}

/** An ankh: a gold cross topped by a loop, held by the foot of its shaft (a wrapped grip); also an offhand emblem. */
function ankh(kit, pal, s, { color = null } = {}) {
  const gold = color || pal.accentMetal;
  grip(kit, -0.085 * s, 0.075 * s, 0.0195 * s, pal.leather, 4);
  kit.loft(along([[-0.125, 0.021], [-0.1, 0.0195], [0.0, 0.0155], [0.15, 0.0145], [0.3, 0.0145]], s), {
    ref: [1, 0, 0], rings: 8, sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: gold, mat: 'gold', glow: 0.1,
  });
  // the arms: a bar across the top of the shaft, its ends flaring a little
  const by = 0.292;
  kit.loft([
    ps(-0.118 * s, by * s, 0, 0.0155 * s, 0.0125 * s), ps(-0.06 * s, by * s, 0, 0.0125 * s, 0.0115 * s),
    ps(0, by * s, 0, 0.0145 * s, 0.0125 * s), ps(0.06 * s, by * s, 0, 0.0125 * s, 0.0115 * s), ps(0.118 * s, by * s, 0, 0.0155 * s, 0.0125 * s),
  ], { ref: [0, 1, 0], rings: 8, sides: 8, start: 'round', end: 'round', capDepth: 0.01 * s, color: gold, mat: 'gold', glow: 0.1 });
  // the loop: an oval ring rising from the crossing, open at its foot where the shaft meets it
  const n = 22;
  const loop = [];
  for (let i = 0; i < n; i++) {
    const t = -PI / 2 + 0.3 + (i / (n - 1)) * (TAU - 0.6);
    loop.push(ps(Math.cos(t) * 0.056 * s, (0.398 + Math.sin(t) * 0.088) * s, 0, 0.0128 * s, 0.0118 * s));
  }
  kit.loft(loop, { ref: [0, 0, 1], sides: 8, start: 'round', end: 'round', capDepth: 0.009 * s, color: gold, mat: 'gold', glow: 0.1 });
}

/** A gada: a long rod ending in a great ribbed ball with a spike on top, in the unit's gold (Hanuman's, the royal champions'). */
function mace(kit, pal, s, { color = null } = {}) {
  const metal = color || pal.accentMetal;
  kit.loft(along([[-0.2, 0.017], [-0.1, 0.0205], [0.3, 0.0185], [0.58, 0.0175]], s), {
    ref: [1, 0, 0], rings: 5, sides: 7, start: 'round', end: null, capRings: 2, capDepth: 0.008 * s, color: shadeC(metal, 0.78), mat: 'metal',
  });
  grip(kit, -0.1 * s, 0.12 * s, 0.0235 * s, pal.leather, 5);
  // the foot: a flared knob; a collar under the ball
  kit.loft(along([[-0.185, 0.02], [-0.215, 0.032], [-0.255, 0.021]], s), { ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: 'round', capRings: 2, capDepth: 0.014 * s, color: metal, mat: 'gold' });
  kit.loft(along([[0.5, 0.0185], [0.545, 0.034], [0.6, 0.0235]], s), { ref: [1, 0, 0], rings: 4, sides: 10, start: null, end: null, color: metal, mat: 'gold' });
  // the ball: ribbed, brightest at its belly
  kit.loft(along([[0.58, 0.022], [0.615, 0.05], [0.675, 0.075], [0.74, 0.082], [0.8, 0.072], [0.855, 0.048], [0.885, 0.02]], s), {
    ref: [1, 0, 0], rings: 10, sides: 14, start: null, end: 'round', capRings: 2, capDepth: 0.012 * s, color: metal, mat: 'gold',
    warp: (p, a, u) => {
      const k = 0.007 * s * Math.sin(a * 7) * Math.sin(u * PI);
      p[0] += Math.cos(a) * k;
      p[2] += Math.sin(a) * k;
    },
    paint: (o, x, y, z, u, a) => mul(o, 0.82 + 0.26 * Math.sin(u * PI) + 0.08 * Math.sin(a * 7)),
  });
  kit.loft(along([[0.87, 0.028], [0.935, 0.016], [1.03, 0.002]], s), {
    ref: [1, 0, 0], rings: 4, sides: 6, start: null, end: 'round', capRings: 2, capDepth: 0.01 * s, color: shadeC(metal, 0.9), mat: 'gold',
  });
}

/** A chakra: a disk standing in the forward-and-up plane on a short rod, a hub with spokes, a glowing inner ring and an outer rim set with slanting teeth (Vishnu's Sudarshana). */
function discus(kit, pal, s) {
  const metal = pal.accentMetal;
  const edge = mixC(metal, '#f6f2e2', 0.4);
  const R = 0.128 * s;
  const cy = 0.19 * s;
  grip(kit, -0.07 * s, 0.07 * s, 0.021 * s, pal.leather, 3);
  kit.loft(along([[0.06, 0.016], [0.11, 0.014], [0.2, 0.0125]], s), { ref: [1, 0, 0], rings: 3, sides: 6, start: null, end: null, color: metal, mat: 'gold' });
  // the hub, a boss through the disk, and the spokes out to the inner ring
  kit.loft([ps(0, cy, -0.026 * s, 0.032 * s), ps(0, cy, 0, 0.04 * s), ps(0, cy, 0.026 * s, 0.032 * s)], { ref: [1, 0, 0], rings: 3, sides: 10, start: 'round', end: 'round', capRings: 1, capDepth: 0.012 * s, color: metal, mat: 'gold' });
  const n = 24;
  const ring = (r, d, w, color, opts = {}) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * TAU;
      pts.push(ps(Math.cos(t) * r, cy + Math.sin(t) * r, 0, d, w));
    }
    kit.loft(pts, { ref: [0, 0, 1], sides: 6, start: null, end: null, color, ...opts });
  };
  ring(R, 0.011 * s, 0.02 * s, metal, { mat: 'gold', glow: 0.1 });
  ring(R * 0.62, 0.008 * s, 0.011 * s, tintC(pal.glow, 0.3), { mat: 'gem', glow: 0.9 });
  const spokes = 6;
  for (let i = 0; i < spokes; i++) {
    const t = (i / spokes) * TAU + 0.2;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    kit.loft([ps(c * R * 0.08, cy + sn * R * 0.08, 0, 0.007 * s, 0.009 * s), ps(c * R * 0.62, cy + sn * R * 0.62, 0, 0.006 * s, 0.0085 * s)],
      { ref: [0, 0, 1], sides: 4, start: null, end: null, color: metal, mat: 'gold' });
  }
  // the teeth of the rim lean the way the disk spins
  const teeth = 14;
  for (let i = 0; i < teeth; i++) {
    const t = (i / teeth) * TAU;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const tx = -sn;
    const ty = c;
    const at = (r, lean) => [c * r + tx * lean, cy + sn * r + ty * lean];
    const [x0, y0] = at(R * 0.96, 0);
    const [x1, y1] = at(R + 0.026 * s, 0.01 * s);
    const [x2, y2] = at(R + 0.058 * s, 0.026 * s);
    kit.loft([ps(x0, y0, 0, 0.0075 * s, 0.017 * s), ps(x1, y1, 0, 0.006 * s, 0.011 * s), ps(x2, y2, 0, 0.0015 * s, 0.0015 * s)],
      { ref: [0, 0, 1], rings: 3, sides: 4, start: null, end: 'round', capRings: 1, capDepth: 0.004 * s, color: edge, mat: 'metal' });
  }
}

/** A damaru: an hourglass drum with a skin over each end, held at its waist, a pair of cords with beads hanging from it (Shiva's). Its axis runs across the grip. */
function drum(kit, pal, s) {
  const wood = mixC(pal.wood, '#5a3416', 0.35);
  const metal = pal.accentMetal;
  const skin = mixC(pal.white, '#e2c690', 0.55);
  const y0 = 0.035 * s;
  const at = (z, r) => ps(0, y0, z * s, r * s, r * s);
  const body = [[-0.108, 0.062], [-0.095, 0.067], [-0.072, 0.05], [-0.038, 0.027], [0, 0.0185], [0.038, 0.027], [0.072, 0.05], [0.095, 0.067], [0.108, 0.062]];
  kit.loft(body.map(([z, r]) => at(z, r)), { ref: [1, 0, 0], rings: 9, sides: 10, start: null, end: null, color: wood, mat: 'wood', paint: (o, x, y, z, u) => mul(o, 0.86 + 0.2 * Math.sin(u * PI)) });
  for (const sg of [1, -1]) {
    // the skin: a shallow dome over the end, a gold hoop round its edge
    kit.loft([at(sg * 0.1, 0.064), at(sg * 0.108, 0.066), at(sg * 0.114, 0.0)], { ref: [1, 0, 0], rings: 3, sides: 10, start: null, end: 'round', capRings: 1, capDepth: 0.006 * s, color: skin, mat: 'cloth' });
    kit.loft([at(sg * 0.094, 0.068), at(sg * 0.108, 0.07)], { ref: [1, 0, 0], sides: 10, start: null, end: null, color: metal, mat: 'gold' });
    // a cord from the waist with a bead on its end
    const cord = [[0.0, 0.0], [sg * 0.012, -0.05], [sg * 0.03, -0.1]].map(([z, d]) => ps(0.004 * s, y0 - 0.016 * s + d * s, z * s, 0.0036 * s));
    kit.loft(cord, { ref: [1, 0, 0], rings: 3, sides: 4, start: 'round', end: null, capRings: 1, capDepth: 0.003 * s, color: pal.secondary, mat: 'cloth' });
    kit.loft([ps(0.004 * s, y0 - 0.1 * s, sg * 0.03 * s, 0.012 * s), ps(0.004 * s, y0 - 0.12 * s, sg * 0.033 * s, 0.012 * s)],
      { ref: [1, 0, 0], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.01 * s, color: metal, mat: 'gold' });
  }
  // the hand's waistband
  kit.loft([at(-0.014, 0.0235), at(0.014, 0.0235)], { ref: [1, 0, 0], sides: 8, start: null, end: null, color: pal.leather, mat: 'leather' });
}

/** A lotus bloom on a short stem: two rings of pink petals paling toward their tips round a gold heart. */
function lotus(kit, pal, s) {
  const green = mixC('#4f8a48', pal.secondary, 0.1);
  const pink = '#ee93bc';
  kit.loft(along([[-0.1, 0.012], [0.0, 0.0105], [0.12, 0.009]], s), { ref: [1, 0, 0], rings: 3, sides: 5, start: 'round', end: null, capRings: 1, capDepth: 0.006 * s, color: green, mat: 'cloth' });
  kit.loft(along([[0.11, 0.01], [0.135, 0.03], [0.165, 0.022]], s), { ref: [1, 0, 0], rings: 3, sides: 8, start: null, end: 'round', capRings: 1, capDepth: 0.008 * s, color: shadeC(green, 1.1), mat: 'cloth' });
  const layers = [
    { n: 8, tilt: 1.0, len: 0.1, w: 0.032, y: 0.135, turn: 0 },
    { n: 6, tilt: 0.5, len: 0.092, w: 0.027, y: 0.15, turn: 0.52 },
  ];
  for (const L of layers) {
    for (let i = 0; i < L.n; i++) {
      const a = (i / L.n) * TAU + L.turn;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const st = [0, 0.3, 0.65, 1].map((t, k) => {
        const out = 0.014 + Math.sin(L.tilt * (0.3 + 0.8 * t)) * L.len * t * 1.05;
        const up = L.y + Math.cos(L.tilt * (0.3 + 0.8 * t)) * L.len * t;
        return ps(c * out * s, up * s, sn * out * s, [0.2, 0.95, 0.8, 0.1][k] * L.w * s, 0.0045 * s);
      });
      kit.loft(st, {
        ref: [-sn, 0, c], rings: 4, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.006 * s, color: pink, mat: 'cloth',
        paint: (o, x, y, z, u) => tint(o, { r: 1, g: 0.93, b: 0.95 }, 0.5 * u * u),
      });
    }
  }
  kit.loft([ps(0, 0.15 * s, 0, 0.016 * s), ps(0, 0.178 * s, 0, 0.013 * s)], { ref: [1, 0, 0], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.01 * s, color: pal.accentMetal, mat: 'gold', glow: 0.2 });
}

/** A flame floating over the palm: a glowing teardrop, hot at its heart. */
function flame(kit, pal, s) {
  const outer = mixC(pal.fire, pal.glow, 0.3);
  kit.loft(along([[0.03, 0.012], [0.075, 0.04], [0.13, 0.037], [0.19, 0.019], [0.25, 0.004]], s), {
    ref: [1, 0, 0], rings: 6, sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: [0.01 * s, 0.02 * s], color: outer, mat: 'gem', glow: 0.95,
    paint: (o, x, y, z, u) => {
      const k = u < 0.5 ? 0.6 : 1 - u;
      o.r = lerp(outer.r, pal.fireHot.r, k);
      o.g = lerp(outer.g, pal.fireHot.g, k);
      o.b = lerp(outer.b, pal.fireHot.b, k);
    },
  });
}

/** The weapons built here, by the visual's weapon id. */
const ARMS = { trident, lightning_bolt: lightningBolt, scepter, scythe, ankh: (kit, pal, s, opts) => ankh(kit, pal, s * 0.82, opts), mace, discus };
export const RICH_ARMS = new Set(Object.keys(ARMS));

/** The offhand items built here, by the visual's offhand id (lotus and flame are only carried by the extra hands of many-armed gods). */
const OFFHANDS = { shell: conch, ankh: (kit, pal, s, opts) => ankh(kit, pal, s * 0.7, opts), drum, lotus, flame };
export const RICH_OFFHANDS = new Set(Object.keys(OFFHANDS));

/** Add weapon or offhand item `id` (one of RICH_ARMS, RICH_OFFHANDS) to `kit` in the grip frame; opts as for richWeapon. Returns whether it was built. */
export function richArm(kit, pal, id, s, opts = {}) {
  const make = ARMS[id] || OFFHANDS[id];
  if (!make) return false;
  make(kit, pal, s, opts);
  return true;
}

void TAU;
