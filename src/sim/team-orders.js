// Team orders (DESIGN 6.2, 10 "Answering team marks"): a player's Attack, Defend or Help marker
// is also a sim command, `teamMark {kind, x, y}`, so that computer allies can answer it. The host
// issues it when it relays the mark (src/net/session.js), so it is recorded like every command
// (replays) and lives in the World (saves). It is a signal for the sender's own team: it is never
// in a snapshot or an event (snapshots go to everyone), only the AIs on that team read it.

/** The kinds the AIs answer, and how long (game seconds) each stands in the sim. */
export const TEAM_ORDER_LIFE = { attack: 90, defend: 75, help: 60 };

/** Is this a mark kind the sim keeps? */
export function isTeamOrderKind(kind) {
  return typeof kind === 'string' && Object.hasOwn(TEAM_ORDER_LIFE, kind);
}

function marksOf(world) {
  if (!Array.isArray(world.teamMarks)) world.teamMarks = []; // (a save from before team orders)
  return world.teamMarks;
}

/**
 * Apply a `teamMark` command: the sender's newest order replaces their earlier one (one standing
 * order per player). A defeated player still marks for their team, as they still chat with it.
 */
export function applyTeamMark(world, player, cmd) {
  const p = world.players[player];
  if (!p || world.gameOver || !isTeamOrderKind(cmd.kind)) return;
  if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return;
  const now = world.time;
  const list = marksOf(world).filter((m) => m.from !== player && m.until > now);
  world.markSeq = (world.markSeq || 0) + 1;
  list.push({ id: world.markSeq, from: player, team: p.team, kind: cmd.kind, x: cmd.x, y: cmd.y, t: now, until: now + TEAM_ORDER_LIFE[cmd.kind] });
  world.teamMarks = list;
}

/**
 * The order a player should answer now: the newest standing mark from another player of their team
 * (a newer mark of any kind replaces an older one), or null. Enemies' marks are never returned.
 * @returns {{ id: number, from: number, team: number, kind: string, x: number, y: number, t: number, until: number } | null}
 */
export function teamOrderFor(world, me) {
  const p = world.players[me];
  if (!p) return null;
  const now = world.time;
  let best = null;
  for (const m of marksOf(world)) {
    if (m.from === me || m.until <= now) continue;
    const q = world.players[m.from];
    if (!q || q.team !== p.team) continue;
    if (!best || m.id > best.id) best = m;
  }
  return best;
}
