// Answering a teammate's markers (DESIGN 10, "Answering team marks"): a human's Attack, Defend or
// Help marker reaches the sim as a `teamMark` command (src/sim/team-orders.js), and every AI on
// that team (a stand-in seat too) sends a share of its army there, keeping a home guard back. An
// order stands until it expires or a newer one replaces it; the army's own base comes first. All
// of it is read from the World, so it is as deterministic as the rest of the AI.
import { teamOrderFor } from '../sim/team-orders.js';
import { localForces, centroid, command } from './military.js';
import { fightRatio } from './unit-info.js';

/** Share of the army (by population) sent to each kind of mark; the rest guards home. */
export const MARK_SHARE = { attack: 0.7, defend: 0.8, help: 0.85 };

const ARRIVED = 12; // tiles: the party stands at the mark
const SIEGE_RANGE = 14; // tiles: enemy buildings this close to an Attack mark are its target
const FIGHT_RANGE = 12; // tiles: enemy units this close to a Defend / Help mark are fought

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The teammate's order this AI answers now, or null (an Attack mark waits out a Decade of Peace). */
export function markToAnswer(ai, s) {
  const m = teamOrderFor(ai.world, ai.me);
  if (!m || m.id === ai.mil.markDone) return null;
  if (m.kind === 'attack' && s.peace) return null;
  return m;
}

/**
 * Split the fighters into the home guard (sticky across thinks, the ones nearest the rally point
 * first, never a god or the Titan) and the party sent to the mark.
 */
function splitArmy(ai, fighters, kind) {
  const mil = ai.mil;
  const rally = ai.rallyPoint();
  let pop = 0;
  for (const u of fighters) pop += u.def.pop || 1;
  const want = Math.floor(pop * (1 - MARK_SHARE[kind]));
  const guard = new Set();
  let have = 0;
  const byId = new Map(fighters.map((u) => [u.id, u]));
  for (const id of mil.guard || []) {
    const u = byId.get(id);
    if (u && have < want) {
      guard.add(id);
      have += u.def.pop || 1;
    }
  }
  if (have < want) {
    const sent = mil.sent || new Set();
    const pool = fighters.filter((u) => !guard.has(u.id) && !sent.has(u.id) && u.def.class !== 'god' && u.def.class !== 'titan' && u.def.class !== 'siege');
    pool.sort((a, b) => dist(a, rally) - dist(b, rally) || a.id - b.id);
    for (const u of pool) {
      if (have >= want) break;
      if (have + (u.def.pop || 1) > want) continue;
      guard.add(u.id);
      have += u.def.pop || 1;
    }
  }
  mil.guard = guard;
  const party = fighters.filter((u) => !guard.has(u.id));
  mil.sent = new Set(party.map((u) => u.id));
  return { guard: fighters.filter((u) => guard.has(u.id)), party };
}

/** Nearest living enemy building of a player within r of a point. */
function enemyBuildingNear(s, x, y, r) {
  let best = null;
  let bestD = r;
  for (const e of s.enemies) {
    if (e.defeated) continue;
    for (const b of e.buildings) {
      if (b.dead) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
  }
  return best;
}

/** Where the enemy units within r of a point stand (their median), or null (none in a Decade of Peace: s.enemyUnits are not a threat then). */
function enemiesNear(s, x, y, r) {
  if (s.peace) return null;
  const found = s.enemyUnits.filter((u) => !u.dead && Math.hypot(u.x - x, u.y - y) <= r);
  return found.length ? centroid(found) : null;
}

/**
 * One think of the 'mark' mode (military.js): the guard holds home, the party goes to the mark.
 * Returns false when the order is over (the caller goes home).
 */
export function runMark(ai, s, fighters, rams, minions) {
  const mil = ai.mil;
  const m = mil.mark;
  const rally = ai.rallyPoint();
  const { guard, party } = splitArmy(ai, fighters, m.kind);
  if (m.kind === 'attack') party.push(...rams);
  else guard.push(...rams);
  party.push(...minions);
  if (!party.length) {
    // Nobody to send yet: the order stands, and soldiers trained meanwhile go.
    command(ai, guard, 'attackMove', rally.x, rally.y);
    return true;
  }
  // The guard stays home and meets whatever comes at the base.
  if (guard.length) {
    const th = ai.threat;
    command(ai, guard, 'attackMove', th ? th.x : rally.x, th ? th.y : rally.y);
  }
  const c = centroid(party);
  // Like a wave (military.js runAttack): back home when the fight there is lost (the allies' units count
  // on our side). The order is then answered: the army does not walk back into the same fight.
  if (c) {
    const lf = localForces(ai, c.x, c.y, 14);
    if ((lf.theirs.n >= 2 || lf.theirs.dpsG > 30) && fightRatio(lf.mine, lf.theirs) < ai.prof.retreatRatio) {
      mil.markDone = m.id;
      command(ai, party, 'move', rally.x, rally.y, true);
      return 'retreat';
    }
  }
  if (m.kind === 'attack') {
    const b = c && dist(c, m) < ARRIVED ? enemyBuildingNear(s, m.x, m.y, SIEGE_RANGE) : null;
    if (b) {
      command(ai, party.filter((u) => u.def.class !== 'siege'), 'attackMove', b.x, b.y + b.size / 2 + 0.8);
      for (const r of party) {
        if (r.def.class !== 'siege') continue;
        if (r.order && r.order.type === 'attack' && r.order.target === b.id) continue;
        ai.issue({ type: 'attack', units: [r.id], target: b.id });
        ai.cmdMemo.delete(r.id);
      }
    } else command(ai, party, 'attackMove', m.x, m.y);
    return true;
  }
  // Defend / Help: hold the spot and fight what comes near it.
  const foe = c && dist(c, m) < ARRIVED ? enemiesNear(s, m.x, m.y, FIGHT_RANGE) : null;
  command(ai, party, 'attackMove', foe ? foe.x : m.x, foe ? foe.y : m.y);
  return true;
}
