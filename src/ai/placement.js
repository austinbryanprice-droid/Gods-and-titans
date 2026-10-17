// Base layout for the AI: where to put each building so the paths between the
// Town Center, its gold mine and the wood line stay open.
import { BUILDINGS } from '../data/index.js';

const reserveCache = new WeakMap();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/**
 * Tiny tie-break for equally good spots, measured in the base's own frame
 * (along / across the direction to the map center) so mirrored bases on a
 * symmetric map make mirrored choices instead of following the scan order.
 * @param {object} ai
 * @param {number} dx offset of the candidate from the search center
 * @param {number} dy
 */
export function mirrorTie(ai, dx, dy) {
  const f = ai.frontDir();
  const along = dx * f.x + dy * f.y;
  const across = dx * -f.y + dy * f.x;
  return along * 1e-4 + across * 1e-6;
}

/**
 * Tiles kept free of buildings: the corridor between each own drop-off and
 * the mine it serves, and a lane toward the nearest trees.
 */
function reservedMask(world, ai) {
  const map = world.map;
  const key = ai.layoutKey();
  let rec = reserveCache.get(ai);
  if (rec && rec.key === key && rec.ver === map.version) return rec.mask;
  const w = map.width;
  const h = map.height;
  const mask = rec && rec.mask.length === w * h ? rec.mask.fill(0) : new Uint8Array(w * h);
  const markRect = (x0, y0, x1, y1) => {
    for (let y = clamp(Math.floor(y0), 0, h - 1); y <= clamp(Math.floor(y1), 0, h - 1); y++) {
      for (let x = clamp(Math.floor(x0), 0, w - 1); x <= clamp(Math.floor(x1), 0, w - 1); x++) mask[y * w + x] = 1;
    }
  };
  const markLane = (ax, ay, bx, by, half) => {
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let i = 0; i <= steps; i++) {
      const x = ax + ((bx - ax) * i) / steps;
      const y = ay + ((by - ay) * i) / steps;
      markRect(x - half, y - half, x + half, y + half);
    }
  };
  for (const pair of ai.minePairs()) {
    if (pair.far) continue; // a long-distance fallback mine keeps no lane
    const { drop, mine } = pair;
    // Bounding box between the drop-off and the mine (1 tile of slack around it).
    const x0 = Math.min(drop.tx, mine.tx) - 1;
    const y0 = Math.min(drop.ty, mine.ty) - 1;
    const x1 = Math.max(drop.tx + drop.size, mine.tx + mine.size);
    const y1 = Math.max(drop.ty + drop.size, mine.ty + mine.size);
    markRect(x0, y0, x1, y1);
  }
  const wood = ai.woodSpot;
  const home = ai.home();
  if (wood && home) markLane(home.x, home.y, wood.tx + 0.5, wood.ty + 0.5, 1.1);
  reserveCache.set(ai, { key, ver: map.version, mask });
  return mask;
}

/**
 * Walkway check for a footprint: the one-tile ring around it must be free of
 * buildings and mines, and the ring may touch blocked terrain (trees, rock,
 * water, the map edge) along one stretch only — a building that bridges two
 * separate obstacles can seal a pocket or squeeze a path to one tile, which
 * strands workers. Returns -1 when rejected, else the number of blocked ring
 * tiles (a placement penalty).
 */
function walkwayClear(map, tx, ty, s) {
  const w = map.width;
  // Walk the ring clockwise from its top-left corner.
  const n = 4 * (s + 1);
  let blocked = 0;
  let runs = 0;
  let prevOpen = null;
  let firstOpen = null;
  for (let i = 0; i < n; i++) {
    let x;
    let y;
    const side = Math.floor(i / (s + 1));
    const k = i % (s + 1);
    if (side === 0) { x = tx - 1 + k; y = ty - 1; }
    else if (side === 1) { x = tx + s; y = ty - 1 + k; }
    else if (side === 2) { x = tx + s - k; y = ty + s; }
    else { x = tx - 1; y = ty + s - k; }
    let open = false;
    if (map.inBounds(x, y)) {
      if (map.occ[y * w + x] !== 0) return -1;
      open = map.isPassable(x, y);
    }
    if (!open) blocked++;
    if (i === 0) firstOpen = open;
    else if (open && !prevOpen) runs++;
    prevOpen = open;
  }
  // Close the loop: an open run that starts at index 0 counts unless it continues the last one.
  if (firstOpen && !prevOpen) runs++;
  if (blocked === 0 || blocked === n) return blocked === n ? -1 : 0;
  return runs > 1 ? -1 : blocked;
}

