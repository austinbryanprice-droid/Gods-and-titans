// The Japanese look: the kosode crossed at the breast and tied with an obi, the wide hakama, tabi
// and straw sandals for the people; the lacquered do-maru with its laced rows, the kabuto with its
// gold kuwagata and the broad sode for the soldiers and the samurai; the priest in white and
// vermilion under his tall black eboshi. The gods dress as the shrines show them (Amaterasu in layered
// white robes under a corona of rays, Susanoo in blue-laced armor with a banner at his back, Raijin
// bare-chested in a tiger skin among his ring of drums, Inari in white and vermilion), the Tengu
// as a yamabushi on his single tall geta, the Oni in a tiger skin with his studded kanabo. Overrides
// only the layers where the Japanese dress differently from the default (rich-outfit-default.js).
import * as THREE from 'three';
import { TEAM, shadeC, mixC, tintC, withMat } from './unit-geo.js';
import { vs, ps } from './rich-kit.js';
import { torsoStations, torsoRing, armStations, legStations, legFrom, legRing, ringAt, addSandals, addGeta, addBareLegs } from './rich-body.js';
import {
  addTunic, addCape, addPteruges, addGreaves, addKosodeCollar, addObi, addHakama, addDoMaru, addSode, addKote, addDhoti, addLongSkirt, addWaistBelt, addGarland,
} from './rich-clothing.js';
import {
  addHairCap, addLongHair, addBeard, addTiara, addHornPair, addSunDisk, addChonmage, addJingasa, addKabuto, addEboshi, addTokin, addHeadband, addHairSpikes,
} from './rich-headgear.js';
import { addJewelry, addAuraRing, addSashimono } from './rich-regalia.js';
import { BEAST_HEADS } from './rich-heads.js';
import { gradY, mul, hash, lerp } from './rich-paint.js';
import { DEFAULT } from './rich-outfit-default.js';

const GOLD = withMat('#dfb54a', 'gold');
const BLACK = withMat('#24222a', 'lacquer');
const STRAW = withMat('#c9a35c', 'cloth');
const COTTON = '#e9e2d0';
const JADE = withMat('#5fbf9a', 'gem');
const AMBER = withMat('#e0a23a', 'gem');

const BLACK_HAIR = new THREE.Color('#1b1618');

/** The people have black hair (the shared palette's brown is not theirs). */
export function palette(pal, ctx) {
  return ctx.mortal ? { ...pal, hair: BLACK_HAIR } : pal;
}

/** A team-safe shade of a color. */
const shade = (c, k) => (c && c.team ? TEAM(c.team * k, c.mat) : shadeC(c, k));

/** Who wears what: the people by their work, the rest by name. */
const NAMED = {
  japanese_amaterasu: 'amaterasu',
  japanese_susanoo: 'susanoo',
  japanese_raijin: 'raijin',
  japanese_inari: 'inari',
  japanese_tengu: 'tengu',
  japanese_oni: 'oni',
  japanese_samurai: 'samurai',
};

/** The dress of a unit: peasant (worshipper), ashigaru (warrior), archer, priest, samurai, or a god's or creature's own. */
function dressOf(E) {
  const named = NAMED[E.ctx.unit.id];
  if (named) return named;
  if (E.worker) return 'peasant';
  if (E.ctx.cls === 'support') return 'priest';
  return E.armor ? 'ashigaru' : 'archer';
}

/** Dresses that go bare to the waist. */
const BARE = new Set(['raijin', 'oni']);

/** A little ball (a pompom). */
function pom(kit, p, r, opts) {
  kit.loft([ps(p[0] - r * 0.1, p[1], p[2], r), ps(p[0] + r * 0.1, p[1], p[2], r)], { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: r, ...opts });
}

/** Skin torso (a bare chest). */
function bareTorso(E) {
  const { kit, D, bind, skin, skinPaint } = E;
  kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
}

// ---------------------------------------------------------------------------
// legs: trousers and wraps, the hakama's hem, straw sandals, geta, bare feet
// ---------------------------------------------------------------------------

/** Tight trousers (momohiki) from the ankle to the hip. */
function trousers(E, color) {
  const { kit, D, bind } = E;
  for (const side of [1, -1]) {
    kit.loft(legFrom(D, side, 0.011, D.ankleY - 0.012), { rings: 7, start: null, end: null, color, mat: 'cloth', bind: bind.leg[side], paint: gradY(0.2, D.hipY, 0.85, 1) });
  }
}

