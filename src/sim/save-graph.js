// Object-graph serializer for saved games (DESIGN 9.4). Turns a live object graph (the World,
// its entities, the AIs) into plain JSON data and back, keeping what JSON loses:
//   - identity: an object reached twice (a unit in unitList and in entities) comes back as one
//     object, and cycles (an AI's world, the world's players) survive;
//   - Maps, Sets, typed arrays, undefined, NaN, ±Infinity and -0;
//   - class instances: each class is restored onto its own prototype (the classes table);
//   - statics: objects that belong to the code, not to the match (unit and building data, the
//     generated map): stored as a name and looked up again on load, never copied.
// Functions cannot be saved: packing one throws with the path to it, so a test finds any new
// piece of state that would not survive a save.
//
//   const data = packGraph(root, { classes, statics });  // JSON-safe
//   const root = unpackGraph(data, { classes, statics });
//
// classes: { Name: Class } or { Name: { cls, skip: ['field'], revive(obj) } } (skip: fields left
// out of the save, such as scratch buffers; revive rebuilds them after loading).
// statics: Map(object -> name), see staticTable.

const TYPED = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

/** Bytes as base64 (no padding needed on the way back: the length is stored). */
export function toBase64(bytes) {
  let out = '';
  const n = bytes.length;
  const chunk = [];
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i];
    const b = i + 1 < n ? bytes[i + 1] : 0;
    const c = i + 2 < n ? bytes[i + 2] : 0;
    chunk.push(B64[a >> 2], B64[((a & 3) << 4) | (b >> 4)], i + 1 < n ? B64[((b & 15) << 2) | (c >> 6)] : '=', i + 2 < n ? B64[c & 63] : '=');
    if (chunk.length >= 4096) {
      out += chunk.join('');
      chunk.length = 0;
    }
  }
  return out + chunk.join('');
}

/** base64 back to bytes. */
export function fromBase64(str) {
  let len = (str.length / 4) * 3;
  if (str.endsWith('==')) len -= 2;
  else if (str.endsWith('=')) len -= 1;
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < str.length; i += 4) {
    const a = B64_INDEX[str.charCodeAt(i)];
    const b = B64_INDEX[str.charCodeAt(i + 1)];
    const c = B64_INDEX[str.charCodeAt(i + 2)];
    const d = B64_INDEX[str.charCodeAt(i + 3)];
    if (o < len) out[o++] = (a << 2) | (b >> 4);
    if (o < len) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (o < len) out[o++] = ((c & 3) << 6) | d;
  }
  return out;
}

/**
 * Name every object reachable from the given roots: { name: root } -> Map(object -> 'name.path').
 * Walks plain objects, arrays and Maps (functions are skipped); the first path found wins.
 */
export function staticTable(roots) {
  const table = new Map();
  const walk = (v, path, depth) => {
    if (!v || typeof v !== 'object' || table.has(v) || depth > 12) return;
    if (ArrayBuffer.isView(v)) {
      table.set(v, path);
      return;
    }
    table.set(v, path);
    if (v instanceof Map) {
      for (const [k, x] of v) if (typeof k === 'string' || typeof k === 'number') walk(x, `${path}.<${k}>`, depth + 1);
      return;
    }
    if (v instanceof Set) return;
    for (const k of Object.keys(v)) {
      let x;
      try {
        x = v[k];
      } catch {
        continue;
      }
      walk(x, `${path}.${k}`, depth + 1);
    }
  };
  for (const [name, root] of Object.entries(roots)) walk(root, name, 0);
  return table;
}

function classEntries(classes) {
  const byCtor = new Map();
  const byName = new Map();
  for (const [name, c] of Object.entries(classes || {})) {
    const entry = typeof c === 'function' ? { name, cls: c, skip: null, revive: null } : { name, cls: c.cls, skip: c.skip ? new Set(c.skip) : null, revive: c.revive || null };
    byCtor.set(entry.cls.prototype, entry);
    byName.set(name, entry);
  }
  return { byCtor, byName };
}

