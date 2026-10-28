#!/usr/bin/env node
// Stills and cost numbers of the zoom range (render harness, manual clock, so every run draws the same
// frame): the same view at several camera distances, with the detail levels of the zoom (DESIGN 8, "Far
// zoom") on or pinned to full detail, for before/after pictures and the cost table of a change to the far
// view. The default scenario is `late`: ten minutes of four AI players on a medium map (armies, towns, forest
// walls), the heaviest view the game gives.
//
//   node tools/shot-zoom.mjs [--port 8322] [--out DIR] [--prefix zoom] [--quality low] [--scenario late]
//        [--size medium] [--dists 25,44,100,170] [--tod golden] [--width 1280] [--height 720] [--seed 4242]
//        [--landscape islands] [--at X,Y] [--sel army] [--lod auto|full|far] [--fow] [--frames 3] [--no-shots] [--eval 'h.renderer...'] [--timeout 600000]
//
// --lod auto   the zoom's own levels (default); full: every level pinned to full detail (what the game drew
//              before the far zoom); far: every level pinned to its far form (also at close zoom, to look at it).
// --sel        select what the harness knows (army, workers, buildings, all): rings and bars at every zoom.
// --at         the camera's target, tiles (default: the middle of the map).
// --fow        look as player 0 with the fog of war on (the default shows everything, as a spectator).
// Prints, per distance: draw calls, thousand triangles, the frame time under software GL (median of --frames
// frames, each ended with a readPixels so the work is done: only ratios mean anything) and the update time.
// Picture files are written as DIR/PREFIX-QUALITY-dDIST.png. High and ultra take about a minute a frame under
// software GL: use a smaller --width / --height for those, or --timeout for more patience.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', '8322'));
const out = opt('out', join(tmpdir(), 'mythicwar-zoom'));
const prefix = opt('prefix', 'zoom');
const quality = opt('quality', 'low');
const scenario = opt('scenario', 'late');
const size = opt('size', 'medium');
const seed = Number(opt('seed', '4242'));
const landscape = opt('landscape', ''); // classic | highlands | rivers | islands | forest
const dists = opt('dists', '25,44,100,170').split(',').map(Number);
const width = Number(opt('width', '1280'));
const height = Number(opt('height', '720'));
const timeOfDay = opt('tod', 'golden');
const at = opt('at', '');
const sel = opt('sel', '');
const lod = opt('lod', 'auto');
const frames = Number(opt('frames', '3'));
const timeout = Number(opt('timeout', '600000'));
const evalCode = opt('eval', ''); // JavaScript run in the page before the shots, with the harness as `h`
const shots = !args.includes('--no-shots');
const fow = args.includes('--fow');
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
  const url = `http://localhost:${port}/tools/render-harness.html?manual=1&scenario=${scenario}&reveal=${fow ? 0 : 1}&seed=${seed}&size=${size}${landscape ? `&landscape=${landscape}` : ''}&t=0&quality=${quality}&tod=${encodeURIComponent(timeOfDay)}${sel ? `&sel=${sel}` : ''}`;
  await page.goto(url);
  await page.waitForFunction(() => window.harness && window.harness.ready === true, null, { timeout });
  await page.addStyleTag({ content: '#panel, #stats, #box { display: none !important; }' });
  await page.evaluate((mode) => {
    const r = window.harness.renderer;
    if (mode === 'full') r.lodPin = { stride: 1, forestFar: false, unitFar: false };
    else if (mode === 'far') r.lodPin = { stride: 4, forestFar: true, unitFar: true };
  }, lod);
  if (evalCode) await page.evaluate((code) => new Function('h', code)(window.harness), evalCode);
  const info = await page.evaluate(() => ({ w: window.harness.world.mapData.width, h: window.harness.world.mapData.height, units: window.harness.unitCount() }));
  console.log(`map ${info.w}x${info.h}, ${info.units} units, ${quality}, ${width}x${height}, tod ${timeOfDay}, levels ${lod}`);
  const [cx, cy] = at ? at.split(',').map(Number) : [info.w / 2, info.h / 2];
  for (const d of dists) {
    const r = await page.evaluate(async ({ cx, cy, d, frames }) => {
      const h = window.harness;
      const rr = h.renderer;
      h.camera(cx, cy, d);
      h.advance(0.05);
      const gl = rr.renderer.getContext();
      const px = new Uint8Array(4);
      const times = [];
      const upd = [];
      let stats = null;
      for (let i = 0; i < frames + 1; i++) {
        const t0 = performance.now();
        h.advance(0.05);
        const t1 = performance.now();
        rr.render();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t2 = performance.now();
        if (i > 0) { times.push(t2 - t1); upd.push(t1 - t0); }
        stats = { calls: rr.renderer.info.render.calls, tris: rr.renderer.info.render.triangles };
      }
      times.sort((a, b) => a - b);
      upd.sort((a, b) => a - b);
      const markers = rr.farUnits.mesh.count;
      return {
        dist: Math.round(rr.camera.distance),
        pitch: +((rr.camera.pitch * 180) / Math.PI).toFixed(1),
        calls: stats.calls,
        kTris: Math.round(stats.tris / 1000),
        frameMs: Math.round(times[times.length >> 1]),
        updateMs: +upd[upd.length >> 1].toFixed(1),
        levels: `ground step ${rr.lod.stride}, ${rr.lod.forestFar ? 'crowns' : 'full trees'}, ${markers} markers`,
      };
    }, { cx, cy, d, frames });
    let line = `d${String(r.dist).padEnd(4)} pitch ${String(r.pitch).padEnd(5)} calls ${String(r.calls).padStart(5)}  ${String(r.kTris).padStart(6)}k tris  frame ${String(r.frameMs).padStart(5)} ms  update ${r.updateMs} ms  (${r.levels})`;
    if (shots) {
      const f = join(out, `${prefix}-${quality}-d${d}.png`);
      await page.screenshot({ path: f, timeout });
      line += `  ${f}`;
    }
    console.log(line);
  }
} finally {
  await browser.close();
  server.kill();
}
