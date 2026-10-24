// The West African look: the Yoruba, the Akan, the Fon and the Mande, the peoples of the forest and the savanna. Their wealth and
// their sign is cloth: kente woven in narrow strips sewn edge to edge in gold, green, red and black, mud cloth dyed dark, its
// strips laddered and dotted in pale, white cotton; with it beads of glass and coral, cowrie shells and gold. The workers wear a
// tunic in the team's color over a wrapper of kente, a head tie and a string of beads; the soldiers the war smock with its leather
// charms sewn along a strap across the chest, a leather cap with antelope horns and a row of cowries, and an oval shield of hide;
// the archers a striped smock, a cap with a guinea fowl's feathers and a quiver at the hip; the priest the white agbada of a
// babalawo with its wide sleeves and its front worked in the team's color, a folded cap, the green and yellow beads of Ifa and
// the talking drum. The Dart Hunter is a Mande hunter: a smock of mud cloth hung with charms, a leopard's skin, a cap with long
// horns. Shango goes bare-chested in red and white under the beaded crown of the kings of Oyo with its veil, his double axe on its
// staff in his hand; Oya wears wine red, a tall head tie, a wrapper of nine colors and nine copper bangles on each arm, and
// carries the horsetail whisk; Ogun a skirt of palm fibre and black iron, a cutlass in his hand; Anansi kente and gold, four more
// arms and a gold spider on his breast; the Aziza leaves. The Sasabonsam, the forest horror, is gaunt, on long thin legs with
// iron hooks for toes, iron claws and the leathery wings of a bat; the Bultungin, the were-hyena, goes on its paws in a spotted
// coat under a crest of dark hair, with claws of bone and a ragged cloth in the team's color about its loins. The people's skin
// is a deep brown and their hair black. The team's color is the tunic, the smock, the cape, the face of the shield, a strip of
// the kente, the priest's cap and the front of his robe, the lining of the leopard's skin, Ogun's bands, the Aziza's sash and
// the rags of the Sasabonsam and the Bultungin. Overrides only the layers where the West Africans dress differently from the
// default (rich-outfit-default.js).
import { TEAM, shadeC, mixC, withMat } from './unit-geo.js';
import { torsoStations, torsoRing, armStations, addBoots, addBareLegs, addSandals } from './rich-body.js';
import {
  addTunic, addBelt, addCape, addDrape, addWaistBelt, addArmBands, addLegBands, addLongSkirt, addWideSleeves, addWrapSkirt,
  addGarland, addUsekh, addPauldrons, addRaffia, addBangles, addAmulets,
} from './rich-clothing.js';
import {
  addHairCap, addLongHair, addBeard, helmShell, addLaurel, addFillet, addHeadWrap, addBeadedCrown, addHornedCap, addFila, addRaffiaCrest,
} from './rich-headgear.js';
import { addJewelry, extraArmsPiece, addQuiver, addSpiderPendant } from './rich-regalia.js';
import { kente, kenteAt, mudcloth, jaguarSpots, spots, furStreaks, mul, recolor, lerp } from './rich-paint.js';
import { addBeastLegs, addTalonFeet, addPaws, addClaws, addBeastTail, addHyenaCrest } from './rich-beast.js';
import { DEFAULT } from './rich-outfit-default.js';

const GOLD = withMat('#dcae3a', 'gold');
const BRASS = withMat('#b98a3e', 'gold');
const COPPER = withMat('#c0703c', 'gold');
const DARK_IRON = withMat('#3a3c42', 'metal');
const IRON = withMat('#aab0b8', 'metal');
const LEATHER = withMat('#6a4528', 'leather');
const DARK_LEATHER = withMat('#3a2618', 'leather');
const RED_LEATHER = withMat('#8e2e1c', 'leather');
const HIDE = withMat('#d6c196', 'leather');
const COWRIE = withMat('#f0e8d2', 'bone');
const HORN = withMat('#9a8262', 'bone');
const WHITE = withMat('#f1ebdc', 'cloth');
const CREAM = withMat('#e6d6b0', 'cloth');

