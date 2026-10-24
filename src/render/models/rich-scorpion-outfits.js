// What the scorpion man wears (rich-outfits.js lays it over his pantheon's outfit for a unit of the body 'insect' with a person's head):
// the Mesopotamian Scorpion Man, a bowman of the gate of the sun, bare to the waist, in bronze at the shoulders and the wrists, a fringed
// shawl in the team's color across his chest, black hair rolled at the nape under a headband of the team's color, the beard in rows of
// curls. Each layer dresses the person; the `legs` layer builds the scorpion (rich-scorpion.js addScorpion), where a person's legs would go.
import { TEAM, shadeC, withMat } from './unit-geo.js';
import { torsoStations, armStations } from './rich-body.js';
import { addBelt, addPauldrons, addArmBands } from './rich-clothing.js';
import { addHairCap, addNapeBun, addHeadband, addCurledBeard } from './rich-headgear.js';
import { addScorpion } from './rich-scorpion.js';
import { shawl, beardOf } from './rich-outfits-mesopotamian.js';

const GOLD = withMat('#dfb54a', 'gold');
const BRONZE = withMat('#b87a3c', 'gold');
const COPPER = withMat('#b9693a', 'gold');
const LEATHER = withMat('#6a4528', 'leather');

const MESOPOTAMIAN = {
  // a shell of the warm brown of old bronze, darker than the man's skin so that the two read as two
  legs: (E) => addScorpion(E, { trim: GOLD }),
  // bare to the waist, a broad belt where the man meets the shell
  torso(E) {
    const { kit, D, pal, bind, skin, skinPaint } = E;
    kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
    addBelt(kit, D, pal, bind, shadeC(LEATHER, 0.85), BRONZE, 'leather', 0.04);
  },
  // bare arms, bands of bronze about them
  arms(E) {
    const { kit, D, bind, skin, skinPaint } = E;
    for (const side of [1, -1]) {
      kit.loft(armStations(D, side), { rings: 8, start: null, end: 'round', capRings: 2, capDepth: 0.022, color: skin, bind: bind.arm[side], paint: skinPaint });
    }
    addArmBands(kit, D, bind, { upper: COPPER, wrist: BRONZE });
  },
  // the bronze of his shoulders: his armor
  armor(E) {
    const { kit, D, pal, bind, armor } = E;
    if (armor) addPauldrons(kit, D, pal, bind, BRONZE, GOLD, 0, { sides: 10, rings: 4 });
  },
  // a fringed shawl in the team's color across the chest from one shoulder
  cloaks(E) {
    shawl(E, { side: -1, width: 0.34, trim: GOLD });
  },
  head(E) {
    const { kit, D, pal, bind } = E;
    addHairCap(kit, D, pal, bind);
    addNapeBun(kit, D, pal, bind);
    addHeadband(kit, D, pal, bind, { color: TEAM(0.95, 'cloth') });
    addCurledBeard(kit, D, pal, bind, { len: 0.8, color: beardOf(pal) });
  },
  extras() {},
};

/** Pantheon id -> the layers its scorpion man wears (over the pantheon's own outfit). */
export const SCORPION_OUTFITS = { mesopotamian: MESOPOTAMIAN };
