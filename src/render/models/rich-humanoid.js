// The rich humanoid (High and Ultra): one smooth skinned mesh for the body and its layered
// clothing, armor, hair and headgear (rich-kit.js), plus a few rigid pieces that ride bones:
// the weapon in the hand, the shield on the forearm, worker tools, flames. It reads the same
// `visual` the low-poly bodies read (unit-bodies.js) and the same palette, so a unit keeps
// its colors, team-colored cloth and gear; units whose look it cannot dress yet
// (richSupported) keep the low-poly model.
import { PartBuilder, bakeAO } from './unit-geo.js';
import { addWeapon, addOffhand, addTool, WEAPON_INFO, OFFHAND_ELBOW, gripRotation } from './unit-parts.js';
import { unitContext, humanoidItems, holdsAloft } from './unit-bodies.js';
import { MeshKit, humanoidSpec, B } from './rich-kit.js';
import { RICH_WEAPONS, richWeapon, richShield, handFrame, finishGear } from './rich-gear.js';
import { RICH_ARMS, RICH_OFFHANDS, richArm } from './rich-arms.js';
import { richDims, makeBinds, lavaSkin, addHeadAndNeck, addHands } from './rich-body.js';
import { outfitFor, LAYERS } from './rich-outfits.js';
import { flameMane, flamePieces, wingLayout, wingPieces } from './rich-regalia.js';
import { batWingPieces } from './rich-beast-wings.js';
import { BEAST_HEADS } from './rich-heads.js';
import { creatureSupported, buildCreatureTemplate } from './rich-creatures.js';
import { wispBones, addWispBinds, ghostly } from './rich-spirit.js';
import { nagaBones, addNagaBinds } from './rich-naga.js';
import { centaurSupported, centaurFrame, raiseDims, addCentaurBones, addPalmBone, settle } from './rich-centaur.js';
import { scorpionSupported, scorpionFrame, addScorpionBones } from './rich-scorpion.js';
import { SCORPION_OUTFITS } from './rich-scorpion-outfits.js';
import { elephantSupported, elephantFrame, addElephantBones, riderContext } from './rich-elephant.js';
import { ELEPHANT_OUTFITS } from './rich-elephant-outfits.js';

/** The bodies the humanoid rig dresses: people, giants, the upright beasts (the monkeys, the lion-headed demon, the winged horror, the were-hyena), the spirits (a wisp below the waist) and the nagas (a serpent's tail); the centaurs, the scorpion men and the person on an elephant's back (a person on an animal's body) have their own paths below. */
const RICH_BODIES = new Set(['humanoid', 'giant', 'beast_biped', 'spirit', 'naga']);
/** The beasts with the heads of these stand as tall and as slim as people (a monkey does); the rest are built on the hunched, broad-shouldered beast profile. */
const UPRIGHT_BEASTS = new Set(['monkey']);
const RICH_HEADGEAR = new Set(['none', 'hood', 'horned_helmet', 'horns', 'helmet', 'winged_helmet', 'tiara', 'laurel', 'crown', 'tall_crown', 'nemes', 'sun_disk', 'feathers', 'topknot', 'crescent', 'headdress', 'antlers', 'flame', 'veil']);
const RICH_EXTRAS = new Set(['beard', 'long_hair', 'cape', 'armor', 'fur', 'skirt', 'flames', 'eye_glow', 'wings', 'feather_cloak', 'jewelry', 'spikes', 'chains', 'third_eye', 'tail', 'multi_arms', 'aura_ring', 'mane']);

/**
 * The pantheons whose units are drawn with the rich characters in play: all ten, each after its
 * own look pass (the Norse were the sample). A pantheon added later stays low-poly until it has
 * had one, though the builder dresses its supported units all the same (tools pin it for all with
 * GameRenderer.setUnitDetail('rich')).
 */
export const RICH_PANTHEONS = new Set(['norse', 'greek', 'egyptian', 'hindu', 'japanese', 'chinese', 'aztec', 'celtic', 'mesopotamian', 'west_african']);