/** Leg wraps (kyahan): a snug gaiter from the ankle to below the knee, ridged where the cloth is wound, tied at the top. */
function kyahan(E, color) {
  const { kit, D, bind } = E;
  const knee = D.hipY - D.thigh;
  const y0 = D.ankleY + 0.012;
  const y1 = knee - 0.04;
  for (const side of [1, -1]) {
    const st = legStations(D, side, 0.011);
    const rings = [];
    for (let i = 0; i <= 14; i++) rings.push(ringAt(st, lerp(y0, y1, i / 14), 0.006));
    kit.loft(rings, { sides: 12, start: null, end: null, color, mat: 'cloth', bind: bind.leg[side], paint: (o, x, y) => mul(o, 0.84 + 0.18 * Math.abs(Math.cos((y - y0) * 130))) });
    kit.loft([ringAt(st, y1 - 0.012, 0.01), ringAt(st, y1 + 0.004, 0.01)], { sides: 12, start: null, end: null, color: shade(color, 0.7), mat: 'cloth', bind: bind.leg[side] });
  }
}

/** The leg below a long hem: skin from under the ankle to `top`. */
function ankles(E, top) {
  const { kit, D, bind, skin, skinPaint } = E;
  const r = D.legR;
  for (const side of [1, -1]) {
    const st = legStations(D, side).filter((q) => q.c[1] <= top);
    kit.loft([vs(D.ankleY - 0.03, r * 0.62, r * 0.58, 0, side * D.hipZ), ...st], { rings: 4, start: null, end: null, color: skin, bind: bind.leg[side], paint: skinPaint });
  }
}

/** Feet: straw sandals over a tabi, or bare. */
function feet(E, kind) {
  const { kit, D, pal, bind, skin, skinPaint } = E;
  if (kind === 'bare') addSandals(kit, D, pal, bind, { skin, skinPaint, sole: skin, strap: skin });
  else if (kind === 'zori') addSandals(kit, D, pal, bind, { skin: COTTON, sole: BLACK, strap: pal.secondary });
  else addSandals(kit, D, pal, bind, { skin: COTTON, sole: shade(STRAW, 0.8), strap: STRAW });
}

/** A fur cuff (a ring of shaggy hair) round a limb, from station `a` (the top) to `b`. */
function furCuff(kit, a, b, color, bd, seed) {
  kit.loft([a, b], {
    sides: 14, start: null, end: null, color, mat: 'fur', bind: bd,
    warp: (p, ang, u) => { const n = hash(Math.round(ang * 14), seed, 3); p[1] -= 0.008 * (1 - u) * (0.5 + n); },
    paint: (o, x, y, z, u) => mul(o, 0.82 + 0.26 * u),
  });
}

export function legs(E) {
  const { kit, D, pal, bind, skin, skinPaint } = E;
  const dress = dressOf(E);
  switch (dress) {
    case 'peasant':
      trousers(E, tintC(pal.primary, 0.08));
      kyahan(E, shade(pal.secondary, 1.15));
      feet(E, 'waraji');
      break;
    case 'ashigaru':
      trousers(E, shade(pal.secondary, 0.8));
      kyahan(E, COTTON);
      feet(E, 'waraji');
      break;
    case 'archer':
      trousers(E, shade(pal.primary, 0.9));
      kyahan(E, COTTON);
      feet(E, 'waraji');
      break;
    case 'susanoo':
      trousers(E, shade(pal.primary, 0.8));
      addGreaves(kit, D, pal, bind, BLACK, GOLD);
      feet(E, 'waraji');
      break;
    case 'raijin':
    case 'oni': {
      addBareLegs(kit, D, bind, skin, skinPaint);
      feet(E, 'bare');
      // a fur cuff above each ankle, iron or gold rings below the knee
      for (const side of [1, -1]) {
        furCuff(kit, legRing(D, side, D.ankleY + 0.075, 0.02), legRing(D, side, D.ankleY + 0.015, 0.014), dress === 'raijin' ? pal.fur : shade(pal.accent, 0.7), bind.leg[side], side + 5);
      }
      break;
    }
    case 'tengu':
      ankles(E, D.ankleY + 0.12);
      addGeta(kit, D, pal, bind, { skin, skinPaint, strap: TEAM(0.9), wood: withMat('#6a4a2c', 'wood'), tooth: 0.13, ippon: true });
      break;
    default: {
      // the robed (priest, samurai, Amaterasu, Inari): the leg shows only below the hem
      ankles(E, D.ankleY + 0.1);
      feet(E, dress === 'samurai' ? 'waraji' : 'zori');
    }
  }
}

