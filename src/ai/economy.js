// AI economy: which mines and trees the AI uses, and how its worshippers are
// split between gold, wood and prayer (DESIGN 10). Only issues gather / pray
// commands; buildings are planned in build.js.
import { doneOf } from './scan.js';
import { mirrorTie } from './placement.js';

const MINE_DROP_RANGE = 7; // a mine counts as "owned" with a drop-off this close (footprint gap)

function rectGap(a, b) {
  const gx = Math.max(0, b.tx - (a.tx + a.size), a.tx - (b.tx + b.size));
  const gy = Math.max(0, b.ty - (a.ty + a.size), a.ty - (b.ty + b.size));
  return Math.max(gx, gy);
}

/** Refresh the AI's owned mines (mine + nearest own drop-off) and its wood spot. */
export function refreshEconomy(ai, s) {
  const world = ai.world;
  const drops = [];
  for (const b of s.buildings) if (b.constructed && b.def.dropOff) drops.push(b);
  ai.drops = drops;
  const pairs = [];
  for (const m of world.mineList) {
    if (m.dead || m.amount <= 0) continue;
    let best = null;
    let bestGap = Infinity;
    for (const d of drops) {
      const g = rectGap(m, d);
      if (g < bestGap) {
        bestGap = g;
        best = d;
      }
    }
    if (best && bestGap <= MINE_DROP_RANGE && !ai.mineThreatened(m, s)) pairs.push({ mine: m, drop: best, gap: bestGap, workers: 0 });
  }
  ai.pairs = pairs;
  // Wood: the drop-off with the closest accessible trees (re-checked when the
  // drop-offs change, the trees are gone, or every 10 s).
  let dropKey = '';
  for (const d of drops) dropKey += `${d.id},`;
  const cur = ai.woodSpot;
  if (!cur || dropKey !== ai.woodDropKey || !world.map.isTreeAccessible(cur.tx, cur.ty) || world.tickCount - (ai.woodCheckTick || 0) > 200) {
    ai.woodCheckTick = world.tickCount;
    ai.woodDropKey = dropKey;
    let best = null;
    let bestD = Infinity;
    for (const d of drops) {
      const t = pickWoodTile(ai, d);
      if (!t) continue;
      if (t.dist < bestD) {
        bestD = t.dist;
        best = { tx: t.tx, ty: t.ty, drop: d, dist: t.dist };
      }
    }
    // Keep the current wood line while it is nearly as good (chopping thins a
    // forest; hopping between lines would strand the planned storehouse).
    if (best && cur && cur.drop === best.drop && !cur.drop.dead && world.map.isTreeAccessible(cur.tx, cur.ty)) {
      const curDist = Math.hypot(cur.tx + 0.5 - cur.drop.x, cur.ty + 0.5 - cur.drop.y) - cur.drop.size / 2;
      if (curDist <= best.dist + 1.5) best = { tx: cur.tx, ty: cur.ty, drop: cur.drop, dist: curDist };
    }
    if (!best && drops.length === 0 && s.workers.length) {
      const w0 = s.workers[0];
      const t = world.map.nearestForest(w0.x, w0.y, 30, true);
      if (t) best = { tx: t.tx, ty: t.ty, drop: null, dist: 99 };
    }
    ai.woodSpot = best;
    ai.treeList = null;
  }
}

/**
 * Tree tile to chop near a drop-off: among accessible trees at most a tile
 * farther than the nearest one, prefer the densest forest (a lone tree runs
 * out at once), breaking ties in the base's frame.
 */
