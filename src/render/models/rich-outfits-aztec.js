// The Aztec look: the loincloth (maxtlatl) and the cloak knotted at the shoulder (tilmatli) for the people, the
// quilted cotton armor (ichcahuipilli) under a crown of feathers, the chimalli with its fringe and the macuahuitl
// set with obsidian for the soldiers, the priest in a long cream robe under the quetzal-feather crown, the eagle
// warrior in his feathered suit with the eagle's head for a helm. The gods dress as the codices paint them:
// Huitzilopochtli blue under the hummingbird helm with a black band across his eyes, in gold quilted armor with his
// shield of down; Tezcatlipoca black with yellow stripes across his face in the pelt of a jaguar, with the smoking
// mirror and a club of obsidian; Tlaloc in the white goggles and fangs of the rain god under a crown of heron
// plumes, and his helpers in a loincloth with a jar of rain. The gods keep the codices' colors, so the team's color
// is a shield face, a crest feather, a headband, bands on the arms or the plumes of a crown. Overrides only the layers
// where the Mexica dress differently from the default (rich-outfit-default.js).
import { TEAM, shadeC, withMat } from './unit-geo.js';
import { vs, ps } from './rich-kit.js';
import { torsoStations, armStations, legFrom, addSandals, addBareLegs } from './rich-body.js';
import {
  addTunic, addCape, addDrape, addGarland, addPauldrons, addPteruges, addLongSkirt, addHem, addSash, addBelt, addAnkles, addFurMantle,
  addMaxtlatl, addIchcahuipilli, addLegBands,
} from './rich-clothing.js';
import {
  addHairCap, addLongHair, addHeadband, addPlumes, addQuetzalFan, addEagleHelm, addHummingbirdHelm, addTlalocMask,
} from './rich-headgear.js';
import { addJewelry, addQuetzalBack } from './rich-regalia.js';
import { feather } from './rich-feathers.js';
import { dye, jaguarSpots, featherRows } from './rich-paint.js';
import { DEFAULT } from './rich-outfit-default.js';

const GOLD = withMat('#dfb54a', 'gold');
const COTTON = withMat('#efe6d0', 'cloth');
const LEATHER = withMat('#6a4528', 'leather');
const TURQUOISE = withMat('#2aa7a0', 'feather');
const QUETZAL = withMat('#2e9a5c', 'feather');
const QUETZAL_DEEP = withMat('#1d7a52', 'feather');
const MACAW = withMat('#c0392d', 'feather');
const BLUE_FEATHER = withMat('#2a62b0', 'feather');
const HERON = withMat('#f3f1ea', 'feather');
const EAGLE_BROWN = withMat('#7b5a3a', 'feather');
const BEAK = withMat('#e0b43c', 'bone');
const IVORY = withMat('#efe8d4', 'bone');
const JADE = withMat('#58c09a', 'gem');
const TURQ_GEM = withMat('#32b8b0', 'gem');
const OBSIDIAN = withMat('#17141c', 'gloss');
const JAGUAR = withMat('#d9a03a', 'fur');
const BLACK_CLOTH = withMat('#1d1a22', 'cloth');
const BLACK_HAIR = withMat('#1b1618', 'hair');

/** The Mexica have black hair, gods and people alike (the shared palette's brown or dark blue is not theirs). */
export function palette(pal) {
  return { ...pal, hair: BLACK_HAIR };
}

/** A team-safe shade of a color. */
const shade = (c, k) => (c && c.team ? TEAM(c.team * k, c.mat) : shadeC(c, k));

/** Who wears what: the people by their work, the rest by name. */
const NAMED = {
  aztec_huitzilopochtli: 'huitzilopochtli',
  aztec_tezcatlipoca: 'tezcatlipoca',
  aztec_tlaloc: 'tlaloc',
  aztec_tlaloque: 'tlaloque',
  aztec_eagle_warrior: 'eagle',
};

/** The dress of a unit: commoner (worshipper), soldier (warrior), archer, priest, or a god's, a helper's or the elite's own. */
function dressOf(E) {
  const named = NAMED[E.ctx.unit.id];
  if (named) return named;
  if (E.worker) return 'macehualli';
  if (E.ctx.cls === 'support') return 'priest';
  return E.armor ? 'warrior' : 'archer';
}

