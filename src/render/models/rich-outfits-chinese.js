// The Chinese look: the jacket closed in a diagonal across the breast and tied with a sash, trousers
// bound at the calf and cloth shoes for the people under the bamboo hat; the lacquered cuirass with its
// round mirrors, the plumed helm and the round tiger shield for the soldiers; the priest in cream under
// his Taoist crown. The gods dress as their legends show them (Sun Wukong in golden armor and a tiger
// skin under the pheasant-plumed crown, Guan Yu in green with his long beard and his four pennants,
// Chang'e in white silk with ribbons floating from her shoulders, Pangu in his skins), the Monkey
// King's copies in a tiger skin and a golden fillet, the clay soldiers in one earthen color, the
// crossbowman with his repeating crossbow. Overrides only the layers where the Chinese dress
// differently from the default (rich-outfit-default.js).
import * as THREE from 'three';
import { TEAM, shadeC, mixC, withMat } from './unit-geo.js';
import { vs } from './rich-kit.js';
import { torsoStations, armStations, addSandals, addBoots, addBareLegs } from './rich-body.js';
import {
  addTunic, addCape, addPteruges, addPauldrons, addLongSkirt, addHem, addGarland,
  addTrousers, addLegWraps, addAnkles, addWideSleeves, addSash, addJiaoling, addMingguang, addTunjian, addWrapSkirt,
} from './rich-clothing.js';
import {
  addHairCap, addLongHair, addTopknot, addCrescent, addDouli, addScarfCap, addCnHelm, addDaoguan, addPheasantCrown, addFillet, addLongBeard, addHairpins,
} from './rich-headgear.js';
import { addJewelry, addKaoqi, addPibo, addTail } from './rich-regalia.js';
import { BEAST_HEADS } from './rich-heads.js';
import { mul, furStreaks } from './rich-paint.js';
import { DEFAULT } from './rich-outfit-default.js';

const GOLD = withMat('#dfb54a', 'gold');
const STEEL = withMat('#a9b1bb', 'metal');
const LACQUER_RED = withMat('#7d2a21', 'lacquer');
const LACQUER_GREEN = withMat('#1d4a3d', 'lacquer');
const LACQUER_GOLD = withMat('#b88a2c', 'lacquer');
const BLACK_CLOTH = withMat('#25222a', 'cloth');
const BLACK_LEATHER = withMat('#2b2321', 'leather');
const COTTON = withMat('#ece4d0', 'cloth');
const JADE = withMat('#5fbf9a', 'gem');
const PEARL = withMat('#f5f0e0', 'gem');
const RUBY = withMat('#d2334a', 'gem');

const BLACK_HAIR = new THREE.Color('#1b1618');

/** Shoulder guards a little coarser than the default: the Chinese soldier carries more (mirrors, lames, plume) than the budget has for smooth domes. */
const LEAN_PAULDRON = { sides: 10, rings: 4 };

/** The people have black hair (the shared palette's brown is not theirs); a clay soldier's is the clay. */
export function palette(pal, ctx) {
  if (ctx.unit.id === 'chinese_clay_warrior') return { ...pal, hair: shadeC(pal.primary, 0.55) };
  return ctx.mortal ? { ...pal, hair: BLACK_HAIR } : pal;
}

/** A team-safe shade of a color. */
const shade = (c, k) => (c && c.team ? TEAM(c.team * k, c.mat) : shadeC(c, k));

/** Who wears what: the people by their work, the rest by name. */
const NAMED = {
  chinese_sun_wukong: 'wukong',
  chinese_guan_yu: 'guan_yu',
  chinese_chang_e: 'chang_e',
  chinese_pangu: 'pangu',
  chinese_monkey_clone: 'clone',
  chinese_clay_warrior: 'clay',
  chinese_crossbowman: 'crossbow',
};

/** The dress of a unit: peasant (worshipper), soldier (warrior), archer, priest, or a god's, a minion's or the elite's own. */
function dressOf(E) {
  const named = NAMED[E.ctx.unit.id];
  if (named) return named;
  if (E.worker) return 'peasant';
  if (E.ctx.cls === 'support') return 'priest';
  return E.armor ? 'soldier' : 'archer';
}

/** The tiger's skin: a hide of gold striped in black (the cloth's `mark`). */
const tiger = (E) => mixC(E.pal.primary, '#e0a23a', 0.45);
const tigerStripes = (o, x, y, z) => {
  const s = Math.sin(z * 34 + y * 22 + Math.sin(x * 30) * 1.2 + Math.sin(y * 58) * 0.3);
  if (s > 0.38) mul(o, 0.2);
};

