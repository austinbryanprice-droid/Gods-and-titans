#!/usr/bin/env node
// Relics (DESIGN 5.11): a fixed-seed solo match. Stills of a camp guarding its relic under the
// beam, the relic lying free once the camp is cleared, a Worshipper carrying it, and the relic over
// the Temple with the selection panel and the relic chip's tooltip.
//   node tools/shot-relics.mjs [--port 8322] [--out DIR] [--prefix relics] [--quality low]
//                              [--seed 4242] [--width 1600] [--height 900]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', '8322'));
const out = opt('out', join(tmpdir(), 'mythicwar-relics'));
const prefix = opt('prefix', 'relics');
const seed = Number(opt('seed', '4242'));
const quality = opt('quality', 'low');
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '900'));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(out, { recursive: true });

const server = spawn(join(root, 'node_modules/.bin/http-server'), ['.', '-p', String(port), '-c-1', '--silent'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text()); });
await page.addInitScript((q) => {
  try {
    const s = JSON.parse(localStorage.getItem('mythicwar-settings') || '{}');
    s.quality = q; s.tipsDismissed = true; s.timeOfDay = 'day'; localStorage.setItem('mythicwar-settings', JSON.stringify(s));
  } catch {}
}, quality);

const render = async (wait = 1500) => {
  await page.evaluate(() => { window.__game.needsRender = true; });
  await page.waitForTimeout(wait);
  await page.evaluate(() => { window.__game.needsRender = true; });
  await page.waitForTimeout(wait);
};
const shot = async (name, clip) => {
  const f = join(out, `${prefix}-${name}.png`);
  await page.screenshot({ path: f, clip, timeout: 240000 });
  console.log(f);
};
/** Let the sim run for `secs` seconds of game time, then hold it. */
const play = async (secs) => {
  await page.evaluate(() => window.__game.setPaused(false));
  await page.waitForFunction((t) => window.__game.viewState.time >= t, (await page.evaluate(() => window.__game.viewState.time)) + secs, { timeout: 240000 });
  await page.evaluate(() => window.__game.setPaused(true));
  await page.waitForTimeout(400);
};
const aim = (x, y, dist) => page.evaluate(({ x, y, dist }) => {
  const r = window.__game.renderer;
  r.camera.centerOn(x, y, false);
  r.camera.setDistance(dist, true);
  r.camera.update(0);
}, { x, y, dist });

try {
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForSelector('.mw-title-screen');
  await page.evaluate(async ({ seed }) => {
    const { startGame } = await import('/src/main.js');
    const { PLAYER_COLORS } = await import('/src/config.js');
    const setup = {
      version: '0.1.0', seed, mapSize: 'small',
      players: [
        { index: 0, name: 'Austin', team: 1, pantheon: 'greek', color: PLAYER_COLORS[0], kind: 'human', difficulty: 'normal' },
        { index: 1, name: 'Player 2', team: 2, pantheon: 'norse', color: PLAYER_COLORS[1], kind: 'ai', difficulty: 'easy' },
      ],
    };
    startGame({ role: 'host', setup, myIndex: 0, conns: new Map(), lobby: { close() {}, setStarted() {} } });
  }, { seed });
  await page.waitForFunction(() => window.__game && window.__game.renderer && window.__game.stats.frames > 3, null, { timeout: 120000 });
  await page.evaluate(() => { const c = document.querySelector('.hud-tips-close'); if (c) c.click(); });

  // The relic camp nearest my Town Center; a Temple and a Worshipper of mine beside it, all in sight.
  const spot = await page.evaluate(() => {
    const g = window.__game;
    const w = g.session.world;
    const tc = w.buildingsOf(0).find((b) => b.type === 'town_center');
    const relics = w.relics.slice().sort((a, b) => Math.hypot(a.x - tc.x, a.y - tc.y) - Math.hypot(b.x - tc.x, b.y - tc.y));
    const r = relics[0];
    g.__relic = r.i;
    const t = w.findPlacement(0, 'temple', r.x + (tc.x - r.x) * 0.35, r.y + (tc.y - r.y) * 0.35, 20);
    const temple = w.createBuilding(0, 'temple', t.tx, t.ty, true, true);
    w.completeBuilding(temple);
    g.__temple = temple.id;
    const scout = w.spawnUnit(0, 'worshipper', r.x + (tc.x - r.x) * 0.25, r.y + (tc.y - r.y) * 0.25, { silent: true });
    g.__worker = scout.id;
    w.reveals.push({ x: r.x, y: r.y, r: 14, team: w.players[0].team, rem: 9999 });
    return { x: r.x, y: r.y, type: r.type, tx: temple.x, ty: temple.y };
  });
  console.log(JSON.stringify(spot));
  await play(1);
  await aim(spot.x, spot.y + 1, 16);
  await render();
  await shot('1-guarded');

  // The camp falls: the relic lies free and pulses.
  await page.evaluate(() => {
    const g = window.__game;
    const w = g.session.world;
    const r = w.relics[g.__relic];
    for (const m of r.camp.members) if (!m.dead) w.killEntity(m, w.entities.get(g.__worker));
  });
  await play(2.5);
  await render();
  await shot('2-free');

  // My Worshipper picks it up (the real smart order) and sets off for the Temple.
  await page.evaluate(() => {
    const g = window.__game;
    const w = g.session.world;
    const r = w.relics[g.__relic];
    const u = w.entities.get(g.__worker);
    u.x = r.x + 1.2;
    u.y = r.y + 0.6;
    w.issueCommand(0, { type: 'smart', units: [u.id], relic: r.i, x: r.x, y: r.y });
  });
  await play(1.5);
  const carrier = await page.evaluate(() => { const g = window.__game; const e = g.viewState.entities.get(g.__worker); return { x: e.x, y: e.y, carried: g.session.world.relics[g.__relic].state }; });
  console.log(JSON.stringify(carrier));
  await page.evaluate(() => { const g = window.__game; g.selection.set([g.__worker]); });
  await aim(carrier.x, carrier.y + 0.5, 11);
  await render();
  await shot('3-carried');

  // In the Temple: over its roof, the panel's relic line and the bonus in the chip.
  await page.waitForTimeout(10);
  await page.evaluate(() => window.__game.setPaused(false));
  await page.waitForFunction(() => { const g = window.__game; return g.session.world.relics[g.__relic].state === 'housed'; }, null, { timeout: 240000 });
  await page.evaluate(() => window.__game.setPaused(true));
  await page.evaluate(() => { const g = window.__game; g.selection.set([g.__temple]); });
  await aim(spot.tx, spot.ty + 1, 15);
  await render();
  await shot('4-housed');
  const chip = await page.evaluate(() => { const n = document.querySelector('.hud-res.is-relic'); return n ? { text: n.textContent, title: n.title, hidden: n.hidden } : null; });
  console.log(JSON.stringify(chip));
  const note = await page.evaluate(() => { const n = document.querySelector('.hi-note.is-relics'); return n ? n.textContent : null; });
  console.log(JSON.stringify(note));
  await shot('5-panel', { x: 0, y: height - 230, width: Math.min(width, 1100), height: 230 });
  await shot('6-top', { x: 0, y: 0, width, height: 60 });
} finally {
  await browser.close();
  server.kill();
}