// the threads of the kente
const K_GOLD = withMat('#e2a72a', 'cloth');
const K_GREEN = withMat('#1f6e4a', 'cloth');
const K_RED = withMat('#b3261e', 'cloth');
const K_BLACK = withMat('#211b16', 'cloth');
const K_BLUE = withMat('#2c4f8c', 'cloth');

// beads of glass and coral
const BEAD_RED = withMat('#c4202a', 'lacquer');
const BEAD_WHITE = withMat('#f2eee2', 'lacquer');
const BEAD_GREEN = withMat('#2a8a4a', 'lacquer');
const BEAD_GOLD = withMat('#e0b02a', 'lacquer');
const CORAL = withMat('#d0503a', 'lacquer');

const MUD = withMat('#3e2a1c', 'cloth');
const MUD_INK = withMat('#e2d2a6', 'cloth');
const PALM = withMat('#c2bc6a', 'cloth');
const PALM2 = withMat('#9aa24e', 'cloth');
const LEOPARD = withMat('#d8a040', 'fur');
const GUINEA = withMat('#3c3c46', 'feather');
const PALE_FEATHER = withMat('#ece6d8', 'feather');
const LEAF = withMat('#3f8f3a', 'cloth');
const LEAF_DARK = withMat('#2c6a2c', 'cloth');
const GOURD = withMat('#b98a4a', 'wood');

/** The people's skin, a deep brown, and their hair, black (the shared palette's are not theirs); the gods keep their own. */
const SKIN = '#6b4630';
const HAIR = '#15100c';

/** A team-safe shade of a color. */
const shade = (c, k) => (c && c.team ? TEAM(c.team * k, c.mat) : shadeC(c, k));

/** Who wears what: the people by their work, the rest by name. */
const NAMED = {
  west_african_shango: 'shango',
  west_african_oya: 'oya',
  west_african_ogun: 'ogun',
  west_african_anansi: 'anansi',
  west_african_aziza: 'aziza',
  west_african_dart_hunter: 'hunter',
  west_african_bultungin: 'bultungin',
  west_african_sasabonsam: 'sasabonsam',
};
const PEOPLE = ['worker', 'warrior', 'archer', 'priest', 'hunter'];

/** The dress of a unit: worker, warrior, archer, priest, or a god's, the minion's or the elite's own. */
function dressOfCtx(ctx) {
  const named = NAMED[ctx.unit.id];
  if (named) return named;
  if (ctx.worker) return 'worker';
  if (ctx.cls === 'support') return 'priest';
  return ctx.ex.has('armor') ? 'warrior' : 'archer';
}
const dressOf = (E) => dressOfCtx(E.ctx);

/** The people's skin and hair are theirs; the gods' are what their data says. */
export function palette(pal, ctx) {
  if (!PEOPLE.includes(dressOfCtx(ctx))) return pal;
  return { ...pal, skin: withMat(SKIN, 'skin'), hair: withMat(HAIR, 'hair') };
}

/** Oya's nine colors: her wine red and copper among the colors of the river and the storm. */
const nine = (pal) => [pal.primary, K_GOLD, withMat('#4a2a6a', 'cloth'), pal.secondary, K_RED, K_BLACK, withMat('#e8e0ff', 'cloth'), K_GREEN, K_BLUE];

/** Strips of cloth sewn edge to edge round a body, every `every`th one dyed `alt` or shaded by k (a striped smock). */
const strips = ({ alt = null, k = 0.8, strip = 0.06, r = 0.13, every = 2 } = {}) => (o, x, y, z) => {
  const i = Math.floor((Math.atan2(z, x) * r) / strip);
  if (((i % every) + every) % every !== every - 1) return;
  if (alt) recolor(o, alt, 1);
  else mul(o, k);
};

/**
 * The embroidery down the front of an agbada: a broad bib laid on the robe from the neck to a point under the breast, `color`
 * (a team color works) within a border of `edge`, each its own panel so that their edges are sharp.
 */
