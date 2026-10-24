// The Mesopotamian look: the people of Sumer, Akkad and Babylon. The kaunakes, a skirt of woolly fleece in tiers, is their
// cloth: the workers wear it short over a bare chest, the priest and the gods to the ankle; a fringed shawl in the team's
// color crosses the shoulder; the beard is squared off in rows of curls and the hair rolled at the nape under a band. The
// soldiers wear a coat of scale and a pointed helmet of iron, laced boots, a cloak in the team's color and carry the tall
// shield with its arched top; the archers a belted tunic and a headband; the Slinger goes bare to the waist, his shawl
// worn across the chest like a bandolier, with the sling in his fist. The gods wear a crown of horns, one pair over
// another: Marduk the lapis blue of Babylon, Ishtar crimson with the star of her planet and wings, Enki in the colors of
// the water with streams running from his shoulders, Nergal in black iron with a lion's pelt and a studded mace. The
// apkallu wears the skin of a fish. The Ugallu, the lion-headed storm demon of Tiamat's brood, is a tawny beast on a man's
// body with the talons of an eagle for feet, a mane about his head and shoulders, a skirt of dark fleece, a shawl in the team's
// color and silver at his arms and his mace. The team's color is the shawl, the cloak, the flap of the helmet, a headband, the
// face of the shield and the apkallu's crest and tail. Overrides only the layers where the Mesopotamians dress differently from
// the default (rich-outfit-default.js).
import { TEAM, shadeC, mixC, withMat } from './unit-geo.js';
import { torsoStations, armStations, addBoots, addBareLegs, addSandals, bootTop } from './rich-body.js';
import {
  addTunic, addBelt, addCape, addDrape, addWaistBelt, addArmBands, addFurMantle, addKaunakes, addScaleCoat, addFringe, addFishCloak,
} from './rich-clothing.js';
import {
  addHairCap, addLongHair, addHeadband, addHornPair, addConeHelm, addHornedTiara, addCurledBeard, addNapeBun, addFishHood,
} from './rich-headgear.js';
import { addWaterStreams } from './rich-regalia.js';
import { addBeastLegs, addTalonFeet, addBeastTail, addLionMane } from './rich-beast.js';
import { furStreaks } from './rich-paint.js';
import { vs } from './rich-kit.js';
import { DEFAULT } from './rich-outfit-default.js';

const GOLD = withMat('#dfb54a', 'gold');
const BRONZE = withMat('#b87a3c', 'gold');
const COPPER = withMat('#b9693a', 'gold');
const IRON = withMat('#8b949e', 'metal');
const SILVER = withMat('#c4c9d0', 'metal');
const BLACK_IRON = withMat('#2b2a30', 'metal');
const LEATHER = withMat('#6a4528', 'leather');
const IVORY = withMat('#e8dfc4', 'bone');
const FLEECE = withMat('#e2d6b6', 'fur');
const FLEECE_DARK = withMat('#7e5e40', 'fur');
const WHITE = withMat('#efe9d8', 'cloth');
const AQUA = withMat('#5cc8ea', 'gem');
const WOOL = withMat('#d6c69a', 'cloth');
const FISH = withMat('#7f9fa4', 'painted');
const FISH_BELLY = withMat('#d9d3b8', 'trim');

/** The hair of the people: black, the soldiers' and workers' alike (the shared palette's browns are not theirs); the gods keep their own. */
const HAIR = '#241b15';

/** A team-safe shade of a color. */
const shade = (c, k) => (c && c.team ? TEAM(c.team * k, c.mat) : shadeC(c, k));

/** A beard a shade lighter than the hair over it: the curls would not show in black. */
const beardOf = (pal) => mixC(pal.hair, '#6b5240', 0.3);

/** Who wears what: the people by their work, the rest by name. */
const NAMED = {
  mesopotamian_marduk: 'marduk',
  mesopotamian_ishtar: 'ishtar',
  mesopotamian_enki: 'enki',
  mesopotamian_nergal: 'nergal',
  mesopotamian_apkallu: 'apkallu',
  mesopotamian_slinger: 'slinger',
  mesopotamian_ugallu: 'ugallu',
};

/** The dress of a unit: worker, warrior, archer, priest, or a god's, the minion's or the elite's own. */
function dressOfCtx(ctx) {
  const named = NAMED[ctx.unit.id];
  if (named) return named;
  if (ctx.worker) return 'worker';
  if (ctx.cls === 'support') return 'priest';
  return ctx.ex.has('armor') ? 'warrior' : 'archer';
}
const dressOf = (E) => dressOfCtx(E.ctx);

