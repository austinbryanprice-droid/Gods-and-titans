// Unit locomotion: path following, local separation steering, collision
// resolution through a spatial hash, terrain push-out, stuck detection and
// group formations. Air units fly straight and only collide with air units.
import { DT } from '../config.js';
import { segmentClear } from './pathfinding.js';
import { hyp, distPointRect, closestOnRect, turnToward } from './common.js';

const TURN_RATE = 14; // radians per second
const STUCK_INTERVAL = 16; // ticks between progress checks
const LOS_RECHECK = 10; // ticks between line-of-sight checks while chasing directly
const MAX_PUSH = 0.2; // max collision correction per pair per tick

/**
 * Which side (+1 / -1 along the mover's left normal) an obstacle is on.
 * Nearly collinear cases pick a stable side from the obstacle's id so
 * mover and obstacle don't flip sides every tick.
 */
function sideOf(s, obstacleId) {
  if (s > 0.05) return 1;
  if (s < -0.05) return -1;
  return obstacleId % 2 ? 1 : -1;
}

function newMv(world, u, kind) {
  return {
    kind,
    gx: u.x,
    gy: u.y,
    ox: NaN,
    oy: NaN,
    rect: null,
    key: null,
    targetId: 0,
    path: null,
    pi: 0,
    pending: false,
    token: 0,
    goal: null,
    arrived: false,
    failed: false,
    complete: true,
    direct: false,
    group: null,
    checkT: world.tickCount,
    checkX: u.x,
    checkY: u.y,
    stuck: 0,
    ver: world.map.version,
    reqT: world.tickCount,
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function requestPath(world, u) {
  const mv = u.mv;
  mv.direct = false;
  mv.reqT = world.tickCount;
  world.paths.request(u);
}

/** Walk (or fly) to a point. Idempotent while the destination is unchanged. */
export function moveToPoint(world, u, x, y, group = null) {
  const map = world.map;
  x = clamp(x, 0.3, map.width - 0.3);
  y = clamp(y, 0.3, map.height - 0.3);
  const cur = u.mv;
  if (cur && cur.kind === 'point' && cur.ox === x && cur.oy === y) return cur;
  const m = newMv(world, u, 'point');
  m.ox = x;
  m.oy = y;
  m.group = group;
  u.mv = m;
  if (u.air) {
    m.gx = x;
    m.gy = y;
    m.direct = true;
    return m;
  }
  let gx = x;
  let gy = y;
  if (!map.isPassable(Math.floor(x), Math.floor(y))) {
    const p = map.nearestPassable(x, y, 16, false);
    if (!p) {
      m.arrived = true;
      m.failed = true;
      return m;
    }
    gx = clamp(x, p.tx + 0.35, p.tx + 0.65);
    gy = clamp(y, p.ty + 0.35, p.ty + 0.65);
  }
  m.gx = gx;
  m.gy = gy;
  const d = hyp(gx - u.x, gy - u.y);
  if (d < 0.05) {
    m.arrived = true;
    return m;
  }
  m.goal = { kind: 'tile', tx: Math.floor(gx), ty: Math.floor(gy), endX: gx, endY: gy };
  if (d < 40 && segmentClear(map.pass, map.width, map.height, u.x, u.y, gx, gy, u.terrainR)) {
    m.direct = true;
    return m;
  }
  requestPath(world, u);
  return m;
}

function approachPoint(u, rect) {
  const c = closestOnRect(u.x, u.y, rect.x0, rect.y0, rect.x1, rect.y1);
  const dx = u.x - c.x;
  const dy = u.y - c.y;
  const d = hyp(dx, dy);
  if (d < 1e-6) return null;
  const off = Math.min(d, u.radius + 0.08);
  return { x: c.x + (dx / d) * off, y: c.y + (dy / d) * off };
}

/**
 * Walk next to a tile footprint (building, mine or tree tile). Paths target
 * the nearest reachable tile adjacent to the footprint.
 */
export function moveToRect(world, u, tx, ty, size, key) {
  const cur = u.mv;
  if (cur && cur.kind === 'rect' && cur.key === key) return cur;
  const m = newMv(world, u, 'rect');
  m.key = key;
  m.rect = { x0: tx, y0: ty, x1: tx + size, y1: ty + size };
  u.mv = m;
  m.goal = { kind: 'rect', x0: tx, y0: ty, x1: tx + size - 1, y1: ty + size - 1 };
  if (distPointRect(u.x, u.y, tx, ty, tx + size, ty + size) <= u.radius + 0.15) {
    m.arrived = true;
    return m;
  }
  if (u.air) {
    m.direct = true;
    return m;
  }
  const map = world.map;
  const ap = approachPoint(u, m.rect);
  if (ap && map.isPassable(Math.floor(ap.x), Math.floor(ap.y)) && hyp(ap.x - u.x, ap.y - u.y) < 30 &&
    segmentClear(map.pass, map.width, map.height, u.x, u.y, ap.x, ap.y, u.terrainR)) {
    m.direct = true;
    return m;
  }
  requestPath(world, u);
  return m;
}

function unitGoal(map, t) {
  let tx = Math.floor(t.x);
  let ty = Math.floor(t.y);
  if (!map.isPassable(tx, ty)) {
    const p = map.nearestPassable(t.x, t.y, 8, false);
    if (p) {
      tx = p.tx;
      ty = p.ty;
    }
  }
  return { kind: 'tile', tx, ty, endX: tx + 0.5, endY: ty + 0.5, cap: 6000 };
}

/** Chase a unit. Steers straight when in line of sight, else follows a path that refreshes as the target moves. */
export function moveToUnit(world, u, t) {
  const map = world.map;
  const cur = u.mv;
  if (cur && cur.kind === 'unit' && cur.targetId === t.id) {
    if (cur.failed) return cur;
    if (!cur.direct && !cur.pending && world.tickCount - cur.reqT >= 10) {
      const drift = hyp(t.x - cur.gx, t.y - cur.gy);
      const exhausted = !cur.path || cur.pi >= cur.path.length;
      if (drift > 1.5 || exhausted) {
        cur.gx = t.x;
        cur.gy = t.y;
        if (hyp(t.x - u.x, t.y - u.y) < 16 && segmentClear(map.pass, map.width, map.height, u.x, u.y, t.x, t.y, u.terrainR)) {
          cur.direct = true;
        } else {
          cur.goal = unitGoal(map, t);
          requestPath(world, u);
        }
      }
    }
    return cur;
  }
  const m = newMv(world, u, 'unit');
  m.targetId = t.id;
  m.gx = t.x;
  m.gy = t.y;
  u.mv = m;
  if (u.air) {
    m.direct = true;
    return m;
  }
  if (hyp(t.x - u.x, t.y - u.y) < 16 && segmentClear(map.pass, map.width, map.height, u.x, u.y, t.x, t.y, u.terrainR)) {
    m.direct = true;
    return m;
  }
  m.goal = unitGoal(map, t);
  requestPath(world, u);
  return m;
}

/** Move next to any entity: units are chased, footprints approached. */
export function moveToEntity(world, u, e) {
  if (e.kind === 'unit') return moveToUnit(world, u, e);
  return moveToRect(world, u, e.tx, e.ty, e.size, `e${e.id}`);
}

export function stopMove(u) {
  u.mv = null;
}

/** Movement goal reached (or abandoned). */
export function moveDone(u) {
  return !u.mv || u.mv.arrived;
}

function repath(world, u) {
  const mv = u.mv;
  if (u.air || mv.pending) return;
  if (mv.kind === 'unit') {
    const t = world.entities.get(mv.targetId);
    if (!t) return;
    mv.goal = unitGoal(world.map, t);
    mv.gx = t.x;
    mv.gy = t.y;
  } else if (!mv.goal) {
    return;
  }
  requestPath(world, u);
}

function arrive(u, mv) {
  mv.arrived = true;
  if (mv.group) u.arrivedGroup = mv.group;
}

function stepForced(world, u) {
  const f = u.forced;
  const map = world.map;
  const nx = clamp(u.x + f.vx * DT, u.radius, map.width - u.radius);
  const ny = clamp(u.y + f.vy * DT, u.radius, map.height - u.radius);
  if (!u.air && !map.isPassable(Math.floor(nx), Math.floor(ny))) {
    u.forced = null;
    return;
  }
  u.x = nx;
  u.y = ny;
  u.moving = true;
  if (f.onStep) f.onStep(world, u);
  f.rem -= DT;
  if (f.rem <= 1e-9) {
    const done = f.onEnd;
    u.forced = null;
    if (done) done(world, u);
  }
}

function stepUnit(world, u) {
  u.moving = false;
  if (u.forced) {
    stepForced(world, u);
    return;
  }
  const mv = u.mv;
  if (!mv || mv.pending || mv.arrived) return;
  const speed = u.speedNow;
  if (speed <= 0) return;
  const map = world.map;
  let wx;
  let wy;
  let last = false;
  let usingPath = false;
  let t = null;
  if (mv.kind === 'unit') {
    t = world.entities.get(mv.targetId);
    if (!t || t.dead) {
      mv.arrived = true;
      return;
    }
    if (mv.direct || !mv.path || mv.pi >= mv.path.length) {
      wx = t.x;
      wy = t.y;
      last = true;
      if (mv.direct && !u.air && (world.tickCount + u.id) % LOS_RECHECK === 0 &&
        !segmentClear(map.pass, map.width, map.height, u.x, u.y, t.x, t.y, u.terrainR)) {
        repath(world, u);
        return;
      }
    } else {
      usingPath = true;
    }
  } else if (mv.kind === 'rect') {
    const r = mv.rect;
    if (distPointRect(u.x, u.y, r.x0, r.y0, r.x1, r.y1) <= u.radius + 0.15) {
      arrive(u, mv);
      return;
    }
    if (mv.direct || !mv.path || mv.pi >= mv.path.length) {
      const ap = approachPoint(u, r);
      if (!ap) {
        arrive(u, mv);
        return;
      }
      wx = ap.x;
      wy = ap.y;
      last = true;
    } else {
      usingPath = true;
    }
  } else if (mv.direct || !mv.path) {
    wx = mv.gx;
    wy = mv.gy;
    last = true;
  } else {
    usingPath = true;
  }
  if (usingPath) {
    const p = mv.path;
    if (mv.pi >= p.length) {
      arrive(u, mv);
      return;
    }
    wx = p[mv.pi];
    wy = p[mv.pi + 1];
    last = mv.pi >= p.length - 2;
    if (!last && hyp(wx - u.x, wy - u.y) <= Math.max(0.3, speed * DT)) {
      mv.pi += 2;
      wx = p[mv.pi];
      wy = p[mv.pi + 1];
      last = mv.pi >= p.length - 2;
    }
    if (last && t && hyp(wx - u.x, wy - u.y) <= Math.max(0.3, speed * DT)) {
      // End of the chase path: steer at the target itself until the path refreshes.
      mv.pi = p.length;
      wx = t.x;
      wy = t.y;
    }
    // The map changed (building placed, tree felled): verify the current leg.
    if (mv.ver !== map.version && !u.air) {
      mv.ver = map.version;
      if (!segmentClear(map.pass, map.width, map.height, u.x, u.y, wx, wy, u.terrainR * 0.8)) {
        if (!mv.goal) mv.goal = { kind: 'tile', tx: Math.floor(mv.gx), ty: Math.floor(mv.gy), endX: mv.gx, endY: mv.gy };
        repath(world, u);
        return;
      }
    }
  }
  const dx = wx - u.x;
  const dy = wy - u.y;
  const d = hyp(dx, dy);
  const step = speed * DT;
  if (last && mv.kind !== 'unit' && d <= Math.max(step, 0.05)) {
    if (mv.kind === 'point' || mv.kind === 'rect') {
      u.x = wx;
      u.y = wy;
      u.moving = d > 0.001;
      if (usingPath && mv.kind === 'rect') {
        mv.pi = mv.path.length; // switch to direct approach next tick
        return;
      }
      if (mv.kind === 'point') arrive(u, mv);
      return;
    }
  }
  if (d < 1e-6) return;
  let dirx = dx / d;
  let diry = dy / d;
  // Local separation steering.
  if (!u.ghost) {
    const tmp = world._tmpSteer;
    tmp.length = 0;
    world.hash.query(u.x, u.y, u.radius + world.maxRadius + 0.3, tmp);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < tmp.length; i++) {
      const o = tmp[i];
      if (o === u || o.dead || o.ghost || o.air !== u.air) continue;
      const ox = u.x - o.x;
      const oy = u.y - o.y;
      const minD = u.radius + o.radius + 0.2;
      const od2 = ox * ox + oy * oy;
      if (od2 >= minD * minD || od2 < 1e-12) continue;
      const od = Math.sqrt(od2);
      const wgt = (minD - od) / minD;
      sx += (ox / od) * wgt;
      sy += (oy / od) * wgt;
      // Something standing still ahead of us: sidestep away from it.
      const oMoving = o.mv && !o.mv.arrived && !o.mv.pending;
      if (!oMoving && -(ox * dirx + oy * diry) > 0) {
        const side = sideOf((ox * diry - oy * dirx) / od, o.id);
        sx -= -diry * side * wgt * 0.8;
        sy -= dirx * side * wgt * 0.8;
      }
    }
    if (sx !== 0 || sy !== 0) {
      let vx = dirx + sx;
      let vy = diry + sy;
      if (vx * dirx + vy * diry < 0.25) {
        // never steer backwards: keep a forward component
        vx += dirx * 0.5;
        vy += diry * 0.5;
      }
      const vl = hyp(vx, vy);
      if (vl > 1e-6) {
        dirx = vx / vl;
        diry = vy / vl;
      }
    }
  }
  const mvStep = last && mv.kind !== 'unit' ? Math.min(step, d) : step;
  u.vx = dirx * speed;
  u.vy = diry * speed;
  u.x += dirx * mvStep;
  u.y += diry * mvStep;
  u.moving = true;
  u.facing = turnToward(u.facing, Math.atan2(diry, dirx), TURN_RATE * DT);
  // Stuck detection.
  if (world.tickCount - mv.checkT >= STUCK_INTERVAL) {
    const moved = hyp(u.x - mv.checkX, u.y - mv.checkY);
    const expect = speed * STUCK_INTERVAL * DT;
    if (moved < expect * 0.25) {
      const gd = hyp(mv.gx - u.x, mv.gy - u.y);
      const crowdR = mv.group ? 0.6 + 0.6 * Math.sqrt(mv.group.n) : u.radius * 2 + 0.4;
      if (mv.kind === 'point' && gd < crowdR) {
        arrive(u, mv);
      } else {
        mv.stuck++;
        if (mv.stuck >= 4) {
          mv.failed = true;
          arrive(u, mv);
        } else {
          repath(world, u);
        }
      }
    } else {
      mv.stuck = 0;
    }
    mv.checkT = world.tickCount;
    mv.checkX = u.x;
    mv.checkY = u.y;
  }
}

function pushWeight(u) {
  const o = u.order;
  if (o && o.type === 'hold') return 0.05;
  const s = u.state;
  if (s === 'attack' || s === 'cast' || s === 'build') return 0.3;
  return 1;
}

function resolveCollisions(world) {
  const units = world.unitList;
  const tmp = world._tmpQuery;
  const maxR = world.maxRadius;
  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    if (a.dead || a.ghost) continue;
    tmp.length = 0;
    world.hash.query(a.x, a.y, a.radius + maxR, tmp);
    for (let j = 0; j < tmp.length; j++) {
      const b = tmp[j];
      if (b.id <= a.id || b.dead || b.ghost || b.air !== a.air) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const minD = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-5) {
        const ang = ((a.id * 7919 + b.id * 104729) % 628) / 100;
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 0;
      } else {
        dx /= d;
        dy /= d;
      }
      const pen = minD - d;
      const aMoving = a.moving;
      const bMoving = b.moving;
      let wa = pushWeight(a);
      let wb = pushWeight(b);
      const allies = !world.areEnemies(a.owner, b.owner);
      if (allies) {
        if (aMoving && !bMoving) wb *= 4;
        else if (bMoving && !aMoving) wa *= 4;
      }
      wa /= a.mass;
      wb /= b.mass;
      let k = 1;
      if (!aMoving && !bMoving) {
        if (pen < 0.03) continue;
        k = 0.35;
      }
      const tot = wa + wb;
      const sa = Math.min(MAX_PUSH, (wa / tot) * pen * k);
      const sb = Math.min(MAX_PUSH, (wb / tot) * pen * k);
      let bx = dx;
      let by = dy;
      let ax = -dx;
      let ay = -dy;
      // Idle allies step aside instead of being bulldozed ahead.
      if (allies && aMoving && !bMoving && (a.vx || a.vy)) {
        const vl = hyp(a.vx, a.vy);
        const side = sideOf((a.vx * dy - a.vy * dx) / vl, b.id);
        bx = dx + (-a.vy / vl) * side * 0.9;
        by = dy + (a.vx / vl) * side * 0.9;
        const l = hyp(bx, by);
        bx /= l;
        by /= l;
      } else if (allies && bMoving && !aMoving && (b.vx || b.vy)) {
        const vl = hyp(b.vx, b.vy);
        const side = sideOf((b.vx * -dy - b.vy * -dx) / vl, a.id);
        ax = -dx + (-b.vy / vl) * side * 0.9;
        ay = -dy + (b.vx / vl) * side * 0.9;
        const l = hyp(ax, ay);
        ax /= l;
        ay /= l;
      }
      a.x += ax * sa;
      a.y += ay * sa;
      b.x += bx * sb;
      b.y += by * sb;
      // Crowd arrival: bumping into a unit of the same group that already arrived.
      if (aMoving && !bMoving && a.mv && a.mv.group && b.arrivedGroup === a.mv.group && !a.mv.arrived) {
        if (hyp(a.mv.gx - a.x, a.mv.gy - a.y) < 0.6 + 0.6 * Math.sqrt(a.mv.group.n)) arrive(a, a.mv);
      } else if (bMoving && !aMoving && b.mv && b.mv.group && a.arrivedGroup === b.mv.group && !b.mv.arrived) {
        if (hyp(b.mv.gx - b.x, b.mv.gy - b.y) < 0.6 + 0.6 * Math.sqrt(b.mv.group.n)) arrive(b, b.mv);
      }
    }
  }
}