function agbadaFront(E, color, edge) {
  const { kit, D, bind } = E;
  const panel = (g, half, low, c) => kit.sheet(8, 6, (u, v, out) => {
    // (standing a little further off at the top, where the robe rounds over the shoulders)
    const r = torsoRing(D, lerp(1.0, low, v), g + 0.012 * Math.max(0, 1 - v * 3));
    const a = (u - 0.5) * 2 * half * lerp(1, 0.12, v);
    out[0] = r.dx + Math.cos(a) * r.rx;
    out[1] = r.y;
    out[2] = Math.sin(a) * r.rz;
  }, { thick: 0.003, color: c, mat: 'cloth', bind: bind.torso });
  panel(0.02, 0.95, 0.44, edge);
  panel(0.025, 0.76, 0.5, color);
}

/** Red and white panels round a skirt, the points of its hem red and the notches between them white (Shango's). */
const panels = (red, white, n) => (o, x, y, z) => {
  const a = Math.atan2(z, x) / (Math.PI * 2);
  if (Math.floor(a * n * 2 + 0.5) & 1) recolor(o, white, 1);
  else recolor(o, red, 1);
};

/** The veins of a leaf: a light rib every so often round a garment of leaves. */
const leafVeins = (o, x, y, z) => mul(o, 0.86 + 0.24 * Math.abs(Math.sin(Math.atan2(z, x) * 6 + y * 18)));

/** Bare skin over the chest and belly (`more`: sides and rings of its own, a pattern in the coat needs more vertices). */
function bareTorso(E, more = null) {
  E.kit.loft(torsoStations(E.D), { rings: 11, start: null, end: 'round', color: E.skin, bind: E.bind.torso, paint: E.skinPaint, ...more });
}

/** Bare arms. */
function bareArms(E, more = null) {
  const { kit, D, bind, skin, skinPaint } = E;
  for (const side of [1, -1]) {
    kit.loft(armStations(D, side), { rings: 8, start: null, end: 'round', capRings: 2, capDepth: 0.022, color: skin, bind: bind.arm[side], paint: skinPaint, ...more });
  }
}

/** The were-hyena's spotted coat is a pattern in the vertex colors: its body is built with the rings and sides to show it. */
const SPOTTED = { torso: { sides: 24, rings: 16 }, arms: { sides: 16, rings: 11 }, legs: 16 };

/** A wrapper of kente from the waist, `len` (1 reaches the knee), its strips running up and down, banded across. */
function wrapper(E, { colors, len = 1, flare = 1, strip = 0.09, block = 0.075 }) {
  const { kit, D, bind } = E;
  addWrapSkirt(kit, D, bind, { color: colors[0], len, flare, sides: 48, rings: 12, weave: kente({ colors, strip, block, r: 0.19 }) });
}

/** A stole of kente from one shoulder across the chest to the opposite hip (Anansi's worn wide, as a toga): `across` strips wide. */
function stole(E, { colors, side = 1, width = 0.3, across = 3, along = 9 }) {
  const { kit, D, bind } = E;
  addDrape(kit, D, bind, colors[0], null, {
    side, width, cells: [across * 2, 18],
    paint: (o, x, y, z, u, a) => {
      recolor(o, kenteAt(colors, Math.min(across - 1, Math.floor(u * across)), Math.floor(a * along)), 1);
      mul(o, 0.88 + 0.12 * Math.sin(a * Math.PI));
    },
  });
}

/** Short sleeves of a smock over bare forearms; `weave` a pattern in the cloth (mud cloth), laid about each arm on `rings` rings. */
function smockSleeves(E, color, weave = null, rings = 6) {
  const { kit, D, bind, skin } = E;
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    kit.loft(armStations(D, side).slice(0, 4), { rings: 5, start: null, end: null, color: skin, bind: bd });
    kit.loft(armStations(D, side, 0.011, 'elbow'), {
      rings, sides: 14, start: null, end: 'round', capDepth: 0.012, color, bind: bd,
      paint: (o, x, y, z, u, a) => {
        if (weave) weave(side)(o, x, y, z, u, a);
        mul(o, 0.88 + 0.12 * Math.min(1, (y - (D.shoulderY - D.upper - 0.05)) / (D.upper + 0.05)));
      },
    });
  }
}

// ---------------------------------------------------------------------------
// legs
// ---------------------------------------------------------------------------