/** The people's hair is black; the gods' is what their data says. */
export function palette(pal, ctx) {
  const d = dressOfCtx(ctx);
  return ['worker', 'warrior', 'archer', 'priest', 'slinger'].includes(d) ? { ...pal, hair: withMat(HAIR, 'hair') } : pal;
}

/** A fringed shawl across the chest from one shoulder, the team's color with a border of gold and tassels of wool. */
function shawl(E, { side = -1, width = 0.34, color = null, trim = GOLD, len = 0.042, fringe = WOOL } = {}) {
  const { kit, D, bind } = E;
  const c = color || TEAM(0.95, 'cloth');
  addDrape(kit, D, bind, c, trim, { side, width, cells: [6, 18], fringe: { color: fringe, n: 18, len, r: 0.0045 } });
}

/** Tassels hanging round the hem of a tunic that ends `hem` below the hip. */
function hemFringe(E, hem, color, { n = 22, len = 0.04 } = {}) {
  const { kit, D, bind } = E;
  const y0 = D.hipY - hem + 0.004;
  const at = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    at.push([Math.cos(a) * (D.depth * 0.62 + 0.024), y0, Math.sin(a) * (D.waistW * 0.66 + 0.024)]);
  }
  addFringe(kit, bind.skirt, at, { len, color, r: 0.0055 });
}

/** A band of a color round the hem of a tunic that ends `hem` below the hip. */
function hemBand(E, hem, color, h = 0.045) {
  const { kit, D, bind } = E;
  const y0 = D.hipY - hem;
  kit.loft([vs(y0, D.depth * 0.62 + 0.022, D.waistW * 0.66 + 0.022), vs(y0 + h, D.depth * 0.62 + 0.016, D.waistW * 0.66 + 0.016)], { sides: 24, start: null, end: null, color, mat: 'trim', bind: bind.skirt });
}

// ---------------------------------------------------------------------------
// legs
// ---------------------------------------------------------------------------

export function legs(E) {
  const { kit, D, pal, bind, skin, skinPaint } = E;
  switch (dressOf(E)) {
    case 'worker':
      // bare legs, sandals
      addBareLegs(kit, D, bind, skin, skinPaint);
      addSandals(kit, D, pal, bind, { skin, skinPaint, strap: LEATHER, sole: shade(LEATHER, 0.8) });
      break;
    case 'ugallu':
      // fur on the thigh, the shank thin and scaled like a bird's, the feet an eagle's with claws of silver
      addBeastLegs(E, { color: skin, paint: skinPaint, lower: 0.74 });
      addTalonFeet(E, { color: shade(skin, 0.8), claw: SILVER, clawMat: 'metal' });
      break;
    case 'warrior':
    case 'nergal':
      // bare to the knee under the skirt, laced boots to the calf
      addBareLegs(kit, D, bind, skin, skinPaint);
      addBoots(kit, D, pal, bind, LEATHER, shade(LEATHER, 0.8), { top: bootTop(D) + 0.02 });
      break;
    case 'archer':
    case 'slinger':
      addBareLegs(kit, D, bind, skin, skinPaint);
      addBoots(kit, D, pal, bind, shade(LEATHER, 0.95), shade(LEATHER, 0.8), { top: D.ankleY + 0.1 });
      break;
    default:
      // the long robes: only the shoes show
      addBoots(kit, D, pal, bind, shade(LEATHER, 0.9), null, { top: D.ankleY + 0.05 });
  }
}

// ---------------------------------------------------------------------------
// torso
// ---------------------------------------------------------------------------