function pickWoodTile(ai, d) {
  const map = ai.world.map;
  const first = map.nearestForest(d.x, d.y, 22, true);
  if (!first) return null;
  const dist = (tx, ty) => Math.hypot(tx + 0.5 - d.x, ty + 0.5 - d.y) - d.size / 2;
  const limit = dist(first.tx, first.ty) + 1;
  const R = Math.ceil(limit + d.size / 2 + 1);
  const cx = Math.floor(d.x);
  const cy = Math.floor(d.y);
  let best = null;
  let bestScore = Infinity;
  for (let ty = cy - R; ty <= cy + R; ty++) {
    for (let tx = cx - R; tx <= cx + R; tx++) {
      const dd = dist(tx, ty);
      if (dd > limit || !map.isTreeAccessible(tx, ty)) continue;
      let dense = 0;
      for (let y = ty - 2; y <= ty + 2; y++) for (let x = tx - 2; x <= tx + 2; x++) if (map.isForest(x, y)) dense++;
      const score = dd - dense * 0.06 + mirrorTie(ai, tx + 0.5 - d.x, ty + 0.5 - d.y);
      if (score < bestScore) {
        bestScore = score;
        best = { tx, ty, dist: dd };
      }
    }
  }
  return best;
}

/** Trees around the wood spot to spread choppers over (cached per map version). */
function treesNear(ai) {
  const world = ai.world;
  const spot = ai.woodSpot;
  if (!spot) return [];
  if (ai.treeList && ai.treeListVer === world.map.version) return ai.treeList;
  const list = [];
  const map = world.map;
  const R = 5;
  for (let y = spot.ty - R; y <= spot.ty + R; y++) {
    for (let x = spot.tx - R; x <= spot.tx + R; x++) {
      if (!map.isTreeAccessible(x, y)) continue;
      const d = spot.drop ? Math.hypot(x + 0.5 - spot.drop.x, y + 0.5 - spot.drop.y) : Math.hypot(x - spot.tx, y - spot.ty);
      list.push({ tx: x, ty: y, d });
    }
  }
  const ox = spot.drop ? spot.drop.x : spot.tx;
  const oy = spot.drop ? spot.drop.y : spot.ty;
  for (const t of list) t.d += mirrorTie(ai, t.tx + 0.5 - ox, t.ty + 0.5 - oy);
  list.sort((a, b) => a.d - b.d);
  if (list.length > 12) list.length = 12;
  ai.treeList = list;
  ai.treeListVer = world.map.version;
  return list;
}

/**
 * Gold workers wanted at an owned mine. Only MINE_SLOTS (2) workers mine at
 * once, so a mine is saturated by about 5–6 workers at the minimum drop-off
 * gap (13.3 gold/s); a drop-off farther away needs one or two more walkers.
 */
export function minersFor(ai, pr) {
  const amount = pr.mine.amount;
  if (amount < 150) return 1;
  let n = ai.prof.minersPerMine + (pr.gap >= 5 ? 1 : 0) + (pr.gap >= 7 ? 1 : 0);
  if (amount < 600) n = Math.min(n, 2);
  else if (amount < 1500) n = Math.min(n, 4);
  return n;
}

/** Gold workers all owned mines can use. */
export function goldCapacity(ai) {
  let n = 0;
  for (const pr of ai.pairs) n += minersFor(ai, pr);
  return n;
}

/** Woodcutters wanted for a number of gold workers, adjusted by the wood bank. */
function woodWant(ai, s, gold) {
  const prof = ai.prof;
  const p = s.p;
  let w = Math.max(prof.woodMin, Math.round(gold * prof.woodPerGold));
  if (p.wood > 1000) w = Math.round(w * 0.35);
  else if (p.wood > 650) w = Math.round(w * 0.6);
  else if (p.wood > 400) w = Math.round(w * 0.8);
  else if (p.wood < 150) w = Math.round(w * 1.35) + 1;
  return Math.max(1, Math.min(prof.woodMax, w));
}

/** Praying worshippers wanted (before the cap by free prayer slots). */
function prayWant(ai, s) {
  const prof = ai.prof;
  const p = s.p;
  const temple = doneOf(s, 'temple') > 0;
  const titan = ai.savingForTitan(s);
  let pray = temple ? prof.prayLate : prof.prayEarly;
  if (titan) pray = prof.prayTitan;
  // Faith piling up with nothing to buy: pray less.
  const faithCap = titan ? 1200 : temple ? 700 : 450;
  // Gold piling up while faith is short: more worshippers pray (faith buys gods and creatures).
  if (p.faith < faithCap * 0.6) {
    if (p.gold > 2500) pray += 4;
    else if (p.gold > 1200) pray += 2;
  }
  if (p.faith > faithCap) pray = Math.max(1, Math.floor(pray / 2));
  if (p.faith > faithCap * 1.8) pray = 0;
  return pray;
}