export function legs(E) {
  const { kit, D, pal, bind, skin, skinPaint } = E;
  const sandals = (strap, sole = shade(LEATHER, 0.75), ladder = 0) => addSandals(kit, D, pal, bind, { skin, skinPaint, strap, sole, ladder });
  switch (dressOf(E)) {
    case 'priest':
      // the agbada falls to the ankles: only the slippers show
      addBoots(kit, D, pal, bind, shade(LEATHER, 0.85), null, { top: D.ankleY + 0.05 });
      break;
    case 'oya':
      // bare feet in sandals under the wrapper
      addBareLegs(kit, D, bind, skin, skinPaint, D.ankleY + 0.14);
      sandals(shade(LEATHER, 0.8));
      break;
    case 'aziza':
      // barefoot, a string of beads at each ankle
      addBareLegs(kit, D, bind, skin, skinPaint);
      sandals(skin, shade(skin, 0.86));
      addLegBands(kit, D, bind, { ankle: BEAD_GOLD, mat: 'lacquer' });
      break;
    case 'shango':
      addBareLegs(kit, D, bind, skin, skinPaint);
      sandals(RED_LEATHER);
      addLegBands(kit, D, bind, { ankle: BEAD_WHITE, mat: 'lacquer' });
      break;
    case 'hunter':
      // charms tied under the knee
      addBareLegs(kit, D, bind, skin, skinPaint);
      sandals(DARK_LEATHER, shade(LEATHER, 0.7), 1);
      addLegBands(kit, D, bind, { knee: DARK_LEATHER, mat: 'leather' });
      break;
    case 'sasabonsam':
      // long thin legs of dark hide, the feet hooks of iron
      addBeastLegs(E, { color: skin, paint: skinPaint, lower: 0.62 });
      addTalonFeet(E, { color: shade(skin, 0.85), claw: IRON, clawMat: 'metal', k: 1.12 });
      break;
    case 'bultungin':
      // a hyena's hind legs in the spotted coat, on broad paws with heavy claws of bone
      addBeastLegs(E, { color: skin, paint: skinPaint, lower: 0.84, sides: SPOTTED.legs });
      addPaws(E, { color: shade(skin, 0.7), claw: pal.accent, paint: skinPaint });
      break;
    default:
      addBareLegs(kit, D, bind, skin, skinPaint);
      sandals(LEATHER);
  }
}

// ---------------------------------------------------------------------------
// torso
// ---------------------------------------------------------------------------

