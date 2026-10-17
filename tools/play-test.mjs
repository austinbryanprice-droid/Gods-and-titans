#!/usr/bin/env node
// End-to-end play test that drives the REAL UI with the mouse and keyboard.
//
//   node tools/play-test.mjs [--port 8202] [--out DIR] [--only sp,controls,late,online] [--size 1280x720] [--headed]
//
// sp:     title → Play vs AI → Start → the game view appears → click a worshipper → B, H →
//         place a House on a valid spot → construction starts → select the Town Center → W
//         trains → drag-select the workers → right-click the gold mine → gold is mined →
//         F10 → Quit to Menu → start again (the first game is fully torn down) → F10 →
//         Surrender → defeat screen → Return to Menu.
// controls: double-click / shift-click selection, shift+right-click waypoint queue, S stop,
//         A attack-move, Tab subgroups, B/Esc, shift multi-placement, rally, W W + Esc, arrows,
//         wheel, middle-drag, Alt bars, Space, cancelling a construction site.
// late:   (resources and a Temple are granted through the host World) click the Temple →
//         tooltip → Q summons a god → portrait → F1 selects it → ability hotkey + target
//         click → cooldown → Ctrl+1 / . / 1 groups → minimap right-click move and left-click
//         camera jump → chat → the enemy is wiped out → victory screen → Return to Menu.
// online: two tabs over ?transport=local (BroadcastChannel): host + client both reach the
//         game; the client selects a worker and right-clicks the ground; the host's World
//         moves that worker.
// Screenshots go to --out (default: <tmp>/mythicwar-play-test). Prints frame timings.
// Exits non-zero when a check fails or a page logs an error.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const port = Number(opt('port', '8202'));
const out = opt('out', join(tmpdir(), 'mythicwar-play-test'));
const only = opt('only', 'sp,controls,late,online').split(',');
const [VW, VH] = opt('size', '1280x720').split('x').map(Number);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = `http://localhost:${port}/index.html`;
const AI_PRESENT = existsSync(join(root, 'src', 'ai', 'ai.js'));
const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];

mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const errors = [];
let shotN = 0;
let scenario = 'sp';

function ok(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return !!cond;
}

