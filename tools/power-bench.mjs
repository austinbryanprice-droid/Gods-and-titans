#!/usr/bin/env node
// God power bench: every strike and cataclysm cast on a carpet of 150 tough enemy soldiers (a disc of
// radius 13, 20000 hp each, holding still) and the health it removes in 25 s, a damage-times-area score
// for an army that stands and fights in it. Buffs, summons (kept from attacking), stuns and slows are not
// counted, so read the numbers next to each power's extras. Used to keep the ten pantheons' powers
// comparable (DESIGN 4.11).
//
// Usage: node tools/power-bench.mjs
import { createWorld } from '../src/sim/world.js';
import { GOD_POWERS, isHarmfulPower } from '../src/data/powers.js';
import { castPower } from '../src/sim/powers.js';

const HP = 20000;

function score(pantheon, pw) {
  const setup = { version: '0.1.0', seed: 3, mapSize: 'medium', players: [0, 1].map((i) => ({ index: i, name: `P${i}`, team: i + 1, pantheon: i ? 'norse' : pantheon, color: null, kind: 'human' })) };
  const w = createWorld(setup);
  w.peace = false;
  w.peaceEnd = 0;
  w.time = 900;
  w.players[0].tier = 3;
  // No neutral creeps: their attacks are not the power's, and soldiers would leave the carpet to answer them.
  for (const u of w.unitList.slice()) if (u.owner < 0 && !u.dead) w.killEntity(u, null, true);
  const cx = w.map.width / 2;
  const cy = w.map.height / 2;
  const ids = [];
  for (let k = 0; k < 150; k++) {
    const a = k * 2.399963;
    const r = Math.sqrt((k + 0.5) / 150) * 13;
    const u = w.spawnUnit(1, 'warrior', cx + Math.cos(a) * r, cy + Math.sin(a) * r, { silent: true });
    if (u) {
      u.maxHp = u.hp = HP;
      ids.push(u.id);
    }
  }
  w.reveals.push({ team: w.teamOf(0), x: cx, y: cy, r: 20, rem: 9999, owner: 0 });
  w.hash.rebuild(w.unitList);
  for (let i = 0; i < 4; i++) w.tick();
  w.issueCommand(1, { type: 'hold', units: ids });
  w.tick();
  castPower(w, 0, pw.id, cx, cy);
  let lost = 0;
  for (let i = 0; i < 25 * 20; i++) {
    // Summoned minions (the Crows' crows, Apep's mummies) are extras, not the power's own damage: they never strike.
    for (const u of w.unitList) if (u.owner === 0 && u.summoned) u.attackCd = 1e9;
    w.tick();
    w.events.length = 0;
    for (const id of ids) {
      const u = w.entities.get(id);
      if (!u || u.dead) continue;
      // The sim re-derived the unit's stats (back to its real health): start it over, uncounted.
      if (u.maxHp !== HP) {
        u.maxHp = u.hp = HP;
        continue;
      }
      lost += HP - u.hp;
      u.hp = HP;
    }
  }
  return Math.round(lost);
}

const rows = [];
for (const [pantheon, list] of Object.entries(GOD_POWERS)) {
  for (const pw of list) if (isHarmfulPower(pw)) rows.push({ tier: pw.tier, pantheon, name: pw.name, hp: score(pantheon, pw) });
}
rows.sort((a, b) => a.tier - b.tier || b.hp - a.hp);
for (const r of rows) console.log(`${r.tier === 2 ? 'Town' : 'City'} ${r.pantheon.padEnd(13)} ${r.name.padEnd(30)} ${String(r.hp).padStart(7)} hp`);