export function torso(E) {
  const { kit, D, pal, bind, tunicColor } = E;
  switch (dressOf(E)) {
    case 'worker':
      // a tunic in the team's color, a wrapper of kente over it from the waist to below the knee
      addTunic(kit, D, tunicColor, bind, 0.04);
      wrapper(E, { colors: [K_GOLD, K_GREEN, K_GOLD, K_RED, K_BLACK], len: 1.1 });
      break;
    case 'warrior':
      // the war smock: strips of the team's color in two shades, to mid-thigh (the charms and the belt go over it)
      addTunic(kit, D, tunicColor, bind, 0.2, { skirted: true, sides: 20, weave: strips({ k: 0.78, strip: 0.08 }) });
      break;
    case 'archer':
      // a smock of strips of brown and cream, belted
      addTunic(kit, D, tunicColor, bind, 0.18, { skirted: true, sides: 30, weave: strips({ alt: CREAM, strip: 0.055, every: 3 }) });
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.9), BRASS, 'leather', 0.04);
      break;
    case 'hunter':
      // the hunter's smock of mud cloth
      addTunic(kit, D, MUD, bind, 0.2, { skirted: true, sides: 28, rings: 24, weave: mudcloth({ ink: MUD_INK, cell: 0.13, r: 0.13 }) });
      addBelt(kit, D, pal, bind, DARK_LEATHER, BRASS, 'leather', 0.04);
      break;
    case 'priest':
      // the agbada: a robe of white to the ankles, its front worked in the team's color edged in gold
      addTunic(kit, D, tunicColor, bind, 0.04, { sides: 20 });
      agbadaFront(E, TEAM(0.9, 'cloth'), K_GOLD);
      addLongSkirt(kit, D, bind, tunicColor, { flare: 1.15 });
      break;
    case 'shango':
      // bare-chested, a skirt of red and white panels with a dagged hem, a broad sash
      bareTorso(E);
      addWrapSkirt(kit, D, bind, { color: pal.primary, len: 0.95, flare: 1.1, teeth: 10, depth: 0.05, sides: 40, weave: panels(pal.primary, WHITE, 10) });
      addWaistBelt(kit, D, bind, shade(pal.primary, 0.72), GOLD);
      break;
    case 'oya':
      // a bodice of wine red, a wrapper of nine colors to the ankle, a sash of copper
      addTunic(kit, D, shade(pal.primary, 0.95), bind, 0.04);
      addLongSkirt(kit, D, bind, pal.primary, { flare: 1.05, sides: 48, rings: 14, weave: kente({ colors: nine(pal), strip: 0.09, block: 0.085, r: 0.18 }) });
      addWaistBelt(kit, D, bind, shade(pal.secondary, 0.95), COPPER);
      break;
    case 'ogun':
      // bare-chested in a skirt of palm fibre over the black cloth
      bareTorso(E);
      addRaffia(kit, D, bind, { color: PALM, color2: PALM2, under: TEAM(0.75, 'cloth'), band: TEAM(0.9, 'cloth'), rows: 3, n: 26, len: 1.05 });
      break;
    case 'anansi':
      // a wrapper of kente to the shin (the toga over the shoulder is a cloak)
      bareTorso(E);
      wrapper(E, { colors: ANANSI_KENTE, len: 1.3, flare: 1.05 });
      break;
    case 'sasabonsam':
      // a gaunt bare chest, a rag of the team's color about the loins
      bareTorso(E);
      addWrapSkirt(kit, D, bind, { color: TEAM(0.62, 'cloth'), len: 0.42, flare: 1.05, teeth: 7, depth: 0.07, sides: 30 });
      addWaistBelt(kit, D, bind, DARK_LEATHER, IRON, 'leather');
      break;
    case 'bultungin':
      // the coat bare over the chest, a ragged cloth in the team's color about the loins on a belt of hide hung with bones
      bareTorso(E, SPOTTED.torso);
      addWrapSkirt(kit, D, bind, { color: TEAM(0.85, 'cloth'), len: 0.5, flare: 1.1, teeth: 9, depth: 0.065, sides: 36 });
      addWaistBelt(kit, D, bind, DARK_LEATHER, COWRIE, 'leather');
      break;
    case 'aziza':
      // a bodice and a skirt of leaves
      addTunic(kit, D, LEAF_DARK, bind, 0.02, { paint: leafVeins });
      addWrapSkirt(kit, D, bind, { color: LEAF, len: 0.75, flare: 1.15, teeth: 12, depth: 0.07, mark: leafVeins });
      // a sash in the team's color where the leaves meet
      addWaistBelt(kit, D, bind, TEAM(0.9, 'cloth'), BEAD_GOLD, 'cloth');
      break;
    default:
      DEFAULT.torso(E);
  }
}

/** Anansi's kente: the gold and black of the Akan with green, red and the team's color. */
const ANANSI_KENTE = [K_GOLD, K_BLACK, K_GREEN, TEAM(0.9, 'cloth'), K_GOLD, K_RED];

// ---------------------------------------------------------------------------
// arms
// ---------------------------------------------------------------------------

