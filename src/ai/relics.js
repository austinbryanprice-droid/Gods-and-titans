// Relics (DESIGN 5.14): once a camp near home is cleared, send the nearest Worshipper to pick up its
// relic and carry it to a Temple (the sim walks it there). Only when the AI has a finished Temple and
// no enemy stands near the relic; one Worshipper per relic. A Worshipper on a relic errand is left
// alone by the economy (scan.js workerJob: 'relic').
import { canCarry, relicOf, nearestTemple } from '../sim/relics.js';
import { doneOf } from './scan.js';

const FETCH_RANGE = 70; // tiles from home a relic may lie and still be fetched (as far as the army creeps)
const ENEMY_NEAR = 10; // tiles: an enemy this close to a relic keeps the Worshippers home

export function runRelics(ai, s) {
  const world = ai.world;
  const relics = world.relics;
  if (!relics || !relics.length || !doneOf(s, 'temple')) return;
  const home = ai.home();
  if (!home) return;
  // A Worshipper of mine holding a relic but busy with something else: to the Temple first.
  for (const u of s.workers) {
    if (s.job.get(u.id) === 'relic' || !relicOf(world, u)) continue;
    const b = nearestTemple(world, u);
    if (b) ai.issue({ type: 'smart', units: [u.id], target: b.id });
  }
  for (const r of relics) {
    if (r.state !== 'ground') continue;
    if (Math.hypot(r.x - home.x, r.y - home.y) > FETCH_RANGE) continue;
    if (s.enemyUnits.some((e) => !e.dead && Math.hypot(e.x - r.x, e.y - r.y) < ENEMY_NEAR)) continue;
    let busy = false;
    let best = null;
    let bestD = Infinity;
    for (const u of s.workers) {
      const o = u.order;
      if (o && o.type === 'relic' && o.relic === r.i) {
        busy = true;
        break;
      }
      const j = s.job.get(u.id);
      if ((j !== 'gold' && j !== 'wood' && j !== 'idle') || u.carryAmount > 0 || (ai.militia && ai.militia.has(u.id)) || !canCarry(world, u)) continue;
      const d = Math.hypot(u.x - r.x, u.y - r.y);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (busy || !best) continue;
    ai.issue({ type: 'smart', units: [best.id], relic: r.i, x: r.x, y: r.y });
    s.job.set(best.id, 'relic');
  }
}
