#!/usr/bin/env node
// Screenshot the VFX gallery (tools/gallery-vfx.html) with Playwright, and run
// a browser stress / cleanup check.
//
//   node tools/shot-vfx.mjs [--port 8103] [--out DIR] [--only name1,name2] [--list]
//                           [--width 1600] [--height 1000] [--extra "name=query;name2=query2"]
//                           [--check]   (stress + leak check only, no screenshots)
//
// Uses the static server on --port when one answers there, otherwise starts
// node_modules/.bin/http-server itself. Every shot runs the gallery in manual
// mode (simulated at 60 Hz, so timing is deterministic regardless of frame rate);
// "film" shots lay one column per effect age so a single image shows the whole
// life of an effect. Shots with `frames` re-render the same page after stepping
// the simulation further (window.vfxStep). Prints every written file and any
// console errors (exit code 1 on page errors or a failed check).

import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const port = Number(opt('port', '8103'));
const outDir = opt('out', join(tmpdir(), 'mythicwar-vfx-shots'));
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '1000'));
const only = opt('only', '') ? opt('only', '').split(',').map((s) => s.trim()) : null;
const checkOnly = args.includes('--check');

const FILM = 'film=0.08,0.25,0.5,0.9';
const SHAPES = ['strike', 'nova', 'beam', 'beam-sky', 'cone', 'wave', 'wave-ring', 'field', 'buff', 'buff-area', 'summon', 'blink', 'projectile',
  'meteor', 'heal', 'heal-area', 'chain', 'quake', 'storm', 'shield', 'shield-area', 'dash'];
const FILMS = {
  strike: 'film=0.04,0.12,0.3,0.7',
  meteor: 'film=0.3,0.7,0.85,1.3',
  field: 'film=0.2,1,2.5,4.7',
  storm: 'film=0.4,1.2,2.4,4.4',
  shield: 'film=0.1,0.3,1.2,2.8',
  'shield-area': 'film=0.1,0.3,1.2,2.8',
  summon: 'film=0.2,0.6,0.95,1.4',
  chain: 'film=0.03,0.12,0.25,0.45',
  dash: 'film=0.1,0.25,0.4,0.7',
  beam: 'film=0.08,0.3,0.7,1.1',
  'beam-sky': 'film=0.08,0.3,0.7,1.1',
};

/** name -> { q: gallery query, frames?: [seconds to step before each extra frame], w?, h? } */
const SHOTS = {
  overview: { q: 'manual=1&t=0.35' },
  'overview-late': { q: 'manual=1&t=1.0' },
  projectiles: { q: 'mode=projectiles&manual=1&t=0.32', frames: [0.12] },
  'projectiles-magic': { q: 'mode=projectiles&manual=1&t=0.32&el=arcane&shape=arrow,spear,orb,feather,leaf,ice,rock,skull' },
  api: { q: 'mode=api&manual=1&t=0.3', frames: [0.5, 0.6] },
  'all-elements-strike': { q: 'shape=strike&el=all&manual=1&t=0.12&labels=1' },
  'all-elements-nova': { q: 'shape=nova&el=all&manual=1&t=0.2' },
  'all-elements-field': { q: 'shape=field&el=all&manual=1&t=1.5' },
  'zoom-in': { q: 'shape=summon,meteor,storm,shield&el=holy&manual=1&t=0.9&zoom=1.6' },
};
for (const s of SHAPES) SHOTS[`film-${s}`] = { q: `shape=${s}&${FILMS[s] || FILM}&manual=1` };
for (const pair of (opt('extra', '') || '').split(';').filter(Boolean)) {
  const i = pair.indexOf('=');
  SHOTS[pair.slice(0, i)] = { q: pair.slice(i + 1) };
}

if (args.includes('--list')) {
  for (const [k, v] of Object.entries(SHOTS)) console.log(`${k.padEnd(28)} ?${v.q}`);
  process.exit(0);
}