export function torso(E) {
  const { kit, D, pal, bind, skin, skinPaint, tunicColor } = E;
  switch (dressOf(E)) {
    case 'worker':
      // a bare chest over a short skirt of fleece, a rope for a belt
      kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
      addKaunakes(kit, D, bind, { color: FLEECE, color2: shade(FLEECE, 0.9), tiers: 2, len: 0.55, flare: 0.9, tufts: 9, depth: 0.03 });
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.9), COPPER, 'leather', 0.04);
      break;
    case 'warrior':
      // the tunic under the coat of scale, the fleece over the thighs
      addTunic(kit, D, tunicColor, bind, 0.05);
      addKaunakes(kit, D, bind, { color: FLEECE, color2: shade(FLEECE, 0.88), tiers: 2, len: 0.56, flare: 0.9, tufts: 9, depth: 0.03 });
      break;
    case 'archer':
      // a belted tunic to mid-thigh with a border at its hem
      addTunic(kit, D, tunicColor, bind, 0.2, { skirted: true });
      hemBand(E, 0.2, TEAM(0.9, 'trim'));
      hemFringe(E, 0.2, WOOL);
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.9), BRONZE, 'leather', 0.04);
      break;
    case 'slinger':
      // bare to the waist under a bandolier, a short skirt of dark fleece
      kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
      addKaunakes(kit, D, bind, { color: FLEECE_DARK, color2: shade(FLEECE_DARK, 0.88), tiers: 2, len: 0.5, flare: 0.9, tufts: 9, depth: 0.03 });
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.85), BRONZE, 'leather', 0.04);
      break;
    case 'priest':
      // a cream robe, fleece to the ankles, a broad belt
      addTunic(kit, D, tunicColor, bind, 0.04);
      addKaunakes(kit, D, bind, { color: FLEECE, color2: shade(FLEECE, 0.9), tiers: 3, len: 1, flare: 1, tufts: 10 });
      addWaistBelt(kit, D, bind, shade(pal.secondary, 1.0), GOLD);
      break;
    case 'marduk':
      addTunic(kit, D, shade(pal.primary, 0.9), bind, 0.04);
      addKaunakes(kit, D, bind, { color: shade(pal.primary, 1.0), color2: shade(pal.primary, 1.22), tiers: 4, len: 1, flare: 1.1, tufts: 10 });
      addWaistBelt(kit, D, bind, GOLD, GOLD);
      break;
    case 'ishtar':
      addTunic(kit, D, shade(pal.primary, 0.9), bind, 0.04);
      addKaunakes(kit, D, bind, { color: shade(pal.primary, 1.0), color2: shade(pal.primary, 1.18), tiers: 4, len: 1, flare: 1.05, tufts: 10 });
      addWaistBelt(kit, D, bind, GOLD, GOLD);
      break;
    case 'enki':
      addTunic(kit, D, shade(pal.primary, 0.9), bind, 0.04);
      addKaunakes(kit, D, bind, { color: shade(pal.primary, 1.0), color2: shade(pal.secondary, 0.98), tiers: 4, len: 1, flare: 1.05, tufts: 10 });
      addWaistBelt(kit, D, bind, shade(pal.secondary, 1.0), GOLD);
      break;
    case 'nergal':
      addTunic(kit, D, shade(pal.primary, 0.8), bind, 0.05);
      addKaunakes(kit, D, bind, { color: shade(pal.primary, 0.9), color2: shade(pal.primary, 0.72), tiers: 3, len: 0.62, flare: 1, tufts: 9, depth: 0.034 });
      break;
    case 'apkallu':
      addTunic(kit, D, tunicColor, bind, 0.04);
      addKaunakes(kit, D, bind, { color: withMat('#efe7d0', 'fur'), color2: shade(FLEECE, 0.92), tiers: 3, len: 1, flare: 1, tufts: 9 });
      addWaistBelt(kit, D, bind, shade(pal.primary, 0.9), GOLD);
      break;
    case 'ugallu':
      // a bare furred chest over a skirt of dark fleece, a broad belt of leather and silver
      kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
      addKaunakes(kit, D, bind, { color: withMat(pal.primary, 'fur'), color2: shade(pal.primary, 0.84), tiers: 2, len: 0.5, flare: 0.9, tufts: 9, depth: 0.03 });
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.8), SILVER, 'leather', 0.045);
      break;
    default:
      DEFAULT.torso(E);
  }
}

// ---------------------------------------------------------------------------
// arms
// ---------------------------------------------------------------------------

export function arms(E) {
  const { kit, D, bind, skin, skinPaint } = E;
  const dress = dressOf(E);
  if (['worker', 'slinger', 'marduk', 'ishtar', 'nergal', 'ugallu'].includes(dress)) {
    // bare arms, bands of metal about them
    for (const side of [1, -1]) {
      kit.loft(armStations(D, side), { rings: 8, start: null, end: 'round', capRings: 2, capDepth: 0.022, color: skin, bind: bind.arm[side], paint: skinPaint });
    }
    const grand = dress === 'marduk' || dress === 'ishtar';
    addArmBands(kit, D, bind, { upper: dress === 'ugallu' ? SILVER : grand ? GOLD : dress === 'nergal' ? BRONZE : COPPER, wrist: dress === 'worker' ? null : dress === 'ugallu' ? SILVER : grand ? GOLD : BRONZE });
    return;
  }
  DEFAULT.arms(E);
}