/** Whether the rich builder can dress this unit type (else it keeps its low-poly model). */
export function richSupported(unitType) {
  const v = unitType.visual;
  if (!v) return false;
  if (creatureSupported(unitType)) return true;
  const body = v.body || 'humanoid';
  if (body === 'centaur') return centaurSupported(v);
  // (an insect with a person's head is a scorpion man: dressed by the outfit of his pantheon, if it has one for him)
  if (body === 'insect') return scorpionSupported(v) && !!SCORPION_OUTFITS[unitType.lookOf || unitType.pantheon];
  // (an elephant is the animal under the person who rides it: dressed by the outfit of his pantheon, if it has one for him)
  if (body === 'elephant') return elephantSupported(v) && !!ELEPHANT_OUTFITS[unitType.lookOf || unitType.pantheon];
  if (!RICH_BODIES.has(body)) return false;
  if (((v.head || 'human') !== 'human' && !BEAST_HEADS.has(v.head)) || (v.heads || 1) !== 1) return false;
  if (!RICH_HEADGEAR.has(v.headgear || 'none')) return false;
  return (v.extras || []).every((e) => RICH_EXTRAS.has(e));
}


// ---------------------------------------------------------------------------
// held items (rigid pieces that ride a bone)
// ---------------------------------------------------------------------------

function finishPiece(b) {
  const g = b.build();
  if (g) bakeAO([{ geo: g }], { ground: 0 });
  return g;
}

/**
 * A weapon / tool in the hand: built in the arm frame like the low-poly arm does, then moved into the hand bone's frame.
 * `style` (from the pantheon outfit's `gear(ctx, item)`) adds options to the builder: an iron club, a feather fan.
 */
function heldPiece(ctx, P, side, item, sizeK = 1, style = null) {
  const { pal } = ctx;
  const b = new PartBuilder();
  const elbowY = -P.upper;
  const handY = elbowY - P.fore - P.handR * 0.55;
  const id = item.id;
  let grip = 'fwd';
  if (item.kind === 'weapon') grip = (WEAPON_INFO[id] || WEAPON_INFO.none).grip;
  else if (item.kind === 'bow') grip = 'bow';
  else if (item.kind === 'offhand') grip = id === 'lantern' ? 'hang' : 'fwd';
  if (grip === 'fist') return null;
  // (a beast's claws are its hands': the outfit builds them on the hand, rich-beast.js)
  if (id === 'claws' && ctx.v.body === 'beast_biped') return null;
  const size = P.weaponSize * sizeK;
  // (style.build: the pantheon's outfit builds this weapon with rich-gear.js although it is not one of RICH_WEAPONS: the double axe, the torch)
  const built = item.kind === 'offhand' ? RICH_OFFHANDS.has(id) : (item.kind === 'weapon' || item.kind === 'bow') && (RICH_WEAPONS.has(id) || RICH_ARMS.has(id) || !!(style && style.build));
  if (built) {
    const kit = new MeshKit(null, { sides: 10 });
    const opts = { glowBlade: ctx.grand && id === 'sword', runes: ctx.grand && (id === 'hammer' || id === 'spear') ? pal.glow : null, ...style };
    if (RICH_WEAPONS.has(id) || (style && style.build)) richWeapon(kit, pal, id, size, opts);
    else richArm(kit, pal, id, size, opts);
    // (a piece with style.pivot is built in the frame of a bone of its own at the palm: it is turned by the pose, not by the hand)
    return finishGear(kit, style && style.pivot ? null : handFrame(P, side, grip));
  }
  b.frame([0.01, handY, side * 0.005], gripRotation(grip), 1, () => {
    if (item.kind === 'weapon') addWeapon(b, pal, id, size, { glowBlade: ctx.grand && id === 'sword', lowDetail: false });
    else if (item.kind === 'bow') addWeapon(b, pal, 'bow', size);
    else if (item.kind === 'tool') addTool(b, pal, id, size);
    else addOffhand(b, pal, id, size, { dark: ctx.unit.id && ctx.unit.id.includes('tezcatlipoca') });
  });
  const g = finishPiece(b);
  if (g) g.translate(0, P.upper + P.fore, 0); // arm frame (shoulder) to the hand bone (wrist)
  return g;
}

// ---------------------------------------------------------------------------
// template
// ---------------------------------------------------------------------------

/**
 * The rich template of a unit type: { kind, rich: { spec, geo, attach[], ... }, rig, parts: [] }.
 * Shaped like a low-poly template where the animation code reads it (kind, rig).
 */
