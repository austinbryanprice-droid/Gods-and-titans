// Delta codec for ViewSnapshots (DESIGN 7). The host keeps the last snapshot
// it sent to each client and sends only what changed:
//   b      tick of the base snapshot (-1 = none)
//   tick   omitted when it is b + 1;   time
//   a      added entities (full EntityViews)
//   m      flat [idGap, dx, dy, …]      entities whose x and y moved (f unchanged)
//   mf     flat [idGap, dx, dy, df, …]  entities whose x, y and f changed
//          dx = change in hundredths (x = (round(prevX·100) + dx) / 100); only used
//          when both values are exact hundredths, so decoding is bit-exact
//   c      { path: [idGap, value, idGap, value, …] } other changed fields, one column
//          per field. A path is a key ('hp', 'st') or a dotted path into a nested
//          object / same-length array that kept its shape ('q.0.p', 'bo.tx'); a nested
//          key longer than 2 characters is written as its position '~i' in the
//          object ('cd.~0' = the first cooldown), so all units share the column;
//          '+x' / '+y' / '+f' columns carry a single coordinate as a hundredths delta
//   cr     [[id, removedKeys], …] keys that disappeared from an entity
//   cx     [[id, changedFields, removedKeys?], …] entities with keys the path syntax
//          cannot express (a '.' or '__proto__' in a key): whole values, as before
//   r      removed entity ids
//   o      full id order, only when the natural order (survivors, then added) differs
//   p      [[index, { path: value }, removedKeys?], …] changed player fields (paths as in c)
//   pw     [[index, player], …] players replaced whole;  P full players array if the count changed
//   e      events of the new snapshot: an event whose keys match a known shape
//          (EVENT_SHAPES) is [shapeCode, …values]; any other event is sent as is
//          (a non-object one as [-1, value])
//   fl     felled trees of the new snapshot (omitted when empty)
//   x, xr  other top-level keys (fields, reveals, gameOver, …) that changed / disappeared
// idGap: ids are written as the difference to the previous id of the same column
// (entities come in creation order, so gaps are small positive numbers).
// apply(prev, encode(prev, next)) deep-equals next. Values are compared with
// === (so -0 and 0 are the same, as they are after JSON); keys whose value is
// undefined are dropped, as JSON does. Snapshots are treated as immutable:
// apply() never mutates `prev` (nested objects it patches are copied first) and
// shares unchanged entity objects between snapshots.

const SPECIAL = new Set(['tick', 'time', 'players', 'entities', 'events', 'felled']);
const EMPTY = { tick: -1, entities: [], players: [] };
const MAX_DEPTH = 4; // deepest nested path, e.g. q.0.p is depth 3

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
    if (!hasOwn.call(b, k) || !same(a[k], b[k])) return false;
    n++;
  }
  for (const k in b) n--;
  return n === 0;
}

const hasOwn = Object.prototype.hasOwnProperty;
/** A key the path syntax can carry (no '.', no leading '+' or '~', not '__proto__'). */
const plainKey = (k) => k.indexOf('.') < 0 && k[0] !== '+' && k[0] !== '~' && k !== '__proto__';

