// Three-tab check of the online rematch and of a room for friends (DESIGN 7): a host and two friends over the local
// transport. The host opens a room and changes nothing: both friends come in (the first against the host, the second
// on the host's side). The game ends; one friend asks for a rematch, the host opens it, both friends land back in the
// lobby in their own seats, with their pantheons, and the rematch starts. Then the host leaves that game mid-way
// (the game moves to a friend), the game ends on the new host, and its Rematch takes everyone to its own room.
// Serve the repo first (python3 -m http.server 8321), then:
//   node tools/rematch-check.mjs [--base=http://localhost:8321] [--out=dir]
// Prints what each step saw and exits non-zero on a failed check. Software GL is slow: allow minutes.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const BASE = arg('base', 'http://localhost:8321');
const OUT = arg('out', '');

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(page, fn, what, ms = 120000, a = undefined) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await page.evaluate(fn, a);
    } catch {
      // the page is navigating
    }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await sleep(500);
  }
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });
// The tabs share one browser, so one localStorage, while players have a browser each: since the host keeps a
// rejoin ticket too (DESIGN 7), a shared store would let one tab's ticket replace another's. Each tab (named by
// sessionStorage 'who', which survives its reloads) gets its own keys.
await ctx.addInitScript(() => {
  try {
    const who = sessionStorage.getItem('who');
    if (!who) return;
    const P = Storage.prototype;
    const { getItem, setItem, removeItem } = P;
    const key = (s, k) => (s === window.localStorage ? `${who}:${k}` : k);
    P.getItem = function (k) { return getItem.call(this, key(this, k)); };
    P.setItem = function (k, v) { return setItem.call(this, key(this, k), v); };
    P.removeItem = function (k) { return removeItem.call(this, key(this, k)); };
  } catch {
    // ignore
  }
});
await ctx.addInitScript(() => {
  try {
    const name = sessionStorage.getItem('who') || 'Player';
    localStorage.setItem('mythicwar-settings', JSON.stringify({ quality: 'low', tipsDismissed: true, volume: 0, musicMuted: true, intro: false, hints: false, name }));
  } catch {
    // ignore
  }
});
const names = ['Hosta', 'Cleo', 'Dax'];
const pages = [];
for (const who of names) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => log(`${who} page error:`, e.message));
  p.on('console', (m) => m.type() === 'error' && log(`${who} console error:`, m.text().slice(0, 200)));
  await p.goto(`${BASE}/?transport=local`);
  await p.evaluate((w) => sessionStorage.setItem('who', w), who);
  await p.reload();
  pages.push(p);
}
const [host, cleo, dax] = pages;
let ok = true;
const check = (cond, what) => {
  log(cond ? 'PASS' : 'FAIL', what);
  if (!cond) ok = false;
};
const shot = async (p, name) => {
  if (OUT) await p.screenshot({ path: `${OUT}/${name}.png`, timeout: 240000 }).catch((e) => log('screenshot failed', name, e.message));
};
// All tabs share one software GPU: tabs not under test draw a frame every 2 s.
const slowFrames = (p) => p.evaluate(() => {
  window.__raf = window.__raf || window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 2000);
}).catch(() => {});
const fastFrames = (p) => p.evaluate(() => {
  if (window.__raf) window.requestAnimationFrame = window.__raf;
}).catch(() => {});
const ready = () => !!(window.__game && window.__game.viewState && window.__game.viewState.snapshot && window.__game.renderer);
// Record every mark and chat line each page's Game hears (across session swaps: hook the Game's handlers).
const hook = (p) => p.evaluate(() => {
  const g = window.__game;
  window.__heard = { marks: [], chat: [] };
  const om = g.onMark.bind(g);
  g.onMark = (m) => {
    window.__heard.marks.push({ from: m.from, kind: m.kind });
    return om(m);
  };
  const oc = g.onChat.bind(g);
  g.onChat = (l) => {
    window.__heard.chat.push({ from: l.from, text: l.text, system: !!l.system });
    return oc(l);
  };
});
const heard = (p) => p.evaluate(() => window.__heard);

