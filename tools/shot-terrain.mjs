#!/usr/bin/env node
// Matched stills of terrain and water for graphics work (render harness, manual clock, so
// every run draws the same frame). It finds the lakes, shores, rock outcrops and hills of
// the map itself, then shoots a fixed set of camera setups at one quality tier.
//
//   node tools/shot-terrain.mjs [--port 8321] [--out DIR] [--prefix before] [--quality medium]
//        [--scenes lake,shore,...] [--width 1600] [--height 900] [--seed 4242]
//        [--time noon] [--list]
//
// Scenes: lake (default zoom on the largest lake), shore (near shore, close), far (zoomed
// out over the lake and its sand ring), rocks (an impassable rock cluster), hills (the
// highest meadow), base (home base on its ground), dock (lake edge by the base, mid zoom).
// --time picks a time of day once the renderer has one (dawn, noon, dusk, night or hours
// such as 18.5). High and ultra can take a minute a frame under software GL: use a smaller
// --width / --height for those, or --timeout 600000 for more patience.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', '8321'));
const out = opt('out', join(tmpdir(), 'mythicwar-terrain'));
const prefix = opt('prefix', 'shot');
const quality = opt('quality', 'medium');
const seed = Number(opt('seed', '4242'));
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '900'));
const timeOfDay = opt('time', '');
const timeout = Number(opt('timeout', '300000'));
const ALL = ['lake', 'shore', 'far', 'rocks', 'hills', 'base', 'dock'];
const scenes = opt('scenes', '') ? opt('scenes', '').split(',') : ALL;
if (args.includes('--list')) { console.log(ALL.join('\n')); process.exit(0); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(out, { recursive: true });

const server = spawn(join(root, 'node_modules/.bin/http-server'), ['.', '-p', String(port), '-c-1', '--silent'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height } });
page.setDefaultTimeout(timeout);
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text()); });

try {
  await page.goto(`http://localhost:${port}/tools/render-harness.html?manual=1&scenario=base&reveal=1&seed=${seed}&quality=${quality}${timeOfDay ? `&time=${encodeURIComponent(timeOfDay)}` : ''}`);
  await page.waitForFunction(() => window.harness && window.harness.ready === true, null, { timeout });
  // where things are, from the map itself
  const spots = await page.evaluate(() => {
    const map = window.harness.world.mapData;
    const W = map.width;
    const H = map.height;
    const T = map.terrain;
    const WATER = 2;
    const ROCK = 4;
    // lakes: 4-connected water components, biggest first
    const seen = new Uint8Array(W * H);
    const lakes = [];
    for (let i = 0; i < W * H; i++) {
      if (T[i] !== WATER || seen[i]) continue;
      const q = [i];
      seen[i] = 1;
      const tiles = [];
      while (q.length) {
        const c = q.pop();
        tiles.push(c);
        const x = c % W;
        const y = (c / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (T[n] === WATER && !seen[n]) { seen[n] = 1; q.push(n); }
        }
      }
      lakes.push(tiles);
    }
    lakes.sort((a, b) => b.length - a.length);
    const info = (tiles) => {
      let sx = 0; let sy = 0; let minY = 1e9; let maxY = -1e9;
      for (const c of tiles) { sx += c % W; sy += (c / W) | 0; minY = Math.min(minY, (c / W) | 0); maxY = Math.max(maxY, (c / W) | 0); }
      return { cx: sx / tiles.length + 0.5, cy: sy / tiles.length + 0.5, minY, maxY, tiles };
    };
    const base = window.harness.world.buildingsOf(0).find((b) => b.type === 'town_center');
    // the lake closest to the home base is the one players actually see
    const infos = lakes.slice(0, 4).map(info);
    infos.sort((a, b) => Math.hypot(a.cx - base.x, a.cy - base.y) - Math.hypot(b.cx - base.x, b.cy - base.y));
    const lake = infos[0];
    const big = lakes.length ? info(lakes[0]) : lake;
    // south shore of the lake: the southernmost water tile near its x center, camera looks north
    let south = null;
    for (const c of lake.tiles) {
      const x = c % W;
      const y = (c / W) | 0;
      if (Math.abs(x + 0.5 - lake.cx) < 2.5 && (!south || y > south.y)) south = { x: x + 0.5, y: y + 1.5 };
    }
    // rock cluster: the impassable rock tile with the most rock neighbours
    let rock = null;
    let rockN = -1;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (T[y * W + x] !== ROCK) continue;
        let n = 0;
        for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (T[(y + oy) * W + x + ox] === ROCK) n++;
        // prefer clusters away from the map edge, nearest the base
        const d = Math.hypot(x - base.x, y - base.y);
        const score = n * 10 - d * 0.1;
        if (score > rockN) { rockN = score; rock = { x: x + 0.5, y: y + 1.5 }; }
      }
    }
    // highest meadow: the vertex window with the largest mean height away from the map border
    let hill = null;
    let hillH = -1;
    const VW = W + 1;
    for (let y = 8; y < H - 8; y += 2) {
      for (let x = 8; x < W - 8; x += 2) {
        let s = 0;
        for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) s += map.heights[(y + oy) * VW + x + ox];
        if (s > hillH) { hillH = s; hill = { x, y: y + 2 }; }
      }
    }
    return { lake: { x: lake.cx, y: lake.cy }, south, rock, hill, base: { x: base.x, y: base.y }, lakeCount: lakes.length, big: { x: big.cx, y: big.cy } };
  });
  console.log('spots', JSON.stringify(spots));
  const setups = {
    lake: [spots.lake.x, spots.lake.y + 3, 26],
    shore: [spots.south.x, spots.south.y, 13],
    far: [spots.lake.x, spots.lake.y + 4, 44],
    rocks: [spots.rock.x, spots.rock.y, 15],
    hills: [spots.hill.x, spots.hill.y, 20],
    base: [spots.base.x + 0.5, spots.base.y + 3.5, 25],
    dock: [(spots.base.x + spots.lake.x) / 2, (spots.base.y + spots.lake.y) / 2 + 3, 22],
  };
  for (const s of scenes) {
    if (!setups[s]) { console.log('unknown scene', s); continue; }
    const [x, y, d] = setups[s];
    await page.evaluate(({ x, y, d }) => { window.harness.camera(x, y, d); window.harness.advance(0.05); window.harness.render(); }, { x, y, d });
    const f = join(out, `${prefix}-${s}.png`);
    const t0 = Date.now();
    await page.screenshot({ path: f, timeout });
    console.log(f, `${Date.now() - t0} ms`);
  }
} finally {
  await browser.close();
  server.kill();
}