// Known event shapes (DESIGN 6.4 + sim extras). Only the key sets matter: an
// event is packed when its keys are exactly 'type' + one of these lists. The
// order of this table is part of the wire format (host and client run the same
// version, checked at join: wire-version.js fingerprints this table).
export const EVENT_SHAPES = [
  ['hit', 'dst', 'amount', 'src'],
  ['attack', 'src', 'dst', 'ranged'],
  ['projectile', 'src', 'dst', 'kind', 'el', 'fx', 'fy', 'tx', 'ty', 'flight'],
  ['death', 'id', 't', 'o', 'x', 'y', 'k'],
  ['cast', 'src', 'ability', 'x', 'y', 'target'],
  ['effect', 'el', 'shape', 'x', 'y', 'r', 'duration', 'src', 'ability'],
  ['effect', 'el', 'shape', 'x', 'y', 'r', 'duration', 'src', 'ability', 'delay'],
  ['effect', 'el', 'shape', 'x', 'y', 'r', 'fx', 'fy', 'duration', 'src', 'ability'],
  ['effect', 'el', 'shape', 'x', 'y', 'r', 'fx', 'fy', 'duration', 'src', 'ability', 'delay'],
  ['effect', 'el', 'shape', 'x', 'y', 'r', 'points', 'duration', 'src', 'ability'],
  ['spawn', 'id', 't', 'o'],
  ['construction', 'id', 't', 'o'],
  ['buildingComplete', 'id', 't', 'o'],
  ['treeFelled', 'tx', 'ty'],
  ['levelUp', 'id', 'level'],
  ['resourceDepleted', 'id'],
  ['error', 'player', 'message'],
  ['underAttack', 'player', 'x', 'y', 'id'],
  ['bounty', 'player', 'amount', 'x', 'y'],
  ['tierUp', 'player', 'tier'],
  ['titanSummoning', 'player', 't'],
  ['playerDefeated', 'player'],
  ['gameOver', 'winningTeam'],
  ['researched', 'player', 'up'],
  ['trade', 'from', 'to', 'res', 'amt', 'got'],
  ['rankUp', 'id', 'rank'],
  ['peaceEnd'],
  ['bounty', 'player', 'amount', 'x', 'y', 'res'],
  ['siteCaptured', 'site', 'player'],
  ['siteLost', 'site', 'player'],
  ['sacredHold', 'team', 'end'],
  ['sacredBroken', 'team'],
  ['gameOver', 'winningTeam', 'how'],
  ['wave', 'n', 'count', 'boss', 'x', 'y'], // Trial of the Titans (DESIGN 5.14)
  ['waveCleared', 'n', 'gold'],
  ['godPower', 'player', 'power', 'x', 'y'],
].map(([type, ...keys]) => ({ type, keys }));
const SHAPES_BY_TYPE = new Map();
EVENT_SHAPES.forEach((s, code) => {
  if (!SHAPES_BY_TYPE.has(s.type)) SHAPES_BY_TYPE.set(s.type, []);
  SHAPES_BY_TYPE.get(s.type).push({ code, keys: s.keys });
});

/** Pack one event (see EVENT_SHAPES). */
function packEvent(ev) {
  if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) return [-1, ev];
  const shapes = typeof ev.type === 'string' ? SHAPES_BY_TYPE.get(ev.type) : undefined;
  if (!shapes) return ev;
  let n = 0;
  for (const k in ev) {
    if (ev[k] === undefined) return ev;
    n++;
  }
  for (const s of shapes) {
    if (s.keys.length !== n - 1) continue;
    let ok = true;
    for (const k of s.keys) {
      if (!hasOwn.call(ev, k)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const out = new Array(n);
    out[0] = s.code;
    for (let i = 0; i < s.keys.length; i++) out[i + 1] = ev[s.keys[i]];
    return out;
  }
  return ev;
}

/** Inverse of packEvent. */
function unpackEvent(p) {
  if (!Array.isArray(p)) return p;
  if (p[0] === -1) return p[1];
  const s = EVENT_SHAPES[p[0]];
  if (!s) throw new Error(`delta: unknown event shape ${p[0]}`);
  const ev = { type: s.type };
  for (let i = 0; i < s.keys.length; i++) ev[s.keys[i]] = p[i + 1];
  return ev;
}

/** Value in hundredths if `v` is an exact hundredth (k / 100 === v), else null. */
function hundredths(v) {
  if (typeof v !== 'number') return null;
  const k = Math.round(v * 100);
  return k / 100 === v && k <= 1e15 && k >= -1e15 ? k : null;
}

/**
 * Own keys of `b` if `a` has exactly the same keys in the same order, all usable
 * in paths and none undefined (JSON would drop it), else null. Keeping the order
 * matters: a nested key longer than 2 characters travels as its position ('~i')
 * in the object, which both sides resolve in the same key order.
 */
function sameKeyOrder(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return null;
  for (let i = 0; i < kb.length; i++) {
    const k = kb[i];
    if (ka[i] !== k || !plainKey(k) || a[k] === undefined || b[k] === undefined) return null;
  }
  return kb;
}

/**
 * Emit the changes turning `a` into `b` (known to differ) at `path`: nested
 * objects with the same keys (same order) and arrays of the same length are
 * descended into, anything else is emitted whole.
 */
function diffValue(path, a, b, depth, sink, id) {
  if (depth < MAX_DEPTH && a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a)) {
      if (Array.isArray(b) && a.length === b.length) {
        for (let i = 0; i < b.length; i++) if (a[i] !== b[i] && !same(a[i], b[i])) diffValue(`${path}.${i}`, a[i], b[i], depth + 1, sink, id);
        return;
      }
    } else if (!Array.isArray(b)) {
      const keys = sameKeyOrder(a, b);
      if (keys) {
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (a[k] !== b[k] && !same(a[k], b[k])) diffValue(`${path}.${k.length > 2 ? `~${i}` : k}`, a[k], b[k], depth + 1, sink, id);
        }
        return;
      }
    }
  }
  sink.add(path, id, b);
}

