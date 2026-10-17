#!/usr/bin/env node
// Screenshots of the menu screens, plus an end-to-end check of the lobby flows.
//
//   node tools/shot-menu.mjs [--port 8105] [--out DIR] [--sizes 1280x720,1920x1080] [--only title,lobby-sp,...]
//   node tools/shot-menu.mjs --flow      # real src/net/lobby.js: Play vs AI → Start → game → Quit, and a two-tab
//                                        # online game over ?transport=local (host, join, chat, start)
//
// Screens (with ?mockLobby=1 so no network is needed): title, lobby-sp (Play vs AI), picker
// (pantheon modal), lobby-host (online host with a room code), lobby-client, join, join-error,
// howto, settings. Starts a static server on the port unless one already answers there.
// Prints page errors and console errors; exits non-zero when a check fails.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const port = Number(opt('port', '8105'));
const out = opt('out', join(tmpdir(), 'mythicwar-menu-shots'));
const only = opt('only', '') ? opt('only', '').split(',') : null;
const sizes = opt('sizes', '1280x720,1920x1080').split(',').map((s) => s.split('x').map(Number));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = `http://localhost:${port}/index.html`;
const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];

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
    await new Promise((r) => setTimeout(r, 200));
    if (await serverUp()) return child;
  }
  child.kill();
  throw new Error(`static server did not start on port ${port}`);
}

// Files other engineers have not written yet (index.html already links them).
const PENDING_FILES = ['/src/ui/hud.css'];

function watchErrors(page, tag, errors) {
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${tag}] console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !PENDING_FILES.some((f) => r.url().includes(f))) errors.push(`[${tag}] http ${r.status()}: ${r.url()}`);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- screenshots

async function shoot(browser, w, h, errors) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  watchErrors(page, `${w}x${h}`, errors);
  const dir = join(out, `${w}x${h}`);
  mkdirSync(dir, { recursive: true });
  const want = (n) => !only || only.includes(n);
  const snap = async (name) => {
    await page.screenshot({ path: join(dir, `${name}.png`) });
    console.log(`  ${w}x${h}/${name}.png`);
  };
  const fresh = async (q = '') => {
    await page.goto(`${base}?mockLobby=1${q}`);
    await page.waitForSelector('.mw-title-screen, .mw-join');
    await wait(900);
  };

  if (want('title')) {
    await fresh();
    await page.mouse.move(w * 0.5, h * 0.2);
    await page.hover('.mw-btn--menu:nth-child(2)');
    await wait(700);
    await snap('title');
  }
  if (want('lobby-sp') || want('picker')) {
    await fresh();
    await page.click('text=Play vs AI');
    await page.waitForSelector('.mw-lobby');
    await wait(600);
    if (want('lobby-sp')) await snap('lobby-sp');
    if (want('picker')) {
      await page.click('.mw-slot.is-me .mw-pbtn');
      await page.waitForSelector('.mw-modal');
      await wait(500);
      await page.hover('.mw-pcard[data-pantheon="norse"]');
      await wait(300);
      await snap('picker');
      await page.click('.mw-pcard[data-pantheon="japanese"]');
      await wait(400);
      if (want('lobby-sp')) await snap('lobby-sp-japanese');
    }
  }
  if (want('lobby-host')) {
    await fresh();
    await page.click('text=Host Online Game');
    await page.waitForSelector('.mw-lobby');
    await wait(1600);
    await snap('lobby-host');
    await page.click('.mw-slot.is-me .mw-swatch');
    await wait(250);
    await snap('lobby-host-colors');
    await page.keyboard.press('Escape');
  }
  if (want('lobby-client')) {
    await fresh('&join=K7QX2');
    await page.click('text=Join Game');
    await page.waitForSelector('.mw-lobby', { timeout: 5000 });
    await wait(700);
    await snap('lobby-client');
  }
  if (want('join') || want('join-error')) {
    await fresh();
    await page.click('text=Join Online Game');
    await page.waitForSelector('.mw-join');
    await page.fill('.mw-code-input', 'zzzzz');
    await wait(300);
    if (want('join')) {
      await page.click('text=Join Game');
      await wait(250);
      await snap('join');
    }
    if (want('join-error')) {
      await page.waitForSelector('.mw-join-status.is-error', { timeout: 5000 });
      await wait(200);
      await snap('join-error');
    }
  }
  if (want('howto')) {
    await fresh();
    await page.click('text=How to Play');
    await page.waitForSelector('.mw-howto');
    await wait(500);
    await snap('howto');
  }
  if (want('settings')) {
    await fresh();
    await page.click('.mw-nav-row >> text=Settings');
    await page.waitForSelector('.mw-settings');
    await wait(500);
    await snap('settings');
  }
  await ctx.close();
}

