// Real-browser network test: two Chromium pages play through the lobby and a
// streamed FakeWorld game, (1) over WebRTC with PeerJS against a local PeerJS
// server (the public broker is not reachable from CI machines) and (2) over the
// BroadcastChannel 'local' transport (two tabs, one browser profile).
// Asserts that the client's reconstructed snapshot equals the host's at every
// tick, including a > 64 KB chunked full snapshot and a mid-game resync.
//
//   node tools/net-test.mjs [--shots DIR] [--ticks N] [--units N]
import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTTP_PORT = 8104;
const PEER_PORT = 9104;
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
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
async function playMatch(host, client, transport, { ticks, units, label, world = 'fake' }) {
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
  const result = await host.evaluate((o) => window.netTest.startGame(o), { units, ticks, world });
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
    await playMatch(h3, c3, 'peer', { ticks: 240, units: 0, label: 'real', world: 'real' });
    if (SHOTS) {
      await sleep(300);
      await h3.screenshot({ path: path.join(SHOTS, 'real-host.png') });
      await c3.screenshot({ path: path.join(SHOTS, 'real-client.png') });
    }
    await ctxC.close();
    await ctxD.close();
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