/** Column sink: { path: [idGap, value, …] } with per-column id gaps. */
class Columns {
  constructor() {
    this.cols = new Map();
    this.n = 0;
  }

  add(path, id, value) {
    let col = this.cols.get(path);
    if (!col) this.cols.set(path, (col = { last: 0, data: [] }));
    col.data.push(id - col.last, value);
    col.last = id;
    this.n++;
  }

  toJSON() {
    const out = {};
    for (const [path, col] of this.cols) out[path] = col.data;
    return out;
  }
}

/** Object sink: { path: value } (players). */
class PathObject {
  constructor() {
    this.obj = {};
  }

  add(path, id, value) {
    this.obj[path] = value;
  }
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
  const d = { b: prev ? prev.tick : -1 };
  if (next.tick !== d.b + 1) d.tick = next.tick;
  d.time = next.time;

  // ---- entities
  const prevIdx = indexOf(base);
  const nextEnts = next.entities || [];
  const added = [];
  const m = [];
  const mf = [];
  let mLast = 0;
  let mfLast = 0;
  const cols = new Columns();
  const cr = [];
  const cx = [];
  const nextIds = new Set();
  for (const e of nextEnts) {
    const id = e.id;
    nextIds.add(id);
    const pe = prevIdx.get(id);
    if (!pe) {
      added.push(e);
      continue;
    }
    if (pe === e) continue;
    // First pass: which keys changed, and can this entity use the column format?
    // (A key whose value is undefined counts as absent, as in JSON.)
    let changed = null;
    let simple = true;
    for (const k in e) {
      const v = e[k];
      const pv = pe[k];
      if (v === pv || v === undefined || (hasOwn.call(pe, k) && same(pv, v))) continue;
      (changed || (changed = [])).push(k);
      if (!plainKey(k)) simple = false;
    }
    let rm = null;
    for (const k in pe) {
      if (!hasOwn.call(e, k) || (e[k] === undefined && pe[k] !== undefined)) {
        (rm || (rm = [])).push(k);
        if (!plainKey(k)) simple = false;
      }
    }
    if (!changed && !rm) continue;
    if (!simple || !Number.isSafeInteger(id)) {
      const ch = {};
      if (changed) for (const k of changed) setKey(ch, k, e[k]);
      cx.push(rm ? [id, ch, rm] : [id, ch]);
      continue;
    }
    if (rm) cr.push([id, rm]);
    if (!changed) continue;
    // Movement: quantized x / y (/ f) deltas when the values are exact hundredths.
    let mx = false;
    let my = false;
    let mfc = false;
    for (const k of changed) {
      if (k === 'x') mx = true;
      else if (k === 'y') my = true;
      else if (k === 'f') mfc = true;
    }
    let moved = false;
    if (mx && my) {
      const kx = hundredths(e.x);
      const ky = hundredths(e.y);
      const kpx = hundredths(pe.x);
      const kpy = hundredths(pe.y);
      if (kx !== null && ky !== null && kpx !== null && kpy !== null) {
        if (!mfc) {
          m.push(id - mLast, kx - kpx, ky - kpy);
          mLast = id;
          moved = true;
        } else {
          const kf = hundredths(e.f);
          const kpf = hundredths(pe.f);
          if (kf !== null && kpf !== null) {
            mf.push(id - mfLast, kx - kpx, ky - kpy, kf - kpf);
            mfLast = id;
            moved = true;
          }
        }
      }
    }
    for (const k of changed) {
      if (k === 'x' || k === 'y' || k === 'f') {
        if (moved) continue;
        const kv = hundredths(e[k]);
        const kp = hundredths(pe[k]);
        if (kv !== null && kp !== null) {
          cols.add(`+${k}`, id, kv - kp);
          continue;
        }
      }
      if (hasOwn.call(pe, k)) diffValue(k, pe[k], e[k], 1, cols, id);
      else cols.add(k, id, e[k]);
    }
  }
  const removed = [];
  for (const pe of base.entities) if (!nextIds.has(pe.id)) removed.push(pe.id);
  if (added.length) d.a = added;
  if (m.length) d.m = m;
  if (mf.length) d.mf = mf;
  if (cols.n) d.c = cols.toJSON();
  if (cr.length) d.cr = cr;
  if (cx.length) d.cx = cx;
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
    const pw = [];
    for (let i = 0; i < np.length; i++) {
      const a = pp[i];
      const b = np[i];
      if (a === b || same(a, b)) continue;
      const patch = playerPatch(a, b);
      if (patch) pch.push(patch[1] ? [i, patch[0], patch[1]] : [i, patch[0]]);
      else pw.push([i, b]);
    }
    if (pch.length) d.p = pch;
    if (pw.length) d.pw = pw;
  }

  // ---- per-snapshot lists
  if (next.events && next.events.length) d.e = next.events.map(packEvent);
  if (next.felled && next.felled.length) d.fl = next.felled;

  // ---- everything else (fields, reveals, gameOver, future keys)
  let x = null;
  for (const key in next) {
    if (SPECIAL.has(key)) continue;
    if (!hasOwn.call(base, key) || !same(base[key], next[key])) setKey(x || (x = {}), key, next[key]);
  }
  if (x) d.x = x;
  let xr = null;
  for (const key in base) if (!SPECIAL.has(key) && !hasOwn.call(next, key)) (xr || (xr = [])).push(key);
  if (xr) d.xr = xr;
  return d;
}

