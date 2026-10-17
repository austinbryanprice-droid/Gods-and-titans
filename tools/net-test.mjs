// Real-browser network test: two Chromium pages play through the lobby and a
// streamed FakeWorld game, (1) over WebRTC with PeerJS against a local PeerJS
// server (the public broker is not reachable from CI machines) and (2) over the
// BroadcastChannel 'local' transport (two tabs, one browser profile).
// Asserts that the client's reconstructed snapshot equals the host's at every
// tick, including a > 64 KB chunked full snapshot and a mid-game resync.
// Also: failed joins (broker unreachable, WebRTC that never connects) show the
// friendly messages within ~15 s; long main-thread stalls on either side do not
// drop the connection; a client that loses the host ends cleanly and a host
// that loses a client keeps playing with an AI in its place.
//
//   node tools/net-test.mjs [--shots DIR] [--ticks N] [--units N] [--http-port N] [--peer-port N]
import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const HTTP_PORT = Number(opt('http-port', 8104));
const PEER_PORT = Number(opt('peer-port', 9104));
const DEAD_PORT = PEER_PORT + 1; // nothing listens here: an unreachable signaling server
const SHOTS = opt('shots', null);
const TICKS = Number(opt('ticks', 300));
const UNITS = Number(opt('units', 700));
const PEER_QS = `peerHost=127.0.0.1&peerPort=${PEER_PORT}&peerPath=/myapp&peerSecure=0`;

const children = [];
let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}

function run(cmd, cmdArgs) {
  const child = spawn(cmd, cmdArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => {
    const s = String(d).trim();
    if (s) console.log(`  [${path.basename(cmdArgs[0] || cmd)}] ${s}`);
  });
  children.push(child);
  return child;
}

async function waitHttp(url, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    if (Date.now() - t0 > ms) throw new Error(`server at ${url} did not start`);
    await sleep(150);
  }
}

async function waitFn(page, fn, arg, ms = 20000) {
  await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
}

async function openPage(context, query, label) {
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${label} ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`  [${label} pageerror] ${e.message}`));
  await page.goto(`http://localhost:${HTTP_PORT}/tools/net-test.html?${query}`);
  await waitFn(page, () => window.netTest && window.netTest.ready);
  return page;
}

/** Lobby exchange + streamed game between two pages. */
/** Joins that cannot work must fail within ~15 s with the messages the menus show. */
async function failedJoins(browser, host) {
  const { PEER_MESSAGES, brokerMessage } = await import('../src/net/transport.js');
  // 1. Signaling server unreachable.
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const dead = await openPage(ctx, `peerHost=127.0.0.1&peerPort=${DEAD_PORT}&peerPath=/myapp&peerSecure=0`, 'no-broker');
  const r1 = await dead.evaluate(() => window.netTest.failJoin({ code: 'ABCDE' }));
  check(r1.message === brokerMessage({ peerHost: '127.0.0.1' }) && r1.ms < 16000,
    `peer: unreachable signaling server fails in ${(r1.ms / 1000).toFixed(1)} s ("${r1.message}")`);
  check(r1.menuText === r1.message, 'peer: the join screen shows that message unchanged');
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await dead.screenshot({ path: path.join(SHOTS, 'fail-broker.png') });
  }
  // 2. Broker fine, room exists, but WebRTC never connects (relay-only ICE without a TURN server,
  // like a strict firewall that blocks UDP).
  const code = await host.evaluate(() => window.netTest.host({ transport: 'peer', name: 'Hosty' }));
  const blocked = await openPage(ctx, `${PEER_QS}&relay=1`, 'firewalled');
  const r2 = await blocked.evaluate((c) => window.netTest.failJoin({ code: c }), code);
  check(r2.message === PEER_MESSAGES.webrtc && r2.ms < 17000,
    `peer: a WebRTC link that never connects fails in ${(r2.ms / 1000).toFixed(1)} s ("${r2.message}")`);
  check(r2.menuText === r2.message, 'peer: the join screen shows that message unchanged');
  const slots = await host.evaluate(() => window.netTest.lobby.state.slots.map((s) => s.kind));
  check(slots[1] === 'open', `peer: the failed join left no ghost in the host's lobby (${slots.join(', ')})`);
  if (SHOTS) await blocked.screenshot({ path: path.join(SHOTS, 'fail-webrtc.png') });
  await host.evaluate(() => {
    window.netTest.lobby.close();
    window.netTest.lobby = null;
  });
  await ctx.close();
}

