// AI raids (Hard and Brutal, DESIGN 10): while the main army waits at home, a
// small squad of the fastest soldiers slips out to the enemy's least guarded
// mine or wood line, kills Worshippers, and runs home when defenders arrive,
// when it is badly hurt or after a short while. The squad's units are left
// out of the main army's orders (runMilitary) and its focus fire (micro.js)
// until they are home again.
import { newForce, addToForce, fightRatio } from './unit-info.js';
import { localForces, command, computeRoute } from './military.js';

const CELL = 8; // tiles per cell when grouping enemy workers into targets
const HIT_TIME = 45; // most seconds spent hitting workers
const TRIP_TIME = 100; // most seconds from setting out to the target
const HOME_TIME = 45; // most seconds to get home before the squad is released anyway
const ARMY_CLEAR = 22; // tiles a target must be from the enemy army's centre

function avgHp(units) {
  let a = 0;
  for (const u of units) a += u.hp / u.maxHp;
  return units.length ? a / units.length : 1;
}

/** Living squad members (prunes the dead). */
function members(ai) {
  const r = ai.raid;
  const out = [];
  for (const id of r.ids) {
    const u = ai.world.entities.get(id);
    if (u && !u.dead) out.push(u);
    else r.ids.delete(id);
  }
  return out;
}

function centroidOf(units) {
  let x = 0;
  let y = 0;
  for (const u of units) {
    x += u.x;
    y += u.y;
  }
  return { x: x / units.length, y: y / units.length };
}

/** Units that can go: fast fighters, no gods, Titans, siege or healers, flyers first. */
function pickSquad(ai, s, pop) {
  const pool = [];
  for (const u of s.army) {
    const c = u.def.class;
    if (c === 'god' || c === 'titan' || c === 'siege' || c === 'support') continue;
    if (!u.def.attack || u.def.attack.buildingsOnly || ai.godRetreat.has(u.id) || ai.wounded.has(u.id)) continue;
    if (u.hp < u.maxHp * 0.7) continue;
    pool.push(u);
  }
  pool.sort((a, b) => (b.air ? 1 : 0) - (a.air ? 1 : 0) || b.def.speed - a.def.speed || a.id - b.id);
  const out = [];
  let got = 0;
  for (const u of pool) {
    if (got >= pop) break;
    out.push(u);
    got += u.def.pop || 1;
  }
  return got >= pop * 0.7 ? out : null;
}

/** The enemy worker cluster worth hitting: many Worshippers, little guarding it, not too far. */
function pickTarget(ai, s, squadForce) {
  const home = ai.home();
  const cells = new Map();
  for (const e of s.enemies) {
    if (e.defeated) continue;
    for (const u of e.units) {
      if (u.dead || u.def.class !== 'worker') continue;
      const o = u.order;
      if (!o || (o.type !== 'gather' && o.type !== 'return')) continue;
      const key = `${Math.floor(u.x / CELL)},${Math.floor(u.y / CELL)}`;
      let c = cells.get(key);
      if (!c) cells.set(key, (c = { x: 0, y: 0, n: 0, owner: e.index }));
      c.x += u.x;
      c.y += u.y;
      c.n++;
    }
  }
  // Where each enemy's army stands: a raid goes where it is not.
  const armies = [];
  for (const e of s.enemies) {
    if (e.defeated) continue;
    let ax = 0;
    let ay = 0;
    let n = 0;
    for (const u of e.units) {
      if (u.dead || u.def.class === 'worker' || u.air) continue;
      ax += u.x;
      ay += u.y;
      n++;
    }
    if (n >= 3) armies.push({ x: ax / n, y: ay / n });
  }
  let best = null;
  let bestScore = 0;
  for (const c of cells.values()) {
    if (c.n < 3) continue;
    const x = c.x / c.n;
    const y = c.y / c.n;
    if (armies.some((a) => Math.hypot(a.x - x, a.y - y) < ARMY_CLEAR)) continue;
    const lf = localForces(ai, x, y, 12);
    if (lf.theirs.n > 0 && fightRatio(squadForce, lf.theirs) < 1.6) continue;
    const d = Math.hypot(x - home.x, y - home.y);
    const score = (c.n / (1 + lf.theirs.n * 0.7)) / (1 + d / 60);
    if (score > bestScore) {
      bestScore = score;
      best = { x, y, owner: c.owner };
    }
  }
  return best;
}

/** Send the squad home; it is released into the army once there. */
function goHome(ai, s, units, why) {
  const r = ai.raid;
  if (ai.log) ai.log.push(`${(s.t / 60).toFixed(2)}m raid home (${why}) from ${r.phase}, ${units.length} left`);
  const rp = ai.rallyPoint();
  r.phase = 'home';
  r.since = s.t;
  command(ai, units, 'move', rp.x, rp.y, true);
}