// ---------------------------------------------------------------- flows (real lobby)

function checkSetup(setup, expectPlayers) {
  const problems = [];
  if (!setup || typeof setup !== 'object') return ['no setup'];
  if (typeof setup.version !== 'string') problems.push('version');
  if (!Number.isFinite(setup.seed)) problems.push('seed');
  if (!['small', 'medium'].includes(setup.mapSize)) problems.push(`mapSize ${setup.mapSize}`);
  if (!Array.isArray(setup.players) || setup.players.length !== expectPlayers) problems.push(`players ${setup.players && setup.players.length}`);
  (setup.players || []).forEach((p, i) => {
    if (p.index !== i) problems.push(`player ${i} index`);
    if (!p.name) problems.push(`player ${i} name`);
    if (!(p.team >= 1 && p.team <= 4)) problems.push(`player ${i} team`);
    if (!p.pantheon || p.pantheon === 'random') problems.push(`player ${i} pantheon ${p.pantheon}`);
    if (!/^#[0-9a-f]{6}$/i.test(p.color)) problems.push(`player ${i} color ${p.color}`);
    if (!['human', 'ai'].includes(p.kind)) problems.push(`player ${i} kind`);
    if (p.kind === 'ai' && !['easy', 'normal', 'hard'].includes(p.difficulty)) problems.push(`player ${i} difficulty`);
  });
  if (new Set((setup.players || []).map((p) => p.team)).size < 2) problems.push('fewer than 2 teams');
  return problems;
}

async function flows(browser, errors) {
  const results = [];
  const ok = (name, cond, detail = '') => {
    results.push({ name, pass: !!cond, detail });
    console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  mkdirSync(join(out, 'flow'), { recursive: true });

  // 1) single player: Play vs AI → Start
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    watchErrors(page, 'sp', errors);
    await page.goto(base);
    await page.waitForSelector('.mw-title-screen');
    await page.click('text=Play vs AI');
    await page.waitForSelector('.mw-lobby', { timeout: 8000 });
    const rows = await page.$$eval('.mw-slot', (els) => els.map((e) => e.className));
    ok('sp: lobby shows 1 human vs 1 AI', rows.filter((c) => /is-(host|ai)/.test(c)).length === 2 && rows.filter((c) => c.includes('is-closed')).length === 2, rows.join(' | '));
    // choose a pantheon through the picker
    await page.click('.mw-slot.is-me .mw-pbtn');
    await page.click('.mw-pcard[data-pantheon="egyptian"]');
    await page.waitForSelector('.mw-modal', { state: 'detached' });
    const pname = await page.textContent('.mw-slot.is-me .mw-pbtn-name');
    ok('sp: pantheon picker sets my pantheon', pname.trim() === 'Egyptian', pname);
    // set the AI to Hard
    await page.selectOption('.mw-slot.is-ai .mw-select--who', 'ai:hard');
    const enabled = await page.isEnabled('.mw-btn--start');
    ok('sp: Start enabled', enabled);
    await page.screenshot({ path: join(out, 'flow', 'sp-lobby.png') });
    await page.click('.mw-btn--start');
    await page.waitForFunction(() => !!globalThis.__mythicwarLaunch, null, { timeout: 5000 });
    const launch = await page.evaluate(() => {
      const l = globalThis.__mythicwarLaunch;
      return { role: l.role, myIndex: l.myIndex, setup: l.setup, conns: l.conns instanceof Map ? l.conns.size : -1, hasLobby: !!l.lobby };
    });
    const probs = checkSetup(launch.setup, 2);
    ok('sp: startGame got a valid setup', probs.length === 0 && launch.role === 'host' && launch.myIndex === 0 && launch.conns === 0 && launch.hasLobby, probs.join(', ') || JSON.stringify(launch.setup.players));
    ok('sp: chosen pantheon + AI difficulty reach the setup', launch.setup.players[0].pantheon === 'egyptian' && launch.setup.players[1].difficulty === 'hard', `${launch.setup.players[0].pantheon}/${launch.setup.players[1].difficulty}`);
    ok('sp: small map', launch.setup.mapSize === 'small', launch.setup.mapSize);
    const hidden = await page.evaluate(() => document.getElementById('menu-root').hidden);
    ok('sp: menu hidden after start', hidden);
    await page.screenshot({ path: join(out, 'flow', 'sp-started.png') });
    // The real game starts (src/game/game.js); F10 → Quit to Menu → Quit returns to the title.
    await page.waitForFunction(() => window.__game && window.__game.stats.frames > 1, null, { timeout: 60000, polling: 200 });
    await page.keyboard.press('F10');
    await page.click('.hud-overlay.is-menu button:text-is("Quit to Menu")');
    await page.click('.hud-overlay.is-confirm button:text-is("Quit")');
    await page.waitForSelector('.mw-title-screen', { timeout: 10000 });
    ok('sp: the game starts and Quit to Menu returns to the title', true);
    await ctx.close();
  }

  // 2) online over BroadcastChannel: host tab + client tab in one browser context
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const hostPage = await ctx.newPage();
    const clientPage = await ctx.newPage();
    watchErrors(hostPage, 'host', errors);
    watchErrors(clientPage, 'client', errors);
    await hostPage.goto(`${base}?transport=local`);
    await hostPage.waitForSelector('.mw-title-screen');
    await hostPage.click('text=Host Online Game');
    await hostPage.waitForSelector('.mw-room-code', { timeout: 8000 });
    const code = (await hostPage.textContent('.mw-room-code')).replace(/\s+/g, '');
    ok('online: host shows a 5-letter room code', /^[A-Z2-9]{5}$/.test(code), code);
    ok('online: Start disabled with a reason while alone', !(await hostPage.isEnabled('.mw-btn--start')), (await hostPage.textContent('.mw-start-reason')).trim());

    // wrong code first
    await clientPage.goto(`${base}?transport=local`);
    await clientPage.click('text=Join Online Game');
    await clientPage.fill('.mw-code-input', 'ABCDE');
    await clientPage.click('text=Join Game');
    await clientPage.waitForSelector('.mw-join-status.is-error', { timeout: 8000 });
    const err = await clientPage.textContent('.mw-join-status');
    ok('online: unknown code shows "Room not found"', /Room not found/.test(err), err.trim());

    // invite link
    await clientPage.goto(`${base}?transport=local&join=${code}`);
    await clientPage.waitForSelector('.mw-join');
    const filled = await clientPage.inputValue('.mw-code-input');
    ok('online: ?join=CODE fills the code', filled === code, filled);
    await clientPage.fill('.mw-join input[aria-label="Your name"]', 'Guest Tester');
    await clientPage.click('text=Join Game');
    await clientPage.waitForSelector('.mw-lobby', { timeout: 8000 });
    await hostPage.waitForSelector('.mw-slot.is-human', { timeout: 5000 });
    const hostSees = await hostPage.textContent('.mw-slot.is-human');
    ok('online: host sees the joined player', /Guest Tester/.test(hostSees), hostSees.trim());

    // client picks a pantheon and team
    await clientPage.click('.mw-slot.is-me .mw-pbtn');
    await clientPage.click('.mw-pcard[data-pantheon="norse"]');
    await hostPage.waitForFunction(() => /Norse/.test(document.querySelector('.mw-slot.is-human')?.textContent || ''), null, { timeout: 5000 });
    ok('online: client pantheon choice reaches the host', true);

    // chat both ways
    await clientPage.fill('.mw-chat-input', 'hello from the client');
    await clientPage.press('.mw-chat-input', 'Enter');
    await hostPage.waitForFunction(() => /hello from the client/.test(document.querySelector('.mw-chat-log')?.textContent || ''), null, { timeout: 5000 });
    await hostPage.fill('.mw-chat-input', 'welcome, warrior');
    await hostPage.press('.mw-chat-input', 'Enter');
    await clientPage.waitForFunction(() => /welcome, warrior/.test(document.querySelector('.mw-chat-log')?.textContent || ''), null, { timeout: 5000 });
    const hostLog = await hostPage.textContent('.mw-chat-log');
    ok('online: chat works both ways', /Guest Tester:\s*hello from the client/.test(hostLog), hostLog.replace(/\s+/g, ' ').slice(0, 160));

    // 2v2 preset (host + client vs 2 AI) then start
    await hostPage.click('.mw-chip-btn[data-preset="coop"]');
    await wait(300);
    const startOk = await hostPage.isEnabled('.mw-btn--start');
    ok('online: Start enabled after the co-op preset', startOk, (await hostPage.textContent('.mw-start-reason')).trim());
    await hostPage.screenshot({ path: join(out, 'flow', 'online-host.png') });
    await clientPage.screenshot({ path: join(out, 'flow', 'online-client.png') });
    await hostPage.click('.mw-btn--start');
    await hostPage.waitForFunction(() => !!globalThis.__mythicwarLaunch, null, { timeout: 5000 });
    await clientPage.waitForFunction(() => !!globalThis.__mythicwarLaunch, null, { timeout: 5000 });
    const hl = await hostPage.evaluate(() => {
      const l = globalThis.__mythicwarLaunch;
      return { role: l.role, myIndex: l.myIndex, setup: l.setup, conns: l.conns instanceof Map ? [...l.conns.keys()] : null };
    });
    const cl = await clientPage.evaluate(() => {
      const l = globalThis.__mythicwarLaunch;
      return { role: l.role, myIndex: l.myIndex, seed: l.setup.seed, hasConn: !!(l.conn && typeof l.conn.send === 'function') };
    });
    const probs = checkSetup(hl.setup, 4);
    ok('online: host launch valid', hl.role === 'host' && hl.myIndex === 0 && probs.length === 0 && hl.conns && hl.conns.length === 1, probs.join(', ') || JSON.stringify(hl.conns));
    ok('online: client launch valid', cl.role === 'client' && cl.myIndex === hl.conns[0] && cl.seed === hl.setup.seed && cl.hasConn, JSON.stringify(cl));
    const cp = hl.setup.players[cl.myIndex];
    ok('online: client player is Norse human on team 1', cp && cp.pantheon === 'norse' && cp.kind === 'human' && cp.team === 1 && cp.name === 'Guest Tester', JSON.stringify(cp));
    await ctx.close();
  }
  return results;
}

// ---------------------------------------------------------------- main

const server = await ensureServer();
const browser = await chromium.launch({ args: LAUNCH_ARGS });
const errors = [];
let failed = 0;
try {
  if (flag('flow')) {
    console.log('lobby flows (real src/net/lobby.js):');
    const res = await flows(browser, errors);
    failed = res.filter((r) => !r.pass).length;
  } else {
    for (const [w, h] of sizes) {
      console.log(`screens at ${w}x${h}:`);
      await shoot(browser, w, h, errors);
    }
  }
} catch (err) {
  console.error(err);
  failed++;
} finally {
  await browser.close();
  if (server) server.kill();
}
const relevant = errors.filter((e) => !/favicon/.test(e));
if (relevant.length) {
  console.log('\npage errors:');
  for (const e of relevant) console.log(`  ${e}`);
}
console.log(`\nshots in ${out}`);
process.exit(failed || relevant.some((e) => e.includes('pageerror')) ? 1 : 0);
