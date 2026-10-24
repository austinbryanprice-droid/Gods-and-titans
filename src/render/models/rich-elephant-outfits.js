// What the person on the elephant wears (rich-outfits.js lays it over his pantheon's outfit for a unit of the body 'elephant'): Indra on
// Airavata, the king of the gods on the white king of elephants, in the crown of the tiered kirita, bare to the waist, a collar and bands
// of gold, a garland of flowers, a short cloth in red about the loins with a gold border and a belt in the team's color, a cape in the
// team's color down his back and the flaming arch of the prabhavali behind his head, the thunderbolt in his hand. His skin is a warm
// bronze: the white of the unit's own is the elephant's hide. Each layer dresses the person; the `legs` layer builds the elephant
// (rich-elephant.js addElephant), where a person's legs would go.
import { TEAM, shadeC, mixC, tintC, withMat } from './unit-geo.js';
import { torsoStations } from './rich-body.js';
import { addDhoti, addWaistBelt, addGarland, addCape } from './rich-clothing.js';
import { addJewelry, addPrabhavali } from './rich-regalia.js';
import { addElephant } from './rich-elephant.js';

const GOLD = withMat('#dfb54a', 'gold');
const FLOWERS = [withMat('#d8384c', 'cloth'), withMat('#f6efe0', 'cloth'), withMat('#f2c230', 'cloth'), withMat('#f6efe0', 'cloth')];

const HINDU = {
  // what the person on the elephant is: a god with a person's head and the crown of his, the thunderbolt in his hand (the unit's own
  // head, headgear and weapon are the elephant's)
  rider: { head: 'human', headgear: 'tall_crown', weapon: 'lightning_bolt', offhand: 'none' },
  // the unit's colors are the elephant's: the white hide stays with it (`hide`, a little off white so that the light can model it instead of
  // blooming it), the god's skin is bronze, his hair black
  palette(pal) {
    const skin = withMat('#c48a58', 'skin');
    return {
      ...pal, hide: shadeC(pal.skin, 0.9), skin, skinDark: shadeC(skin, 0.7), skinLight: tintC(skin, 0.35),
      belly: mixC(skin, tintC(pal.secondary, 0.3), 0.55), hair: withMat('#1d1410', 'hair'),
    };
  },
  // the elephant: its caparison in the team's color, the howdah lacquered in the unit's red, gold on both, the plumes gold and red
  legs: (E) => addElephant(E, {
    hide: E.pal.hide, gold: E.pal.accentMetal, trim: GOLD, lacquer: E.pal.primary, plume: { gold: E.pal.accentMetal, red: E.pal.primary },
  }),
  // bare to the waist, a short cloth about the loins in red with a gold border, a belt in the team's color
  torso(E) {
    const { kit, D, pal, bind, skin, skinPaint } = E;
    kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
    addDhoti(kit, D, bind, { color: pal.primary, border: GOLD, sash: TEAM(0.95), len: 0.1, loose: 0.8, fan: shadeC(pal.primary, 0.94) });
    addWaistBelt(kit, D, bind, TEAM(0.9), pal.accentMetal);
  },
  // a cape in the team's color down his back, edged in gold
  cloaks(E) {
    const { kit, D, pal, bind } = E;
    addCape(kit, D, TEAM(1), pal.secondary, shadeC(pal.secondary, 0.7), bind, { len: 0.55, wide: 0.9 });
  },
  // the collar and the bands of gold, a garland of flowers, the flaming arch behind his head
  extras(E) {
    const { kit, D, bind } = E;
    addJewelry(E, { collar: true, bands: true });
    addGarland(kit, D, bind, { colors: FLOWERS, low: 0.2, r: 0.015, beads: 16 });
    E.attach.push(addPrabhavali(E, { size: 0.9 }));
  },
};

/** Pantheon id -> the layers of the person on its elephant (laid over the pantheon's own outfit), and what he is (`rider`). */
export const ELEPHANT_OUTFITS = { hindu: HINDU };
