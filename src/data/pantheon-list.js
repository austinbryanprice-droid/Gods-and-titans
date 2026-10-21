// The ten pantheons, with no other data imports, so modules that data/index.js
// itself loads (upgrades.js reads the blessings) can reach them without a cycle.
import greek from './pantheons/greek.js';
import norse from './pantheons/norse.js';
import egyptian from './pantheons/egyptian.js';
import hindu from './pantheons/hindu.js';
import japanese from './pantheons/japanese.js';
import chinese from './pantheons/chinese.js';
import aztec from './pantheons/aztec.js';
import celtic from './pantheons/celtic.js';
import mesopotamian from './pantheons/mesopotamian.js';
import west_african from './pantheons/west_african.js';

export const PANTHEON_LIST = [greek, norse, egyptian, hindu, japanese, chinese, aztec, celtic, mesopotamian, west_african];
export const PANTHEONS = Object.fromEntries(PANTHEON_LIST.map((p) => [p.id, p]));