/**
 * Stall each side's main thread for 6 s while the game streams, with that
 * side's connection timeout lowered to 3 s: messages and Worker pulses pile up,
 * and the connection must still survive (silence is counted in time the page
 * ran, not wall-clock time).
 */
async function stallBothSides(host, client, label) {
  await waitFn(client, () => window.netTest.lastTick >= 40, null, 30000);
  const h = await host.evaluate(() => window.netTest.stallFor(6000, 3000));
  await sleep(2600);
  const c = await client.evaluate(() => window.netTest.stallFor(6000, 3000));
  await sleep(2600);
  const state = async (page) => page.evaluate(() => {
    const s = window.netTest.session;
    return {
      open: s.isHost ? [...s.clients.values()].every((c) => c.conn.open) && s.leftPlayers.size === 0 : s.conn.open && !window.netTest.ended,
      tick: window.netTest.lastTick,
    };
  });
  const hs = await state(host);
  const cs = await state(client);
  check(h.stalledMs >= 6000 && c.stalledMs >= 6000 && hs.open && cs.open,
    `${label}: 6 s main-thread stalls on the host and then the client (3 s timeouts) drop nothing (client at tick ${cs.tick})`);
}

async function playMatch(host, client, transport, { ticks, units, label, world = 'fake', stalls = false }) {
  const t0 = Date.now();
  const code = await host.evaluate((tr) => window.netTest.host({ transport: tr, name: 'Hosty' }), transport);
  check(/^[A-Z2-9]{5}$/.test(code), `${label}: host opened room ${code}`);
  const slot = await client.evaluate(({ tr, c, w }) => window.netTest.join({ transport: tr, code: c, name: 'Joiny', resyncAt: 120, world: w }), { tr: transport, c: code, w: world });
  check(slot === 1, `${label}: client joined slot ${slot} (${Date.now() - t0} ms)`);

  // Lobby updates both ways.
  await client.evaluate(() => window.netTest.client.setMine({ pantheon: 'norse', team: 2, color: 4 }));
  await waitFn(host, () => window.netTest.lobby.state.slots[1].pantheon === 'norse');
  const hs = await host.evaluate(() => window.netTest.lobby.state.slots[1]);
  check(hs.team === 2 && hs.color === 4 && hs.name === 'Joiny', `${label}: host sees the client's choices`);
  await host.evaluate(() => {
    window.netTest.lobby.setSlot(0, { pantheon: 'egyptian' });
    window.netTest.lobby.setMapSize('medium');
  });
  await waitFn(client, () => window.netTest.client.state.slots[0].pantheon === 'egyptian' && window.netTest.client.state.mapSize === 'medium');
  check(true, `${label}: client sees the host's changes`);
  await client.evaluate(() => window.netTest.client.sendChat('hello from the client'));
  await host.evaluate(() => window.netTest.lobby.sendChat('hello from the host'));
  await waitFn(host, () => window.netTest.chat.some((l) => l.text === 'hello from the client'));
  await waitFn(client, () => window.netTest.chat.some((l) => l.text === 'hello from the host'));
  check(true, `${label}: lobby chat both ways`);

  // Start and stream.
  const canStart = await host.evaluate(() => window.netTest.lobby.canStart());
  check(canStart, `${label}: host can start`);
  const t1 = Date.now();
  const resultP = host.evaluate((o) => window.netTest.startGame(o), { units, ticks, world });
  const stalled = stalls ? stallBothSides(host, client, label).catch((err) => check(false, `${label}: stall check (${err.message})`)) : null;
  const result = await resultP;
  await stalled;
  await waitFn(client, (t) => window.netTest.lastTick >= t, result.tick, 30000);
  const secs = (Date.now() - t1) / 1000;
  if (world === 'fake') check(result.fullChars > 64 * 1024, `${label}: first full snapshot is ${(result.fullChars / 1024).toFixed(1)} KB (> 64 KB)`);
  else console.log(`       first full snapshot ${(result.fullChars / 1024).toFixed(1)} KB`);
  const hostHashes = await host.evaluate(() => window.netTest.hashes);
  const hostInfo = await host.evaluate(() => ({ worker: window.netTest.session.ticker.usesWorker, dropped: window.netTest.session.ticker.dropped }));
  check(hostInfo.worker, `${label}: host ticks from the Worker metronome (${hostInfo.dropped} ticks dropped by the catch-up cap)`);
  const clientInfo = await client.evaluate(() => ({
    hashes: window.netTest.hashes,
    chunked: window.netTest.chunkedMessages,
    maxFrame: window.netTest.maxFrameChars,
    resyncs: window.netTest.session.resyncs,
    myIndex: window.netTest.myIndex,
    errors: window.netTest.errors,
    entities: window.netTest.session.viewState.entities.size,
    ping: window.netTest.session.pingMs,
    mapHashOk: window.netTest.mapHashOk,
    mapMismatch: window.netTest.session.mapMismatch,
    myWorkers: [...window.netTest.session.viewState.entities.values()]
      .filter((e) => e.o === window.netTest.myIndex && e.t === 'worshipper').map((e) => e.st),
    me: window.netTest.session.viewState.me,
  }));
  const ticksSeen = Object.keys(clientInfo.hashes).map(Number);
  let mismatches = 0;
  for (const t of ticksSeen) if (hostHashes[t] !== clientInfo.hashes[t]) mismatches++;
  check(ticksSeen.length >= ticks * 0.9, `${label}: client reconstructed ${ticksSeen.length} snapshots in ${secs.toFixed(1)} s`);
  check(mismatches === 0, `${label}: every reconstructed snapshot equals the host's (${mismatches} mismatches)`);
  check(clientInfo.hashes[result.tick] === hostHashes[result.tick], `${label}: final snapshot at tick ${result.tick} matches`);
  if (world === 'fake') check(clientInfo.chunked >= 2, `${label}: ${clientInfo.chunked} messages arrived in chunks (max frame ${clientInfo.maxFrame} chars)`);
  check(clientInfo.mapHashOk === true, `${label}: client generated the same map as the host (mapHash ${result.mapHash})`);
  if (world === 'real') {
    check(clientInfo.mapMismatch === false, `${label}: ClientSession reports no map mismatch`);
    const busy = clientInfo.myWorkers.filter((st) => st === 'gather' || st === 'move' || st === 'return').length;
    check(busy >= 4, `${label}: client's gather command reached the sim (${busy}/${clientInfo.myWorkers.length} worshippers busy, gathered ${clientInfo.me && clientInfo.me.stats.gathered})`);
  }
  check(clientInfo.resyncs === 1, `${label}: mid-game resync answered with a full snapshot`);
  check(clientInfo.myIndex === 1, `${label}: client is player 1`);
  check(clientInfo.errors.length === 0, `${label}: no page errors ${clientInfo.errors.join('; ')}`);
  console.log(`       ${clientInfo.entities} entities, client ping ${clientInfo.ping} ms`);

  if (world === 'real') return code;
  // In-game command and chat round trip (commands land on the client's player index).
  await client.evaluate(() => {
    window.netTest.session.sendCommand({ type: 'stop', units: [1], player: 0 });
    window.netTest.session.sendChat('gg');
  });
  await waitFn(host, () => window.netTest.session.world.queue.length > 0 || window.netTest.session.world.commands.length > 0);
  const cmd = await host.evaluate(() => {
    const w = window.netTest.session.world;
    const q = w.queue[0] || w.commands[w.commands.length - 1];
    return { player: q.player, type: q.cmd.type, hasPlayerField: 'player' in q.cmd };
  });
  check(cmd.player === 1 && cmd.type === 'stop' && !cmd.hasPlayerField, `${label}: client command applied as player 1`);
  return code;
}