// ---------------------------------------------------------------------------
// armor: the coat of scale
// ---------------------------------------------------------------------------

export function armorLayer(E) {
  const { kit, D, pal, bind, armor } = E;
  if (!armor) return;
  switch (dressOf(E)) {
    case 'warrior':
      addScaleCoat(kit, D, bind, { color: IRON, trim: LEATHER, rows: 6, hem: 0.1 });
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.9), BRONZE, 'leather', 0.05);
      break;
    case 'nergal':
      addScaleCoat(kit, D, bind, { color: BLACK_IRON, trim: BRONZE, rows: 6, hem: 0.12 });
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.7), GOLD, 'leather', 0.05);
      break;
    default:
      DEFAULT.armor(E);
  }
}

// ---------------------------------------------------------------------------
// cloaks
// ---------------------------------------------------------------------------

export function cloaks(E) {
  const { kit, D, pal, bind, ex } = E;
  switch (dressOf(E)) {
    case 'worker':
      shawl(E, { side: -1, width: 0.34 });
      break;
    case 'warrior':
      addCape(kit, D, TEAM(0.95, 'cloth'), BRONZE, shade(pal.primary, 0.55), bind, { len: 0.72, wide: 0.9 });
      break;
    case 'archer':
      if (ex.has('cape')) addCape(kit, D, TEAM(0.95, 'cloth'), shade(pal.secondary, 0.95), shade(pal.primary, 0.55), bind, { len: 0.62, wide: 0.85 });
      break;
    case 'slinger':
      shawl(E, { side: -1, width: 0.3 });
      break;
    case 'ugallu':
      shawl(E, { side: -1, width: 0.34, trim: SILVER, fringe: SILVER });
      break;
    case 'priest':
      shawl(E, { side: 1, width: 0.4, len: 0.05 });
      break;
    case 'marduk':
      addCape(kit, D, TEAM(0.95, 'cloth'), GOLD, shade(pal.primary, 0.6), bind, { len: 1.05, wide: 1.05 });
      break;
    case 'ishtar':
      shawl(E, { side: -1, width: 0.36, fringe: GOLD });
      break;
    case 'enki':
      shawl(E, { side: 1, width: 0.36, fringe: GOLD });
      break;
    case 'nergal':
      // the pelt of a lion over the shoulders, a cloak in the team's color under it
      addCape(kit, D, TEAM(0.9, 'cloth'), BRONZE, shade(pal.primary, 0.5), bind, { len: 0.95, wide: 1 });
      addFurMantle(kit, D, { ...pal, fur: withMat('#b98a4c', 'fur') }, bind);
      break;
    case 'apkallu':
      // the skin of a fish down the back, the tail fin in the team's color
      addFishCloak(kit, D, bind, { color: FISH, belly: shade(FISH, 0.7), fin: TEAM(0.95, 'cloth') });
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// head
// ---------------------------------------------------------------------------

export function head(E) {
  const { kit, D, pal, bind, ex } = E;
  const beard = beardOf(pal);
  switch (dressOf(E)) {
    case 'worker':
      addHairCap(kit, D, pal, bind);
      addNapeBun(kit, D, pal, bind, { size: 0.9 });
      addCurledBeard(kit, D, pal, bind, { len: 0.8, color: beard });
      break;
    case 'warrior':
      addConeHelm(kit, D, pal, bind, { steel: IRON, trim: BRONZE, flap: TEAM(0.9, 'cloth') });
      addCurledBeard(kit, D, pal, bind, { len: 0.85, color: beard });
      break;
    case 'archer':
      addHairCap(kit, D, pal, bind);
      addNapeBun(kit, D, pal, bind);
      addHeadband(kit, D, pal, bind, { color: WHITE });
      addCurledBeard(kit, D, pal, bind, { len: 0.8, color: beard });
      break;
    case 'slinger':
      addHairCap(kit, D, pal, bind);
      addNapeBun(kit, D, pal, bind);
      addHeadband(kit, D, pal, bind, { color: TEAM(0.95, 'cloth') });
      addCurledBeard(kit, D, pal, bind, { len: 0.8, color: beard });
      break;
    case 'priest':
      // a shaved head under a plain tall cap of white felt with its gold rings: the horns are the gods'
      addHornedTiara(kit, D, pal, bind, { cap: WHITE, trim: GOLD, tiers: 1, tall: 1.5, horns: false });
      addCurledBeard(kit, D, pal, bind, { len: 1, color: beard });
      break;
    case 'marduk':
      addHairCap(kit, D, pal, bind);
      addLongHair(kit, D, pal, bind);
      addHornedTiara(kit, D, pal, bind, { cap: shade(pal.primary, 1.1), horn: GOLD, trim: GOLD, tiers: 3, tall: 1.15 });
      addCurledBeard(kit, D, pal, bind, { len: 1.1, wide: 1.05, color: beard });
      break;
    case 'ishtar':
      addHairCap(kit, D, pal, bind);
      if (ex.has('long_hair')) addLongHair(kit, D, pal, bind);
      addHornedTiara(kit, D, pal, bind, { cap: WHITE, horn: GOLD, trim: GOLD, tiers: 3, star: GOLD });
      break;
    case 'enki':
      addHairCap(kit, D, pal, bind);
      addLongHair(kit, D, pal, bind);
      addHornedTiara(kit, D, pal, bind, { cap: WHITE, horn: IVORY, hornMat: 'bone', trim: GOLD, tiers: 3 });
      addCurledBeard(kit, D, pal, bind, { len: 1.15, wide: 1.05, color: beard });
      break;
    case 'nergal':
      addConeHelm(kit, D, pal, bind, { steel: BLACK_IRON, trim: BRONZE, flap: TEAM(0.8, 'cloth'), tall: 1.1 });
      addHornPair(kit, D, bind, pal.horn, 0.014 * D.hs, 1.1);
      addLongHair(kit, D, pal, bind);
      addCurledBeard(kit, D, pal, bind, { len: 1.05, wide: 1.05, color: beard });
      break;
    case 'ugallu':
      // the head is a lion's: no hair, no cap (the mane is the extras')
      break;
    case 'apkallu':
      // the head of a fish over the head of the sage, the crest in the team's color
      addFishHood(kit, D, pal, bind, { color: FISH, belly: FISH_BELLY, fin: TEAM(0.95, 'cloth') });
      addCurledBeard(kit, D, pal, bind, { len: 0.95, color: beard });
      break;
    default:
      DEFAULT.head(E);
  }
}

// ---------------------------------------------------------------------------
// extras
// ---------------------------------------------------------------------------

export function extras(E) {
  const { ex, pal } = E;
  if (dressOf(E) === 'enki') addWaterStreams(E, { color: AQUA });
  if (dressOf(E) === 'ugallu') {
    // the mane of a lion over the head and the shoulders, a lion's tail with its tuft
    if (ex.has('mane')) addLionMane(E, { color: shade(pal.skin, 0.6), dark: shade(pal.skin, 0.4), tip: shade(pal.skin, 0.22) });
    if (ex.has('tail')) addBeastTail(E, { kind: 'lion', tip: shade(pal.skin, 0.3), len: 0.74 });
  }
  DEFAULT.extras({ ...E, ex: new Set([...ex].filter((e) => e !== 'mane' && e !== 'tail')) });
}

/** The fur of the Ugallu: a streak of lighter and darker hair over every bare surface of the body. */
export function skinPaint(E) {
  return E.v.body === 'beast_biped' ? furStreaks : null;
}

/**
 * Style for a held item (rich-humanoid.js asks for it for each hand): the sling (built by rich-gear.js although the whip is not
 * among its weapons), the spears with a shaft of pale reed-wood, Nergal's mace of black iron with a studded pear for a head.
 */
export function gear(ctx, item) {
  const id = ctx.unit.id;
  switch (item.id) {
    case 'whip':
      return { build: true };
    case 'spear':
      return { shaftColor: withMat('#c9a56a', 'wood') };
    case 'mace':
      return { head: 'pear', color: id === 'mesopotamian_nergal' ? BLACK_IRON : IRON };
    default:
      return null;
  }
}

/** The tall shield: a rectangle of woven reed closing in an arch at the top, the team's color on its face, a rim and a band and studs of bronze. */
export function shield() {
  return {
    w: 0.115, h: 0.25, n: 4.2, sides: 24, face: 'team', pattern: 'wicker', boss: null, dish: 0.028, arch: 0.38,
    rim: BRONZE, rimMat: 'gold', band: 0.9, bandColor: BRONZE,
    roundels: [-0.6, -0.1, 0.4].flatMap((y) => [-0.5, 0.5].map((x) => ({ x, y, k: 0.08, color: BRONZE, mat: 'gold', sides: 8 }))),
  };
}

export const MESOPOTAMIAN = { legs, torso, arms, armor: armorLayer, cloaks, head, extras, gear, palette, skinPaint, shield };
