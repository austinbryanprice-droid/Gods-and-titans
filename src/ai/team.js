// Team coordination: AIs on the same team share one attack target so they hit
// the same enemy together. The choice is deterministic (weakest enemy by
// buildings, then closest to the team, then lowest index) and kept for a while
// so allies that think on different ticks agree.
const registry = new WeakMap(); // world -> Map(team -> { target, until })

const HOLD_SECONDS = 60;

function teamCenter(world, team) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const b of world.buildingList) {
    if (b.dead || b.owner < 0) continue;
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
    if (b.dead || b.owner < 0 || !valid(b.owner)) continue;
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