// ---------------------------------------------------------------------------
// torso
// ---------------------------------------------------------------------------

/** The tiger's skin: a band of gold hide striped in black (the cloth's `mark`). */
const tiger = (E) => mixC(E.pal.primary, '#e0a23a', 0.4);
const stripes = (o, x, y, z) => {
  const s = Math.sin(z * 31 + y * 24 + Math.sin(x * 26) * 1.1 + Math.sin(y * 52) * 0.35);
  if (s > 0.42) mul(o, 0.22);
};

function peasant(E) {
  // a short kosode in the team's color, crossed at the breast in cotton, an obi of dark cloth with its cord
  const { kit, D, pal, bind, tunicColor } = E;
  addTunic(kit, D, tunicColor, bind, 0.12);
  addKosodeCollar(kit, D, bind, { color: COTTON, inner: shade(COTTON, 0.86) });
  addObi(kit, D, bind, { color: shade(pal.secondary, 1.1), cord: pal.accent, wide: 0.9 });
}

function ashigaru(E) {
  // the foot soldier: a kosode in the team's color, a dark obi, the do-maru over them (armorLayer)
  const { kit, D, pal, bind, tunicColor } = E;
  addTunic(kit, D, tunicColor, bind, 0.12);
  addKosodeCollar(kit, D, bind, { color: COTTON, inner: shade(COTTON, 0.86), width: 0.04 });
  addObi(kit, D, bind, { color: shade(pal.secondary, 0.85), knot: null, wide: 0.7 });
}

function archer(E) {
  // the archer: a long indigo jacket tied with a vermilion obi, the collar crossed in cotton
  const { kit, D, pal, bind } = E;
  addTunic(kit, D, shade(pal.primary, 1.05), bind, 0.15);
  addKosodeCollar(kit, D, bind, { color: COTTON, inner: shade(pal.secondary, 1.0) });
  addObi(kit, D, bind, { color: pal.secondary, cord: pal.accent, wide: 0.85 });
}

function priest(E) {
  // the priest: a white kosode, vermilion hakama, the obi and a stole in the team's color
  const { kit, D, pal, bind } = E;
  addTunic(kit, D, pal.primary, bind, 0.1);
  addHakama(kit, D, bind, { color: pal.secondary, trim: GOLD, len: 1, flare: 1.05, top: 0.32 });
  addKosodeCollar(kit, D, bind, { color: pal.primary, inner: shade(pal.primary, 0.82) });
  addObi(kit, D, bind, { color: TEAM(0.95), cord: GOLD, knot: null, wide: 0.75 });
}

function samurai(E) {
  // the samurai: a kosode in the team's color, hakama of dark indigo, an obi; the do-maru and sode come over them
  const { kit, D, pal, bind, tunicColor } = E;
  addTunic(kit, D, tunicColor, bind, 0.1);
  addHakama(kit, D, bind, { color: shade(pal.secondary, 0.82), trim: GOLD, len: 1, flare: 1.0, top: 0.3 });
  addKosodeCollar(kit, D, bind, { color: COTTON, inner: shade(COTTON, 0.86), width: 0.04 });
  addObi(kit, D, bind, { color: shade(pal.secondary, 0.7), cord: GOLD, knot: null, wide: 0.7 });
}

function amaterasu(E) {
  // Amaterasu: a long white robe over layers of cream and vermilion collars, a wide obi in the team's color, a hem of vermilion
  const { kit, D, pal, bind } = E;
  addTunic(kit, D, pal.primary, bind, 0.08);
  const sk = addLongSkirt(kit, D, bind, pal.primary, { pleat: 0.012, top: 0.03 });
  kit.loft([vs(sk.y0 - 0.002, sk.rx + 0.004, sk.rz + 0.004), vs(sk.y0 + 0.07, sk.rx - 0.004, sk.rz - 0.004)], { sides: 36, start: null, end: null, color: pal.secondary, mat: 'trim', bind: bind.skirt });
  kit.loft([vs(sk.y0 + 0.085, sk.rx - 0.006, sk.rz - 0.006), vs(sk.y0 + 0.1, sk.rx - 0.01, sk.rz - 0.01)], { sides: 36, start: null, end: null, color: GOLD, mat: 'gold', bind: bind.skirt });
  addKosodeCollar(kit, D, bind, { color: pal.primary, inner: pal.secondary, width: 0.07 });
  addObi(kit, D, bind, { color: TEAM(0.95), cord: GOLD, knot: 'back', wide: 1.1 });
}