async function main() {
  console.log('Starting http-server and PeerJS server…');
  // Same as `npx http-server …` / `npx peerjs …`, but run directly so kill() stops the real process.
  run(process.execPath, [realpathSync(path.join(ROOT, 'node_modules/.bin/http-server')), '.', '-p', String(HTTP_PORT), '-c-1', '--silent']);
  run(process.execPath, [realpathSync(path.join(ROOT, 'node_modules/.bin/peerjs')), '--port', String(PEER_PORT), '--path', '/myapp', '--host', '127.0.0.1']);
  await waitHttp(`http://localhost:${HTTP_PORT}/tools/net-test.html`);
  await waitHttp(`http://127.0.0.1:${PEER_PORT}/myapp`);

  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      // Expose real host candidates instead of mDNS names so two headless pages can reach each other.
      '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  try {
    console.log('\n[peer] WebRTC via PeerJS, two browser contexts');
    const ctxA = await browser.newContext({ viewport: { width: 1000, height: 640 } });
    const ctxB = await browser.newContext({ viewport: { width: 1000, height: 640 } });
    const host = await openPage(ctxA, PEER_QS, 'host');
    const client = await openPage(ctxB, PEER_QS, 'client');
    const t0 = Date.now();
    const notFound = await client.evaluate(async () => {
      const { LobbyClient } = await import('../src/net/lobby.js');
      try {
        await LobbyClient.join({ transport: 'peer', roomCode: 'QQQQQ', name: 'Lost' });
        return 'joined?!';
      } catch (err) {
        return err.message;
      }
    });
    check(/not found/.test(notFound), `peer: joining an unknown room fails cleanly in ${((Date.now() - t0) / 1000).toFixed(1)} s ("${notFound}")`);
    await failedJoins(browser, host);
    await playMatch(host, client, 'peer', { ticks: TICKS, units: UNITS, label: 'peer' });
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await sleep(300);
      await host.screenshot({ path: path.join(SHOTS, 'peer-host.png') });
      await client.screenshot({ path: path.join(SHOTS, 'peer-client.png') });
    }
    // Host leaves: the client's session ends.
    await host.close();
    await waitFn(client, () => [...document.querySelectorAll('#log div')].some((d) => /session ended/.test(d.textContent)), null, 20000);
    check(true, 'peer: client notices the host leaving');
    await ctxA.close();
    await ctxB.close();

    console.log('\n[local] BroadcastChannel, two tabs in one context');
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
    const h2 = await openPage(ctx, '', 'host');
    const c2 = await openPage(ctx, '', 'client');
    await playMatch(h2, c2, 'local', { ticks: Math.min(TICKS, 200), units: UNITS, label: 'local' });
    if (SHOTS) {
      await sleep(300);
      await h2.screenshot({ path: path.join(SHOTS, 'local-host.png') });
      await c2.screenshot({ path: path.join(SHOTS, 'local-client.png') });
    }
    await ctx.close();

    console.log('\n[peer] the real simulation (src/sim/world.js) over WebRTC');
    const ctxC = await browser.newContext({ viewport: { width: 1000, height: 640 } });
    const ctxD = await browser.newContext({ viewport: { width: 1000, height: 640 } });
    const h3 = await openPage(ctxC, PEER_QS, 'host');
    const c3 = await openPage(ctxD, PEER_QS, 'client');
    await playMatch(h3, c3, 'peer', { ticks: 480, units: 0, label: 'real', world: 'real', stalls: true });
    if (SHOTS) {
      await sleep(300);
      await h3.screenshot({ path: path.join(SHOTS, 'real-host.png') });
      await c3.screenshot({ path: path.join(SHOTS, 'real-client.png') });
    }
    // The client leaves mid-game: the host keeps playing, an AI takes the client's player over.
    await ctxD.close();
    await waitFn(h3, () => window.netTest.session.leftPlayers.has(1) && window.netTest.session.ais.has(1), null, 40000);
    const before = await h3.evaluate(() => {
      const s = window.netTest.session;
      s.ticker.start();
      return s.lastSnap.tick;
    });
    await sleep(1500);
    const after = await h3.evaluate(() => ({
      tick: window.netTest.session.lastSnap.tick,
      takeover: [...document.querySelectorAll('#log div')].filter((d) => /takes over/.test(d.textContent)).length,
      errors: window.netTest.errors,
    }));
    check(after.tick > before + 10 && after.takeover > 0 && after.errors.length === 0,
      `real: host keeps playing after the client left (tick ${before} → ${after.tick}, AI takes over player 1)`);
    if (SHOTS) await h3.screenshot({ path: path.join(SHOTS, 'real-host-after-client-left.png') });
    await ctxC.close();
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => {
    failures++;
    console.error(err);
  })
  .finally(() => {
    for (const c of children) c.kill();
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll network browser checks passed.');
    process.exit(failures ? 1 : 0);
  });