/** Pack a graph into JSON-safe data. Throws on a function or an unknown class (with the path). */
export function packGraph(root, { classes = {}, statics = new Map() } = {}) {
  const { byCtor } = classEntries(classes);
  const ids = new Map();
  const objs = [];
  const queue = [];

  const ref = (v, path) => {
    if (v === undefined) return { u: 1 };
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return { n: 'NaN' };
      if (v === Infinity) return { n: 'Inf' };
      if (v === -Infinity) return { n: '-Inf' };
      if (v === 0 && 1 / v < 0) return { n: '-0' };
      return v;
    }
    if (typeof v === 'function') throw new Error(`save: a function at ${path}`);
    if (typeof v === 'bigint' || typeof v === 'symbol') throw new Error(`save: a ${typeof v} at ${path}`);
    const s = statics.get(v);
    if (s !== undefined) return { s };
    let id = ids.get(v);
    if (id === undefined) {
      id = objs.length;
      ids.set(v, id);
      objs.push(null);
      queue.push([v, id, path]);
    }
    return { r: id };
  };

  const top = ref(root, 'root');
  for (let q = 0; q < queue.length; q++) {
    const [v, id, path] = queue[q];
    if (Array.isArray(v)) {
      const a = new Array(v.length);
      for (let i = 0; i < v.length; i++) a[i] = ref(v[i], `${path}[${i}]`);
      objs[id] = { a };
    } else if (v instanceof Map) {
      const m = [];
      let i = 0;
      for (const [k, x] of v) {
        m.push([ref(k, `${path}.<key ${i}>`), ref(x, `${path}.<${typeof k === 'object' ? i : k}>`)]);
        i++;
      }
      objs[id] = { m };
    } else if (v instanceof Set) {
      const S = [];
      let i = 0;
      for (const x of v) S.push(ref(x, `${path}.{${i++}}`));
      objs[id] = { S };
    } else if (ArrayBuffer.isView(v)) {
      const name = v.constructor && v.constructor.name;
      if (!TYPED[name]) throw new Error(`save: an unsupported ${name} at ${path}`);
      objs[id] = { t: name, n: v.length, b: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    } else {
      const proto = Object.getPrototypeOf(v);
      let entry = null;
      if (proto !== Object.prototype && proto !== null) {
        entry = byCtor.get(proto);
        if (!entry) throw new Error(`save: an object of class ${proto && proto.constructor ? proto.constructor.name : '?'} at ${path}`);
      }
      const o = {};
      for (const k of Object.keys(v)) {
        if (entry && entry.skip && entry.skip.has(k)) continue;
        o[k] = ref(v[k], `${path}.${k}`);
      }
      objs[id] = entry ? { c: entry.name, o } : { o };
    }
  }
  return { root: top, objs };
}

/** Rebuild a graph from packGraph's data, with the same classes and statics (by name). */
export function unpackGraph(data, { classes = {}, statics = new Map() } = {}) {
  const { byName } = classEntries(classes);
  const byPath = new Map();
  for (const [obj, name] of statics) byPath.set(name, obj);
  const objs = data.objs;
  const out = new Array(objs.length);
  // First make every object (so references can point anywhere), then fill them in.
  for (let i = 0; i < objs.length; i++) {
    const e = objs[i];
    if (e.a) out[i] = new Array(e.a.length);
    else if (e.m) out[i] = new Map();
    else if (e.S) out[i] = new Set();
    else if (e.t) {
      const T = TYPED[e.t];
      if (!T) throw new Error(`load: an unknown array type ${e.t}`);
      const bytes = fromBase64(e.b);
      const arr = new T(e.n);
      new Uint8Array(arr.buffer).set(bytes.subarray(0, arr.byteLength));
      out[i] = arr;
    } else if (e.c) {
      const entry = byName.get(e.c);
      if (!entry) throw new Error(`load: an unknown class ${e.c}`);
      out[i] = Object.create(entry.cls.prototype);
    } else out[i] = {};
  }
  const val = (x) => {
    if (x === null || typeof x !== 'object') return x;
    if ('r' in x) return out[x.r];
    if ('s' in x) {
      if (!byPath.has(x.s)) throw new Error(`load: the game no longer has ${x.s}`);
      return byPath.get(x.s);
    }
    if ('u' in x) return undefined;
    if (x.n === 'NaN') return NaN;
    if (x.n === 'Inf') return Infinity;
    if (x.n === '-Inf') return -Infinity;
    if (x.n === '-0') return -0;
    throw new Error('load: a damaged value');
  };
  const revive = [];
  for (let i = 0; i < objs.length; i++) {
    const e = objs[i];
    const o = out[i];
    if (e.a) for (let k = 0; k < e.a.length; k++) o[k] = val(e.a[k]);
    else if (e.m) for (const [k, v] of e.m) o.set(val(k), val(v));
    else if (e.S) for (const v of e.S) o.add(val(v));
    else if (e.o) {
      for (const k of Object.keys(e.o)) o[k] = val(e.o[k]);
      if (e.c) {
        const entry = byName.get(e.c);
        if (entry.revive) revive.push([entry, o]);
      }
    }
  }
  for (const [entry, o] of revive) entry.revive(o);
  return val(data.root);
}