function inari(E) {
  // Inari: a white kosode with a vermilion collar, hakama of vermilion, a gold obi tied at the back
  const { kit, D, pal, bind } = E;
  addTunic(kit, D, pal.secondary, bind, 0.1);
  addHakama(kit, D, bind, { color: pal.primary, trim: GOLD, len: 1, flare: 1.1, top: 0.32 });
  addKosodeCollar(kit, D, bind, { color: pal.secondary, inner: shade(pal.secondary, 0.82), width: 0.06 });
  addObi(kit, D, bind, { color: pal.accentMetal, cord: pal.secondary, knot: 'back', wide: 0.9 });
}

function susanoo(E) {
  // Susanoo: a blue kosode and hakama-trousers under the o-yoroi, a wide obi in the team's color
  const { kit, D, pal, bind } = E;
  addTunic(kit, D, pal.primary, bind, 0.12);
  addKosodeCollar(kit, D, bind, { color: COTTON, inner: shade(COTTON, 0.86), width: 0.045 });
  addObi(kit, D, bind, { color: TEAM(0.9), cord: GOLD, knot: null, wide: 0.8 });
}

function raijin(E) {
  // Raijin: a bare chest, a tiger's skin tied round the loins with a rope, a scarf hanging from the hip
  const { kit, D, pal, bind } = E;
  bareTorso(E);
  addDhoti(kit, D, bind, { color: tiger(E), border: shade(tiger(E), 0.5), sash: TEAM(0.95), len: 0.32, loose: 0.9, fan: shade(tiger(E), 0.92), mark: stripes });
  addWaistBelt(kit, D, bind, TEAM(0.9), pal.accentMetal);
}

function oni(E) {
  // the Oni: a bare chest, a tiger-skin loincloth with a belt in the team's color
  const { kit, D, pal, bind } = E;
  bareTorso(E);
  addDhoti(kit, D, bind, { color: tiger(E), border: shade(tiger(E), 0.5), len: 0.3, loose: 0.8, fan: shade(tiger(E), 0.92), mark: stripes });
  addWaistBelt(kit, D, bind, TEAM(0.85), pal.accent);
}

function tengu(E) {
  // the Tengu (a yamabushi): a cream kosode and kobakama, a dark suzukake over the chest hung with pompoms, a rope at the waist
  const { kit, D, pal, bind } = E;
  addTunic(kit, D, pal.primary, bind, 0.1);
  addHakama(kit, D, bind, { color: shade(pal.primary, 0.95), trim: pal.secondary, len: 0.78, flare: 0.8, top: 0.28 });
  // the suzukake: a sleeveless jacket in the dark cloth, shorter than the kosode, open at the neck
  kit.loft(torsoStations(D, 0.03, 0.06), { rings: 9, start: null, end: 'round', capDepth: 0.01, color: pal.secondary, mat: 'cloth', bind: bind.torso, paint: gradY(D.hipY, D.shoulderY, 0.84, 1) });
  addKosodeCollar(kit, D, bind, { color: pal.secondary, inner: shade(pal.secondary, 0.7), width: 0.055 });
  addObi(kit, D, bind, { color: shade(STRAW, 0.8), cord: TEAM(0.9), knot: null, wide: 0.5 });
  // the bonten: three pompoms down each side of the breast on their cords
  for (const side of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const r = torsoRing(D, 0.88 - i * 0.16, 0.048);
      const th = 0.5 + i * 0.03;
      pom(kit, [r.dx + r.rx * Math.cos(th), r.y, side * r.rz * Math.sin(th)], 0.021 * D.k, { color: i === 1 ? pal.accent : shade(pal.accent, 0.9), mat: 'cloth', bind: bind.torso });
    }
  }
}

