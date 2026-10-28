// Relics on the client (DESIGN 5.12): what the ViewState makes of the snapshot's relic list, the
// HUD's chip and texts, the stats the selection panel shows with a relic held, and the alerts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine } from '../../src/game/alerts.js';
import { ViewState } from '../../src/game/view-state.js';
import { MORTALS } from '../../src/data/index.js';
import { RELICS } from '../../src/data/relics.js';
import { unitMods } from '../../src/data/upgrades.js';
import { modsOf, relicsOf, relicChip, relicLine, relicCarryText, templeRelicsText, relicIcon } from '../../src/ui/hud-data.js';
import { hintContext, HINTS } from '../../src/ui/hint-data.js';
import { makeWorld } from '../sim/helpers.js';

function scene() {
  const world = makeWorld({ map: { camps: [{ x: 24, y: 24, level: 2 }] } });
  const base = JSON.parse(JSON.stringify(world.getSnapshot()));
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  const out = [];
  new AlertEngine({ viewState: vs, notify: (a) => out.push(a), settings: () => ({ alerts: 'all', tabAlerts: 'title' }) }).attach();
  let seq = 0;
  const worker = base.entities.find((e) => e.k === 'u' && e.o === 0);
  const town = base.entities.find((e) => e.k === 'b' && e.o === 0);
  const at = (time, { relics, edit, events = [] } = {}) => {
    const snap = JSON.parse(JSON.stringify(base));
    snap.time = time;
    snap.tick = 1000 + ++seq;
    snap.events = events;
    for (const e of snap.entities) if (e.k === 'u' && e.o === 0) e.st = 'gather';
    if (relics) snap.relics = relics;
    if (edit) edit(snap);
    vs.pushSnapshot(snap, 50);
  };
  return { world, vs, out, at, worker, town };
}

test('the ViewState finds relics: where they are, who carries them, what rests in a Temple, what a click picks up', () => {
  const { vs, at, worker, town } = scene();
  at(1);
  assert.deepEqual(vs.relics.map((r) => r.s), ['k']);
  const guarded = vs.relics[0];
  assert.deepEqual(vs.relicSpot(guarded), { x: 24, y: 24, holder: null });
  assert.equal(vs.relicNear(24.3, 24.2), null, 'a guarded relic cannot be picked up');
  at(2, { relics: [{ i: 0, t: 'kusanagi', s: 'g', x: worker.x + 0.5, y: worker.y }] });
  const free = vs.relics[0];
  assert.equal(vs.relicNear(worker.x + 0.8, worker.y), free, 'in sight of my Worshipper');
  assert.equal(vs.relicNear(worker.x + 3, worker.y), null, 'too far from the click');
  assert.ok(vs.relicKnown(free));
  at(3, { relics: [{ i: 0, t: 'kusanagi', s: 'c', c: worker.id, o: 0 }] });
  assert.equal(vs.relicCarriedBy(worker.id), vs.relics[0]);
  assert.equal(vs.relicSpot(vs.relics[0]).holder.id, worker.id);
  at(4, { relics: [{ i: 0, t: 'kusanagi', s: 'h', b: town.id, o: 0 }] });
  assert.deepEqual(vs.relicsIn(town.id).map((r) => r.t), ['kusanagi']);
  assert.equal(vs.relicCarriedBy(worker.id), null);
});

test('a relic out of sight: known once its tile is explored, never picked up through the fog', () => {
  const { vs, at } = scene();
  at(1, { relics: [{ i: 0, t: 'peaches', s: 'g', x: 70, y: 70 }] });
  const r = vs.relics[0];
  assert.equal(vs.relicKnown(r), false);
  assert.equal(vs.relicNear(70, 70), null);
});