export function arms(E) {
  const { kit, D, bind, tunicColor } = E;
  switch (dressOf(E)) {
    case 'shango':
      bareArms(E);
      addArmBands(kit, D, bind, { upper: GOLD });
      addBangles(kit, D, bind, { color: [BEAD_RED, BEAD_WHITE], n: 6, mat: 'lacquer', gap: 0.011 });
      break;
    case 'oya':
      // her nine copper bangles on each arm
      bareArms(E);
      addBangles(kit, D, bind, { color: COPPER, n: 9, gap: 0.0105 });
      break;
    case 'ogun':
      bareArms(E);
      addArmBands(kit, D, bind, { upper: DARK_IRON, mat: 'metal' });
      break;
    case 'anansi':
      bareArms(E);
      addArmBands(kit, D, bind, { upper: GOLD });
      addBangles(kit, D, bind, { color: GOLD, n: 3 });
      break;
    case 'aziza':
      bareArms(E);
      addArmBands(kit, D, bind, { upper: BEAD_GOLD, mat: 'lacquer' });
      break;
    case 'sasabonsam':
      // long claws of iron, a band of iron on each arm
      bareArms(E);
      addArmBands(kit, D, bind, { upper: IRON, wrist: IRON, mat: 'metal' });
      addClaws(E, { color: IRON, len: 1.1, r: 0.9 });
      break;
    case 'bultungin':
      // long claws of bone on the hands
      bareArms(E, SPOTTED.arms);
      addClaws(E, { color: E.pal.accent, len: 1.2, r: 1.1 });
      break;
    case 'priest':
      // the agbada's wide sleeves over the forearms, edged in green
      for (const side of [1, -1]) kit.loft(armStations(D, side).slice(0, 4), { rings: 5, start: null, end: null, color: E.skin, bind: bind.arm[side] });
      addWideSleeves(kit, D, bind, { color: tunicColor, trim: K_GREEN, wide: 1.2 });
      break;
    case 'hunter':
      smockSleeves(E, MUD, (side) => mudcloth({ ink: MUD_INK, cell: 0.09, cz: side * D.shoulderZ, r: D.armR + 0.01 }), 9);
      break;
    default:
      DEFAULT.arms(E);
  }
}

// ---------------------------------------------------------------------------
// armor: the charms of the war smock, Ogun's iron
// ---------------------------------------------------------------------------

export function armorLayer(E) {
  const { kit, D, pal, bind, armor } = E;
  if (!armor) return;
  switch (dressOf(E)) {
    case 'warrior':
      addAmulets(kit, D, bind, { strap: DARK_LEATHER, packets: [RED_LEATHER, DARK_LEATHER, LEATHER], n: 6, cowrie: COWRIE });
      addBelt(kit, D, pal, bind, shade(LEATHER, 0.85), BRASS, 'leather', 0.04);
      break;
    case 'ogun':
      // shoulder plates of black iron, a belt over the palm fibre
      addPauldrons(kit, D, pal, bind, DARK_IRON, TEAM(0.9, 'cloth'));
      addBelt(kit, D, pal, bind, DARK_LEATHER, DARK_IRON, 'leather', 0.03);
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
    case 'archer':
      if (ex.has('cape')) addCape(kit, D, TEAM(0.95, 'cloth'), shade(pal.secondary, 0.95), shade(pal.primary, 0.55), bind, { len: 0.6, wide: 0.85 });
      addQuiver(E, { color: LEATHER, trim: RED_LEATHER, fletch: [PALE_FEATHER, GUINEA] });
      break;
    case 'hunter':
      // the skin of a leopard over the shoulders and down the back, lined and hemmed in the team's color; the quiver at the hip
      addCape(kit, D, LEOPARD, TEAM(0.9, 'cloth'), TEAM(0.8, 'cloth'), bind, { len: 0.75, wide: 0.92, paint: jaguarSpots(0.1), mat: 'fur', cells: [12, 14] });
      addQuiver(E, { color: DARK_LEATHER, trim: COWRIE, fletch: [GUINEA, PALE_FEATHER], n: 6 });
      break;
    case 'shango':
      addCape(kit, D, TEAM(0.95, 'cloth'), WHITE, shade(pal.primary, 0.6), bind, { len: 1.0, wide: 1.0 });
      break;
    case 'oya':
      addCape(kit, D, TEAM(0.95, 'cloth'), COPPER, shade(pal.primary, 0.6), bind, { len: 1.0, wide: 1.0 });
      break;
    case 'anansi':
      // the kente worn as a toga: over the left shoulder, the right bare
      stole(E, { colors: ANANSI_KENTE, side: 1, width: 0.55, across: 4 });
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
    case 'worker':
      addHairCap(kit, D, pal, bind);
      addHeadWrap(kit, D, pal, bind, { color: shade(pal.primary, 1), band: K_GREEN, fan: false });
      break;
    case 'warrior':
      addHornedCap(kit, D, pal, bind, { cap: DARK_LEATHER, band: RED_LEATHER, horn: HORN, cowrie: COWRIE });
      break;
    case 'archer':
      addHornedCap(kit, D, pal, bind, { cap: shade(LEATHER, 0.9), band: TEAM(0.9, 'cloth'), plume: [GUINEA, PALE_FEATHER, GUINEA] });
      break;
    case 'hunter':
      addHornedCap(kit, D, pal, bind, { cap: MUD, band: TEAM(0.9, 'cloth'), horn: HORN, cowrie: COWRIE, tall: 1.2 });
      break;
    case 'priest':
      addHairCap(kit, D, pal, bind);
      addFila(kit, D, pal, bind, { color: TEAM(0.9, 'cloth'), band: K_GOLD });
      break;
    case 'shango':
      addHairCap(kit, D, pal, bind);
      addBeadedCrown(kit, D, pal, bind, { beads: [BEAD_RED, BEAD_WHITE], band: GOLD, ball: GOLD, tall: 1.1 });
      break;
    case 'oya':
      addHairCap(kit, D, pal, bind);
      if (ex.has('long_hair')) addLongHair(kit, D, pal, bind);
      addHeadWrap(kit, D, pal, bind, { color: shade(pal.primary, 1.05), band: shade(pal.secondary, 0.95), tall: 1.3, tails: 0.3 });
      break;
    case 'ogun':
      helmShell(kit, D, bind, DARK_IRON, TEAM(0.9, 'cloth'), { nasal: false, cheeks: false });
      addRaffiaCrest(kit, D, pal, bind, { color: PALM, color2: PALM2 });
      if (ex.has('beard')) addBeard(kit, D, pal, bind);
      break;
    case 'anansi':
      addHairCap(kit, D, pal, bind);
      addFillet(kit, D, pal, bind, { metal: GOLD });
      break;
    case 'aziza':
      addHairCap(kit, D, pal, bind);
      if (ex.has('long_hair')) addLongHair(kit, D, pal, bind);
      addLaurel(kit, D, pal, bind, { leaf: LEAF, per: 7, big: 1.2 });
      break;
    case 'sasabonsam':
      // the head is a bat's; the long black hair falls from the back of it
      if (ex.has('long_hair')) addLongHair(kit, D, pal, bind);
      break;
    case 'bultungin':
      // the head is a hyena's: no hair, no cap (the crest is the extras')
      break;
    default:
      DEFAULT.head(E);
  }
}

