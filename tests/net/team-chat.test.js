// Team chat (DESIGN 7, "Team chat"): a client's `teamchat {text}` is relayed by the host, as `chat {…, team: true}`,
// to the sender's team only (the sender included), and the host shows it only when on that team; all-chat still
// reaches everyone. A client drops a team line from another team. The host's replay records only what it saw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession, ClientSession } from '../../src/net/session.js';
import { createLoopbackPair } from '../../src/net/transport.js';
import { fakeWorldFactory, makeFakeMap } from '../../src/net/fake-world.js';
import { MSG } from '../../src/net/protocol.js';
import { wireFingerprint } from '../../src/net/wire-version.js';
import { createWorld } from '../../src/sim/world.js';
import { ReplayRecorder, sanitizeReplay, MIN_REPLAY_TICKS } from '../../src/game/replay.js';
import { ReplaySession } from '../../src/game/replay-session.js';
import { makeSetup } from '../sim/helpers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(1);
  }
}

/** Host (player 0) plus clients 1..n over loopback; `teams` gives each player's team. */
function makeGame(teams) {
  const names = ['Host', 'Ann', 'Ben', 'Cy'];
  const players = teams.map((team, index) => ({ index, name: names[index], team, pantheon: 'greek', color: '#d63a3a', kind: 'human', difficulty: null }));
  const setup = { version: '0.1.0', seed: 99, mapSize: 'small', players };
  const conns = new Map();
  const clients = [];
  for (let i = 1; i < teams.length; i++) {
    const [hostSide, clientSide] = createLoopbackPair();
    conns.set(i, hostSide);
    clients.push(new ClientSession({ setup, myIndex: i, conn: clientSide, generateMap: () => makeFakeMap(48, 48), pingIntervalMs: 20 }));
  }
  const host = new HostSession({ setup, myIndex: 0, conns, createWorld: fakeWorldFactory({ units: 10, buildings: 1, churn: 0 }), createAI: () => ({ tick() {} }), autoTick: false });
  return { setup, host, clients, conns };
}

async function startAll({ host, clients }) {
  host.start();
  for (const c of clients) c.start();
  await Promise.all(clients.map((c) => c.ready));
}

const stopAll = ({ host, clients }) => {
  for (const c of clients) c.stop();
  host.stop();
};

function heard(session) {
  const got = [];
  session.onChat((l) => !l.system && got.push(l));
  return got;
}

/** Every chat message the host sends down this player's connection. */
function tap(conn) {
  const out = [];
  const send = conn.send;
  conn.send = (msg) => {
    if (msg && msg.t === MSG.CHAT) out.push(msg);
    return send.call(conn, msg);
  };
  return out;
}

test('team chat is its own message name, and the message names are part of the protocol fingerprint', () => {
  // A build without TEAM_CHAT would take a team line as nothing (or broadcast it, were it a flag on CHAT): a new
  // message name changes the fingerprint, so two such builds never meet in one room.
  assert.equal(MSG.TEAM_CHAT, 'teamchat');
  const base = wireFingerprint();
  MSG.EXTRA = 'extra';
  const changed = wireFingerprint();
  delete MSG.EXTRA;
  assert.notEqual(changed, base);
  assert.equal(wireFingerprint(), base);
});

test('a client’s team line reaches its ally and itself, never the enemy (nor the host on the other team)', async () => {
  // Host on team 1; Ann and Ben on team 2; Cy on team 3.
  const g = makeGame([1, 2, 2, 3]);
  await startAll(g);
  const [ann, ben, cy] = g.clients;
  const seen = { host: heard(g.host), ann: heard(ann), ben: heard(ben), cy: heard(cy) };
  const toCy = tap(g.conns.get(3));
  ann.sendChat('push top at 10', { team: true });
  await waitFor(() => seen.ben.length === 1 && seen.ann.length === 1, 3000, 'the team line');
  await sleep(30);
  assert.deepEqual(seen.ben[0], { from: 1, name: 'Ann', text: 'push top at 10', system: false, team: true });
  assert.deepEqual(seen.ann, [{ from: 1, name: 'Ann', text: 'push top at 10', system: false, team: true }], 'the sender sees its own line, once');
  assert.deepEqual(seen.host, [], 'the host is on another team');
  assert.deepEqual(seen.cy, [], 'and so is Cy');
  assert.deepEqual(toCy, [], 'the line was never even sent down the enemy’s connection');

  // All-chat still reaches everyone, without the flag.
  ann.sendChat('gl hf');
  await waitFor(() => seen.cy.length === 1 && seen.host.length === 1, 3000, 'the all-chat line');
  assert.equal(seen.cy[0].text, 'gl hf');
  assert.equal(seen.cy[0].team, undefined);
  stopAll(g);
});

