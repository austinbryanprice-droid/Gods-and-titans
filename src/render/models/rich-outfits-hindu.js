// The Hindu look: bare chests above a dhoti drawn up between the legs and hanging in folds, the
// quilted char-aina with its four steel plates for the soldiers, garlands of flowers and beads,
// gold armlets and anklets, a topknot for the people and the matted bun with its moon for Shiva.
// The gods dress as their images show them (Shiva in a tiger skin with rudraksha beads, Vishnu in
// his yellow pitambara and tiered kirita, Durga in a red sari, Hanuman in a loincloth, barefoot,
// fur on his arms, Garuda in a green loincloth under his feather cloak), and the gods that are
// many-armed carry their extra pairs of arms. Overrides only the layers where the Hindus dress
// differently from the default (rich-outfit-default.js).
import { TEAM, shadeC, mixC, tintC, withMat } from './unit-geo.js';
import { vs } from './rich-kit.js';
import { torsoStations, armStations, legRing, addSandals, addBareLegs } from './rich-body.js';
import { addCape, addDrape, addLongSkirt, addHem, addWaistBelt, addDhoti, addCharAina, addGarland, addArmBands } from './rich-clothing.js';
import { addHairCap, addLongHair, addTiara, addTopknot, addCrescent, addKirita } from './rich-headgear.js';
import { addJewelry, addTail, addPrabhavali, extraArmsPiece } from './rich-regalia.js';
import { BEAST_HEADS } from './rich-heads.js';
import { gradY, mul, furStreaks } from './rich-paint.js';
import { DEFAULT } from './rich-outfit-default.js';

const GOLD = withMat('#dfb54a', 'gold');
const STEEL = withMat('#b3bac4', 'metal');
const RUBY = withMat('#d2334a', 'gem');
const RUDRAKSHA = [withMat('#5b3a22', 'wood'), withMat('#7a5230', 'wood')];
const FLOWERS = [withMat('#d8384c', 'cloth'), withMat('#f6efe0', 'cloth'), withMat('#f2c230', 'cloth'), withMat('#f6efe0', 'cloth')];
const MARIGOLD = [withMat('#f2a31e', 'cloth'), withMat('#f6c93a', 'cloth'), withMat('#e8861c', 'cloth')];

/** How each god is dressed (the rest follow their build): the garment, and the items in the hands of the extra arms, a pair at a time (right, left; null is an open hand). */
const GODS = {
  hindu_shiva: { dress: 'wrap', arms: [['axe', 'flame'], [null, null]] },
  hindu_vishnu: { dress: 'pitambara', arms: [[null, null], ['mace', 'lotus']] },
  hindu_durga: { dress: 'sari', arms: [['discus', 'lotus'], ['trident', 'mace']] },
  hindu_hanuman: { dress: 'loincloth' },
  hindu_vanara: { dress: 'loincloth' },
  hindu_garuda: { dress: 'loincloth' },
};

/** The garment of a unit: wrap (Shiva), pitambara (Vishnu), sari (Durga), loincloth (Hanuman, Garuda), robe (the priest), coat (armored: the soldiers) or dhoti. */
function dressOf(E) {
  const god = GODS[E.ctx.unit.id];
  if (god) return god.dress;
  if (E.robe && E.ctx.cls === 'support') return 'robe';
  return E.armor ? 'coat' : 'dhoti';
}

/** The gold of a unit's jewelry and trim: plain gold for the people, a god's own accent. */
const goldOf = (E) => (E.ctx.mortal ? GOLD : E.pal.accentMetal);

/** Skin torso (a bare chest). */
function bareTorso(E) {
  const { kit, D, bind, skin, skinPaint } = E;
  kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
}

