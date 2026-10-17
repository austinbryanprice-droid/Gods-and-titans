// AI army control (DESIGN 10): threat detection and base defense (with worker
// militia in emergencies), creeping neutral camps for god xp, gathering and
// marching attack waves along a computed route, sieging the target base,
// and retreating when a fight is lost.
import { newForce, addToForce, addBuildingToForce, addTypeToForce, fightRatio, forcePower } from './unit-info.js';
import { teamTarget, clearTeamTarget } from './team.js';
import { doneOf } from './scan.js';
import { POP_MAX } from '../config.js';
import { getUnitType } from '../data/index.js';

function titanPop(ai) {
  const d = ai.roster.titan ? getUnitType(ai.roster.titan) : null;
  return d ? d.pop : 0;
}

const THREAT_RANGE = 12; // enemy units this close to a building threaten the base
const ROUTE_STEP = 10; // tiles between march waypoints
const RAM_BLOCKED_TICKS = 60; // a ram blocked this long at its building (u.blockedT) picks another
const routeBuffers = new WeakMap(); // world -> BFS scratch arrays

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from a point to a building footprint. */
function distToBuilding(x, y, b) {
  const dx = x < b.tx ? b.tx - x : x > b.tx + b.size ? x - (b.tx + b.size) : 0;
  const dy = y < b.ty ? b.ty - y : y > b.ty + b.size ? y - (b.ty + b.size) : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Group threats near a set of buildings. */
function threatsNear(s, buildings, range) {
  if (!buildings.length) return null;
  const force = newForce();
  const units = [];
  let x = 0;
  let y = 0;
  let w = 0;
  let urgent = false;
  let nearB = null;
  let nearD = Infinity;
  // Bounding box of the buildings grown by the range: most units are far away.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of buildings) {
    if (b.tx < x0) x0 = b.tx;
    if (b.ty < y0) y0 = b.ty;
    if (b.tx + b.size > x1) x1 = b.tx + b.size;
    if (b.ty + b.size > y1) y1 = b.ty + b.size;
  }
  x0 -= range;
  y0 -= range;
  x1 += range;
  y1 += range;
  for (const e of s.enemyUnits) {
    if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1 || e.dead) continue;
    const worker = e.def.class === 'worker';
    if (worker && !(e.state === 'attack' || (e.order && e.order.type === 'build'))) continue;
    let dmin = Infinity;
    let bn = null;
    for (const b of buildings) {
      const d = distToBuilding(e.x, e.y, b);
      if (d < dmin) {
        dmin = d;
        bn = b;
      }
    }
    if (dmin > range) continue;
    units.push(e);
    if (!worker) addToForce(force, e);
    const wt = (e.def.pop || 1) * (worker ? 0.3 : 1);
    x += e.x * wt;
    y += e.y * wt;
    w += wt;
    if (dmin < 6 || e.state === 'attack') urgent = true;
    if (dmin < nearD) {
      nearD = dmin;
      nearB = bn;
    }
  }
  if (!units.length) return null;
  return { x: x / w, y: y / w, force, units, urgent, building: nearB, power: forcePower(force) + units.length * 0.05 };
}

/** Own and enemy forces around a point (units by hash, plus enemy towers). */
export function localForces(ai, x, y, r, opts = {}) {
  const world = ai.world;
  const mine = newForce();
  const theirs = newForce();
  const tmp = ai._tmp;
  tmp.length = 0;
  world.hash.query(x, y, r, tmp);
  const me = ai.me;
  for (const u of tmp) {
    if (u.dead || u.kind !== 'unit') continue;
    if (Math.hypot(u.x - x, u.y - y) > r) continue;
    if (u.def.class === 'worker' && !opts.workers) continue;
    if (u.owner === me || (u.owner >= 0 && !world.areEnemies(me, u.owner))) {
      if (u.owner === me || opts.allies !== false) addToForce(mine, u);
    } else if (u.owner >= 0 || opts.neutral) {
      addToForce(theirs, u);
    }
  }
  for (const e of ai.s.enemies) {
    if (e.defeated || !e.towers) continue;
    for (const b of e.buildings) {
      if (b.def.attack && b.constructed && !b.dead && Math.hypot(b.x - x, b.y - y) < r) addBuildingToForce(theirs, b, 0);
    }
  }
  return { mine, theirs };
}

