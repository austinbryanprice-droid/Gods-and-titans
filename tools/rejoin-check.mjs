// Two-tab rejoin check (DESIGN 7): a host and a client over the local transport (BroadcastChannel),
// the client's page reloads mid-game, the host's AI holds the seat, and the client rejoins from the
// title screen's Rejoin button. Serve the repo first (python3 -m http.server 8321), then:
//   node tools/rejoin-check.mjs [--base=http://localhost:8321] [--out=dir]
// Prints what each step saw and exits non-zero on a failed check. Software GL is slow: allow minutes.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const BASE = arg('base', 'http://localhost:8321');
const OUT = arg('out', '');

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
async function until(page, fn, what, ms = 120000, arg = undefined) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await page.evaluate(fn, arg);
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
await ctx.addInitScript(() => {
  window.__longtasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longtasks.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // ignore
  }
});
const host = await ctx.newPage();
const client = await ctx.newPage();
for (const [p, who] of [[host, 'Hosta'], [client, 'Rejo']]) {
  p.on('pageerror', (e) => log(`${who} page error:`, e.message));
  p.on('console', (m) => /\[net\]|rejoin/i.test(m.text()) && log(`${who} console:`, m.text().slice(0, 200)));
  await p.goto(`${BASE}/?transport=local`);
  await p.evaluate((w) => sessionStorage.setItem('who', w), who);
  await p.reload();
}
let ok = true;
const check = (cond, what) => {
  log(cond ? 'PASS' : 'FAIL', what);
  if (!cond) ok = false;
};

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
  const myIndex = await client.evaluate(() => window.__game.myIndex);
  const ticket = await client.evaluate(() => JSON.parse(localStorage.getItem('mythicwar-rejoin') || 'null'));
  check(ticket && ticket.roomCode === code && /^[0-9a-f]{32}$/.test(ticket.token), `the client kept a rejoin ticket for room ${code}`);

  // The client's page reloads in the middle of the game.
  log('reloading the client');
  await client.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  log('visibility', await host.evaluate(() => document.visibilityState), await client.evaluate(() => document.visibilityState));
  await client.bringToFront(); // a player who reloads is looking at that tab
  await until(host, (i) => window.__game.session.standIns.has(i), 'stand-in AI on the host', 90000, myIndex);
  const leftLine = await host.evaluate(() => window.__game.session.chatLog.map((l) => l.text).find((t) => /has left the game/.test(t)));
  log('host chat:', leftLine);
  check(/An AI \((Easy|Normal|Hard|Brutal)\) plays for them until they rejoin/.test(leftLine || ''), 'the host says an AI holds the seat');
  const tickAway = await host.evaluate(() => window.__game.viewState.tick);

  await until(client, () => !!document.querySelector('.mw-rejoin-btn'), 'Rejoin button on the title', 60000);
  check(true, 'the title screen offers Rejoin Online Game');
  if (OUT) await client.screenshot({ path: `${OUT}/rejoin-title.png`, timeout: 240000 });
  // Both tabs share one software GPU here: the host drawing every frame starves the client's shader compiles for
  // minutes. Players have a GPU each, so the host draws one frame every 2 s while the client loads (its sim and
  // network run on, off the frame loop).
  await host.evaluate(() => {
    window.__raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 2000);
  });
  await client.locator('.mw-rejoin-btn').click();
  const t0 = Date.now();
  const watch = setInterval(async () => {
    try {
      const h = await host.evaluate((i) => {
        const c = window.__game.session.clients.get(i);
        return c ? { silent: Math.round(c.conn.silentMs), timeout: c.conn.timeoutMs, grace: c.grace, fulls: c.fulls } : null;
      }, myIndex);
      log(`+${Math.round((Date.now() - t0) / 1000)}s host sees`, JSON.stringify(h));
    } catch {
      // ignore
    }
  }, 10000);
  if (process.argv.includes('--trace')) {
    client.on('console', (m) => log('client:', m.text().slice(0, 160)));
  }
  await until(client, ready, 'client back in the game', 240000);
  clearInterval(watch);
  await host.evaluate(() => {
    window.requestAnimationFrame = window.__raf;
  });
  log('client long tasks (start ms, ms):', JSON.stringify(await client.evaluate(() => window.__longtasks.filter((t) => t[1] > 2000))));
  const back = await client.evaluate(() => ({ tick: window.__game.viewState.tick, myIndex: window.__game.myIndex, units: [...window.__game.viewState.entities.values()].filter((e) => e.o === window.__game.myIndex).length }));
  log('client back:', JSON.stringify(back));
  check(back.myIndex === myIndex, 'the same seat');
  check(back.tick >= tickAway, `the game went on meanwhile (tick ${tickAway} → ${back.tick})`);
  check(back.units > 0, 'the client sees its own side');
  const hostState = await host.evaluate((i) => ({ standIn: window.__game.session.standIns.has(i), ai: window.__game.session.ais.has(i), line: window.__game.session.chatLog.map((l) => l.text).filter((t) => /has (left|rejoined)/.test(t)).at(-1) }), myIndex);
  log('host chat:', JSON.stringify(await host.evaluate(() => window.__game.session.chatLog.filter((l) => l.system).map((l) => l.text))));
  log('client session:', JSON.stringify(await client.evaluate(() => ({ stopped: window.__game.session.stopped, ended: window.__game.ended, stalled: window.__game.session.stalledMs }))));
  check(!hostState.standIn && !hostState.ai, 'the stand-in AI handed the seat back');
  check(/has rejoined the game/.test(hostState.line), 'the host says the player rejoined');

  // A command from the rejoined client reaches the host as that player's.
  const unit = await client.evaluate(() => [...window.__game.viewState.entities.values()].find((e) => e.o === window.__game.myIndex && e.k === 'u'));
  if (unit) {
    const since = await host.evaluate(() => window.__game.session.world.tickCount);
    await client.evaluate((id) => window.__game.session.sendCommand({ type: 'move', units: [id], x: 20, y: 20 }), unit.id);
    // The host's replay recorder keeps every command the World takes, with the player it came from.
    const mine = await until(host, ([i, id, t]) => window.__game.recorder.cmds.some(([tick, p, c]) => tick >= t && p === i && JSON.stringify(c).includes('move') && JSON.stringify(c).includes(String(id))), 'the command applied on the host', 60000, [myIndex, unit.id, since]).catch(() => false);
    check(!!mine, 'a move order from the rejoined client reached the World as that player\'s');
  }
  if (OUT) {
    await client.screenshot({ path: `${OUT}/rejoin-client-back.png`, timeout: 240000 });
    await host.screenshot({ path: `${OUT}/rejoin-host.png`, timeout: 240000 });
  }
} catch (err) {
  ok = false;
  log('ERROR', err.message);
}
await browser.close();
log(ok ? 'all checks passed' : 'some checks failed');
process.exit(ok ? 0 : 1);
