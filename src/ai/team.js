// Team coordination: AIs on the same team share one attack target so they hit
// the same enemy together. The choice is deterministic (weakest enemy by
// buildings, then closest to the team, then lowest index) and kept for a while
// so allies that think on different ticks agree.
import { TRADE_MIN } from '../config.js';
import { tradePartners } from '../sim/trade.js';

const registry = new WeakMap(); // world -> Map(team -> { target, until })

const HOLD_SECONDS = 60;

function teamCenter(world, team) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const b of world.buildingList) {
    if (b.dead || b.owner < 0 || b.def.wall) continue;
    const p = world.players[b.owner];
    if (!p || p.team !== team) continue;
    x += b.x;
    y += b.y;
    n++;
  }
  return n ? { x: x / n, y: y / n } : null;
}

/** Enemy player the team should attack now, or -1. */
export function teamTarget(world, team) {
  let teams = registry.get(world);
  if (!teams) registry.set(world, (teams = new Map()));
  const rec = teams.get(team);
  const valid = (i) => {
    const p = world.players[i];
    return p && !p.defeated && p.team !== team;
  };
  if (rec && rec.until > world.time && valid(rec.target)) return rec.target;
  const center = teamCenter(world, team);
  const counts = new Map();
  const near = new Map();
  for (const b of world.buildingList) {
    if (b.dead || b.owner < 0 || b.def.wall || !valid(b.owner)) continue;
    counts.set(b.owner, (counts.get(b.owner) || 0) + 1);
    if (center) {
      const d = Math.hypot(b.x - center.x, b.y - center.y);
      if (d < (near.get(b.owner) ?? Infinity)) near.set(b.owner, d);
    }
  }
  let best = -1;
  let bestScore = Infinity;
  for (const [i, n] of counts) {
    // Buildings weigh most; distance breaks near-ties (64 tiles ≈ 4 buildings).
    const score = n + (near.get(i) ?? 0) / 16;
    if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && i < best)) {
      bestScore = score;
      best = i;
    }
  }
  teams.set(team, { target: best, until: world.time + HOLD_SECONDS });
  return best;
}

/** Forget a finished target early (e.g. its last building fell). */
export function clearTeamTarget(world, team) {
  const teams = registry.get(world);
  if (teams) teams.delete(team);
}

// Team aid: an AI with a healthy treasury sends part of its surplus to the
// poorest living teammate (human or AI) who is nearly broke, through the same
// market players use (so it pays the market's cut). Deterministic: world state only.
export const AID_RULES = {
  start: 90, // seconds before anyone counts as struggling (everyone is poor early)
  every: 20, // seconds between gifts from one AI
  gold: { keep: 700, broke: 120, send: 200 },
  wood: { keep: 450, broke: 60, send: 150 },
};

/**
 * Gifts this AI would send now: [{ to, res, amount }] (at most one per resource).
 * `budget` is what this think's purchases left over (defaults to the treasury).
 */
export function planAid(world, me, budget = null) {
  const p = world.players[me];
  if (!p || p.defeated || world.time < AID_RULES.start) return [];
  const out = [];
  for (const res of ['gold', 'wood']) {
    const rule = AID_RULES[res];
    const have = budget ? Math.min(p[res], budget[res]) : p[res];
    const spare = Math.floor((have - rule.keep) / 10) * 10;
    if (spare < TRADE_MIN) continue;
    let to = -1;
    for (const i of tradePartners(world.players, me)) {
      const q = world.players[i];
      if (q[res] < rule.broke && (to < 0 || q[res] < world.players[to][res])) to = i;
    }
    if (to >= 0) out.push({ to, res, amount: Math.min(spare, rule.send) });
  }
  return out;
}

/** Send planned gifts, at most once every AID_RULES.every seconds per AI. */
export function runAid(ai, budget = null) {
  const world = ai.world;
  if (world.time < (ai.nextAid || 0)) return;
  const gifts = planAid(world, ai.me, budget);
  if (!gifts.length) return;
  ai.nextAid = world.time + AID_RULES.every;
  for (const g of gifts) ai.issue({ type: 'trade', ...g });
}