/** Centroid of a unit list (ground units weigh more so flyers don't pull it over water). */
function centroid(units) {
  let x = 0;
  let y = 0;
  let w = 0;
  for (const u of units) {
    const k = u.air ? 0.3 : 1;
    x += u.x * k;
    y += u.y * k;
    w += k;
  }
  return w > 0 ? { x: x / w, y: y / w } : null;
}

/**
 * Issue a move-like order to the units that don't already have it (re-issuing
 * an identical order would restart pathfinding every think).
 */
export function command(ai, units, type, x, y, force = false) {
  const tick = ai.world.tickCount;
  const ids = [];
  const memo = ai.cmdMemo;
  for (const u of units) {
    const m = memo.get(u.id);
    if (!force && m && m.type === type && Math.abs(m.x - x) < 2.5 && Math.abs(m.y - y) < 2.5 && tick - m.tick < 1200) {
      const o = u.order;
      if (o && (o.type === type || o.type === 'cast' || (type === 'attackMove' && o.type === 'attack'))) continue;
      if (!o && Math.hypot(u.x - x, u.y - y) < 5) continue;
    }
    ids.push(u.id);
    if (m) {
      m.type = type;
      m.x = x;
      m.y = y;
      m.tick = tick;
    } else memo.set(u.id, { type, x, y, tick });
  }
  if (ids.length) ai.issue({ type, units: ids, x, y });
  return ids.length;
}

/** Breadth-first route on the ground grid from a point to near a target (tile centers). */
export function computeRoute(world, from, to, near = 3) {
  const map = world.map;
  const w = map.width;
  const h = map.height;
  const n = w * h;
  let sx = Math.floor(from.x);
  let sy = Math.floor(from.y);
  if (!map.isPassable(sx, sy)) {
    const p = map.nearestPassable(from.x, from.y, 8, false);
    if (!p) return null;
    sx = p.tx;
    sy = p.ty;
  }
  let buf = routeBuffers.get(world);
  if (!buf || buf.prev.length !== n) routeBuffers.set(world, (buf = { prev: new Int32Array(n), queue: new Int32Array(n) }));
  const prev = buf.prev;
  prev.fill(-1);
  const queue = buf.queue;
  let head = 0;
  let tail = 0;
  const start = sy * w + sx;
  prev[start] = start;
  queue[tail++] = start;
  let goal = -1;
  const near2 = near * near;
  let bestI = start;
  let bestD = Infinity;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    const dx = x + 0.5 - to.x;
    const dy = y + 0.5 - to.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      bestI = i;
    }
    if (d2 <= near2) {
      goal = i;
      break;
    }
    for (let k = 0; k < 8; k++) {
      const nx = x + (k === 0 || k === 4 || k === 5 ? 1 : k === 1 || k === 6 || k === 7 ? -1 : 0);
      const ny = y + (k === 2 || k === 4 || k === 6 ? 1 : k === 3 || k === 5 || k === 7 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (prev[j] !== -1 || map.pass[j] !== 1) continue;
      if (nx !== x && ny !== y && (map.pass[y * w + nx] !== 1 || map.pass[ny * w + x] !== 1)) continue;
      prev[j] = i;
      queue[tail++] = j;
    }
  }
  if (goal < 0) goal = bestI;
  const tiles = [];
  for (let i = goal; ; i = prev[i]) {
    tiles.push(i);
    if (i === start || tiles.length > n) break;
  }
  tiles.reverse();
  const pts = [];
  for (let k = ROUTE_STEP; k < tiles.length; k += ROUTE_STEP) {
    const i = tiles[k];
    pts.push({ x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5 });
  }
  const last = tiles[tiles.length - 1];
  pts.push({ x: (last % w) + 0.5, y: Math.floor(last / w) + 0.5 });
  return pts;
}

/** Force of the living members of a creep camp. */
function campForce(camp) {
  const f = newForce();
  for (const m of camp.members) if (!m.dead) addToForce(f, m);
  return f;
}

function campEngaged(camp) {
  return camp.members.some((m) => !m.dead && m.creepState === 'fight');
}

function campAlive(camp) {
  return camp.members.some((m) => !m.dead);
}

