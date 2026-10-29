// The stand-in AI that holds a dropped player's seat (DESIGN 7, #86) keeps that player's god
// powers and resources: it never casts a power nor sends a gift, while a computer player's own AI
// in the same game does both. Real sim and AI over a loopback link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession, ClientSession } from '../../src/net/session.js';
import { createLoopbackPair } from '../../src/net/transport.js';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(1);
  }
}

test('stand-in AI: plays the dropped player\'s seat without casting their god powers or gifting their resources', async () => {
  const players = [
    { index: 0, name: 'Host', team: 1, pantheon: 'greek', color: '#d63a3a', kind: 'human', difficulty: null },
    { index: 1, name: 'Ann', team: 1, pantheon: 'greek', color: '#3a6ad6', kind: 'human', difficulty: null },
    { index: 2, name: 'Bot', team: 1, pantheon: 'greek', color: '#3ad66a', kind: 'ai', difficulty: 'hard' },
    { index: 3, name: 'Foe', team: 2, pantheon: 'greek', color: '#d6d63a', kind: 'ai', difficulty: 'easy' },
  ];
  const setup = { version: '0.1.0', seed: 33, mapSize: 'small', players };
  const made = [];
  const [hostSide, clientSide] = createLoopbackPair();
  const host = new HostSession({
    setup, myIndex: 0, conns: new Map([[1, hostSide]]), createWorld, autoTick: false, useWorker: false,
    createAI: (world, index, difficulty, opts) => {
      made.push({ index, opts });
      return createAI(world, index, difficulty, opts);
    },
  });
  const w = host.world;
  const sent = []; // [player, command type] of god powers and gifts
  const issue = w.issueCommand.bind(w);
  w.issueCommand = (p, cmd) => {
    if (cmd.type === 'godPower' || cmd.type === 'trade') sent.push([p, cmd.type]);
    return issue(p, cmd);
  };
  const ann = new ClientSession({ setup, myIndex: 1, conn: clientSide, pingIntervalMs: 50 });
  host.start();
  ann.start();
  await ann.ready;
  const lines = [];
  host.onChat((l) => lines.push(l));
  ann.stop();
  clientSide.close('reload');
  await waitFor(() => host.standIns.has(1), 3000, 'stand-in');
  assert.match(lines.at(-1).text, /keeps their god powers for them\.$/);
  assert.deepEqual(made.map((m) => [m.index, !!(m.opts && m.opts.standIn)]), [[2, false], [3, false], [1, true]], 'only the stand-in is flagged');
  const standIn = host.ais.get(1).ai;
  assert.equal(standIn.standIn, true);
  assert.equal(host.ais.get(2).ai.standIn, false);

  // Five minutes of play, then a minute in which the host (a human who does nothing here) is broke
  // while Ann's seat and the Bot hold full treasuries, so a teammate has someone to help.
  const units0 = w.unitList.filter((u) => u.owner === 1 && !u.dead).length;
  while (w.time < 300) host.step(20);
  while (w.time < 360) {
    for (const i of [1, 2]) {
      w.players[i].gold = Math.max(w.players[i].gold, 3000);
      w.players[i].wood = Math.max(w.players[i].wood, 3000);
    }
    w.players[0].gold = 0;
    w.players[0].wood = 0;
    host.step(20);
  }
  const by = (p, type) => sent.filter((s) => s[0] === p && s[1] === type).length;
  assert.ok(by(2, 'godPower') > 0, 'the computer player still casts its powers');
  assert.ok(by(2, 'trade') > 0, 'and still helps a broke teammate');
  assert.equal(by(1, 'godPower'), 0, 'the stand-in casts none of Ann\'s powers');
  assert.equal(by(1, 'trade'), 0, 'nor gives away her resources');
  assert.equal(w.players[1].powers.used, 0, 'all of Ann\'s powers are still hers to use');
  assert.equal(standIn.stats.powers, 0);
  assert.ok(standIn.stats.thinks > 0 && w.unitList.filter((u) => u.owner === 1 && !u.dead).length > units0, 'the stand-in still plays: it trains');
  host.stop();
});