/** Keep a ground unit out of blocked tiles and inside the map. */
export function pushOutTerrain(map, u) {
  const r = u.terrainR;
  const w = map.width;
  const h = map.height;
  u.x = clamp(u.x, r, w - r);
  u.y = clamp(u.y, r, h - r);
  if (u.air) return;
  const pass = map.pass;
  const cx = Math.floor(u.x);
  const cy = Math.floor(u.y);
  if (pass[cy * w + cx] === 0) {
    const p = map.nearestPassable(u.x, u.y, 10, false);
    if (p) {
      u.x = clamp(u.x, p.tx + r, p.tx + 1 - r);
      u.y = clamp(u.y, p.ty + r, p.ty + 1 - r);
    }
    return;
  }
  for (let it = 0; it < 2; it++) {
    const x0 = Math.floor(u.x - r);
    const x1 = Math.floor(u.x + r);
    const y0 = Math.floor(u.y - r);
    const y1 = Math.floor(u.y + r);
    const ccx = Math.floor(u.x);
    const ccy = Math.floor(u.y);
    let any = false;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx === ccx && ty === ccy) continue;
        const blocked = tx < 0 || ty < 0 || tx >= w || ty >= h || pass[ty * w + tx] === 0;
        if (!blocked) continue;
        const px = u.x < tx ? tx : u.x > tx + 1 ? tx + 1 : u.x;
        const py = u.y < ty ? ty : u.y > ty + 1 ? ty + 1 : u.y;
        const dx = u.x - px;
        const dy = u.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const push = r - d + 1e-4;
        u.x += (dx / d) * push;
        u.y += (dy / d) * push;
        any = true;
      }
    }
    if (!any) break;
  }
}

