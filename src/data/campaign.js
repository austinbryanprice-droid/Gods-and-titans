// The campaign (DESIGN 5.16): two chapters of five linked missions each. Chapter I, "The Long Winter", for
// the Greeks against raiders out of the frozen north; Chapter II, "The Wolf Age", for the Norse against Loki,
// opened by winning the last mission of Chapter I. Plain data, read by the sim (src/sim/campaign.js runs the
// objectives and the scripted events), the HUD (the objective panel) and the menu (the chapter
// screen and the briefings). The briefings and the lines said during a mission are recorded
// (assets/narration/campaign, tools/narration/render.py --campaign); a line's clip is named by
// clipName(), so changing a line's words means rendering it again (tests/data/campaign.test.js checks
// every clip is there).
//
// Objective kinds (`kind`), each about the hero (player 0) unless it names a tag:
//   build    { type, count }   that many of a building finished and standing
//   gods     { count }         that many gods on the field at once
//   army     { count }         that many soldiers alive at once
//   kill     { tag }           every unit an event spawned with this tag is dead (none while not yet spawned)
//   destroy  { tag }           every building placed at the start with this tag has fallen
//   protect  { tag }           fails the mission when every building with this tag has fallen
//   survive  { seconds }       the game clock reaches it
//   hold     { count, seconds} the hero's team holds that many sacred sites at once, that long without a break
//   conquer                    every enemy player is beaten
// Any objective but a protect one may have a `limit` (seconds): not done by then, the mission is lost.
// `optional` objectives are a bonus; `hidden` ones show once an event reveals them. The mission is won when
// every objective that is not optional and not a protect one is done, or when every enemy is beaten. A
// mission's `waitFor` (objective ids) holds that second way back until those are done: its story beat (a
// hold to the end, a foe who arrives late) still has to happen when the enemy is wiped out early.
//
// Events: { at: seconds } or { after: objective id }, then any of: say (a line on the screen, spoken),
// spawn { owner, tag, units: [[type, n]], at: 'home'|'front', march, always } (march: sent at the hero's
// buildings, or at the building tagged `target`; always: it comes even once its owner is beaten, from where
// their Town Center stood; otherwise a beaten owner's spawn does not come), reveal (an objective id).

/** Units of a spawn list: [[type, count], ...]. */
const U = (...pairs) => Object.freeze(pairs.map((p) => Object.freeze(p)));

