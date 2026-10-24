// The Egyptian look: bare chests above pleated linen kilts with their stiff aprons, banded
// corselets for the soldiers, the striped headcloth, the broad beaded collar, gold arm bands and
// sandals of papyrus. The gods dress as their images show them (Ra in gold under his sun disk,
// Anubis in white linen, Isis in a red sheath with her wings, Set armored in dark bronze with his
// forked tail), the priest in a long pleated robe with a stole, and the dead wrapped in bandage.
// Overrides only the layers where the Egyptians dress differently from the default
// (rich-outfit-default.js).
import { TEAM, shadeC, mixC, tintC, withMat } from './unit-geo.js';
import { vs } from './rich-kit.js';
import { torsoStations, armStations, legStations, headStations, ringAt, addSandals, addBareLegs } from './rich-body.js';
import {
  addTunic, addCape, addDrape, addLongSkirt, addWaistBelt, addShendyt, addCorselet, addUsekh, addWraps,
} from './rich-clothing.js';
import { addHairCap, addLongHair, addBeard, addNemes, addSunDisk, addDoubleCrown, addPlumes, addTiara } from './rich-headgear.js';
import { addJewelry, addTail } from './rich-regalia.js';
import { hash, mul, dye } from './rich-paint.js';
import { DEFAULT } from './rich-outfit-default.js';

const GOLD = withMat('#dcb55a', 'gold');
const BRONZE = withMat('#b98945', 'gold');

/** How the gods that do not dress by their build are dressed. */
const GODS = {
  egyptian_isis: { dress: 'sheath' },
};

/** The garment of a unit: mummy (wrapped), sheath (Isis), robe (the priest), corselet (armored: the soldiers, Set) or kilt. */
function dressOf(E) {
  const god = GODS[E.ctx.unit.id];
  if (god) return god.dress;
  if (E.ctx.cls === 'minion') return 'mummy';
  if (E.robe && E.ctx.cls === 'support') return 'robe';
  return E.armor ? 'corselet' : 'kilt';
}

/** The gold of a unit's jewelry and trim: plain gold for the people, a god's own accent. */
const goldOf = (E) => (E.ctx.mortal ? GOLD : E.pal.accentMetal);

/** Skin torso (a bare chest). */
function bareTorso(E) {
  const { kit, D, bind, skin, skinPaint } = E;
  kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
}

/** A loose end of bandage hanging from `root`: a narrow strip that frays to a point. */
function rag(kit, bind, root, { len = 0.22, w = 0.026, color, sway = 1 }) {
  kit.sheet(2, 6, (u, v, out) => {
    out[0] = root[0] + 0.02 * sway * Math.sin(v * 2.6 + root[2] * 9) * v;
    out[1] = root[1] - v * len;
    out[2] = root[2] + (u - 0.5) * w * (1 - 0.7 * v) + 0.015 * sway * v * v;
  }, {
    thick: 0.003, color, inner: shadeC(color, 0.8), bind,
    paint: (o, x, y) => mul(o, 0.9 + 0.2 * hash(Math.round(y * 60), 3, 3)),
  });
}

function kilt(E) {
  // a bare chest, the wrapped kilt with its apron, a sash at the waist
  const { kit, D, ctx, pal, bind, tunicColor } = E;
  const gold = goldOf(E);
  const god = ctx.grand;
  bareTorso(E);
  addShendyt(kit, D, bind, {
    color: tunicColor,
    trim: gold,
    // the people's kilt is their team's linen with a cream apron; a god's apron carries the team color
    apron: god ? TEAM(0.95) : ctx.tunic ? pal.primary : tintC(tunicColor, 0.22),
  });
  addWaistBelt(kit, D, bind, ctx.tunic || god ? shadeC(pal.secondary, 1.0) : shadeC(pal.leather, 1.05), gold);
}

function robe(E) {
  // the priest: a long pleated linen robe, a blue hem, a stole of the team's color across the chest
  const { kit, D, pal, bind } = E;
  const gold = goldOf(E);
  addTunic(kit, D, pal.primary, bind, 0.04);
  const sk = addLongSkirt(kit, D, bind, pal.primary, { pleat: 0.011 });
  kit.loft([vs(sk.y0 - 0.002, sk.rx + 0.004, sk.rz + 0.004), vs(sk.y0 + 0.04, sk.rx - 0.002, sk.rz - 0.002)],
    { sides: 36, start: null, end: null, color: pal.secondary, mat: 'trim', bind: bind.skirt });
  addDrape(kit, D, bind, TEAM(0.95), gold, { side: 1, width: 0.3 });
  addWaistBelt(kit, D, bind, shadeC(pal.secondary, 1.0), gold);
}

