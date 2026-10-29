// Two-tab host migration and pause check (DESIGN 7): a host and a client over the local transport
// (BroadcastChannel). The client pauses the game for both and the host resumes it; then the host's tab
// closes mid-game, the client takes the game over in place (same view, no reload) and plays on; finally
// the old host opens the page again and takes its seat back from the title screen's Rejoin button.
// Serve the repo first (python3 -m http.server 8321), then:
//   node tools/handoff-check.mjs [--base=http://localhost:8321] [--out=dir]
// Prints what each step saw and exits non-zero on a failed check. Software GL is slow: allow minutes.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const BASE = arg('base', 'http://localhost:8321');
const OUT = arg('out', '');

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
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
    await new Promise((r) => setTimeout(r, 500));
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
let host = await ctx.newPage();
const client = await ctx.newPage();
const watchPage = (p, who) => {
  p.on('pageerror', (e) => log(`${who} page error:`, e.message));
  p.on('console', (m) => /\[net\]|\[game\]|handoff|migrat/i.test(m.text()) && log(`${who} console:`, m.text().slice(0, 200)));
};
for (const [p, who] of [[host, 'Hosta'], [client, 'Cleo']]) {
  watchPage(p, who);
  await p.goto(`${BASE}/?transport=local`);
  await p.evaluate((w) => sessionStorage.setItem('who', w), who);
  await p.reload();
}
let ok = true;
const check = (cond, what) => {
  log(cond ? 'PASS' : 'FAIL', what);
  if (!cond) ok = false;
};
// Both tabs share one software GPU: the tab not under test draws a frame every 2 s so the other is not starved.
const slowFrames = (p) => p.evaluate(() => {
  window.__raf = window.__raf || window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 2000);
});
const fastFrames = (p) => p.evaluate(() => {
  if (window.__raf) window.requestAnimationFrame = window.__raf;
});

