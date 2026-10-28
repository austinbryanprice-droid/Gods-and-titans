// The raiders of the guided first match (DESIGN 5.12, difficulty 'tutorial'): a camp that sleeps.
// Its Worshippers go to their gold mine once, so the camp looks lived in; it builds, trains and
// attacks nothing. Its guards fight back on their own (every unit answers an attack in range).
import { GOLD_MINE } from '../data/index.js';

export function createTutorialAI(world, playerIndex) {
  let sent = false;
  return {
    tick() {
      if (sent) return;
      sent = true;
      const workers = world.unitList.filter((u) => u.owner === playerIndex && !u.dead && u.def.class === 'worker');
      if (!workers.length) return;
      const home = world.buildingList.find((b) => b.owner === playerIndex && b.type === 'town_center');
      let mine = null;
      let best = Infinity;
      for (const m of world.mineList) {
        if (m.type !== GOLD_MINE.id || m.dead) continue;
        const d = home ? Math.hypot(m.x - home.x, m.y - home.y) : 0;
        if (d < best) {
          best = d;
          mine = m;
        }
      }
      if (mine) world.issueCommand(playerIndex, { type: 'gather', units: workers.map((u) => u.id), target: mine.id });
    },
  };
}