/**
 * Worshippers this AI wants in total: enough to saturate its mines (plus the
 * expansion being prepared), the wood line it needs and its prayer slots.
 */
export function workerNeed(ai, s) {
  let gold = goldCapacity(ai);
  const ex = ai.expansion;
  if (ex && ex.ready && !ex.built) gold += ai.prof.minersPerMine; // train ahead for the new mine
  if (!ai.pairs.length && !ex) gold = Math.max(gold, ai.prof.minersPerMine);
  let slots = prayerSlots(s);
  if (!slots) slots = 5; // a Shrine is coming
  else if (!doneOf(s, 'temple') && slots < 10) slots += 5; // and a Temple
  const pray = Math.min(slots, Math.max(ai.prof.prayLate, prayWant(ai, s)));
  const wood = woodWant(ai, s, gold);
  return Math.min(ai.prof.workers, gold + wood + pray + 2);
}

/** Desired worker split for this think. */
function targets(ai, s) {
  const prof = ai.prof;
  const p = s.p;
  const slots = prayerSlots(s);
  let pray = 0;
  if (slots > 0) pray = Math.min(prayWant(ai, s), slots, Math.floor(s.workers.length * 0.5));
  const avail = Math.max(0, s.workers.length - s.jobs.build - pray - (ai.militia ? ai.militia.size : 0));
  const goldCap = goldCapacity(ai);
  if (!ai.pairs.length || !goldCap) {
    // No usable mine: everyone on wood (or nothing to do).
    const wood = ai.woodSpot ? avail : 0;
    return { pray, wood, gold: 0, goldCap: 0 };
  }
  if (!ai.woodSpot) return { pray, wood: 0, gold: avail, goldCap };
  // Early on (fewer workers than the mines can use) wood gets its share; once
  // the mines are full the rest go to wood up to what is needed, and only
  // then wait at a saturated mine.
  let share = prof.woodShare;
  if (p.wood > 700) share *= 0.4;
  else if (p.wood > 400) share *= 0.75;
  else if (p.wood < 120) share *= 1.3;
  if (p.gold > 1200 && p.wood < 400) share *= 1.35;
  if (p.gold < 150 && p.wood > 250) share *= 0.7;
  share = Math.min(1, share);
  const wantWood = woodWant(ai, s, goldCap);
  let wood = Math.min(wantWood, Math.round(avail * share));
  let gold = Math.min(goldCap, avail - wood);
  let left = avail - wood - gold;
  if (left > 0) {
    const w = Math.min(left, wantWood - wood);
    wood += w;
    left -= w;
  }
  if (left > 0 && p.wood < 1200) {
    // Spare hands chop (wood never runs short of buyers for long) rather than queue at a full mine.
    wood += left;
    left = 0;
  }
  gold += left;
  return { pray, wood, gold, goldCap };
}

function prayerSlots(s) {
  let n = 0;
  for (const t of ['shrine', 'temple']) {
    const l = s.done.get(t);
    if (l) for (const b of l) n += b.def.prayerSlots || 0;
  }
  return n;
}

/** Prayer building with a free slot, nearest to a worker. */
function prayerBuildingFor(ai, s, u, praying) {
  let best = null;
  let bestD = Infinity;
  for (const t of ['temple', 'shrine']) {
    const l = s.done.get(t);
    if (!l) continue;
    for (const b of l) {
      const used = praying.get(b.id) || 0;
      if (used >= b.def.prayerSlots) continue;
      // Temples pray faster: prefer them a little.
      const d = Math.hypot(b.x - u.x, b.y - u.y) - (t === 'temple' ? 4 : 0);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
  }
  return best;
}

/** Owned mine with the most room for another gold worker (nearest to `u` on ties). */
function bestPair(ai, u) {
  let best = null;
  let bestScore = Infinity;
  for (const pr of ai.pairs) {
    const room = minersFor(ai, pr) - pr.workers;
    const d = u ? Math.hypot(pr.mine.x - u.x, pr.mine.y - u.y) : 0;
    const score = -room * 10 + d * 0.05 + pr.gap * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = pr;
    }
  }
  return best;
}