export function torso(E) {
  switch (dressOf(E)) {
    case 'peasant': peasant(E); break;
    case 'ashigaru': ashigaru(E); break;
    case 'archer': archer(E); break;
    case 'priest': priest(E); break;
    case 'samurai': samurai(E); break;
    case 'amaterasu': amaterasu(E); break;
    case 'inari': inari(E); break;
    case 'susanoo': susanoo(E); break;
    case 'raijin': raijin(E); break;
    case 'oni': oni(E); break;
    default: tengu(E);
  }
}

// ---------------------------------------------------------------------------
// arms
// ---------------------------------------------------------------------------

/** Wide sleeves from the shoulder to the wrist, belling out toward the hem, which hangs back a little. */
function wideSleeves(E, { color, trim = null, wide = 1, mat = 'cloth' }) {
  const { kit, D, bind } = E;
  const g = 0.012;
  const r = D.armR;
  const sh = D.shoulderY - 0.02;
  const e = sh - D.upper;
  const w = e - D.fore;
  for (const side of [1, -1]) {
    const z = side * D.shoulderZ;
    const st = [
      vs(w, r * (1.5 + 1.1 * wide) + g, r * (1.3 + 0.8 * wide) + g, -0.022 * wide, z),
      vs(w + 0.035, r * (1.3 + 0.8 * wide) + g, r * (1.2 + 0.6 * wide) + g, -0.014 * wide, z),
      vs(e - 0.01, r * (1.2 + 0.3 * wide) + g, r * (1.15 + 0.3 * wide) + g, -0.004 * wide, z),
      vs(sh - 0.04, r * 1.2 + g + 0.005, r * 1.18 + g + 0.005, 0, z),
      vs(sh + 0.008, r * 1.18 + g, r * 1.16 + g, 0, z),
    ];
    kit.loft(st, { rings: 7, sides: 16, start: null, end: 'round', capDepth: 0.014, color, mat, bind: bind.arm[side], paint: gradY(w, sh, 0.86, 1.02) });
    if (trim) {
      const a = st[0];
      kit.loft([vs(w - 0.006, a.rx + 0.004, a.rz + 0.004, a.c[0], z), vs(w + 0.026, st[1].rx + 0.003, st[1].rz + 0.003, st[1].c[0], z)], { sides: 16, start: null, end: null, color: trim, mat: 'trim', bind: bind.arm[side] });
    }
  }
}

export function arms(E) {
  const { kit, D, pal, bind, skin, skinPaint } = E;
  const dress = dressOf(E);
  const w = D.shoulderY - 0.02 - D.upper - D.fore;
  if (dress === 'priest') {
    wideSleeves(E, { color: pal.primary, trim: pal.secondary, wide: 1 });
    for (const side of [1, -1]) kit.loft(armStations(D, side).slice(0, 3), { rings: 4, start: null, end: null, color: skin, bind: bind.arm[side], paint: skinPaint });
    return;
  }
  if (dress === 'amaterasu') {
    wideSleeves(E, { color: pal.primary, trim: pal.secondary, wide: 1.35 });
    for (const side of [1, -1]) {
      kit.loft(armStations(D, side).slice(0, 3), { rings: 4, start: null, end: null, color: skin, bind: bind.arm[side], paint: skinPaint });
      for (let i = 0; i < 2; i++) {
        const y = w + 0.016 + i * 0.016;
        kit.loft([vs(y, D.armR * 0.7 + 0.009, D.armR * 0.68 + 0.009, 0.001, side * D.shoulderZ), vs(y + 0.01, D.armR * 0.72 + 0.009, D.armR * 0.7 + 0.009, 0.001, side * D.shoulderZ)],
          { sides: 12, start: null, end: null, color: pal.accentMetal, mat: 'gold', bind: bind.arm[side] });
      }
    }
    return;
  }
  if (dress === 'inari') {
    wideSleeves(E, { color: pal.secondary, trim: pal.primary, wide: 1.1 });
    for (const side of [1, -1]) kit.loft(armStations(D, side).slice(0, 3), { rings: 4, start: null, end: null, color: skin, bind: bind.arm[side], paint: skinPaint });
    return;
  }
  if (dress === 'tengu') {
    wideSleeves(E, { color: pal.primary, trim: pal.secondary, wide: 0.8 });
    for (const side of [1, -1]) kit.loft(armStations(D, side).slice(0, 3), { rings: 4, start: null, end: null, color: skin, bind: bind.arm[side], paint: skinPaint });
    return;
  }
  if (BARE.has(dress)) {
    for (const side of [1, -1]) {
      const bd = bind.arm[side];
      kit.loft(armStations(D, side), { rings: 8, start: null, end: null, color: skin, bind: bd, paint: skinPaint });
      const z = side * D.shoulderZ;
      if (dress === 'raijin') {
        // a fur cuff and a gold band on each arm
        furCuff(kit, vs(w + 0.06, D.armR * 0.82 + 0.014, D.armR * 0.8 + 0.014, 0, z), vs(w + 0.012, D.armR * 0.7 + 0.01, D.armR * 0.68 + 0.01, 0, z), pal.fur, bd, side + 9);
        const y = D.shoulderY - 0.02 - D.upper * 0.42;
        kit.loft([vs(y - 0.016, D.armR * 1.06 + 0.012, D.armR * 1.03 + 0.012, 0, z), vs(y + 0.016, D.armR * 1.07 + 0.012, D.armR * 1.04 + 0.012, 0, z)], { sides: 12, start: null, end: null, color: pal.accentMetal, mat: 'gold', bind: bd });
      } else {
        // iron cuffs at the wrists
        kit.loft([vs(w + 0.004, D.armR * 0.7 + 0.016, D.armR * 0.68 + 0.016, 0, z), vs(w + 0.06, D.armR * 0.84 + 0.018, D.armR * 0.82 + 0.018, 0.002, z)], { sides: 12, rings: 2, start: null, end: null, color: shade(pal.accent, 0.7), mat: 'iron', bind: bd });
      }
    }
    return;
  }
  DEFAULT.arms(E);
}