async function shot(page, name) {
  const file = join(out, `${scenario}-${String(++shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function serverUp() {
  try {
    const r = await fetch(base);
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverUp()) return null;
  const bin = join(root, 'node_modules', 'http-server', 'bin', 'http-server');
  const child = spawn(process.execPath, [bin, '.', '-p', String(port), '-c-1', '--silent'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    await wait(200);
    if (await serverUp()) return child;
  }
  child.kill();
  throw new Error(`static server did not start on port ${port}`);
}

function watchErrors(page, tag) {
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(`[${tag}] console: ${t}`);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    // The game probes src/ai/ai.js and falls back to an idle AI while that module does not exist yet.
    if (r.status() === 404 && /\/src\/ai\/ai\.js$/.test(r.url()) && !AI_PRESENT) return;
    errors.push(`[${tag}] http ${r.status()}: ${r.url()}`);
  });
}

/** Wait until the game view is up (renderer + HUD + a few frames). */
async function waitForGame(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const g = window.__game;
    return g && g.renderer && g.hud && g.input && g.stats.frames > 3;
  }, null, { timeout, polling: 200 });
}

/** Screen position of a world point (canvas == viewport). */
function toScreen(page, x, y, h = 0) {
  return page.evaluate(([x, y, h]) => window.__game.renderer.worldToScreen(x, y, h), [x, y, h]);
}

/** Bottom of the clickable 3D view (above the HUD console). */
function viewBottom(page) {
  return page.evaluate(() => document.querySelector('.hud-bottom').getBoundingClientRect().top - 4);
}

/** Wait until the game has drawn n more frames (the software GL can be slow). */
async function frames(page, n = 3) {
  const f0 = await page.evaluate(() => window.__game.stats.frames);
  await page.waitForFunction(([f0, n]) => window.__game && window.__game.stats.frames >= f0 + n, [f0, n], { timeout: 20000, polling: 50 });
}

/** Wait until an overlay's fade-in has finished (CSS animations advance per frame). */
async function settled(page, selector) {
  await page.waitForFunction((sel) => {
    const n = document.querySelector(sel);
    return n && getComputedStyle(n).opacity === '1';
  }, selector, { timeout: 15000, polling: 100 }).catch(() => {});
}

async function step(page, n) {
  await page.evaluate((n) => {
    const s = window.__game.session;
    s.ticker.run(n);
  }, n);
}

// ---------------------------------------------------------------- single player

async function singlePlayer(browser) {
  console.log('single player:');
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  const page = await ctx.newPage();
  watchErrors(page, 'sp');
  await page.goto(base);
  await page.waitForSelector('.mw-title-screen');
  await shot(page, 'title');
  await page.click('text=Play vs AI');
  await page.waitForSelector('.mw-lobby', { timeout: 8000 });
  await page.click('.mw-btn--start');
  const t0 = Date.now();
  await waitForGame(page);
  ok('game view appears', true, `${Date.now() - t0} ms after Start`);
  await wait(800);
  await shot(page, 'game-start');
  ok('no console errors at start', errors.length === 0, errors.slice(0, 3).join(' | '));
  const hudOk = await page.evaluate(() => !!document.querySelector('.hud-top .hud-res.is-gold') && document.querySelectorAll('.hc-btn').length === 12 && !!document.querySelector('.hud-minimap-canvas'));
  ok('HUD built (resources, 12 card slots, minimap)', hudOk);

  // ---- select a worshipper by clicking it
  const bottom = await viewBottom(page);
  const worker = await page.evaluate((bottom) => {
    const g = window.__game;
    const vs = g.viewState;
    const out = [];
    for (const e of vs.entities.values()) {
      if (e.k !== 'u' || e.o !== vs.myIndex || e.t !== 'worshipper') continue;
      const p = g.renderer.worldToScreen(e.ix ?? e.x, e.iy ?? e.y, 0.45);
      if (p.onScreen && p.sy < bottom && p.sy > 40) out.push({ id: e.id, sx: p.sx, sy: p.sy });
    }
    return out;
  }, bottom);
  ok('worshippers visible on screen', worker.length >= 3, `${worker.length}`);
  const w0 = worker[0];
  await page.mouse.move(w0.sx, w0.sy);
  await wait(150);
  await page.mouse.click(w0.sx, w0.sy);
  await wait(300);
  const sel1 = await page.evaluate(() => window.__game.selection.entities().map((e) => e.t));
  ok('clicking a worshipper selects it', sel1.length === 1 && sel1[0] === 'worshipper', sel1.join(','));
  await shot(page, 'worker-selected');

  // ---- B, H: place a House
  await page.keyboard.press('b');
  await wait(150);
  const buildCard = await page.evaluate(() => [...document.querySelectorAll('.hc-btn')].map((b) => b.dataset.id || '').filter(Boolean));
  ok('B opens the build menu', buildCard.includes('build:house') && buildCard.includes('build:temple'), buildCard.join(','));
  await shot(page, 'build-menu');
  await page.keyboard.press('h');
  await wait(100);
  const mode = await page.evaluate(() => window.__game.input.mode.kind);
  ok('H enters placement mode', mode === 'place', mode);
  const spot = await page.evaluate(async (bottom) => {
    const { checkPlacement } = await import('/src/game/placement.js');
    const g = window.__game;
    const vs = g.viewState;
    const tc = [...vs.entities.values()].find((e) => e.k === 'b' && e.o === vs.myIndex && e.t === 'town_center');
    const cands = [];
    for (let dy = -9; dy <= 9; dy++) {
      for (let dx = -9; dx <= 9; dx++) {
        const tx = tc.tx + dx;
        const ty = tc.ty + dy;
        const c = checkPlacement(vs, vs.myIndex, 'house', tx, ty);
        if (!c.valid) continue;
        // keep a free ring so units are not trapped
        let ring = true;
        for (let y = ty - 1; y <= ty + 2 && ring; y++) for (let x = tx - 1; x <= tx + 2; x++) if (!checkPlacement(vs, vs.myIndex, 'house', x, y).valid && (x < tx || y < ty || x > tx + 1 || y > ty + 1)) { ring = false; break; }
        const p = g.renderer.worldToScreen(tx + 1, ty + 1, 0);
        if (!p.onScreen || p.sy > bottom - 30 || p.sy < 60 || p.sx < 60 || p.sx > innerWidth - 60) continue;
        cands.push({ tx, ty, sx: p.sx, sy: p.sy, d: Math.hypot(dx, dy), ring });
      }
    }
    cands.sort((a, b) => (b.ring - a.ring) || a.d - b.d);
    return cands[0] || null;
  }, bottom);
  ok('found a valid house spot on screen', !!spot, spot ? `${spot.tx},${spot.ty}` : '');
  const before = await page.evaluate(() => {
    const vs = window.__game.viewState;
    return { gold: vs.me.gold, wood: vs.me.wood, houses: [...vs.entities.values()].filter((e) => e.k === 'b' && e.t === 'house' && e.o === vs.myIndex).length };
  });
  await page.mouse.move(spot.sx, spot.sy);
  await wait(400);
  const ghost = await page.evaluate(() => !!(window.__game.renderer.placement && window.__game.renderer.placement.visible !== false));
  await shot(page, 'house-ghost');
  ok('placement ghost follows the cursor', ghost);
  await page.mouse.click(spot.sx, spot.sy);
  await wait(200);
  const after = await page.evaluate(() => window.__game.input.mode.kind);
  ok('placing returns to normal mode', after === 'normal', after);
  let started = false;
  for (let i = 0; i < 40 && !started; i++) {
    await wait(250);
    started = await page.evaluate((n0) => {
      const vs = window.__game.viewState;
      return [...vs.entities.values()].filter((e) => e.k === 'b' && e.t === 'house' && e.o === vs.myIndex).length > n0;
    }, before.houses);
  }
  const paid = await page.evaluate(() => window.__game.viewState.me.gold);
  ok('house construction starts in the ViewState', started, `gold ${before.gold} → ${paid}`);
  await shot(page, 'house-construction');

  // ---- select the Town Center, W trains a worshipper
  const tcPos = await page.evaluate(() => {
    const g = window.__game;
    const vs = g.viewState;
    const tc = [...vs.entities.values()].find((e) => e.k === 'b' && e.o === vs.myIndex && e.t === 'town_center');
    return { id: tc.id, ...g.renderer.worldToScreen(tc.x, tc.y, 1.2) };
  });
  await page.mouse.click(tcPos.sx, tcPos.sy);
  await wait(300);
  const selTc = await page.evaluate(() => window.__game.selection.ids);
  ok('clicking the Town Center selects it', selTc.length === 1 && selTc[0] === tcPos.id, JSON.stringify(selTc));
  await page.keyboard.press('w');
  let queued = 0;
  for (let i = 0; i < 20 && !queued; i++) {
    await wait(150);
    queued = await page.evaluate((id) => (window.__game.viewState.entities.get(id).q || []).length, tcPos.id);
  }
  ok('W queues a worshipper at the Town Center', queued >= 1, `queue ${queued}`);
  await wait(300);
  await shot(page, 'tc-training');

  // ---- drag-select the idle workers, right-click the gold mine
  const box = await page.evaluate((bottom) => {
    const g = window.__game;
    const vs = g.viewState;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let n = 0;
    for (const e of vs.entities.values()) {
      if (e.k !== 'u' || e.o !== vs.myIndex || e.t !== 'worshipper' || e.bo || e.st === 'build') continue;
      const p = g.renderer.worldToScreen(e.ix ?? e.x, e.iy ?? e.y, 0.4);
      if (!p.onScreen || p.sy > bottom) continue;
      x0 = Math.min(x0, p.sx);
      y0 = Math.min(y0, p.sy);
      x1 = Math.max(x1, p.sx);
      y1 = Math.max(y1, p.sy);
      n++;
    }
    return { x0: Math.max(2, x0 - 28), y0: Math.max(40, y0 - 34), x1: Math.min(innerWidth - 2, x1 + 28), y1: Math.min(bottom - 2, y1 + 28), n };
  }, bottom);
  await page.mouse.move(box.x0, box.y0);
  await page.mouse.down();
  await page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { steps: 4 });
  await page.mouse.move(box.x1, box.y1, { steps: 4 });
  await shot(page, 'drag-box');
  await page.mouse.up();
  await wait(250);
  const workers = await page.evaluate(() => window.__game.selection.entities().filter((e) => e.t === 'worshipper').map((e) => e.id));
  ok('drag box selects the idle worshippers', workers.length >= Math.min(3, box.n), `${workers.length} of ${box.n}`);
  const mine = await page.evaluate(() => {
    const g = window.__game;
    const vs = g.viewState;
    const tc = [...vs.entities.values()].find((e) => e.k === 'b' && e.o === vs.myIndex && e.t === 'town_center');
    let best = null;
    for (const e of vs.entities.values()) {
      if (e.k !== 'm') continue;
      const d = Math.hypot(e.x - tc.x, e.y - tc.y);
      if (!best || d < best.d) best = { id: e.id, x: e.x, y: e.y, d };
    }
    return { ...best, ...g.renderer.worldToScreen(best.x, best.y, 0.8) };
  });
  const gold0 = await page.evaluate(() => ({ gold: window.__game.viewState.me.gold, gathered: window.__game.viewState.me.stats.gathered }));
  await page.mouse.click(mine.sx, mine.sy, { button: 'right' });
  await wait(600);
  const orders = await page.evaluate(([ids, mineId]) => {
    const w = window.__game.session.world;
    return ids.map((id) => {
      const u = w.getEntity(id);
      return u && u.order ? `${u.order.type}:${u.order.mine === mineId ? 'mine' : '?'}` : 'none';
    });
  }, [workers, mine.id]);
  ok('right-click on the mine orders the workers to gather', orders.length > 0 && orders.every((o) => o === 'gather:mine'), orders.join(','));
  await shot(page, 'workers-to-mine');
  await wait(4000);
  await step(page, 400); // 20 more seconds of game time
  await wait(500);
  const gold1 = await page.evaluate(() => ({ gold: window.__game.viewState.me.gold, gathered: window.__game.viewState.me.stats.gathered }));
  ok('resources rise after some game time', gold1.gathered > gold0.gathered && gold1.gold > gold0.gold, `gold ${gold0.gold} → ${gold1.gold}, gathered ${gold0.gathered} → ${gold1.gathered}`);
  await shot(page, 'mining');

  // ---- timing
  const timing = await page.evaluate(() => ({ game: window.__game.timing(), render: window.__game.renderer.getStats ? window.__game.renderer.getStats() : null }));
  console.log(`  frame timing: ${JSON.stringify(timing.game, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))}`);
  if (timing.render) console.log(`  renderer: ${JSON.stringify(timing.render, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))}`);

  // ---- F10 → Quit to Menu
  await page.keyboard.press('F10');
  await page.waitForSelector('.hud-overlay.is-menu', { timeout: 3000 });
  const paused = await page.evaluate(() => window.__game.paused);
  ok('F10 opens the game menu (single player pauses)', paused === true);
  await settled(page, '.hud-overlay.is-menu');
  await shot(page, 'game-menu');
  await page.click('.hud-overlay.is-menu button:text-is("Quit to Menu")');
  await page.waitForSelector('.hud-overlay.is-confirm', { timeout: 3000 });
  await settled(page, '.hud-overlay.is-confirm');
  await shot(page, 'quit-confirm');
  await page.evaluate(() => {
    window.__oldGame = window.__game;
  });
  await page.click('.hud-overlay.is-confirm button:text-is("Quit")');
  await page.waitForSelector('.mw-title-screen', { timeout: 5000 });
  const torn = await page.evaluate(() => ({
    game: window.__game,
    disposed: window.__oldGame.disposed,
    renderer: window.__oldGame.renderer,
    hud: document.getElementById('hud-root').childElementCount,
    hidden: document.getElementById('game-root').hidden,
    stopped: window.__oldGame.session.stopped,
  }));
  ok('Quit returns to the title and tears the game down', !torn.game && torn.disposed && !torn.renderer && torn.hud === 0 && torn.hidden && torn.stopped, JSON.stringify(torn));
  await shot(page, 'back-to-title');

  // ---- start again
  await page.click('text=Play vs AI');
  await page.waitForSelector('.mw-lobby', { timeout: 8000 });
  await page.click('.mw-btn--start');
  await waitForGame(page);
  await wait(1200);
  const second = await page.evaluate(() => ({
    frames: window.__game.stats.frames,
    oldFrames: window.__oldGame.stats.frames,
    hudKids: document.getElementById('hud-root').childElementCount,
  }));
  await wait(500);
  const oldStill = await page.evaluate((n) => window.__oldGame.stats.frames === n, second.oldFrames);
  ok('a second game starts cleanly; the old loop is dead', second.frames > 3 && oldStill, JSON.stringify(second));
  await shot(page, 'second-game');
  // Surrender through the menu: defeat screen, then back to the title.
  await page.keyboard.press('F10');
  await page.click('.hud-overlay.is-menu button:text-is("Surrender")');
  await page.waitForSelector('.hud-overlay.is-confirm', { timeout: 3000 });
  await page.click('.hud-overlay.is-confirm button:text-is("Surrender")');
  await page.waitForSelector('.hud-overlay.is-gameover', { timeout: 10000 }).catch(() => {});
  await wait(500);
  const lost = await page.evaluate(() => document.querySelector('.hud-overlay.is-gameover')?.textContent || '');
  ok('surrender ends the game with the defeat screen', /defeat/i.test(lost), lost.slice(0, 60));
  await settled(page, '.hud-overlay.is-gameover');
  await shot(page, 'surrender-defeat');
  await page.click('.hud-overlay.is-gameover button:text-is("Return to Menu")');
  await page.waitForSelector('.mw-title-screen', { timeout: 5000 });
  ok('no page errors in single player', errors.filter((e) => e.startsWith('[sp]')).length === 0, errors.filter((e) => e.startsWith('[sp]')).slice(0, 4).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- controls (selection, orders, camera)

/** Screen positions of own entities matching a filter source (evaluated in the page). */
function ownOnScreen(page, filterSrc) {
  return page.evaluate((src) => {
    const g = window.__game;
    const vs = g.viewState;
    // eslint-disable-next-line no-new-func
    const f = new Function('e', `return (${src});`);
    const bottom = document.querySelector('.hud-bottom').getBoundingClientRect().top - 4;
    const out = [];
    for (const e of vs.entities.values()) {
      if (e.o !== vs.myIndex || !f(e)) continue;
      const p = g.renderer.worldToScreen(e.ix ?? e.x, e.iy ?? e.y, e.k === 'b' ? 1.2 : 0.45);
      if (p.onScreen && p.sy < bottom && p.sy > 40) out.push({ id: e.id, t: e.t, sx: p.sx, sy: p.sy, x: e.x, y: e.y });
    }
    return out;
  }, filterSrc);
}

function worldUnit(page, id) {
  return page.evaluate((id) => {
    const u = window.__game.session.world.getEntity(id);
    if (!u) return null;
    const o = (x) => (x ? { type: x.type, x: x.x, y: x.y } : null);
    return { order: o(u.order), orders: (u.orders || []).map(o), x: u.x, y: u.y };
  }, id);
}

async function controls(browser) {
  console.log('controls (selection, orders, queues, camera):');
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  const page = await ctx.newPage();
  watchErrors(page, 'ctl');
  await page.goto(base);
  await page.waitForSelector('.mw-title-screen');
  await page.click('text=Play vs AI');
  await page.waitForSelector('.mw-lobby', { timeout: 8000 });
  await page.click('.mw-btn--start');
  await waitForGame(page);
  await page.mouse.move(VW / 2, VH / 3);
  await wait(500);

  // Double-click a worker: every worker on screen.
  const ws = await ownOnScreen(page, "e.k === 'u' && e.t === 'worshipper'");
  await page.mouse.dblclick(ws[0].sx, ws[0].sy);
  await wait(300);
  const all = await page.evaluate(() => window.__game.selection.ids.length);
  ok('double-click selects every worker on screen', all === ws.length, `${all} of ${ws.length}`);
  // Shift-click removes one.
  await page.keyboard.down('Shift');
  await page.mouse.click(ws[1].sx, ws[1].sy);
  await page.keyboard.up('Shift');
  await wait(250);
  const less = await page.evaluate(() => window.__game.selection.ids);
  ok('shift-click toggles a unit out of the selection', less.length === all - 1 && !less.includes(ws[1].id), `${less.length}`);

  // Single worker: right-click, then shift+right-click queues a waypoint.
  await page.mouse.click(ws[0].sx, ws[0].sy);
  await wait(200);
  const tc = (await ownOnScreen(page, "e.k === 'b' && e.t === 'town_center'"))[0];
  const a = await toScreen(page, tc.x + 5, tc.y + 5, 0);
  const b = await toScreen(page, tc.x + 8, tc.y + 2, 0);
  await page.mouse.click(a.sx, a.sy, { button: 'right' });
  await page.keyboard.down('Shift');
  await page.mouse.click(b.sx, b.sy, { button: 'right' });
  await page.keyboard.up('Shift');
  await wait(400);
  let u = await worldUnit(page, ws[0].id);
  ok('shift+right-click queues a second move', u.order && u.orders.length >= 1, JSON.stringify({ order: u.order, orders: u.orders }));
  await shot(page, 'queued-moves');
  // S stops.
  await page.keyboard.press('s');
  await wait(300);
  u = await worldUnit(page, ws[0].id);
  ok('S stops and clears the queue', !u.order && u.orders.length === 0, JSON.stringify(u.order));
  // A + left-click: attack-move.
  await page.keyboard.press('a');
  await wait(100);
  const amode = await page.evaluate(() => window.__game.input.mode);
  await page.mouse.click(a.sx, a.sy);
  await wait(400);
  u = await worldUnit(page, ws[0].id);
  ok('A then left-click issues an attack-move', amode.kind === 'target' && u.order && /attack/i.test(u.order.type), `${JSON.stringify(amode)} → ${JSON.stringify(u.order)}`);

  // Mixed selection + Tab.
  const wid = await cheat(page, `
    const tc = w.buildingsOf(vs.myIndex).find((b) => b.type === 'town_center');
    return [w.spawnUnit(vs.myIndex, 'warrior', tc.x + 4, tc.y + 3).id, w.spawnUnit(vs.myIndex, 'warrior', tc.x + 4.8, tc.y + 3.4).id];`);
  await step(page, 2);
  await frames(page, 3);
  await page.evaluate((ids) => window.__game.selection.set(ids), [...wid, ws[0].id, ws[2].id]);
  await wait(250);
  const act0 = await page.evaluate(() => window.__game.selection.activeType);
  const card0 = await page.evaluate(() => window.__game.hud.currentCard().filter(Boolean).map((b) => b.id).join(','));
  await page.keyboard.press('Tab');
  await wait(250);
  const act1 = await page.evaluate(() => window.__game.selection.activeType);
  const card1 = await page.evaluate(() => window.__game.hud.currentCard().filter(Boolean).map((b) => b.id).join(','));
  ok('Tab cycles the active subgroup and its card', act0 === 'warrior' && act1 === 'worshipper' && !/build/.test(card0) && /build/.test(card1), `${act0} → ${act1}`);
  await shot(page, 'mixed-selection');

  // Build menu: B opens, Esc goes back.
  await page.keyboard.press('b');
  await wait(100);
  const inBuild = await page.evaluate(() => window.__game.input.cardMode());
  await page.keyboard.press('Escape');
  await wait(100);
  const back = await page.evaluate(() => window.__game.input.cardMode());
  ok('Esc leaves the build menu', inBuild === 'build' && back === 'root', `${inBuild} → ${back}`);

  // Shift multi-placement: two houses with one worker.
  await page.mouse.click(ws[2].sx, ws[2].sy);
  await wait(200);
  const spots = await page.evaluate(async () => {
    const { checkPlacement } = await import('/src/game/placement.js');
    const g = window.__game;
    const vs = g.viewState;
    const tc = [...vs.entities.values()].find((e) => e.k === 'b' && e.o === vs.myIndex && e.t === 'town_center');
    const res = [];
    const bottom = document.querySelector('.hud-bottom').getBoundingClientRect().top - 30;
    for (let dy = 4; dy <= 10 && res.length < 2; dy++) {
      for (let dx = -8; dx <= 8 && res.length < 2; dx++) {
        const tx = tc.tx + dx;
        const ty = tc.ty + dy;
        if (res.some((r) => Math.abs(r.tx - tx) < 4 && Math.abs(r.ty - ty) < 4)) continue;
        if (!checkPlacement(vs, vs.myIndex, 'house', tx, ty).valid) continue;
        const p = g.renderer.worldToScreen(tx + 1, ty + 1, 0);
        if (!p.onScreen || p.sy > bottom || p.sy < 60) continue;
        res.push({ tx, ty, sx: p.sx, sy: p.sy });
      }
    }
    return res;
  });
  const gold0 = await page.evaluate(() => window.__game.viewState.me.gold);
  await page.keyboard.press('b');
  await page.keyboard.press('h');
  await page.keyboard.down('Shift');
  await page.mouse.move(spots[0].sx, spots[0].sy);
  await wait(150);
  await page.mouse.click(spots[0].sx, spots[0].sy);
  await wait(150);
  const stillPlacing = await page.evaluate(() => window.__game.input.mode.kind);
  await page.mouse.move(spots[1].sx, spots[1].sy);
  await wait(150);
  await shot(page, 'shift-placement');
  await page.mouse.click(spots[1].sx, spots[1].sy);
  await page.keyboard.up('Shift');
  await wait(200);
  const afterShift = await page.evaluate(() => window.__game.input.mode.kind);
  await wait(400);
  u = await worldUnit(page, ws[2].id);
  const builds = [u.order, ...u.orders].filter((o) => o && o.type === 'build').length;
  ok('shift keeps placing; one worker queues both houses', stillPlacing === 'place' && afterShift === 'normal' && builds === 2, `${stillPlacing}/${afterShift}, build orders ${builds}, gold ${gold0}`);

  // Town Center: right-click sets the rally point; W W queues two; Esc cancels the last.
  await page.mouse.click(tc.sx, tc.sy);
  await wait(200);
  const r = await toScreen(page, tc.x - 4, tc.y + 5, 0);
  await page.mouse.click(r.sx, r.sy, { button: 'right' });
  await page.keyboard.press('w');
  await page.keyboard.press('w');
  let tcv = null;
  for (let i = 0; i < 15; i++) {
    await wait(150);
    tcv = await page.evaluate((id) => {
      const e = window.__game.viewState.entities.get(id);
      return { q: (e.q || []).length, rp: e.rp };
    }, tc.id);
    if (tcv.q === 2 && tcv.rp) break;
  }
  const rp = Array.isArray(tcv.rp) ? { x: tcv.rp[0], y: tcv.rp[1] } : tcv.rp;
  ok('right-click with a Town Center sets its rally point', !!rp && Math.hypot(rp.x - (tc.x - 4), rp.y - (tc.y + 5)) < 2, JSON.stringify(tcv.rp));
  ok('W twice queues two worshippers', tcv.q === 2, `queue ${tcv.q}`);
  await shot(page, 'tc-queue-rally');
  await page.keyboard.press('Escape');
  let q1 = 2;
  for (let i = 0; i < 15 && q1 !== 1; i++) {
    await wait(150);
    q1 = await page.evaluate((id) => (window.__game.viewState.entities.get(id).q || []).length, tc.id);
  }
  ok('Esc cancels the last queued unit', q1 === 1, `queue ${q1}`);

  // Camera: arrows, wheel, middle-drag, Alt bars.
  const cam = () => page.evaluate(() => {
    const c = window.__game.renderer.camera;
    return { x: c.target.x, y: c.target.y, d: c.goalDistance ?? c.distance };
  });
  const c0 = await cam();
  await page.keyboard.down('ArrowRight');
  await wait(400);
  await frames(page, 6); // held across several frames, however slow they are
  await page.keyboard.up('ArrowRight');
  await wait(300);
  const c1 = await cam();
  ok('arrow keys scroll the camera', c1.x - c0.x > 2, `${c0.x.toFixed(1)} → ${c1.x.toFixed(1)}`);
  await page.mouse.move(VW / 2, VH / 3);
  await page.mouse.wheel(0, 300);
  await wait(300);
  const c2 = await cam();
  ok('mouse wheel zooms', c2.d !== c1.d, `${c1.d.toFixed(1)} → ${c2.d.toFixed(1)}`);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(VW / 2 - 200, VH / 3, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await wait(200);
  const c3 = await cam();
  ok('middle-drag pans the camera', c3.x - c2.x > 2, `${c2.x.toFixed(1)} → ${c3.x.toFixed(1)}`);
  await page.keyboard.down('Alt');
  await wait(150);
  const barsOn = await page.evaluate(() => window.__game.renderer.showAllBars);
  await page.keyboard.up('Alt');
  await wait(150);
  const barsOff = await page.evaluate(() => window.__game.renderer.showAllBars);
  ok('holding Alt shows every health bar', barsOn === true && barsOff === false, `${barsOn}/${barsOff}`);
  // Space jumps back to the last alert or the selection.
  await page.keyboard.press('Space');
  await wait(300);
  const c4 = await cam();
  ok('Space centres on the selection', Math.hypot(c4.x - tc.x, c4.y - tc.y) < 6, `${c4.x.toFixed(1)},${c4.y.toFixed(1)} vs TC ${tc.x},${tc.y}`);

  // Cancel a construction site: select it, Esc refunds. Park every worker first so
  // the site does not finish (and nothing else spends gold) meanwhile.
  await step(page, 60);
  await cheat(page, `
    for (const u of w.unitsOf(vs.myIndex)) w.setOrder(u, null);
    const me = vs.myIndex;
    if (!w.buildingsOf(me).some((b) => b.type === 'house' && !b.constructed)) {
      const tc = w.buildingsOf(me).find((b) => b.type === 'town_center');
      const s = w.findPlacement(me, 'house', tc.x - 5, tc.y + 4, 20);
      w.createBuilding(me, 'house', s.tx, s.ty, false);
    }
    return true;`);
  await step(page, 2);
  await frames(page, 3);
  const site = await page.evaluate(() => {
    const g = window.__game;
    const vs = g.viewState;
    const e = [...vs.entities.values()].find((x) => x.k === 'b' && x.o === vs.myIndex && x.t === 'house' && x.bp < 1);
    return e ? { id: e.id, ...g.renderer.worldToScreen(e.x, e.y, 0.6) } : null;
  });
  if (site) {
    await page.evaluate((id) => {
      const g = window.__game;
      const e = g.viewState.entities.get(id);
      g.renderer.camera.centerOn(e.x, e.y + 1);
    }, site.id);
    await frames(page, 3);
    // A point on the site that no unit covers.
    const sp = await page.evaluate((id) => {
      const g = window.__game;
      const e = g.viewState.entities.get(id);
      for (const h of [0.6, 0.3, 1, 1.4]) {
        for (const [dx, dy] of [[0, 0], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) {
          const p = g.renderer.worldToScreen(e.x + dx, e.y + dy, h);
          if (g.renderer.pickEntity(p.sx, p.sy) === id) return p;
        }
      }
      return g.renderer.worldToScreen(e.x, e.y, 0.6);
    }, site.id);
    await page.mouse.click(sp.sx, sp.sy);
    await wait(250);
    const siteCard = await page.evaluate(() => window.__game.hud.currentCard().filter(Boolean).map((b) => b.id).join(','));
    await shot(page, 'construction-site');
    const goldA = await page.evaluate(() => window.__game.viewState.me.gold);
    await page.keyboard.press('Escape');
    let gone = false;
    for (let i = 0; i < 30 && !gone; i++) {
      await wait(150);
      gone = await page.evaluate((id) => !window.__game.viewState.entities.has(id), site.id);
    }
    await step(page, 1);
    await wait(300);
    const goldB = await page.evaluate(() => window.__game.viewState.me.gold);
    ok('Esc on a construction site cancels it with a refund', /cancel-build/.test(siteCard) && gone && goldB > goldA, `${siteCard} gone ${gone}, gold ${goldA} → ${goldB}`);
  } else {
    ok('a construction site to cancel exists', false);
  }
  ok('no page errors in the controls test', errors.filter((e) => e.startsWith('[ctl]')).length === 0, errors.filter((e) => e.startsWith('[ctl]')).slice(0, 4).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- late game (gods, abilities, groups, victory)

/** Run a function against the host World inside the page (test setup only). */
function cheat(page, fn, arg) {
  return page.evaluate(([src, arg]) => {
    const g = window.__game;
    // eslint-disable-next-line no-new-func
    return new Function('g', 'w', 'vs', 'arg', src)(g, g.session.world, g.viewState, arg);
  }, [fn, arg]);
}

async function lateGame(browser) {
  console.log('late game (temple, god, abilities, groups, minimap, victory):');
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  const page = await ctx.newPage();
  watchErrors(page, 'late');
  await page.goto(base);
  await page.waitForSelector('.mw-title-screen');
  await page.click('text=Play vs AI');
  await page.waitForSelector('.mw-lobby', { timeout: 8000 });
  await page.click('.mw-btn--start');
  await waitForGame(page);
  await wait(500);

  // Setup through the host World: riches, a finished Shrine and Temple near the Town Center.
  const setup = await cheat(page, `
    const me = vs.myIndex;
    const p = w.players[me];
    p.gold = 9000; p.wood = 9000; p.faith = 3000;
    const tc = w.buildingsOf(me).find((b) => b.type === 'town_center');
    const out = {};
    for (const t of ['house', 'house', 'shrine', 'temple']) {
      const spot = w.findPlacement(me, t, tc.x + 6, tc.y + 2, 20);
      if (!spot) return { err: 'no spot for ' + t };
      const b = w.createBuilding(me, t, spot.tx, spot.ty, true);
      out[t] = b.id;
    }
    w.recomputePopCap(me);
    w.recomputeTier(me);
    return { ...out, pantheon: w.setup.players[me].pantheon };
  `);
  ok('setup: shrine and temple built', setup && setup.temple, JSON.stringify(setup));
  await step(page, 2);
  await frames(page, 4);

  // Select the Temple with a real click.
  await page.evaluate((id) => {
    const g = window.__game;
    const e = g.viewState.entities.get(id);
    g.renderer.camera.centerOn(e.x, e.y + 2);
  }, setup.temple);
  await frames(page, 3);
  const tp = await page.evaluate((id) => {
    const g = window.__game;
    const e = g.viewState.entities.get(id);
    return g.renderer.worldToScreen(e.x, e.y, 1.5);
  }, setup.temple);
  await page.mouse.click(tp.sx, tp.sy);
  await wait(300);
  const templeSel = await page.evaluate(() => window.__game.selection.entities().map((e) => `${e.id}:${e.t}`).join(','));
  if (!ok('clicking the Temple selects it', templeSel === `${setup.temple}:temple`, templeSel)) {
    const dbg = await page.evaluate(([x, y, id]) => {
      const g = window.__game;
      const e = g.viewState.entities.get(id);
      const hit = g.renderer.pickEntity(x, y);
      return { tp: [x, y], ent: e && { x: e.x, y: e.y, bp: e.bp, st: e.st }, hit: hit && (hit.id ?? hit), mode: g.input.mode.kind, el: document.elementFromPoint(x, y)?.className };
    }, [tp.sx, tp.sy, setup.temple]);
    console.log('   debug', JSON.stringify(dbg));
    await shot(page, 'temple-miss');
  }
  const templeCard = await page.evaluate(() => [...document.querySelectorAll('.hc-btn')].map((b) => b.dataset.id || '').filter(Boolean));
  const gods = templeCard.filter((id) => id.startsWith('train:'));
  ok('the Temple card offers four gods', gods.length === 4, templeCard.join(','));
  // Hover the first god for its tooltip.
  const godBtn = await page.$('.hc-btn[data-id^="train:"]');
  await godBtn.hover();
  await wait(350);
  const tip = await page.evaluate(() => {
    const t = document.querySelector('.hud-tip');
    return t && !t.hidden && getComputedStyle(t).display !== 'none' ? t.textContent : '';
  });
  ok('hovering a card button shows its tooltip', tip.length > 10, tip.slice(0, 70));
  await shot(page, 'temple-card');
  await page.mouse.move(VW / 2, 200);

  // Q summons the first god.
  await page.keyboard.press('q');
  let q = 0;
  for (let i = 0; i < 20 && !q; i++) {
    await wait(150);
    q = await page.evaluate((id) => (window.__game.viewState.entities.get(id).q || []).length, setup.temple);
  }
  ok('Q starts summoning a god', q === 1, `queue ${q}`);
  await step(page, 20 * 70);
  let godId = null;
  for (let i = 0; i < 30 && !godId; i++) {
    await wait(200);
    godId = await page.evaluate(() => (document.querySelector('.hud-god') ? window.__game.hud.ownGods().map((g) => g.id)[0] : null));
  }
  ok('the god appears with a portrait button', !!godId, `${godId}`);

  // F1 selects the god; the card shows its abilities.
  await page.keyboard.press('F1');
  await wait(300);
  const godSel = await page.evaluate(() => window.__game.selection.ids);
  ok('F1 selects the god', godSel.length === 1 && godSel[0] === godId, JSON.stringify(godSel));
  await page.keyboard.press('F1'); // double-tap centres the camera on it
  await wait(400);
  const abil = await page.evaluate(() => window.__game.hud.currentCard().filter((b) => b && b.id && b.id.startsWith('ability:')).map((b) => ({ id: b.id, key: b.key, state: b.state, target: b.action && b.action.kind, reason: b.reason || '', level: b.level })));
  ok('the god card shows abilities with level locks', abil.length >= 3 && abil.some((a) => a.state === 'locked'), abil.map((a) => `${a.key}:${a.state}`).join(' '));
  await shot(page, 'god-selected');

  // Cast the first ready ability with its hotkey (target on the ground or an enemy).
  const first = abil.find((a) => a.state === 'ready');
  const godPos = await page.evaluate((id) => {
    const g = window.__game;
    const e = g.viewState.entities.get(id);
    return { x: e.x, y: e.y };
  }, godId);
  const needsEnemy = await page.evaluate((id) => {
    const b = window.__game.hud.currentCard().find((c) => c && c.id === id);
    return b && b.action && /enemy|unit/.test(b.action.target || '') ? b.action.target : null;
  }, first.id);
  let enemyId = null;
  if (needsEnemy) {
    enemyId = await cheat(page, `
      const foe = w.setup.players.find((p) => p.index !== vs.myIndex).index;
      const u = w.spawnUnit(foe, 'worshipper', arg.x + 3, arg.y + 1);
      return u.id;`, godPos);
    await step(page, 2);
    await wait(300);
  }
  await page.keyboard.press(first.key.toLowerCase());
  await wait(150);
  const modeNow = await page.evaluate(() => window.__game.input.mode.kind);
  const cdBefore = await page.evaluate((id) => {
    const w = window.__game.session.world;
    const u = w.getEntity(id);
    return JSON.stringify(u.cooldowns || u.cd || {});
  }, godId);
  if (modeNow === 'target') {
    const tgt = enemyId
      ? await page.evaluate((id) => {
        const g = window.__game;
        const e = g.viewState.entities.get(id);
        return g.renderer.worldToScreen(e.ix ?? e.x, e.iy ?? e.y, 0.5);
      }, enemyId)
      : await toScreen(page, godPos.x + 3, godPos.y + 1, 0);
    await page.mouse.move(tgt.sx, tgt.sy);
    await wait(200);
    await shot(page, 'ability-targeting');
    await page.mouse.click(tgt.sx, tgt.sy);
  }
  let cast = false;
  for (let i = 0; i < 25 && !cast; i++) {
    await wait(200);
    await step(page, 4);
    cast = await page.evaluate(([id, abId]) => {
      const e = window.__game.viewState.entities.get(id);
      return !!(e && e.cd && e.cd[abId] > 0);
    }, [godId, first.id.slice('ability:'.length)]);
  }
  ok(`casting ${first.id.split('_').slice(1).join(' ')} with ${first.key} puts it on cooldown`, cast, `mode ${modeNow}, cd before ${cdBefore}`);
  await wait(300);
  await shot(page, 'ability-cast');

  // Control groups: Ctrl+1 on the god, select something else, 1 recalls it.
  await page.keyboard.down('Control');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace'); // camera to the Town Center
  await wait(300);
  await page.keyboard.press('Period'); // idle worker
  await wait(200);
  const idleSel = await page.evaluate(() => window.__game.selection.entities().map((e) => e.t));
  ok('. selects an idle worker', idleSel.length === 1 && idleSel[0] === 'worshipper', idleSel.join(','));
  await page.keyboard.press('Digit1');
  await wait(200);
  const grp = await page.evaluate(() => window.__game.selection.ids);
  ok('1 recalls the control group', grp.length === 1 && grp[0] === godId, JSON.stringify(grp));

  // Minimap: right-click orders a move there; left-click moves the camera.
  const mm = await page.evaluate(() => {
    const r = document.querySelector('.hud-minimap-canvas').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, W: window.__game.viewState.width, H: window.__game.viewState.height };
  });
  const dest = { x: godPos.x + 12, y: godPos.y + 6 };
  await page.mouse.click(mm.x + (dest.x / mm.W) * mm.w, mm.y + (dest.y / mm.H) * mm.h, { button: 'right' });
  await wait(400);
  const order = await page.evaluate((id) => {
    const u = window.__game.session.world.getEntity(id);
    return u && u.order ? { type: u.order.type, x: u.order.x, y: u.order.y } : null;
  }, godId);
  ok('right-click on the minimap orders a move', order && /move|smart/.test(order.type) && Math.hypot(order.x - dest.x, order.y - dest.y) < 2.5, JSON.stringify(order));
  const camBefore = await page.evaluate(() => ({ ...window.__game.renderer.camera.target }));
  await page.mouse.click(mm.x + mm.w * 0.8, mm.y + mm.h * 0.8);
  await wait(400);
  const camAfter = await page.evaluate(() => ({ ...window.__game.renderer.camera.target }));
  ok('left-click on the minimap moves the camera', Math.hypot(camAfter.x - camBefore.x, camAfter.y - camBefore.y) > 10, `${JSON.stringify(camBefore)} → ${JSON.stringify(camAfter)}`);
  await shot(page, 'minimap-jump');

  // Chat: Enter opens, type, Enter sends (single player echoes locally).
  await page.keyboard.press('Enter');
  await wait(150);
  await page.keyboard.type('for olympus');
  await shot(page, 'chat-typing');
  await page.keyboard.press('Enter');
  await wait(300);
  const chatLog = await page.evaluate(() => document.querySelector('.hud-msgs')?.textContent || '');
  ok('chat line appears in the message log', /for olympus/.test(chatLog), chatLog.slice(-60));

  // Victory: the enemy loses everything.
  await cheat(page, `
    const foe = w.setup.players.find((p) => p.index !== vs.myIndex).index;
    for (const e of [...w.unitsOf(foe), ...w.buildingsOf(foe)]) w.killEntity(e, null);
    return true;`);
  await step(page, 40);
  await page.waitForSelector('.hud-overlay.is-gameover', { timeout: 8000 }).catch(() => {});
  await wait(600);
  const go = await page.evaluate(() => document.querySelector('.hud-overlay.is-gameover')?.textContent || '');
  ok('victory screen with statistics', /victory/i.test(go) && /Gathered/i.test(go), go.slice(0, 80));
  await settled(page, '.hud-overlay.is-gameover');
  await shot(page, 'victory');
  await page.click('.hud-overlay.is-gameover button:text-is("Return to Menu")');
  await page.waitForSelector('.mw-title-screen', { timeout: 5000 });
  ok('Return to Menu goes back to the title', true);
  ok('no page errors in the late game', errors.filter((e) => e.startsWith('[late]')).length === 0, errors.filter((e) => e.startsWith('[late]')).slice(0, 4).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- online (two tabs)

async function online(browser) {
  console.log('online (two tabs, BroadcastChannel):');
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  const host = await ctx.newPage();
  const client = await ctx.newPage();
  watchErrors(host, 'host');
  watchErrors(client, 'client');
  await host.goto(`${base}?transport=local`);
  await host.waitForSelector('.mw-title-screen');
  await host.click('text=Host Online Game');
  await host.waitForSelector('.mw-room-code', { timeout: 8000 });
  const code = (await host.textContent('.mw-room-code')).replace(/\s+/g, '');
  await client.goto(`${base}?transport=local&join=${code}`);
  await client.waitForSelector('.mw-join');
  await client.click('text=Join Game');
  await client.waitForSelector('.mw-lobby', { timeout: 8000 });
  await host.waitForSelector('.mw-slot.is-human', { timeout: 5000 });
  await host.click('.mw-chip-btn[data-preset="1v1"]');
  await wait(400);
  ok('host can start with the client joined', await host.isEnabled('.mw-btn--start'), (await host.textContent('.mw-start-reason')).trim());
  await host.click('.mw-btn--start');
  await Promise.all([waitForGame(host), waitForGame(client)]);
  await wait(1000);
  const info = await client.evaluate(() => ({ isHost: window.__game.session.isHost, me: window.__game.viewState.myIndex, ents: window.__game.viewState.entities.size }));
  ok('host and client both reach the game', !info.isHost && info.ents > 10, JSON.stringify(info));
  const r2 = (k, v) => (typeof v === 'number' ? Math.round(v) : v);
  console.log(`  host timing: ${JSON.stringify(await host.evaluate(() => window.__game.timing()), r2)}`);
  console.log(`  client timing: ${JSON.stringify(await client.evaluate(() => window.__game.timing()), r2)}`);
  await client.bringToFront();
  await shot(client, 'client-game');
  await host.bringToFront();
  await shot(host, 'host-game');

  // client: click one of its workers, right-click the ground in front of the town center
  await client.bringToFront();
  const bottom = await viewBottom(client);
  const target = await client.evaluate((bottom) => {
    const g = window.__game;
    const vs = g.viewState;
    let w = null;
    for (const e of vs.entities.values()) {
      if (e.k !== 'u' || e.o !== vs.myIndex || e.t !== 'worshipper') continue;
      const p = g.renderer.worldToScreen(e.ix ?? e.x, e.iy ?? e.y, 0.45);
      if (p.onScreen && p.sy < bottom && p.sy > 40) {
        w = { id: e.id, x: e.x, y: e.y, sx: p.sx, sy: p.sy };
        break;
      }
    }
    const tc = [...vs.entities.values()].find((e) => e.k === 'b' && e.o === vs.myIndex && e.t === 'town_center');
    // a passable point a few tiles from the town center, on screen
    let goal = null;
    for (let r = 4; r < 9 && !goal; r++) {
      for (let a = 0; a < 16 && !goal; a++) {
        const x = tc.x + Math.cos((a / 16) * Math.PI * 2) * r;
        const y = tc.y + Math.sin((a / 16) * Math.PI * 2) * r;
        const tx = Math.floor(x);
        const ty = Math.floor(y);
        if (vs.map.terrain[ty * vs.width + tx] !== 0) continue;
        if ([...vs.entities.values()].some((e) => e.k !== 'u' && tx >= e.tx && ty >= e.ty && tx < e.tx + 4 && ty < e.ty + 4)) continue;
        const p = g.renderer.worldToScreen(x, y, 0);
        if (p.onScreen && p.sy < bottom - 20 && p.sy > 60 && p.sx > 40 && p.sx < innerWidth - 40) goal = { x, y, sx: p.sx, sy: p.sy };
      }
    }
    return { w, goal };
  }, bottom);
  ok('client sees its worker and a free spot', !!(target.w && target.goal), JSON.stringify(target));
  await client.mouse.click(target.w.sx, target.w.sy);
  await wait(300);
  const csel = await client.evaluate(() => window.__game.selection.ids);
  await client.mouse.click(target.goal.sx, target.goal.sy, { button: 'right' });
  await wait(300);
  await shot(client, 'client-command');
  let moved = null;
  for (let i = 0; i < 30; i++) {
    await wait(200);
    moved = await host.evaluate(([id, gx, gy]) => {
      const u = window.__game.session.world.getEntity(id);
      return u ? { order: u.order ? u.order.type : null, x: u.x, y: u.y, ox: u.order ? u.order.x : null, oy: u.order ? u.order.y : null, dist: Math.hypot(u.x - gx, u.y - gy) } : null;
    }, [target.w.id, target.goal.x, target.goal.y]);
    if (moved && (moved.order === 'move' || moved.dist < 1.5)) break;
  }
  ok('a command from the client UI changes the host World', csel.length === 1 && moved && (moved.order === 'move' || moved.dist < 1.5), JSON.stringify({ csel, moved }));
  await wait(1500);
  await shot(client, 'client-after');
  const ping = await client.evaluate(() => document.querySelector('.hud-ping')?.textContent || '');
  ok('client shows its ping', /ms|…/.test(ping), ping);

  // chat from the client
  await client.keyboard.press('Enter');
  await client.keyboard.type('gl hf');
  await client.keyboard.press('Enter');
  await host.waitForFunction(() => /gl hf/.test(document.querySelector('.hud-msgs')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
  const chat = await host.evaluate(() => document.querySelector('.hud-msgs')?.textContent || '');
  ok('in-game chat reaches the host', /gl hf/.test(chat), chat.slice(0, 80));

  // host quits: the client sees "host closed the game"
  await host.bringToFront();
  await host.keyboard.press('F10');
  await host.click('.hud-overlay.is-menu button:text-is("Quit to Menu")');
  await host.click('.hud-overlay.is-confirm button:text-is("Quit")');
  await host.waitForSelector('.mw-title-screen', { timeout: 5000 });
  await client.bringToFront();
  await client.waitForSelector('.hud-overlay.is-ended', { timeout: 8000 }).catch(() => {});
  const ended = await client.evaluate(() => document.querySelector('.hud-overlay.is-ended')?.textContent || '');
  ok('the client is told the host closed the game', /host/i.test(ended), ended.slice(0, 80));
  await settled(client, '.hud-overlay.is-ended');
  await shot(client, 'client-host-left');
  await client.click('.hud-overlay.is-ended button:text-is("Return to Menu")');
  await client.waitForSelector('.mw-title-screen', { timeout: 5000 });
  ok('no page errors online', errors.filter((e) => /^\[(host|client)\]/.test(e)).length === 0, errors.filter((e) => /^\[(host|client)\]/.test(e)).slice(0, 4).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- main

const server = await ensureServer();
const browser = await chromium.launch({ args: LAUNCH_ARGS, headless: !flag('headed') });
try {
  for (const [name, fn] of [['sp', singlePlayer], ['controls', controls], ['late', lateGame], ['online', online]]) {
    if (!only.includes(name)) continue;
    scenario = name;
    shotN = 0;
    await fn(browser);
  }
} catch (err) {
  console.error(err);
  ok('play test ran to the end', false, err.message.split('\n')[0]);
} finally {
  await browser.close();
  if (server) server.kill();
}
if (errors.length) {
  console.log('page errors:');
  for (const e of errors.slice(0, 20)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed; screenshots in ${out}`);
process.exit(failed.length || errors.length ? 1 : 0);