test('the HUD: the relic chip, the Temple line, the carrier chip and the stats with a relic held', () => {
  const { vs, at, town } = scene();
  at(1);
  const c0 = relicChip(vs);
  assert.equal(c0.count, 0);
  assert.equal(c0.total, 1);
  assert.match(c0.title, /0 of 1 rest in your Temples/);
  assert.match(c0.title, /1 still guarded/);
  at(2, {
    relics: [{ i: 0, t: 'golden_fleece', s: 'h', b: town.id, o: 0 }],
    edit: (s) => { s.players[0].rl = ['golden_fleece']; },
  });
  const c1 = relicChip(vs);
  assert.equal(c1.count, 1);
  assert.match(c1.title, /Golden Fleece \(Greek\): Your soldiers have 10% more health\./);
  assert.deepEqual(relicsOf(vs, 0), ['golden_fleece']);
  assert.deepEqual(relicsOf(vs, 1), []);
  assert.equal(templeRelicsText([]), 'Relics: none. Clear a guarded creep camp and carry its relic here.');
  assert.equal(templeRelicsText(['golden_fleece', 'kusanagi']), 'Relics: 🐏 Golden Fleece, 🗡️ Kusanagi');
  assert.equal(relicCarryText('golden_fleece'), 'Carrying the Golden Fleece. Bring it to your Temple: your soldiers have 10% more health.');
  assert.equal(relicLine('nope'), '💎 A relic');
  assert.equal(relicIcon('amrita'), RELICS.amrita.icon);
  // a map without relics has no chip
  at(3, { relics: [] });
  assert.equal(relicChip(vs), null);
});

test('a relic held adds its bonus to the stats the panel shows', () => {
  const { vs, at } = scene();
  at(1);
  const before = unitMods(modsOf(vs, 0), MORTALS.warrior).hp;
  at(2, { edit: (s) => { s.players[0].rl = ['golden_fleece']; } });
  assert.ok(Math.abs(unitMods(modsOf(vs, 0), MORTALS.warrior).hp - before - 0.1) < 1e-9);
  at(3, { edit: (s) => { s.players[0].rl = ['bogus']; } });
  assert.equal(unitMods(modsOf(vs, 0), MORTALS.warrior).hp, before, 'unknown relic ids are ignored');
});

test('alerts: a relic set free by me, resting in my Temple, taken by a rival, fallen from my hands', () => {
  const { vs, at, out } = scene();
  at(1);
  out.length = 0;
  at(2, { events: [{ type: 'relic', ev: 'drop', i: 0, t: 'kusanagi', player: 0, x: 24, y: 24 }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'relic_free');
  assert.equal(out[0].icon, RELICS.kusanagi.icon);
  assert.match(out[0].text, /Kusanagi lies free! Right-click it with a Worshipper or a god/);
  assert.deepEqual(out[0].jump, { x: 24, y: 24 });
  assert.equal(out[0].ping.color, RELICS.kusanagi.color);
  out.length = 0;
  at(3, { events: [{ type: 'relic', ev: 'drop', i: 0, t: 'kusanagi', player: 1, x: 24, y: 24 }] });
  assert.equal(out.length, 0, 'a camp someone else cleared says nothing');
  at(4, { events: [{ type: 'relic', ev: 'house', i: 0, t: 'kusanagi', player: 0, x: 8, y: 8 }] });
  assert.equal(out.pop().text, 'The Kusanagi rests in your Temple: your warriors and archers deal 8% more damage.');
  at(5, { events: [{ type: 'relic', ev: 'house', i: 0, t: 'kusanagi', player: 1, x: 8, y: 8 }] });
  assert.equal(out.pop().text, 'P1 has brought the Kusanagi to their Temple.');
  at(6, { events: [{ type: 'relic', ev: 'lose', i: 0, t: 'kusanagi', player: 0, x: 9, y: 9 }] });
  const lost = out.pop();
  assert.equal(lost.id, 'relic_lost');
  assert.equal(lost.kind, 'alert');
  assert.equal(lost.attention, 'You lost the Kusanagi!');
  assert.equal(vs.time, 6);
});

test('the relic tip shows on a map with relics, after the first two minutes', () => {
  const { vs, at } = scene();
  const tip = HINTS.find((h) => h.id === 'relics');
  assert.ok(tip);
  at(60);
  assert.equal(tip.when(hintContext(vs)), false);
  at(200);
  assert.equal(tip.when(hintContext(vs)), true);
  at(201, { relics: [] });
  assert.equal(tip.when(hintContext(vs)), false);
});
