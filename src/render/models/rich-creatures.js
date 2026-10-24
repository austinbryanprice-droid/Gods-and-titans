// Which rich body plan builds a creature unit (everything that is not a standing humanoid): the four-legged
// beasts today, the birds, serpents, dragons, half-human bodies ... as each plan lands. A plan is a pair of
// functions: `supported(visual)` (can it dress this look) and `build(unitType, ctx)` (its rich template, shaped
// like a humanoid's: { kind, rich: { spec, geo, attach, plan, ix, ... }, rig, parts: [], triangles, meshes }).
// rich-humanoid.js asks this file, so it must not import rich-humanoid.js back.
import { unitContext, normalizeVisual } from './unit-bodies.js';
import { quadSupported, buildQuadrupedTemplate } from './rich-quadruped.js';

const PLANS = [
  { supported: quadSupported, build: buildQuadrupedTemplate },
];

/** The plan that dresses this unit type, or null (the unit keeps its low-poly model). */
function planFor(unitType) {
  const raw = unitType.visual;
  if (!raw || !raw.body) return null;
  const v = normalizeVisual(raw);
  return PLANS.find((p) => p.supported(v, unitType)) || null;
}

/** Whether a creature plan can dress this unit type. */
export function creatureSupported(unitType) {
  return planFor(unitType) !== null;
}

/** The rich template of a creature unit type (check creatureSupported first). */
export function buildCreatureTemplate(unitType) {
  const plan = planFor(unitType);
  return plan.build(unitType, unitContext(unitType));
}
