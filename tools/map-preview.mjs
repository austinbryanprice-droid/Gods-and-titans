#!/usr/bin/env node
// Render generated maps to PNG for visual checks.
//
//   node tools/map-preview.mjs --seeds 1,2,3 --sizes small,medium --players 2,4 [--landscapes classic,islands] [--teams 1,1,2,2]
//     [--out DIR] [--scale 4] [--sheet] [--no-decor] [--heights]
//
// One PNG per (seed, size, players) combination, or with --sheet a single
// contact sheet (one row per size/player combination). Terrain is shaded by
// the cosmetic heights; starts are drawn in player colors, gold mines in gold,
// creep camps as rings (yellow level 1, orange 2, red 3). --heights renders the
// cosmetic height field instead (grayscale 0..0.8, water in blue). Prints per-map stats:
// generation time, mapHash, layout, wood near each start and distance to its
// nearest expansion.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateMap, mapHash, validateMap } from '../src/sim/mapgen.js';
import { TERRAIN, PLAYER_COLORS, MAP_SIZES } from '../src/config.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const list = (s) => String(s).split(',').map((v) => v.trim()).filter(Boolean);

const seeds = list(opt('seeds', '1,2,3')).map((s) => (/^-?\d+$/.test(s) ? Number(s) : s));
const sizes = list(opt('sizes', 'small,medium'));
const players = list(opt('players', '2,3,4')).map(Number);
const landscapes = list(opt('landscapes', 'classic'));
const outDir = opt('out', join(tmpdir(), 'mythicwar-map-previews'));
const scale = Number(opt('scale', '4'));
const sheet = flag('sheet');
const showDecor = !flag('no-decor');
const heightsOnly = flag('heights');

// ---- minimal PNG writer ----
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy ? rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
      : raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- drawing ----
class Canvas {
  constructor(w, h, bg = [24, 24, 28]) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.px.set(bg, i * 3);
  }

  set(x, y, c, a = 1) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(this.px[i + k] * (1 - a) + c[k] * a);
  }

  rect(x, y, w, h, c, a = 1) {
    for (let yy = Math.floor(y); yy < Math.ceil(y + h); yy++) for (let xx = Math.floor(x); xx < Math.ceil(x + w); xx++) this.set(xx, yy, c, a);
  }

  outline(x, y, w, h, c, t = 1) {
    this.rect(x, y, w, t, c);
    this.rect(x, y + h - t, w, t, c);
    this.rect(x, y, t, h, c);
    this.rect(x + w - t, y, t, h, c);
  }

  disc(cx, cy, r, c, a = 1) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.set(x, y, c, a);
      }
    }
  }

  ring(cx, cy, r, t, c) {
    for (let y = Math.floor(cy - r - t); y <= Math.ceil(cy + r + t); y++) {
      for (let x = Math.floor(cx - r - t); x <= Math.ceil(cx + r + t); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r + t / 2 && d >= r - t / 2) this.set(x, y, c);
      }
    }
  }
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const COLORS = {
  [TERRAIN.GRASS]: [96, 150, 62],
  [TERRAIN.DIRT]: [150, 120, 76],
  [TERRAIN.WATER]: [44, 104, 170],
  [TERRAIN.FOREST]: [34, 82, 38],
  [TERRAIN.ROCK]: [128, 124, 116],
  [TERRAIN.SAND]: [214, 196, 138],
};
const DECOR_COLORS = { rock: [170, 170, 165], bush: [60, 120, 50], flowers: [235, 120, 200], ruin: [210, 205, 190], stump: [110, 80, 50], grass: [130, 180, 80] };
const CAMP_COLORS = { 1: [255, 230, 60], 2: [255, 150, 30], 3: [235, 40, 40] };

function drawHeights(cv, map, ox, oy, s) {
  const V = map.width + 1;
  for (let y = 0; y < V * s; y++) {
    for (let x = 0; x < V * s; x++) {
      const h = map.heights[Math.floor(y / s) * V + Math.floor(x / s)];
      const v = h < 0 ? [30, 60 + 80 * (h + 0.6), 140 + 100 * (h + 0.6)] : [255 * (h / 0.8), 255 * (h / 0.8), 255 * (h / 0.8)];
      cv.set(ox + x, oy + y, v);
    }
  }
}

