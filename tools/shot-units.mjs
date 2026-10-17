#!/usr/bin/env node
// Screenshot the unit model gallery (tools/gallery-units.html) with Playwright.
//
//   node tools/shot-units.mjs [--port 8101] [--out DIR] [--only name1,name2] [--list]
//                             [--width 1600] [--height 1000] [--extra "name=query;name2=query2"]
//
// Uses the static server on --port when one answers there, otherwise starts
// node_modules/.bin/http-server itself (and stops it afterwards). Each shot is a
// gallery URL query; time is frozen with ?t= (or ?film=) so shots are
// deterministic. "sheet-*" shots frame every unit in its own cell, "film-*"
// shots lay animation frames out left to right (one row per unit), and a shot
// with `frames` re-renders one page at several times via window.renderAt.
// --only matches shot-name substrings. Prints every written file and any
// console errors from the page (exit code 1 when a page logged errors).

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
const port = Number(opt('port', '8101'));
const outDir = opt('out', join(tmpdir(), 'mythicwar-unit-shots'));
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '1000'));
const only = opt('only', '') ? opt('only', '').split(',').map((s) => s.trim()) : null;

/**
 * name -> { q: gallery query, frames?: [t...] (re-render the same page at these
 * times), w?, h? }. `sheet=1` = one framed close-up per unit; `film=...` = one
 * row per unit, one column per time (continuous simulation).
 */
const GODS_A = 'greek_zeus,greek_athena,greek_poseidon,greek_hades,norse_odin,norse_thor,norse_freyja,norse_loki,egyptian_ra,egyptian_anubis,egyptian_isis,egyptian_set,hindu_shiva,hindu_vishnu,hindu_durga,hindu_hanuman,japanese_amaterasu,japanese_susanoo,japanese_raijin,japanese_inari';
const GODS_B = 'chinese_sun_wukong,chinese_nuwa,chinese_guan_yu,chinese_chang_e,aztec_quetzalcoatl,aztec_huitzilopochtli,aztec_tezcatlipoca,aztec_tlaloc,celtic_the_dagda,celtic_the_morrigan,celtic_lugh,celtic_brigid,mesopotamian_marduk,mesopotamian_ishtar,mesopotamian_enki,mesopotamian_nergal,west_african_shango,west_african_oya,west_african_ogun,west_african_anansi';
const ANIM_SET = 'worshipper,warrior,archer,greek_zeus,syn_bodies_quadruped,syn_bodies_bird,syn_bodies_naga,syn_bodies_serpent,syn_bodies_spirit,battering_ram';
const FILM = '0,0.1,0.2,0.3,0.4,0.5';
const SHOTS = {
  // in-game camera overviews
  'overview-real': { q: 'filter=real&t=1&team=mix' },
  'overview-greek-norse': { q: 'filter=greek,norse&t=1&cols=8&team=mix' },
  'overview-synthetic': { q: 'filter=synthetic&t=1&cols=14' },
  // contact sheets (every vocabulary value and every data unit)
  'sheet-bodies': { q: 'filter=syn-bodies&t=1.3&sheet=1&facing=60' },
  'sheet-heads': { q: 'filter=syn-heads&t=1&sheet=1&facing=70&cols=7&zoom=1.6' },
  'sheet-quadheads': { q: 'filter=syn-quadheads&t=1&sheet=1&facing=50&cols=6' },
  'sheet-headgear': { q: 'filter=syn-headgear&t=1&sheet=1&facing=70&cols=7&zoom=1.6' },
  'sheet-weapons': { q: 'filter=syn-weapons&t=1&sheet=1&facing=55&cols=7' },
  'sheet-weapons-attack': { q: 'filter=syn-weapons&state=attack&phase=0.45&t=1&sheet=1&facing=55&cols=7' },
  'sheet-offhands': { q: 'filter=syn-offhands&t=1&sheet=1&facing=55&cols=5' },
  'sheet-extras': { q: 'filter=syn-extras&t=1&sheet=1&facing=55&cols=8' },
  'sheet-mortals': { q: 'filter=mortals&t=1&sheet=1&facing=60&cols=5&zoom=1.3', h: 500 },
  'sheet-gods-a': { q: `filter=${GODS_A}&t=1&sheet=1&facing=65&cols=5&team=mix` },
  'sheet-gods-b': { q: `filter=${GODS_B}&t=1&sheet=1&facing=65&cols=5&team=mix` },
  'sheet-titans': { q: 'filter=titan&t=1&sheet=1&facing=50&cols=5&team=mix', h: 640 },
  'sheet-creatures': { q: 'filter=creature,minion&real=1&t=1&sheet=1&facing=50&team=mix&cols=8' },
  'sheet-gods-cast': { q: `filter=${GODS_A}&state=cast&t=1&sheet=1&facing=65&cols=5&team=mix` },
  // animation film strips
  'film-move': { q: `filter=${ANIM_SET}&state=move&film=${FILM}&facing=0&pitch=30`, h: 1400 },
  'film-attack': { q: `filter=${ANIM_SET}&state=attack&film=0,0.12,0.24,0.36,0.48,0.6&facing=0&pitch=30`, h: 1400 },
  'film-cast': { q: `filter=${ANIM_SET}&state=cast&film=${FILM}&facing=40&pitch=40`, h: 1400 },
  'film-dead': { q: `filter=${ANIM_SET}&state=dead&film=0.1,0.35,0.6,0.95,1.25,1.6&facing=0&pitch=35`, h: 1400 },
  'film-worker-gather-wood': { q: 'filter=worshipper&state=gather&carry=w&film=0,0.12,0.24,0.36,0.48,0.6&facing=0&pitch=25', h: 420 },
  'film-worker-gather-gold': { q: 'filter=worshipper&state=gather&carry=g&film=0,0.12,0.24,0.36,0.48,0.6&facing=0&pitch=25', h: 420 },
  'film-worker-build': { q: 'filter=worshipper&state=build&film=0,0.1,0.2,0.3,0.4,0.5&facing=0&pitch=25', h: 420 },
  'film-worker-return': { q: 'filter=worshipper&state=return&carry=w&film=0,0.12,0.24,0.36&facing=60&pitch=56', h: 420 },
  'film-pray': { q: 'filter=worshipper,priest&state=pray&film=0,0.4,0.8,1.2,1.6,2.0&facing=0&pitch=25', h: 700 },
  // close-ups on headline gods
  'close-zeus': { q: 'focus=greek_zeus&t=1&facing=60', w: 900, h: 900 },
  'close-thor-attack': { q: 'filter=norse_thor&state=attack&film=0.05,0.15,0.25,0.35,0.45,0.55&facing=20&pitch=30', w: 1500, h: 420 },
  'close-ra': { q: 'focus=egyptian_ra&t=1&facing=60', w: 900, h: 900 },
  'close-shiva': { q: 'focus=hindu_shiva&t=1&facing=60', w: 900, h: 900 },
  'close-anubis': { q: 'focus=egyptian_anubis&t=1&facing=60', w: 900, h: 900 },
};
for (const pair of (opt('extra', '') || '').split(';').filter(Boolean)) {
  const i = pair.indexOf('=');
  SHOTS[pair.slice(0, i)] = { q: pair.slice(i + 1) };
}