function avgHpFrac(units) {
  let a = 0;
  let n = 0;
  for (const u of units) {
    a += u.hp / u.maxHp;
    n++;
  }
  return n ? a / n : 1;
}

/** Pick a camp the army can beat: close to home, away from enemies, priority to the expansion's guards. */
function pickCamp(ai, s, armyForce) {
  const home = ai.home();
  if (!home) return null;
  let best = null;
  let bestScore = -Infinity;
  const enemyTcs = [];
  for (const e of s.enemies) for (const b of e.tcs) if (!b.dead) enemyTcs.push(b);
  for (const camp of s.camps) {
    const f = campForce(camp);
    if (f.n === 0) continue;
    const ratio = fightRatio(armyForce, f);
    const isExp = ai.expansion && ai.expansion.camp === camp;
    if (ratio < ai.prof.creepRatio * (isExp ? 0.9 : 1) * (camp.level >= 3 ? 1.15 : 1)) continue;
    const dHome = dist(camp, home);
    let dEnemy = Infinity;
    for (const b of enemyTcs) dEnemy = Math.min(dEnemy, dist(camp, b));
    if (dEnemy < dHome * 0.85 && !isExp) continue;
    if (dHome > 70) continue;
    const score = (camp.level * 1.5 + 1) / (dHome + 12) * (isExp ? 3 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = camp;
    }
  }
  return best;
}

