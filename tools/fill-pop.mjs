// Fill every player of a World to a population at once, for the late-game load tests
// (tools/net-bandwidth.mjs --fill, tools/perf-late.mjs, the render harness's fill=):
// Houses for the cap, 30 worshippers, 3 gods, the Titan and a mixed army, with the
// armies sent to the middle of the map so the heaviest battle the cap allows is on
// screen from the first second. Runs in Node and in the browser.
import { PANTHEONS, getUnitType } from '../src/data/index.js';

/** Give every player `pop` population at once (see above). */
export function fillToPop(world, pop) {
  for (const p of world.players) {
    const tc = world.buildingList.find((b) => b.owner === p.index && b.type === 'town_center');
    if (!tc) continue;
    Object.assign(p, { gold: 20000, wood: 20000, faith: 5000 });
    for (let n = 0; p.popCap < pop && n < 80; n++) {
      const spot = world.findPlacement(p.index, 'house', tc.x, tc.y, 30);
      if (!spot) break;
      world.createBuilding(p.index, 'house', spot.tx, spot.ty, true, true);
    }
    const pan = PANTHEONS[p.pantheon];
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
  world.time = Math.max(world.time, 600); // the AIs are past every first-attack timer
  world.hash.rebuild(world.unitList);
}
