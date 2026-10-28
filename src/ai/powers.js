// The AI's god powers (DESIGN 10): each power is spent once, at a moment worth it. A harvest or
// prayer blessing waits for a working economy, a heal for a hurt army, a caravan for the first
// minutes; a strike or cataclysm for the densest knot of enemies its team can see, worth more
// than a set amount of enemy health. Reads the World only through the
// scan and the sim's own refusal check, and acts through world.issueCommand.
import { powersFor, powerRadius } from '../data/powers.js';
import { powerRefusal } from '../sim/powers.js';
import { hyp } from '../sim/common.js';

const STRIKE_WORTH = 1800; // enemy health a Town strike must catch (a cataclysm needs CATACLYSM_WORTH)
const CATACLYSM_WORTH = 3600;
const BUILDING_WORTH = 0.25; // a building in the area counts this share of its health (spell damage to buildings is halved, and it does not run)
const MAX_CANDIDATES = 48; // enemy units looked at as centres per think
const HEAL_MISSING = 1200; // missing health among own units near a spot before a heal rain is worth it

/** Look for one power to cast this think. */
export function runPowers(ai, s) {
  const world = ai.world;
  const p = s.p;
  const list = powersFor(p.pantheon);
  for (let i = 0; i < list.length; i++) {
    const pw = list[i];
    if (p.powers.used & (1 << i) || p.tier < pw.tier) continue;
    const spot = pickSpot(ai, s, pw);
    if (!spot) continue;
    if (powerRefusal(world, ai.me, pw.id, spot.x, spot.y)) continue;
    const cmd = { type: 'godPower', power: pw.id };
    if (pw.target === 'point') Object.assign(cmd, { x: spot.x, y: spot.y });
    ai.issue(cmd);
    ai.stats.powers++;
    return pw;
  }
  return null;
}

/** Where (and whether) to cast a power now: { x, y } or null. */
function pickSpot(ai, s, pw) {
  const use = pw.ai.use;
  const k = ai.prof.castThreshold || 1;
  if (use === 'economy') return economySpot(s, pw, k);
  if (use === 'heal') return healSpot(ai, s, pw, k);
  return strikeSpot(ai, s, pw, (pw.tier >= 3 ? CATACLYSM_WORTH : STRIKE_WORTH) * k);
}

function economySpot(s, pw, k) {
  const eff = pw.effects[0];
  const here = s.tcs[0] || s.buildings[0];
  const at = here ? { x: here.x, y: here.y } : { x: 0, y: 0 };
  if (eff.type === 'resource') return s.t >= 90 * k ? at : null;
  if (eff.stat === 'faith') return s.jobs.pray >= Math.round(5 * k) ? at : null;
  return s.jobs.gold + s.jobs.wood >= Math.round(12 * k) ? at : null;
}

function healSpot(ai, s, pw, k) {
  const r = powerRadius(pw);
  let best = null;
  let bestMissing = HEAL_MISSING * k;
  for (const u of s.army) {
    if (u.dead || u.hp > u.maxHp * 0.7) continue;
    let missing = 0;
    for (const o of s.army) if (!o.dead && hyp(o.x - u.x, o.y - u.y) <= r) missing += o.maxHp - o.hp;
    if (missing > bestMissing) {
      bestMissing = missing;
      best = { x: u.x, y: u.y };
    }
  }
  return best;
}

function strikeSpot(ai, s, pw, need) {
  const world = ai.world;
  if (world.peace || !s.enemyUnits.length) return null;
  const r = powerRadius(pw);
  const me = ai.me;
  const units = s.enemyUnits;
  // A spread of candidate centres: the enemy units themselves, a stride through the list when it is long.
  const stride = Math.max(1, Math.ceil(units.length / MAX_CANDIDATES));
  let best = null;
  let bestScore = need;
  for (let i = (world.tickCount % stride); i < units.length; i += stride) {
    const c = units[i];
    if (c.dead) continue;
    let score = 0;
    for (const e of world.queryRadius(c.x, c.y, r, (o) => o.kind !== 'mine' && o.owner >= 0)) {
      // (Powers never hurt the caster's side, so only what the enemy has there counts.)
      if (world.canHarm(me, e.owner)) score += e.kind === 'building' ? (pw.tier >= 3 ? e.hp * BUILDING_WORTH : 0) : e.hp;
    }
    if (score > bestScore && !powerRefusal(world, me, pw.id, c.x, c.y)) {
      bestScore = score;
      best = { x: c.x, y: c.y };
    }
  }
  return best;
}