function drawMap(cv, map, ox, oy, s) {
  if (heightsOnly) return drawHeights(cv, map, ox, oy, s);
  const n = map.width;
  const V = n + 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const t = map.terrain[y * n + x];
      const hs = map.heights;
      const h = (hs[y * V + x] + hs[y * V + x + 1] + hs[(y + 1) * V + x] + hs[(y + 1) * V + x + 1]) / 4;
      // light from the north-west using the height gradient
      const gx = hs[y * V + x + 1] + hs[(y + 1) * V + x + 1] - hs[y * V + x] - hs[(y + 1) * V + x];
      const gy = hs[(y + 1) * V + x] + hs[(y + 1) * V + x + 1] - hs[y * V + x] - hs[y * V + x + 1];
      let shade = 0.88 + 0.22 * Math.max(-0.6, Math.min(0.8, h)) - 0.5 * (gx + gy);
      if (t === TERRAIN.WATER) shade = 0.75 + 0.4 * (h + 0.6);
      const c = COLORS[t].map((v) => Math.max(0, Math.min(255, v * shade)));
      cv.rect(ox + x * s, oy + y * s, s, s, c);
      if (t === TERRAIN.FOREST && s >= 3 && ((x * 7 + y * 13) % 3 === 0)) cv.disc(ox + x * s + s / 2, oy + y * s + s / 2, s * 0.32, [22, 60, 26]);
    }
  }
  if (showDecor && s >= 3) {
    for (const d of map.decor) cv.set(ox + d.x * s, oy + d.y * s, DECOR_COLORS[d.kind] || [255, 255, 255]);
  }
  map.mines.forEach((m, i) => {
    cv.rect(ox + m.tx * s, oy + m.ty * s, 3 * s, 3 * s, i < map.starts.length ? [255, 214, 40] : [255, 190, 0]);
    cv.outline(ox + m.tx * s, oy + m.ty * s, 3 * s, 3 * s, [90, 60, 0], Math.max(1, s >> 2));
  });
  map.starts.forEach((st, p) => {
    cv.rect(ox + st.x * s, oy + st.y * s, 4 * s, 4 * s, hex(PLAYER_COLORS[p]));
    cv.outline(ox + st.x * s, oy + st.y * s, 4 * s, 4 * s, [255, 255, 255], Math.max(1, s >> 2));
  });
  for (const c of map.camps) {
    cv.ring(ox + c.x * s, oy + c.y * s, 1.6 * s, Math.max(2, s * 0.5), CAMP_COLORS[c.level]);
    cv.disc(ox + c.x * s, oy + c.y * s, 0.5 * s, CAMP_COLORS[c.level]);
  }
}

function stats(map) {
  const n = map.width;
  const out = [];
  map.starts.forEach((st, p) => {
    const cx = st.x + 2;
    const cy = st.y + 2;
    let wood = 0;
    let nearest = Infinity;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (map.terrain[y * n + x] !== TERRAIN.FOREST) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= 12) wood += map.wood[y * n + x];
        nearest = Math.min(nearest, d);
      }
    }
    let exp = Infinity;
    for (let i = map.starts.length; i < map.mines.length; i++) {
      const m = map.mines[i];
      exp = Math.min(exp, Math.hypot(m.tx + 1.5 - cx, m.ty + 1.5 - cy));
    }
    out.push(`p${p}: wood12=${wood} forest@${nearest.toFixed(1)} exp@${exp.toFixed(1)}`);
  });
  return out.join(' | ');
}

mkdirSync(outDir, { recursive: true });
const teams = opt('teams', null) ? list(opt('teams')).map(Number) : null;
const rows = [];
for (const landscape of landscapes) for (const size of sizes) {
  for (const pc of players) {
    const row = [];
    for (const seed of seeds) {
      const t0 = performance.now();
      const map = generateMap({ seed, mapSize: size, playerCount: pc, landscape, teams: teams && teams.length === pc ? teams : null });
      const ms = performance.now() - t0;
      const problems = validateMap(map);
      const counts = {};
      for (const t of map.terrain) counts[t] = (counts[t] || 0) + 1;
      const pct = (code) => ((100 * (counts[code] || 0)) / map.terrain.length).toFixed(0);
      console.log(
        `${landscape} ${size} p${pc} seed=${seed} ${ms.toFixed(1)}ms hash=${mapHash(map)} sym=${map.meta.symmetry} center=${map.meta.center}` +
        ` lakes=${map.meta.lakes} mines=${map.mines.length} camps=${map.camps.length} decor=${map.decor.length}` +
        ` forest=${pct(TERRAIN.FOREST)}% water=${pct(TERRAIN.WATER)}% ${problems.length ? 'PROBLEMS: ' + problems.slice(0, 4).join('; ') : 'ok'}`,
      );
      console.log(`    ${stats(map)}`);
      row.push({ map, seed, size, pc, landscape });
    }
    rows.push(row);
  }
}

if (sheet) {
  const pad = 8;
  const cell = Math.max(...Object.values(MAP_SIZES)) * scale;
  const cols = seeds.length;
  const cv = new Canvas(cols * (cell + pad) + pad, rows.length * (cell + pad) + pad);
  rows.forEach((row, r) => row.forEach(({ map }, c) => drawMap(cv, map, pad + c * (cell + pad), pad + r * (cell + pad), scale)));
  const file = join(outDir, `sheet-${landscapes.join('_')}-${sizes.join('_')}-p${players.join('_')}.png`);
  writeFileSync(file, encodePNG(cv.w, cv.h, cv.px));
  console.log(`wrote ${file}`);
} else {
  for (const row of rows) {
    for (const { map, seed, size, pc, landscape } of row) {
      const cv = new Canvas(map.width * scale, map.height * scale);
      drawMap(cv, map, 0, 0, scale);
      const file = join(outDir, `map-${landscape}-${size}-p${pc}-s${seed}.png`);
      writeFileSync(file, encodePNG(cv.w, cv.h, cv.px));
      console.log(`wrote ${file}`);
    }
  }
}
