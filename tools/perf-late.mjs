#!/usr/bin/env node
// Frame cost of the population cap's battle: the render harness's `late` scenario (four AI players, 2 v 2,
// medium map) runs --minutes of game time, then every player is filled to --fill population
// (tools/fill-pop.mjs) and the armies meet in the middle. The camera looks at the battle at the default zoom
// and --frames frames are drawn, each ended with a readPixels so the GPU work is done. Prints the median and
// p95 of the frame parts (sim tick + view state, renderer update, render) and, with --profile, the hottest
// functions of the page's JavaScript over those frames (Chrome's CPU profiler), self time and total time.
// Software GL: the render column is mostly SwiftShader and only its ratios mean anything; the update and
// sim columns are JavaScript and close to what a real browser spends.
//
// --game drives the real game instead (title screen → Play vs AI with four slots on a medium map, HUD and
// all; the host World is filled through window.__game), lets it run --seconds in real time with --sel own
// soldiers selected, and reports the game's own frame timing (renderer, HUD) and the profile.
//
//   node tools/perf-late.mjs [--port 8331] [--quality low] [--fill 200] [--minutes 2] [--frames 60]
//        [--width 1280] [--height 720] [--seed 4242] [--dist 0] [--fow] [--profile] [--save-profile x.cpuprofile] [--top 30] [--json out.json]
//        [--game] [--seconds 15] [--settle 4] [--sel 0]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);
const port = Number(opt('port', '8331'));
const quality = opt('quality', 'low');
const fill = Number(opt('fill', '200'));
const minutes = Number(opt('minutes', '2'));
const frames = Number(opt('frames', '60'));
const width = Number(opt('width', '1280'));
const height = Number(opt('height', '720'));
const seed = Number(opt('seed', '4242'));
const dist = Number(opt('dist', '0'));
const top = Number(opt('top', '30'));
const jsonOut = opt('json', '');
const profOut = opt('save-profile', ''); // the raw profile, for Chrome DevTools (Performance → Load profile)
const game = flag('game');
const seconds = Number(opt('seconds', '15'));
const selN = Number(opt('sel', '0'));
const settle = Number(opt('settle', '4'));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const server = spawn(join(root, 'node_modules/.bin/http-server'), ['.', '-p', String(port), '-c-1', '--silent'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const launch = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width, height } });
page.setDefaultTimeout(900000);
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text()); });

