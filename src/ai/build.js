// AI construction planning: which buildings it wants next (with priorities
// for the shared spending queue), where they go, who builds them, and
// resuming construction sites that lost their builder.
import { BUILDINGS } from '../data/index.js';
import { POP_MAX } from '../config.js';
import { haveOf, doneOf } from './scan.js';
import { findSpot } from './placement.js';
import { onLongHaul } from './economy.js';

const HAUL_BUILD = 20; // tiles: how much farther a builder may be than a worker on a long haul (pickBuilder)

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Pick a worker to build at (x, y): a gatherer close by, never a prayer unless needed. */
export function pickBuilder(ai, s, x, y, exclude) {
  let best = null;
  let bestD = Infinity;
  for (const u of s.workers) {
    if (exclude && exclude.has(u.id)) continue;
    if (ai.militia && ai.militia.has(u.id)) continue;
    const j = s.job.get(u.id);
    if (j === 'build' || j === 'fight') continue;
    let d = Math.hypot(u.x - x, u.y - y);
    if (j === 'pray') d += 25;
    if (j === 'idle') d -= 4;
    if (u.carry && u.carryAmount > 0) d += 3;
    // A worker just sent on a long haul to a far mine is passed over: taken for a build as it left
    // the base, it never got there, and the next worker sent after it walked the same way.
    if (onLongHaul(ai, u)) d += HAUL_BUILD;
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

/** Issue a build of `type` at a spot found by `spotFn`. Returns true when ordered. */
function orderBuild(ai, s, type, spot, helpers = 0) {
  if (!spot) return false;
  const def = BUILDINGS[type];
  const cx = spot.tx + def.size / 2;
  const cy = spot.ty + def.size / 2;
  const used = new Set();
  const first = pickBuilder(ai, s, cx, cy, used);
  if (!first) return false;
  used.add(first.id);
  const ids = [first.id];
  for (let i = 0; i < helpers; i++) {
    const h = pickBuilder(ai, s, cx, cy, used);
    if (!h || s.job.get(h.id) === 'pray') break;
    used.add(h.id);
    ids.push(h.id);
  }
  ai.issue({ type: 'build', units: ids, building: type, tx: spot.tx, ty: spot.ty });
  for (const id of ids) s.job.set(id, 'build');
  s.jobs.build += ids.length;
  s.have.set(type, (s.have.get(type) || 0) + 1);
  return true;
}

/** Spot for a regular base building around the main base. */
function baseSpot(ai, type) {
  const home = ai.home();
  if (!home) return null;
  const front = ai.frontDir();
  const world = ai.world;
  switch (type) {
    case 'house':
      return findSpot(world, ai, type, home.x, home.y, { minR: 4.5, maxR: 16, ideal: 6.5, dir: { x: -front.x, y: -front.y }, dirWeight: 4 });
    case 'barracks':
      return findSpot(world, ai, type, home.x, home.y, { minR: 5.5, maxR: 16, ideal: 7.5, dir: front, dirWeight: 8 });
    case 'shrine':
      return findSpot(world, ai, type, home.x, home.y, { minR: 4.5, maxR: 16, ideal: 6, dir: { x: -front.y, y: front.x }, dirWeight: 3 });
    case 'temple':
      return findSpot(world, ai, type, home.x, home.y, { minR: 5, maxR: 16, ideal: 7, dir: { x: front.y, y: -front.x }, dirWeight: 3 });
    case 'titan_gate':
      return findSpot(world, ai, type, home.x, home.y, { minR: 6, maxR: 18, ideal: 9, dir: front, dirWeight: 6 });
    default:
      return findSpot(world, ai, type, home.x, home.y, { minR: 4, maxR: 16, ideal: 7 });
  }
}

/** Town Center rebuild spot: near the home mine (or any mine), respecting the 3-tile mine gap. */
function townCenterSpot(ai, s) {
  const world = ai.world;
  const anchor = ai.homeAnchor || ai.home();
  const mines = world.mineList.filter((m) => !m.dead && m.amount > 500 && !ai.mineThreatened(m, s));
  mines.sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y));
  for (const m of mines.slice(0, 3)) {
    const spot = findSpot(world, ai, 'town_center', m.x, m.y, { minR: 5.5, maxR: 10, ideal: 6.5, avoidReserved: false });
    if (spot) return spot;
  }
  return anchor ? findSpot(world, ai, 'town_center', anchor.x, anchor.y, { maxR: 14, avoidReserved: false }) : null;
}