// ---------------------------------------------------------------------------
// armor: the do-maru and its laced plates, the sode, the kote, the kusazuri
// ---------------------------------------------------------------------------

export function armorLayer(E) {
  const { kit, D, pal, bind, armor } = E;
  if (!armor) return;
  const dress = dressOf(E);
  if (dress === 'ashigaru') {
    addDoMaru(kit, D, pal, bind, { plate: BLACK, lace: TEAM(0.95), trim: GOLD, rows: 7 });
    addPteruges(kit, D, pal, bind, { color: BLACK, edge: TEAM(0.9), strips: 14, len: 1.15, mat: 'lacquer' });
  } else if (dress === 'samurai') {
    const plate = withMat('#2d2428', 'lacquer');
    addDoMaru(kit, D, pal, bind, { plate, lace: TEAM(0.95), trim: GOLD, rows: 8 });
    addPteruges(kit, D, pal, bind, { color: plate, edge: TEAM(0.9), strips: 14, len: 1.3, mat: 'lacquer' });
    addSode(kit, D, pal, bind, { plate, lace: TEAM(0.95), trim: GOLD });
    addKote(kit, D, pal, bind, { plate, trim: GOLD });
  } else {
    // Susanoo's o-yoroi: blue-laced plates edged in silver, broad sode, kote
    const plate = withMat('#1d2230', 'lacquer');
    addDoMaru(kit, D, pal, bind, { plate, lace: pal.primary, trim: pal.accentMetal, rows: 8 });
    addPteruges(kit, D, pal, bind, { color: plate, edge: pal.primary, strips: 14, len: 1.4, mat: 'lacquer' });
    addSode(kit, D, pal, bind, { plate, lace: pal.primary, trim: pal.accentMetal, size: 1.15 });
    addKote(kit, D, pal, bind, { plate, trim: pal.accentMetal });
  }
}

// ---------------------------------------------------------------------------
// cloaks, head, extras
// ---------------------------------------------------------------------------

export function cloaks(E) {
  const { kit, D, ctx, pal, bind, ex } = E;
  if (!ex.has('cape')) return;
  // a jinbaori: a cape of the team's color down the back, edged in the second color
  addCape(kit, D, TEAM(1), ctx.grand ? pal.accentMetal : pal.secondary, shade(pal.secondary, 0.7), bind, { len: ctx.mortal ? 0.62 : 0.9, wide: ctx.mortal ? 0.9 : 1 });
}

