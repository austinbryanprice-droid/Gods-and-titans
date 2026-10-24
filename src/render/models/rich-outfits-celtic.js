// The Celtic look: the people in a woven check (tartan) and pinned cloaks, bare of the Greek or Norse cut. The commoners
// wear long dresses under a plaid shawl pinned at the shoulder; the soldiers trews in the check, a mail shirt (lorica
// hamata) over a woolen tunic, a plaid brat on their shoulders with a penannular brooch and the tall oval shield with its
// spine and its boss; the archers a hood and the same cloak; the druid a long cream robe with the golden torc, a wreath of
// oak and antlers on his head, an oak staff with a crescent of gold. The Woad Raiders go bare to the waist, their skin
// painted in bands of blue, their hair limed into spikes, a plaid slung over one shoulder and a double axe in their hands.
// The gods dress as the tales tell: the Dagda a short brown tunic under a fur mantle and a club of oak; the Morrigan in a
// black gown and wide sleeves, a raven on her shoulder and a crown of its feathers; Lugh in golden mail under a plaid cloak
// and a crown of rays; Brigid in white with a crown of flame and a torch; Balor a giant in a plaid kilt and black iron with a
// great iron torc. The team's color is the plaid: a cloak, a shawl, trews, a kilt. Overrides only the layers where the
// Celts dress differently from the default (rich-outfit-default.js).
import { TEAM, shadeC, withMat } from './unit-geo.js';
import { torsoStations, armStations, addBoots, addBareLegs } from './rich-body.js';
import {
  addTunic, addBelt, addCape, addChlamys, addDrape, addSash, addLongSkirt, addHem, addLegWraps, addWrapSkirt, addWideSleeves,
  addTorc, addBrooch, addMailShirt, addTrews, addArmBands,
} from './rich-clothing.js';
import {
  addHairCap, addLongHair, addBeard, addHairSpikes, addPlumes, addLaurel, addCrown, addAntlers,
} from './rich-headgear.js';
import { addFlameCrown, addRaven } from './rich-regalia.js';
import { dye, tartan } from './rich-paint.js';
import { DEFAULT } from './rich-outfit-default.js';

const GOLD = withMat('#dfb54a', 'gold');
const BRONZE = withMat('#b87a3c', 'gold');
const SILVER = withMat('#c9d0da', 'metal');
const IRON = withMat('#8b949e', 'metal');
const DARK_IRON = withMat('#4b4f58', 'metal');
const BLACK_IRON = withMat('#2b2a30', 'metal');
const LEATHER = withMat('#6a4528', 'leather');
const OAK_WOOD = withMat('#5a4026', 'wood');
const BONE = withMat('#ebe3cf', 'bone');
const OAK_LEAF = withMat('#55823a', 'cloth');
const GREEN = withMat('#2f6b3a', 'cloth');
const RUST = withMat('#8a4a2a', 'cloth');
const BLUE_WOOL = withMat('#2a5aa0', 'cloth');
const WOOL = withMat('#cdb98e', 'cloth');
const BLACK_CLOTH = withMat('#1c1a22', 'cloth');
const RAVEN = withMat('#17151d', 'feather');
const RAVEN_BLUE = withMat('#3a4478', 'feather');
const RUBY = withMat('#c0262e', 'gem');
const SAPPHIRE = withMat('#3a6ad0', 'gem');
const EMBER = withMat('#ff9a3a', 'gem');
const WOAD = withMat('#26428e', 'skin');
const FAIR = withMat('#d4b092', 'skin');

/** The hair of the people: the red of the soldiers' and workers', the archers' straw, the druid's white, the raiders' limed straw. */
const HAIR = { commoner: '#8a4a24', warrior: '#9a5428', archer: '#b08a48', druid: '#e8e4da', raider: '#dccb8c' };

/** A team-safe shade of a color. */
const shade = (c, k) => (c && c.team ? TEAM(c.team * k, c.mat) : shadeC(c, k));

/** Who wears what: the people by their work, the rest by name. */
const NAMED = {
  celtic_the_dagda: 'dagda',
  celtic_the_morrigan: 'morrigan',
  celtic_lugh: 'lugh',
  celtic_brigid: 'brigid',
  celtic_balor: 'balor',
  celtic_woad_raider: 'raider',
};