// ---------------------------------------------------------------------------
// extras
// ---------------------------------------------------------------------------

/** Anansi's four more arms: the raised pair open, the pair before him holding the calabash of wisdom and a talking drum. */
const ANANSI_ARMS = [
  [null, null],
  [{ id: 'cauldron', opts: { jar: true, color: GOURD, band: K_BLACK } }, { id: 'drum', opts: { drum: 'talking' } }],
];

export function extras(E) {
  const { kit, D, bind, ex } = E;
  const dress = dressOf(E);
  const beads = (colors, low = 0.5, r = 0.012, n = 18) => addGarland(kit, D, bind, { colors, low, r, beads: n, mat: 'lacquer' });
  switch (dress) {
    case 'worker':
      beads([CORAL, BEAD_GOLD], 0.62);
      break;
    case 'warrior':
      beads([COWRIE, BEAD_RED], 0.86, 0.011, 20);
      break;
    case 'archer':
      beads([BEAD_GOLD, BEAD_GREEN], 0.66);
      break;
    case 'hunter':
      // no beads at the neck: the leopard's skin shows there
      addAmulets(kit, D, bind, { strap: DARK_LEATHER, packets: [DARK_LEATHER, RED_LEATHER], n: 4, side: -1, cowrie: COWRIE });
      break;
    case 'priest':
      // the green and yellow beads of Ifa
      beads([BEAD_GREEN, BEAD_GOLD], 0.42, 0.012, 22);
      break;
    case 'shango':
      // a collar of red and white beads
      addUsekh(kit, D, bind, { rows: [BEAD_RED, BEAD_WHITE, BEAD_RED, BEAD_WHITE, BEAD_RED], reach: 0.8 });
      break;
    case 'oya':
      beads([withMat('#6e1a40', 'lacquer'), COPPER], 0.56, 0.012, 20);
      break;
    case 'anansi':
      if (ex.has('multi_arms')) E.attach.push(extraArmsPiece(E, ANANSI_ARMS));
      addSpiderPendant(E, { color: GOLD, cord: BEAD_GOLD, eye: E.pal.eyeGlow });
      break;
    case 'aziza':
      beads([BEAD_GOLD, BEAD_GREEN], 0.7, 0.01, 16);
      break;
    case 'bultungin':
      // a string of knuckle-bones, the crest of coarse dark hair from the nape to the small of the back, the short bushy tail
      addGarland(kit, D, bind, { colors: [COWRIE, withMat('#d8ceb0', 'bone')], low: 0.72, r: 0.014, beads: 12, mat: 'bone' });
      if (ex.has('mane')) addHyenaCrest(E, { color: shade(E.pal.skin, 0.5), dark: shade(E.pal.skin, 0.3), tip: shade(E.pal.skin, 0.2), size: 1.1 });
      if (ex.has('tail')) addBeastTail(E, { kind: 'hyena', color: E.pal.skin, tip: shade(E.pal.skin, 0.25) });
      break;
    default:
      break;
  }
  // earrings for those in jewelry (the collars are their own); the rest as the default
  if (ex.has('jewelry')) addJewelry(E, { collar: false, bands: false });
  DEFAULT.extras({ ...E, ex: new Set([...ex].filter((e) => e !== 'jewelry' && e !== 'multi_arms' && !(dress === 'bultungin' && (e === 'mane' || e === 'tail')))) });
}

