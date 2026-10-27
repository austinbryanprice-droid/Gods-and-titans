// The score's themes: one for the title screen and one for each of the ten pantheons. A theme is
// data for the composer (music-composer.js): a mode, how long a bar lasts, the instruments, the
// chord progressions for calm play and for battle, a two-bar motif that becomes the tune, and
// the rhythm patterns each layer plays. Every progression stays inside the theme's mode, so
// whatever the composer combines is consonant by construction (tests/audio checks it).
//
// Patterns are strings with one character per step of the bar (16 steps: a sixteenth-note grid in
// 4/4; 12 steps: an eighth-note grid in 12/8). Arp patterns hold chord-tone digits (0 the lowest
// tone at or above the arp's base, then up through the chord and into the next octave), bass
// patterns R (root), 5 (fifth), 8 (octave) and drum patterns X (accent) x (normal) o (ghost);
// '.' is a rest. Drum entries are [drum, pattern, loudness = 1, pitch factor = 1].
// A motif is [scale degree, length in steps] cells (null degree = rest) covering two bars; degree
// 0 sounds at `leadBase`. `inst.leadHot`, when a theme has one, is the lead of its tense sections: a
// sharper relative of the usual lead (the erhu's tune turns to the dizi, the whistle's to the fiddle).

const MODES = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  hirajoshi: [0, 2, 3, 7, 8],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
};

/** The title-screen theme: a slow, grand D minor with horns and a choir. */
const MENU = {
  id: 'menu',
  name: 'Mythic War',
  tonic: 50,
  scale: MODES.aeolian,
  steps: 16,
  bar: 3.8,
  inst: { pad: 'choir', bass: 'bassPluck', arp: 'harp', lead: 'horn', horn: 'horn', accent: 'bell' },
  drone: { inst: 'drone', notes: [0, 7] },
  progs: {
    calm: [['Dm', 'Bb', 'F', 'C'], ['Dm', 'Gm', 'Bb', 'C'], ['Bb', 'F', 'C', 'Dm']],
    tense: [['Dm', 'Bb', 'Dm', 'C'], ['Dm', 'Dm', 'Gm', 'A5'], ['Bb', 'C', 'Dm', 'Dm']],
  },
  leadBase: 62,
  leadRange: [57, 86],
  motif: [[4, 8], [7, 4], [6, 4], [5, 8], [4, 4], [2, 4]],
  arp: { base: 57, sparse: '0...2...1...2...', mid: '0.2.1.3.0.2.1.3.', dense: '0.12.1.30.12.1.3' },
  bass: { calm: 'R...............', mid: 'R.......5.......', war: 'R..R..R.R..R..R.' },
  perc: {
    soft: [['frame', 'X.......o.......', 0.6]],
    drive: [['taiko', 'X.......x.......', 0.8]],
    war: [['taiko', 'X..x..x.X..x.x..'], ['tom', '..o...o...o...ox', 0.8]],
  },
  fill: [12, 13, 14, 15],
  fillDrum: 'taiko',
  crash: 'gong',
};

const GREEK = {
  id: 'greek',
  name: 'Greek',
  tonic: 50,
  scale: MODES.dorian,
  steps: 16,
  bar: 3.1,
  inst: { pad: 'strings', bass: 'oud', arp: 'lyre', lead: 'aulos', horn: 'brass', accent: 'bell' },
  drone: { inst: 'drone', notes: [0, 7] },
  progs: {
    calm: [['Dm', 'G', 'Dm', 'Am'], ['Dm', 'C', 'G', 'Dm'], ['Dm', 'Em', 'F', 'C']],
    tense: [['Dm', 'C', 'G', 'Dm'], ['Dm', 'Dm', 'F', 'C'], ['Dm', 'G', 'Dm', 'C']],
  },
  leadBase: 62,
  leadRange: [57, 84],
  motif: [[4, 6], [3, 2], [2, 4], [1, 4], [0, 8], [2, 4], [4, 4]],
  arp: { base: 57, sparse: '0...1...2...1...', mid: '0.1.2.1.0.1.2.3.', dense: '0.12.3.21.0.12.3' },
  bass: { calm: 'R.......5.......', mid: 'R...5...R...5...', war: 'R.R.5.R.R.R.5.8.' },
  perc: {
    soft: [['frame', 'X.......o.......', 0.6]],
    drive: [['frame', 'X..x..x.X..x.x..', 0.9], ['clave', '....o.......o...', 0.6]],
    war: [['taiko', 'X.......X.......'], ['tom', 'o...x...o...x...', 0.8]],
  },
  fill: [12, 13, 14, 15],
  fillDrum: 'tom',
  crash: 'cymbal',
};