const lobbyRows = (p) => p.evaluate(() => [...document.querySelectorAll('.mw-slot')].map((r) => ({
  kind: (r.className.match(/is-(host|human|ai|open|closed)/) || [])[1],
  me: r.classList.contains('is-me'),
  text: r.textContent.replace(/\s+/g, ' ').trim().slice(0, 70),
  pantheon: r.querySelector('.mw-pbtn-name, .mw-pantheon-name')?.textContent?.trim() || r.querySelector('[class*="pantheon"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 30) || null,
  team: r.querySelector('select[aria-label^="Team"]')?.value || r.querySelector('.mw-team, [class*="team"]')?.textContent?.trim() || null,
})));
const inLobby = (p) => until(p, () => document.querySelector('#menu-root')?.dataset.screen === 'lobby' && !window.__game, 'the lobby', 120000);
const gameRuns = async (order) => {
  for (const [i, p] of order.entries()) {
    for (const q of order) if (q !== p) await slowFrames(q);
    await fastFrames(p);
    await until(p, ready, `game running in tab ${i + 1}`, 300000);
  }
  for (const p of order) await slowFrames(p);
};
// End the game from the host's side: every player of the other team surrenders.
const endGame = (hostPage, loser) => hostPage.evaluate((team) => {
  const s = window.__game.session;
  for (const p of s.setup.players) if (p.team === team) s.world.issueCommand(p.index, { type: 'surrender' });
}, loser);
const gameOverButtons = (p) => p.evaluate(() => [...document.querySelectorAll('.hud-gameover .hud-obtns button')].map((b) => `${b.textContent}${b.disabled ? ' (disabled)' : ''}`));
const clickButton = (p, re) => p.evaluate((src) => {
  const b = [...document.querySelectorAll('.hud-gameover .hud-obtns button')].find((x) => new RegExp(src).test(x.textContent));
  if (b) b.click();
  return !!b;
}, re.source);

try {
  // ---- 1. A room for friends: the host changes nothing.
  await host.getByRole('button', { name: /Host Online Game/ }).click();
  const code = await until(host, () => document.querySelector('.mw-room-code')?.textContent.trim() || null, 'room code');
  log('room', code);
  const rows0 = await lobbyRows(host);
  log('host lobby:', JSON.stringify(rows0));
  check(rows0.filter((r) => r.kind === 'open').length === 3, 'a new online room has three Open seats');
  await shot(host, 'lobby-default');
  for (const [p, n] of [[cleo, 1], [dax, 2]]) {
    await p.goto(`${BASE}/?transport=local&join=${code}`);
    await p.getByRole('button', { name: 'Join Game' }).click();
    await until(host, (k) => document.querySelectorAll('.mw-slot.is-human').length >= k, `friend ${n} in the lobby`, 60000, n);
  }
  await cleo.locator('.mw-slot.is-me .mw-pbtn').click();
  await cleo.locator('.mw-pgrid > *').nth(2).click();
  await sleep(1000);
  const rows1 = await lobbyRows(host);
  log('host lobby with friends:', JSON.stringify(rows1));
  const cleoPantheon = await cleo.evaluate(() => document.querySelector('.mw-slot.is-me .mw-pbtn-name')?.textContent);
  const startOk = await host.evaluate(() => document.querySelector('.mw-btn--start')?.disabled === false);
  check(startOk, 'the host can start with an Open seat left');
  await shot(host, 'lobby-friends');
  await host.evaluate(() => document.querySelector('.mw-btn--start').click()); // (the start keeps the page busy: no click waiting on it)
  await gameRuns([host, cleo, dax]);
  const setup1 = await host.evaluate(() => window.__game.setup.players.map((p) => ({ name: p.name, team: p.team, pantheon: p.pantheon, kind: p.kind })));
  log('setup 1:', JSON.stringify(setup1));
  await hook(host);
  const team = (n, setup) => (setup.find((p) => p.name === n) || {}).team;
  check(team('Cleo', setup1) !== team('Hosta', setup1), 'the first friend plays against the host');
  check(team('Dax', setup1) === team('Hosta', setup1), 'the second friend is on the host\'s side');

  // ---- 2. Game over; Dax asks for a rematch, the host opens it, both friends come back.
  await endGame(host, team('Cleo', setup1));
  for (const p of pages) await fastFrames(p);
  for (const p of pages) await until(p, () => !!document.querySelector('.hud-gameover'), 'game-over screen', 120000);
  await sleep(1500);
  for (const [p, who] of [[host, 'host'], [cleo, 'Cleo'], [dax, 'Dax']]) log(`${who} buttons:`, JSON.stringify(await gameOverButtons(p)));
  check((await gameOverButtons(host))[0] === 'Rematch', 'the host is offered Rematch');
  check((await gameOverButtons(cleo))[0] === 'Rematch', 'a friend is offered Rematch');
  await clickButton(dax, /^Rematch$/);
  await sleep(1500);
  const daxWaits = await gameOverButtons(dax);
  log('Dax after asking:', JSON.stringify(daxWaits));
  check(/Waiting for the host/.test(daxWaits[0] || ''), 'Dax waits for the host');
  const hostChat = (await heard(host)).chat.map((l) => l.text).filter((t) => /rematch/i.test(t));
  log('host hears:', JSON.stringify(hostChat));
  check(hostChat.some((t) => /Dax wants a rematch/.test(t)), 'the host hears that Dax wants a rematch');
  await shot(host, 'gameover-host-asked');
  await host.evaluate(() => window.__game.hud.overlays.hide()); // Cleo keeps watching; the host's Rematch is on the screen again below
  await cleo.evaluate(() => window.__game.hud.overlays.hide()); // Cleo put the screen away: it must come back
  await host.evaluate(() => window.__game.hud.overlays.refreshGameOver(true));
  await clickButton(host, /^Rematch$/);
  await inLobby(host);
  await inLobby(dax);
  const cleoBack = await until(cleo, () => (document.querySelector('.hud-gameover') ? [...document.querySelectorAll('.hud-gameover .hud-obtns button')].map((b) => b.textContent) : null), 'Cleo\'s game-over screen back', 30000).catch(() => null);
  log('Cleo after the host opened the rematch:', JSON.stringify(cleoBack));
  check(cleoBack && cleoBack[0] === 'Join Rematch', 'Cleo\'s screen comes back with Join Rematch');
  await shot(cleo, 'gameover-join-rematch');
  await clickButton(cleo, /^Join Rematch$/);
  await inLobby(cleo);
  await until(host, () => document.querySelectorAll('.mw-slot.is-human').length >= 2, 'both friends back in the lobby', 60000);
  await sleep(1000);
  const rows2 = await lobbyRows(host);
  log('rematch lobby:', JSON.stringify(rows2));
  const cleoRow = (rows) => rows.findIndex((r) => r.text.includes('Cleo'));
  check(cleoRow(rows2) === cleoRow(rows1) && rows2.findIndex((r) => r.text.includes('Dax')) === rows1.findIndex((r) => r.text.includes('Dax')), 'both friends are back in their own seats');
  check(!!cleoPantheon && cleoPantheon !== 'Random' && (rows2[cleoRow(rows2)].pantheon || '').includes(cleoPantheon.slice(0, 5)), `Cleo keeps her pantheon (${cleoPantheon})`);
  await shot(host, 'rematch-lobby-host');
  await shot(cleo, 'rematch-lobby-cleo');
  await host.evaluate(() => document.querySelector('.mw-btn--start').click()); // (the start keeps the page busy: no click waiting on it)
  await gameRuns([host, cleo, dax]);
  const setup2 = await host.evaluate(() => window.__game.setup.players.map((p) => ({ name: p.name, team: p.team, pantheon: p.pantheon, kind: p.kind })));
  log('setup 2:', JSON.stringify(setup2));
  check(setup2.length === setup1.length && setup2.every((p) => team(p.name, setup1) === p.team), 'the rematch has the same players on the same sides');

  // ---- 3. The host leaves the rematch mid-game; the game ends on the new host; its Rematch reopens its own room.
  const plan = await until(dax, () => window.__game.session.plan, 'the plan', 60000);
  const heir = plan.heir === setup2.findIndex((p) => p.name === 'Cleo') ? cleo : dax;
  const other = heir === cleo ? dax : cleo;
  await until(heir, () => !!window.__game.session.backup, 'a backup at the heir', 60000);
  await host.evaluate(() => window.__game.quitToMenu());
  await fastFrames(heir);
  await until(heir, () => window.__game && window.__game.session.isHost && !window.__game.migrating && !window.__game.ended, 'the heir hosts', 120000);
  await until(other, () => window.__game && !window.__game.session.isHost && !window.__game.migrating && window.__game.session.ready, 'the other friend follows', 120000);
  await until(heir, () => !window.__game.session.pause, 'the new host goes on', 60000).catch(() => null);
  await endGame(heir, team('Cleo', setup2));
  await fastFrames(other);
  for (const p of [heir, other]) await until(p, () => !!document.querySelector('.hud-gameover'), 'game-over after the move', 120000);
  await sleep(1500);
  const heirBtns = await gameOverButtons(heir);
  log('heir buttons:', JSON.stringify(heirBtns));
  check(heirBtns[0] === 'Rematch', 'the new host is offered Rematch');
  await clickButton(heir, /^Rematch$/);
  await inLobby(heir);
  const newCode = await until(heir, () => document.querySelector('.mw-room-code')?.textContent.trim() || null, 'the new host\'s room code');
  await until(other, () => (document.querySelector('.hud-gameover') ? [...document.querySelectorAll('.hud-gameover .hud-obtns button')].map((b) => b.textContent)[0] === 'Join Rematch' : false), 'Join Rematch at the follower', 30000);
  await clickButton(other, /^Join Rematch$/);
  await inLobby(other);
  await sleep(1000);
  const rows3 = await lobbyRows(heir);
  log(`the new host's lobby (room ${newCode}):`, JSON.stringify(rows3));
  check(rows3[0].me && rows3.filter((r) => r.kind === 'human').length === 1, 'the new host leads its lobby and the other friend is in');
  check(rows3.some((r) => r.kind === 'open'), 'the old host\'s seat is Open for them');
  await shot(heir, 'rematch-lobby-new-host');
} catch (err) {
  ok = false;
  log('ERROR', err && err.stack ? err.stack : err);
  for (const [i, p] of pages.entries()) await shot(p, `error-${names[i]}`);
}
await browser.close();
log(ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