const LONG_WINTER = [
  {
    id: 'shore',
    title: 'Ashes on the Shore',
    place: 'The island of Thera',
    seed: 2201,
    mapSize: 'small',
    creeps: false,
    players: [
      { pantheon: 'greek', team: 1 },
      { name: 'Jarl Hrolf\'s Raiders', pantheon: 'norse', team: 2, difficulty: 'tutorial' },
    ],
    start: [
      { gold: 500, wood: 300, faith: 80, units: U(['warrior', 3]) },
      { townHp: 1500, units: U(['warrior', 3], ['archer', 2]) },
    ],
    briefing: 'Thera, a small island in the Greek sea. For a hundred years its people have known only the sun and the waves. But this spring the sun grew cold, and strange sails came out of the north. Raise a Temple, Archon, and call a god of Olympus to your side. The raiders will not wait for you to be ready.',
    victory: 'The raiders broke on Thera\'s shore. But the prisoners speak of a winter that follows them south, and of the trickster god who sent them.',
    defeat: 'The raiders burned Thera. Gather your people and try again.',
    objectives: [
      { id: 'temple', kind: 'build', type: 'temple', count: 1, icon: '🏛️', text: 'Raise a Temple' },
      { id: 'god', kind: 'gods', count: 1, icon: '⚡', text: 'Summon a god of Olympus' },
      { id: 'raid', kind: 'kill', tag: 'raid', icon: '⚔️', text: 'Drive off the raiding party', hidden: true },
      { id: 'home', kind: 'protect', tag: 'home', icon: '🛡️', text: 'Keep your Town Center standing' },
      { id: 'camp', kind: 'conquer', optional: true, icon: '🔥', text: 'Bonus: burn the raiders\' camp' },
    ],
    events: [
      { at: 4, say: 'Your lookouts see sails on the horizon. Make ready, Archon.' },
      { at: 270, say: 'Longships on the beach! The raiders are coming ashore.', reveal: 'raid', spawn: { owner: 1, tag: 'raid', units: U(['warrior', 4], ['archer', 2]), at: 'front', march: true } },
      { after: 'raid', say: 'The raiders are beaten. Finish what you started.' },
    ],
  },
  {
    id: 'longhouses',
    title: 'Burn the Longhouses',
    place: 'The northern cape of Thera',
    seed: 4401,
    mapSize: 'small',
    players: [
      { pantheon: 'greek', team: 1 },
      { name: 'Jarl Hrolf', pantheon: 'norse', team: 2, difficulty: 'easy' },
    ],
    start: [
      { gold: 600, wood: 400, faith: 120, units: U(['warrior', 4], ['archer', 2]), buildings: [{ type: 'barracks' }, { type: 'house' }] },
      { gold: 300, wood: 200, buildings: [{ type: 'barracks', tag: 'longhouse', ring: 9 }, { type: 'barracks', tag: 'longhouse', ring: 9 }, { type: 'barracks', tag: 'longhouse', ring: 9 }] },
    ],
    briefing: 'The raiders have made a camp on the northern cape, and from three great longhouses their warriors pour out to burn our fields. Gather an army, Archon, and put those longhouses to the torch. Without them the northmen have nowhere to shelter from the winter they bring.',
    victory: 'The longhouses burn, and the cape is ours again. In the ashes we found a carved stone: a serpent eating its own tail, and a name. Loki.',
    defeat: 'Jarl Hrolf holds the cape. Raise a stronger army and try again.',
    objectives: [
      { id: 'burn', kind: 'destroy', tag: 'longhouse', icon: '🔥', text: 'Destroy the three longhouses' },
      { id: 'home', kind: 'protect', tag: 'home', icon: '🛡️', text: 'Keep your Town Center standing' },
    ],
    events: [
      { at: 4, say: 'The longhouses stand beside the jarl\'s hall. Train soldiers at your Barracks, and strike.' },
      { at: 420, say: 'The jarl sends his huscarls against you!', spawn: { owner: 1, tag: 'huscarls', units: U(['warrior', 4], ['archer', 2]), at: 'front', march: true } },
    ],
  },
  {
    id: 'pass',
    title: 'The Narrow Pass',
    place: 'The road to Delphi',
    seed: 3301,
    mapSize: 'medium',
    creeps: false,
    players: [
      { pantheon: 'greek', team: 1 },
      { name: 'Host of the North', pantheon: 'norse', team: 2, difficulty: 'tutorial' },
    ],
    start: [
      { gold: 700, wood: 500, faith: 250, units: U(['warrior', 5], ['archer', 3]), buildings: [{ type: 'barracks' }, { type: 'house' }, { type: 'house' }, { type: 'temple', tag: 'oracle', ring: 11 }] },
      { townHp: 5000, units: U(['warrior', 4], ['archer', 2]) },
    ],
    briefing: 'The northmen\'s main host has crossed to the mainland. Between them and the holy city of Delphi there is one road, and on it one temple, guarding the narrow pass. Hold it, Archon. Keep that Temple standing until the Spartans march to your aid. Ten minutes. Not one more.',
    victory: 'The Spartans have come, and the pass held. The host of the north turns away, and makes instead for the sacred groves of Arcadia.',
    defeat: 'The Temple of the pass has fallen, and the road to Delphi lies open.',
    objectives: [
      { id: 'hold', kind: 'survive', seconds: 600, icon: '⏳', text: 'Hold out until the Spartans arrive' },
      { id: 'oracle', kind: 'protect', tag: 'oracle', icon: '🏛️', text: 'Keep the Temple of the pass standing' },
      { id: 'home', kind: 'protect', tag: 'home', icon: '🛡️', text: 'Keep your Town Center standing' },
    ],
    events: [
      { at: 4, say: 'Here they come. Put your soldiers between the northmen and the Temple.' },
      { at: 75, spawn: { owner: 1, tag: 'w1', units: U(['warrior', 4], ['archer', 2]), at: 'front', march: true, target: 'oracle' } },
      { at: 165, spawn: { owner: 1, tag: 'w2', units: U(['warrior', 5], ['archer', 3]), at: 'front', march: true, target: 'oracle' } },
      { at: 255, say: 'Wolves of Fenrir run with them now!', spawn: { owner: 1, tag: 'w3', units: U(['warrior', 4], ['archer', 3], ['norse_wolf_of_fenrir', 3]), at: 'front', march: true, target: 'oracle' } },
      { at: 300, say: 'A messenger from Sparta: three hundred are on the road. Hold!', spawn: { owner: 0, tag: 'sparta1', units: U(['warrior', 3], ['archer', 1]), at: 'home' } },
      { at: 345, spawn: { owner: 1, tag: 'w4', units: U(['warrior', 6], ['archer', 4], ['norse_wolf_of_fenrir', 2]), at: 'front', march: true, target: 'oracle' } },
      { at: 435, say: 'Valkyries in the sky! Archers, look up!', spawn: { owner: 1, tag: 'w5', units: U(['warrior', 5], ['archer', 4], ['norse_valkyrie', 3]), at: 'front', march: true, target: 'oracle' } },
      { at: 525, say: 'A frost troll leads the last of them. One more push, Archon!', spawn: { owner: 1, tag: 'w6', units: U(['norse_frost_troll', 1], ['warrior', 6], ['archer', 4], ['norse_wolf_of_fenrir', 2]), at: 'front', march: true, target: 'oracle' } },
      { at: 600, spawn: { owner: 0, tag: 'sparta2', units: U(['warrior', 8], ['archer', 4]), at: 'home' } },
    ],
  },
  {
    id: 'groves',
    title: 'The Sacred Groves',
    place: 'The hills of Arcadia',
    seed: 7101,
    mapSize: 'small',
    players: [
      { pantheon: 'greek', team: 1 },
      { name: 'Hrolf Twice-Burned', pantheon: 'norse', team: 2, difficulty: 'easy' },
    ],
    start: [
      { gold: 600, wood: 400, faith: 150, units: U(['warrior', 3], ['archer', 2], ['priest', 2]), buildings: [{ type: 'barracks' }, { type: 'house' }] },
      {},
    ],
    briefing: 'Where the old gods are honoured, the earth itself gives strength. The northmen know it. They are marching on the sacred groves of Arcadia, to steal their power for Loki. Send your Worshippers and Priests to the holy stones before the enemy does, and hold three of them together for two minutes. Let the groves sing for Olympus.',
    victory: 'The groves are ours, and through them the Oracle speaks. The winter has a heart, she says: a giant of fire, sleeping on the frozen heights.',
    defeat: 'The groves have fallen silent. Try again, and guard the holy stones.',
    objectives: [
      { id: 'groves', kind: 'hold', count: 3, seconds: 120, icon: '✨', text: 'Hold three sacred sites at once for 2:00' },
      { id: 'home', kind: 'protect', tag: 'home', icon: '🛡️', text: 'Keep your Town Center standing' },
    ],
    events: [
      { at: 4, say: 'The sacred sites glow on the map. Stand a Worshipper or a Priest on one, with no enemy near, to take it.' },
      { at: 420, say: 'Frost trolls! Hrolf sends them to tear down your holy ground.', spawn: { owner: 1, tag: 'trolls', units: U(['norse_frost_troll', 2], ['warrior', 3]), at: 'front', march: true } },
    ],
  },
  {
    id: 'twilight',
    title: 'Twilight of the North',
    place: 'The frozen heights',
    seed: 5501,
    mapSize: 'medium',
    players: [
      { pantheon: 'greek', team: 1 },
      { name: 'Hrolf of the Fire', pantheon: 'norse', team: 2, difficulty: 'normal' },
      { name: 'Pharaoh\'s Legions', pantheon: 'egyptian', team: 1, difficulty: 'normal' },
    ],
    start: [
      { gold: 700, wood: 500, faith: 200, units: U(['warrior', 4], ['archer', 3]), buildings: [{ type: 'barracks' }, { type: 'house' }, { type: 'house' }] },
      { gold: 900, wood: 700, faith: 200, buildings: [{ type: 'barracks' }, { type: 'house' }, { type: 'tower', ring: 8 }] },
      {},
    ],
    briefing: 'The last of the northmen hold the frozen heights, and Loki has promised them a champion: Surtr, the fire giant, whose burning sword will end the world. The Pharaoh of Egypt has sent her legions to stand beside us. Destroy the northern city before the giant wakes, Archon. And if he wakes, bring him down.',
    victory: 'Surtr\'s fire is out, and the long winter breaks. The sun returns to Thera. But far in the north the trickster only laughs, and other pantheons stir. The war of the gods has just begun.',
    defeat: 'The fire giant walks the world, and winter falls on Greece. Try again, Archon.',
    objectives: [
      { id: 'conquer', kind: 'conquer', icon: '🔥', text: 'Destroy every northern building' },
      { id: 'surtr', kind: 'kill', tag: 'surtr', icon: '🌋', text: 'Slay Surtr, the fire giant', hidden: true },
      { id: 'home', kind: 'protect', tag: 'home', icon: '🛡️', text: 'Keep your Town Center standing' },
    ],
    events: [
      { at: 4, say: 'The Egyptians march with you. Build, summon, and strike before the giant wakes.' },
      { at: 780, say: 'The ground shakes. Surtr is waking!' },
      { at: 840, say: 'Surtr walks! Bring the fire giant down!', reveal: 'surtr', spawn: { owner: 1, tag: 'surtr', units: U(['norse_surtr', 1]), at: 'front', march: true } },
      { after: 'surtr', say: 'The fire giant has fallen! Now finish the northmen.' },
    ],
  },
];