/** The dress of a unit: commoner (worshipper), warrior, archer, druid (priest), or a god's, a giant's or the elite's own. */
function dressOfCtx(ctx) {
  const named = NAMED[ctx.unit.id];
  if (named) return named;
  if (ctx.worker) return 'commoner';
  if (ctx.cls === 'support') return 'druid';
  return ctx.ex.has('armor') ? 'warrior' : 'archer';
}
const dressOf = (E) => dressOfCtx(E.ctx);

/** The people's hair is told apart by the dress (the shared palette's browns are not theirs); the gods keep their own. */
export function palette(pal, ctx) {
  const hair = HAIR[dressOfCtx(ctx)];
  return hair ? { ...pal, hair: withMat(hair, 'hair') } : pal;
}

/** Soft ankle shoes of leather (the trews end over them). */
function shoes(E, color = LEATHER) {
  const { kit, D, pal, bind } = E;
  addBoots(kit, D, pal, bind, color, shade(color, 0.85), { top: D.ankleY + 0.05 });
}

/** A brooch pinning a cloak at the shoulder, set on the collar (see addChlamys), forward of the shoulder's point; side 1 the right. */
function pin(E, { side = 1, color = BRONZE, gem = null, size = 0.95 } = {}) {
  const { kit, D, bind } = E;
  const K = D.k;
  const th = 0.8;
  const rx = 0.1065 * K;
  const rz = 0.182 * K;
  const c = [-0.0115 + rx * Math.cos(th), D.shoulderY - 0.004, side * rz * Math.sin(th)];
  const n = [Math.cos(th) / rx, 0.45, (side * Math.sin(th)) / rz];
  const l = Math.hypot(...n);
  const off = 0.016 * size * K;
  addBrooch(kit, D, bind, { color, gem, size, at: { c: [c[0] + (n[0] / l) * off, c[1] + (n[1] / l) * off, c[2] + (n[2] / l) * off], n } });
}

/**
 * The brat: a cloak of plaid down the back, in the team's color with `hue` in its stripes; with `collar` it also lies over both
 * shoulders (not over mail, which it would show through).
 */
function brat(E, { hue = GREEN, hem = null, len = 0.62, wide = 0.9, cell = 0.14, color = null, collar = true } = {}) {
  const { kit, D, pal, bind } = E;
  const opts = { len, wide, cells: [14, 10], paint: tartan({ cell, hue, flat: true, k: 0.66 }) };
  const [c, h, l] = [color || TEAM(0.95, 'cloth'), hem || shade(pal.secondary, 0.95), shade(pal.primary, 0.62)];
  if (collar) addChlamys(kit, D, c, h, l, bind, null, opts);
  else addCape(kit, D, c, h, l, bind, opts);
}

// ---------------------------------------------------------------------------
// legs
// ---------------------------------------------------------------------------

export function legs(E) {
  const { kit, D, pal, bind, skin, skinPaint } = E;
  const trews = (o) => addTrews(kit, D, bind, { from: D.ankleY + 0.036, ...o });
  switch (dressOf(E)) {
    case 'warrior':
      trews({ color: TEAM(0.92, 'cloth'), hue: GREEN, cell: 0.1 });
      shoes(E);
      break;
    case 'archer':
      trews({ color: shade(pal.primary, 0.85), hue: RUST, cell: 0.1 });
      shoes(E);
      break;
    case 'raider':
      trews({ color: TEAM(0.92, 'cloth'), hue: withMat('#2a2420', 'cloth'), cell: 0.12 });
      shoes(E, shade(LEATHER, 0.9));
      break;
    case 'lugh':
      trews({ color: BLUE_WOOL, hue: GOLD, cell: 0.11 });
      shoes(E, shade(LEATHER, 1.1));
      break;
    case 'dagda':
      // the legs bare, bound with cloth from the ankle to the knee, shoes of hide
      addBareLegs(kit, D, bind, skin, skinPaint);
      addLegWraps(kit, D, bind, RUST, 12);
      shoes(E, shade(LEATHER, 0.9));
      break;
    case 'morrigan':
      // (the gown hides them)
      addBoots(kit, D, pal, bind, shade(pal.primary, 0.9), null, { top: D.ankleY + 0.05 });
      break;
    case 'balor':
      DEFAULT.legs(E);
      addLegWraps(kit, D, bind, shade(LEATHER, 0.8), 12);
      break;
    default: // the long dresses
      DEFAULT.legs(E);
  }
}

// ---------------------------------------------------------------------------
// torso
// ---------------------------------------------------------------------------