/** [pathObject, removedKeys | null] turning player `a` into `b`, or null to send `b` whole. */
function playerPatch(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return null;
  const sink = new PathObject();
  for (const k in b) {
    const v = b[k];
    const pv = a[k];
    if (v === pv || v === undefined || (hasOwn.call(a, k) && same(pv, v))) continue;
    if (!plainKey(k)) return null;
    if (hasOwn.call(a, k)) diffValue(k, pv, v, 1, sink, 0);
    else sink.obj[k] = v;
  }
  let rm = null;
  for (const k in a) {
    if (hasOwn.call(b, k) && !(b[k] === undefined && a[k] !== undefined)) continue;
    if (!plainKey(k)) return null;
    (rm || (rm = [])).push(k);
  }
  return [sink.obj, rm];
}

const pathCache = new Map();
function splitPath(path) {
  let segs = pathCache.get(path);
  if (!segs) {
    if (pathCache.size > 4096) pathCache.clear();
    segs = path.split('.');
    pathCache.set(path, segs);
  }
  return segs;
}

/** Copy of a nested container (never mutate the base snapshot's objects). */
function copyOf(v) {
  if (Array.isArray(v)) return v.slice();
  if (v !== null && typeof v === 'object') return { ...v };
  throw new Error('delta: path through a non-object');
}

function setKey(obj, key, value) {
  if (key === '__proto__') Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
  else obj[key] = value;
}

/** The real key for a path segment: '~i' is the i-th own key of `obj`. */
function keyOf(obj, seg) {
  if (seg === '__proto__') throw new Error('delta: bad path');
  if (seg[0] !== '~') return seg;
  const k = Object.keys(obj)[Number(seg.slice(1))];
  if (k === undefined) throw new Error(`delta: no key ${seg}`);
  return k;
}