test('the host’s own team line goes to its teammates only; a teammate’s team line shows on the host', async () => {
  const g = makeGame([1, 1, 2]);
  await startAll(g);
  const [ann, ben] = g.clients;
  const seen = { host: heard(g.host), ann: heard(ann), ben: heard(ben) };
  const toBen = tap(g.conns.get(2));
  g.host.sendChat('I tech to titans', { team: true });
  await waitFor(() => seen.ann.length === 1, 3000, 'the ally to hear the host');
  assert.deepEqual(seen.host, [{ from: 0, name: 'Host', text: 'I tech to titans', system: false, team: true }]);
  assert.equal(seen.ann[0].team, true);
  ann.sendChat('ok', { team: true });
  await waitFor(() => seen.host.length === 2, 3000, 'the host to hear its ally');
  assert.deepEqual(seen.host[1], { from: 1, name: 'Ann', text: 'ok', system: false, team: true });
  await sleep(30);
  assert.deepEqual(seen.ben, []);
  assert.deepEqual(toBen, []);
  stopAll(g);
});

test('a player alone on a team: the team line goes to nobody but the sender', async () => {
  const g = makeGame([1, 2]);
  await startAll(g);
  const [ann] = g.clients;
  const seen = { host: heard(g.host), ann: heard(ann) };
  ann.sendChat('note to self', { team: true });
  await waitFor(() => seen.ann.length === 1, 3000, 'the echo');
  await sleep(30);
  assert.deepEqual(seen.host, []);
  stopAll(g);
});

test('a client drops a team line from a player on another team (a host that misroutes it)', async () => {
  const g = makeGame([1, 2, 2]);
  await startAll(g);
  const [ann] = g.clients;
  const seen = heard(ann);
  const conn = g.conns.get(1);
  conn.send({ t: MSG.CHAT, from: 0, name: 'Host', text: 'enemy secret', system: false, team: true });
  conn.send({ t: MSG.CHAT, from: 2, name: 'Ben', text: 'ally line', system: false, team: true });
  await waitFor(() => seen.length === 1, 3000, 'the ally line');
  await sleep(30);
  assert.deepEqual(seen.map((l) => l.text), ['ally line']);
  stopAll(g);
});

test('team chat shares the chat bucket: a flood is dropped on the host', async () => {
  const g = makeGame([1, 1]);
  await startAll(g);
  const [ann] = g.clients;
  const seen = heard(g.host);
  for (let i = 0; i < 20; i++) ann.sendChat(`spam ${i}`, { team: i % 2 === 0 });
  await sleep(100);
  assert.ok(seen.length <= 6, `at most the burst gets through (${seen.length})`);
  stopAll(g);
});

test('the replay records the host’s own team’s lines with their flag, and never another team’s', () => {
  const setup = makeSetup(4, { teams: [1, 1, 2, 2] });
  for (const p of setup.players) Object.assign(p, { kind: 'human', difficulty: null });
  const host = new HostSession({ setup, myIndex: 0, createWorld, autoTick: false, useWorker: false });
  const rec = new ReplayRecorder({ world: host.world, setup, myIndex: 0, now: () => 1000 }).attach();
  host.onChat((line) => rec.chat(line));
  host.start();
  host.step(10);
  host.sendChat('to everyone');
  host.sendChat('to my ally', { team: true });
  host.relayTeamChat({ from: 1, name: 'P1', text: 'ally reply', system: false });
  host.relayTeamChat({ from: 2, name: 'P2', text: 'enemy plan', system: false });
  host.step(MIN_REPLAY_TICKS);
  const record = rec.finish({ result: null });
  host.stop();
  const texts = record.chat.map((r) => r[2]);
  assert.deepEqual(texts, ['to everyone', 'to my ally', 'ally reply'], 'the other team’s line never reached the host');
  assert.equal(record.chat[0].length, 3, 'an all-chat row stays short');
  assert.equal(record.chat[1][5], 1, 'a team row carries its flag');

  const clean = sanitizeReplay(JSON.parse(JSON.stringify(record)));
  assert.ok(clean);
  assert.deepEqual(clean.chat.map((r) => !!r[5]), [false, true, true]);
  const s = new ReplaySession({ record: clean, createWorld, autoTick: false, useWorker: false });
  const lines = [];
  s.onChat((l) => lines.push(l));
  s.start();
  s.step(40);
  s.stop();
  assert.deepEqual(lines.map((l) => [l.text, !!l.team]), [['to everyone', false], ['to my ally', true], ['ally reply', true]]);
});