async function serverUp() {
  try {
    const r = await fetch(`http://localhost:${port}/tools/gallery-vfx.html`);
    return r.ok;
  } catch {
    return false;
  }
}

/** Stress + cleanup check: every shape × element and every projectile kind at once. */
async function runCheck(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/tools/gallery-vfx.html?panel=0&labels=0&shape=all&el=all&manual=1&t=0`);
  await page.waitForFunction(() => window.galleryReady === true, null, { timeout: 120000 });
  const res = await page.evaluate(() => {
    const vfx = window.vfx;
    const kinds = ['arrow', 'spear', 'orb', 'bolt', 'rock', 'fireball', 'feather', 'wave', 'skull', 'sunray', 'moonbeam', 'leaf', 'ice'];
    const els = Object.keys({ lightning: 1, fire: 1, water: 1, holy: 1, sun: 1, shadow: 1, death: 1, nature: 1, wind: 1, earth: 1, ice: 1, war: 1, moon: 1, chaos: 1, physical: 1, sand: 1, poison: 1, arcane: 1 });
    for (const k of kinds) for (const el of els) vfx.spawnProjectile({ kind: k, el, from: { x: 5, y: 5, h: 1 }, to: { x: 20, y: 12, h: 0.8 } });
    for (let i = 0; i < 300; i++) vfx.spawnHit({ x: 10 + (i % 20), y: 10 + (i % 7), h: 0.7, el: els[i % els.length] });
    const peak = vfx.stats();
    // time a few loaded frames
    const times = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      vfx.update(1 / 60);
      times.push(performance.now() - t0);
    }
    const loaded = vfx.stats();
    window.vfxStep(12);
    const after = vfx.stats();
    times.sort((a, b) => a - b);
    return { peak, loaded, after, medianMs: times[15], maxMs: times[29], sceneChildren: vfx.root.children.length };
  });
  await page.close();
  const bad = [];
  if (res.peak.particles > res.peak.particleCap) bad.push(`particle cap exceeded: ${res.peak.particles}`);
  for (const k of ['effects', 'projectiles', 'particles', 'glows', 'decals', 'ribbons', 'flares', 'pillars', 'domes', 'instances']) {
    if (res.after[k] !== 0) bad.push(`${k} still active after 12 s: ${res.after[k]}`);
  }
  console.log(`check: peak ${JSON.stringify(res.peak)}`);
  console.log(`check: loaded update median ${res.medianMs.toFixed(2)} ms, max ${res.maxMs.toFixed(2)} ms; vfx root children ${res.sceneChildren}`);
  for (const e of errors) console.log(`  console error [check]: ${e}`);
  for (const b of bad) console.log(`  FAIL: ${b}`);
  if (!bad.length && !errors.length) console.log('check: OK (everything cleaned up, cap respected, no console errors)');
  return bad.length + errors.length;
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
    if (checkOnly || !only || only.includes('check')) errorCount += await runCheck(browser);
    if (!checkOnly) {
      for (const [name, shot] of Object.entries(SHOTS)) {
        if (only && !only.some((o) => name.includes(o))) continue;
        const page = await browser.newPage({ viewport: { width: shot.w || width, height: shot.h || height } });
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', (e) => errors.push(String(e)));
        const url = `http://localhost:${port}/tools/gallery-vfx.html?panel=0&${shot.q}`;
        const t0 = Date.now();
        await page.goto(url);
        await page.waitForFunction(() => window.galleryReady === true, null, { timeout: 120000 });
        const frames = [null, ...(shot.frames || [])];
        for (let i = 0; i < frames.length; i++) {
          if (frames[i] !== null) await page.evaluate((s) => window.vfxStep(s), frames[i]);
          const file = join(outDir, frames.length > 1 ? `${name}-${i}.png` : `${name}.png`);
          await page.screenshot({ path: file });
          console.log(`${file}  (${Date.now() - t0} ms)`);
        }
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