/** Overlaps (or touches) a spot whose builders got stuck recently (build.js unstickBuilders). */
function nearBadSpot(ai, tx, ty, size) {
  const now = ai.world.tickCount;
  for (const b of ai.badSpots) {
    if (b.until <= now) continue;
    if (tx <= b.tx + b.size && b.tx <= tx + size && ty <= b.ty + b.size && b.ty <= ty + size) return true;
  }
  return false;
}

/**
 * Best footprint for a building near (x, y).
 * opts: { minR, maxR, ideal (preferred distance), avoidReserved, dir: {x, y} preferred direction, walkway }
 * @returns {{tx:number, ty:number}|null}
 */
export function findSpot(world, ai, typeId, x, y, opts = {}) {
  const size = BUILDINGS[typeId] ? BUILDINGS[typeId].size : 2;
  const map = world.map;
  const minR = opts.minR ?? 0;
  const maxR = opts.maxR ?? 14;
  const ideal = opts.ideal ?? minR;
  const avoid = opts.avoidReserved !== false;
  const walkway = opts.walkway !== false;
  const mask = avoid ? reservedMask(world, ai) : null;
  const w = map.width;
  const cx = Math.round(x - size / 2);
  const cy = Math.round(y - size / 2);
  let best = null;
  let bestScore = Infinity;
  for (let r = 0; r <= maxR + 1; r++) {
    if (best && r > Math.sqrt(bestScore) + 4) break;
    for (let ty = cy - r; ty <= cy + r; ty++) {
      const edge = ty === cy - r || ty === cy + r;
      for (let tx = cx - r; tx <= cx + r; tx += edge ? 1 : Math.max(1, 2 * r)) {
        const fx = tx + size / 2;
        const fy = ty + size / 2;
        const d = Math.hypot(fx - x, fy - y);
        if (d < minR || d > maxR) continue;
        if (tx < 1 || ty < 1 || tx + size > map.width - 1 || ty + size > map.height - 1) continue;
        let score = (d - ideal) * (d - ideal) + mirrorTie(ai, fx - x, fy - y);
        if (opts.dir) {
          const dl = Math.max(0.001, d);
          const dot = ((fx - x) * opts.dir.x + (fy - y) * opts.dir.y) / dl;
          score += (1 - dot) * (opts.dirWeight ?? 6);
        }
        if (score >= bestScore) continue;
        if (mask) {
          let hit = false;
          for (let yy = ty; yy < ty + size && !hit; yy++) {
            for (let xx = tx; xx < tx + size; xx++) {
              if (mask[yy * w + xx]) { hit = true; break; }
            }
          }
          if (hit) continue;
        }
        if (ai.badSpots && nearBadSpot(ai, tx, ty, size)) continue;
        if (!world.canPlaceBuilding(ai.me, typeId, tx, ty)) continue;
        if (walkway) {
          const blocked = walkwayClear(map, tx, ty, size);
          if (blocked < 0) continue;
          score += blocked * 0.8;
          if (score >= bestScore) continue;
        }
        best = { tx, ty };
        bestScore = score;
      }
    }
  }
  // Nothing found: give up the reserved lanes first, the walkway rule last.
  if (!best && avoid) return findSpot(world, ai, typeId, x, y, { ...opts, avoidReserved: false });
  if (!best && walkway) return findSpot(world, ai, typeId, x, y, { ...opts, avoidReserved: false, walkway: false });
  return best;
}