function dhoti(E) {
  // the people: a bare chest, a cotton dhoti with a border; the worker's border and shoulder cloth carry the team's color
  const { kit, D, pal, bind, worker } = E;
  bareTorso(E);
  addDhoti(kit, D, bind, {
    color: worker ? tintC(pal.primary, 0.18) : pal.primary,
    border: worker ? TEAM(0.92) : pal.secondary,
    sash: worker ? null : pal.secondary,
    len: worker ? 0.95 : 0.8,
    loose: worker ? 1 : 0.9,
  });
  if (worker) addDrape(kit, D, bind, TEAM(0.95), GOLD, { side: 1, width: 0.2 });
}

function robe(E) {
  // the priest: a long saffron dhoti with a deep border, a team-colored stole across the chest, a sash at the waist
  const { kit, D, pal, bind } = E;
  bareTorso(E);
  addDhoti(kit, D, bind, { color: pal.primary, border: pal.secondary, fan: shadeC(pal.primary, 0.94), len: 1.1, loose: 1.1 });
  addDrape(kit, D, bind, TEAM(0.95), GOLD, { side: 1, width: 0.3 });
  addWaistBelt(kit, D, bind, shadeC(pal.secondary, 1.0), GOLD);
}

function coat(E) {
  // the soldier: a dhoti in the team's color under the quilted coat (armorLayer), a belt over the join
  const { kit, D, pal, bind, tunicColor } = E;
  bareTorso(E);
  addDhoti(kit, D, bind, { color: tunicColor, border: GOLD, len: 0.55, loose: 0.8 });
  addWaistBelt(kit, D, bind, shadeC(pal.secondary, 0.95), GOLD);
}

function wrap(E) {
  // Shiva: a bare chest, a tiger's skin wrapped about the loins with a cloth knotted at the hip (the team's color), a belt of the same
  const { kit, D, pal, bind } = E;
  bareTorso(E);
  const tiger = shadeC(mixC(pal.secondary, '#d9993f', 0.35), 1);
  addDhoti(kit, D, bind, {
    color: tiger, border: shadeC(tiger, 0.5), sash: TEAM(0.95), len: 0.38, loose: 0.9, fan: shadeC(tiger, 0.92),
    // the black stripes of the hide, slanting across the folds
    mark: (o, x, y, z) => {
      const s = Math.sin(z * 46 + y * 30 + Math.sin(x * 40) * 1.4 + Math.sin(y * 70) * 0.5);
      if (s > 0.55) mul(o, 0.28);
    },
  });
  addWaistBelt(kit, D, bind, TEAM(0.9), pal.accentMetal);
}

function pitambara(E) {
  // Vishnu: a bare chest, a long cloth of yellow silk with a red border, its end knotted at the hip, a belt: both in the team's color
  const { kit, D, pal, bind } = E;
  bareTorso(E);
  addDhoti(kit, D, bind, { color: pal.primary, border: pal.secondary, sash: TEAM(0.95), fan: shadeC(pal.primary, 0.94), len: 1.05, loose: 1.1 });
  addWaistBelt(kit, D, bind, TEAM(0.9), pal.accentMetal);
}

function sari(E) {
  // Durga: a short blouse over the breast, a long red sari with a gold border, its end (the pallu, the team's color) drawn across the chest, a belt of gold
  const { kit, D, pal, bind } = E;
  bareTorso(E);
  kit.loft(torsoStations(D, 0.016, 0.42), { rings: 6, start: null, end: 'round', capDepth: 0.01, color: shadeC(pal.secondary, 0.95), mat: 'cloth', bind: bind.torso, paint: gradY(D.hipY, D.shoulderY, 0.82, 1.02) });
  const sk = addLongSkirt(kit, D, bind, pal.primary, { pleat: 0.012, top: 0.03 });
  addHem(kit, bind, sk, pal.secondary);
  addDrape(kit, D, bind, TEAM(0.95), pal.secondary, { side: -1, width: 0.36 });
  addWaistBelt(kit, D, bind, shadeC(pal.accentMetal, 0.85), pal.accentMetal);
}