const pct = (s, p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
const fmt = (v) => v.toFixed(2).padStart(7);

async function startProfile() {
  const cdp = flag('profile') ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  return async () => (cdp ? (await cdp.send('Profiler.stop')).profile : null);
}

/** The render harness: manual clock, every frame the same work. */
async function runHarness() {
  const url = `http://localhost:${port}/tools/render-harness.html?manual=1&scenario=late&minutes=${minutes}&fill=${fill}`
    + `&reveal=${flag('fow') ? 0 : 1}&seed=${seed}&t=0&quality=${quality}&tod=golden`;
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => window.harness && window.harness.ready === true, null, { timeout: 900000, polling: 500 });
  await page.addStyleTag({ content: '#panel, #stats, #box { display: none !important; }' });
  const info = await page.evaluate((d) => {
    const h = window.harness;
    const m = h.world.mapData;
    h.camera(m.width / 2, m.height / 2, d || undefined);
    h.advance(2); // let the armies close and the first fights start
    h.render();
    return { units: h.unitCount(), ents: h.vs.entities.size, dist: Math.round(h.renderer.camera.distance), w: m.width };
  }, dist);
  console.log(`late ${minutes} min + fill ${fill}: ${info.units} units, ${info.ents} entities, ${quality}, ${width}x${height}, camera ${info.dist} (setup ${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  const stop = await startProfile();
  const r = await page.evaluate((n) => {
    const h = window.harness;
    const rr = h.renderer;
    const gl = rr.renderer.getContext();
    const px = new Uint8Array(4);
    const sim = [], upd = [], ren = [];
    let calls = 0, tris = 0;
    for (let i = 0; i < n; i++) {
      const a = performance.now();
      h.advance(1 / 30, 30);
      const b = performance.now();
      rr.render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const c = performance.now();
      const u = rr.getStats().updateMs;
      upd.push(u);
      sim.push(b - a - u);
      ren.push(c - b);
      calls = rr.renderer.info.render.calls;
      tris = rr.renderer.info.render.triangles;
    }
    return { sim, upd, ren, calls, tris };
  }, frames);
  const prof = await stop();
  return { info, r, prof, n: frames };
}

/** The real game: menu, lobby, HUD, host session; real time. */
async function runGame() {
  await page.addInitScript((q) => {
    const s = JSON.parse(localStorage.getItem('mythicwar-settings') || '{}');
    Object.assign(s, { quality: q, tipsDismissed: true, intro: false, musicMuted: true, volume: 0, hints: false, aiChat: false });
    localStorage.setItem('mythicwar-settings', JSON.stringify(s));
  }, quality);
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForSelector('.mw-title-screen');
  await page.click('text=Play vs AI');
  await page.waitForSelector('.mw-lobby');
  await page.click('.mw-seg[data-size="medium"]').catch(() => {});
  for (const n of [3, 4]) await page.selectOption(`select[aria-label="Slot ${n}"]`, 'ai:normal').catch(() => {});
  await page.click('.mw-btn--start');
  await page.waitForFunction(() => { const g = window.__game; return g && g.renderer && g.hud && g.stats.frames > 3; }, null, { polling: 200 });
  const info = await page.evaluate(async ({ fill, selN, dist }) => {
    const g = window.__game;
    const w = g.session.world;
    const { fillToPop } = await import('/tools/fill-pop.mjs');
    if (fill > 0) fillToPop(w, fill);
    const m = w.mapData;
    g.renderer.camera.centerOn(m.width / 2, m.height / 2);
    if (dist) g.renderer.camera.setDistance(dist, true);
    return { players: w.players.length, w: m.width, selN };
  }, { fill, selN, dist });
  await page.waitForTimeout(settle * 1000); // the armies walk in; the warm-up's shader programs finish linking
  const sel = await page.evaluate((selN) => {
    const g = window.__game;
    const vs = g.viewState;
    if (selN > 0) {
      const own = [...vs.entities.values()].filter((e) => e.k === 'u' && e.o === vs.myIndex && e.t !== 'worshipper').slice(0, selN);
      g.selection.set(own.map((e) => e.id));
    }
    window.__progs0 = new Set(g.renderer.renderer.info.programs.map((p) => p.cacheKey));
    const st = g.stats;
    Object.assign(st, { frames: 0, cpuMs: 0, maxMs: 0, renderMs: 0, hudMs: 0, last: [] });
    return { units: [...vs.entities.values()].filter((e) => e.k === 'u').length, ents: vs.entities.size, selected: g.selection.ids.length ?? g.selection.ids.size };
  }, selN);
  console.log(`real game, ${info.players} players, fill ${fill}: ${sel.units} units, ${sel.ents} entities, ${sel.selected} selected, ${quality}, ${width}x${height} (setup ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const stop = await startProfile();
  await page.waitForTimeout(seconds * 1000);
  const prof = await stop();
  const progs = await page.evaluate(() => window.__game.renderer.renderer.info.programs.filter((p) => !window.__progs0.has(p.cacheKey)).map((p) => p.name));
  console.log(`shader programs linked during the run: ${progs.length}${progs.length ? ` (${[...new Set(progs)].slice(0, 20).join(', ')})` : ''}`);
  const t = await page.evaluate(() => ({ ...window.__game.timing(), calls: window.__game.renderer.renderer.info.render.calls, tris: window.__game.renderer.renderer.info.render.triangles }));
  console.log(`${t.frames} frames in ${seconds} s; per frame avg: cpu ${t.avgCpuMs.toFixed(2)} ms (renderer ${t.avgRenderMs.toFixed(2)}, HUD ${t.avgHudMs.toFixed(2)}), p95 recent ${t.p95RecentMs.toFixed(1)}, max ${t.maxCpuMs.toFixed(1)}; ${t.calls} draw calls, ${Math.round(t.tris / 1000)}k tris`);
  return { info: { ...info, ...sel }, timing: t, prof, n: Math.max(1, t.frames) };
}

try {
  const res = game ? await runGame() : await runHarness();
  const { r, prof } = res;
  const nFrames = res.n;
  if (r) {

    const rows = {};
    for (const k of ['sim', 'upd', 'ren']) {
      const s = [...r[k]].sort((a, b) => a - b);
      rows[k] = { p50: pct(s, 0.5), p95: pct(s, 0.95), avg: s.reduce((a, b) => a + b, 0) / s.length };
    }
    console.log(`draw calls ${r.calls}, ${Math.round(r.tris / 1000)}k triangles`);
    console.log(`                        p50      p95      avg   (ms per frame, ${nFrames} frames)`);
    console.log(`sim + view state    ${fmt(rows.sim.p50)}  ${fmt(rows.sim.p95)}  ${fmt(rows.sim.avg)}`);
    console.log(`renderer update     ${fmt(rows.upd.p50)}  ${fmt(rows.upd.p95)}  ${fmt(rows.upd.avg)}`);
    console.log(`render (+GPU)       ${fmt(rows.ren.p50)}  ${fmt(rows.ren.p95)}  ${fmt(rows.ren.avg)}`);
  }
  let hot = null;
  if (prof && profOut) writeFileSync(profOut, JSON.stringify(prof));
  if (prof) {
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const key = (n) => { const f = n.callFrame; return `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`; };
    const self = new Map(), incl = new Map();
    let total = 0;
    prof.samples.forEach((id, i) => {
      const dt = prof.timeDeltas[i] || 0;
      total += dt;
      self.set(key(byId.get(id)), (self.get(key(byId.get(id))) || 0) + dt);
      const seen = new Set();
      for (let x = id; x !== undefined; x = parent.get(x)) {
        const k = key(byId.get(x));
        if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + dt); }
      }
    });
    const list = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => ({ fn: k, pct: +(v / total * 100).toFixed(1), msPerFrame: +(v / 1000 / nFrames).toFixed(2) }));
    hot = { self: list(self), total: list(incl) };
    console.log('\nself time (ms per frame, % of the profile)');
    for (const h of hot.self) console.log(`${fmt(h.msPerFrame)}  ${String(h.pct).padStart(5)}%  ${h.fn}`);
    console.log('\ntotal time');
    for (const h of hot.total) console.log(`${fmt(h.msPerFrame)}  ${String(h.pct).padStart(5)}%  ${h.fn}`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ info: res.info, timing: res.timing, quality, frames: nFrames, hot }, null, 2));
} finally {
  await browser.close();
  server.kill();
}
