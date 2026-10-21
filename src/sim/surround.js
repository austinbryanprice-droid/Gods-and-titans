// Melee surround (WC3-style): a melee attacker close to its target picks a
// free attack spot on the target's perimeter (a ring around a unit, a rounded
// rectangle around a building), skipping spots taken by units standing there
// and spots other attackers have claimed. It walks around the crowd to reach
// its spot and re-picks when the spot is taken or it stops making progress.
// Attackers that find no free spot wait outside the crowd ('blocked'), which
// lets attack-move / auto-acquire switch to an enemy they can reach.
import { hyp, distPointRect } from './common.js';
import { moveToPoint, moveToRect, moveToUnit, steerToPoint, stopMove } from './movement.js';
import { segmentClear } from './pathfinding.js';

export const SURROUND_DIST = 7; // edge distance from the target at which melee attackers claim spots (≥ acquisition range)
const REPICK_TICKS = 12; // re-check the spot this often
const PROGRESS_TICKS = 10; // progress check interval while walking to the spot
const BAD_SPOT_TICKS = 60; // a spot we got stuck on is avoided this long
const CUT_SPOTS = 2; // attack spots no path reaches before the target counts as shut in
const AROUND = 0.6; // radians: circle the crowd until within this angle of the spot
const TWO_PI = Math.PI * 2;

/** Ground melee attacker (no projectile). */
export function isMelee(u) {
  const atk = u.def.attack;
  return !!(atk && !atk.projectile && !u.air && u.kind === 'unit');
}

function wrap(a) {
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
}

/** Edge gap kept between attacker and target at a spot (well inside melee range). */
function ringGap(u) {
  return Math.min(0.25, u.def.attack.range * 0.5);
}

function spacingOf(u) {
  return 2 * u.radius + 0.1;
}

function newState(t, now) {
  return { tid: t.id, has: false, a: 0, R: 0, x: 0, y: 0, next: now, checkT: now, lastD: Infinity, badA: 0, badX: 0, badY: 0, badUntil: 0, chaseUntil: 0, cut: 0, isRect: t.kind !== 'unit' };
}

function claimValid(c, t) {
  const s = c.atk;
  return !c.dead && s !== null && s.has && s.tid === t.id && c.target === t.id;
}

/** Position of a claimed spot (rings follow a moving target). */
function spotPos(t, s, out) {
  if (s.isRect) {
    out.x = s.x;
    out.y = s.y;
  } else {
    out.x = t.x + Math.cos(s.a) * s.R;
    out.y = t.y + Math.sin(s.a) * s.R;
  }
  return out;
}

const tmpPos = { x: 0, y: 0 };
let lastCost = 0; // walking cost of the spot the last pick found
const tmpPos2 = { x: 0, y: 0 };

function pruneClaimers(t) {
  const cl = t.claimers;
  if (!cl) return;
  let w = 0;
  for (let i = 0; i < cl.length; i++) if (claimValid(cl[i], t)) cl[w++] = cl[i];
  cl.length = w;
}

function addClaimer(t, u) {
  if (!t.claimers) t.claimers = [];
  if (!t.claimers.includes(u)) t.claimers.push(u);
}

/** Is a spot free: on the map, passable, nobody settled on it, not claimed by another attacker? */
function spotFree(world, u, t, px, py, near) {
  const map = world.map;
  if (px < 0.3 || py < 0.3 || px > map.width - 0.3 || py > map.height - 0.3) return false;
  if (!map.isPassable(Math.floor(px), Math.floor(py))) return false;
  for (let i = 0; i < near.length; i++) {
    const o = near[i];
    if (o === u || o === t || o.dead || o.air || o.ghost) continue;
    if (o.moving && o.state !== 'attack') continue; // just passing by
    const lim = (u.radius + o.radius) * 0.9;
    const dx = o.x - px;
    const dy = o.y - py;
    if (dx * dx + dy * dy < lim * lim) return false;
  }
  const cl = t.claimers;
  if (cl) {
    for (let i = 0; i < cl.length; i++) {
      const c = cl[i];
      if (c === u || !claimValid(c, t)) continue;
      const p = spotPos(t, c.atk, tmpPos2);
      const lim = (u.radius + c.radius) * 0.9;
      const dx = p.x - px;
      const dy = p.y - py;
      if (dx * dx + dy * dy < lim * lim) return false;
    }
  }
  return true;
}

const arcs = []; // blocked arcs [lo0, hi0, lo1, hi1, ...] relative to the attacker's angle
const cands = [];
let terrainHit = false; // a ring candidate was rejected by terrain, the map edge or a bad-spot mark