function loincloth(E) {
  // Hanuman and Garuda: a short cloth about the loins in the team's color, a border and a belt of gold
  const { kit, D, pal, bind } = E;
  bareTorso(E);
  addDhoti(kit, D, bind, { color: TEAM(0.95), border: pal.accentMetal, len: -0.3, loose: 0.75 });
  addWaistBelt(kit, D, bind, shadeC(pal.accentMetal, 0.82), pal.accentMetal);
}

export function legs(E) {
  const { kit, D, ctx, pal, bind, skin, skinPaint } = E;
  const dress = dressOf(E);
  const robed = dress === 'robe' || dress === 'sari' || dress === 'pitambara';
  const barefoot = E.v.head === 'monkey';
  const knee = D.hipY - D.thigh;
  // a long cloth hides the leg above the knee
  addBareLegs(kit, D, bind, skin, skinPaint, robed ? knee + D.thigh * 0.4 : Infinity);
  addSandals(kit, D, pal, bind, {
    skin, skinPaint,
    sole: barefoot ? skin : mixC(pal.leather, '#c9b27a', 0.4),
    strap: barefoot ? skin : ctx.mortal ? pal.leather : goldOf(E),
  });
  // anklets of gold for the gods and the soldiers
  if (!ctx.mortal || E.armor) {
    const gold = goldOf(E);
    for (const side of [1, -1]) {
      for (const y of [D.ankleY + 0.034, D.ankleY + 0.058]) {
        kit.loft([legRing(D, side, y, 0.01), legRing(D, side, y + 0.014, 0.011)], { sides: 12, start: null, end: null, color: gold, mat: 'gold', bind: bind.leg[side] });
      }
    }
  }
}

export function torso(E) {
  switch (dressOf(E)) {
    case 'robe': robe(E); break;
    case 'coat': coat(E); break;
    case 'wrap': wrap(E); break;
    case 'pitambara': pitambara(E); break;
    case 'sari': sari(E); break;
    case 'loincloth': loincloth(E); break;
    default: dhoti(E);
  }
}

export function arms(E) {
  const { kit, D, ctx, pal, bind, armor, skin, skinPaint } = E;
  const gold = goldOf(E);
  const w = D.shoulderY - 0.02 - D.upper - D.fore;
  // the Vanara's shoulders are round (his torso is too slight to hide the cut end of the tube)
  const vanara = E.v.body === 'beast_biped';
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    kit.loft(armStations(D, side), { rings: 8, start: null, end: vanara ? 'round' : null, capRings: 2, capDepth: 0.022, color: skin, bind: bd, paint: skinPaint });
    if (armor) {
      // a leather bracer on the forearm
      kit.loft([vs(w + 0.012, D.armR * 0.66 + 0.007, D.armR * 0.64 + 0.007, 0, side * D.shoulderZ), vs(w + D.fore * 0.52, D.armR * 0.86 + 0.007, D.armR * 0.84 + 0.007, 0.002, side * D.shoulderZ)],
        { sides: 12, rings: 3, start: null, end: null, color: pal.leather, mat: 'leather', bind: bd });
    } else if (ctx.grand) {
      // a set of gold bangles at the wrist
      for (let i = 0; i < 2; i++) {
        const y = w + 0.018 + i * 0.018;
        kit.loft([vs(y, D.armR * 0.7 + 0.009, D.armR * 0.68 + 0.009, 0.001, side * D.shoulderZ), vs(y + 0.011, D.armR * 0.72 + 0.009, D.armR * 0.7 + 0.009, 0.001, side * D.shoulderZ)],
          { sides: 12, start: null, end: null, color: gold, mat: 'gold', bind: bd });
      }
    }
  }
  if (vanara) addArmBands(kit, D, bind, { upper: gold, wrist: gold });
}

export function armorLayer(E) {
  const { kit, D, pal, bind, armor } = E;
  if (!armor) return;
  addCharAina(kit, D, pal, bind, { color: TEAM(0.9), plate: STEEL, trim: GOLD });
}