/** Spot for a storehouse next to the trees at the current wood spot. */
function woodStoreSpot(ai) {
  const spot = ai.woodFar;
  if (!spot) return null;
  return findSpot(ai.world, ai, 'storehouse', spot.tx + 0.5, spot.ty + 0.5, { minR: 1.5, maxR: 7, ideal: 2.2, avoidReserved: false });
}

/** Spot for a storehouse when every drop-off is gone: by the trees the workers chop, else by a worker. */
function lostDropSpot(ai, s) {
  const spot = ai.woodSpot;
  const at = spot ? { x: spot.tx + 0.5, y: spot.ty + 0.5 } : s.workers[0];
  if (!at) return null;
  return findSpot(ai.world, ai, 'storehouse', at.x, at.y, { minR: 1.5, maxR: 9, ideal: 2.5, avoidReserved: false });
}

function expansionSpot(ai) {
  const m = ai.expansion && ai.expansion.mine;
  if (!m || m.dead) return null;
  const home = ai.home() || m;
  const dir = sub(home, m);
  const l = Math.hypot(dir.x, dir.y) || 1;
  return findSpot(ai.world, ai, 'storehouse', m.x, m.y, { minR: 2.8, maxR: 7, ideal: 3.4, dir: { x: dir.x / l, y: dir.y / l }, dirWeight: 2, avoidReserved: false });
}

function towerSpot(ai) {
  const t = ai.towerTarget;
  if (!t) return null;
  return findSpot(ai.world, ai, 'tower', t.x, t.y, { minR: 1.5, maxR: 8, ideal: 2.5 });
}

/** Distance from the best drop-off to the nearest trees (for storehouse planning). */
function woodIsFar(ai, s) {
  const spot = ai.woodSpot;
  if (!spot || s.jobs.wood < 3) return null;
  if (spot.dist > 4.5) return spot;
  return null;
}

/**
 * Add construction wants for this think.
 * @param {object} ai
 * @param {object} s scan
 * @param {Array} wants
 */
