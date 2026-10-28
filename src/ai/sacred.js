// The AI and the sacred sites (DESIGN 5.11 and 10): a few "pilgrim" Worshippers walk out to
// capture sites nobody on the AI's team holds (Hard and Normal also steal a rival's site when
// none of the rival's soldiers stand guard), and once a site is taken the pilgrim goes back to
// work. When a rival side runs a Sacred Victory clock, military.js sends the army to the nearest
// of their sites (sacredTarget) and a pilgrim follows it in. Only reads the World and acts through
// ai.issue, like the rest of the AI.
import { SITE_RADIUS } from '../config.js';

const GUARD_RANGE = 8; // enemy soldiers this close to a site keep pilgrims away (unless the army is there)
const GIVE_UP = 90; // seconds a pilgrim may take before it is sent back to work
const RETRY = 120; // seconds before a site where a pilgrim fell or gave up is tried again
const CREEP_CLEAR = 9; // living creeps this close to a site, or to the walk there, keep pilgrims away

function sitesFor(world) {
  return world.sites || [];
}

/** Enemy soldiers (not workers) within r of a point. */
function guards(s, x, y, r) {
  let n = 0;
  for (const u of s.enemyUnits) {
    if (u.dead || u.def.class === 'worker') continue;
    if (Math.hypot(u.x - x, u.y - y) <= r) n++;
  }
  return n;
}

/** Distance from point p to the segment a-b. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Would a Worshipper walking from home to the site pass a creep camp that is still alive? */
function creepsInTheWay(s, home, site) {
  for (const camp of s.camps) {
    for (const m of camp.members) {
      if (m.dead) continue;
      if (segDist(m.x, m.y, home.x, home.y, site.x, site.y) < CREEP_CLEAR) return true;
    }
  }
  return false;
}

/**
 * The site the army should march on: while a rival side's Sacred Victory clock runs, the one of
 * their sites nearest to home. null otherwise.
 */
export function sacredTarget(ai, s) {
  const world = ai.world;
  const sv = world.sacred;
  if (!sv || sv.team === s.team) return null;
  const home = ai.home();
  let best = null;
  let bestD = Infinity;
  for (const site of sitesFor(world)) {
    if (site.owner < 0 || world.players[site.owner].team === s.team) continue;
    const d = Math.hypot(site.x - home.x, site.y - home.y);
    if (d < bestD) {
      bestD = d;
      best = site;
    }
  }
  return best;
}

/** Send pilgrims to sites the team does not hold, and let them go once the work is done. */
export function runSacred(ai, s) {
  const world = ai.world;
  const sites = sitesFor(world);
  if (!sites.length) return;
  const prof = ai.prof;
  if (!ai.pilgrims) ai.pilgrims = new Map(); // worker id -> { site index, since }
  if (!ai.siteRetry) ai.siteRetry = new Map(); // site index -> game time it may be tried again
  const pilgrims = ai.pilgrims;
  const mine = (site) => site.owner >= 0 && world.players[site.owner].team === s.team;
  const army = ai.mil && ai.mil.mode === 'site' ? ai.mil.site : null;

  // Pilgrims that are done, gone, or were given other work.
  for (const [id, job] of pilgrims) {
    const u = world.entities.get(id);
    const site = sites[job.site];
    const order = u && !u.dead ? u.order : null;
    const walking = !order || order.type === 'move';
    if (!u || u.dead || !walking || !site || mine(site) || s.t - job.since > GIVE_UP) {
      pilgrims.delete(id);
      if (!u || u.dead || s.t - job.since > GIVE_UP) ai.siteRetry.set(job.site, s.t + RETRY);
      // Back to work: an idle worker is picked up by manageWorkers on its next pass.
      if (u && !u.dead && walking && site && (mine(site) || s.t - job.since > GIVE_UP)) ai.issue({ type: 'stop', units: [id] });
    }
  }
  if (s.t < prof.pilgrimsFrom || s.workers.length < 8) return;

  // Sites worth a pilgrim: not ours, nobody on the way there yet, and not guarded (unless our army goes there).
  const taken = new Set();
  for (const job of pilgrims.values()) taken.add(job.site);
  const home = ai.home();
  const wanted = [];
  sites.forEach((site, i) => {
    if (mine(site) || taken.has(i)) return;
    const rival = site.owner >= 0;
    const escorted = army === site;
    if (rival && !prof.stealSites && !escorted) return;
    if (!escorted && (s.t < (ai.siteRetry.get(i) ?? 0) || guards(s, site.x, site.y, GUARD_RANGE) > 0 || creepsInTheWay(s, home, site))) return;
    wanted.push({ i, site, d: Math.hypot(site.x - home.x, site.y - home.y) - (escorted ? 1000 : 0) });
  });
  wanted.sort((a, b) => a.d - b.d || a.i - b.i);
  const room = prof.pilgrims + (ai.world.sacredVictory ? 1 : 0) - pilgrims.size;
  if (room <= 0 || !wanted.length) return;

  // The nearest gold or wood worker (not a militia, builder or one praying) to each site.
  const used = new Set(pilgrims.keys());
  for (const w of wanted.slice(0, room)) {
    let best = null;
    let bestD = Infinity;
    for (const u of s.workers) {
      if (used.has(u.id) || (ai.militia && ai.militia.has(u.id))) continue;
      const job = s.job.get(u.id);
      if (job !== 'gold' && job !== 'wood' && job !== 'idle') continue;
      const d = Math.hypot(u.x - w.site.x, u.y - w.site.y);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (!best) return;
    used.add(best.id);
    pilgrims.set(best.id, { site: w.i, since: s.t });
    // Stand a little off the middle, on the side facing home.
    const dx = home.x - w.site.x;
    const dy = home.y - w.site.y;
    const l = Math.hypot(dx, dy) || 1;
    const off = SITE_RADIUS * 0.4;
    ai.issue({ type: 'move', units: [best.id], x: w.site.x + (dx / l) * off, y: w.site.y + (dy / l) * off });
  }
}