const WOLF_AGE = [
  {
    id: 'hordaland',
    title: 'The Wolf Winter',
    place: 'The fjords of Hordaland',
    seed: 6101,
    mapSize: 'small',
    creeps: false,
    players: [
      { pantheon: 'norse', team: 1 },
      { name: 'Loki\'s Sworn', pantheon: 'norse', team: 2, difficulty: 'tutorial' },
    ],
    start: [
      { gold: 500, wood: 300, faith: 80, units: U(['warrior', 3]), buildings: [{ type: 'storehouse', tag: 'stores', ring: 8 }] },
      { townHp: 1500, units: U(['warrior', 3], ['archer', 2]) },
    ],
    briefing: 'Hordaland, in the fjords of the north. Since the fire giant fell in the south, the winter has not lifted. Three summers have come and gone without a thaw, and men say Loki has slipped his chains. Now his sworn men burn every hall that will not kneel to him. Raise a Temple, Jarl, and call the gods of Asgard. And guard the winter stores, or your people will starve before the spring.',
    victory: 'Loki\'s sworn have fled across the sea. One of them, dying, laughed at us: the wolf\'s chain is nearly cut, he said. On the isle of Lyngvi, where Fenrir was bound, Loki\'s priests are wearing away the last link.',
    defeat: 'Loki\'s sworn burned Hordaland. Gather your people and try again.',
    objectives: [
      { id: 'temple', kind: 'build', type: 'temple', count: 1, icon: '🏛️', text: 'Raise a Temple' },
      { id: 'god', kind: 'gods', count: 1, icon: '⚡', text: 'Summon a god of Asgard' },
      { id: 'raid', kind: 'kill', tag: 'raid', icon: '⚔️', text: 'Drive off Loki\'s sworn', hidden: true },
      { id: 'stores', kind: 'protect', tag: 'stores', icon: '🌾', text: 'Keep the winter stores standing' },
      { id: 'home', kind: 'protect', tag: 'home', icon: '🛡️', text: 'Keep your Town Center standing' },
      { id: 'camp', kind: 'conquer', optional: true, icon: '🔥', text: 'Bonus: burn the raiders\' camp' },
    ],
    events: [
      { at: 4, say: 'Smoke on the far side of the fjord. Loki\'s sworn are coming, Jarl. Make ready.' },
      { at: 270, say: 'Longships in the fjord! They are making for your winter stores.', reveal: 'raid', spawn: { owner: 1, tag: 'raid', units: U(['warrior', 4], ['archer', 2]), at: 'front', march: true, target: 'stores' } },
      { after: 'raid', say: 'The raiders are broken. Finish what you started.' },
    ],
  },
  {
    id: 'lyngvi',
    title: 'The Last Link',
    place: 'The isle of Lyngvi',
    seed: 6202,
    mapSize: 'small',
    players: [
      { pantheon: 'norse', team: 1 },
      { name: 'Loki\'s Priests', pantheon: 'norse', team: 2, difficulty: 'easy' },
    ],
    start: [
      { gold: 600, wood: 400, faith: 150, units: U(['warrior', 4], ['archer', 2]), buildings: [{ type: 'barracks' }, { type: 'house' }] },
      { gold: 300, wood: 200, buildings: [{ type: 'shrine', tag: 'serpent', ring: 9 }, { type: 'shrine', tag: 'serpent', ring: 9 }, { type: 'shrine', tag: 'serpent', ring: 9 }] },
    ],
    briefing: 'On the isle of Lyngvi the gods once bound the wolf Fenrir, with a chain no one could break. Now Loki\'s priests have raised three shrines of the serpent around the rock, and every night their chanting wears the chain thinner. Tear down those shrines, Jarl, before the last link breaks. You have twenty minutes.',
    victory: 'The serpent shrines are rubble, and the chain still holds. But Loki has gone where no chain can follow him: to Bifrost, the burning bridge, to lead the dead of Helheim against Asgard itself.',
    defeat: 'The last link broke, and the wolf runs free. Try again, Jarl.',
    objectives: [
      { id: 'shrines', kind: 'destroy', tag: 'serpent', limit: 1200, icon: '🐍', text: 'Tear down the three serpent shrines' },
      { id: 'home', kind: 'protect', tag: 'home', icon: '🛡️', text: 'Keep your Town Center standing' },
    ],
    events: [
      { at: 4, say: 'The serpent shrines stand around the priests\' hall. Train soldiers at your Barracks, and strike.' },
      { at: 360, say: 'The priests loose the wolf\'s children on you!', spawn: { owner: 1, tag: 'pack', units: U(['norse_wolf_of_fenrir', 4], ['warrior', 2]), at: 'front', march: true } },
      { at: 900, say: 'The chain groans on the rock. Five minutes left, Jarl!' },
    ],
  },
  {
    id: 'bifrost',
    title: 'The Burning Bridge',
    place: 'The foot of Bifrost',
    seed: 6303,
    mapSize: 'medium',
    creeps: false,
    players: [
      { pantheon: 'norse', team: 1 },
      { name: 'Host of Helheim', pantheon: 'norse', team: 2, difficulty: 'tutorial' },
    ],
    start: [
      { gold: 700, wood: 500, faith: 250, units: U(['warrior', 5], ['archer', 3]), buildings: [{ type: 'barracks' }, { type: 'house' }, { type: 'house' }, { type: 'temple', tag: 'bridge', ring: 11 }] },
      { townHp: 5000, units: U(['warrior', 4], ['archer', 2]) },
    ],
    waitFor: ['hold'], // razing Helheim's town early does not sound Heimdall's horn: the hold still runs out
    briefing: 'Loki is leading the dead of Helheim up the burning bridge to Asgard. At the foot of the bridge stands one Temple, and while it stands, the bridge cannot be crossed. Hold it, Jarl. Hold it nine minutes, until Heimdall\'s horn calls the host of Asgard down to you.',
    victory: 'Heimdall\'s horn has sounded, and the host of Asgard holds the bridge. The dead fall back. But Loki was not among them. He has gone west, to the harbour of the dead, where the ship Naglfar is nearly built.',
    defeat: 'The Temple at the bridge has fallen, and the dead are crossing into Asgard.',
    objectives: [
      { id: 'hold', kind: 'survive', seconds: 540, icon: '⏳', text: 'Hold until Heimdall\'s horn sounds' },
      { id: 'bridge', kind: 'protect', tag: 'bridge', icon: '🌈', text: 'Keep the Temple at the bridge standing' },
      { id: 'home', kind: 'protect', tag: 'home', icon: '🛡️', text: 'Keep your Town Center standing' },
    ],
    events: [
      { at: 4, say: 'Here come the dead. Put your soldiers between them and the Temple.' },
      { at: 60, spawn: { owner: 1, tag: 'w1', units: U(['warrior', 4], ['archer', 2]), at: 'front', march: true, target: 'bridge' } },
      { at: 150, spawn: { owner: 1, tag: 'w2', units: U(['warrior', 5], ['archer', 3]), at: 'front', march: true, target: 'bridge' } },
      { at: 240, say: 'Wolves of Fenrir run with the dead!', spawn: { owner: 1, tag: 'w3', units: U(['warrior', 4], ['archer', 3], ['norse_wolf_of_fenrir', 3]), at: 'front', march: true, target: 'bridge' } },
      { at: 270, say: 'Odin sends his Valkyries to your side!', spawn: { owner: 0, tag: 'valkyries', units: U(['norse_valkyrie', 3]), at: 'home' } },
      { at: 330, spawn: { owner: 1, tag: 'w4', units: U(['warrior', 6], ['archer', 4], ['norse_wolf_of_fenrir', 2]), at: 'front', march: true, target: 'bridge' } },
      { at: 420, say: 'Frost trolls on the bridge! Bring them down, Jarl!', spawn: { owner: 1, tag: 'w5', units: U(['norse_frost_troll', 2], ['warrior', 4], ['archer', 3]), at: 'front', march: true, target: 'bridge' } },
      { at: 495, say: 'Loki\'s berserkers lead the last of them. Hold!', spawn: { owner: 1, tag: 'w6', units: U(['norse_berserker', 4], ['warrior', 4], ['archer', 4]), at: 'front', march: true, target: 'bridge' } },
      { at: 540, spawn: { owner: 0, tag: 'asgard', units: U(['warrior', 8], ['archer', 4]), at: 'home' } },
    ],
  },
  {
    id: 'naglfar',
    title: 'The Ship of Nails',
    place: 'The harbour of the dead',
    seed: 6404,
    mapSize: 'small',
    players: [
      { pantheon: 'norse', team: 1 },
      { name: 'Hel\'s Shipwrights', pantheon: 'norse', team: 2, difficulty: 'easy' },
    ],
    start: [
      { gold: 700, wood: 500, faith: 150, units: U(['warrior', 4], ['archer', 3]), buildings: [{ type: 'barracks' }, { type: 'house' }, { type: 'house' }] },
      { gold: 400, wood: 300, buildings: [{ type: 'barracks', tag: 'yard', ring: 9 }, { type: 'barracks', tag: 'yard', ring: 9 }, { type: 'tower', ring: 7 }] },
    ],
    briefing: 'At the harbour of the dead, Hel\'s shipwrights are building Naglfar, the ship made from dead men\'s nails. When it is finished it will carry the giants to the last battle. Muster an army, Jarl, then burn the two shipyards before the ship is done.',
    victory: 'Naglfar burns on the black water, and the giants will have no ship. Loki has nothing left but his own sworn host, and he calls them to the plain of Vigrid, where the last battle was always meant to be fought.',
    defeat: 'Naglfar has sailed. Try again, Jarl.',
    objectives: [
      { id: 'army', kind: 'army', count: 12, icon: '⚔️', text: 'Muster an army of twelve soldiers' },
      { id: 'yards', kind: 'destroy', tag: 'yard', icon: '⚓', text: 'Burn the two shipyards', hidden: true },
      { id: 'home', kind: 'protect', tag: 'home', icon: '🛡️', text: 'Keep your Town Center standing' },
      { id: 'sites', kind: 'hold', count: 2, seconds: 60, optional: true, icon: '✨', text: 'Bonus: hold two sacred sites for 1:00' },
    ],
    events: [
      { at: 4, say: 'The shipyards lie beyond Hel\'s hall. Gather wood and gold, and muster your army.' },
      { after: 'army', say: 'Your army is ready. Now burn the shipyards!', reveal: 'yards' },
      { at: 540, say: 'Naglfar\'s crew comes ashore, the drowned dead!', spawn: { owner: 1, tag: 'crew', units: U(['norse_frost_troll', 1], ['warrior', 5], ['archer', 3]), at: 'front', march: true } },
    ],
  },
  {
    id: 'vigrid',
    title: 'Ragnarök',
    place: 'The plain of Vigrid',
    seed: 6505,
    mapSize: 'medium',
    players: [
      { pantheon: 'norse', team: 1 },
      { name: 'Loki\'s Sworn Host', pantheon: 'norse', team: 2, difficulty: 'normal' },
      { name: 'The Archon of Thera', pantheon: 'greek', team: 1, difficulty: 'normal' },
      { name: 'Jotuns of Utgard', pantheon: 'norse', team: 2, difficulty: 'easy' },
    ],
    start: [
      { gold: 700, wood: 500, faith: 200, units: U(['warrior', 4], ['archer', 3]), buildings: [{ type: 'barracks' }, { type: 'house' }, { type: 'house' }] },
      { gold: 900, wood: 700, faith: 200, buildings: [{ type: 'barracks' }, { type: 'house' }, { type: 'tower', ring: 8 }] },
      {},
      { gold: 600, wood: 400 },
    ],
    waitFor: ['loki'], // breaking the host before 13:00 does not end it: Loki still comes, and must fall
    briefing: 'On the plain of Vigrid the last battle was always meant to be fought. Loki\'s sworn host is camped there with the frost giants of Utgard, and the trickster has promised them the end of the world. But the Archon of Thera has not forgotten the long winter, and has sailed north with the Greeks to end it at its root. Break Loki\'s host, Jarl. And when the trickster comes, bring him down.',
    victory: 'Loki has fallen on Vigrid, and the gods have bound him again. The wolf sleeps, the sun climbs over the fjords, and the long winter is over at last. The world did not end. But far in the east, other gods have watched the north burn, and they are hungry.',
    defeat: 'Loki\'s host has won, and the world ends in fire and ice. Try again, Jarl.',
    objectives: [
      { id: 'conquer', kind: 'conquer', icon: '🔥', text: 'Destroy Loki\'s host and the giants' },
      { id: 'loki', kind: 'kill', tag: 'loki', icon: '🐍', text: 'Slay Loki, the trickster', hidden: true },
      { id: 'home', kind: 'protect', tag: 'home', icon: '🛡️', text: 'Keep your Town Center standing' },
    ],
    events: [
      { at: 4, say: 'The Greeks of Thera stand beside you. Build, summon, and strike.' },
      { at: 720, say: 'The sky goes dark over Vigrid. Loki is coming!' },
      { at: 780, say: 'Loki walks on Vigrid with the wolves at his heel! Bring the trickster down!', reveal: 'loki', spawn: { owner: 1, tag: 'loki', units: U(['norse_loki', 1], ['norse_wolf_of_fenrir', 4]), at: 'front', march: true, always: true } },
      { after: 'loki', say: 'The trickster has fallen! Now finish his sworn host.' },
    ],
  },
];

