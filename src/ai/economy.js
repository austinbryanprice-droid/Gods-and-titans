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

/** Desired worker split for this think. */
function targets(ai, s) {
  const prof = ai.prof;
  const p = s.p;
  const slots = prayerSlots(s);
  let pray = 0;
  if (slots > 0) {
    const temple = doneOf(s, 'temple') > 0;
    pray = temple ? prof.prayLate : prof.prayEarly;
    if (ai.savingForTitan(s)) pray = prof.prayTitan;
    // Faith piling up with nothing to buy: pray less.
    const faithCap = ai.savingForTitan(s) ? 1200 : temple ? 700 : 450;
    // Gold piling up while faith is short: more worshippers pray (faith buys gods and creatures).
    if (p.faith < faithCap * 0.6) {
      if (p.gold > 2500) pray += 4;
      else if (p.gold > 1200) pray += 2;
    }
    if (p.faith > faithCap) pray = Math.max(1, Math.floor(pray / 2));
    if (p.faith > faithCap * 1.8) pray = 0;
    pray = Math.min(pray, slots, Math.floor(s.workers.length * 0.5));
  }
  const avail = Math.max(0, s.workers.length - s.jobs.build - pray - (ai.militia ? ai.militia.size : 0));
  let share = prof.woodShare;
  if (p.wood > 700) share *= 0.4;
  else if (p.wood > 400) share *= 0.75;
  else if (p.wood < 120) share *= 1.3;
  if (p.gold > 1200 && p.wood < 400) share *= 1.35;
  if (p.gold < 150 && p.wood > 250) share *= 0.7;
  if (!ai.pairs.length) share = 1;
  if (!ai.woodSpot) share = 0;
  share = Math.min(1, share);
  const wood = Math.round(avail * share);
  return { pray, wood, gold: avail - wood };
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

function bestPair(ai) {
  let best = null;
  let bestScore = Infinity;
  for (const pr of ai.pairs) {
    const score = pr.workers + pr.gap * 0.8 + (pr.mine.amount < 1200 ? 8 : 0);
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
  for (const u of s.workers) {
    if (ai.militia && ai.militia.has(u.id)) continue;
    const j = s.job.get(u.id);
    if (j === 'gold') {
      const o = u.order.type === 'gather' ? u.order : u.order.resume;
      const pr = o ? pairByMine.get(o.mine) : null;
      if (pr) {
        pr.workers++;
        gold.push(u);
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
      const pr = bestPair(ai);
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
  // 2. Rebalance a couple of workers per think.
  const moves = ai.prof.think >= 20 ? 3 : 2;
  for (let k = 0; k < moves; k++) {
    if (pr < want.pray) {
      const fromWood = (w - want.wood > g - want.gold && wood.length > 0) || gold.length === 0;
      const src = fromWood ? wood : gold;
      const u = nearestTo(src, ai.prayerPoint(s));
      if (!u) break;
      removeFrom(src, u);
      if (fromWood) w--;
      else g--;
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
    } else if (want.wood - w >= 2 && gold.length && trees.length) {
      const u = pickMovable(gold, 'g');
      if (!u) break;
      removeFrom(gold, u);
      g--;
      toWood.push(u);
      w++;
    } else if (want.gold - g >= 2 && wood.length && ai.pairs.length) {
      const u = pickMovable(wood, 'w');
      if (!u) break;
      removeFrom(wood, u);
      w--;
      toGold.push(u);
      g++;
    } else break;
  }
  ai.treeRot = treeIdx % 997;
  sendPray(toPray);
  sendGold(toGold);
  sendWood(toWood);
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
