#!/usr/bin/env node
// Matched stills of one pantheon's units in the real renderer (render harness, scenario
// "pantheon": every mortal, creature, minion, god and titan of the first pantheon standing in
// rows on open ground), for character work (src/render/models/unit-*.js). The camera, the
// light and the map are the game's own, so a unit is judged the way a player sees it: at
// golden hour, dusk or by moonlight, on every quality tier, at the default zoom and close up.
//
//   node tools/shot-characters.mjs [--port 8321] [--out DIR] [--prefix before] [--quality high]
//        [--pantheon norse] [--tods golden,dusk,night] [--seed 4242] [--width 1600] [--height 900]
//        [--scenes mortals,creatures,gods,army] [--team 0] [--clean] [--canvas] [--timeout 600000]
//        [--detail base|rich] [--eval 'h.renderer.setQuality("low")']
//
// Scenes (name or name@distance, camera distance in tiles; 25 is the game's default, 10 the closest zoom):
//   army        the whole formation (default distance 20)
//   mortals     the mortal row: worshipper, warrior, archer, priest, battering ram (13)
//   creatures   the creature and minion row (13)
//   gods        the gods and the titan (15)
//   unit:<id>   one unit close up, e.g. unit:norse_thor@9 or unit:warrior@6~0.3 (~n: look n tiles further south of the unit)
//   field       the base at the default zoom, with workers at their jobs (25)
// Files: DIR/PREFIX-<scene>-<tod>.png   (--clean hides the harness panel and stats)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', '8321'));
const out = opt('out', join(tmpdir(), 'mythicwar-characters'));
const prefix = opt('prefix', 'shot');
const quality = opt('quality', 'high');
const pantheon = opt('pantheon', 'norse');
const other = pantheon === 'greek' ? 'norse' : 'greek';
const seed = Number(opt('seed', '4242'));
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '900'));
const timeout = Number(opt('timeout', '600000'));
const tods = opt('tods', 'golden').split(',');
const scenes = opt('scenes', 'mortals,creatures,gods').split(',');
const evalCode = opt('eval', '');
const detail = opt('detail', '');
const clean = args.includes('--clean');
const canvasOnly = args.includes('--canvas');
const t0 = Number(opt('t', '0.3')); // sim seconds before the first frame (units settle into their idle)
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
  await page.goto(`http://localhost:${port}/tools/render-harness.html?manual=1&scenario=pantheon&reveal=1&seed=${seed}&quality=${quality}&pantheons=${pantheon},${other}&t=${t0}`);
  await page.waitForFunction(() => window.harness && window.harness.ready === true, null, { timeout });
  if (clean) await page.addStyleTag({ content: '#panel, #stats { display: none !important; }' });
  // allow the close-up scenes closer than the game's closest zoom
  await page.evaluate(() => { window.harness.renderer.camera.opts.minDistance = 2.5; });
  if (detail) await page.evaluate((d) => window.harness.renderer.setUnitDetail(d), detail);
  if (evalCode) await page.evaluate(`(() => { const h = window.harness; ${evalCode} })()`);
  // the unit views rebuild when the detail changes and fade in over a few frames (see-through dither): let them finish
  await page.evaluate(() => window.harness.advance(1));

  // where the rows of the formation stand (unit positions of player 0 by class)
  const rows = await page.evaluate(() => {
    const h = window.harness;
    const mine = [...h.world.entities.values()].filter((e) => e.kind === 'unit' && e.owner === 0 && !e.dead);
    const center = (list) => (list.length ? { x: list.reduce((a, e) => a + e.x, 0) / list.length, y: list.reduce((a, e) => a + e.y, 0) / list.length } : null);
    const idle = mine.filter((e) => e.def.class !== 'worker');
    const army = {
      mortals: ['worshipper', 'warrior', 'archer', 'priest', 'battering_ram'],
      creatures: [], gods: [],
    };
    for (const e of idle) {
      if (e.def.class === 'god' || e.def.class === 'titan') army.gods.push(e.def.id);
      else if (e.def.class === 'creature' || e.def.class === 'minion') army.creatures.push(e.def.id);
    }
    const at = (ids) => center(idle.filter((e) => ids.includes(e.def.id)));
    const units = {};
    for (const e of mine) if (!units[e.def.id]) units[e.def.id] = { x: e.x, y: e.y };
    // workers stand at the mine and the trees: the base is where the town center is
    const tc = h.world.buildingsOf(0).find((b) => b.type === 'town_center');
    return {
      mortals: at(army.mortals), creatures: at(army.creatures), gods: at(army.gods), army: h.focus.army,
      field: h.focus.base || { x: tc.x, y: tc.y }, units,
    };
  });

  for (const scene of scenes) {
    const [name, rest] = scene.split('@');
    const [d, dyStr] = (rest || '').split('~');
    const defaults = { army: 20, mortals: 13, creatures: 13, gods: 15, field: 25 };
    let spot;
    let dist;
    if (name.startsWith('unit:')) {
      const id = name.slice(5);
      const key = Object.keys(rows.units).find((k) => k === id) || Object.keys(rows.units).find((k) => k.includes(id));
      if (!key) { console.log('no unit', id, 'of', Object.keys(rows.units).join(', ')); continue; }
      spot = rows.units[key];
      dist = Number(d || 9);
    } else {
      spot = rows[name];
      dist = Number(d || defaults[name] || 15);
    }
    if (!spot) { console.log('unknown scene', scene); continue; }
    await page.evaluate(({ x, y, dd }) => window.harness.camera(x, y, dd), { x: spot.x, y: spot.y + (dyStr === undefined ? 0.6 : Number(dyStr)), dd: dist });
    for (const tod of tods) {
      await page.evaluate((t) => { const r = window.harness.renderer; r.setTimeOfDay(/^[0-9.]+$/.test(t) ? Number(t) : t); }, tod);
      // a few frames, so shadows, the sky environment and the unit animations settle
      await page.evaluate(() => { window.harness.advance(0.25); window.harness.render(); window.harness.advance(0.05); window.harness.render(); });
      const f = join(out, `${prefix}-${name.replace(':', '-')}-${tod}.png`);
      if (canvasOnly) {
        const url = await page.evaluate(() => {
          const h = window.harness;
          h.render();
          return h.renderer.canvas.toDataURL('image/png');
        });
        writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
      } else {
        await page.screenshot({ path: f, timeout });
      }
      console.log(f);
    }
  }
  const info = await page.evaluate(() => { const r = window.harness.renderer; return { quality: r.quality, scale: r.renderScale, ...r.getStats() }; });
  console.log(JSON.stringify(info));
} finally {
  await browser.close();
  server.kill();
}