export function buildRichTemplate(unitType, detail = 1) {
  if (creatureSupported(unitType)) return buildCreatureTemplate(unitType);
  const base = unitContext(unitType);
  const elephant = base.v.body === 'elephant';
  // (the person on an elephant's back is dressed from a unit of his own: the head, the crown and the weapon of the person, not the elephant's)
  const ctx = elephant ? riderContext(base, (ELEPHANT_OUTFITS[base.unit.lookOf || base.unit.pantheon] || {}).rider) : base;
  const { v, pal, ex } = ctx;
  const spirit = v.body === 'spirit';
  const naga = v.body === 'naga';
  const centaur = v.body === 'centaur';
  const scorpion = v.body === 'insect';
  const name = v.body === 'giant' ? 'giant' : spirit ? 'spirit' : naga ? 'naga' : centaur ? 'centaur' : scorpion ? 'scorpion' : elephant ? 'rider' : v.body === 'beast_biped' && !UPRIGHT_BEASTS.has(v.head) ? 'beast_biped' : 'humanoid';
  const D = richDims(ctx, name);
  // (a centaur: the person stands on the horse's back, raised to it; the horse is built in the same frame, rich-centaur.js; a scorpion man
  // stands on the scorpion's carapace in the same way, rich-scorpion.js; the person on an elephant sits in its howdah, rich-elephant.js)
  const F = centaur ? centaurFrame(D) : scorpion ? scorpionFrame(D) : elephant ? elephantFrame(D, base.v) : null;
  if (F) raiseDims(D, F.lift);
  const wings = ex.has('wings') ? wingLayout(D, (ctx.unit.air ? 0.7 : 0.6) * D.k) : null;
  const spec = humanoidSpec({ ...D, headY: D.headPivot, shoulderDrop: 0.02 }, {
    ...(wings ? { wing: wings } : {}), ...(spirit ? { tail: wispBones(D) } : {}), ...(naga ? { tail: nagaBones(D), tailStyle: 'serpent' } : {}),
  });
  if (centaur) addCentaurBones(spec, F);
  if (scorpion) addScorpionBones(spec, F);
  if (elephant) addElephantBones(spec, F);
  const bind = makeBinds(spec, D);
  if (spirit) addWispBinds(spec, D, bind);
  if (naga) addNagaBinds(spec, D, bind);
  const lava = ex.has('flames') && D.bare; // a fire giant: dark crust, glowing veins, iron plates
  const sides = name === 'giant' ? 20 : ctx.grand ? 14 : 12;
  const kit = new MeshKit(spec, { sides: Math.round(sides * (detail >= 1 ? 1 : 0.7)), rings: (name === 'giant' ? 1.6 : 1) * (detail >= 1 ? 1 : 0.7) });
  const armor = ex.has('armor');
  const worker = ctx.worker;
  // the dressing environment every outfit layer reads (rich-outfits.js)
  const E = {
    kit, D, ctx, v, pal, ex, bind, spec, lava, worker, armor,
    bare: D.bare,
    skin: pal.skin,
    skinPaint: lava ? lavaSkin(pal) : null,
    robe: ex.has('skirt') && (worker || ctx.cls === 'support' || (ctx.grand && !armor)),
    tunicColor: ctx.tunic || pal.primary,
    pantheon: ctx.unit.lookOf || ctx.unit.pantheon || null,
    attach: [], // rigid pieces the layers add (flames, wings ...), riding bones
    horse: centaur ? F : null, // a centaur's horse: its build, layout and where the person stands on it
    scorpion: scorpion ? F : null, // a scorpion man's scorpion: where the person stands on it
    elephant: elephant ? F : null, // the elephant under the person: where he sits on it, its heads
  };

  // a pantheon's outfit may recolor the palette (the people's black hair, their skin) and paint the bare skin itself
  // (bandage on a mummy) before anything is built on it
  const outfit = outfitFor(E.pantheon, v.body);
  if (outfit.palette) {
    E.pal = outfit.palette(E.pal, ctx) || E.pal;
    E.skin = E.pal.skin;
  }
  if (outfit.skinPaint) E.skinPaint = outfit.skinPaint(E) || E.skinPaint;
  addHeadAndNeck(kit, D, E.pal, ctx, bind, E.skinPaint, { face: outfit.face ? outfit.face(E) : null });
  if (outfit.hands) outfit.hands(E);
  else addHands(kit, D, E.pal, bind, E.skin, E.skinPaint);
  for (const layer of LAYERS) outfit[layer](E);

  // (a spirit floats: no ground to shade its hem, and the see-through body is faint toward the hem)
  if (spirit) ghostly(kit);
  const geo = kit.build(spirit ? { ground: 0, strength: 0.6 } : {});
  if (F) settle(geo, spec, F);

  // rigid pieces
  const items = humanoidItems(v);
  const attach = [...E.attach];
  if (wings) attach.push(...(v.body === 'beast_biped' ? batWingPieces : wingPieces)(ctx, D, spec, wings));
  const P = D;
  // (the hand is asked about too: a drummer holds the drum in one and the stick in the other)
  const styleOf = (item, side) => (outfit.gear ? outfit.gear(ctx, item, side) : null);
  const leftStyle = styleOf(items.left, -1);
  // (what a hand carries with style.pivot, the Dullahan's head, rides a bone of its own at the palm that the pose keeps upright)
  const palm = leftStyle && leftStyle.pivot ? addPalmBone(spec, B.handL, [0.01, -P.handR * 0.55, -0.005], 'carry') : null;
  const rightPiece = items.right.kind !== 'none' ? heldPiece(ctx, P, 1, items.right, 1, styleOf(items.right, 1)) : null;
  // (a held piece with a flame in it, a torch, flickers like the flames on a fire giant)
  const flickers = (g) => (g.morphAttributes.position ? { flicker: true } : {});
  if (rightPiece) attach.push({ name: 'weaponR', bone: B.handR, geo: rightPiece, ...flickers(rightPiece) });
  if (items.left.kind === 'offhand' && items.left.id === 'shield') {
    attach.push({ name: 'shield', bone: B.foreL, geo: richShield(ctx, P, (typeof outfit.shield === 'function' ? outfit.shield(ctx) : outfit.shield) || {}), shield: true });
  } else if (items.left.kind !== 'none') {
    const left = heldPiece(ctx, P, -1, items.left, 1, leftStyle);
    if (left) attach.push({ name: 'weaponL', bone: palm ?? B.handL, geo: left, ...flickers(left) });
  }
  const rig = {
    hipY: P.hipY, thigh: P.thigh, lean: P.lean, shoulderY: P.shoulderY,
    weapon: v.weapon, offhand: v.offhand, info: WEAPON_INFO[v.weapon] || WEAPON_INFO.none,
    rightElbow: (WEAPON_INFO[v.weapon] || WEAPON_INFO.none).elbow,
    // a crossbow is carried level before the body, the elbow square; a bow hangs at the side
    leftElbow: leftStyle && leftStyle.crossbow ? 1 : v.weapon === 'bow' ? 0.15 : v.weapon === 'claws' ? 0.3 : OFFHAND_ELBOW[v.offhand] ?? 0.25,
    stride: name === 'giant' ? 1.1 : name === 'beast_biped' ? 1.0 : 1.25,
    heavy: name === 'giant',
    holdAloft: holdsAloft(v),
  };
  if (spirit) rig.float = 0.12; // a spirit drifts this far above the ground (as the low-poly spirit does)
  if (centaur) Object.assign(rig, { legLen: F.Q.leg, bodyY: F.Lay.cy, sprawl: false, stride: F.Q.leg * 3.2 + F.Q.L * 0.6, gait: 'gallop', plan: 'centaur' });
  if (scorpion) Object.assign(rig, { legLen: 0.14, bodyY: 0.16, sprawl: true, stride: 0.9, humanTop: true, gait: 'walk', plan: 'scorpion' });
  if (elephant) Object.assign(rig, { legLen: 0.6, bodyY: 0.6, sprawl: false, stride: 1.3, humanTop: true, gait: 'walk', elephant: true, plan: 'elephant' });
  if (worker) {
    rig.tools = ['pick', 'axe', 'hammer'];
    for (const id of rig.tools) attach.push({ name: `tool_${id}`, bone: B.handR, geo: heldPiece(ctx, P, 1, { kind: 'tool', id }), tool: id });
  }
  if (ex.has('flames')) attach.push(...flamePieces(ctx, D, spec));
  if (lava) attach.push(flameMane(ctx, D, spec));
  let triangles = geo.userData.triangles;
  for (const a of attach) if (!a.tool || a.tool === 'pick') triangles += a.geo.userData.triangles ?? a.geo.attributes.position.count / 3;
  return {
    // (a spirit or a naga keeps its kind, so the animation keeps its float or its sway, its lean and its raised arms; ghost: the translucent material)
    kind: spirit ? 'spirit' : naga ? 'naga' : centaur ? 'centaur' : scorpion ? 'insect' : elephant ? 'quadruped' : 'humanoid',
    rich: { spec, geo, attach, dims: D, carryAt: spec.pos[B.chest], ghost: spirit, ...(F ? { plan: centaur ? 'centaur' : scorpion ? 'scorpion' : 'elephant', ix: spec.ix } : {}) }, parts: [], rig,
    triangles, meshes: 1 + attach.filter((a) => !a.tool || a.tool === 'pick').length,
  };
}