/** The eagle warrior's suit: feathers in the team's color. */
const suitOf = () => TEAM(0.92, 'feather');

/** Skin torso (a bare chest). */
function bareTorso(E) {
  const { kit, D, bind, skin, skinPaint } = E;
  kit.loft(torsoStations(D), { rings: 9, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
}

/** Bare feet in sandals of plaited leather (or barefoot: the sole and straps the color of the skin). */
function sandals(E, strap = LEATHER, sole = shadeC(LEATHER, 0.9)) {
  const { kit, D, pal, bind, skin, skinPaint } = E;
  addSandals(kit, D, pal, bind, { skin, skinPaint, sole, strap });
}

/** A band round the top of each upper arm and a cuff at each wrist. */
function armBands(E, { upper = null, wrist = null, mat = 'gold' } = {}) {
  const { kit, D, bind } = E;
  const w = D.shoulderY - 0.02 - D.upper - D.fore;
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    const z = side * D.shoulderZ;
    if (upper) {
      const y = D.shoulderY - 0.02 - D.upper * 0.42;
      kit.loft([vs(y - 0.016, D.armR * 1.06 + 0.012, D.armR * 1.03 + 0.012, 0, z), vs(y + 0.016, D.armR * 1.07 + 0.012, D.armR * 1.04 + 0.012, 0, z)],
        { sides: 12, start: null, end: null, color: upper, mat, bind: bd });
    }
    if (wrist) {
      kit.loft([vs(w + 0.012, D.armR * 0.66 + 0.009, D.armR * 0.64 + 0.009, 0, z), vs(w + D.fore * 0.5, D.armR * 0.86 + 0.009, D.armR * 0.84 + 0.009, 0.002, z)],
        { sides: 12, rings: 3, start: null, end: null, color: wrist, mat, bind: bd });
    }
  }
}

/** The ears' discs: a round plug of gold or jade set in each lobe. */
function earSpools(E, color, mat = 'gold') {
  const { kit, D, bind } = E;
  const hs = D.hs;
  for (const side of [1, -1]) {
    kit.loft([ps(D.headX - 0.004 * hs, D.headCY - 0.03 * hs, side * 0.1 * hs, 0.016 * hs, 0.016 * hs), ps(D.headX - 0.004 * hs, D.headCY - 0.03 * hs, side * 0.114 * hs, 0.016 * hs, 0.016 * hs)],
      { ref: [1, 0, 0], sides: 10, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * hs, color, mat, bind: bind.head });
  }
}

/** Feathers trailing from each forearm, back and down: the eagle's wings. */
function wingFeathers(E) {
  const { kit, D, bind } = E;
  const w = D.shoulderY - 0.02 - D.upper - D.fore;
  for (const side of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const k = i / 3;
      const root = [-0.012, w + D.fore * (0.14 + 0.62 * k), side * (D.shoulderZ + D.armR * 0.95)];
      feather(kit, root, [-0.45, -0.9, side * 0.45], [0, 0, side], (0.17 - 0.03 * k) * D.k, 0.03 * D.k, {
        color: i % 2 ? EAGLE_BROWN : shadeC(EAGLE_BROWN, 0.85), tip: HERON, bind: bind.arm[side], bend: [-0.03, -0.01, side * 0.01], rows: 4, thick: 0.003,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// legs
// ---------------------------------------------------------------------------

export function legs(E) {
  const { kit, D, pal, bind, skin, skinPaint } = E;
  const dress = dressOf(E);
  switch (dress) {
    case 'macehualli':
      addBareLegs(kit, D, bind, skin, skinPaint);
      sandals(E);
      break;
    case 'tlaloque':
      addBareLegs(kit, D, bind, skin, skinPaint);
      addLegBands(kit, D, bind, { ankle: TURQUOISE });
      sandals(E, skin, skin);
      break;
    case 'warrior':
    case 'archer':
      addBareLegs(kit, D, bind, skin, skinPaint);
      addLegBands(kit, D, bind, { knee: shade(pal.secondary, 0.95), ankle: COTTON });
      sandals(E);
      break;
    case 'eagle':
      // the feathered suit goes to the ankle, a gold anklet over it
      for (const side of [1, -1]) {
        kit.loft(legFrom(D, side, 0.012, D.ankleY + 0.004), {
          rings: 9, start: null, end: null, color: suitOf(), mat: 'feather', bind: bind.leg[side],
          paint: featherRows({ pitch: 0.036, per: 11, cz: side * D.hipZ, dark: 0.7, light: 1.1 }),
        });
      }
      addLegBands(kit, D, bind, { ankle: GOLD, mat: 'gold' });
      sandals(E, GOLD, shadeC(LEATHER, 0.9));
      break;
    case 'priest':
      addAnkles(kit, D, bind, skin, skinPaint, D.ankleY + 0.1);
      sandals(E, GOLD);
      break;
    case 'huitzilopochtli':
      addBareLegs(kit, D, bind, skin, skinPaint);
      addLegBands(kit, D, bind, { knee: GOLD, ankle: GOLD, mat: 'gold' });
      sandals(E, GOLD, shadeC(GOLD, 0.7));
      break;
    case 'tezcatlipoca':
      addBareLegs(kit, D, bind, skin, skinPaint);
      addLegBands(kit, D, bind, { knee: JAGUAR, ankle: JAGUAR, mat: 'fur' });
      sandals(E, pal.secondary, shadeC(LEATHER, 0.8));
      break;
    default: // tlaloc
      addBareLegs(kit, D, bind, skin, skinPaint);
      addLegBands(kit, D, bind, { knee: TURQ_GEM, ankle: TURQ_GEM, mat: 'gem' });
      sandals(E, JADE, shadeC(LEATHER, 0.8));
  }
}

// ---------------------------------------------------------------------------
// torso
// ---------------------------------------------------------------------------

export function torso(E) {
  const { kit, D, pal, bind, tunicColor } = E;
  switch (dressOf(E)) {
    case 'macehualli':
      // a bare chest, the loincloth, and the cloak knotted over one shoulder in the team's color
      bareTorso(E);
      addMaxtlatl(kit, D, bind, { color: pal.primary, border: shade(pal.secondary, 0.95) });
      addDrape(kit, D, bind, tunicColor, pal.secondary, { side: 1, width: 0.4 });
      break;
    case 'warrior':
      // the quilted cotton armor in the team's color, the loincloth's aprons hanging below it
      addMaxtlatl(kit, D, bind, { color: COTTON, border: shade(pal.secondary, 0.95), knot: false });
      addIchcahuipilli(kit, D, bind, { color: tunicColor, trim: pal.secondary, hem: 0.12 });
      break;
    case 'archer':
      bareTorso(E);
      addMaxtlatl(kit, D, bind, { color: pal.primary, border: COTTON });
      break;
    case 'priest': {
      // a long cream robe with a turquoise hem and a broad sash in the team's color
      addTunic(kit, D, pal.primary, bind, 0.08);
      const sk = addLongSkirt(kit, D, bind, pal.primary, { pleat: 0.01, top: 0.03 });
      addHem(kit, bind, sk, pal.secondary, 0.07);
      addSash(kit, D, bind, { color: TEAM(0.95), trim: GOLD, wide: 1.1 });
      break;
    }
    case 'eagle':
      // the feathered suit, rows of feathers lapped like a bird's, a belt of gold
      addTunic(kit, D, suitOf(), bind, 0.1, { mat: 'feather', paint: featherRows({ pitch: 0.04, per: 15, dark: 0.7, light: 1.1 }) });
      addBelt(kit, D, pal, bind, shadeC(LEATHER, 0.9), GOLD);
      break;
    case 'huitzilopochtli':
      addIchcahuipilli(kit, D, bind, { color: pal.primary, trim: pal.secondary, hem: 0.12, mat: 'trim' });
      break;
    case 'tezcatlipoca':
      // black skin bare to the waist, a loincloth of the jaguar's pelt
      bareTorso(E);
      addMaxtlatl(kit, D, bind, { color: JAGUAR, border: GOLD, band: BLACK_CLOTH, mark: jaguarSpots(0.05), mat: 'fur' });
      break;
    case 'tlaloc':
      bareTorso(E);
      addMaxtlatl(kit, D, bind, { color: pal.secondary, border: shade(pal.primary, 0.9) });
      break;
    default: // tlaloque: the loincloth in the team's color, so a crowd of them is told apart
      bareTorso(E);
      addMaxtlatl(kit, D, bind, { color: TEAM(0.95, 'cloth'), border: shade(pal.primary, 0.9) });
  }
}

// ---------------------------------------------------------------------------
// arms
// ---------------------------------------------------------------------------

export function arms(E) {
  const { kit, D, pal, bind, skin, skinPaint } = E;
  const dress = dressOf(E);
  if (dress === 'priest') {
    DEFAULT.arms(E);
    return;
  }
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    if (dress === 'eagle') {
      kit.loft(armStations(D, side, 0.01), {
        rings: 8, start: null, end: 'round', capRings: 2, capDepth: 0.02, color: suitOf(), mat: 'feather', bind: bd,
        paint: featherRows({ pitch: 0.032, per: 9, cz: side * D.shoulderZ, dark: 0.7, light: 1.1 }),
      });
    } else {
      // bare shoulders: round them off
      kit.loft(armStations(D, side), { rings: 8, start: null, end: 'round', capRings: 2, capDepth: 0.022, color: skin, bind: bd, paint: skinPaint });
    }
  }
  switch (dress) {
    case 'warrior':
      armBands(E, { upper: shade(pal.secondary, 0.95), wrist: COTTON, mat: 'cloth' });
      break;
    case 'archer':
      armBands(E, { wrist: COTTON, mat: 'cloth' });
      break;
    case 'eagle':
      armBands(E, { wrist: GOLD });
      wingFeathers(E);
      break;
    case 'huitzilopochtli':
      armBands(E, { upper: GOLD, wrist: GOLD });
      break;
    case 'tezcatlipoca':
      // the team's color on his upper arms, gold at the wrists
      armBands(E, { upper: TEAM(0.95, 'cloth'), mat: 'cloth' });
      armBands(E, { wrist: GOLD });
      break;
    case 'tlaloc':
      armBands(E, { upper: TURQ_GEM, wrist: TURQ_GEM, mat: 'gem' });
      break;
    default: // the helpers
      armBands(E, { wrist: TURQUOISE, mat: 'cloth' });
  }
}

// ---------------------------------------------------------------------------
// armor: the golden armor of the sun god, the feathered skirt
// ---------------------------------------------------------------------------

export function armorLayer(E) {
  const { kit, D, pal, bind, armor } = E;
  if (!armor) return;
  switch (dressOf(E)) {
    case 'eagle':
      addPteruges(kit, D, pal, bind, { color: suitOf(), edge: GOLD, strips: 14, len: 0.9, mat: 'feather' });
      break;
    case 'huitzilopochtli':
      addPteruges(kit, D, pal, bind, { color: TURQUOISE, edge: GOLD, strips: 16, len: 1.1, mat: 'feather' });
      addPauldrons(kit, D, pal, bind, shade(GOLD, 0.95), pal.secondary, 0, { sides: 10, rings: 4 });
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// cloaks, head, extras
// ---------------------------------------------------------------------------

export function cloaks(E) {
  const { kit, D, pal, bind, ex } = E;
  const dress = dressOf(E);
  if (dress === 'tezcatlipoca') {
    // the jaguar's pelt over the shoulders and down the back
    if (ex.has('fur')) addFurMantle(kit, D, { ...pal, fur: JAGUAR }, bind, { paint: jaguarSpots(0.045) });
    if (ex.has('cape')) addCape(kit, D, JAGUAR, BLACK_CLOTH, BLACK_CLOTH, bind, { len: 1, paint: jaguarSpots(0.05), mat: 'fur' });
    return;
  }
  if (!ex.has('cape')) return;
  if (dress === 'tlaloc') addCape(kit, D, pal.primary, pal.secondary, shade(pal.primary, 0.7), bind, { len: 0.95 });
  else addCape(kit, D, TEAM(1), shade(pal.secondary, 0.95), shade(pal.primary, 0.7), bind, { len: 0.62, wide: 0.9 });
}

/** The dresses whose headgear covers the whole crown. */
const COVERED = new Set(['eagle', 'huitzilopochtli']);

/** A round mirror of gold with a face of black glass on the brow. */
function browMirror(E) {
  const { kit, D, bind } = E;
  const hs = D.hs;
  const x = D.headX + 0.112 * hs;
  const y = D.headCY + 0.063 * hs;
  kit.loft([ps(x - 0.004 * hs, y, 0, 0.03 * hs, 0.03 * hs), ps(x + 0.01 * hs, y, 0, 0.03 * hs, 0.03 * hs)],
    { ref: [0, 1, 0], sides: 12, start: 'round', end: 'round', capRings: 1, capDepth: 0.006 * hs, color: GOLD, mat: 'gold', bind: bind.head });
  kit.loft([ps(x + 0.009 * hs, y, 0, 0.021 * hs, 0.021 * hs), ps(x + 0.015 * hs, y, 0, 0.021 * hs, 0.021 * hs)],
    { ref: [0, 1, 0], sides: 12, start: 'round', end: 'round', capRings: 1, capDepth: 0.003 * hs, color: OBSIDIAN, mat: 'gloss', glow: 0.3, bind: bind.head });
}

export function head(E) {
  const { kit, D, pal, bind, ex, tunicColor } = E;
  const dress = dressOf(E);
  // (a helm covers the crown: no cap of hair under it)
  if (!COVERED.has(dress)) addHairCap(kit, D, pal, bind);
  switch (dress) {
    case 'macehualli':
      addPlumes(kit, D, pal, bind, { band: tunicColor, colors: [TURQUOISE, HERON, TURQUOISE], n: 3, len: 0.13, spread: 0.45 });
      break;
    case 'warrior':
      addPlumes(kit, D, pal, bind, { band: GOLD, colors: [TURQUOISE, TEAM(1, 'feather'), QUETZAL, MACAW], n: 7, len: 0.26, width: 0.036, spread: 0.6, tilt: 0.35 });
      earSpools(E, GOLD);
      break;
    case 'archer':
      addPlumes(kit, D, pal, bind, { band: COTTON, colors: [MACAW, TURQUOISE], n: 3, len: 0.16, spread: 0.5 });
      break;
    case 'priest':
      addQuetzalFan(kit, D, pal, bind, { band: GOLD, colors: [QUETZAL, QUETZAL_DEEP, TURQUOISE], inner: MACAW, jade: JADE, n: 7, len: 0.9 });
      break;
    case 'eagle':
      addEagleHelm(kit, D, pal, bind, { plumage: EAGLE_BROWN, tip: HERON, beak: BEAK, eye: BEAK, down: HERON });
      break;
    case 'huitzilopochtli':
      addHummingbirdHelm(kit, D, pal, bind, { gold: GOLD, eye: TURQ_GEM, crest: [TURQUOISE, TEAM(1, 'feather'), BLUE_FEATHER] });
      break;
    case 'tezcatlipoca':
      addHeadband(kit, D, pal, bind, { color: TEAM(0.95, 'cloth'), tails: false });
      browMirror(E);
      break;
    case 'tlaloc':
      addTlalocMask(kit, D, pal, bind, { ring: HERON, fang: IVORY });
      addPlumes(kit, D, pal, bind, { band: JADE, colors: [HERON, TEAM(1, 'feather'), HERON, TURQUOISE], n: 7, len: 0.3, spread: 0.6, tilt: 0.3 });
      break;
    default: // tlaloque
      addTlalocMask(kit, D, pal, bind, { ring: HERON, fang: IVORY });
      addPlumes(kit, D, pal, bind, { band: pal.secondary, colors: [HERON, TEAM(1, 'feather')], n: 3, len: 0.15 });
  }
  if (ex.has('long_hair')) addLongHair(kit, D, pal, bind);
}

/** What gods and the people wear on top: beads and collars, the sun god's feather cloak, the rain god's fan of plumes. */
export function extras(E) {
  const { ex, kit, D, bind } = E;
  const dress = dressOf(E);
  if (ex.has('jewelry')) {
    if (dress === 'priest') {
      addJewelry(E, { collar: false, bands: false });
      addGarland(kit, D, bind, { colors: [JADE, GOLD, TURQ_GEM, GOLD], low: 0.3, r: 0.016, beads: 18, mat: 'gem' });
    } else if (dress === 'tlaloque') {
      addGarland(kit, D, bind, { colors: [TURQ_GEM, JADE], low: 0.12, r: 0.01, beads: 12, mat: 'gem' });
    } else if (dress === 'tlaloc') {
      addJewelry(E, { collar: false, bands: false });
      addGarland(kit, D, bind, { colors: [JADE, TURQ_GEM, JADE, GOLD], low: 0.22, r: 0.02, beads: 20, mat: 'gem' });
    } else addJewelry(E, { collar: true, bands: false });
  }
  if (dress === 'tlaloc') addQuetzalBack(E, { colors: [HERON, TEAM(1, 'feather'), TURQUOISE], inner: HERON, n: 7, len: 0.8 });
  DEFAULT.extras({ ...E, ex: new Set([...ex].filter((e) => e !== 'jewelry')) });
}

/**
 * Style for a held item (rich-humanoid.js asks for it for each hand): the club and the sword are the macuahuitl (obsidian
 * blades set in a paddle; Tezcatlipoca's and Huitzilopochtli's own), the offhand mirror is Tezcatlipoca's smoking mirror of
 * obsidian, the helpers' cauldron a clay jar, the priest's staff of dark wood with a jade orb.
 */
export function gear(ctx, item) {
  const id = ctx.unit.id;
  const pal = ctx.pal;
  if (item.id === 'club' || item.id === 'sword') {
    if (id === 'aztec_huitzilopochtli') return { macuahuitl: true, color: withMat(shadeC(GOLD, 0.82), 'gold'), blade: OBSIDIAN, tassel: pal.secondary };
    if (id === 'aztec_tezcatlipoca') return { macuahuitl: true, color: withMat('#4a3430', 'wood'), blade: OBSIDIAN, tassel: pal.secondary };
    return { macuahuitl: true, tassel: TEAM(0.95, 'cloth') };
  }
  if (item.id === 'mirror') return { obsidian: true };
  if (item.id === 'cauldron') return { jar: true, color: withMat('#b8693c', 'painted'), band: pal.primary };
  if (item.id === 'staff') return { shaftColor: withMat('#3a2a22', 'wood'), orb: JADE };
  return null;
}

/** Face paint: the sun god's black band across his eyes, the Smoking Mirror's stripes of yellow across his black face. */
export function skinPaint(E) {
  const dress = dressOf(E);
  if (dress !== 'huitzilopochtli' && dress !== 'tezcatlipoca') return null;
  const { D } = E;
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const black = withMat('#12131a', 'skin');
  const yellow = withMat('#e6bd32', 'skin');
  return (o, x, y, z) => {
    const dy = (y - hy) / hs;
    // the front of the head only
    if (x < hx || dy < -0.07 || dy > 0.04 || Math.abs(z) > 0.11 * hs) return;
    if (dress === 'huitzilopochtli') {
      if (dy > -0.012 && dy < 0.036) dye(o, black, 0.95);
    } else if ((dy > -0.01 && dy < 0.03) || dy < -0.042) dye(o, yellow, 0.92);
  };
}

/** The chimalli: the team's color in rings, a golden roundel, a fringe of feathers hanging from the rim; the sun god's a plain face with five balls of white down. */
export function shield(ctx) {
  if (ctx.unit.id === 'aztec_huitzilopochtli') {
    return {
      w: 0.2, h: 0.2, sides: 16, face: 'team', pattern: null, boss: null, dish: 0.045, rim: GOLD, rimMat: 'gold',
      puffs: 5, puffColor: HERON, fringe: { n: 7, colors: [HERON, TURQUOISE, GOLD], len: 0.12 },
    };
  }
  return {
    w: 0.19, h: 0.19, sides: 16, face: 'team', pattern: 'rings', disc: { k: 0.42, color: 'metal' }, boss: null, dish: 0.04, rim: GOLD, rimMat: 'gold',
    fringe: { n: 7, colors: [TURQUOISE, QUETZAL, MACAW], len: 0.11 },
  };
}

export const AZTEC = { legs, torso, arms, armor: armorLayer, cloaks, head, extras, gear, palette, skinPaint, shield };