export function head(E) {
  const { kit, D, v, pal, bind, ex } = E;
  const dress = dressOf(E);
  const beast = BEAST_HEADS.has(v.head);
  if (!beast) addHairCap(kit, D, pal, bind);
  switch (dress) {
    case 'peasant':
      addChonmage(kit, D, pal, bind, { band: pal.accent });
      addHeadband(kit, D, pal, bind, { color: TEAM(0.95) });
      break;
    case 'archer':
      addChonmage(kit, D, pal, bind, { band: pal.accent });
      addHeadband(kit, D, pal, bind, { color: pal.secondary });
      break;
    case 'ashigaru':
      addJingasa(kit, D, pal, bind, { color: BLACK, rim: GOLD, crest: TEAM(0.95) });
      break;
    case 'priest':
      addEboshi(kit, D, pal, bind, { color: BLACK, cord: pal.secondary });
      break;
    case 'samurai':
      addKabuto(kit, D, pal, bind, { steel: withMat('#3b3a44', 'iron'), trim: GOLD, lace: TEAM(0.95), horns: true });
      break;
    case 'amaterasu':
      addSunDisk(kit, D, pal, bind, { disk: withMat(mixC(pal.accent, '#fff3c0', 0.35), 'gem'), metal: pal.accentMetal, size: 1, uraeus: false, rays: 12 });
      break;
    case 'susanoo':
      addChonmage(kit, D, pal, bind, { band: pal.accentMetal, size: 1.1 });
      break;
    case 'inari':
      addTiara(kit, D, pal, bind, { metal: pal.accentMetal, gem: pal.secondary, height: 1.1 });
      break;
    case 'raijin':
      addHairSpikes(kit, D, pal, bind, { n: 9, len: 1.15 });
      addHornPair(kit, D, bind, pal.horn, 0.012 * D.hs, 1.1);
      break;
    case 'oni':
      addHairSpikes(kit, D, pal, bind, { n: 7, len: 0.9 });
      addHornPair(kit, D, bind, pal.horn, 0.014 * D.hs, 1.25);
      break;
    default:
      addTokin(kit, D, pal, bind, { color: BLACK, cord: TEAM(0.9) });
  }
  if (ex.has('long_hair') && !beast) addLongHair(kit, D, pal, bind);
  if (ex.has('beard')) addBeard(kit, D, pal, bind, false);
}

/** What gods and creatures wear on top: earrings and beads, the ring behind the back, the banner, the feather cloak. */
export function extras(E) {
  const { ex, kit, D, ctx, pal, bind } = E;
  const dress = dressOf(E);
  if (ex.has('jewelry')) {
    addJewelry(E, { collar: false, bands: false });
    // Amaterasu's magatama: a string of curved jade and gold beads; Inari's, of amber
    if (dress === 'amaterasu') addGarland(kit, D, bind, { colors: [JADE, GOLD, JADE, withMat('#f5f0e0', 'gem')], low: 0.5, r: 0.016, beads: 20, mat: 'gem' });
    else if (dress === 'inari') addGarland(kit, D, bind, { colors: [AMBER, GOLD], low: 0.62, r: 0.015, beads: 16, mat: 'gem' });
  }
  if (ex.has('aura_ring')) addAuraRing(E, { kind: dress === 'raijin' ? 'drums' : 'rays' });
  if (ctx.grand && !ex.has('aura_ring')) addSashimono(E, { flag: TEAM(0.95), stripe: pal.accentMetal, mon: GOLD });
  DEFAULT.extras({ ...E, ex: new Set([...ex].filter((e) => e !== 'jewelry' && e !== 'aura_ring')) });
}

/**
 * Style for a held item (rich-humanoid.js asks for it for each hand): the Oni's club is the iron
 * kanabo, the archer's bow the long yumi, Inari's staff the ringed shakujo, the Tengu's fan the hauchiwa of
 * feathers, Raijin's offhand drum a second drumstick.
 */
export function gear(ctx, item) {
  const { pal } = ctx;
  const id = ctx.unit.id;
  if (item.id === 'club' && id === 'japanese_oni') return { kanabo: true, color: shade(pal.accent, 0.62), studs: pal.accent };
  if (item.id === 'bow') return { yumi: true };
  if (item.id === 'staff') return { staff: 'shakujo' };
  if (item.id === 'fan' && id === 'japanese_tengu') return { fan: 'hauchiwa' };
  if (item.id === 'drum') return { drum: 'stick' };
  return null;
}

export const JAPANESE = { legs, torso, arms, armor: armorLayer, cloaks, head, extras, gear, palette };