const NORSE = {
  id: 'norse',
  name: 'Norse',
  tonic: 45,
  scale: MODES.aeolian,
  steps: 16,
  bar: 3.5,
  inst: { pad: 'strings', bass: 'bassPluck', arp: 'lyre', lead: 'nyckelharpa', horn: 'lur', accent: 'bell' },
  drone: { inst: 'drone', notes: [0, 7, 12] },
  padRange: [45, 69],
  progs: {
    calm: [['Am', 'G', 'F', 'G'], ['Am', 'F', 'G', 'Am'], ['Am', 'C', 'G', 'Am']],
    tense: [['Am', 'Am', 'F', 'G'], ['Am', 'F', 'Am', 'G'], ['Am', 'Dm', 'Am', 'E5']],
  },
  leadBase: 57,
  leadRange: [52, 81],
  motif: [[4, 8], [7, 4], [6, 2], [4, 2], [3, 6], [4, 2], [2, 4], [0, 4]],
  arp: { base: 57, sparse: '0.......2.......', mid: '0..2..1.0..2..1.', dense: '0.2.1.2.0.2.1.2.' },
  bass: { calm: 'R...............', mid: 'R.......R...5...', war: 'R.R.R.R.5.5.R.R.' },
  perc: {
    soft: [['bodhran', 'X.......o.......', 0.7]],
    drive: [['bodhran', 'X..x..x.X.....x.'], ['frame', '....x.......x...', 0.6]],
    war: [['taiko', 'X.......X.......'], ['taiko', '..x...x...x...x.', 0.6], ['tom', '........o.o.o.o.', 0.8]],
  },
  fill: [10, 11, 12, 13, 14, 15],
  fillDrum: 'taiko',
  crash: 'gong',
};

const EGYPTIAN = {
  id: 'egyptian',
  name: 'Egyptian',
  tonic: 50,
  scale: MODES.phrygianDominant,
  steps: 16,
  bar: 3.0,
  inst: { pad: 'organ', bass: 'oud', arp: 'harp', lead: 'ney', horn: 'brass', accent: 'bell' },
  drone: { inst: 'drone', notes: [0, 7] },
  progs: {
    calm: [['D', 'Eb', 'D', 'Gm'], ['D', 'Eb', 'Cm', 'D'], ['D', 'D', 'Eb', 'D']],
    tense: [['D', 'Eb', 'D', 'Eb'], ['D', 'Gm', 'Eb', 'D'], ['D', 'Cm', 'Eb', 'D']],
  },
  leadBase: 62,
  leadRange: [57, 84],
  motif: [[7, 6], [6, 2], [5, 4], [4, 4], [3, 4], [2, 2], [1, 2], [0, 8]],
  arp: { base: 55, sparse: '0...1...2...1...', mid: '0..1..2.0..1.2..', dense: '0.1.2.1.0.1.2.1.' },
  bass: { calm: 'R.......R.......', mid: 'R.....R.R.....5.', war: 'R..R.R..R..R.R..' },
  perc: {
    soft: [['frame', 'X.......X.......', 0.6], ['sistrum', 'x...x...x...x...', 0.5]],
    drive: [['frame', 'X.......X.......'], ['frame', '..x...x.....x...', 0.7, 1.6]],
    war: [['taiko', 'X.......X.......'], ['tom', '..x...x.....x...', 0.8, 1.3], ['sistrum', 'x.x.x.x.x.x.x.x.', 0.7]],
  },
  fill: [12, 13, 14, 15],
  fillDrum: 'tom',
  crash: 'cymbal',
};