/** Skin torso (a bare chest). */
function bareTorso(E) {
  const { kit, D, bind, skin, skinPaint } = E;
  kit.loft(torsoStations(D), { rings: 9, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
}

/** Cloth shoes: a dark upper on a pale sole, no straps. */
function shoes(E, upper, sole = COTTON) {
  const { kit, D, pal, bind } = E;
  addSandals(kit, D, pal, bind, { skin: upper, sole, strap: upper });
}

// ---------------------------------------------------------------------------
// legs
// ---------------------------------------------------------------------------

export function legs(E) {
  const { kit, D, pal, bind, skin, skinPaint } = E;
  switch (dressOf(E)) {
    case 'peasant':
      addTrousers(kit, D, bind, shade(pal.primary, 0.78));
      addLegWraps(kit, D, bind, COTTON, 9);
      shoes(E, BLACK_CLOTH);
      break;
    case 'soldier':
      addTrousers(kit, D, bind, shade(pal.secondary, 0.78));
      addLegWraps(kit, D, bind, COTTON, 9);
      shoes(E, BLACK_CLOTH);
      break;
    case 'archer':
      addTrousers(kit, D, bind, shade(pal.secondary, 0.72));
      addLegWraps(kit, D, bind, shade(pal.primary, 0.9), 9);
      shoes(E, BLACK_CLOTH);
      break;
    case 'crossbow':
      addTrousers(kit, D, bind, shade(pal.secondary, 0.7));
      addBoots(kit, D, pal, bind, BLACK_LEATHER, GOLD);
      break;
    case 'clay':
      addTrousers(kit, D, bind, shade(pal.primary, 0.82));
      addLegWraps(kit, D, bind, shade(pal.primary, 1.06), 9);
      shoes(E, shade(pal.primary, 0.76), shade(pal.primary, 1.1));
      break;
    case 'guan_yu':
      addBoots(kit, D, pal, bind, BLACK_LEATHER, GOLD);
      break;
    case 'priest':
    case 'chang_e':
      addAnkles(kit, D, bind, skin, skinPaint, D.ankleY + 0.1);
      shoes(E, dressOf(E) === 'priest' ? shade(pal.secondary, 0.85) : shade(pal.secondary, 1.0));
      break;
    case 'wukong':
      // fur to the knee, golden boots with a red cuff: cloud-treading boots
      addBareLegs(kit, D, bind, skin, skinPaint);
      addBoots(kit, D, pal, bind, shade(pal.primary, 0.78), pal.secondary);
      break;
    case 'clone':
      addBareLegs(kit, D, bind, skin, skinPaint);
      addSandals(kit, D, pal, bind, { skin, skinPaint, sole: skin, strap: skin });
      break;
    default:
      DEFAULT.legs(E);
  }
}

// ---------------------------------------------------------------------------
// torso
// ---------------------------------------------------------------------------

export function torso(E) {
  const { kit, D, pal, bind, tunicColor, armor } = E;
  const dress = dressOf(E);
  switch (dress) {
    case 'peasant':
      // a short jacket in the team's color closed across the breast, a sash with its ends hanging
      addTunic(kit, D, tunicColor, bind, 0.12);
      addJiaoling(kit, D, bind, { color: shade(pal.secondary, 0.95), knot: GOLD });
      addSash(kit, D, bind, { color: pal.secondary, trim: GOLD });
      break;
    case 'soldier':
    case 'crossbow':
      // the jacket in the team's color under the cuirass (armorLayer)
      addTunic(kit, D, tunicColor, bind, 0.12);
      addJiaoling(kit, D, bind, { color: dress === 'soldier' ? COTTON : shade(pal.secondary, 1.0), lapel: !armor });
      break;
    case 'archer':
      addTunic(kit, D, shade(pal.primary, 1.05), bind, 0.15);
      addJiaoling(kit, D, bind, { color: shade(pal.accent, 0.95), knot: GOLD });
      addSash(kit, D, bind, { color: pal.secondary, trim: GOLD, wide: 0.9 });
      break;
    case 'clay':
      addTunic(kit, D, tunicColor, bind, 0.12);
      addJiaoling(kit, D, bind, { color: shade(pal.primary, 0.72), lapel: !armor });
      addSash(kit, D, bind, { color: TEAM(0.9), tails: false, wide: 0.8 });
      break;
    case 'priest': {
      // a long cream robe with a red collar and hem, a broad sash in the team's color
      addTunic(kit, D, pal.primary, bind, 0.08);
      const sk = addLongSkirt(kit, D, bind, pal.primary, { pleat: 0.01, top: 0.03 });
      addHem(kit, bind, sk, pal.secondary, 0.06);
      addJiaoling(kit, D, bind, { color: pal.secondary, knot: GOLD });
      addSash(kit, D, bind, { color: TEAM(0.95), trim: GOLD, wide: 1.15 });
      break;
    }
    case 'guan_yu': {
      // the green robe to the boots, the cuirass comes over it
      addTunic(kit, D, pal.primary, bind, 0.08);
      const sk = addLongSkirt(kit, D, bind, pal.primary, { pleat: 0.011, top: 0.03 });
      addHem(kit, bind, sk, pal.secondary, 0.06);
      addJiaoling(kit, D, bind, { color: pal.secondary, knot: GOLD });
      break;
    }
    case 'chang_e': {
      // white silk to the ground, a periwinkle collar, hem and sash
      addTunic(kit, D, pal.primary, bind, 0.08);
      const sk = addLongSkirt(kit, D, bind, pal.primary, { pleat: 0.013, top: 0.03, flare: 1.1 });
      addHem(kit, bind, sk, pal.secondary, 0.07);
      addJiaoling(kit, D, bind, { color: pal.secondary, knot: PEARL });
      addSash(kit, D, bind, { color: pal.secondary, trim: GOLD });
      break;
    }
    case 'wukong':
      // a bare furred chest under the armor, a tiger skin about the loins, a red sash
      bareTorso(E);
      addWrapSkirt(kit, D, bind, { color: tiger(E), len: 0.78, flare: 1, teeth: 12, depth: 0.05, mark: tigerStripes, mat: 'fur' });
      addSash(kit, D, bind, { color: pal.secondary, trim: GOLD });
      break;
    case 'clone':
      bareTorso(E);
      addWrapSkirt(kit, D, bind, { color: tiger(E), len: 0.7, flare: 1, teeth: 12, depth: 0.04, mark: tigerStripes, mat: 'fur' });
      addSash(kit, D, bind, { color: TEAM(0.95), wide: 0.9 });
      break;
    default:
      // Pangu: bare, a hide wrapped about the loins and tied with a sash in the team's color
      bareTorso(E);
      addWrapSkirt(kit, D, bind, { color: shade(pal.secondary, 1.1), len: 0.75, flare: 1.1, teeth: 18, depth: 0.07, mark: tigerStripes, mat: 'fur' });
      addSash(kit, D, bind, { color: TEAM(0.95), wide: 0.8 });
  }
}

// ---------------------------------------------------------------------------
// arms
// ---------------------------------------------------------------------------

export function arms(E) {
  const { kit, D, pal, bind, skin, skinPaint } = E;
  const dress = dressOf(E);
  const w = D.shoulderY - 0.02 - D.upper - D.fore;
  if (dress === 'priest' || dress === 'chang_e') {
    addWideSleeves(kit, D, bind, { color: pal.primary, trim: pal.secondary, wide: dress === 'chang_e' ? 1.45 : 1.1 });
    for (const side of [1, -1]) {
      kit.loft(armStations(D, side).slice(0, 3), { rings: 4, start: null, end: null, color: skin, bind: bind.arm[side], paint: skinPaint });
      if (dress === 'chang_e') {
        // a gold bangle at each wrist, showing under the sleeve
        const y = w + 0.014;
        kit.loft([vs(y, D.armR * 0.7 + 0.009, D.armR * 0.68 + 0.009, 0.001, side * D.shoulderZ), vs(y + 0.011, D.armR * 0.72 + 0.009, D.armR * 0.7 + 0.009, 0.001, side * D.shoulderZ)],
          { sides: 12, start: null, end: null, color: pal.accentMetal, mat: 'gold', bind: bind.arm[side] });
      }
    }
    return;
  }
  if (dress === 'wukong' || dress === 'clone') {
    for (const side of [1, -1]) {
      const bd = bind.arm[side];
      // (the clone's shoulders are bare: round them off; the Monkey King's are under his pauldrons)
      kit.loft(armStations(D, side), { rings: 8, start: null, end: dress === 'clone' ? 'round' : null, capRings: 2, capDepth: 0.022, color: skin, bind: bd, paint: skinPaint });
      if (dress === 'wukong') {
        // golden bracers
        kit.loft([vs(w + 0.012, D.armR * 0.66 + 0.009, D.armR * 0.64 + 0.009, 0, side * D.shoulderZ), vs(w + D.fore * 0.6, D.armR * 0.88 + 0.009, D.armR * 0.86 + 0.009, 0.002, side * D.shoulderZ), vs(w + D.fore * 0.9, D.armR * 0.96 + 0.01, D.armR * 0.94 + 0.01, 0.002, side * D.shoulderZ)],
          { sides: 12, rings: 4, start: null, end: null, color: pal.accentMetal, mat: 'gold', glow: 0.1, bind: bd });
      }
    }
    return;
  }
  DEFAULT.arms(E);
}

// ---------------------------------------------------------------------------
// armor: the mingguang with its mirrors, the beasts on the shoulders
// ---------------------------------------------------------------------------

export function armorLayer(E) {
  const { kit, D, pal, bind, armor } = E;
  if (!armor) return;
  switch (dressOf(E)) {
    case 'soldier':
      addMingguang(kit, D, pal, bind, { plate: LACQUER_RED, trim: GOLD, mirror: STEEL, belt: BLACK_LEATHER });
      addPteruges(kit, D, pal, bind, { color: LACQUER_RED, edge: TEAM(0.9), strips: 14, len: 1.0, mat: 'lacquer' });
      addPauldrons(kit, D, pal, bind, shade(LACQUER_RED, 0.92), GOLD, 0, LEAN_PAULDRON);
      break;
    case 'crossbow':
      addMingguang(kit, D, pal, bind, { plate: LACQUER_GREEN, trim: GOLD, mirror: STEEL, belt: BLACK_LEATHER });
      addPteruges(kit, D, pal, bind, { color: LACQUER_GREEN, edge: TEAM(0.9), strips: 14, len: 1.0, mat: 'lacquer' });
      addPauldrons(kit, D, pal, bind, shade(LACQUER_GREEN, 0.92), GOLD, 0, LEAN_PAULDRON);
      break;
    case 'clay': {
      const plate = shadeC(pal.primary, 0.8);
      addMingguang(kit, D, pal, bind, { plate, trim: shadeC(pal.accent, 0.9), belt: shadeC(pal.primary, 0.6), discs: false });
      addPteruges(kit, D, pal, bind, { color: plate, edge: TEAM(0.9), strips: 14, len: 1.0 });
      addPauldrons(kit, D, pal, bind, shadeC(pal.primary, 0.74), shadeC(pal.accent, 0.9), 0, LEAN_PAULDRON);
      break;
    }
    case 'guan_yu':
      addMingguang(kit, D, pal, bind, { plate: LACQUER_GOLD, trim: GOLD, mirror: STEEL, belt: shade(pal.primary, 0.7) });
      addTunjian(kit, D, pal, bind, { plate: LACQUER_GOLD, trim: GOLD });
      break;
    default: {
      // Sun Wukong's golden armor: gold plates, bright mirrors, a beast on each shoulder
      const plate = withMat(shadeC(pal.primary, 0.95), 'gold');
      addMingguang(kit, D, pal, bind, { plate, trim: GOLD, mirror: mixC(pal.accent, '#ffffff', 0.4), belt: shade(pal.secondary, 0.9) });
      addTunjian(kit, D, pal, bind, { plate, trim: GOLD });
    }
  }
}

// ---------------------------------------------------------------------------
// cloaks, head, extras
// ---------------------------------------------------------------------------

export function cloaks(E) {
  const { kit, D, ctx, pal, bind, ex } = E;
  const dress = dressOf(E);
  if (dress === 'chang_e') {
    // the ribbons of the moon goddess in the team's color
    addPibo(E, { color: TEAM(0.95, 'cloth'), trim: GOLD });
    return;
  }
  if (dress === 'pangu') {
    DEFAULT.cloaks(E);
    return;
  }
  if (!ex.has('cape')) return;
  if (dress === 'wukong') addCape(kit, D, shade(pal.secondary, 1.0), GOLD, shade(pal.secondary, 0.7), bind, { len: 0.9 });
  else addCape(kit, D, TEAM(1), ctx.grand ? pal.accentMetal : pal.secondary, shade(pal.secondary, 0.7), bind, { len: ctx.mortal ? 0.62 : 0.9, wide: ctx.mortal ? 0.9 : 1 });
}

/** The dresses whose headgear covers the whole crown. */
const COVERED = new Set(['soldier', 'crossbow', 'archer', 'guan_yu']);

export function head(E) {
  const { kit, D, v, pal, bind, ex } = E;
  const dress = dressOf(E);
  if (dress === 'pangu') {
    DEFAULT.head(E);
    return;
  }
  const beast = BEAST_HEADS.has(v.head);
  // (a helm or a wound scarf covers the crown: no cap of hair under it)
  if (!beast && !COVERED.has(dress)) addHairCap(kit, D, pal, bind);
  switch (dress) {
    case 'peasant':
      addDouli(kit, D, pal, bind, { color: withMat(mixC(pal.primary, '#f0e2b0', 0.4), 'cloth'), rim: withMat(shadeC(pal.primary, 0.62), 'wood'), cord: shade(pal.secondary, 0.8) });
      break;
    case 'soldier':
      addCnHelm(kit, D, pal, bind, { steel: STEEL, trim: GOLD, plume: TEAM(0.95, 'hair') });
      break;
    case 'crossbow':
      addCnHelm(kit, D, pal, bind, { steel: STEEL, trim: GOLD, plume: TEAM(0.95, 'hair'), tall: 1.3 });
      break;
    case 'clay':
      addTopknot(kit, D, pal, bind, { band: TEAM(0.9) });
      break;
    case 'archer':
      addScarfCap(kit, D, pal, bind, { color: BLACK_CLOTH, band: pal.secondary, tails: 0.12 });
      break;
    case 'priest':
      addDaoguan(kit, D, pal, bind, { metal: GOLD, bead: JADE });
      break;
    case 'guan_yu':
      addScarfCap(kit, D, pal, bind, { color: pal.primary, band: GOLD, tails: 0.36 });
      addLongBeard(kit, D, pal, bind);
      break;
    case 'chang_e':
      addCrescent(kit, D, pal, bind, { moon: withMat(mixC(pal.accent, '#f4f6ff', 0.55), 'gem'), band: GOLD, coil: false });
      addHairpins(kit, D, pal, bind, { metal: GOLD, bead: PEARL, n: 3 });
      break;
    case 'wukong':
      addPheasantCrown(kit, D, pal, bind, { metal: GOLD, gem: RUBY, plume: pal.secondary, tip: mixC(pal.accent, '#fff2b0', 0.2) });
      break;
    default:
      addFillet(kit, D, pal, bind, { metal: GOLD });
  }
  // Chang'e's hair streams behind her; Guan Yu's is under his scarf and the beard is his glory
  if (ex.has('long_hair') && !beast && dress === 'chang_e') addLongHair(kit, D, pal, bind);
}

/** What gods and the people wear on top: earrings and pearls, the monkeys' tails, Guan Yu's and Wukong's pennants, the default extras. */
export function extras(E) {
  const { ex, kit, D, bind } = E;
  const dress = dressOf(E);
  if (ex.has('jewelry')) {
    addJewelry(E, { collar: false, bands: false });
    if (dress === 'chang_e') addGarland(kit, D, bind, { colors: [PEARL, GOLD, PEARL, JADE], low: 0.55, r: 0.015, beads: 20, mat: 'gem' });
  }
  if (ex.has('tail')) addTail(E, { kind: 'monkey' });
  if (dress === 'guan_yu' || dress === 'wukong') addKaoqi(E, { flag: TEAM(0.95, 'cloth') });
  DEFAULT.extras({ ...E, ex: new Set([...ex].filter((e) => e !== 'jewelry' && e !== 'tail')) });
}

/**
 * Style for a held item (rich-humanoid.js asks for it for each hand): Guan Yu's pole arm is the Green Dragon
 * crescent blade, the crossbowman's bow a repeating crossbow, the monkeys' staff the Ruyi Jingu Bang, the priest's fan
 * of crane feathers, Pangu's axe the broad yue.
 */
export function gear(ctx, item) {
  const id = ctx.unit.id;
  if (item.id === 'halberd' && id === 'chinese_guan_yu') return { guandao: true };
  if (item.id === 'bow' && id === 'chinese_crossbowman') return { crossbow: true, magazine: true };
  if (item.id === 'staff') return { staff: 'ruyi' };
  if (item.id === 'fan') return { fan: 'crane' };
  if (item.id === 'axe' && id === 'chinese_pangu') return { axe: 'yue' };
  return null;
}

/** The Monkey King's fur: a streak of lighter and darker hair over every bare surface of the body. */
export function skinPaint(E) {
  return E.v.head === 'monkey' ? furStreaks : null;
}

/** The round shield: the team's color in alternating wedges like a tiger's stripes, a gold boss and rim and a tiger-gold roundel. */
export const shield = {
  w: 0.19, h: 0.19, sides: 14, face: 'team', pattern: 'wedges', disc: { k: 0.46, color: withMat('#d9a03a', 'painted') }, boss: 'dome', dish: 0.04, rim: GOLD, rimMat: 'gold',
};

export const CHINESE = { legs, torso, arms, armor: armorLayer, cloaks, head, extras, gear, palette, skinPaint, shield };