function sheath(E) {
  // Isis: a close red sheath from the neck to the ankles, a team-colored sash at the waist
  const { kit, D, pal, bind } = E;
  addTunic(kit, D, pal.primary, bind, 0.03);
  addLongSkirt(kit, D, bind, pal.primary, { flare: 0.8, pleat: 0.003 });
  addWaistBelt(kit, D, bind, TEAM(0.95), goldOf(E));
}

function mummy(E) {
  // the dead: bandaged skin (the bandage is painted on by skinPaint), a ragged loincloth, a rag sash
  const { kit, D, pal, bind } = E;
  bareTorso(E);
  const y = (f) => D.hipY + (D.shoulderY - D.hipY) * f;
  addWraps(kit, bind.torso, torsoStations(D), y(0.0), y(1.02), 10, pal.primary, { g: 0.012, sides: 20, slant: 0.4, seed: 2 });
  addShendyt(kit, D, bind, { color: pal.secondary, len: 0.75, apron: shadeC(pal.secondary, 0.9) });
  addDrape(kit, D, bind, shadeC(pal.secondary, 1.05), null, { side: 1, width: 0.15 });
}

export function legs(E) {
  const { kit, D, ctx, pal, bind, skin, skinPaint } = E;
  const dress = dressOf(E);
  const robed = dress === 'robe' || dress === 'sheath';
  const knee = D.hipY - D.thigh;
  // a robe hides the leg above the knee
  addBareLegs(kit, D, bind, skin, skinPaint, robed ? knee + D.thigh * 0.4 : Infinity);
  addSandals(kit, D, pal, bind, {
    skin, skinPaint, sole: mixC(pal.leather, '#c9b27a', 0.45), strap: ctx.mortal ? pal.leather : goldOf(E),
  });
  if (dress === 'mummy') {
    for (const side of [1, -1]) addWraps(kit, bind.leg[side], legStations(D, side), D.ankleY + 0.015, D.hipY - 0.13, 9, pal.primary, { sides: 14, seed: 3 + side });
  }
}

export function torso(E) {
  switch (dressOf(E)) {
    case 'robe': robe(E); break;
    case 'sheath': sheath(E); break;
    case 'mummy': mummy(E); break;
    default: kilt(E);
  }
}

export function arms(E) {
  const { kit, D, ctx, pal, bind, armor, skin, skinPaint } = E;
  const mummied = dressOf(E) === 'mummy';
  const elbow = D.shoulderY - 0.02 - D.upper;
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    kit.loft(armStations(D, side), { rings: 8, start: null, end: null, color: skin, bind: bd, paint: skinPaint });
    if (armor || ctx.grand) {
      // a wrist guard: leather for the soldiers, gold for a god
      const w = D.shoulderY - 0.02 - D.upper - D.fore;
      kit.loft([vs(w + 0.012, D.armR * 0.66 + 0.007, D.armR * 0.64 + 0.007, 0, side * D.shoulderZ), vs(w + D.fore * 0.52, D.armR * 0.86 + 0.007, D.armR * 0.84 + 0.007, 0.002, side * D.shoulderZ)],
        { sides: 12, rings: 3, start: null, end: null, color: ctx.mortal ? pal.leather : goldOf(E), mat: ctx.mortal ? 'leather' : 'gold', bind: bd });
    }
    if (mummied) {
      addWraps(kit, bd, armStations(D, side), D.shoulderY - 0.02 - D.upper - D.fore + 0.012, D.shoulderY - 0.05, 10, pal.primary, { g: 0.008, sides: 12, seed: 5 + side });
      // loose ends of bandage trailing from the elbows
      const z = side * (D.shoulderZ + D.armR * 0.95);
      rag(kit, bd, [-0.012, elbow - 0.01, z], { len: 0.3, color: pal.secondary, sway: side });
      rag(kit, bd, [0.012, elbow - 0.06, z], { len: 0.2, w: 0.02, color: shadeC(pal.secondary, 0.9), sway: -side });
    }
  }
}

export function armorLayer(E) {
  const { kit, D, ctx, pal, bind, armor } = E;
  if (!armor) return;
  if (ctx.mortal) addCorselet(kit, D, pal, bind, { color: BRONZE, trim: GOLD, bands: 6 });
  else addCorselet(kit, D, pal, bind, { color: shadeC(pal.darkMetal, 1.1), trim: pal.accentMetal, bands: 6 });
}