/** Block the ring arc within `lim` of an obstacle at (ox, oy). */
function blockArc(t, R, base, ox, oy, lim) {
  const dx = ox - t.x;
  const dy = oy - t.y;
  const ro = hyp(dx, dy);
  if (ro < 1e-6) {
    if (lim > R) arcs.push(-Math.PI, Math.PI);
    return;
  }
  const c = (R * R + ro * ro - lim * lim) / (2 * R * ro);
  if (c >= 1) return;
  const hw = c <= -1 ? Math.PI : Math.acos(c);
  const ao = wrap(Math.atan2(dy, dx) - base);
  arcs.push(ao - hw, ao + hw);
}

function inArcs(off) {
  for (let i = 0; i < arcs.length; i += 2) {
    const lo = arcs[i];
    const hi = arcs[i + 1];
    if (hi - lo >= TWO_PI - 1e-9) return true;
    const mid = (lo + hi) / 2;
    if (Math.abs(wrap(off - mid)) < (hi - lo) / 2) return true;
  }
  return false;
}

/**
 * Ring spot around a unit target: the free position on the ring closest (in
 * angle) to the attacker, packed right next to the attackers already there.
 * Occupied arcs come from units standing near the ring and from other
 * attackers' claims. The current spot is kept while it is still free.
 */
function pickUnitSpot(world, u, t, s, dry) {
  const R = t.radius + u.radius + ringGap(u);
  const rx = u.x - t.x;
  const ry = u.y - t.y;
  const base = Math.atan2(ry, rx);
  const near = world._tmpSurround;
  near.length = 0;
  world.hash.query(t.x, t.y, R + u.radius + world.maxRadius, near);
  const dU = Math.max(0, hyp(rx, ry) - R);
  if (!dry && s.has && Math.abs(s.R - R) < 1e-6) {
    const px = t.x + Math.cos(s.a) * R;
    const py = t.y + Math.sin(s.a) * R;
    if (spotFree(world, u, t, px, py, near)) {
      lastCost = dU + R * Math.abs(wrap(s.a - base));
      return true;
    }
  }
  arcs.length = 0;
  for (let i = 0; i < near.length; i++) {
    const o = near[i];
    if (o === u || o === t || o.dead || o.air || o.ghost) continue;
    if (o.moving && o.state !== 'attack') continue;
    blockArc(t, R, base, o.x, o.y, (u.radius + o.radius) * 0.9);
  }
  const cl = t.claimers;
  if (cl) {
    for (let i = 0; i < cl.length; i++) {
      const c = cl[i];
      if (c === u || !claimValid(c, t)) continue;
      const p = spotPos(t, c.atk, tmpPos2);
      blockArc(t, R, base, p.x, p.y, (u.radius + c.radius) * 0.9);
    }
  }
  // Candidates: straight ahead, then the edges of every occupied arc.
  const cross = rx * Math.sin(u.facing) - ry * Math.cos(u.facing);
  const sgn = cross > 1e-6 ? 1 : cross < -1e-6 ? -1 : u.id & 1 ? 1 : -1;
  cands.length = 0;
  cands.push(0);
  for (let i = 0; i < arcs.length; i += 2) cands.push(wrap(arcs[i] - 1e-3), wrap(arcs[i + 1] + 1e-3));
  cands.sort((a, b) => Math.abs(a) - Math.abs(b) || (b - a) * sgn);
  const now = world.tickCount;
  const badW = (spacingOf(u) / R) * 0.5;
  terrainHit = false;
  for (let i = 0; i < cands.length; i++) {
    if (tryUnitSpot(world, u, t, s, dry, base, cands[i], R, dU, badW, now)) return true;
  }
  // Every free arc's edge is on terrain, the map edge or a bad spot: sample
  // the rest of the ring. (When only claims and units rejected the candidates,
  // their arcs cover the whole ring and there is nothing to find.)
  if (!terrainHit) {
    if (!dry) s.has = false;
    return false;
  }
  const step = Math.max(0.12, (spacingOf(u) / R) * 0.5);
  for (let k = 1; k * step < Math.PI + step; k++) {
    const off = Math.min(Math.PI, k * step);
    if (tryUnitSpot(world, u, t, s, dry, base, off * sgn, R, dU, badW, now)) return true;
    if (tryUnitSpot(world, u, t, s, dry, base, -off * sgn, R, dU, badW, now)) return true;
  }
  if (!dry) s.has = false;
  return false;
}

