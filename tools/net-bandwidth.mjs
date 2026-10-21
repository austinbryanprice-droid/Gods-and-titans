#!/usr/bin/env node
// Network bandwidth of a real game: the real World (src/sim/world.js) with four
// AI players (src/ai/ai.js) on a medium map runs inside a HostSession that
// streams its snapshots over in-memory loopback connections to ClientSessions,
// exactly as in an online game (same codec, framing and JSON). Reports, per
// client, the bytes per second actually put on the wire (UTF-8, as a WebRTC
// data channel sends strings) — average, median, p95 and max over game seconds,
// the message sizes, which parts of the delta cost what, and the host CPU per
// delta encode. Every --verify ticks each client's reconstructed snapshot is
// compared with the host's (deep equality after a JSON round trip).
//
// --fill=200 starts every player already at that population (Houses for the cap, 30
// worshippers, 3 gods, the Titan and a mixed army) with the armies sent to the middle, so
// the heaviest battle the population cap allows is on screen from the first second.
//
//   node tools/net-bandwidth.mjs [--minutes=18] [--seed=7] [--clients=3]
//        [--size=medium] [--teams=2v2|ffa] [--difficulty=normal] [--fill=200]
//        [--verify=10] [--json=out.json] [--quiet]
import { isDeepStrictEqual } from 'node:util';
import { writeFileSync } from 'node:fs';
import { createWorld } from '../src/sim/world.js';
import { createAI } from '../src/ai/ai.js';
import { HostSession, ClientSession } from '../src/net/session.js';
import { createLoopbackPair } from '../src/net/transport.js';
import { PLAYER_COLORS, TICK_RATE, POP_MAX } from '../src/config.js';
import { PANTHEONS as PANTHEON_DATA, getUnitType } from '../src/data/index.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const MINUTES = Number(args.minutes ?? 18);
const SEED = Number(args.seed ?? 7);
const CLIENTS = Math.max(1, Math.min(3, Number(args.clients ?? 3)));
const SIZE = args.size || 'medium';
const TEAMS = args.teams || '2v2';
const DIFF = args.difficulty || 'normal';
const VERIFY = Math.max(1, Number(args.verify ?? 10));
const FILL = Math.min(POP_MAX, Math.max(0, Number(args.fill ?? 0)));
const QUIET = !!args.quiet;
const PANTHEONS = (args.pantheons || 'greek,norse,egyptian,japanese').split(',');

const sleepImmediate = () => new Promise((r) => setImmediate(r));
const json = (v) => JSON.parse(JSON.stringify(v));
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
const kb = (b) => (b / 1024).toFixed(1);

function summary(values) {
  const s = Float64Array.from(values).sort();
  const sum = values.reduce((a, b) => a + b, 0);
  return { n: values.length, avg: values.length ? sum / values.length : 0, p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99), max: s.length ? s[s.length - 1] : 0 };
}

/** Give every player `pop` population at once: Houses, 30 worshippers, 3 gods, the Titan and a mixed army. */
function fillToPop(world, pop) {
  for (const p of world.players) {
    const tc = world.buildingList.find((b) => b.owner === p.index && b.type === 'town_center');
    Object.assign(p, { gold: 20000, wood: 20000, faith: 5000 });
    for (let n = 0; p.popCap < pop && n < 80; n++) {
      const spot = world.findPlacement(p.index, 'house', tc.x, tc.y, 30);
      if (!spot) break;
      world.createBuilding(p.index, 'house', spot.tx, spot.ty, true, true);
    }
    const pan = PANTHEON_DATA[p.pantheon];
    let k = 0;
    const spawn = (type) => {
      const a = k * 2.399963;
      const r = 6 + (k % 7) + 3;
      k++;
      return world.spawnUnit(p.index, type, tc.x + Math.cos(a) * r, tc.y + Math.sin(a) * r, { silent: true });
    };
    while (world.unitList.filter((u) => u.owner === p.index && u.def.class === 'worker').length < 30) spawn('worshipper');
    for (const g of pan.gods.slice(0, 3)) spawn(g.id);
    spawn(pan.titan.id);
    const mix = ['warrior', 'archer', 'warrior', 'archer', pan.creatures[0].id, 'priest', pan.creatures[1].id, 'warrior', 'archer', pan.creatures[0].id, pan.creatures[2].id, 'warrior'];
    for (let m = 0; p.popUsed < Math.min(pop, p.popCap) && m < 1000; m++) {
      const type = mix[m % mix.length];
      if (p.popUsed + getUnitType(type).pop <= Math.min(pop, p.popCap)) spawn(type);
      else if (p.popUsed >= Math.min(pop, p.popCap) - 1) break;
    }
    const army = world.unitList.filter((u) => u.owner === p.index && u.def.class !== 'worker').map((u) => u.id);
    world.issueCommand(p.index, { type: 'attackMove', units: army, x: world.map.width / 2, y: world.map.height / 2 });
  }
  world.time = 600; // the AIs are past every first-attack timer
  world.hash.rebuild(world.unitList);
}

