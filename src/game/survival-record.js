// Trial of the Titans records (DESIGN 5.11), kept in this browser's localStorage
// under 'mythicwar-survival': the best wave reached, how many trials were played and
// the last one. Read by the lobby (the "your best" line), the game-over screen and the
// career profile; written once per finished trial by the Game.
export const SURVIVAL_KEY = 'mythicwar-survival';

let memory = null; // used when storage is blocked, so a session still remembers its own best

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const wholeWave = (v) => (Number.isInteger(v) && v >= 0 && v <= 100000 ? v : 0);

/** The stored record, cleaned: { best, games, last: { wave, players, pantheon, at } | null }. */
export function survivalRecord() {
  let raw = memory;
  try {
    const s = storage();
    const text = s && s.getItem(SURVIVAL_KEY);
    if (text) raw = JSON.parse(text);
  } catch {
    // unreadable: fall back to this session's copy
  }
  const r = raw && typeof raw === 'object' ? raw : {};
  const last = r.last && typeof r.last === 'object' ? {
    wave: wholeWave(r.last.wave),
    players: wholeWave(r.last.players),
    pantheon: typeof r.last.pantheon === 'string' ? r.last.pantheon.slice(0, 32) : '',
    at: Number.isFinite(r.last.at) ? r.last.at : 0,
  } : null;
  return { best: wholeWave(r.best), games: wholeWave(r.games), last };
}

/** The best wave ever reached in this browser (0 before the first trial). */
export function bestSurvivalWave() {
  return survivalRecord().best;
}

/**
 * Remember a finished trial. Returns { best, previous, isNew } (isNew: this one beat the old best).
 * @param {number} wave the wave reached
 * @param {{ players?: number, pantheon?: string }} [info]
 */
export function recordSurvivalWave(wave, info = {}) {
  const w = wholeWave(wave);
  const rec = survivalRecord();
  const previous = rec.best;
  const next = {
    best: Math.max(previous, w),
    games: rec.games + 1,
    last: { wave: w, players: wholeWave(info.players), pantheon: typeof info.pantheon === 'string' ? info.pantheon : '', at: Date.now() },
  };
  memory = next;
  try {
    const s = storage();
    if (s) s.setItem(SURVIVAL_KEY, JSON.stringify(next));
  } catch {
    // storage full or blocked: the in-memory copy stands
  }
  return { best: next.best, previous, isNew: w > previous };
}
