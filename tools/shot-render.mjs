#!/usr/bin/env node
// Screenshot sequences of the game renderer (tools/render-harness.html) with
// Playwright, plus a CPU timing run of renderer.update().
//
//   node tools/shot-render.mjs [--port 8201] [--out DIR] [--only name1,name2] [--list]
//                              [--width 1600] [--height 900] [--perf] [--units 300]
//                              [--extra "name=query;name2=query2"]
//
// Uses the static server on --port when one answers there, otherwise starts
// node_modules/.bin/http-server itself. Every shot runs the harness in manual
// mode (the sim and the renderer advance at a fixed frame rate on a virtual
// clock, so frames are deterministic). Frames with `advance` step the game
// further before the next screenshot; `js` runs in the page first.
// Prints every written file and any console errors (exit code 1 on errors).

import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PANTHEON_LIST } from '../src/data/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const port = Number(opt('port', '8201'));
const outDir = opt('out', join(tmpdir(), 'mythicwar-render-shots'));
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '900'));
const only = opt('only', '') ? opt('only', '').split(',').map((s) => s.trim()) : null;
const perfOnly = args.includes('--perf');

/** name -> { q, frames: [{ advance?, js?, suffix? }] } */
const SHOTS = {
  'base-start': { q: 'scenario=base' },
  'base-1min': { q: 'scenario=base&t=60&sel=workers', frames: [{}, { advance: 0.6, js: 'harness.renderer.setShowAllBars(true)' }] },
  'zoom-close': { q: 'scenario=base&t=30', frames: [{ js: 'harness.renderer.camera.setDistance(10, true); harness.renderer.camera.update(0)', advance: 0.1 }] },
  'zoom-far': { q: 'scenario=base&t=30', frames: [{ js: 'harness.renderer.camera.setDistance(44, true); harness.renderer.camera.update(0)', advance: 0.1 }] },
  construction: { q: 'scenario=construction&t=2&sel=buildings&bars=1' },
  'construction-ghost': { q: 'scenario=construction&t=2&sel=workers', frames: [{ js: 'const tc = [...harness.vs.entities.values()].find((e) => e.t === "town_center" && e.o === 0); harness.showGhost("barracks", tc.x - 7, tc.y - 1); harness.renderer.showCommandMarker(tc.x + 3, tc.y + 6, "move")', advance: 0.15 }] },
  battle: { q: 'scenario=battle&t=5&cam=64,64,30', frames: [{}, { advance: 1.2 }, { advance: 1.2 }, { advance: 2, js: 'harness.renderer.setShowAllBars(true)' }] },
  'battle-late': { q: 'scenario=battle&t=14&cam=64,64,26&sel=army', frames: [{}, { advance: 1 }] },
  fog: { q: 'scenario=fog&t=45', frames: [{ js: 'harness.renderer.camera.setDistance(44, true); harness.renderer.camera.update(0)', advance: 0.4 }] },
  'fog-remembered': { q: 'scenario=fog&t=70', frames: [{ js: 'const e = [...harness.vs.lastSeen.values()][0]; if (e) harness.camera(e.x, e.y + 2, 30)', advance: 0.4 }] },
  creeps: { q: 'scenario=creeps&t=12', frames: [{ js: 'const u = [...harness.vs.entities.values()].find((e) => e.o === 0 && e.k === "u" && e.lv); if (u) harness.camera(u.ix, u.iy, 24)', advance: 0.2 }, { advance: 1.5 }] },
  trees: { q: 'scenario=trees&t=40&sel=workers' },
  // status visuals on a lineup (default zoom, then close): stun stars, buff / debuff /
  // slow / dot icons, shield bubble, slow and invulnerable rings, combinations
  status: {
    q: 'scenario=pantheon&pantheons=greek,norse&t=1',
    frames: [{
      js: `const us = [...harness.vs.entities.values()].filter((e) => e.k === 'u' && e.o === 0 && e.t !== 'worshipper' && Math.hypot(e.x - harness.focus.army.x, e.y - harness.focus.army.y) < 12);
        const sets = [['stun'], ['slow'], ['buff'], ['debuff'], ['dot'], ['shield'], ['invuln'], ['buff', 'shield'], ['debuff', 'slow', 'dot'], ['stun', 'debuff'], ['buff', 'dot'], ['shield', 'slow'], ['invuln', 'buff'], ['debuff'], ['buff', 'debuff', 'slow', 'dot', 'shield']];
        us.forEach((u, i) => harness.forceStatus(u.id, sets[i % sets.length]));
        harness.camera(harness.focus.army.x, harness.focus.army.y);`,
      advance: 0.5,
    }, { js: 'harness.camera(harness.focus.army.x, harness.focus.army.y, 13)', advance: 0.3 }],
  },
  // six workers on one mine: two mine at a time, the others wait at the edge facing it
  mine: {
    q: 'scenario=pantheon&pantheons=greek,norse&t=8',
    frames: [
      // waiting workers flagged `mw` (emulated from the sim until the snapshot carries it)
      { js: 'harness.emulateMineWait(true); const m = [...harness.vs.entities.values()].find((e) => e.k === "m" && Math.hypot(e.x - harness.focus.base.x, e.y - harness.focus.base.y) < 14); harness.camera(m.x, m.y + 1.5, 13); harness.selectWhere((e) => e.k === "u" && e.o === 0 && e.st === "gather" && e.tg === m.id)', advance: 0.2 },
      { advance: 0.8 },
      { advance: 9, js: 'harness.renderer.camera.setDistance(10, true); harness.renderer.camera.update(0)' },
    ],
  },
  // an enemy walking out of and back into vision fades instead of popping
  fade: {
    q: 'scenario=base&t=2',
    frames: [{
      js: `const tc = [...harness.vs.entities.values()].find((e) => e.t === 'town_center' && e.o === 0);
        const m = harness.world.map;
        let spot = null;
        for (let r = 8; r < 30 && !spot; r += 0.5) {
          for (let a = 0; a < 6.28 && !spot; a += 0.2) {
            const x = tc.x + Math.cos(a) * r, y = tc.y + 3 + Math.sin(a) * r * 0.6;
            if (!harness.vs.isVisibleAt(x, y) && harness.vs.isVisibleAt(x - Math.cos(a) * 1.5, y - Math.sin(a) * 0.9) && m.isPassable(Math.floor(x), Math.floor(y))) spot = { x, y, a };
          }
        }
        window.__fadeSpot = spot;
        const u = harness.world.spawnUnit(1, 'warrior', spot.x - Math.cos(spot.a) * 2.2, spot.y - Math.sin(spot.a) * 1.3, { silent: true });
        harness.world.issueCommand(1, { type: 'move', units: [u.id], x: spot.x + Math.cos(spot.a) * 3, y: spot.y + Math.sin(spot.a) * 2 });
        window.__fadeUnit = u.id;
        harness.camera(spot.x, spot.y, 14);`,
      advance: 0.2,
    }, { advance: 0.1 }, { advance: 0.6 }, { advance: 0.12 }, { advance: 0.12 }],
  },
  // damaged buildings burn (one, two, three fires)
  fires: {
    q: 'scenario=base&t=8',
    frames: [{
      js: `const bs = [...harness.world.entities.values()].filter((e) => e.kind === 'building' && !e.dead);
        const fr = [0.5, 0.3, 0.1];
        bs.forEach((b, i) => { b.hp = Math.max(1, b.maxHp * fr[i % 3]); });
        const tc = bs.find((b) => b.type === 'town_center' && b.owner === 0);
        harness.camera(tc.x, tc.y + 2, 20);`,
      advance: 0.6,
    }, { advance: 0.4 }],
  },
  // command markers, rally flag + dotted line, selection and hover rings up close
  markers: {
    q: 'scenario=base&t=20',
    frames: [
      { js: 'const tc = [...harness.vs.entities.values()].find((e) => e.t === "town_center" && e.o === 0); harness.world.issueCommand(0, { type: "rally", building: tc.id, x: tc.x + 6, y: tc.y + 5 }); harness.select([tc.id]); harness.camera(tc.x + 2, tc.y + 3, 18)', advance: 0.3 },
      { js: 'const tc = [...harness.vs.entities.values()].find((e) => e.t === "town_center" && e.o === 0); const w = [...harness.vs.entities.values()].find((e) => e.k === "u" && e.o === 0); harness.renderer.setHover(w.id); harness.renderer.showCommandMarker(tc.x - 3, tc.y + 5, "move"); harness.renderer.showCommandMarker(tc.x + 1, tc.y + 6, "attack"); harness.renderer.showCommandMarker(tc.x + 4, tc.y + 2, "gather"); harness.renderer.showFloatingText(tc.x, tc.y, "+25", "#ffd23a", 3)', advance: 0.2 },
    ],
  },
};
// every pantheon at the default camera: City town center + all buildings, construction
// stages, and the whole roster (mortals, creatures, minions, gods, titan) with bars
for (const pan of PANTHEON_LIST) {
  SHOTS[`pan-${pan.id}`] = {
    q: `scenario=pantheon&pantheons=${pan.id},${pan.id === 'greek' ? 'norse' : 'greek'}&t=3`,
    frames: [
      { js: 'harness.camera(harness.focus.base.x, harness.focus.base.y, 25); harness.selectWhere((e) => e.k === "b" && e.o === 0 && e.t === "town_center"); harness.renderer.setShowAllBars(true)', advance: 0.3 },
      { js: 'const f = harness.focus.sites || harness.focus.base; harness.camera(f.x, f.y, 25); harness.selectWhere((e) => e.k === "b" && e.o === 0 && e.bp < 1)', advance: 0.3 },
      { js: 'harness.camera(harness.focus.army.x, harness.focus.army.y, 25); harness.selectWhere((e) => e.k === "u" && e.o === 0 && e.t !== "worshipper" && Math.hypot(e.x - harness.focus.army.x, e.y - harness.focus.army.y) < 10)', advance: 0.3 },
    ],
  };
}
for (const pair of (opt('extra', '') || '').split(';').filter(Boolean)) {
  const i = pair.indexOf('=');
  SHOTS[pair.slice(0, i)] = { q: pair.slice(i + 1) };
}