export function torso(E) {
  const { kit, D, pal, bind, skin, skinPaint, tunicColor } = E;
  switch (dressOf(E)) {
    case 'warrior':
      // the woolen tunic under the mail; the shirt and the belt are the armor's
      addTunic(kit, D, tunicColor, bind, 0.09);
      break;
    case 'raider':
      // bare to the waist, painted; a belt of leather with a bronze buckle
      kit.loft(torsoStations(D), { rings: 24, sides: 26, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
      addBelt(kit, D, pal, bind, LEATHER, BRONZE);
      addDrape(kit, D, bind, TEAM(0.95, 'cloth'), null, {
        side: 1, width: 0.44, cells: [8, 26], paint: tartan({ cell: 0.1, hue: withMat('#2a2420', 'cloth'), flat: true, k: 0.74 }),
      });
      break;
    case 'dagda':
      // a short brown tunic, hem above the knee, a broad belt with a bronze buckle
      addTunic(kit, D, shade(pal.primary, 1.0), bind, 0.2, { mat: 'cloth' });
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.9), BRONZE, 'leather', 0.034);
      break;
    case 'morrigan': {
      // a black gown to the ankle, a team-colored band at its hem and a sash at the waist
      addTunic(kit, D, pal.primary, bind, 0.04);
      const sk = addLongSkirt(kit, D, bind, pal.primary, { pleat: 0.012, top: 0.03, flare: 1.12 });
      addHem(kit, bind, sk, TEAM(0.9, 'cloth'), 0.07);
      addSash(kit, D, bind, { color: TEAM(0.95), trim: SILVER, wide: 1.2 });
      break;
    }
    case 'lugh':
      // a blue tunic under the golden mail
      addTunic(kit, D, shade(pal.secondary, 0.95), bind, 0.1);
      break;
    case 'balor': {
      // a kilt of plaid to the knee over the dark tunic
      addTunic(kit, D, tunicColor, bind, 0.05);
      const r = D.waistW * 0.5 + 0.1;
      addWrapSkirt(kit, D, bind, {
        color: TEAM(0.9, 'cloth'), len: 1, flare: 1.15, mat: 'cloth', mark: tartan({ cell: 0.3, hue: BLACK_CLOTH, r, cx: 0, cz: 0, k: 0.7 }),
      });
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.7), BRONZE, 'leather', 0.05);
      break;
    }
    case 'druid':
      // the cream robe with a stole in the team's color
      DEFAULT.torso(E);
      addSash(kit, D, bind, { color: TEAM(0.95), trim: GOLD, wide: 1.1 });
      break;
    default:
      // the commoner's dress, the archer's tunic
      DEFAULT.torso(E);
  }
}

// ---------------------------------------------------------------------------
// arms
// ---------------------------------------------------------------------------

export function arms(E) {
  const { kit, D, ctx, pal, bind, skin, skinPaint } = E;
  const dress = dressOf(E);
  if (dress === 'raider' || dress === 'dagda') {
    // bare arms, bronze rings above the elbow
    for (const side of [1, -1]) {
      kit.loft(armStations(D, side), { rings: 8, start: null, end: 'round', capRings: 2, capDepth: 0.022, color: skin, bind: bind.arm[side], paint: skinPaint });
    }
    addArmBands(kit, D, bind, { upper: BRONZE, wrist: dress === 'dagda' ? GOLD : null });
    return;
  }
  if (dress === 'morrigan') {
    // wide sleeves hanging from the wrist, a crimson band at their hem
    for (const side of [1, -1]) {
      kit.loft(armStations(D, side).slice(0, 4), { rings: 5, start: null, end: null, color: skin, bind: bind.arm[side], paint: skinPaint });
    }
    addWideSleeves(kit, D, bind, { color: pal.primary, trim: pal.secondary, wide: 0.95 });
    return;
  }
  if (dress === 'lugh') {
    DEFAULT.arms({ ...E, ctx: { ...ctx, sleeve: shade(pal.secondary, 0.95), sleeveTrim: GOLD } });
    return;
  }
  DEFAULT.arms(E);
}

// ---------------------------------------------------------------------------
// armor: the mail
// ---------------------------------------------------------------------------

