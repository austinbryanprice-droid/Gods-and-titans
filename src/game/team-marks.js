// The team marks standing on this screen (DESIGN 9): the pings and markers my teammates sent
// and my own, each with the time it goes out. Pure bookkeeping, no DOM: the minimap and the HUD
// pins read `active(now)` every frame. The net layer has already checked who may see a mark
// (the host relays to the sender's teammates only), so everything added here is shown.
import { MARKS, MARK_MAX_PER_PLAYER, MARK_MAX_TOTAL } from '../data/marks.js';

export class TeamMarks {
  /**
   * @param {object} [o]
   * @param {number} [o.maxPerPlayer] marks one player may have standing
   * @param {number} [o.maxTotal] marks standing at once
   */
  constructor({ maxPerPlayer = MARK_MAX_PER_PLAYER, maxTotal = MARK_MAX_TOTAL } = {}) {
    this.maxPerPlayer = maxPerPlayer;
    this.maxTotal = maxTotal;
    /** Standing marks, oldest first: { id, from, kind, x, y, t0, t1 } (times in ms). */
    this.list = [];
    this.seq = 0;
  }

  /**
   * Put a mark up now. A typed marker (anything but a ping) replaces its sender's earlier marker of
   * that kind, so "Attack here" moves with the plan; a player's oldest mark makes room for a new one
   * past `maxPerPlayer`. Returns the mark, or null for an unknown kind or a spot that is not a number.
   * @param {{ from: number, kind: string, x: number, y: number }} m
   * @param {number} [now] performance.now()
   */
  add(m, now = performance.now()) {
    const def = m && Object.hasOwn(MARKS, m.kind) ? MARKS[m.kind] : null;
    if (!def || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return null;
    this.prune(now);
    if (def.id !== 'ping') this.list = this.list.filter((o) => !(o.from === m.from && o.kind === m.kind));
    const mine = this.list.filter((o) => o.from === m.from);
    for (let i = 0; i <= mine.length - this.maxPerPlayer; i++) this.remove(mine[i]);
    const mark = { id: ++this.seq, from: m.from, kind: def.id, x: m.x, y: m.y, t0: now, t1: now + def.life * 1000 };
    this.list.push(mark);
    while (this.list.length > this.maxTotal) this.list.shift();
    return mark;
  }

  remove(mark) {
    const i = this.list.indexOf(mark);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** Drop the marks that have gone out by `now`. */
  prune(now = performance.now()) {
    if (this.list.some((m) => m.t1 <= now)) this.list = this.list.filter((m) => m.t1 > now);
  }

  /** The marks standing at `now` (oldest first). The array is the store's own: do not keep or change it. */
  active(now = performance.now()) {
    this.prune(now);
    return this.list;
  }

  /** Fraction of its time a mark has used, 0 when put up to 1 when it goes out. */
  static age(m, now) {
    return Math.max(0, Math.min(1, (now - m.t0) / (m.t1 - m.t0)));
  }

  clear() {
    this.list = [];
  }
}