function release(ai, s) {
  const r = ai.raid;
  for (const id of r.ids) ai.cmdMemo.delete(id);
  r.ids.clear();
  r.phase = null;
  r.lastEnd = s.t;
}

/** One raid step per think. */
export function runRaids(ai, s) {
  const cfg = ai.prof.raids;
  if (!cfg) return;
  if (!ai.raid) ai.raid = { ids: new Set(), phase: null, since: 0, lastEnd: 0, target: null, route: null, wp: 0, sent: 0 };
  const r = ai.raid;
  const mil = ai.mil;
  if (!r.phase) {
    // Set out only from a quiet base, with the army at home and big enough to spare a squad.
    if (s.peace || s.t < cfg.from || s.t - r.lastEnd < cfg.every || ai.threat) return;
    if (mil.mode !== 'home' || s.armyPop < cfg.minArmy + cfg.pop) return;
    const squad = pickSquad(ai, s, cfg.pop);
    if (!squad) return;
    const f = newForce();
    for (const u of squad) addToForce(f, u);
    const target = pickTarget(ai, s, f);
    if (!target) {
      r.lastEnd = s.t - cfg.every * 0.6; // look again a little later
      return;
    }
    const c = centroidOf(squad);
    r.target = target;
    r.route = computeRoute(ai.world, c, target, 4) || [target];
    r.wp = 0;
    r.phase = 'go';
    r.since = s.t;
    r.sent++;
    for (const u of squad) r.ids.add(u.id);
    command(ai, squad, 'move', r.route[0].x, r.route[0].y, true);
    if (ai.log) ai.log.push(`${(s.t / 60).toFixed(2)}m raid ${squad.length} units -> p${target.owner} (${target.x.toFixed(0)},${target.y.toFixed(0)})`);
    return;
  }
  const units = members(ai);
  if (!units.length) {
    release(ai, s);
    return;
  }
  const c = centroidOf(units);
  if (r.phase === 'home') {
    const rp = ai.rallyPoint();
    if (Math.hypot(c.x - rp.x, c.y - rp.y) < 10 || s.t - r.since > HOME_TIME) release(ai, s);
    else command(ai, units, 'move', rp.x, rp.y);
    return;
  }
  // The base needs everyone, the squad is hurt, or what it meets is too strong: home.
  if (ai.threat && ai.threat.urgent && ai.threat.power > 2) return goHome(ai, s, units, 'base');
  if (avgHp(units) < 0.45) return goHome(ai, s, units, 'hurt');
  const own = newForce();
  for (const u of units) addToForce(own, u);
  const lf = localForces(ai, c.x, c.y, 10, { allies: false });
  if (lf.theirs.n > 0 && fightRatio(own, lf.theirs) < 1.1) return goHome(ai, s, units, 'outmatched');
  if (r.phase === 'go') {
    const route = r.route;
    while (r.wp < route.length - 1 && Math.hypot(c.x - route[r.wp].x, c.y - route[r.wp].y) < 5) r.wp++;
    const wp = route[r.wp];
    if (Math.hypot(c.x - r.target.x, c.y - r.target.y) < 9) {
      r.phase = 'hit';
      r.since = s.t;
    } else if (s.t - r.since > TRIP_TIME) {
      return goHome(ai, s, units, 'trip');
    } else {
      command(ai, units, 'move', wp.x, wp.y);
      return;
    }
  }
  // Hit: each member attacks the nearest enemy Worshipper; none left near, or time up, ends it.
  if (s.t - r.since > HIT_TIME) return goHome(ai, s, units, 'time');
  const tmp = ai._tmp;
  let any = false;
  for (const u of units) {
    const o = u.order;
    if (o && o.type === 'attack') {
      const cur = ai.world.entities.get(o.target);
      if (cur && !cur.dead && cur.def.class === 'worker') {
        any = true;
        continue;
      }
    }
    tmp.length = 0;
    ai.world.hash.query(u.x, u.y, 12, tmp);
    let best = null;
    let bestD = Infinity;
    for (const e of tmp) {
      if (e.dead || e.kind !== 'unit' || e.def.class !== 'worker' || !ai.world.canHarm(ai.me, e.owner)) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y) + (e.hp / e.maxHp) * 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) {
      any = true;
      ai.issue({ type: 'attack', units: [u.id], target: best.id });
      ai.cmdMemo.delete(u.id);
    }
  }
  if (!any) {
    // Nobody left here: try the next cluster once if it is close, else go home.
    const f = own;
    const next = pickTarget(ai, s, f);
    if (next && Math.hypot(next.x - c.x, next.y - c.y) < 25 && s.t - r.since < HIT_TIME - 10) {
      r.target = next;
      r.route = [next];
      r.wp = 0;
      r.phase = 'go';
      command(ai, units, 'move', next.x, next.y, true);
    } else goHome(ai, s, units, 'done');
  }
}
