// Delta codec for ViewSnapshots (DESIGN 7). The host keeps the last snapshot
// it sent to each client and sends only what changed:
//   b      tick of the base snapshot (-1 = none)
//   tick, time
//   a      added entities (full EntityViews)
//   m      flat [id, x, y, f, …] for entities where only x / y / f changed
//   c      [[id, changedFields, removedKeys?], …] for other changed entities
//   r      removed entity ids
//   o      full id order, only when the natural order (survivors, then added) differs
//   p      [[index, player], …] changed players;  P full players array if the count changed
//   e, fl  events and felled trees of the new snapshot (omitted when empty)
//   x, xr  other top-level keys (fields, reveals, gameOver, …) that changed / disappeared
// apply(prev, encode(prev, next)) deep-equals next. Values are compared with
// === (so -0 and 0 are the same, as they are after JSON); nested objects and
// arrays are compared structurally and resent whole when they differ.
// Snapshots are treated as immutable: apply() never mutates `prev` and shares
// unchanged entity objects between snapshots.

const SPECIAL = new Set(['tick', 'time', 'players', 'entities', 'events', 'felled']);
const EMPTY = { tick: -1, entities: [], players: [] };

/** Structural equality for JSON-like values. */
export function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  let n = 0;
  for (const k in a) {
    if (!(k in b) || !same(a[k], b[k])) return false;
    n++;
  }
  for (const k in b) n--;
  return n === 0;
}

const indexCache = new WeakMap();

/** Map id → entity for a snapshot (cached per snapshot object). */
function indexOf(snap) {
  let m = indexCache.get(snap);
  if (!m) {
    m = new Map();
    for (const e of snap.entities) m.set(e.id, e);
    indexCache.set(snap, m);
  }
  return m;
}

/**
 * Delta that turns `prev` into `next`.
 * @param {object|null} prev base ViewSnapshot (null = from nothing)
 * @param {object} next ViewSnapshot
 * @returns {object} delta
 */
export function encode(prev, next) {
  const base = prev || EMPTY;
  const d = { b: prev ? prev.tick : -1, tick: next.tick, time: next.time };

  // ---- entities
  const prevIdx = indexOf(base);
  const nextEnts = next.entities || [];
  const added = [];
  const moved = [];
  const changed = [];
  const nextIds = new Set();
  for (const e of nextEnts) {
    nextIds.add(e.id);
    const pe = prevIdx.get(e.id);
    if (!pe) {
      added.push(e);
      continue;
    }
    if (pe === e) continue;
    let ch = null;
    let onlyMove = true;
    for (const k in e) {
      const v = e[k];
      const pv = pe[k];
      if (v === pv || same(pv, v)) continue;
      (ch || (ch = {}))[k] = v;
      if (k !== 'x' && k !== 'y' && k !== 'f') onlyMove = false;
    }
    let rm = null;
    for (const k in pe) if (!(k in e)) (rm || (rm = [])).push(k);
    if (rm) changed.push([e.id, ch || 0, rm]);
    else if (ch) {
      if (onlyMove && typeof e.x === 'number' && typeof e.y === 'number' && typeof e.f === 'number') moved.push(e.id, e.x, e.y, e.f);
      else changed.push([e.id, ch]);
    }
  }
  const removed = [];
  for (const pe of base.entities) if (!nextIds.has(pe.id)) removed.push(pe.id);
  if (added.length) d.a = added;
  if (moved.length) d.m = moved;
  if (changed.length) d.c = changed;
  if (removed.length) d.r = removed;

  // Natural order after apply: surviving prev entities in prev order, then added in next order.
  let k = 0;
  let inOrder = true;
  for (const pe of base.entities) {
    if (!nextIds.has(pe.id)) continue;
    if (nextEnts[k] === undefined || nextEnts[k].id !== pe.id) {
      inOrder = false;
      break;
    }
    k++;
  }
  if (inOrder) {
    for (const ae of added) {
      if (nextEnts[k] === undefined || nextEnts[k].id !== ae.id) {
        inOrder = false;
        break;
      }
      k++;
    }
  }
  if (!inOrder) d.o = nextEnts.map((e) => e.id);

  // ---- players
  const pp = base.players || [];
  const np = next.players || [];
  if (pp.length !== np.length) d.P = np;
  else {
    const pch = [];
    for (let i = 0; i < np.length; i++) if (!same(pp[i], np[i])) pch.push([i, np[i]]);
    if (pch.length) d.p = pch;
  }

  // ---- per-snapshot lists
  if (next.events && next.events.length) d.e = next.events;
  if (next.felled && next.felled.length) d.fl = next.felled;

  // ---- everything else (fields, reveals, gameOver, future keys)
  let x = null;
  for (const key in next) {
    if (SPECIAL.has(key)) continue;
    if (!(key in base) || !same(base[key], next[key])) (x || (x = {}))[key] = next[key];
  }
  if (x) d.x = x;
  let xr = null;
  for (const key in base) if (!SPECIAL.has(key) && !(key in next)) (xr || (xr = [])).push(key);
  if (xr) d.xr = xr;
  return d;
}

/**
 * Rebuild the next snapshot from a base and a delta.
 * @param {object|null} prev the snapshot the delta was encoded against
 * @param {object} d delta from encode()
 * @returns {object} ViewSnapshot
 */
export function apply(prev, d) {
  const base = prev || EMPTY;
  const removed = d.r && d.r.length ? new Set(d.r) : null;
  let changes = null;
  if (d.c || d.m) {
    changes = new Map();
    if (d.m) {
      const m = d.m;
      for (let i = 0; i < m.length; i += 4) changes.set(m[i], { x: m[i + 1], y: m[i + 2], f: m[i + 3] });
    }
    if (d.c) for (const c of d.c) changes.set(c[0], c);
  }
  const ents = [];
  for (const pe of base.entities) {
    if (removed && removed.has(pe.id)) continue;
    const c = changes && changes.get(pe.id);
    if (!c) {
      ents.push(pe);
      continue;
    }
    const ne = { ...pe };
    if (Array.isArray(c)) {
      if (c[1]) Object.assign(ne, c[1]);
      if (c[2]) for (const key of c[2]) delete ne[key];
    } else {
      ne.x = c.x;
      ne.y = c.y;
      ne.f = c.f;
    }
    ents.push(ne);
  }
  if (d.a) for (const ae of d.a) ents.push(ae);
  let entities = ents;
  if (d.o) {
    const byId = new Map();
    for (const e of ents) byId.set(e.id, e);
    entities = d.o.map((id) => byId.get(id)).filter(Boolean);
  }

  let players;
  if (d.P) players = d.P;
  else {
    players = (base.players || []).slice();
    if (d.p) for (const [i, p] of d.p) players[i] = p;
  }

  const out = {};
  for (const key in base) if (!SPECIAL.has(key)) out[key] = base[key];
  if (d.xr) for (const key of d.xr) delete out[key];
  if (d.x) Object.assign(out, d.x);
  out.tick = d.tick;
  out.time = d.time;
  out.players = players;
  out.entities = entities;
  out.events = d.e || [];
  out.felled = d.fl || [];
  return out;
}

/** Ids of every entity, in order (handy for tests and debugging). */
export function entityIds(snap) {
  return snap.entities.map((e) => e.id);
}