try {
  await host.getByRole('button', { name: /Host Online Game/ }).click();
  const code = await until(host, () => {
    const el = document.querySelector('.mw-room-code');
    return el ? el.textContent.trim() : null;
  }, 'room code');
  log('room', code);
  await client.goto(`${BASE}/?transport=local&join=${code}`);
  await client.getByRole('button', { name: 'Join Game' }).click();
  await until(host, () => !document.querySelector('.mw-btn--start')?.disabled, 'client in the lobby');
  await host.locator('.mw-btn--start').click();
  log('started');
  const ready = () => !!(window.__game && window.__game.viewState && window.__game.viewState.snapshot && window.__game.renderer);
  await until(host, ready, 'host game running', 240000);
  await until(client, ready, 'client game running', 240000);
  const clientIndex = await client.evaluate(() => window.__game.myIndex);
  const hostIndex = await host.evaluate(() => window.__game.myIndex);

  // The heir: the client hears the plan and gets the game.
  const plan = await until(client, () => window.__game.session.plan, 'the plan at the client', 60000);
  log('plan', JSON.stringify(plan));
  check(plan.heir === clientIndex && plan.host === hostIndex, 'the client is the heir');
  const backup = await until(client, () => {
    const b = window.__game.session.backup;
    return b ? { tick: b.tick, enc: b.state.enc, chars: b.state.data.length, tokens: b.tokens.size, present: b.present } : null;
  }, 'a backup at the heir', 60000);
  log('backup', JSON.stringify(backup));
  check(backup.enc === 'gz' && backup.tokens === 2, `the heir has the game (${backup.chars} chars, gzip) and both tokens`);
  const hostTicket = await host.evaluate(() => JSON.parse(localStorage.getItem('mythicwar-rejoin') || 'null'));
  check(hostTicket && hostTicket.roomCode === plan.room, 'the host keeps a ticket into the heir\'s room');

  // Pause: the client presses Pause, both stop; the host resumes from the bar.
  await client.keyboard.press('Pause');
  await until(host, () => !!window.__game.session.pause, 'host paused', 30000);
  const t1 = await host.evaluate(() => window.__game.session.world.tickCount);
  await new Promise((r) => setTimeout(r, 3000));
  const t2 = await host.evaluate(() => window.__game.session.world.tickCount);
  check(t1 === t2, `the game stands still while paused (tick ${t1} → ${t2})`);
  const bars = await until(client, () => {
    const b = document.querySelector('.hud-pausebar');
    return b && !b.hidden ? b.textContent : null;
  }, 'pause bar at the client', 30000);
  log('pause bar:', bars);
  check(/Paused by Cleo/.test(bars), 'the bar says who paused it');
  if (OUT) await client.screenshot({ path: `${OUT}/pause-client.png`, timeout: 240000 });
  await host.locator('.hud-pause-btn').click({ force: true, timeout: 60000 });
  await until(client, () => !window.__game.session.pause, 'client resumed', 30000);
  const chat = await host.evaluate(() => window.__game.session.chatLog.filter((l) => l.system).map((l) => l.text));
  log('host chat:', JSON.stringify(chat));
  check(chat.some((t) => /Cleo paused the game \(2 pauses left\)/.test(t)) && chat.some((t) => /Hosta resumed the game/.test(t)), 'chat says who paused and who resumed');

  // Let a fresh backup arrive, then the host's tab closes.
  const b0 = backup.tick;
  await until(client, (t) => window.__game.session.backup && window.__game.session.backup.tick > t, 'a newer backup', 60000, b0);
  const before = await client.evaluate(() => ({ tick: window.__game.viewState.tick, units: [...window.__game.viewState.entities.values()].filter((e) => e.o === window.__game.myIndex).length }));
  log('client before the host leaves:', JSON.stringify(before));
  log('closing the host tab');
  await host.close();
  await client.bringToFront();
  await until(client, () => window.__game && window.__game.session.isHost && !window.__game.ended && !window.__game.migrating, 'the client hosts the game', 120000);
  const sameView = await client.evaluate(() => !!window.__game.renderer && window.__game.session.viewState === window.__game.viewState);
  check(sameView, 'the client carried on in place: same view, same renderer');
  const tA = await client.evaluate(() => window.__game.session.world.tickCount);
  await new Promise((r) => setTimeout(r, 4000));
  const after = await client.evaluate(() => ({
    tick: window.__game.session.world.tickCount, standIns: [...window.__game.session.standIns], ais: [...window.__game.session.ais.keys()],
    ended: window.__game.ended, overlay: window.__game.hud.overlays.name, msgs: [...document.querySelectorAll('.hud-msg')].map((m) => m.textContent).slice(-3),
    chat: window.__game.session.chatLog.filter((l) => l.system).map((l) => l.text).slice(-3), ticket: JSON.parse(localStorage.getItem('mythicwar-rejoin') || 'null'),
    plan: window.__game.session.plan,
  }));
  log('client after:', JSON.stringify(after));
  check(after.tick > tA, `the game runs on in the client's tab (tick ${tA} → ${after.tick})`);
  check(after.standIns.includes(hostIndex), 'an AI holds the old host\'s seat');
  check(!after.ended && !after.overlay, 'no Game Ended screen');
  check(after.ticket && after.ticket.roomCode !== code, 'the new host keeps a ticket into its own heir\'s room');
  // A command of the new host reaches its own World.
  const unit = await client.evaluate(() => [...window.__game.viewState.entities.values()].find((e) => e.o === window.__game.myIndex && e.k === 'u'));
  if (unit) {
    await client.evaluate((id) => window.__game.command({ type: 'move', units: [id], x: 22, y: 22 }), unit.id);
    const moved = await until(client, (id) => {
      const u = window.__game.session.world.entities ? window.__game.session.world.entities.get(id) : null;
      return u && u.order ? JSON.stringify(u.order).slice(0, 80) : (u && u.path ? 'path' : null);
    }, 'the order taken', 30000, unit.id).catch(() => null);
    check(!!moved, `an order from the new host is taken by its World (${moved})`);
  }
  if (OUT) await client.screenshot({ path: `${OUT}/handoff-client-hosts.png`, timeout: 240000 });

  // The old host opens the game again: the title screen's Rejoin takes it to the new host's room.
  await slowFrames(client);
  host = await ctx.newPage();
  watchPage(host, 'Hosta');
  await host.goto(`${BASE}/?transport=local`);
  // (Named Hosta again, the tab reads the store the old host's tab kept: its ticket into the heir's room.)
  await host.evaluate(() => sessionStorage.setItem('who', 'Hosta'));
  await host.reload();
  const kept = await host.evaluate(() => JSON.parse(localStorage.getItem('mythicwar-rejoin') || 'null'));
  check(kept && kept.token === hostTicket.token && kept.roomCode === hostTicket.roomCode, 'the old host\'s browser still has its ticket into the heir\'s room');
  await until(host, () => !!document.querySelector('.mw-rejoin-btn'), 'Rejoin button on the old host\'s title', 60000);
  await host.locator('.mw-rejoin-btn').click();
  const t0 = Date.now();
  const watch = setInterval(async () => {
    try {
      const h = await host.evaluate(() => ({ screen: (document.querySelector('.mw-rejoin') || {}).textContent?.slice(0, 160), game: !!window.__game, snap: !!(window.__game && window.__game.viewState && window.__game.viewState.snapshot) }));
      const c = await client.evaluate(() => ({ clients: [...window.__game.session.clients.keys()], lobby: !!window.__game.handoffLobby, rejoining: window.__game.handoffLobby ? window.__game.handoffLobby.rejoining.size : -1 }));
      log(`+${Math.round((Date.now() - t0) / 1000)}s old host`, JSON.stringify(h), 'new host', JSON.stringify(c));
    } catch (e) {
      log('watch failed', e.message);
    }
  }, 10000);
  try {
    await until(host, ready, 'the old host back in the game', 300000);
  } finally {
    clearInterval(watch);
  }
  await fastFrames(client);
  const back = await host.evaluate(() => ({ myIndex: window.__game.myIndex, isHost: window.__game.session.isHost }));
  log('old host back:', JSON.stringify(back));
  check(back.myIndex === hostIndex && !back.isHost, 'the old host plays its own seat again, as a client of the new host');
  const seat = await client.evaluate((i) => ({ standIn: window.__game.session.standIns.has(i), line: window.__game.session.chatLog.map((l) => l.text).filter((t) => /rejoined/.test(t)).at(-1) }), hostIndex);
  check(!seat.standIn && /Hosta has rejoined the game and takes back control from the AI/.test(seat.line || ''), 'the AI handed the seat back');
  if (OUT) await host.screenshot({ path: `${OUT}/handoff-old-host-back.png`, timeout: 240000 });
} catch (err) {
  ok = false;
  log('ERROR', err && err.stack ? err.stack : err);
}
await browser.close();
log(ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