export function planBuildings(ai, s, wants) {
  const prof = ai.prof;
  const p = s.p;
  const t = s.t;
  const tier = p.tier;
  const add = (prio, type, spotFn, opts = {}) => {
    const def = BUILDINGS[type];
    if (!def) return;
    if (def.tier > tier) return;
    for (const r of def.requires || []) if (!doneOf(s, r)) return;
    wants.push({
      prio,
      cost: def.cost,
      reserve: opts.reserve !== false,
      label: type,
      run: () => orderBuild(ai, s, type, spotFn(), opts.helpers || 0),
    });
  };
  if (!s.workers.length) return;

  // Town Center lost: rebuilding it comes first. With no drop-off left at all and the Town Center out of
  // reach, a storehouse by the trees goes up before it, so the carriers can deliver and the economy restarts.
  if (haveOf(s, 'town_center') === 0) {
    const tc = BUILDINGS.town_center.cost;
    if (haveOf(s, 'storehouse') === 0 && (p.gold < tc.gold || p.wood < tc.wood)) {
      add(101, 'storehouse', () => lostDropSpot(ai, s), { reserve: false });
    }
    add(100, 'town_center', () => townCenterSpot(ai, s), { helpers: Math.min(3, s.workers.length - 1) });
    return;
  }

  // Houses ahead of the cap.
  const unfinishedHouses = (s.have.get('house') || 0) - doneOf(s, 'house');
  let futureCap = p.popCap + unfinishedHouses * BUILDINGS.house.popProvided;
  for (const b of s.sites) if (b.type === 'town_center') futureCap += BUILDINGS.town_center.popProvided;
  const producers = doneOf(s, 'barracks') + doneOf(s, 'shrine') + (doneOf(s, 'temple') ? 1 : 0) + s.tcs.length;
  const buffer = prof.houseBuffer + 2 * producers;
  if (futureCap < POP_MAX && futureCap - p.popUsed < buffer && unfinishedHouses < (prof.think <= 5 ? 3 : 2)) {
    add(futureCap - p.popUsed < 3 ? 93 : 86, 'house', () => baseSpot(ai, 'house'));
  }

  const nW = s.workers.length;
  if (haveOf(s, 'shrine') === 0 && t >= prof.shrineAt) add(84, 'shrine', () => baseSpot(ai, 'shrine'));
  if (haveOf(s, 'barracks') === 0 && (nW >= prof.barracksWorkers || t > 150)) add(80, 'barracks', () => baseSpot(ai, 'barracks'));
  if (haveOf(s, 'temple') === 0 && doneOf(s, 'shrine') && haveOf(s, 'barracks') && t >= prof.templeAt) {
    add(82, 'temple', () => baseSpot(ai, 'temple'), { helpers: prof.think <= 5 ? 1 : 0 });
  }
  const barracks = haveOf(s, 'barracks');
  if (prof.secondBarracks && tier >= 2 && barracks < 2 && nW >= 16) add(56, 'barracks', () => baseSpot(ai, 'barracks'), { reserve: false });
  // Gold piling up: more production (two at once when the bank is large).
  let barracksSites = 0;
  for (const b of s.sites) if (b.type === 'barracks') barracksSites++;
  for (const q of s.pending) if (q.b === 'barracks') barracksSites++;
  if (barracks >= 1 && barracks < prof.maxBarracks && p.gold > 400 + 150 * barracks && t > 150 && barracksSites < (p.gold > 1800 ? 2 : 1)) {
    add(57, 'barracks', () => baseSpot(ai, 'barracks'), { reserve: false });
  }
  const shrines = haveOf(s, 'shrine');
  if (tier >= 2 && shrines >= 1 && shrines < prof.maxShrines && (p.gold > 1100 || (prof.secondShrine && tier >= 3))) {
    add(55, 'shrine', () => baseSpot(ai, 'shrine'), { reserve: false });
  }
  if (tier >= 3 && haveOf(s, 'titan_gate') === 0 && doneOf(s, 'temple')) {
    add(79, 'titan_gate', () => baseSpot(ai, 'titan_gate'), { helpers: prof.think <= 10 ? 1 : 0 });
  }

  // Storehouse by a distant wood line.
  ai.woodFar = woodIsFar(ai, s);
  if (ai.woodFar && s.sites.every((b) => b.type !== 'storehouse') && !s.pending.some((q) => q.b === 'storehouse')) {
    add(66, 'storehouse', () => woodStoreSpot(ai), { reserve: false });
  }

  // Expansion drop-off once its guards are dead.
  const ex = ai.expansion;
  if (ex && ex.ready && !ex.built && !s.pending.some((q) => q.b === 'storehouse') && !s.sites.some((b) => b.type === 'storehouse' && Math.hypot(b.x - ex.mine.x, b.y - ex.mine.y) < 9)) {
    add(78, 'storehouse', () => expansionSpot(ai));
  }

  // Towers where the base was hit (or guarding the expansion).
  const towers = haveOf(s, 'tower');
  if (ai.towerTarget && towers < prof.towersMax && t > 150 && !s.pending.some((q) => q.b === 'tower')) {
    add(ai.towerTarget.urgent ? 85 : 58, 'tower', () => towerSpot(ai), { reserve: !!ai.towerTarget.urgent });
  }
}

/** Unfinished sites with nobody building them get a worker. */
export function resumeSites(ai, s) {
  if (!s.sites.length) return;
  const building = new Map();
  for (const u of s.workers) {
    const o = u.order;
    if (o && o.type === 'build' && o.site) building.set(o.site, (building.get(o.site) || 0) + 1);
  }
  for (const b of s.sites) {
    if (building.get(b.id)) continue;
    if (ai.threatNear(b.x, b.y, 7)) continue;
    const u = pickBuilder(ai, s, b.x, b.y);
    if (!u) return;
    s.job.set(u.id, 'build');
    ai.issue({ type: 'smart', units: [u.id], target: b.id, x: b.x, y: b.y });
  }
}
