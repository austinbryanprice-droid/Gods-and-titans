#!/usr/bin/env node
// Matched captures of the foliage gallery (tools/gallery-foliage.html): a stand of
// mixed trees with the real undergrowth and ground cover, single-variant stands, and
// the zoomed-out view, per quality tier and time of day. Run it on two builds with
// different --prefix values and compare.
//
//   node tools/shot-foliage.mjs [--port 8321] [--out DIR] [--prefix shot]
//        [--scenes stand,lineup,single,far] [--quality high] [--tods day,golden,dusk,night]
//        [--width 1280] [--height 720] [--zoom N] [--variants pine,broadleaf] [--stand 14x6]
//        [--px 0 --py 0] [--perf] [--list]
//
// Each shot renders one frame at a frozen render clock (identical wind between runs).
// --perf prints the renderer's draw calls and triangles for every shot.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ALL = ['stand', 'lineup', 'single', 'far'];
if (args.includes('--list')) { console.log(ALL.join('\n')); process.exit(0); }
const port = Number(opt('port', '8321'));
const out = opt('out', join(tmpdir(), 'mythicwar-foliage'));
const prefix = opt('prefix', 'shot');
const quality = opt('quality', 'high');
const width = Number(opt('width', '1280'));
const height = Number(opt('height', '720'));
const scenes = opt('scenes', '') ? opt('scenes', '').split(',') : ALL;
const tods = opt('tods', '') ? opt('tods', '').split(',') : [''];
const extra = ['zoom', 'variants', 'stand', 'px', 'py', 'seed', 't'].filter((k) => opt(k, '') !== '').map((k) => `&${k}=${opt(k, '')}`).join('');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(out, { recursive: true });

const server = spawn(join(root, 'node_modules/.bin/http-server'), ['.', '-p', String(port), '-c-1', '--silent'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let problems = 0;
try {
  for (const scene of scenes) {
    for (const tod of tods) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', (e) => { problems++; console.log('pageerror', e.message); });
      page.on('console', (m) => { if (m.type() === 'error') { problems++; console.log('console.error', m.text()); } });
      const url = `http://localhost:${port}/tools/gallery-foliage.html?manual=1&quality=${quality}&view=${scene}${tod ? `&tod=${tod}` : ''}${extra}`;
      const t0 = Date.now();
      await page.goto(url);
      await page.waitForFunction(() => window.gallery && window.gallery.ready === true, null, { timeout: 240000 });
      await page.evaluate(() => window.gallery.render());
      const file = join(out, `${prefix}-${scene}${tod ? `-${tod}` : ''}-${quality}.png`);
      await page.screenshot({ path: file, timeout: 240000 });
      let note = '';
      if (args.includes('--perf')) {
        const s = await page.evaluate(() => { window.gallery.render(); return window.gallery.renderer.getStats(); });
        note = `  calls ${s.drawCalls} tris ${s.triangles}`;
      }
      console.log(`${file}  (${((Date.now() - t0) / 1000).toFixed(1)} s)${note}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (problems) process.exitCode = 1;