const HINDU = {
  id: 'hindu',
  name: 'Hindu',
  tonic: 48,
  scale: MODES.lydian,
  steps: 16,
  bar: 3.4,
  inst: { pad: 'organ', bass: 'oud', arp: 'sitar', lead: 'bansuri', horn: 'conch', accent: 'bell' },
  drone: { inst: 'tanpura', pluck: [43, 60, 60, 48] },
  progs: {
    calm: [['C', 'C', 'D', 'C'], ['C', 'D', 'C', 'G'], ['C', 'Em', 'D', 'C']],
    tense: [['C', 'D', 'C', 'D'], ['Em', 'D', 'C', 'D'], ['C', 'Am', 'D', 'G']],
  },
  leadBase: 60,
  leadRange: [55, 83],
  motif: [[null, 2], [-1, 2], [1, 4], [2, 8], [3, 4], [4, 4], [2, 4], [1, 2], [0, 2]],
  arp: { base: 55, sparse: '0...2...1...2...', mid: '0.1.2.1.0.1.2.3.', dense: '0.12.1.30.12.1.3' },
  bass: { calm: '................', mid: 'R...............', war: 'R...R...R...R...' },
  perc: {
    soft: [['bayan', 'X.......X.......', 0.7]],
    drive: [['dayan', '..x...x...x.x...', 0.8], ['bayan', 'X.......X.......']],
    war: [['dayan', 'x.x.x.x.x.x.x.x.', 0.8], ['bayan', 'X..x....X..x.x..'], ['tom', 'X.......X.......', 0.7]],
  },
  fill: [12, 13, 14, 15],
  fillDrum: 'dayan',
  crash: 'gong',
};

const JAPANESE = {
  id: 'japanese',
  name: 'Japanese',
  tonic: 50,
  scale: MODES.hirajoshi,
  steps: 16,
  bar: 3.6,
  inst: { pad: 'glass', bass: 'bassPluck', arp: 'koto', lead: 'shakuhachi', horn: 'conch', accent: 'bell' },
  drone: { inst: 'drone', notes: [0, 7] },
  progs: {
    calm: [['Dsus2', 'Bb', 'Dm', 'A5'], ['Dm', 'Bbmaj7', 'Asus4', 'Dsus2'], ['Dsus2', 'Dsus2', 'Bb', 'A5']],
    tense: [['Dm', 'Bb', 'A5', 'Dm'], ['Dm', 'Dm', 'Bb', 'A5'], ['Bb', 'A5', 'Dm', 'Dm']],
  },
  leadBase: 62,
  leadRange: [57, 86],
  motif: [[null, 4], [3, 6], [2, 2], [1, 4], [0, 6], [1, 2], [0, 2], [null, 6]],
  arp: { base: 57, sparse: '0.......2...1...', mid: '0...1.2...2.1...', dense: '0.1.2.1.0.1.2.1.' },
  bass: { calm: '................', mid: 'R...............', war: 'R.......R.R.....' },
  perc: {
    soft: [['clave', '....o.......o...', 0.6]],
    drive: [['taiko', 'X...............', 0.8], ['clave', '........o.......', 0.6]],
    war: [['taiko', 'X.......X.X.....'], ['taiko', '..o...o...o...o.', 0.6], ['tom', '........o.o.o.xX', 0.8]],
  },
  fill: [12, 13, 14, 15],
  fillDrum: 'taiko',
  crash: 'gong',
};

const CHINESE = {
  id: 'chinese',
  name: 'Chinese',
  tonic: 50,
  scale: MODES.majorPentatonic,
  steps: 16,
  bar: 3.3,
  inst: { pad: 'organ', bass: 'bassPluck', arp: 'guzheng', lead: 'erhu', leadHot: 'dizi', horn: 'horn', accent: 'bell' },
  drone: { inst: 'drone', notes: [0, 7] },
  progs: {
    calm: [['D', 'Bm', 'Dsus2', 'A5'], ['D', 'A5', 'Bm', 'Asus4'], ['Dsus2', 'Esus4', 'D', 'A5']],
    tense: [['Bm', 'A5', 'Esus4', 'Bm'], ['Bm', 'Bm', 'A5', 'D'], ['Bm', 'D', 'A5', 'Bm']],
  },
  leadBase: 62,
  leadRange: [57, 86],
  motif: [[3, 6], [2, 2], [1, 4], [0, 4], [1, 4], [2, 4], [3, 8]],
  arp: { base: 62, sparse: '0...1...2...3...', mid: '0.1.2.3.2.1.0.1.', dense: '0.12.3.21.0.12.3' },
  bass: { calm: 'R...............', mid: 'R.......R...5...', war: 'R..R..R.R..R..R.' },
  perc: {
    soft: [['frame', 'X.......x.......', 0.6]],
    drive: [['frame', 'X...x...X...x...'], ['clave', '..x...x...x...x.', 0.6]],
    war: [['taiko', 'X...x...X...x.x.'], ['tom', '....o.......o.o.', 0.7]],
  },
  fill: [12, 13, 14, 15],
  fillDrum: 'tom',
  crash: 'gong',
};