function tryUnitSpot(world, u, t, s, dry, base, off, R, dU, badW, now) {
  if (inArcs(off)) return false;
  const a = base + off;
  if (!dry && now < s.badUntil && Math.abs(wrap(a - s.badA)) < badW) {
    terrainHit = true;
    return false;
  }
  const px = t.x + Math.cos(a) * R;
  const py = t.y + Math.sin(a) * R;
  const map = world.map;
  if (px < 0.3 || py < 0.3 || px > map.width - 0.3 || py > map.height - 0.3 || !map.isPassable(Math.floor(px), Math.floor(py))) {
    terrainHit = true;
    return false;
  }
  if (!dry) {
    s.has = true;
    s.a = wrap(a);
    s.R = R;
  }
  lastCost = dU + R * Math.abs(off);
  return true;
}

/** Point at arc length `d` along a rounded rectangle at distance D around a footprint. */
function perimeterPoint(t, D, d, out) {
  const S = t.size;
  const q = (Math.PI * D) / 2;
  const x0 = t.tx;
  const y0 = t.ty;
  const x1 = t.tx + S;
  const y1 = t.ty + S;
  const seg = [S, q, S, q, S, q, S, q];
  let i = 0;
  while (i < 7 && d > seg[i]) d -= seg[i++];
  switch (i) {
    case 0: out.x = x0 + d; out.y = y0 - D; break;
    case 1: { const a = -Math.PI / 2 + d / D; out.x = x1 + Math.cos(a) * D; out.y = y0 + Math.sin(a) * D; break; }
    case 2: out.x = x1 + D; out.y = y0 + d; break;
    case 3: { const a = d / D; out.x = x1 + Math.cos(a) * D; out.y = y1 + Math.sin(a) * D; break; }
    case 4: out.x = x1 - d; out.y = y1 + D; break;
    case 5: { const a = Math.PI / 2 + d / D; out.x = x0 + Math.cos(a) * D; out.y = y1 + Math.sin(a) * D; break; }
    case 6: out.x = x0 - D; out.y = y1 - d; break;
    default: { const a = Math.PI + d / D; out.x = x0 + Math.cos(a) * D; out.y = y0 + Math.sin(a) * D; break; }
  }
  return out;
}

const rectPool = [];
const rectCand = [];

/** Spot around a building / footprint, nearest to the attacker first. */
function pickRectSpot(world, u, t, s, dry) {
  const D = u.radius + ringGap(u);
  const P = 4 * t.size + TWO_PI * D;
  const n = Math.max(4, Math.min(48, Math.floor(P / spacingOf(u))));
  rectCand.length = 0;
  for (let i = 0; i < n; i++) {
    if (!rectPool[i]) rectPool[i] = { x: 0, y: 0, d: 0 };
    const p = perimeterPoint(t, D, ((i + 0.5) * P) / n, rectPool[i]);
    p.d = hyp(p.x - u.x, p.y - u.y);
    rectCand.push(p);
  }
  rectCand.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const near = world._tmpSurround;
  near.length = 0;
  world.hash.query(t.x, t.y, t.size / 2 + D + u.radius + world.maxRadius, near);
  if (!dry && s.has && spotFree(world, u, t, s.x, s.y, near)) {
    lastCost = hyp(s.x - u.x, s.y - u.y);
    return true;
  }
  const now = world.tickCount;
  for (const p of rectCand) {
    if (!dry && now < s.badUntil && hyp(p.x - s.badX, p.y - s.badY) < 0.3) continue;
    if (!spotFree(world, u, t, p.x, p.y, near)) continue;
    if (!dry) {
      s.has = true;
      s.x = p.x;
      s.y = p.y;
    }
    lastCost = p.d;
    return true;
  }
  if (!dry) s.has = false;
  return false;
}

function pick(world, u, t, s, dry) {
  if (!dry) pruneClaimers(t);
  const ok = t.kind === 'unit' ? pickUnitSpot(world, u, t, s, dry) : pickRectSpot(world, u, t, s, dry);
  if (ok && !dry) addClaimer(t, u);
  return ok;
}

/** Could melee attacker u find a free spot around t right now? (no claim) */
export function hasFreeSpot(world, u, t) {
  return pick(world, u, t, null, true);
}

/** Rough walking distance from u to its best free spot around t (Infinity when t is surrounded). */
export function spotCost(world, u, t) {
  return pick(world, u, t, null, true) ? lastCost : Infinity;
}

/** The attacker is hitting t: keep its claim where it actually stands. */
export function holdSpot(u, t) {
  const s = u.atk;
  if (!s || s.tid !== t.id) return;
  s.has = true;
  if (s.isRect) {
    s.x = u.x;
    s.y = u.y;
  } else {
    s.a = Math.atan2(u.y - t.y, u.x - t.x);
    s.R = hyp(u.x - t.x, u.y - t.y);
  }
  s.lastD = Infinity;
  s.cut = 0; // a way to the target exists, whatever failed before
}