/** The chapters, in order; a chapter's first mission opens once the last of the chapter before is won. */
export const CHAPTERS = Object.freeze([
  {
    id: 'long_winter',
    chapter: 'Chapter I',
    title: 'The Long Winter',
    pantheon: 'greek',
    people: 'the Greeks',
    blurb: 'A cold sun, strange sails, and a trickster god in the north. Five battles for the Greeks of Thera.',
    missions: LONG_WINTER,
  },
  {
    id: 'wolf_age',
    chapter: 'Chapter II',
    title: 'The Wolf Age',
    pantheon: 'norse',
    people: 'the Norse',
    blurb: 'Loki has slipped his chains, and the winter will not end. Five battles for the Norse of Hordaland, to stop the end of the world.',
    missions: WOLF_AGE,
  },
].map((c, ci) => Object.freeze({
  ...c,
  n: ci + 1,
  missions: Object.freeze(c.missions.map((m, i) => Object.freeze({ ...m, n: i + 1, chapter: c.id }))),
})));

export const CHAPTER_BY_ID = Object.freeze(Object.fromEntries(CHAPTERS.map((c) => [c.id, c])));

/** Every mission of every chapter, in the order they open. */
export const MISSIONS = Object.freeze(CHAPTERS.flatMap((c) => c.missions));

