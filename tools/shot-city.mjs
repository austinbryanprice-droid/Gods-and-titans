#!/usr/bin/env node
// Captures of tools/gallery-city.html (one pantheon's whole city under the real renderer) at
// different views and times of day, for building and structure work (src/render/models/).
// The sim is frozen and the render clock fixed, so everything but what you changed is identical
// between runs: shoot "before" on the old branch and "after" on the new one with the same options.
//
//   node tools/shot-city.mjs [--port 8341] [--out DIR] [--prefix after]
//        [--pantheons greek,norse,...|all]    (default greek)
//        [--views village,tc,row,temple,...]  see the gallery header (default village,tc)
//        [--tods golden,dusk,night]           golden | day | dusk | night | dawn | an hour such as 18.5
//        [--quality medium] [--width 1600] [--height 900] [--tier 3] [--zoom N] [--seed 4242]
//        [--stats]    print triangle and draw-call counts of each shot
//
// Files: DIR/PREFIX-<pantheon>-<view>-<tod>.png
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ALL = ['greek', 'norse', 'egyptian', 'hindu', 'japanese', 'chinese', 'aztec', 'celtic', 'mesopotamian', 'west_african'];
const port = Number(opt('port', '8341'));
const out = opt('out', join(tmpdir(), 'mythicwar-city'));
const prefix = opt('prefix', 'shot');
const pantheons = opt('pantheons', 'greek') === 'all' ? ALL : opt('pantheons', 'greek').split(',');
const views = opt('views', 'village,tc').split(',');
const tods = opt('tods', 'golden').split(',');
const quality = opt('quality', 'medium');
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '900'));
const tier = opt('tier', '3');
const seed = opt('seed', '4242');
const zoom = opt('zoom', '');
const showStats = args.includes('--stats');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(out, { recursive: true });

const server = spawn(join(root, 'node_modules/.bin/http-server'), ['.', '-p', String(port), '-c-1', '--silent'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
try {
  for (const pan of pantheons) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (e) => { failures++; console.log('pageerror', e.message); });
    page.on('console', (m) => { if (m.type() === 'error') { failures++; console.log('console.error', m.text()); } });
    const q = new URLSearchParams({ pantheon: pan, quality, tod: tods[0], tier, seed, manual: '1', t: '1.2', view: views[0] });
    const t0 = Date.now();
    await page.goto(`http://localhost:${port}/tools/gallery-city.html?${q}`);
    await page.waitForFunction(() => window.gallery && window.gallery.ready, null, { timeout: 240000 });
    console.log(`${pan}: loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const v of views) {
      for (const tod of tods) {
        const t1 = Date.now();
        const res = await page.evaluate(({ v, tod, zoom }) => {
          const g = window.gallery;
          g.view(v, zoom ? Number(zoom) : undefined);
          g.setTod(tod);
          const url = g.grab();
          return { url, stats: g.stats() };
        }, { v, tod, zoom });
        const f = join(out, `${prefix}-${pan}-${v}-${tod}.png`);
        writeFileSync(f, Buffer.from(res.url.split(',')[1], 'base64'));
        console.log(`${f}  ${((Date.now() - t1) / 1000).toFixed(1)} s${showStats ? `  ${res.stats.drawCalls} calls  ${res.stats.triangles} tris` : ''}`);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
process.exitCode = failures ? 1 : 0;