/**
 * Assign and rebalance workers. Moves at most a few workers per think so the
 * economy shifts smoothly.
 */
export function manageWorkers(ai, s) {
  const world = ai.world;
  const want = targets(ai, s);
  ai.workerTargets = want;
  const pairByMine = new Map();
  for (const pr of ai.pairs) pairByMine.set(pr.mine.id, pr);
  const praying = new Map();
  const gold = [];
  const wood = [];
  const pray = [];
  const free = [];
  const pairOf = new Map(); // gold worker id -> its pair
  for (const u of s.workers) {
    if (ai.militia && ai.militia.has(u.id)) continue;
    const j = s.job.get(u.id);
    if (j === 'gold') {
      const o = u.order.type === 'gather' ? u.order : u.order.resume;
      const pr = o ? pairByMine.get(o.mine) : null;
      if (pr) {
        pr.workers++;
        gold.push(u);
        pairOf.set(u.id, pr);
      } else free.push(u); // mining an unowned / threatened / gone mine
    } else if (j === 'wood') wood.push(u);
    else if (j === 'pray') {
      praying.set(u.order.building, (praying.get(u.order.building) || 0) + 1);
      pray.push(u);
    } else if (j === 'idle' || (j === 'busy' && !(u.order && u.order.type === 'move' && ai.recentlyOrdered(u)))) {
      free.push(u);
    }
  }
  const trees = treesNear(ai);
  let treeIdx = ai.treeRot || 0;
  const sendGold = (list) => {
    if (!list.length) return;
    // Group by mine to keep commands few.
    const groups = new Map();
    for (const u of list) {
      const pr = bestPair(ai, u);
      if (!pr) return;
      pr.workers++;
      let g = groups.get(pr.mine.id);
      if (!g) groups.set(pr.mine.id, (g = []));
      g.push(u.id);
    }
    for (const [mineId, ids] of groups) ai.issue({ type: 'gather', units: ids, target: mineId });
  };
  const sendWood = (list) => {
    if (!list.length || !trees.length) return;
    for (const u of list) {
      const t = trees[treeIdx++ % trees.length];
      ai.issue({ type: 'gather', units: [u.id], tx: t.tx, ty: t.ty });
    }
  };
  const sendPray = (list) => {
    for (const u of list) {
      const b = prayerBuildingFor(ai, s, u, praying);
      if (!b) return;
      praying.set(b.id, (praying.get(b.id) || 0) + 1);
      ai.issue({ type: 'pray', units: [u.id], target: b.id });
    }
  };

  // 1. Free workers fill the biggest deficit.
  const toGold = [];
  const toWood = [];
  const toPray = [];
  let g = gold.length;
  let w = wood.length;
  let pr = pray.length;
  for (const u of free) {
    const dp = want.pray - pr;
    const dg = want.gold - g;
    const dw = want.wood - w;
    if (dp > 0 && dp >= dg && dp >= dw) {
      toPray.push(u);
      pr++;
    } else if ((dw > dg && trees.length) || !ai.pairs.length) {
      if (!trees.length) continue;
      toWood.push(u);
      w++;
    } else if (ai.pairs.length) {
      toGold.push(u);
      g++;
    }
  }
  // Leave a gold job: prefer a worker queued at an over-full mine, without cargo.
  const takeGold = () => {
    const u = pickGoldMover(ai, gold, pairOf);
    if (!u) return null;
    removeFrom(gold, u);
    const p0 = pairOf.get(u.id);
    if (p0) p0.workers--;
    pairOf.delete(u.id);
    g--;
    return u;
  };
  // 2. Rebalance a couple of workers per think.
  const moves = ai.prof.think >= 20 ? 3 : 2;
  for (let k = 0; k < moves; k++) {
    if (pr < want.pray) {
      const fromWood = (w - want.wood > g - want.gold && wood.length > 0) || gold.length === 0;
      let u;
      if (fromWood) {
        u = nearestTo(wood, ai.prayerPoint(s));
        if (u) {
          removeFrom(wood, u);
          w--;
        }
      } else u = takeGold();
      if (!u) break;
      toPray.push(u);
      pr++;
    } else if (pr > want.pray + 1 && pray.length) {
      const u = pray.pop();
      pr--;
      if (want.wood - w > want.gold - g && trees.length) {
        toWood.push(u);
        w++;
      } else {
        toGold.push(u);
        g++;
      }
    } else if ((want.wood - w >= 2 || (want.wood > w && g > want.gold)) && gold.length && trees.length) {
      const u = takeGold();
      if (!u) break;
      toWood.push(u);
      w++;
    } else if ((want.gold - g >= 2 || (want.gold > g && w > want.wood)) && wood.length && ai.pairs.length) {
      const u = pickMovable(wood, 'w');
      if (!u) break;
      removeFrom(wood, u);
      w--;
      toGold.push(u);
      g++;
    } else if (!moveBetweenMines(ai, gold, pairOf)) break;
  }
  ai.treeRot = treeIdx % 997;
  sendPray(toPray);
  sendGold(toGold);
  sendWood(toWood);
}