export function cloaks(E) {
  const { kit, D, ctx, pal, bind, ex } = E;
  if (!ex.has('cape')) return;
  // a long scarf of the team's color down the back, edged in the second color
  addCape(kit, D, TEAM(1), pal.secondary, shadeC(pal.secondary, 0.7), bind, { len: ctx.mortal ? 0.62 : 0.8, wide: 0.9 });
}

export function head(E) {
  const { kit, D, ctx, v, pal, bind, ex } = E;
  const gear = v.headgear;
  // a monkey's fur or a falcon's feathers are the head's own: no hair over them; a priest's head is shaved but for the knot
  const beast = BEAST_HEADS.has(v.head);
  const shaved = ctx.cls === 'support' && gear === 'topknot';
  const gold = goldOf(E);
  if (!beast && !shaved) addHairCap(kit, D, pal, bind);
  if (gear === 'topknot') {
    addTopknot(kit, D, pal, bind, { band: ctx.worker ? TEAM(0.92) : pal.secondary, size: shaved ? 0.8 : 1 });
  } else if (gear === 'crescent') {
    addCrescent(kit, D, pal, bind, { moon: withMat(mixC(pal.accent, '#f4f6ff', 0.55), 'gem'), band: gold });
  } else if (gear === 'tall_crown') {
    addKirita(kit, D, pal, bind, { metal: gold, trim: gold, gem: RUBY, tiers: 3, height: 1 });
  } else if (gear === 'crown') {
    const prince = ctx.mortal;
    addKirita(kit, D, pal, bind, { metal: gold, trim: gold, gem: RUBY, tiers: prince ? 1 : 2, height: prince ? 0.8 : 0.78, lift: ex.has('third_eye') ? 0.034 : 0 });
  } else if (gear === 'tiara') {
    addTiara(kit, D, pal, bind, { metal: GOLD, gem: mixC(pal.secondary, '#ff5a6a', 0.35) });
  }
  if (ex.has('long_hair') && !beast) addLongHair(kit, D, pal, bind);
}

/** What gods and the people wear on top: earrings, armlets, necklaces and garlands, Hanuman's tail, the extra arms, and the default extras. */
export function extras(E) {
  const { ex, kit, D, ctx, bind } = E;
  const god = GODS[ctx.unit.id];
  const dress = dressOf(E);
  if (ex.has('jewelry')) {
    addJewelry(E, { collar: !!ctx.grand, bands: !!ctx.grand });
    // the garlands: marigolds on the priest, flowers on Vishnu, the beads on Shiva
    if (dress === 'robe') addGarland(kit, D, bind, { colors: MARIGOLD, low: 0.18, r: 0.017, beads: 16 });
    else if (dress === 'pitambara') addGarland(kit, D, bind, { colors: FLOWERS, low: 0.1, r: 0.019, beads: 18 });
    else if (dress === 'wrap') addGarland(kit, D, bind, { colors: RUDRAKSHA, low: 0.3, r: 0.014, beads: 24, mat: 'wood' });
  }
  if (ex.has('tail')) addTail(E, { kind: 'monkey' });
  if (ctx.grand && E.v.body !== 'giant') E.attach.push(addPrabhavali(E));
  if (ex.has('multi_arms') && god && god.arms) E.attach.push(extraArmsPiece(E, god.arms));
  DEFAULT.extras({ ...E, ex: new Set([...ex].filter((e) => e !== 'jewelry' && e !== 'tail' && e !== 'multi_arms')) });
}

/** Hanuman's fur: a streak of lighter and darker hair over every bare surface of the body. */
export function skinPaint(E) {
  return E.v.head === 'monkey' ? furStreaks : null;
}

/** The dhal: a round shield of hide in the team's color, a boss of gold with a ring of studs. */
export const shield = {
  w: 0.185, h: 0.185, sides: 16, face: 'team', pattern: 'rings', disc: { k: 0.34, color: 'metal' }, boss: 'dome', studs: 6, dish: 0.045, rim: GOLD, rimMat: 'gold',
};

export const HINDU = { legs, torso, arms, armor: armorLayer, cloaks, head, extras, skinPaint, shield };