/** Advance every unit's movement for one tick, then resolve collisions. */
export function updateMovement(world) {
  const units = world.unitList;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u.dead) stepUnit(world, u);
  }
  world.hash.rebuild(units);
  resolveCollisions(world);
  const map = world.map;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u.dead) pushOutTerrain(map, u);
  }
}

/**
 * Formation slots for a group move: a wide block centred on (x, y), facing the
 * direction of travel, melee in front and ranged/support behind.
 * @returns {{x:number, y:number}[]} one slot per unit, same order as units
 */
export function formationSlots(world, units, x, y) {
  const n = units.length;
  if (n === 1) return [{ x, y }];
  const map = world.map;
  let cx = 0;
  let cy = 0;
  let sumR = 0;
  for (const u of units) {
    cx += u.x;
    cy += u.y;
    sumR += u.radius;
  }
  cx /= n;
  cy /= n;
  let fx = x - cx;
  let fy = y - cy;
  let fl = hyp(fx, fy);
  if (fl < 0.5) {
    fx = 0;
    fy = 1;
    fl = 1;
  }
  fx /= fl;
  fy /= fl;
  const px = -fy;
  const py = fx;
  const spacing = clamp((sumR / n) * 2 + 0.4, 0.9, 3.4);
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
  const rows = Math.ceil(n / cols);
  const back = (u) => (u.def.class === 'ranged' || u.def.class === 'support' || u.def.class === 'siege' || u.def.class === 'worker' ? 1 : 0);
  const order = units.map((u, i) => ({ u, i, role: back(u), f: (u.x - cx) * fx + (u.y - cy) * fy, p: (u.x - cx) * px + (u.y - cy) * py }));
  order.sort((a, b) => a.role - b.role || b.f - a.f || a.i - b.i);
  const slots = new Array(n);
  for (let r = 0; r < rows; r++) {
    const row = order.slice(r * cols, Math.min(n, (r + 1) * cols));
    row.sort((a, b) => a.p - b.p || a.i - b.i);
    const cnt = row.length;
    const off = -(r - (rows - 1) / 2) * spacing;
    for (let c = 0; c < cnt; c++) {
      const lat = (c - (cnt - 1) / 2) * spacing;
      let sx = x + px * lat + fx * off;
      let sy = y + py * lat + fy * off;
      sx = clamp(sx, 0.5, map.width - 0.5);
      sy = clamp(sy, 0.5, map.height - 0.5);
      const unit = row[c].u;
      if (!unit.air && !map.isPassable(Math.floor(sx), Math.floor(sy))) {
        const p = map.nearestPassable(sx, sy, 6, false);
        if (p) {
          sx = p.tx + 0.5;
          sy = p.ty + 0.5;
        }
      }
      slots[row[c].i] = { x: sx, y: sy };
    }
  }
  return slots;
}