if (args.includes('--list')) {
  for (const [k, v] of Object.entries(SHOTS)) console.log(`${k.padEnd(30)} ?${v.q}`);
  process.exit(0);
}

async function serverUp() {
  try {
    const r = await fetch(`http://localhost:${port}/tools/gallery-units.html`);
    return r.ok;
  } catch {
    return false;
  }
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
    for (const [name, shot] of Object.entries(SHOTS)) {
      if (only && !only.some((o) => name.includes(o))) continue;
      const page = await browser.newPage({ viewport: { width: shot.w || width, height: shot.h || height } });
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      const url = `http://localhost:${port}/tools/gallery-units.html?panel=0&${shot.q}`;
      const t0 = Date.now();
      await page.goto(url);
      await page.waitForFunction(() => window.galleryReady === true, null, { timeout: 120000 });
      const frames = shot.frames || [null];
      for (let i = 0; i < frames.length; i++) {
        if (frames[i] !== null) await page.evaluate((t) => window.renderAt(t, 0.8), frames[i]);
        const file = join(outDir, frames.length > 1 ? `${name}-${i}.png` : `${name}.png`);
        await page.screenshot({ path: file });
        console.log(`${file}  (${Date.now() - t0} ms)`);
      }
      for (const e of errors) console.log(`  console error [${name}]: ${e}`);
      errorCount += errors.length;
      await page.close();
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  if (errorCount) {
    console.log(`${errorCount} console error(s)`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