/**
 * Style for a held item in the right hand (side 1) or the left (-1): Shango's oshe and Oya's horsetail whisk (built by
 * rich-gear.js although the double axe and the whip are not among its weapons), Ogun's cutlass, Anansi's spider staff, the Aziza's
 * staff of green light, the soldiers' spears of dark wood, the priest's talking drum in the left hand and its hooked stick in
 * the right.
 */
export function gear(ctx, item, side) {
  const id = ctx.unit.id;
  switch (item.id) {
    case 'double_axe':
      return { build: true, oshe: true, bands: [BEAD_WHITE, BEAD_RED] };
    case 'whip':
      return { build: true, whisk: true, hair: withMat('#3b2618', 'hair'), beads: [COPPER, withMat('#6e1a40', 'lacquer')] };
    case 'sword':
      return { machete: true, metal: mixC(DARK_IRON, '#8b949e', 0.35) };
    case 'staff':
      return id === 'west_african_anansi' ? { staff: 'spider', metal: GOLD, eye: ctx.pal.eyeGlow } : { orb: withMat('#a0ffb0', 'gem') };
    case 'spear':
      return { shaftColor: withMat('#5a3a22', 'wood') };
    case 'bow':
      return { color: withMat('#4a2e1a', 'wood') };
    case 'drum':
      return side > 0 ? { drum: 'beater' } : { drum: 'talking' };
    default:
      return null;
  }
}

/** The Bultungin's coat: streaks of lighter and darker hair over the body, the dark blotches of a spotted hyena on them. */
export function skinPaint(E) {
  if (E.ctx.unit.id !== 'west_african_bultungin') return null;
  const blotch = spots(0.19, 0.46, 0.04, shade(E.pal.skin, 0.05));
  return (o, x, y, z, u, a) => {
    furStreaks(o, x, y, z, u, a);
    blotch(o, x, y, z);
  };
}

/** The soldier's shield: a tall oval of hide, the team's color on its face in a cross, a boss of hide and two cowries. */
export function shield() {
  return {
    w: 0.15, h: 0.22, n: 2, sides: 24, face: 'team', pattern: 'cross', boss: null, dish: 0.024,
    rim: HIDE, rimMat: 'leather', band: 0.86, bandColor: HIDE,
    roundels: [
      { x: 0, y: 0, k: 0.22, color: HIDE, mat: 'leather' },
      ...[-0.55, 0.55].map((y) => ({ x: 0, y, k: 0.09, color: COWRIE, mat: 'bone', sides: 8 })),
    ],
  };
}

export const WEST_AFRICAN = { legs, torso, arms, armor: armorLayer, cloaks, head, extras, gear, palette, skinPaint, shield };