export const MISSION_BY_ID = Object.freeze(Object.fromEntries(MISSIONS.map((m) => [m.id, m])));

/** The chapter a mission (or mission id) belongs to, or null. */
export function chapterOf(m) {
  const mission = typeof m === 'string' ? MISSION_BY_ID[m] : m;
  return mission && Object.hasOwn(CHAPTER_BY_ID, mission.chapter) ? CHAPTER_BY_ID[mission.chapter] : null;
}

/** The mission after this one (the next chapter's first after a chapter's last), or null for the very last. */
export function nextMission(id) {
  const i = MISSIONS.findIndex((m) => m.id === id);
  return i >= 0 && i + 1 < MISSIONS.length ? MISSIONS[i + 1] : null;
}

/** Short file name of a spoken line: the mission, what it is, and a hash of its words (so new words need a new clip). */
export function clipName(missionId, part, text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${missionId}-${part}-${h.toString(16).padStart(8, '0').slice(0, 6)}.mp3`;
}

/** Every line the campaign says, as { file, text }: each mission's briefing, its victory, and its events' lines. */
export function campaignLines() {
  const out = [];
  for (const m of MISSIONS) {
    out.push({ file: clipName(m.id, 'briefing', m.briefing), text: m.briefing });
    out.push({ file: clipName(m.id, 'victory', m.victory), text: m.victory });
    m.events.forEach((e, i) => {
      if (e.say) out.push({ file: clipName(m.id, `e${i}`, e.say), text: e.say });
    });
  }
  return out;
}