if (args.includes('--list')) {
  for (const [k, v] of Object.entries(SHOTS)) console.log(`${k.padEnd(22)} ?${v.q}`);
  process.exit(0);
}

async function serverUp() {
  try {
    const r = await fetch(`http://localhost:${port}/tools/render-harness.html`);
    return r.ok;
  } catch {
    return false;
  }
}

async function openHarness(browser, q, w = width, h = height) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/tools/render-harness.html?manual=1&${q}`);
  await page.waitForFunction(() => window.harness && window.harness.ready === true, null, { timeout: 240000 });
  return { page, errors };
}

async function runPerf(browser) {
  const units = Number(opt('units', '300'));
  const { page, errors } = await openHarness(browser, `scenario=perf&units=${units}&quality=${opt('quality', 'medium')}&cam=64,62,40`, 1280, 720);
  const res = await page.evaluate(async () => {
    const h = window.harness;
    h.advance(1.5, 30); // warm up: armies close in
    h.resetPerf();
    h.advance(6, 30);
    const p = h.perf();
    // render cost (software WebGL: only indicative) and stats with bars on
    h.renderer.setShowAllBars(true);
    h.selectWhere((e) => e.k === 'u' && e.o === 0);
    h.advance(0.5, 30);
    const t0 = performance.now();
    h.render();
    const renderMs = performance.now() - t0;
    const withBars = h.perf();
    return { perf: p, renderMs, stats: { ...h.renderer.getStats() }, units: h.unitCount(), withBarsRecent: withBars.recentAvg };
  });
  console.log(`perf: ${res.units} units: renderer.update avg ${res.perf.avg.toFixed(2)} ms, p95 ${res.perf.p95.toFixed(2)} ms, max ${res.perf.max.toFixed(2)} ms over ${res.perf.frames} frames`);
  console.log(`perf: with all bars + selection: recent avg ${res.withBarsRecent.toFixed(2)} ms; one render() ${res.renderMs.toFixed(0)} ms (software GL); stats ${JSON.stringify(res.stats)}`);
  for (const e of errors) console.log(`  console error [perf]: ${e}`);
  await page.close();
  return errors.length;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  let server = null;
  if (!(await serverUp())) {
    server = spawn(join(ROOT, 'node_modules/.bin/http-server'), ['.', '-p', String(port), '-c-1', '--silent'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let errorCount = 0;
  try {
    if (perfOnly || (only && only.includes('perf'))) errorCount += await runPerf(browser);
    if (!perfOnly) {
      for (const [name, shot] of Object.entries(SHOTS)) {
        if (only && !only.some((o) => name === o || (o.endsWith('*') && name.startsWith(o.slice(0, -1))))) continue;
        const t0 = Date.now();
        const { page, errors } = await openHarness(browser, shot.q, shot.w, shot.h);
        const frames = shot.frames || [{}];
        for (let i = 0; i < frames.length; i++) {
          const f = frames[i];
          if (f.js) await page.evaluate((code) => { (0, eval)(code); }, f.js);
          if (f.advance) await page.evaluate((s) => window.harness.advance(s, 30), f.advance);
          await page.evaluate(() => window.harness.render());
          const file = join(outDir, frames.length > 1 ? `${name}-${i}.png` : `${name}.png`);
          await page.screenshot({ path: file });
          console.log(`${file}  (${Date.now() - t0} ms)`);
        }
        const st = await page.evaluate(() => ({ ...window.harness.renderer.getStats(), perf: window.harness.perf() }));
        console.log(`  stats: calls ${st.drawCalls}, tris ${st.triangles}, entities ${st.entities}, update avg ${st.perf.avg.toFixed(2)} ms (max ${st.perf.max.toFixed(2)})`);
        for (const e of errors) console.log(`  console error [${name}]: ${e}`);
        errorCount += errors.length;
        await page.close();
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  if (errorCount) {
    console.log(`${errorCount} problem(s)`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