async function main() {
  const setup = {
    version: '0.1.0',
    seed: SEED,
    mapSize: SIZE,
    players: [0, 1, 2, 3].map((i) => ({
      index: i, name: `AI ${i}`, team: TEAMS === 'ffa' ? i + 1 : (i < 2 ? 1 : 2), pantheon: PANTHEONS[i % PANTHEONS.length],
      color: PLAYER_COLORS[i], kind: 'ai', difficulty: DIFF,
    })),
  };
  // Clients watch as players 1..CLIENTS (their AIs keep playing: kind 'ai').
  const conns = new Map();
  const clients = [];
  const wire = []; // per client: { bytes per game second, message sizes, chunked frames }
  for (let i = 1; i <= CLIENTS; i++) {
    const [hostSide, clientSide] = createLoopbackPair({ heartbeatMs: 0 });
    const w = { secBytes: [0], msgBytes: [], fullBytes: [], frames: 0, chunked: 0 };
    const raw = hostSide.rawSend;
    let msgAcc = 0;
    let msgType = '';
    const record = (type, bytes) => {
      if (type === 'delta') w.msgBytes.push(bytes);
      else if (type === 'full') w.fullBytes.push(bytes);
    };
    hostSide.rawSend = (f) => {
      const b = Buffer.byteLength(f, 'utf8');
      w.secBytes[w.secBytes.length - 1] += b;
      w.frames++;
      if (f[0] === '~') {
        // Chunk '~seq,i,n|payload': the first payload starts with '{"t":"<type>"'.
        w.chunked++;
        const m = f.match(/^~\d+,(\d+),(\d+)\|(\{"t":"(\w+)")?/);
        if (m && m[1] === '0') {
          msgAcc = 0;
          msgType = m[4] || '';
        }
        msgAcc += b;
        if (m && Number(m[1]) === Number(m[2]) - 1) record(msgType, msgAcc);
      } else {
        const m = f.match(/^\{"t":"(\w+)"/);
        if (m) record(m[1], b);
      }
      raw(f);
    };
    conns.set(i, hostSide);
    wire.push(w);
    clients.push(new ClientSession({ setup, myIndex: i, conn: clientSide, pingIntervalMs: 1e9 }));
  }
  // Delta section sizes (characters of JSON per top-level key), measured on client 1.
  const sections = {};
  const counts = { events: 0, eventTypes: {}, added: 0, moved: 0, changed: 0, removed: 0 };
  clients[0].conn.onMessage((msg) => {
    if (msg.t !== 'delta') return;
    for (const k in msg.d) sections[k] = (sections[k] || 0) + JSON.stringify(msg.d[k]).length + k.length + 4;
    if (Array.isArray(msg.d.e)) {
      counts.events += msg.d.e.length;
    }
  });

  const host = new HostSession({ setup, myIndex: 0, conns, createWorld, createAI, autoTick: false, useWorker: false });
  // Count event types and entity changes on the host side (format independent).
  host.viewState.on('*', (ev) => {
    counts.eventTypes[ev.type] = (counts.eventTypes[ev.type] || 0) + 1;
  });
  if (FILL) {
    fillToPop(host.world, FILL);
    host.lastSnap = null;
    host.takeSnapshot(); // the first full snapshot already holds the filled armies
    console.log(`filled to ${FILL}: pop ${host.world.players.map((p) => `${p.popUsed}/${p.popCap}`).join(' ')}, ${host.lastSnap.entities.length} entities`);
  }
  host.start();
  for (const c of clients) c.start();
  await sleepImmediate();
  await Promise.all(clients.map((c) => c.ready));

  const ticks = Math.round(MINUTES * 60 * TICK_RATE);
  const tickMs = [];
  const encMs = [];
  const entityCounts = [];
  let mismatches = 0;
  let verified = 0;
  const t0 = performance.now();
  let lastReport = t0;
  for (let t = 1; t <= ticks; t++) {
    const enc0 = host.netStats.encodeMs;
    const s0 = performance.now();
    host.step(1);
    tickMs.push(performance.now() - s0);
    encMs.push(host.netStats.encodeMs - enc0);
    await sleepImmediate();
    if (t % TICK_RATE === 0) {
      for (const w of wire) w.secBytes.push(0);
      entityCounts.push(host.lastSnap.entities.length);
    }
    if (t % VERIFY === 0 || t === ticks) {
      const want = json(host.lastSnap);
      for (const c of clients) {
        verified++;
        if (!c.snap || c.snap.tick !== want.tick || !isDeepStrictEqual(c.snap, want)) {
          mismatches++;
          if (mismatches <= 3) console.log(`  MISMATCH client ${c.myIndex} at tick ${want.tick}`);
        }
      }
    }
    if (!QUIET && performance.now() - lastReport > 10000) {
      lastReport = performance.now();
      const done = wire[0].secBytes.slice(0, -1);
      const recent = done.slice(-60);
      console.log(`  ${(t / TICK_RATE / 60).toFixed(1)} min: ${host.lastSnap.entities.length} entities, last minute avg ${kb(recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length))} KB/s per client`);
    }
    if (host.lastSnap.gameOver && !host.endedAt) host.endedAt = t;
  }
  const wallS = (performance.now() - t0) / 1000;
  const gameSeconds = ticks / TICK_RATE;

  const perClient = wire.map((w, i) => {
    const secs = w.secBytes.slice(0, Math.floor(gameSeconds));
    const total = w.secBytes.reduce((a, b) => a + b, 0);
    return { client: i + 1, totalMB: total / 1048576, perSecond: summary(secs), deltaMsg: summary(w.msgBytes), fulls: w.fullBytes.length, fullKB: w.fullBytes.map((b) => b / 1024), frames: w.frames, chunkedFrames: w.chunked };
  });
  const sectionTotal = Object.values(sections).reduce((a, b) => a + b, 0);
  const result = {
    setup: { seed: SEED, size: SIZE, teams: TEAMS, difficulty: DIFF, pantheons: PANTHEONS, minutes: MINUTES, clients: CLIENTS },
    gameOverAtMin: host.endedAt ? host.endedAt / TICK_RATE / 60 : null,
    wallSeconds: wallS,
    entities: summary(entityCounts),
    tickMs: summary(tickMs),
    encodeMs: summary(encMs),
    perClient,
    sections: Object.fromEntries(Object.entries(sections).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { share: v / sectionTotal, avgCharsPerDelta: v / ticks }])),
    eventsPerTick: counts.events / ticks,
    eventTypes: counts.eventTypes,
    finalFullKB: Buffer.byteLength(JSON.stringify({ t: 'full', snap: host.lastSnap, felledAll: host.felledAll })) / 1024,
    verified,
    mismatches,
    resyncs: clients.map((c) => c.resyncs),
  };

  const c1 = perClient[0];
  console.log(`\nReal game: ${MINUTES} game minutes (${SIZE}, ${TEAMS}, 4 × AI ${DIFF}, seed ${SEED}${result.gameOverAtMin ? `, game over at ${result.gameOverAtMin.toFixed(1)} min` : ''}) in ${wallS.toFixed(0)} s wall`);
  console.log(`  entities: avg ${result.entities.avg.toFixed(0)}, max ${result.entities.max}`);
  for (const c of perClient) {
    const s = c.perSecond;
    console.log(`  client ${c.client}: ${kb(s.avg)} KB/s avg, p50 ${kb(s.p50)}, p95 ${kb(s.p95)}, p99 ${kb(s.p99)}, max ${kb(s.max)} KB/s; total ${c.totalMB.toFixed(1)} MB; ${c.fulls} full(s)`);
  }
  console.log(`  delta message: avg ${(c1.deltaMsg.avg / 1024).toFixed(2)} KB, p95 ${(c1.deltaMsg.p95 / 1024).toFixed(2)} KB, max ${(c1.deltaMsg.max / 1024).toFixed(1)} KB; final full snapshot ${result.finalFullKB.toFixed(1)} KB`);
  console.log(`  host encode per snapshot: avg ${result.encodeMs.avg.toFixed(3)} ms, p95 ${result.encodeMs.p95.toFixed(3)} ms, max ${result.encodeMs.max.toFixed(2)} ms (host step incl. sim + AI: avg ${result.tickMs.avg.toFixed(2)} ms)`);
  console.log(`  delta sections: ${Object.entries(result.sections).map(([k, v]) => `${k} ${(v.share * 100).toFixed(1)}%`).join(', ')}`);
  console.log(`  events/tick ${result.eventsPerTick.toFixed(1)}: ${Object.entries(counts.eventTypes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / ticks).toFixed(2)}`).join(', ')}`);
  console.log(`  exactness: ${verified - mismatches}/${verified} client snapshots equal the host's; resyncs ${result.resyncs.join(', ')}`);
  if (args.json) writeFileSync(args.json, JSON.stringify(result, null, 1));
  for (const c of clients) c.stop();
  host.stop();
  setTimeout(() => process.exit(mismatches ? 1 : 0), 400);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