/** Set `value` at a dotted path inside `root` (an owned copy), copying shared containers on the way. */
function setPath(root, path, value, owned) {
  if (path.indexOf('.') < 0) {
    setKey(root, keyOf(root, path), value);
    return;
  }
  const segs = splitPath(path);
  let obj = root;
  for (let s = 0; s < segs.length - 1; s++) {
    const seg = keyOf(obj, segs[s]);
    let child = obj[seg];
    if (!owned.has(child)) {
      child = copyOf(child);
      obj[seg] = child;
      owned.add(child);
    }
    obj = child;
  }
  setKey(obj, keyOf(obj, segs[segs.length - 1]), value);
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
  const prevIdx = d.m || d.mf || d.c || d.cr || d.cx ? indexOf(base) : null;
  const clones = new Map();
  const owned = new Set();
  const get = (id) => {
    let ne = clones.get(id);
    if (!ne) {
      const pe = prevIdx.get(id);
      if (!pe) throw new Error(`delta: unknown entity ${id}`);
      ne = { ...pe };
      clones.set(id, ne);
    }
    return ne;
  };
  if (d.m) {
    const m = d.m;
    let id = 0;
    for (let i = 0; i < m.length; i += 3) {
      id += m[i];
      const ne = get(id);
      ne.x = (Math.round(ne.x * 100) + m[i + 1]) / 100;
      ne.y = (Math.round(ne.y * 100) + m[i + 2]) / 100;
    }
  }
  if (d.mf) {
    const m = d.mf;
    let id = 0;
    for (let i = 0; i < m.length; i += 4) {
      id += m[i];
      const ne = get(id);
      ne.x = (Math.round(ne.x * 100) + m[i + 1]) / 100;
      ne.y = (Math.round(ne.y * 100) + m[i + 2]) / 100;
      ne.f = (Math.round(ne.f * 100) + m[i + 3]) / 100;
    }
  }
  if (d.c) {
    for (const path in d.c) {
      const col = d.c[path];
      let id = 0;
      if (path[0] === '+') {
        const key = keyOf(null, path.slice(1));
        for (let i = 0; i < col.length; i += 2) {
          id += col[i];
          const ne = get(id);
          ne[key] = (Math.round(ne[key] * 100) + col[i + 1]) / 100;
        }
        continue;
      }
      for (let i = 0; i < col.length; i += 2) {
        id += col[i];
        setPath(get(id), path, col[i + 1], owned);
      }
    }
  }
  if (d.cr) {
    for (const [id, keys] of d.cr) {
      const ne = get(id);
      for (const key of keys) delete ne[key];
    }
  }
  if (d.cx) {
    for (const c of d.cx) {
      const ne = get(c[0]);
      if (c[1]) for (const key in c[1]) setKey(ne, key, c[1][key]);
      if (c[2]) for (const key of c[2]) delete ne[key];
    }
  }
  const ents = [];
  for (const pe of base.entities) {
    if (removed && removed.has(pe.id)) continue;
    ents.push(clones.get(pe.id) || pe);
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
    if (d.p) {
      for (const [i, patch, rm] of d.p) {
        if (!Number.isInteger(i) || i < 0 || i >= players.length) throw new Error(`delta: bad player ${i}`);
        const np = { ...players[i] };
        for (const path in patch) setPath(np, path, patch[path], owned);
        if (rm) for (const key of rm) delete np[key];
        players[i] = np;
      }
    }
    if (d.pw) {
      for (const [i, p] of d.pw) {
        if (!Number.isInteger(i) || i < 0 || i >= players.length) throw new Error(`delta: bad player ${i}`);
        players[i] = p;
      }
    }
  }

  const out = {};
  for (const key in base) if (!SPECIAL.has(key)) setKey(out, key, base[key]);
  if (d.xr) for (const key of d.xr) delete out[key];
  if (d.x) for (const key in d.x) setKey(out, key, d.x[key]);
  out.tick = d.tick ?? d.b + 1;
  out.time = d.time;
  out.players = players;
  out.entities = entities;
  out.events = d.e ? d.e.map(unpackEvent) : [];
  out.felled = d.fl || [];
  return out;
}

/** Ids of every entity, in order (handy for tests and debugging). */
export function entityIds(snap) {
  return snap.entities.map((e) => e.id);
}