/** Target building of an enemy player nearest a point (towers count a bit closer). */
function nearestEnemyBuilding(s, player, from, exclude = null) {
  const rec = s.enemies.find((e) => e.index === player);
  if (!rec) return null;
  let best = null;
  let bestD = Infinity;
  for (const b of rec.buildings) {
    if (b.dead || b === exclude) continue;
    let d = dist(b, from);
    if (b.def.attack) d -= 4;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** Strength of what the target enemy can field (army + towers + a Titan about to arrive). */
function enemyStrength(s, player) {
  const rec = s.enemies.find((e) => e.index === player);
  if (!rec) return newForce();
  if (!rec.titanSoon || rec.titanSoon.left > 60) return rec.force;
  return addTypeToForce(Object.assign(newForce(), rec.force), rec.titanSoon.type);
}

function setMode(ai, mode, extra = {}) {
  const mil = ai.mil;
  if (ai.log) {
    const th = ai.threat;
    ai.log.push(`${(ai.s.t / 60).toFixed(2)}m ${mil.mode}->${mode}${th ? ` threat p${th.power.toFixed(1)} n${th.units.length} ${th.units.slice(0, 4).map((u) => u.type).join(',')}` : ''}${extra.camp ? ` camp L${extra.camp.level}` : ''}${extra.ratio ? ` ratio ${extra.ratio.toFixed(2)} pop ${ai.s.armyPop}` : ''}`);
  }
  if (mil.mode === 'attack' && mode !== 'attack') {
    mil.lastAttackEnd = ai.s.t;
  }
  mil.mode = mode;
  mil.since = ai.s.t;
  mil.route = null;
  mil.wp = 0;
  mil.phase = null;
  mil.camp = null;
  mil.targetB = null;
  Object.assign(mil, extra);
}

/** Main military step for one think. */
export function runMilitary(ai, s) {
  const mil = ai.mil;
  const prof = ai.prof;
  const t = s.t;
  const fighters = [];
  const rams = [];
  for (const u of s.army) {
    if (ai.godRetreat.has(u.id)) continue;
    if (u.def.class === 'siege') rams.push(u);
    else fighters.push(u);
  }
  const all = fighters.concat(rams, s.minions);
  const rally = ai.rallyPoint();

  // ---- Threats to the base (and to allies)
  const threat = threatsNear(s, s.buildings, THREAT_RANGE);
  ai.threat = threat && (threat.power >= 0.4 || threat.urgent) ? threat : null;
  if (ai.threat) {
    mil.lastThreat = t;
    const b = ai.threat.building;
    if (b && ai.threat.power >= 1.2) {
      const dx = ai.threat.x - b.x;
      const dy = ai.threat.y - b.y;
      const l = Math.hypot(dx, dy) || 1;
      ai.towerTarget = { x: b.x + (dx / l) * 3, y: b.y + (dy / l) * 3, urgent: true, t };
    }
  } else if (ai.towerTarget && ai.towerTarget.urgent && t - ai.towerTarget.t > 90) {
    ai.towerTarget = null;
  }
  let allyThreat = null;
  if (!ai.threat && prof.helpAllies && s.allyBuildings.length) {
    const at = threatsNear(s, s.allyBuildings, THREAT_RANGE - 2);
    if (at && at.power >= 1.5) allyThreat = at;
  }

  const armyForce = newForce();
  for (const u of fighters) addToForce(armyForce, u);
  const armyPower = forcePower(armyForce);
  const c = centroid(fighters.length ? fighters : all);

  // ---- Militia: workers join only when the base would fall otherwise.
  manageMilitia(ai, s, armyForce, c);

  // ---- Mode transitions caused by threats
  if (ai.threat) {
    const farAway = c && dist(c, ai.threat) > 25;
    const big = ai.threat.power >= Math.max(1.5, armyPower * 0.3) || ai.threat.urgent;
    if (mil.mode !== 'defend' && (mil.mode !== 'attack' || (big && (farAway || ai.threat.power >= armyPower * 0.5)))) {
      if (mil.mode !== 'attack' || big) setMode(ai, 'defend', { ally: false });
    }
  } else if (allyThreat && (mil.mode === 'home' || mil.mode === 'creep')) {
    setMode(ai, 'defend', { ally: true });
  }

  switch (mil.mode) {
    case 'defend': {
      const th = mil.ally ? allyThreat : ai.threat;
      if (!th) {
        if (t - (mil.lastThreat || 0) > 4 || mil.ally) setMode(ai, 'home');
        break;
      }
      command(ai, all, 'attackMove', th.x, th.y);
      break;
    }
    case 'retreat': {
      command(ai, all, 'move', rally.x, rally.y);
      if (!c || dist(c, rally) < 9 || t - mil.since > 25) setMode(ai, 'home');
      break;
    }
    case 'creep': {
      const camp = mil.camp;
      if (!camp || !campAlive(camp)) {
        setMode(ai, 'home');
        break;
      }
      if (t - mil.since > 100) {
        setMode(ai, 'home');
        break;
      }
      // Stage outside aggro range so the army arrives together, then attack.
      if (mil.phase !== 'fight') {
        const home = ai.home();
        const dx = home.x - camp.x;
        const dy = home.y - camp.y;
        const l = Math.hypot(dx, dy) || 1;
        const st = ai.world.map.nearestPassable(camp.x + (dx / l) * 8.5, camp.y + (dy / l) * 8.5, 6, false);
        const sx = st ? st.tx + 0.5 : camp.x;
        const sy = st ? st.ty + 0.5 : camp.y;
        command(ai, all, 'attackMove', sx, sy);
        let near = 0;
        for (const u of fighters) if (Math.hypot(u.x - sx, u.y - sy) < 6) near++;
        if (near >= fighters.length * 0.75 || t - mil.since > 25 || campEngaged(camp)) mil.phase = 'fight';
        break;
      }
      command(ai, all, 'attackMove', camp.x, camp.y);
      if (c && dist(c, camp) < 12) {
        const lf = localForces(ai, camp.x, camp.y, 13, { neutral: true });
        if (lf.theirs.n > 0 && fightRatio(lf.mine, lf.theirs) < 0.75) {
          setMode(ai, 'retreat');
          mil.creepFail = t;
        }
      }
      break;
    }
    case 'attack': {
      runAttack(ai, s, fighters, rams, all, c, armyForce);
      break;
    }
    default: {
      // home: gather at the rally point, then creep or attack.
      if (fighters.length === 0) {
        command(ai, all, 'attackMove', rally.x, rally.y);
        break;
      }
      const target = teamTarget(ai.world, s.team);
      const wave = prof.attackPop + mil.waves * prof.attackGrowth;
      const sinceLast = t - (mil.lastAttackEnd ?? 0);
      let ready = false;
      let ratio = 0;
      if (target >= 0 && t >= prof.firstAttack) {
        ratio = fightRatio(armyForce, enemyStrength(s, target));
        const popReady = s.armyPop >= Math.min(wave, prof.armyCap * 0.85);
        const timerReady = sinceLast >= prof.waveInterval && s.armyPop >= wave * 0.6;
        const titanReady = s.titan && s.titan.hp > s.titan.maxHp * 0.6 && s.armyPop >= wave * 0.5;
        // Close to a Titan: wait for it unless far ahead (the big fight is better with it).
        // (Only while the Titan can still come: population room for it, or already summoning.)
        const titanQueued = (s.queued.get(ai.roster.titan) || 0) > 0;
        const titanRoom = titanQueued || s.p.popUsed + titanPop(ai) <= POP_MAX;
        const titanSoon = !s.titan && ai.roster.titan && titanRoom && (s.p.tier >= 3 || (s.p.tier === 2 && doneOf(s, 'temple') > 0 && t >= prof.tier3At - 60)) && t < 1260 && ratio < 1.6;
        // At the army cap waiting gains nothing, unless far behind or the enemy Titan is
        // about to join (then the big clash comes with it, a minute later at most).
        const rec = s.enemies.find((e) => e.index === target);
        const enemyTitanSoon = !!(rec && rec.titanSoon && rec.titanSoon.left <= 60);
        const maxed = s.armyPop >= prof.armyCap * 0.9 && ratio >= 0.7 && !enemyTitanSoon;
        if ((popReady || timerReady || titanReady) && (ratio >= prof.attackRatio || maxed) && !titanSoon) ready = true;
        // Easy only sends small waves late; others commit when clearly ahead.
        if (!ready && ratio >= prof.attackRatio * 1.8 && s.armyPop >= wave * 0.5) ready = true;
      }
      if (ready && sinceLast > 20) {
        setMode(ai, 'attack', { target, phase: 'assemble', ratio });
        mil.waves++;
        command(ai, all, 'attackMove', rally.x, rally.y, true);
        break;
      }
      const healthy = avgHpFrac(fighters) > 0.55 && s.gods.every((g) => g.hp > g.maxHp * 0.5);
      if (t >= prof.creepFrom && healthy && (s.gods.length > 0 || s.armyPop >= 12) && t - (mil.creepFail ?? -999) > 40) {
        const camp = pickCamp(ai, s, armyForce);
        if (camp) {
          setMode(ai, 'creep', { camp });
          command(ai, all, 'attackMove', camp.x, camp.y);
          break;
        }
      }
      command(ai, all, 'attackMove', rally.x, rally.y);
      break;
    }
  }
}

function runAttack(ai, s, fighters, rams, all, c, armyForce) {
  const mil = ai.mil;
  const t = s.t;
  const world = ai.world;
  const rally = ai.rallyPoint();
  const tp = world.players[mil.target];
  if (!tp || tp.defeated || !fighters.length) {
    clearTeamTarget(world, s.team);
    setMode(ai, fighters.length ? 'home' : 'retreat');
    return;
  }
  if (mil.phase === 'assemble') {
    command(ai, all, 'attackMove', rally.x, rally.y);
    let near = 0;
    let total = 0;
    for (const u of fighters) {
      total += u.def.pop;
      if (dist(u, rally) < 10) near += u.def.pop;
    }
    if (near >= total * 0.75 || t - mil.since > 22) {
      const tb = nearestEnemyBuilding(s, mil.target, rally);
      if (!tb) {
        setMode(ai, 'home');
        return;
      }
      mil.route = computeRoute(world, c || rally, tb, 4) || [{ x: tb.x, y: tb.y }];
      mil.wp = 0;
      mil.phase = 'march';
      mil.marchStart = t;
    } else return;
  }

  // Retreat when the local fight is lost.
  if (c) {
    const lf = localForces(ai, c.x, c.y, 14);
    if (lf.theirs.n >= 2 || lf.theirs.dpsG > 30) {
      const ratio = fightRatio(lf.mine, lf.theirs);
      if (ratio < ai.prof.retreatRatio) {
        setMode(ai, 'retreat');
        command(ai, all, 'move', rally.x, rally.y, true);
        return;
      }
    }
  }

  if (mil.phase === 'march') {
    const route = mil.route;
    while (mil.wp < route.length - 1 && c && dist(c, route[mil.wp]) < 6) mil.wp++;
    const wp = route[mil.wp];
    command(ai, all, 'attackMove', wp.x, wp.y);
    const tb = nearestEnemyBuilding(s, mil.target, c || wp);
    if ((tb && c && dist(c, tb) < 16) || (mil.wp >= route.length - 1 && c && dist(c, wp) < 7) || t - mil.marchStart > 150) {
      mil.phase = 'siege';
    }
    return;
  }

  // Siege: kill the target player's buildings one after another; units fight what they meet.
  const from = c || rally;
  let tb = mil.targetB && !mil.targetB.dead ? mil.targetB : null;
  if (!tb || (dist(tb, from) > 22)) {
    tb = nearestEnemyBuilding(s, mil.target, from);
    mil.targetB = tb;
  }
  if (!tb) {
    clearTeamTarget(world, s.team);
    setMode(ai, 'home');
    return;
  }
  if (c && dist(c, tb) > 30) {
    // The base is far (we were pushed back or the target moved): march again.
    mil.route = computeRoute(world, c, tb, 4) || [{ x: tb.x, y: tb.y }];
    mil.wp = 0;
    mil.phase = 'march';
    mil.marchStart = t;
    return;
  }
  const tx = tb.x;
  const ty = tb.y + tb.size / 2 + 0.8;
  command(ai, fighters.concat(s.minions), 'attackMove', tx, ty);
  for (const r of rams) {
    let skip = null;
    if (r.order && r.order.type === 'attack' && r.order.target) {
      const cur = world.entities.get(r.order.target);
      // An explicit attack keeps its target; a ram with no free spot there
      // (the sim reports it blocked) is sent to another building.
      if (cur && !cur.dead && (r.blockedT || 0) < RAM_BLOCKED_TICKS) continue;
      if (cur && !cur.dead) skip = cur;
    }
    const b = nearestEnemyBuilding(s, mil.target, r, skip);
    if (b) {
      ai.issue({ type: 'attack', units: [r.id], target: b.id });
      ai.cmdMemo.delete(r.id);
    }
  }
}

/** Workers fight raiders near the Town Center when the army can't save it; they go back to work after. */
function manageMilitia(ai, s, armyForce, c) {
  const prof = ai.prof;
  const th = ai.threat;
  const world = ai.world;
  if (!ai.militia) ai.militia = new Set();
  const mil = ai.militia;
  // Release when the danger is gone.
  if (!th || !th.urgent) {
    if (mil.size) {
      const ids = [...mil].filter((id) => {
        const u = world.entities.get(id);
        return u && !u.dead;
      });
      if (ids.length) ai.issue({ type: 'stop', units: ids });
      for (const id of ids) {
        const u = world.entities.get(id);
        if (u) s.job.set(u.id, 'idle');
      }
      mil.clear();
    }
    return;
  }
  if (!prof.militia) return;
  const near = localForces(ai, th.x, th.y, 14);
  const ratio = fightRatio(near.mine, th.force);
  if (ratio >= 1.1 || th.force.n === 0) return;
  // The army is about to arrive and strong enough: workers keep working.
  if (c && dist(c, th) < 14 && fightRatio(armyForce, th.force) >= 1.3) return;
  // Would workers turn the fight? Only then call them, nearest first and no
  // more than needed.
  const withWorkers = newForce();
  Object.assign(withWorkers, near.mine);
  for (const id of mil) {
    const u = world.entities.get(id);
    if (u && !u.dead) addToForce(withWorkers, u);
  }
  const pool = [];
  for (const u of s.workers) {
    if (mil.has(u.id)) continue;
    const d = Math.hypot(u.x - th.x, u.y - th.y);
    if (d <= 14) pool.push({ u, d });
  }
  pool.sort((a, b) => a.d - b.d || a.u.id - b.u.id);
  const cand = [];
  for (const { u } of pool) {
    if (fightRatio(withWorkers, th.force) >= 1.25) break;
    cand.push(u);
    addToForce(withWorkers, u);
  }
  if (!cand.length || fightRatio(withWorkers, th.force) < 0.85) return;
  const ids = cand.map((u) => u.id);
  for (const u of cand) {
    mil.add(u.id);
    s.job.set(u.id, 'fight');
  }
  ai.issue({ type: 'attackMove', units: ids, x: th.x, y: th.y });
}

export function newMilitary() {
  return { mode: 'home', since: 0, waves: 0, lastAttackEnd: 0, lastThreat: -999, route: null, wp: 0, phase: null, camp: null, target: -1, targetB: null, ratio: 0 };
}