const AZTEC = {
  id: 'aztec',
  name: 'Aztec',
  tonic: 52,
  scale: MODES.minorPentatonic,
  steps: 16,
  bar: 2.7,
  inst: { pad: 'organ', bass: 'oud', arp: 'marimba', lead: 'clay', horn: 'conch', accent: 'bell' },
  drone: { inst: 'drone', notes: [0, 7] },
  padRange: [48, 70],
  progs: {
    calm: [['Em', 'G', 'D5', 'A5'], ['Em', 'Em7', 'Asus2', 'G'], ['Em', 'D5', 'Em', 'G6']],
    tense: [['Em', 'Em', 'G', 'A5'], ['Em', 'D5', 'A5', 'Em'], ['Em', 'G', 'Em', 'A5']],
  },
  leadBase: 64,
  leadRange: [59, 88],
  motif: [[3, 3], [3, 3], [2, 2], [1, 2], [0, 6], [1, 3], [1, 3], [2, 2], [3, 2], [2, 6]],
  arp: { base: 52, sparse: '0...1...2...1...', mid: '0..1..2.0..1..2.', dense: '0.12.02.1.02.12.' },
  bass: { calm: 'R...............', mid: 'R.....R.R.......', war: 'R..R..R.R..R..R.' },
  perc: {
    soft: [['shaker', 'x.x.x.x.x.x.x.x.', 0.7], ['slit', 'X.......o.......', 0.7]],
    drive: [['huehuetl', 'X.....x.X.....x.'], ['slit', '..o...x...o...x.', 0.8, 1.34]],
    war: [['huehuetl', 'X..X..X.X..X..X.'], ['huehuetl', '........X.......'], ['shaker', 'xxxxxxxxxxxxxxxx', 0.5]],
  },
  fill: [10, 11, 12, 13, 14, 15],
  fillDrum: 'huehuetl',
  crash: 'gong',
};

const CELTIC = {
  id: 'celtic',
  name: 'Celtic',
  tonic: 50,
  scale: MODES.mixolydian,
  steps: 12,
  bar: 2.6,
  inst: { pad: 'strings', bass: 'bassPluck', arp: 'harp', lead: 'whistle', leadHot: 'fiddle', horn: 'lur', accent: 'bell' },
  drone: { inst: 'drone', notes: [0, 7] },
  progs: {
    calm: [['D', 'C', 'G', 'D'], ['D', 'G', 'C', 'D'], ['D', 'Am', 'C', 'G']],
    tense: [['Am', 'C', 'G', 'D'], ['Em', 'C', 'D', 'D'], ['D', 'C', 'Am', 'G']],
  },
  leadBase: 62,
  leadRange: [57, 86],
  motif: [[4, 1], [5, 1], [7, 1], [5, 2], [4, 1], [2, 1], [4, 1], [2, 1], [0, 3], [4, 1], [5, 1], [7, 1], [8, 2], [7, 1], [5, 1], [4, 1], [2, 1], [1, 3]],
  arp: { base: 50, sparse: '0.....2.....', mid: '0.1.2.1.2.1.', dense: '012.12012.12' },
  bass: { calm: 'R...........', mid: 'R.....5.....', war: 'R.5.R.5.R.5.' },
  perc: {
    soft: [['bodhran', 'X.....x.....', 0.6]],
    drive: [['bodhran', 'X..x.xX..x.x']],
    war: [['bodhran', 'X..x.xX.xx.x'], ['tom', '........x.xX', 0.7]],
  },
  fill: [9, 10, 11],
  fillDrum: 'bodhran',
  crash: 'cymbal',
};

