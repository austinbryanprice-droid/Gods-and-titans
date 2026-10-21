#!/usr/bin/env node
// Captures of the same camera setups at different times of day, for lighting and
// atmosphere work (src/render/atmosphere.js). One fixed-seed solo match, the sim
// frozen at t = 0 so everything but the light is identical between shots; the
// time of day is switched live with renderer.setTimeOfDay().
//
//   node tools/shot-lighting.mjs [--port 8321] [--out DIR] [--prefix after]
//        [--tods golden,day,dusk,night,dawn]   cycle | golden | day | dusk | night | dawn | an hour such as 18.5
//        [--scenes world,hall,forest,far]       world hall yard forest mine crowd far
//        [--quality medium] [--pantheon greek] [--seed 4242] [--width 1600] [--height 900]
//        [--canvas]   grab the WebGL canvas right after drawing it instead of a page screenshot
//                     (no HUD; works for high / ultra, where software GL can be too slow for a screenshot)
//
// Files: DIR/PREFIX-<scene>-<tod>.png
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', '8321'));
const out = opt('out', join(tmpdir(), 'mythicwar-lighting'));
const prefix = opt('prefix', 'shot');
const pantheon = opt('pantheon', 'greek');
const seed = Number(opt('seed', '4242'));
const quality = opt('quality', 'medium');
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '900'));
const tods = opt('tods', 'golden,day,dusk,night,dawn').split(',');
const ALL = ['world', 'hall', 'yard', 'forest', 'mine', 'crowd', 'far'];
const scenes = opt('scenes', 'world').split(',');
const canvasOnly = args.includes('--canvas');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(out, { recursive: true });

const server = spawn(join(root, 'node_modules/.bin/http-server'), ['.', '-p', String(port), '-c-1', '--silent'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text()); });
await page.addInitScript((q) => {
  try {
    const s = JSON.parse(localStorage.getItem('mythicwar-settings') || '{}');
    s.quality = q; s.tipsDismissed = true; localStorage.setItem('mythicwar-settings', JSON.stringify(s));
  } catch {}
}, quality);

try {
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForSelector('.mw-title-screen');
  await page.evaluate(async ({ pan, seed }) => {
    const { startGame } = await import('/src/main.js');
    const { PLAYER_COLORS } = await import('/src/config.js');
    const other = pan === 'norse' ? 'greek' : 'norse';
    const setup = {
      version: '0.1.0', seed, mapSize: 'small',
      players: [
        { index: 0, name: 'Austin', team: 1, pantheon: pan, color: PLAYER_COLORS[0], kind: 'human', difficulty: 'normal' },
        { index: 1, name: 'Player 2', team: 2, pantheon: other, color: PLAYER_COLORS[1], kind: 'ai', difficulty: 'normal' },
      ],
    };
    startGame({ role: 'host', setup, myIndex: 0, conns: new Map(), lobby: { close() {}, setStarted() {} } });
  }, { pan: pantheon, seed });
  await page.waitForFunction(() => window.__game && window.__game.renderer && window.__game.stats.frames > 3, null, { timeout: 180000 });
  await page.evaluate(() => {
    const c = document.querySelector('.hud-tips-close'); if (c) c.click();
    const g = window.__game;
    g.setPaused(true);
    // count draws, so a capture can wait for the frame it asked for
    const r = g.renderer;
    const draw = r.render.bind(r);
    window.__draws = 0;
    r.render = (t) => { draw(t); window.__draws++; };
  });
  await page.waitForTimeout(500);

  const redraw = async () => {
    const n = await page.evaluate(() => { window.__game.needsRender = true; return window.__draws; });
    await page.waitForFunction((k) => window.__draws > k, n, { timeout: 240000, polling: 100 });
  };
  const focusJs = (kind, dist) => `(() => {
    const g = window.__game, vs = g.viewState, r = g.renderer;
    const mine = [...vs.entities.values()].filter((e) => e.o === vs.myIndex);
    const tc = mine.find((e) => e.k === 'b' && e.t === 'town_center');
    let x = tc.x, y = tc.y + 1.5;
    if (${JSON.stringify(kind)} === 'forest') { const t = g.session.world.map.nearestForest(tc.x, tc.y, 24, true); if (t) { x = t.tx; y = t.ty; } }
    if (${JSON.stringify(kind)} === 'mine') { const m = g.session.world.mineList[vs.myIndex]; if (m) { x = m.x; y = m.y; } }
    r.camera.centerOn(x, y, false);
    r.camera.setDistance(${dist}, true);
    r.camera.update(0);
  })()`;
  const setups = {
    world: focusJs('hall', 30),
    hall: focusJs('hall', 11),
    yard: focusJs('hall', 20),
    forest: focusJs('forest', 16),
    mine: focusJs('mine', 14),
    crowd: focusJs('hall', 15),
    far: focusJs('hall', 46),
  };
  for (const s of scenes) {
    if (!setups[s]) { console.log('unknown scene', s, 'of', ALL.join(', ')); continue; }
    await page.evaluate(setups[s]);
    for (const tod of tods) {
      // (plain main has no time of day: the same shots there are the "before" set)
      await page.evaluate((t) => { const r = window.__game.renderer; if (typeof r.setTimeOfDay === 'function') r.setTimeOfDay(/^[0-9.]+$/.test(t) ? Number(t) : t); }, tod);
      await redraw();
      await redraw(); // the sky environment and shadows settle a frame later
      const f = join(out, `${prefix}-${s}-${tod}.png`);
      if (canvasOnly) {
        // grab the drawing buffer in the same task as the draw: no compositor frame needed
        const url = await page.evaluate(() => {
          const g = window.__game;
          g.renderer.update(0);
          g.renderer.render();
          return g.canvas.toDataURL('image/png');
        });
        writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
      } else {
        await page.screenshot({ path: f, timeout: 240000 });
      }
      console.log(f);
    }
  }
  const info = await page.evaluate(() => { const r = window.__game.renderer; return { quality: r.quality, scale: r.renderScale, ...r.stats }; });
  console.log(JSON.stringify(info));
} finally {
  await browser.close();
  server.kill();
}