/** A gold worker to reassign: queued at an over-full mine first, never one carrying gold if avoidable. */
function pickGoldMover(ai, list, pairOf) {
  let best = null;
  let bestV = -Infinity;
  for (let i = list.length - 1; i >= 0; i--) {
    const u = list[i];
    const pr = pairOf.get(u.id);
    let v = 0;
    if (pr && pr.workers > minersFor(ai, pr)) v += 4;
    const o = u.order;
    if (o && o.type === 'gather' && o.phase === 'wait') v += 2;
    if (u.carry === 'g' && u.carryAmount > 0) v -= 3;
    if (v > bestV) {
      bestV = v;
      best = u;
    }
  }
  return best;
}

/** Move one gold worker from an over-full mine to one with room. */
function moveBetweenMines(ai, gold, pairOf) {
  if (ai.pairs.length < 2) return false;
  let over = null;
  let under = null;
  for (const pr of ai.pairs) {
    const d = pr.workers - minersFor(ai, pr);
    if (d >= 1 && (!over || d > over.workers - minersFor(ai, over))) over = pr;
    if (d <= -1 && (!under || d < under.workers - minersFor(ai, under))) under = pr;
  }
  if (!over || !under) return false;
  let u = null;
  let bestV = -Infinity;
  for (const w of gold) {
    if (pairOf.get(w.id) !== over) continue;
    const o = w.order;
    const v = (o && o.type === 'gather' && o.phase === 'wait' ? 2 : 0) - (w.carryAmount > 0 ? 1 : 0);
    if (v > bestV) {
      bestV = v;
      u = w;
    }
  }
  if (!u) return false;
  over.workers--;
  under.workers++;
  pairOf.set(u.id, under);
  ai.issue({ type: 'gather', units: [u.id], target: under.mine.id });
  return true;
}

function removeFrom(list, u) {
  const i = list.indexOf(u);
  if (i >= 0) list.splice(i, 1);
}

/** A worker whose cargo would not be wasted by switching (not carrying `keep`). */
function pickMovable(list, keep) {
  let fallback = null;
  for (let i = list.length - 1; i >= 0; i--) {
    const u = list[i];
    if (!u.carry || u.carryAmount === 0) return u;
    if (!fallback && u.carry !== keep) fallback = u;
  }
  return fallback || list[list.length - 1] || null;
}

function nearestTo(list, pt) {
  let best = null;
  let bestD = Infinity;
  for (const u of list) {
    const d = pt ? Math.hypot(u.x - pt.x, u.y - pt.y) : 0;
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}