const MESOPOTAMIAN = {
  id: 'mesopotamian',
  name: 'Mesopotamian',
  tonic: 52,
  scale: MODES.phrygian,
  steps: 16,
  bar: 3.9,
  inst: { pad: 'organ', bass: 'oud', arp: 'lyre', lead: 'duduk', leadHot: 'shawm', horn: 'horn', accent: 'bell' },
  drone: { inst: 'drone', notes: [0, 7] },
  padRange: [48, 70],
  progs: {
    calm: [['Em', 'F', 'Em', 'Dm'], ['Em', 'Dm', 'F', 'Em'], ['Em', 'Em', 'F', 'G']],
    tense: [['Em', 'F', 'Em', 'F'], ['Em', 'F', 'G', 'Em'], ['Em', 'Dm', 'F', 'Em']],
  },
  leadBase: 64,
  leadRange: [59, 84],
  motif: [[4, 8], [3, 4], [2, 4], [1, 4], [0, 4], [1, 2], [2, 2], [0, 4]],
  arp: { base: 52, sparse: '0.......2.......', mid: '0...2...1...2...', dense: '0.2.1.2.0.2.1.2.' },
  bass: { calm: 'R.......R.......', mid: 'R.......R...5...', war: 'R..R..R.R..R..R.' },
  perc: {
    soft: [['frame', 'X...............', 0.7]],
    drive: [['frame', 'X.......X..x..x.'], ['sistrum', 'x.x.x.x.x.x.x.x.', 0.6]],
    war: [['taiko', 'X.......X.......'], ['tom', '..x.x.x.....x.x.', 0.8], ['sistrum', 'xxxxxxxxxxxxxxxx', 0.5]],
  },
  fill: [10, 11, 12, 13, 14, 15],
  fillDrum: 'tom',
  crash: 'gong',
};

const WEST_AFRICAN = {
  id: 'west_african',
  name: 'West African',
  tonic: 48,
  scale: MODES.ionian,
  steps: 12,
  bar: 2.5,
  inst: { pad: 'glass', bass: 'bassPluck', arp: 'kora', lead: 'ney', horn: 'horn', accent: 'bell' },
  drone: { inst: 'drone', notes: [0, 7] },
  progs: {
    calm: [['C', 'Am', 'F', 'G'], ['C', 'F', 'C', 'G'], ['C', 'G', 'Am', 'F']],
    tense: [['Am', 'F', 'C', 'G'], ['Am', 'G', 'F', 'G'], ['Am', 'F', 'G', 'Am']],
  },
  leadBase: 60,
  leadRange: [55, 84],
  motif: [[4, 3], [2, 3], [1, 2], [0, 4], [1, 3], [2, 3], [4, 3], [5, 3]],
  arp: { base: 55, sparse: '0.....2.....', mid: '0.1.2.3.2.1.', dense: '0.12.3.21.0.' },
  bass: { calm: 'R...........', mid: 'R.....5.....', war: 'R..R..5..R..' },
  perc: {
    soft: [['shaker', 'x.xx.xx.xx.x', 0.7], ['djembeBass', 'X.....x.....', 0.6]],
    drive: [['djembeBass', 'X.....X.....'], ['djembeTone', '..x..x..x..x', 0.8], ['woodblock', 'x.x.xx.x.x.x', 0.6]],
    war: [['djembeBass', 'X..x..X..x..'], ['djembeSlap', '.x.x.x.x.x.x', 0.7], ['djembeTone', '..x..x..x.xx', 0.9], ['woodblock', 'x.x.xx.x.x.x', 0.7]],
  },
  fill: [9, 10, 11],
  fillDrum: 'djembeTone',
  crash: 'cymbal',
};

/** All themes by id: 'menu' and the ten pantheon ids. */
export const THEMES = Object.freeze({
  menu: MENU,
  greek: GREEK,
  norse: NORSE,
  egyptian: EGYPTIAN,
  hindu: HINDU,
  japanese: JAPANESE,
  chinese: CHINESE,
  aztec: AZTEC,
  celtic: CELTIC,
  mesopotamian: MESOPOTAMIAN,
  west_african: WEST_AFRICAN,
});

/** The theme for a pantheon id (the title theme for anything unknown). */
export function themeFor(id) {
  return Object.hasOwn(THEMES, id) ? THEMES[id] : THEMES.menu;
}
