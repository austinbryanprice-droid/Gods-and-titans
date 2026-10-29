// Three-tab online play check (DESIGN 7): a host and two friends over the local transport (BroadcastChannel).
// Lobby (a third seat opened, a friend picks a pantheon), chat and team marks across tabs, pause limits, the
// host quitting through the menu mid-game (both friends carry on under the heir), chat and marks after the
// move, then the game's end on the new host and its game-over screens. Serve the repo first
// (python3 -m http.server 8321), then:
//   node tools/online-audit.mjs [--base=http://localhost:8321] [--out=dir]
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

try {
  // ---- 1. Lobby
  await host.getByRole('button', { name: /Host Online Game/ }).click();
  const code = await until(host, () => document.querySelector('.mw-room-code')?.textContent.trim() || null, 'room code');
  log('room', code);
  const slotKinds = await host.evaluate(() => [...document.querySelectorAll('.mw-slot')].map((r) => r.className));
  log('host lobby slots:', JSON.stringify(slotKinds));
  await shot(host, 'lobby-host-default');
  // Open a third seat for the second friend, and put both friends on team 2.
  await host.locator('select[aria-label="Slot 3"]').selectOption('open');
  for (const [p, i] of [[cleo, 2], [dax, 3]]) {
    await p.goto(`${BASE}/?transport=local&join=${code}`);
    await p.getByRole('button', { name: 'Join Game' }).click();
    await until(host, (n) => document.querySelectorAll('.mw-slot.is-human').length >= n, `friend ${i - 1} in the lobby`, 60000, i - 1);
  }
  await host.locator('select[aria-label="Team for slot 3"]').selectOption('2', { timeout: 10000 }).catch((e) => log('team select:', e.message.split('\n')[0]));
  // Cleo picks a pantheon in her own row.
  await cleo.locator('.mw-slot.is-me .mw-pbtn').click();
    await cleo.locator('.mw-pgrid > *').nth(2).click();
  await sleep(1000);
  const lobbyAtHost = await host.evaluate(() => [...document.querySelectorAll('.mw-slot')].map((r) => r.textContent.replace(/\s+/g, ' ').slice(0, 80)));
  log('host sees lobby:', JSON.stringify(lobbyAtHost));
  const cleoPantheon = await cleo.evaluate(() => document.querySelector('.mw-slot.is-me .mw-pbtn-name')?.textContent);
  check(cleoPantheon && cleoPantheon !== 'Random' && lobbyAtHost[1].includes(cleoPantheon.slice(0, 5)), `Cleo's pantheon pick (${cleoPantheon}) shows on the host`);
  // Lobby chat
  await dax.evaluate(() => 0);
  await shot(host, 'lobby-host-three');
  await shot(cleo, 'lobby-cleo');
  const startDisabled = await host.evaluate(() => document.querySelector('.mw-btn--start')?.disabled);
  check(startDisabled === false, 'the host can start with three players');
  await host.locator('.mw-btn--start').click();
  log('started');
  await slowFrames(cleo);
  await slowFrames(dax);
  await until(host, ready, 'host game running', 300000);
  await slowFrames(host);
  await fastFrames(cleo);
  await until(cleo, ready, 'Cleo game running', 300000);
  await slowFrames(cleo);
  await fastFrames(dax);
  await until(dax, ready, 'Dax game running', 300000);
  const idx = await Promise.all(pages.map((p) => p.evaluate(() => window.__game.myIndex)));
  const teams = await host.evaluate(() => window.__game.setup.players.map((p) => `${p.name}:${p.kind}:t${p.team}:${p.pantheon}`));
  log('indices', idx, 'setup', JSON.stringify(teams));
  for (const p of pages) await hook(p);

  // ---- 6. Chat and marks across tabs
  await cleo.evaluate(() => window.__game.sendChat('hello from Cleo'));
  await sleep(1500);
  const chatSeen = await Promise.all(pages.map((p) => p.evaluate(() => window.__heard.chat.some((l) => l.text === 'hello from Cleo'))));
  check(chatSeen.every(Boolean), `chat reaches every tab (${chatSeen})`);
  const sentMark = await cleo.evaluate(() => window.__game.sendMark('attack', 30, 30));
  await sleep(1500);
  const marks = await Promise.all(pages.map(heard));
  log('marks heard:', JSON.stringify(marks.map((h) => h.marks)));
  const cleoTeam = await host.evaluate((i) => window.__game.setup.players[i].team, idx[1]);
  const daxTeam = await host.evaluate((i) => window.__game.setup.players[i].team, idx[2]);
  const hostTeam = await host.evaluate((i) => window.__game.setup.players[i].team, idx[0]);
  check(sentMark && marks[1].marks.some((m) => m.from === idx[1]), 'Cleo sees her own mark');
  if (daxTeam === cleoTeam) check(marks[2].marks.some((m) => m.from === idx[1] && m.kind === 'attack'), 'Dax (teammate) sees Cleo\'s mark');
  if (hostTeam !== cleoTeam) check(!marks[0].marks.length, 'the host (enemy) does not see Cleo\'s mark');
  const daxMsgs = await dax.evaluate(() => [...document.querySelectorAll('.hud-msg, .hud-chat-line')].map((m) => m.textContent).slice(-4));
  log('Dax messages:', JSON.stringify(daxMsgs));

  // ---- 4. Pause limits: Dax pauses three times; a fourth is refused with a message.
  for (let n = 1; n <= 4; n++) {
    await dax.evaluate(() => window.__game.togglePause());
    const paused = await until(host, () => (window.__game.session.pause ? JSON.stringify(window.__game.session.pause) : null), `pause ${n}`, 8000).catch(() => null);
    log(`pause ${n}:`, paused);
    if (n === 1) {
      await until(cleo, () => !document.querySelector('.hud-pausebar')?.hidden, 'pause bar at Cleo', 20000).catch(() => null);
      const bar = await cleo.evaluate(() => document.querySelector('.hud-pausebar')?.textContent);
      log('Cleo bar:', bar);
      check(/Paused by Dax/.test(bar || ''), 'Cleo\'s bar says Dax paused');
      await fastFrames(cleo);
      await sleep(2500);
      await shot(cleo, 'pause-bar-cleo');
      await slowFrames(cleo);
    }
    if (n <= 3) {
      check(!!paused, `pause ${n} of 3 taken`);
      const r = await cleo.evaluate(() => ({ sent: window.__game.togglePause(), pause: window.__game.session.pause, online: window.__game.online })); // a teammate resumes
      log(`Cleo resumes ${n}:`, JSON.stringify(r));
      const resumed = await until(host, () => !window.__game.session.pause, `resume ${n}`, 20000).catch(() => false);
      check(resumed, `Cleo's resume ${n} is taken`);
      if (!resumed) {
        log('host after the resume:', JSON.stringify(await host.evaluate(() => ({ pause: window.__game.session.pause, dropped: [...window.__game.session.clients.values()].map((c) => [c.index, c.dropped]) }))));
        await host.evaluate(() => window.__game.togglePause());
        await until(host, () => !window.__game.session.pause, `host resume ${n}`, 20000);
      }
    } else {
      check(!paused, 'a fourth pause is refused');
      const told = await dax.evaluate(() => window.__heard.chat.filter((l) => /no pauses left/.test(l.text)).length);
      check(told > 0, 'Dax is told he has no pauses left');
    }
  }
  const pauseLines = await host.evaluate(() => window.__heard.chat.filter((l) => l.system && /pause|resume/.test(l.text)).map((l) => l.text));
  log('host pause lines:', JSON.stringify(pauseLines));

  // ---- 3. The host quits through the menu mid-game: the game moves to the heir; the other friend follows.
  const plan = await until(dax, () => window.__game.session.plan, 'the plan at Dax', 60000);
  log('plan', JSON.stringify(plan));
  await until(cleo, () => !!window.__game.session.backup, 'a backup at the heir', 60000);
  const before = await dax.evaluate(() => ({ tick: window.__game.viewState.tick }));
  await host.evaluate(() => window.__game.quitToMenu());
  const hostWait = await host.evaluate(() => document.querySelector('.hud-overlay, .hud-opanel')?.textContent?.slice(0, 120) || null);
  log('old host sees while leaving:', hostWait);
  const hostTitle = await until(host, () => (!window.__game && document.querySelector('.mw-rejoin-btn')
    ? { rejoin: document.querySelector('.mw-rejoin-btn').textContent, toast: document.querySelector('.mw-toast')?.textContent || null } : null), 'old host back on the title', 60000).catch(() => ({}));
  log('old host on the title:', JSON.stringify(hostTitle));
  check(/as Hosta/.test(hostTitle.rejoin || ''), 'the old host\'s title offers Rejoin into its own seat');
  check(/now hosts the game/.test(hostTitle.toast || ''), 'the old host is told who hosts the game now');
  await shot(host, 'old-host-title');
  const heirPage = plan.heir === idx[1] ? cleo : dax;
  const other = heirPage === cleo ? dax : cleo;
  await fastFrames(heirPage);
  await until(heirPage, () => window.__game && window.__game.session.isHost && !window.__game.migrating && !window.__game.ended, 'the heir hosts', 120000);
  await until(other, () => window.__game && !window.__game.session.isHost && !window.__game.migrating && !window.__game.ended && window.__game.session.ready, 'the other friend follows', 120000);
  await until(heirPage, () => !window.__game.session.pause, 'the new host goes on', 60000).catch(() => null);
  const after = await heirPage.evaluate(() => ({ tick: window.__game.session.world.tickCount, clients: [...window.__game.session.clients.keys()], standIns: [...window.__game.session.standIns], pause: window.__game.session.pause }));
  log('heir after:', JSON.stringify(after), 'Dax tick before', before.tick);
  check(after.clients.length === 1, 'the other friend is connected to the new host');
  check(after.standIns.includes(idx[0]), 'an AI holds the old host\'s seat');
  await sleep(3000);
  const otherTick = await other.evaluate(() => window.__game.viewState.tick);
  check(otherTick > 0, `the follower's view runs (tick ${otherTick})`);
  const msgs = await other.evaluate(() => [...document.querySelectorAll('.hud-msg')].map((m) => m.textContent).slice(-4));
  log('follower messages:', JSON.stringify(msgs));
  await shot(heirPage, 'after-handoff-heir');

  // Chat and marks after the move.
  await other.evaluate(() => window.__game.sendChat('still here'));
  await sleep(1500);
  check(await heirPage.evaluate(() => window.__heard.chat.some((l) => l.text === 'still here')), 'chat reaches the new host after the move');
  const n0 = await other.evaluate(() => window.__heard.marks.length);
  await heirPage.evaluate(() => window.__game.sendMark('defend', 25, 25));
  await sleep(1500);
  const n1 = await other.evaluate(() => window.__heard.marks.length);
  if (daxTeam === cleoTeam) check(n1 > n0, 'a mark from the new host reaches its teammate');
  // Pauses used before the move stay used.
  const daxLeft = await heirPage.evaluate((i) => window.__game.session.pausesLeft.get(i), idx[2]);
  check(daxLeft === 0, `Dax's pauses used stay used after the move (left ${daxLeft})`);

  // ---- 5. Game over on the new host: the old host's seat (an AI now) surrenders.
  await heirPage.evaluate((i) => window.__game.session.world.issueCommand(i, { type: 'surrender' }), idx[0]);
  await fastFrames(other);
  await until(heirPage, () => !!document.querySelector('.hud-gameover'), 'game-over screen on the new host', 60000);
  await until(other, () => !!document.querySelector('.hud-gameover'), 'game-over screen on the follower', 60000);
  await sleep(2500);
  for (const [p, who] of [[heirPage, 'heir'], [other, 'follower']]) {
    const go = await p.evaluate(() => ({
      title: document.querySelector('.hud-go-title')?.textContent,
      buttons: [...document.querySelectorAll('.hud-gameover .hud-obtns button')].map((b) => b.textContent),
      chronicle: !!document.querySelector('.hud-gameover .hud-chron, .hud-gameover [class*="chron"]'),
      ticket: localStorage.getItem('mythicwar-rejoin'),
    }));
    log(`${who} game over:`, JSON.stringify(go));
    check(go.title === 'Victory', `${who} sees Victory`);
    check(go.chronicle, `${who} sees the chronicle`);
    await shot(p, `gameover-${who}`);
  }
  // The new host leaves the finished game: the follower is told, and keeps its screen.
  await heirPage.evaluate(() => window.__game.quitToMenu());
  await sleep(3000);
  const end = await other.evaluate(() => ({ msgs: [...document.querySelectorAll('.hud-msg')].map((m) => m.textContent).slice(-3), overlay: window.__game && window.__game.hud.overlays.name, ended: window.__game && window.__game.ended }));
  log('follower after the host left the finished game:', JSON.stringify(end));
  await shot(other, 'gameover-follower-host-gone');
} catch (err) {
  ok = false;
  log('ERROR', err && err.stack ? err.stack : err);
  for (const [i, p] of pages.entries()) await shot(p, `error-${names[i]}`);
}
await browser.close();
log(ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