export function armorLayer(E) {
  const { kit, D, pal, bind, armor } = E;
  if (!armor) return;
  switch (dressOf(E)) {
    case 'warrior':
      addMailShirt(kit, D, bind, { color: IRON, sleeves: false, hem: 0.16, trim: LEATHER });
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.9), BRONZE, 'leather', 0.05);
      break;
    case 'lugh':
      addMailShirt(kit, D, bind, { color: withMat('#e9c552', 'lacquer'), sleeves: true, hem: 0.18, trim: GOLD, mat: 'lacquer' });
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.9), GOLD, 'leather', 0.05);
      break;
    case 'raider':
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
    case 'commoner':
      // a plaid shawl over one shoulder, pinned
      addDrape(kit, D, bind, WOOL, null, {
        side: -1, width: 0.46, cells: [8, 26], paint: tartan({ cell: 0.1, hue: GREEN, flat: true, k: 0.62 }),
      });
      break;
    case 'warrior':
      brat(E, { len: 0.55, wide: 0.85, collar: false });
      pin(E, { side: 1 });
      break;
    case 'archer':
      // (the hood covers the shoulders: no collar, no pin)
      if (ex.has('cape')) brat(E, { len: 0.62, wide: 0.9, hue: RUST, collar: false });
      break;
    case 'dagda':
      // the fur of a beast over the shoulders, the plaid brat hanging from under it down his back
      DEFAULT.cloaks({ ...E, ex: new Set([...ex].filter((e) => e !== 'cape')) });
      addCape(kit, D, TEAM(0.95, 'cloth'), GOLD, shade(pal.primary, 0.62), bind, {
        len: 0.78, wide: 1.05, cells: [14, 10], paint: tartan({ cell: 0.16, hue: GREEN, flat: true, k: 0.66 }),
      });
      pin(E, { side: 1, color: GOLD, size: 1.25 });
      break;
    case 'lugh':
      brat(E, { len: 0.9, wide: 1.0, hue: GOLD, hem: GOLD, cell: 0.15, collar: false });
      pin(E, { side: 1, color: GOLD, gem: SAPPHIRE, size: 1.1 });
      break;
    case 'brigid':
      brat(E, { len: 0.95, wide: 1.0, hue: GREEN, hem: shade(pal.accent, 0.9), cell: 0.15 });
      pin(E, { side: 1, color: GOLD, gem: EMBER, size: 1.0 });
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
  switch (dressOf(E)) {
    case 'druid':
      addHairCap(kit, D, pal, bind);
      addLongHair(kit, D, pal, bind);
      addAntlers(kit, D, pal, bind, { color: BONE, band: LEATHER, size: 1, tines: 3 });
      addLaurel(kit, D, pal, bind, { leaf: OAK_LEAF, per: 8, big: 0.75 });
      addBeard(kit, D, pal, bind);
      break;
    case 'raider':
      addHairCap(kit, D, pal, bind);
      addHairSpikes(kit, D, pal, bind, { n: 9, len: 1.05, lift: 1 });
      addBeard(kit, D, pal, bind);
      break;
    case 'morrigan':
      addHairCap(kit, D, pal, bind);
      addPlumes(kit, D, pal, bind, { band: SILVER, colors: [RAVEN, RAVEN_BLUE, RAVEN], tip: RAVEN_BLUE, n: 5, len: 0.2, width: 0.03, spread: 0.42, tilt: 0.6 });
      if (ex.has('long_hair')) addLongHair(kit, D, pal, bind);
      break;
    case 'lugh':
      addHairCap(kit, D, pal, bind);
      addCrown(kit, D, pal, bind, { metal: GOLD, gem: withMat('#ffe9a0', 'gem'), points: 9, height: 1.55, band: 0.032 });
      if (ex.has('long_hair')) addLongHair(kit, D, pal, bind);
      break;
    case 'brigid':
      addHairCap(kit, D, pal, bind);
      if (ex.has('long_hair')) addLongHair(kit, D, pal, bind);
      break;
    default:
      // hoods, bare heads, Balor's horns
      DEFAULT.head(E);
  }
}

// ---------------------------------------------------------------------------
// extras
// ---------------------------------------------------------------------------

/** The torc: the Celts' neck ring, gold for the great, bronze for the soldiers, iron for the giant. */
export function extras(E) {
  const { kit, D, bind, ex } = E;
  switch (dressOf(E)) {
    case 'warrior':
      addTorc(kit, D, bind, { color: BRONZE, big: 0.85 });
      break;
    case 'raider':
      addTorc(kit, D, bind, { color: GOLD, big: 1.05 });
      break;
    case 'druid':
      addTorc(kit, D, bind, { color: GOLD, big: 1 });
      break;
    case 'dagda':
      addTorc(kit, D, bind, { color: GOLD, big: 1.4, f: 1.075 });
      break;
    case 'morrigan':
      addTorc(kit, D, bind, { color: SILVER, big: 1.0, mat: 'metal' });
      E.attach.push(addRaven(E, { side: -1, size: 1.25 }));
      break;
    case 'lugh':
      addTorc(kit, D, bind, { color: GOLD, big: 1.15 });
      break;
    case 'brigid':
      addTorc(kit, D, bind, { color: GOLD, big: 0.95 });
      E.attach.push(addFlameCrown(E, { tongues: 9, size: 1 }));
      break;
    case 'balor':
      addTorc(kit, D, bind, { color: BLACK_IRON, big: 1.7, mat: 'metal', f: 1.07 });
      break;
    default:
      break;
  }
  DEFAULT.extras({ ...E, ex: new Set([...ex]) });
}