export function cloaks(E) {
  const { kit, D, pal, bind, ex } = E;
  if (!ex.has('cape')) return;
  addCape(kit, D, TEAM(1), pal.secondary, shadeC(pal.secondary, 0.7), bind, { len: 0.8, wide: 0.9 });
}

export function head(E) {
  const { kit, D, ctx, v, pal, bind, ex } = E;
  const gear = v.headgear;
  const gold = goldOf(E);
  if (gear === 'nemes') {
    // the striped headcloth: the team's own cloth for workers and soldiers, with gold stripes
    const team = !!ctx.tunic;
    addNemes(kit, D, pal, bind, { cloth: team ? TEAM(0.95) : pal.primary, stripe: team ? gold : pal.secondary, trim: gold, tail: !ex.has('cape') });
  } else if (gear === 'sun_disk') {
    addSunDisk(kit, D, pal, bind, { disk: withMat(mixC(pal.glow, '#ffe9a0', 0.4), 'gem'), metal: gold });
  } else if (gear === 'tall_crown') {
    // the double crown: the red crown with the tall white one in it
    addDoubleCrown(kit, D, pal, bind, { white: withMat('#f1ece0', 'cloth'), red: withMat('#b3302a', 'cloth'), metal: gold });
  } else if (gear === 'tiara') {
    addHairCap(kit, D, pal, bind);
    addTiara(kit, D, pal, bind, { metal: gold, gem: pal.secondary });
  } else if (gear === 'feathers') {
    addHairCap(kit, D, pal, bind);
    addPlumes(kit, D, pal, bind, { band: gold, colors: [pal.white, pal.secondary, pal.white, mixC(pal.accent, '#c8382e', 0.5)], n: 5, len: 0.2 });
  }
  if (dressOf(E) === 'mummy') {
    // the head wrapped over the crown and under the jaw, a dark gap left for the eyes
    const hs = D.hs;
    const hy = D.headCY;
    const st = headStations(D);
    const g = 0.008 * hs;
    addWraps(kit, bind.head, st, hy + 0.05 * hs, hy + 0.098 * hs, 3, pal.primary, { g, sides: 18, slant: 0.35, seed: 11 });
    const top = ringAt(st, hy + 0.098 * hs, g);
    kit.loft([top, vs(hy + 0.112 * hs, 0.042 * hs + g, 0.042 * hs + g, top.c[0])], { sides: 18, start: null, end: 'round', capDepth: 0.02 * hs, color: pal.primary, mat: 'cloth', bind: bind.head });
    addWraps(kit, bind.head, st, hy - 0.1 * hs, hy - 0.044 * hs, 3, pal.primary, { g, sides: 18, slant: 0.4, seed: 17 });
  }
  // the priest's head is shaved, the dead are wrapped: no hair unless it is asked for
  if (ex.has('long_hair')) addLongHair(kit, D, pal, bind);
  if (ex.has('beard')) addBeard(kit, D, pal, bind, E.lava);
}

/** What gods and the people wear on top: the broad collar and arm bands, Set's tail, and the default extras. */
export function extras(E) {
  const { ex, kit, D, ctx, pal, bind, armor } = E;
  if (ex.has('jewelry')) {
    const gold = goldOf(E);
    // earrings and the gods' arm bands; the collar is the broad one
    addJewelry(E, { collar: false });
    const rows = ctx.grand ? [gold, TEAM(0.95), pal.secondary, gold, pal.secondary] : [gold, pal.secondary, gold];
    addUsekh(kit, D, bind, { rows, grow: armor ? 0.02 : 0 });
  }
  if (ex.has('tail')) addTail(E);
  DEFAULT.extras({ ...E, ex: new Set([...ex].filter((e) => e !== 'jewelry')) });
}

/** The skin of a mummy is dark and dried: the bandage (addWraps) lies over it and the dark shows in the gaps, round the eyes and in the hands. */
export function skinPaint(E) {
  if (dressOf(E) !== 'mummy') return null;
  const dark = mixC(E.pal.skin, '#2e2016', 0.78);
  return (o, x, y) => {
    dye(o, dark, 1);
    mul(o, 0.85 + 0.3 * hash(Math.round(x * 30), Math.round(y * 30), 4));
  };
}

/** The Egyptian shield: a tall hide oval with a rounded top, a strip of dark wood down the middle, a bronze rim. */
export const shield = {
  w: 0.15, h: 0.27, n: 2.3, sides: 22, face: 'team', pattern: 'stripe', boss: null, dish: 0.025, rim: BRONZE, rimMat: 'gold',
};

export const EGYPTIAN = { legs, torso, arms, armor: armorLayer, cloaks, head, extras, skinPaint, shield };
