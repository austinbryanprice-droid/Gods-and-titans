// Sacred Sites (DESIGN 5.11): neutral holy ground that mapgen places fairly
// (mapData.sacred). A Worshipper or Priest standing at a site while no rival
// stands there captures it over SITE_CAPTURE_TIME seconds (a rival's hold is torn
// down first, over SITE_NEUTRALIZE_TIME); the holder gains SITE_FAITH faith each
// second. With the lobby's Sacred Victory on, a team that holds every site for
// SACRED_HOLD seconds wins. The helpers at the bottom are shared with the client
// (placement ghost, HUD).
import {
  DT, SITE_RADIUS, SITE_CAPTURE_TIME, SITE_NEUTRALIZE_TIME, SITE_FAITH, SITE_KEEP, SACRED_HOLD,
} from '../config.js';
import { hyp } from './common.js';

/** The reason a building is refused next to a site. */
export const SITE_IN_WAY = 'Too close to a sacred site.';

/** Can this unit capture a site? Worshippers and Priests (the holy mortals). */
export function canCapture(def) {
  return !!def && (def.class === 'worker' || def.id === 'priest');
}

/** Is Sacred Victory on for this GameSetup? (Never in a Trial of the Titans, where every player is on one team.) */
export function sacredVictoryOn(setup) {
  return !!(setup && setup.sacredVictory === true && setup.survival !== true);
}

/** World state for the map's sites: { x, y, owner, prog, by } each (by: the player whose capture is under way). */
export function createSites(points) {
  return (points || []).map((p) => ({ x: p.x, y: p.y, owner: -1, prog: 0, by: -1, contested: false }));
}

/**
 * One tick of every site: who stands there, capture progress, faith for the holders, and the
 * Sacred Victory countdown. Called by World.tick after movement, before faith is paid out.
 */
export function updateSites(world) {
  const sites = world.sites;
  if (!sites.length) return;
  const players = world.players;
  const tmp = world._tmpQuery;
  for (let si = 0; si < sites.length; si++) {
    const s = sites[si];
    // A defeated holder or capturer lets go.
    if (s.owner >= 0 && players[s.owner].defeated) {
      world.emit({ type: 'siteLost', site: si, player: s.owner });
      s.owner = -1;
      s.prog = 0;
    }
    if (s.by >= 0 && players[s.by].defeated) {
      s.by = -1;
      s.prog = 0;
    }
    // Who is here: the teams with any living unit, and the capturers among them.
    tmp.length = 0;
    world.hash.query(s.x, s.y, SITE_RADIUS + world.maxRadius, tmp);
    let team = -1;
    let contested = false;
    let capturer = -1; // lowest player index of the team with a capturer here (deterministic)
    let byHere = false;
    for (const u of tmp) {
      if (u.dead || u.owner < 0 || hyp(u.x - s.x, u.y - s.y) > SITE_RADIUS) continue;
      const t = players[u.owner].team;
      if (team === -1) team = t;
      else if (t !== team) contested = true;
      if (canCapture(u.def) && !u.summoned) {
        if (u.owner === s.by) byHere = true;
        if (capturer < 0 || u.owner < capturer) capturer = u.owner;
      }
    }
    s.contested = contested;
    if (contested) continue; // rivals face each other: nothing moves
    const ownerTeam = s.owner >= 0 ? players[s.owner].team : -1;
    const byTeam = s.by >= 0 ? players[s.by].team : -1;
    if (team === -1 || capturer < 0 || team === ownerTeam) {
      // Nobody (or only soldiers, or the holder's own side) here: a capture left half done fades,
      // unless soldiers of the capturing team are holding the ground for it.
      if (s.prog > 0 && !(team !== -1 && team === byTeam)) {
        s.prog = Math.max(0, s.prog - DT / SITE_CAPTURE_TIME);
        if (s.prog === 0) s.by = -1;
      }
      continue;
    }
    // One team with a capturer here, and the site is not theirs.
    if (s.by >= 0 && byTeam !== team) {
      // Another team's half-done capture has to fade before this one can start.
      s.prog = Math.max(0, s.prog - DT / SITE_CAPTURE_TIME);
      if (s.prog > 0) continue;
      s.by = -1;
    }
    if (s.by < 0 || (!byHere && players[s.by].team === team)) s.by = byHere ? s.by : capturer;
    if (s.owner >= 0) {
      // A rival holds it: tear their hold down first.
      s.prog += DT / SITE_NEUTRALIZE_TIME;
      if (s.prog >= 1 - 1e-9) {
        world.emit({ type: 'siteLost', site: si, player: s.owner });
        s.owner = -1;
        s.prog = 0;
      }
      continue;
    }
    s.prog += DT / SITE_CAPTURE_TIME;
    if (s.prog >= 1 - 1e-9) {
      s.owner = s.by;
      s.by = -1;
      s.prog = 0;
      world.emit({ type: 'siteCaptured', site: si, player: s.owner });
    }
  }
  updateSacredVictory(world);
}

/** Faith for each held site; called from World.accrueFaith after the rates were reset. */
export function accrueSiteFaith(world) {
  for (const s of world.sites) {
    if (s.owner < 0) continue;
    const p = world.players[s.owner];
    p.faithRate += SITE_FAITH;
    p.faith += SITE_FAITH * DT;
  }
}

/** The team holding every site (-1 when none does). */
export function teamHoldingAll(world) {
  const sites = world.sites;
  if (!sites.length) return -1;
  let team = -1;
  for (const s of sites) {
    if (s.owner < 0) return -1;
    const t = world.players[s.owner].team;
    if (team === -1) team = t;
    else if (t !== team) return -1;
  }
  return team;
}

/** Sacred Victory: start, break or finish the countdown of the team holding every site. */
function updateSacredVictory(world) {
  if (!world.sacredVictory || world.gameOver) return;
  // (No clock while the Decade of Peace holds: guards that cannot be fought would make it unbreakable.)
  const team = world.peace ? -1 : teamHoldingAll(world);
  const cur = world.sacred;
  if (cur && cur.team !== team) {
    world.sacred = null;
    world.emit({ type: 'sacredBroken', team: cur.team });
  }
  if (team < 0) return;
  if (!world.sacred) {
    world.sacred = { team, end: Math.round((world.time + SACRED_HOLD) * 100) / 100 };
    world.emit({ type: 'sacredHold', team, end: world.sacred.end });
    return;
  }
  if (world.time >= world.sacred.end - 1e-9) world.winSacred(team);
}

/** Snapshot rows: { x, y, o, p, c, cn } (o holder, p progress 0..1, c the capturing player, cn contested). */
export function siteViews(world) {
  return world.sites.map((s) => {
    const v = { x: s.x, y: s.y, o: s.owner };
    if (s.prog > 0) {
      v.p = Math.round(s.prog * 100) / 100;
      v.c = s.by;
    }
    if (s.contested) v.cn = 1;
    return v;
  });
}

/**
 * Is a footprint (top-left tile (tx, ty), `size` tiles a side) closer than SITE_KEEP to one of these
 * sites' centers? Shared by the sim's placementError and the client's placement ghost.
 */
export function siteBlocksFootprint(sites, tx, ty, size) {
  if (!sites) return false;
  for (const s of sites) {
    const dx = Math.max(tx - s.x, 0, s.x - (tx + size));
    const dy = Math.max(ty - s.y, 0, s.y - (ty + size));
    if (dx * dx + dy * dy < SITE_KEEP * SITE_KEEP) return true;
  }
  return false;
}