function markBad(s, p, now) {
  s.badA = s.a;
  s.badX = p.x;
  s.badY = p.y;
  s.badUntil = now + BAD_SPOT_TICKS;
  s.has = false;
  s.next = now;
}

/**
 * No free spot: wait outside the crowd (clear of the lane attackers use to
 * walk around it) instead of pushing into it.
 */
function waitOutside(world, u, t) {
  const d = t.kind === 'unit'
    ? hyp(u.x - t.x, u.y - t.y) - t.radius - u.radius
    : distPointRect(u.x, u.y, t.tx, t.ty, t.tx + t.size, t.ty + t.size) - u.radius;
  const wait = ringGap(u) + 4 * u.radius + 0.4;
  if (d < wait - 0.4 && t.kind === 'unit') {
    // Too close: step back out of the lane.
    const dx = u.x - t.x;
    const dy = u.y - t.y;
    const l = hyp(dx, dy) || 1;
    const r = t.radius + u.radius + wait;
    const map = world.map;
    const wx = t.x + (dx / l) * r;
    const wy = t.y + (dy / l) * r;
    if (map.isPassable(Math.floor(wx), Math.floor(wy))) steerToPoint(world, u, wx, wy);
    else if (u.mv) stopMove(u);
  } else if (d <= wait) {
    if (u.mv) stopMove(u);
  } else if (t.kind === 'unit') {
    moveToUnit(world, u, t);
  } else {
    moveToRect(world, u, t.tx, t.ty, t.size, `e${t.id}`);
  }
}

/**
 * Walk a melee attacker to a free attack spot around t (u is not in range yet).
 * Updates u.blockedT (ticks without a spot or without progress).
 * @returns {'approach'|'blocked'|'unreachable'|null} null: no spot logic now, chase normally
 */
export function approachSpot(world, u, t) {
  const now = world.tickCount;
  let s = u.atk;
  if (!s || s.tid !== t.id) {
    s = u.atk = newState(t, now);
    addClaimer(t, u);
  }
  if (now < s.chaseUntil) return null;
  if (now >= s.next) {
    const had = s.has;
    const pa = s.a;
    const px = s.x;
    const py = s.y;
    pick(world, u, t, s, false);
    s.next = now + REPICK_TICKS;
    if (!had || !s.has || (s.isRect ? hyp(px - s.x, py - s.y) > 0.2 : Math.abs(wrap(pa - s.a)) > 0.05)) {
      s.lastD = Infinity;
      s.checkT = now;
    }
  }
  if (!s.has) {
    u.blockedT++;
    waitOutside(world, u, t);
    return 'blocked';
  }
  const p = spotPos(t, s, tmpPos);
  const map = world.map;
  if (s.isRect) {
    const mv = moveToPoint(world, u, p.x, p.y);
    if (mv.failed || mv.arrived) {
      // Reached it without getting in range, or cannot get there: try another spot.
      markBad(s, p, now);
      u.blockedT += 2;
      // Two spots in a row that no path reaches: the building is shut in (behind a wall, say).
      if (!mv.complete) {
        if (++s.cut >= CUT_SPOTS) {
          stopMove(u);
          return 'unreachable';
        }
      } else if (!mv.failed) s.cut = 0; // a spot it walked all the way to: the building can be reached
      return 'blocked';
    }
  } else {
    const aU = Math.atan2(u.y - t.y, u.x - t.x);
    const delta = wrap(s.a - aU);
    let wx = p.x;
    let wy = p.y;
    if (Math.abs(delta) > AROUND) {
      // Walk around the ring of attackers toward the spot.
      const dU = hyp(u.x - t.x, u.y - t.y);
      const rOut = s.R + 2 * u.radius + 0.1;
      const rw = Math.max(rOut, Math.min(dU, rOut + 1));
      const a2 = aU + (delta > 0 ? AROUND : -AROUND);
      wx = t.x + Math.cos(a2) * rw;
      wy = t.y + Math.sin(a2) * rw;
    }
    if (!segmentClear(map.pass, map.width, map.height, u.x, u.y, wx, wy, u.terrainR)) {
      s.chaseUntil = now + 20; // terrain in the way: path-follow for a while
      return null;
    }
    steerToPoint(world, u, wx, wy);
  }
  if (now - s.checkT >= PROGRESS_TICKS) {
    const d = hyp(p.x - u.x, p.y - u.y);
    if (s.lastD - d < 0.15 && d > 0.25) {
      markBad(s, p, now);
      u.blockedT += PROGRESS_TICKS;
    } else {
      u.blockedT = 0;
    }
    s.lastD = d;
    s.checkT = now;
  }
  return 'approach';
}