/**
 * Style for a held item (rich-humanoid.js asks for it for each hand): the Dagda's club of dark oak studded with iron, the
 * double axe and the torch (built by rich-gear.js although they are not among its weapons), the druid's oak staff, the spears
 * of the Morrigan (black) and of Lugh (ash with gold), Balor's iron mace.
 */
export function gear(ctx, item) {
  const id = ctx.unit.id;
  switch (item.id) {
    case 'club':
      return { color: withMat('#3e2c1c', 'wood'), studs: IRON };
    case 'sword':
      return { blade: IRON, fitting: BRONZE };
    case 'double_axe':
      return { build: true, shaftColor: shade(OAK_WOOD, 0.95), metal: IRON };
    case 'torch':
      return { build: true };
    case 'staff':
      return { staff: 'druid', shaftColor: shade(OAK_WOOD, 0.9) };
    case 'spear':
      return { shaftColor: id === 'celtic_the_morrigan' ? withMat('#241f26', 'wood') : withMat('#c9a56a', 'wood') };
    case 'mace':
      return { color: id === 'celtic_balor' ? BLACK_IRON : DARK_IRON };
    default:
      return null;
  }
}

/** Skin paint: the woad of the raiders (bands of blue across the body and the arms, the face striped), the Morrigan's black band across her eyes. */
export function skinPaint(E) {
  const dress = dressOf(E);
  if (dress !== 'raider' && dress !== 'morrigan') return null;
  const { D } = E;
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  if (dress === 'morrigan') {
    const kohl = withMat('#14101a', 'skin');
    return (o, x, y, z) => {
      const dy = (y - hy) / hs;
      if (x < hx || dy < -0.012 || dy > 0.036 || Math.abs(z) > 0.11 * hs) return;
      dye(o, kohl, 0.9);
    };
  }
  const wrist = D.shoulderY - 0.02 - D.upper - D.fore;
  const elbow = D.shoulderY - 0.02 - D.upper;
  return (o, x, y, z) => {
    const dy = (y - hy) / hs;
    if (y > D.shoulderY + 0.03) {
      // the head: a fair face, a band of woad across the eyes and stripes down the cheeks
      dye(o, FAIR, 0.9);
      if (x < hx || Math.abs(z) > 0.11 * hs) return;
      if (dy > -0.012 && dy < 0.036) dye(o, WOAD, 0.95);
      else if (dy < -0.02 && dy > -0.1 && Math.abs(z) > 0.03 * hs && ((Math.abs(z) / hs) * 55) % 1 < 0.45) dye(o, WOAD, 0.9);
      return;
    }
    dye(o, FAIR, 0.9);
    if (y < wrist - 0.01) return; // the hands
    if (Math.abs(z) > D.shoulderZ - 0.07 && y < elbow) {
      // the forearms, blue to the elbow
      dye(o, WOAD, 0.92);
      return;
    }
    // wavy bands round the chest and the upper arms
    const wob = 0.024 * Math.sin(Math.atan2(z, x) * 2);
    const t = (y + wob) / 0.1;
    if (t - Math.floor(t) < 0.5) dye(o, WOAD, 0.92);
  };
}

/** The tall oval shield with its spine and boss, a band of bronze inset in its face and studs of bronze up the middle; the team's color is its face. */
export function shield() {
  return {
    w: 0.13, h: 0.24, n: 2.3, sides: 18, face: 'team', pattern: null, boss: 'dome', spine: true, dish: 0.034,
    rim: BRONZE, rimMat: 'gold', band: 0.86, bandColor: BRONZE,
    roundels: [{ y: 0.64, k: 0.2, color: BRONZE, mat: 'gold' }, { y: -0.64, k: 0.2, color: BRONZE, mat: 'gold' }],
  };
}

export const CELTIC = { legs, torso, arms, armor: armorLayer, cloaks, head, extras, gear, palette, skinPaint, shield };

