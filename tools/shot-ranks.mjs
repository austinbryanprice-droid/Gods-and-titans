#!/usr/bin/env node
// Soldier ranks (DESIGN 5.9): a fixed-seed solo match with one Warrior of each rank lined up
// beside the Town Center (rank pips over the health bars, a buff icon above them), then the
// selection panel for a Veteran Warrior and for a mixed group.
//   node tools/shot-ranks.mjs [--port 8321] [--out DIR] [--prefix ranks] [--quality low]
//                             [--pantheon greek] [--seed 4242] [--width 1600] [--height 900]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', '8321'));
const out = opt('out', join(tmpdir(), 'mythicwar-ranks'));
const prefix = opt('prefix', 'ranks');
const pantheon = opt('pantheon', 'greek');
const seed = Number(opt('seed', '4242'));
const quality = opt('quality', 'low');
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '900'));
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
  await page.evaluate(() => { const c = document.querySelector('.hud-tips-close'); if (c) c.click(); });

  // one Warrior per rank (and an Archer / Priest), standing in a row on the open ground below the hall
  const ids = await page.evaluate(async () => {
    const g = window.__game;
    const world = g.session.world;
    const { RANK_XP } = await import('/src/config.js');
    const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
    const row = [];
    const types = ['warrior', 'warrior', 'warrior', 'warrior', 'archer', 'priest'];
    const ranks = [0, 1, 2, 3, 2, 1];
    types.forEach((t, i) => {
      const u = world.spawnUnit(0, t, tc.x - 3.6 + i * 1.5, tc.y + 6, { silent: true });
      if (!u) return;
      u.order = null;
      world.gainRankXp(u, RANK_XP[ranks[i]]);
      row.push(u.id);
    });
    g.__rankRow = row;
    return row;
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__game.setPaused(true));
  await page.waitForTimeout(300);

  const aim = (dist) => page.evaluate((dist) => {
    const g = window.__game, r = g.renderer, vs = g.viewState;
    const first = vs.entities.get(g.__rankRow[0]);
    const last = vs.entities.get(g.__rankRow[g.__rankRow.length - 1]);
    r.camera.centerOn((first.x + last.x) / 2, first.y, false);
    r.camera.setDistance(dist, true);
    r.camera.update(0);
  }, dist);

  await aim(9);
  await render();
  await shot('row-close');

  // the same row with a buff icon over the Veterans, which makes the status row move up a slot
  await page.evaluate(() => {
    const g = window.__game;
    for (const id of g.__rankRow) { const e = g.viewState.entities.get(id); if (e) e.fx = ['buff']; }
  });
  await aim(14);
  await render();
  await shot('row-mid');

  // the usual playing distance, without the buff icons
  await page.evaluate(() => {
    const g = window.__game;
    for (const id of g.__rankRow) { const e = g.viewState.entities.get(id); if (e) e.fx = []; }
  });
  await aim(26);
  await render();
  await shot('row-far');

  // selection panel: one Veteran Warrior, then the whole row
  await page.evaluate(() => { const g = window.__game; g.selection.set([g.__rankRow[1]]); });
  await render(800);
  await shot('panel-single', { x: 0, y: height - 230, width: Math.min(width, 1100), height: 230 });
  await page.evaluate(() => { const g = window.__game; g.selection.set(g.__rankRow); });
  await render(800);
  await shot('panel-group', { x: 0, y: height - 230, width: Math.min(width, 1100), height: 230 });
  await shot('full');
  console.log(JSON.stringify(ids));
} finally {
  await browser.close();
  server.kill();
}
