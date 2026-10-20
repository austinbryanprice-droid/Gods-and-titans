#!/usr/bin/env node
// Matched before / after captures of the live game (HUD included) for graphics work.
// Starts a fixed-seed solo match, freezes the sim and the render clock at t = 0 (so
// flames, flags and sway are identical between runs), then shoots a fixed set of
// camera setups. Run it on two builds with different --prefix values and compare.
//
//   node tools/shot-fidelity.mjs [--port 8311] [--out DIR] [--prefix before]
//        [--pantheon greek] [--seed 4242] [--quality high] [--scenes world,hall,...]
//        [--width 1600] [--height 900] [--list]
//
// Scenes: world (default zoom on the home base), hall (closest zoom on the town
// center), yard (mid zoom, base + ground), forest (forest edge), mine (gold mine),
// crowd (workers and a few gods at close zoom), far (zoomed out).
// With --perf it also prints the frame stats the game keeps in game.stats.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', '8311'));
const out = opt('out', join(tmpdir(), 'mythicwar-fidelity'));
const prefix = opt('prefix', 'shot');
const pantheon = opt('pantheon', 'greek');
const seed = Number(opt('seed', '4242'));
const quality = opt('quality', 'high');
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '900'));
const ALL = ['world', 'hall', 'yard', 'forest', 'mine', 'crowd', 'far'];
const scenes = opt('scenes', '') ? opt('scenes', '').split(',') : ALL;
if (args.includes('--list')) { console.log(ALL.join('\n')); process.exit(0); }
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
  await page.waitForFunction(() => window.__game && window.__game.renderer && window.__game.stats.frames > 3, null, { timeout: 120000 });
  await page.evaluate(() => { const c = document.querySelector('.hud-tips-close'); if (c) c.click(); window.__game.setPaused(true); });
  await page.waitForTimeout(500);

  const aim = async (js, wait = 2500) => {
    await page.evaluate(js);
    await page.evaluate(() => { window.__game.needsRender = true; });
    await page.waitForTimeout(wait);
    await page.evaluate(() => { window.__game.needsRender = true; });
    await page.waitForTimeout(wait);
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
    if (!setups[s]) { console.log('unknown scene', s); continue; }
    await aim(setups[s]);
    const f = join(out, `${prefix}-${s}.png`);
    await page.screenshot({ path: f, timeout: 240000 });
    console.log(f);
  }
  if (args.includes('--motion')) {
    // unpaused: crops of the hall's yard (fire pit, flags, well) a moment apart, for a motion strip
    await aim(setups.hall, 800);
    await page.evaluate(() => window.__game.setPaused(false));
    const n = Number(opt('motion', '8'));
    for (let i = 0; i < n; i++) {
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(out, `${prefix}-motion-${i}.png`), clip: { x: 560, y: 150, width: 480, height: 340 }, timeout: 240000 });
    }
    console.log(`${prefix}-motion-0..${n - 1}`);
  }
  if (args.includes('--perf')) console.log(JSON.stringify(await page.evaluate(() => window.__game.stats)));
} finally {
  await browser.close();
  server.kill();
}
