# Mythic War — Design & Architecture Spec

This is the master spec. Every module is written against it. If something here
is ambiguous, pick the simplest reading that keeps modules compatible, and note
it in `notes/decisions.md`. Interface changes that affect other modules go in
`notes/interface-requests.md` (never silently edit a file you don't own).

## 1. The game in one paragraph

A Warcraft III–style real-time strategy game in the browser, in low-poly 3D
with a tilted camera. Each player leads a **pantheon** (Greek, Norse, Egyptian,
Hindu, Japanese, Chinese, Aztec, Celtic, Mesopotamian, West African). Human
**Worshippers** gather gold and wood, build a settlement that grows from
**Village → Town → City**, and **pray at Shrines and Temples to earn Faith**.
Faith summons the pantheon's **mythical creatures** (Shrine), **gods** (Temple,
hero units that level up and cast 3 abilities) and one colossal **Titan**
(Titan Gate, City only). Mortal soldiers come from the Barracks. Up to 4 slots,
each a human or an AI, on teams: co-op against AI, or players battle each
other. Online play is peer-to-peer with a room code; the host's browser runs
the authoritative simulation.

## 2. Technology

- Plain ES modules, **no build step**. Served as static files (GitHub Pages).
- Three.js **0.186.1** vendored at `vendor/three/three.module.js` (+ `three.core.js`).
  Import as `import * as THREE from 'three'`; addons as
  `import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'`
  (import map in `index.html` maps `three` → `./vendor/three/three.module.js`
  and `three/addons/` → `./vendor/three/addons/`). Only BufferGeometryUtils is vendored;
  do not import other addons.
- PeerJS **1.5.5** vendored at `vendor/peerjs.min.js` (classic script → `window.Peer`).
- `src/sim/**`, `src/data/**`, `src/ai/**`, `src/net/protocol.js`, `src/net/delta.js`
  and `src/game/view-state.js` must run in **Node 22** too (no DOM, no Three).
- Tests: `node --test "tests/**/*.test.js"` (built-in test runner, no deps).
  Browser checks: Playwright 1.56.1 is installed (`import { chromium } from 'playwright'`),
  launch with `args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']`
  for WebGL. Static server: `npx http-server . -p 8080 -c-1 --silent` from the repo root.
- Never use `Math.random()` in `src/sim`, `src/data`, `src/ai` — use `RNG` from `src/sim/rng.js`.
- Style: 2-space indent, semicolons, single quotes, JSDoc on exported functions,
  short comments only where the code isn't obvious. No TypeScript.

## 3. Coordinates, time, units

- Map is a grid `width × height` tiles (96 small, 128 medium). **1 tile = 1 world unit.**
- Sim positions `(x, y)` are floats in tiles. Tile `(tx, ty)` covers `[tx, tx+1) × [ty, ty+1)`;
  its center is `(tx + 0.5, ty + 0.5)`. Tile index = `ty * width + tx`.
- `x` grows east, `y` grows **south** (minimap top = north = y 0).
- 3D: sim `(x, y)` → Three `(x, h, y)` where `h` = terrain height at that point.
  Camera sits south of its target looking north and down (50° pitch close up, 58° at 44 tiles,
  steeper still out to 66° at the 170 tile far limit; DESIGN 8, "Far zoom").
- `facing` is radians, `atan2(dy, dx)` in sim coords. Models are built facing **+X**;
  set `object.rotation.y = -facing`.
- Sim tick = 1/20 s (`TICK_RATE = 20`, `DT = 0.05`). Data durations are **seconds**,
  speeds **tiles/second**, rates **per second**; the sim converts.
- Distances between entities for ranges are **edge to edge**:
  `dist(centers) − radiusA − radiusB` (buildings use the distance from the point to
  the footprint rectangle, minus the unit radius). Melee range = 0.5.

## 4. Data (src/data/)

Files: `config.js` (constants, at `src/config.js`), `data/schema.js` (vocabulary + validator),
`data/mortals.js`, `data/buildings.js`, `data/index.js` (registry), `data/pantheons/<id>.js`,
`data/pantheon-list.js` (the ten pantheon objects, imported by both the registry and `upgrades.js`).
Read `src/data/mortals.js` and `src/data/buildings.js` — they are canonical examples.

### 4.1 Unit type
```js
{
  id: 'greek_zeus',           // unique. Pantheon units: `${pantheonId}_${snake_name}`. Abilities: `${unitId}_${snake}`.
  name: 'Zeus',
  title: 'King of Olympus',   // gods & titans only
  pantheon: 'greek',          // null for mortals
  class: 'god',               // worker|infantry|ranged|support|siege|creature|god|titan|minion
  tier: 1,                    // tech requirement: 1 Village, 2 Town, 3 City
  cost: { gold: 100, wood: 0, faith: 200 },
  pop: 5,
  buildTime: 35,              // seconds to train/summon
  producedAt: 'temple',       // town_center|barracks|shrine|temple|titan_gate|null (minions)
  hp: 1050, armor: 4,
  speed: 3.1,                 // tiles/s
  radius: 0.55,               // collision radius (tiles)
  sight: 10,
  air: false,                 // flyers ignore terrain; only attacks with canHitAir can hit them
  attack: {                   // or null
    damage: 30, range: 5, cooldown: 1.6,
    canHitAir: true,
    projectile: 'bolt',       // null for melee; one of schema PROJECTILES
    element: 'lightning',     // schema ELEMENTS, used for VFX color
    splash: 0,                // radius of splash damage at the target (full damage to primary, 50% to others)
    buildingMult: 1,          // damage multiplier vs buildings (siege 2–3)
    buildingsOnly: false,     // battering ram
  },
  abilities: [ /* 4.4 */ ],
  passives:  [ /* 4.5 */ ],
  visual: { /* 4.6 */ },
  icon: '⚡',                  // emoji for buttons/portraits
  description: '…',
}
```
- Mortals (`worshipper`, `warrior`, `archer`, `priest`, `battering_ram`) are shared by all pantheons.
- Gods: exactly 3 abilities, keys `Q` (unlockLevel 1), `W` (unlockLevel 2), `R` (unlockLevel 4, the ultimate).
- Titans: exactly 2 abilities, keys `Q` and `R`, both unlockLevel 1. No levels.
- Creatures: 0–1 ability, key `Q`, usually `autocast: true`.
- Minions: units created only by `summon` effects (`producedAt: null`, cost 0, pop 0).
- All gods can attack air (`canHitAir: true`). Melee creatures cannot.

### 4.2 Pantheon
```js
export default {
  id: 'greek', name: 'Greek', culture: 'Ancient Greece',
  description: 'The Olympians rule from their mountain …',
  colors: { wall: '#ece6d6', roof: '#b5523b', trim: '#3a6ea5', accent: '#d4af37' }, // building palette
  style: { roof: 'gable', wall: 'marble', ornament: 'columns' },                     // building style (4.7)
  gods: [ /* 4 unit types, class 'god' */ ],
  titan: { /* unit type, class 'titan' */ },
  creatures: [ /* exactly 3, tiers 1, 2, 3 in order */ ],
  minions: [ /* summoned-only units, may be empty */ ],
  identity: { tagline, playstyle, blessings: [ /* 2, see 4.10 */ ] },                // what makes it play differently
  elite: { /* the pantheon's own Barracks soldier, see 4.10 */ },
  looks: { warrior: { headgear: 'helmet', colors: { … } }, … },                       // restyles the shared mortals (visuals only)
};
```

### 4.3 Buildings
See `src/data/buildings.js`. Key fields: `size` (square footprint N×N tiles), `hp`, `armor`,
`cost`, `buildTime`, `tier` (required tier), `requires` (building ids the player must own,
completed), `produces` (array of unit ids, or `'creatures' | 'gods' | 'titan'` resolved per
pantheon by `producibleAt()`), `popProvided`, `dropOff`, `prayerSlots`, `faithRate`
(faith/s per praying worshipper), `attack` (towers), `tierUpgrades` (town center only),
`upgrades` (one-time researches made at that building type; every building has its own list,
see `src/data/upgrades.js` for the effect types and the shared stat helpers the sim and HUD use).
Levels of one upgrade line (the Town Center's Worshipper work speed and health) share a `line` id
and one hotkey, stand side by side in the list, and each names the level before it in `after`.
Gold mines are 3×3 resource entities placed by the map.

**Wall segments** (`wall: true`, `size: 1`: `wooden_wall`, `stone_wall`) are ordinary one-tile
building entities that Worshippers drag out in lines (5.3). The wooden one carries
`wallUpgrade: { to, cost, time }` (the stone upgrade, researched per segment with no building
needed); the stone segment's own `cost` is the whole price (wood plus the upgrade), which is what
repairs and the refund for a tower raised over it go by. `joinsWalls: true` (the Watch Tower) lets a
building be raised on, or in line with, the owner's wall segments and be joined by them.
`src/data/walls.js` holds the pure helpers the sim, HUD and renderer share: `isWallType`,
`wallUpgradeOf`, `wallLine(x0, y0, x1, y1)` (the tiles of a dragged line), `wallMask` and
`wallConnections` (the neighbours a segment runs on to). Walls do not count as buildings for
defeat (5.8), for the AI's targets (10), for population, or for the buildings stat.

**The Manor** (`manor`, `size: 4`, tier 2) is four Houses combined: it is not on the build menu and
only comes from the upgrade in 5.3. Its `mergesFrom: { building: 'house', count: 4, cost, time }` is
the rule (which House, how many, the price and the time of the upgrade); the `cost` it carries is the
whole price of the four Houses and the upgrade, which repairs go by. It has no `upgrades` of its own:
it researches the House's (`researchHostOf`, which `upgradesFor` follows), and every effect on the
House counts again for it (`COMBINED` in `src/data/upgrades.js`). `src/data/houses.js` holds the pure
helpers the sim, HUD and renderer share: `mergeRule`, `researchHostOf`, `houseBlocks` and `planMerges`
(the squares among some Houses, or why there is none) and `MERGE_TEXT` (the refusals, word for word).

### 4.4 Ability
```js
{
  id: 'greek_zeus_thunderbolt', name: 'Thunderbolt', key: 'Q',
  unlockLevel: 1,
  autocast: false,            // light always-on spell (creatures/priest): quick picker, cast whenever a valid target exists.
                              // Every fighting unit's abilities autocast by default anyway (see Autocast below); this flag
                              // only picks the quick picker over the scored choice and keeps worshippers' spells on.
  cooldown: 9,                // seconds
  target: 'point',            // none (self-centered, instant) | point | unit (any) | ally | enemy
  range: 8,                   // max cast distance (center to target point/unit edge)
  castTime: 0.3,              // wind-up seconds (caster stands still, state 'cast')
  effects: [ /* applied in order */ ],
  vfx: { element: 'lightning', shape: 'strike' },
  ai: { use: 'damage' },      // damage|heal|buff|cc|summon|escape|economy
  icon: '⚡',
  description: 'Hurls a thunderbolt that blasts and stuns enemies in an area.',
}
```
**Effect common fields:** `at: 'target' | 'self'` (center: the target unit/point, or the caster),
`radius` (0 = only the target unit itself), `affects` (`enemies` default for harmful effects,
`allies` default for helpful ones; `self` = caster only; `all`), `delay` (seconds, optional),
`maxTargets` (optional; keeps the cast's target unit first, then the nearest to the center).

| type | fields | meaning |
|---|---|---|
| `damage` | amount, radius, at, affects | instant damage |
| `heal` | amount, radius, at | instant heal (never above max hp) |
| `stun` | duration, radius, at | cannot move, attack or cast |
| `slow` | pct (0–1), duration, radius, at | move and attack speed × (1−pct) |
| `buff` | stat, amount, duration, radius, at, affects | stat ∈ damage/speed/attackSpeed (fraction, 0.3 = +30%), armor (flat), lifesteal (fraction), regen (hp/s). Negative amount on enemies = debuff |
| `dot` | dps, duration, radius, at | damage over time status |
| `field` | duration, radius, at, dps?, hps?, slowPct? | persistent ground zone ticking every 0.5 s (dps hurts enemies, hps heals allies) |
| `summon` | unit, count, duration (s, 0 = permanent), at | spawns minions near the center; no pop cost |
| `chain` | amount, bounces, bounceRange, falloff | hits target unit, then jumps to the nearest un-hit enemy within bounceRange, × falloff each jump |
| `line` | amount, width, length | damages enemies in a rectangle from the caster toward the target point |
| `knockback` | distance, radius, at | pushes enemies away from the center (stops at obstacles) |
| `pull` | distance, radius, at | pulls enemies toward the center |
| `blink` | — | teleports the caster to the target point (nearest passable spot, within range) |
| `dash` | amount, width | caster rushes to the target point (speed 20 tiles/s), damaging enemies along the path |
| `shield` | amount, duration, radius, at, affects | absorbs damage before hp |
| `invulnerable` | duration | caster takes no damage |
| `reveal` | radius, duration, at | grants vision of the area to the caster's team |
| `resource` | gold?, wood?, faith? | grants resources to the caster's owner |

God ability amounts (damage, heal, dps, hps, shield amount, chain amount) scale
`× (1 + ABILITY_LEVEL_SCALE × (level − 1))`. Ability damage vs buildings × `SPELL_VS_BUILDING`.

### 4.5 Passives
| type | fields |
|---|---|
| `aura` | stat (damage/armor/speed/attackSpeed/regen), amount, radius, affects ('allies' or 'enemies') |
| `regen` | hps |
| `lifesteal` | pct (of attack damage dealt) |
| `cleave` | pct, radius (melee splash around the target) |
| `thorns` | pct (reflects melee damage taken) |
| `evasion` | pct (chance to dodge attacks, seeded RNG) |
| `critical` | chance, mult |
| `onHitSlow` | pct, duration |
| `onHitDot` | dps, duration |

### 4.6 Visual spec (procedural low-poly models)
```js
visual: {
  body: 'humanoid',   // schema BODIES
  scale: 1.6,         // 1.0 = a mortal warrior (~1.1 tiles tall). Gods 1.5–1.9, titans 3.5–4.5, creatures 0.8–2.8
  colors: { skin: '#e8c9a8', primary: '#f2efe6', secondary: '#3a6ea5', accent: '#ffd84a' },
  head: 'human',      // schema HEADS (animal heads for Anubis, Horus, etc.)
  headgear: 'laurel', // schema HEADGEAR
  weapon: 'lightning_bolt', // schema WEAPONS (main hand)
  offhand: 'none',    // schema OFFHANDS
  extras: ['beard', 'cape', 'long_hair'], // schema EXTRAS, any combination
  heads: 1,           // optional: number of heads for hydra/dragon (default 1)
  aura: '#9fd8ff',    // optional glow color (gods, titans, magical creatures) or null
}
```
`primary` = clothing / main body color, `secondary` = trim / second fabric, `accent` = metal,
gold, glowing bits, `skin` = skin / fur / scales. Every unit also gets a **team color**
(sash/cape/banner and the selection ring) from its owner.

### 4.7 Building style
`style.roof`: `gable | flat | pagoda | pyramid | dome | thatch_cone | stepped | shikhara | curved | longhouse`
`style.wall`: `marble | timber | sandstone | stone | mudbrick | brick | lacquer`
`style.ornament`: `columns | carvings | obelisks | torii | lanterns | serpents | knots | winged_bulls | spikes | banners`
`colors`: `wall`, `roof`, `trim`, `accent`. Team color appears on banners/flags.
A building may carry `pantheonIcons` (pantheon id → emoji, Emoji 11 at most): the Temple does, so its portrait, build
button and "completed" note show the builder's own (Greek 🦉, Norse 🌈, Egyptian 👁️, Hindu 🕉️, Japanese ⛩️, Chinese 🏯,
Aztec 🌞, Celtic 🌿, Mesopotamian 🌙, West African 🥁) instead of everyone's torii (`buildingIcon(type, pantheon)`).

### 4.8 Pantheon roster (fixed — content files must use these)
| id | name | gods (4) | titan | creatures T1 / T2 / T3 | style |
|---|---|---|---|---|---|
| greek | Greek | Zeus, Athena, Poseidon, Hades | Kronos | Centaur / Pegasus (air) / Cyclops | gable, marble, columns |
| norse | Norse | Odin, Thor, Freyja, Loki | Surtr | Wolf of Fenrir / Valkyrie (air) / Frost Troll | longhouse, timber, carvings |
| egyptian | Egyptian | Ra, Anubis, Isis, Set | Apep | Scarab / Bennu (air) / Sphinx | pyramid, sandstone, obelisks |
| hindu | Hindu | Shiva, Vishnu, Durga, Hanuman | Airavata | Vanara / Naga / Garuda (air) | shikhara, sandstone, carvings |
| japanese | Japanese | Amaterasu, Susanoo, Raijin, Inari | Yamata no Orochi | Kitsune / Tengu (air) / Oni | pagoda, lacquer, torii |
| chinese | Chinese | Sun Wukong, Nüwa, Guan Yu, Chang'e | Pangu | Guardian Lion / Fenghuang (air) / Celestial Dragon (air) | curved, lacquer, lanterns |
| aztec | Aztec | Quetzalcoatl, Huitzilopochtli, Tezcatlipoca, Tlaloc | Cipactli | Jaguar Spirit / Ahuizotl / Xiuhcoatl | stepped, stone, serpents |
| celtic | Celtic | The Dagda, The Morrígan, Lugh, Brigid | Balor | Cù Sìth / Banshee (air) / Dullahan | thatch_cone, stone, knots |
| mesopotamian | Mesopotamian | Marduk, Ishtar, Enki, Nergal | Tiamat | Scorpion Man / Anzû (air) / Lamassu | stepped, mudbrick, winged_bulls |
| west_african | West African | Shango, Oya, Ogun, Anansi | Ninki Nanka | Aziza / Sasabonsam (air) / Bultungin | dome, mudbrick, spikes |

Depict every figure respectfully (they are heroes of their own pantheon). No central
figures of living monotheistic faiths.

### 4.9 Balance budget
| kind | cost (g/w/f) | pop | hp | dps (dmg/cooldown) | notes |
|---|---|---|---|---|---|
| Worshipper | 50/0/0 | 1 | 220 | 3 | |
| Warrior | 135/0/0 | 2 | 420 | 9.6 | armor 2 |
| Elite soldier | 150–195 / 30–60 / 0 | 2 | 280–640 | 10–17 | Town; one edge, one cost (4.10) |
| T1 creature | ~80/0/40 | 2 | 350–500 | 9–12 | train 20 s, Village |
| T2 creature | ~120/20/100 | 3 | 550–800 (air 450–600) | 14–20 | 1 ability or strong passive, train 28 s, Town |
| T3 creature | ~180/60/180 | 5 | 1000–1400 | 25–40 | splash or siege (buildingMult 2), train 40 s, City |
| God (lvl 1) | 100/0/200 | 5 | 900–1200 | 18–24 | armor 3–5, speed 3.0–3.4, sight 10, summon 35 s |
| God abilities | | | | | Q: cd 8–14, ~120–160 dmg r≈2 or equivalent. W: cd 14–25 utility (heal/buff/cc/summon). R: cd 60–120, big (≈400 dmg r≈4, or an army buff, or a summon of 3–5 minions) |
| Titan | 400/200/800 | 10 | 5000–6500 | 70–100 | armor 6–8, speed 2.0–2.4, radius 1.2–1.6, splash ~1.5, buildingMult 2, summon 60 s; Q cd 20–40, R cd 60–90 |
| Minion | 0 | 0 | 150–400 | 6–12 | duration 20–40 s |

### 4.10 Pantheon identity
Ten pantheons that only differ in their gods would play alike, so each one also has an *identity* (what the
player feels in the first minutes), an *elite soldier* and a *look*. All of it is data in the pantheon file; the
sim reads it through the same pipes as building upgrades.
- **Blessings** (`identity.blessings`, exactly 2): always-on effects from the first second of a match, written in
  the upgrade vocabulary (`src/data/upgrades.js`: `building`, `unit`, `carry`, `chop`, `work`, `godLevel`) plus one
  new effect, `{ type: 'perk', stat, amount }`, for the few traits that need a sim rule of their own
  (`PERK_STATS` in `schema.js`). A `building` effect may name `'*'` for every building type; a `unit` effect may
  raise `speed` (fraction). `computeMods(upgradeIds, pantheonId)` folds the blessings in before any researched
  upgrade, so `p.mods` (set at start and after every research) already carries them and the HUD, which reads the
  same numbers, shows them with no extra code. Perks:
  `plunder` (share of a slain enemy's gold + wood cost paid to the killer as gold; creeps and summoned units pay
  nothing), `sacrifice` (faith per population point of every enemy unit slain), `karma` (faith/s per worshipper
  mining, chopping, building or repairing), `shrineFaith` (faith/s per finished Shrine or Temple, up to 4, with or
  without prayer; `src/sim/spoils.js`), `buildSpeed` (construction and repair rate), `techSpeed` (research and
  Town Center growth), `cooldown` (god and titan ability cooldowns), `revive` (cheaper, faster revival).
- **Elite soldier** (`elite`): a fifth Barracks unit, tier 2 (Town), pop 2, 150–195 gold + 30–60 wood, 26 s, with a
  stat line and often a passive of its own. `class` is `infantry` or `ranged` and `kin` is the mortal it stands in
  for (`warrior` or `archer`): upgrades that name that mortal (Bronze Weapons, Hoplite Shields …) also reach the
  elite (`unitMods` matches `def.kin`). `mortal: true` draws it as a soldier; `plural` overrides "<name>s" in text.
  `producedAt: 'barracks'`, so `producibleAt()` lists it for its own pantheon only and it ranks up (5.9). It is
  never a copy of the Warrior or Archer: **each elite has one edge and one cost** (slow and armored, fast and
  fragile, long range and slow reload …) and its power per population point and per gold stays near the base
  soldier's, so it is a choice, not an upgrade. The AI builds it as the melee or ranged soldier it is short of
  (up to 45 % of its army).
- **Looks** (`looks`): per shared mortal, visual overrides (`colors` merged key by key, `head`, `headgear`,
  `weapon`, `offhand`, `extras` replaced). Render only: `unit-looks.js` lays a look over the mortal's visual when
  the model is built for a player of that pantheon, so the sim, the data registry and the net never see it.
- **Where it shows:** the HUD pantheon chip (top left, hover for blessings and elite), the pantheon picker and the
  lobby preview (blessings + elite rows), the Barracks card (key `E`, tooltip with the stat line), How to Play.
- **Rules for new content:** every blessing is a small, readable, always-on edge, never a second race; nothing
  here may change a rule for the other players; a new `perk` needs one line in `PERK_STATS`, one sim hook, one
  test and one sentence in its blessing's description. Icons are single Emoji.

### 4.11 God powers (src/data/powers.js, src/sim/powers.js)
Age of Mythology's god powers: each pantheon has three **one-use** divine powers, one per settlement tier,
that the player casts from the power bar beside the minimap with no unit casting them. `GOD_POWERS[pantheonId]`
lists them Village, Town, City; `POWERS` has every one by id (30 in all; `validatePowers`, run by
`validateData`, holds the rules below).
- **Village: a blessing** that helps the caster's people and hurts nobody: a harvest (every load of gold and wood
  brought in counts 50% more for 60 s), a festival (prayer gives twice the faith for 60 s), a healing rain
  (120 health at once, then 30/s for 15 s to own and allied units in 7 tiles) or a caravan (400 gold and 200 wood).
- **Town: a strike** aimed at a spot within about 3–5 tiles: a storm of bolts, a hammerfall, a swarm, a gale, a
  summoning of crows.
- **City: a cataclysm** over 7–12 tiles: an earthquake, a winter, a flood, a tsunami, an eclipse, a tempest.
- **Shape:** `{ id, pantheon, tier, kind: 'blessing'|'strike'|'cataclysm', name, icon, description, target:
  'none'|'point', effects, vfx: { element, shape }, ai: { use: 'economy'|'heal'|'damage' } }`. Effects are the
  ability effects of 4.4 that need no caster's body (not blink, dash, chain, line, invulnerable, nor `at: 'self'`),
  applied by `applyEffect` with a stand-in caster for the player (id 0, `kind: 'power'`, already "dead", so
  nothing retaliates against it and nothing ranks up), at scale 1. Kills, plunder, sacrifice, god experience and
  the victims' under-attack alerts are the caster's as with any spell; spell damage to buildings is halved
  (`SPELL_VS_BUILDING`). Two effects are the powers' own: `boon { stat: 'gather'|'faith', pct, duration }`
  (`p.powers.boons`; `deposit` multiplies each load by `1 + boonPct(p, 'gather')`, `accrueFaith` the prayer rate
  by `1 + boonPct(p, 'faith')`) and `barrage { count, amount, radius, spread, every, stun? }` (bolt k lands
  `0.5 + k × every` s after the cast, the first on the spot and the rest on seeded random spots within `spread`,
  each a `damage` (and `stun`) of `radius`; the whole barrage lasts at most `BARRAGE_MAX_SECONDS`, 4 s, because the
  renderer telegraphs an effect at most that far ahead).
- **Rules** (`castPower` / `powerRefusal`, the `godPower` command): a power is spent when it is cast, never
  before (a refused one stays). It needs the settlement tier (`Requires Town.` / `Requires City.`); a strike or
  cataclysm needs a spot the caster's team can see (`teamSees`: the spot's tile lies in an allied unit's or
  building's `sight` or a reveal, by `tileInSight`, the rule the clients' fog grid stamps, so the HUD and the sim agree;
  `You must be able to see the target.`) and waits out the Decade of Peace (5.10, `The Decade of Peace
  holds for another m:ss: no god powers against other players yet.`), while a blessing works during it. Used:
  `<Name> has already been used.` Powers never hurt the caster's own side. A blessing with no target shines over
  the caster's first Town Center.
- **Numbers** live in `src/data/powers.js` only (the builders `boon`, `healRain` and `barrage` keep the ten
  pantheons comparable). In AI games the strikes and above all the cataclysms decide most battles, so they are
  kept even by measurement (balance pass, 2026-10-29): `node tools/power-bench.mjs` casts each on a carpet of
  tough soldiers that stand and fight, and every Town strike removes about 4,400-6,900 health there (the Crows 3,250, plus six crows) and every
  cataclysm about 26,000-52,000 (the low ones carry extras the bench does not count: Taranis's stuns, Tandava's
  instant blast, Ryūjin's knockback and slow, Apep's damage buffs and mummies, the Crows' damage cut and crows).
  Then `node tools/ai-tournament.mjs --seeds=1-8 --diff=hard` (and `normal`) checks that every pantheon wins
  about 40-60% of its 1v1 games. Before the pass the Plague of Locusts did twice any other strike, the
  Morrígan's Crows, Apep Swallows the Sun and Taranis almost nothing, and win rates ran from 25% (Celtic) to
  72% (Chinese).

## 5. Rules

### 5.1 Start
Each player: Town Center (tier 1, Village) at its start position, 5 Worshippers, 400 gold,
200 wood, 50 faith. A gold mine (12000) 2–4 tiles from the Town Center, a forest edge 6–10
tiles away. Population cap = sum of `popProvided` of completed buildings, max `POP_MAX` (200): a Town
Center gives 12 and a House 8 (10 with Large Families), so 24 Houses and a Town Center reach it (19 with
Large Families). Four Houses in a square can be combined into a Manor (5.3) that gives 48 instead of
their 32, so a Town Center and four Manors (204) reach it with sixteen Houses' worth of ground.
Pop used = pop of living units + pop of everything queued in production.

### 5.2 Economy
- **Gold:** Worshipper walks to its own spot on the mine edge (one per tile around the
  footprint, the free one nearest its drop-off, kept for the whole order), mines `MINE_TIME`
  (1.5 s), carries `CARRY_AMOUNT` (10) to the nearest completed drop-off (Town Center or
  Storehouse), repeats. At most `MINE_SLOTS` (2) workers mine a mine at once (any owner);
  the others wait at their spot (state `gather`, view key `mw: 1`) and take a freed slot
  first come, first served. One mine therefore yields at most
  `MINE_SLOTS × 10 / MINE_TIME` ≈ 13.3 gold/s (before upgrades):
  about 3 gold/s per worker at a start mine, saturated by 5–6 workers. A mine at 0 is
  removed (`resourceDepleted` event); its workers move to the nearest mine within 16 tiles.
- **Wood:** each forest tile holds `TREE_WOOD` (50). A worker stands next to a tree and chops
  1 wood per `CHOP_INTERVAL` (0.6 s) up to 10, returns it, comes back to the same tree or the
  nearest other tree. A depleted tree tile becomes grass (`treeFelled` event) and is passable.
- **Work speed:** the Town Center's Work Songs line (`work` effects, +15% / +15% / +20%, added
  up) makes the owner's Worshippers work faster at everything but praying: the mining timer runs
  down `1 + work` times as fast, chopping divides `CHOP_INTERVAL` by `(1 + chop) × (1 + work)`
  (Sharpened Axes is the `chop` part), and construction and repair progress is multiplied by
  `1 + work` (`workSpeed`, `chopSpeed` in src/data/upgrades.js; `workSpeedOf` in sim/economy.js).
  Walking, praying and training are unchanged.
- **Faith:** a worshipper ordered to pray at a completed Shrine/Temple (smart-click or Pray)
  walks to it and kneels next to it while slots are free (`prayerSlots`), generating
  `faithRate` faith/s (Shrine 0.5, Temple 0.7). If full → error `This Shrine is full.` /
  `This Temple is full.` (the building's name).
  Praying continues until another order.
- Gathering/returning workers do not collide with other units (they pass through).

### 5.3 Construction
- `build` command: validates tier, `requires`, affordability, placement → **deducts cost
  immediately**. The worker walks to the site. On arrival, if the site is still valid, the
  building entity is created (hp = 10% max, `bp` 0) and the worker builds it; otherwise
  refund + error. A different order before arrival refunds the cost.
- Progress per second = `(1 + BUILD_HELPER_BONUS × (builders − 1)) × workSpeed / buildTime`; hp grows
  proportionally to max hp. Leaving pauses construction; a worker smart-clicking an
  unfinished own building resumes/helps.
- Placement: all footprint tiles in bounds, ground-passable (not forest/water/rock), no
  building/mine footprint overlap, no enemy units on it (own units are pushed out), and every
  drop-off (Town Center, Storehouse) keeps a gap of ≥ `DROPOFF_MINE_GAP` (3) empty tiles
  (Chebyshev: `max(gapX, gapY)`) from every gold mine footprint. In a Decade of Peace no tile of
  the footprint may lie within `PEACE_BUILD_GAP` (20) empty tiles of an enemy Town Center (5.10).
  The error names the reason, the first that applies of: water, rock or the map edge (`Can't build
  there.`), `Trees in the way.`, `Another building is in the way.`, `A gold mine is in the way.`,
  `Something is in the way.` (an enemy or neutral unit), `The Decade of Peace holds for another
  m:ss: no building near an enemy Town Center yet.` (the peace's ground), `Too close to a gold
  mine.` (the gap alone);
  `world.placementError(i, typeId, tx, ty)` returns that text (null = valid) and
  src/game/placement.js `checkPlacement(...).message` gives the same on the client, which also
  says `Unexplored ground.` first for any fogged tile (the sim does not know the fog, and the
  text does not reveal what lies in it). Only the text depends on the reason, never validity.
- `cancelBuild` on an unfinished building: removes it, refunds `CANCEL_BUILD_REFUND` (75%).
- **Walls** (`src/sim/construction.js` `issueBuildLine`, `src/sim/production.js` `issueWallUpgrade`):
  - A `build` command for a wall type with `tx2` / `ty2` is a *line*: the tiles from (tx, ty) towards
    (tx2, ty2) in the nearest of eight directions (`wallLine`, at most `MAX_WALL_LINE` = 48 tiles;
    a diagonal is stepped with a corner tile so no unit can squeeze between two segments). The
    whole line is paid for at once, all or nothing (`Not enough wood.`), and every segment's
    construction site is created at once without an event or a message, so an unfinished segment
    already blocks the way and can be attacked (hp 10% of max). Tiles the wall already holds (an own
    segment, or a tower that joined it) are skipped and tiles that cannot be built on are left out;
    when nothing at all can be built the first reason is the error (`The wall is already there.` when
    the line is all built). The sites appear with no worker on the spot, so only tiles within
    `WALL_PLACE_RANGE` (24) of one of the ordered workers are raised; the rest are left out like a
    tile that cannot be built on (`Too far from your Worshippers.` when nothing is in reach). Nobody
    can wall off, or look from, a far-off place without sending a Worshipper there first.
  - Crew: the workers are ordered along the line and each takes a contiguous stretch; extra workers
    help the nearest one. A worker that finishes a segment, or cannot reach it (it is boxed in), walks
    on to the next of its stretch and then to the nearest unfinished segment of the player's walls
    within `WALL_HELP_RANGE` (14) that fewer workers are on. A plain `build` of a wall type without
    `tx2` is a single segment.
  - A finished segment emits no `buildingComplete`, adds nothing to the stats, population or defeat
    checks, and its death is a `death` event like any building's (the HUD folds a run of them into one
    "breached" message).
  - `upgradeWall { walls: [ids] }` queues the stone upgrade on each finished segment that is not
    already upgrading, in the order given, paying per segment for as many as the purse allows
    (`Not enough gold. Upgraded 7 wall segments.`). The upgrade is a queue item (`upgrade: true`, `u` =
    the stone type) that runs by itself with no worshipper; the wooden segment keeps working as a wall
    meanwhile and `world.changeBuildingType` then turns the same entity into stone in place (it keeps
    the health it is missing; armor and maximum health follow the new type). Imperial Bureaucracy's
    `techSpeed` quickens it, like any growth.
  - A `build` command only takes the types of `BUILD_MENU` (`buildableDef`): a Stone Wall comes from the
    upgrade alone, so a client that orders one is ignored.
  - A building with `joinsWalls` may be placed over the owner's own wall segments (the placement check
    ignores them); when the builder starts it the segments under its footprint are removed with a full
    refund and the tower stands in their place, joined to the wall (the renderer reaches the
    neighbouring segments into it, 8).
  - `cancelBuild` on a *finished* wall segment takes it down, refunding `WALL_REMOVE_REFUND` (50%) of
    its cost (an upgrade under way is refunded in full): walls block the owner's own units too, so
    this is how a gap is opened. Dismantling is not an attack and costs no time.
- **Manors** (`src/sim/homes.js`, `src/data/houses.js`): four Houses that stand in a *square*, a 2×2
  block of the owner's finished Houses touching edge to edge (so one 4×4-tile square: each House is one
  House-width, 2 tiles, from its neighbours), are combined into one Manor in place. Houses merely near
  each other, in a row or in an L are not grouped. `upgradeHouses { houses: [ids] }` takes any selection
  of Houses and finds the squares among them (`houseBlocks`: row by row from the top, left to right, no
  House in two squares; other Houses may stand anywhere), then starts every square that can, paying
  `mergesFrom.cost` (100 gold, 60 wood) for each at once, for as many squares as the purse allows
  (`Not enough gold. Combined 1 of 2 squares.`). It needs a Town (`Requires Town.`: the Manor's `tier`),
  and the four Houses must be finished and *idle*: not researching and not part of a combining already.
  The refusals cost nothing: `Select four Houses that stand together in a square.`, `Those Houses do not
  make a square, two by two.`, `A House in the square is busy: wait for its research or upgrade to finish.`
  - The upgrade needs no worker. It is a queue item (`upgrade: true`, `u` = `manor`, 45 s, quickened by
    Imperial Bureaucracy's `techSpeed` like any growth) on each of the four Houses, all sharing one `group`
    object (`ids`, the square's top-left tile, `cost`, `owner`): the top-left House runs the timer and the
    other three copy its progress, so any one of them can be selected to watch it and the queue panel shows
    it like any item. The Houses keep sheltering their people while it runs. The price belongs to the group:
    `cancelTrain` on any of the four items stops the whole upgrade and returns the price once, and so does a
    House that falls meanwhile (`releaseBuilding`), while the other three carry on as Houses. Researching at
    a House being combined is refused (`That House is being combined into a Manor.`).
  - When the time is up the four Houses are removed (no death, like a wall taken down) and one Manor stands
    on their ground, finished, announced by a `buildingComplete` ("Manor completed."), with the average of
    the four health fractions (combining does not heal; repair does). A Manor shelters 48
    population against the 32 of four Houses (+16, so the limit of 200 is reached with a Town Center and four
    Manors), has 2400 health (against 2000) and armor 4, and costs 420 gold and 180 wood to replace: four
    Houses and the upgrade. It cannot be built from scratch (`build` takes only `BUILD_MENU` types).
  - A Manor holds what the Houses held: every upgrade, blessing or perk effect on the House counts again for
    it, as often as the Houses it replaced for population and health and once for armor (`COMBINED`, so
    Large Families +2 becomes +8 and Mesopotamian Crowded Cities too, whether researched before or after),
    and it researches the House's upgrades (`researchHostOf`), each once per player. The AI never combines
    Houses (10).
- **Repair:** worshippers ordered to `repair` an own completed, damaged building walk to it and
  mend it (state `build`, view task `tk: 'repair'`). One worshipper restores the full health bar
  in `REPAIR_TIME` (75%) of the build time (shorter with work speed); each extra adds `BUILD_HELPER_BONUS`. A full bar
  costs `REPAIR_COST` (35%) of the build cost, paid each tick as it heals; when the owner cannot
  pay, the repairers give up and `Not enough gold to repair.` (wood / faith) is shown (at most
  every 3 s per building). `autoRepair { on }` toggles Auto-Repair for the player: idle
  worshippers look for a damaged building within `AUTO_REPAIR_RANGE` (10) tiles every second.
  AI players switch it on.
- **Autocast:** every ability of a player's fighting unit (creatures, gods, titans, priests,
  minions; not worshippers) is on autocast when it spawns. Every 6 ticks a unit that is idle,
  attacking, attack-moving, holding or following tries its ready autocast abilities: data
  `autocast: true` spells use the quick picker; the others go through the scored choice in
  `sim/cast-choice.js` (the same scoring the AI casts with: damage and crowd control where they
  hit enough enemies or a hero, heals when enough health is missing (also after a fight), buffs
  and shields on engaged allies, summons only near enemies, ultimates only on big fights,
  escapes below ~32% health). Autocasts never chase, keep the current order and resume it.
  `autocast { units, ability?, on }` sets one ability (or all) to autocast or manual; a cast
  the player orders always runs, whatever the setting. Neutral creeps keep only their data
  `autocast` spells. The HUD toggles one ability with a right-click on its button and every
  ability of the selection with the `` ` `` key; easy AIs set their casters to manual and cast
  with their own, pickier threshold.

### 5.4 Production
- `train` puts an item in the building's queue (max `MAX_QUEUE`, 50). Cost and population are reserved
  when queued, so the purse and the population cap end a queue before the 50 do when they are short
  (every trainable unit takes at least 1 population, so one player never holds more than `POP_MAX` queued
  units in all of their buildings together). `cancelTrain` takes items back and refunds each at the cost it
  was queued with, restoring a fallen god that was queued for a revive: `index` is the first item (default
  the last), `count` how many from there on (default 1, clamped to the end of the queue), so a long run goes
  back in one command. Units, research and growth share one queue, and research and a Town Center's growth
  wait behind the units already in it. A building that is destroyed loses its queue: the population is
  freed but nothing is paid back, which is the risk of queueing deep at the front line.
  Units spawn at the footprint edge nearest the rally
  point and then follow the rally (rally on a mine/tree → worker gathers). When a rallied
  mine runs dry the rally moves to the nearest mine within 16 tiles (if any).
- Creatures need tier ≥ their tier. Gods: unique per player (no duplicates alive or queued),
  max `MAX_GODS` (3) alive+queued, and the n-th god needs tier `GOD_SLOT_TIER[n-1]`
  (1st Village, 2nd Town, 3rd City). Titan: max 1 alive+queued, needs Titan Gate (City).
- **Revive:** a fallen god can be re-summoned at a Temple for `REVIVE_COST_MULT` of its cost
  and time, keeping its level and xp (`train` with that god's id when it is in `fallen`).
  Hindu Samsara cuts both by 40 % (`reviveMult`).
- **Elite soldier:** the Barracks also trains its owner's pantheon elite (4.10) once the player is a Town.
- **Blessing speeds:** Barracks and Shrine training speed (`train` building effect), research and Town Center
  growth (`techSpeed`) and construction and repair (`buildSpeed`) all run faster by their fractions; god and
  titan ability cooldowns shrink by the `cooldown` perk (`cooldownScale` in `abilities.js`).
- **Tier up:** `upgradeTier` on the Town Center queues a `tier_up` item (cost from
  `tierUpgrades`, `requires` buildings). While it runs, that Town Center cannot train.
  Player tier = highest tier among their completed Town Centers.
- **Building upgrades:** `research` queues an upgrade at a completed building of its type (it
  shares the production queue, cost paid up front and refunded by `cancelTrain`). Each is
  researched once per player, needs its `tier`, and on completion (`researched` event) applies to
  everything the player owns now and later: building hp / armor / pop / tower damage and range,
  faith per prayer, training speed, unit damage / hp / armor / regen, carry amounts, chopping
  speed, Worshipper work speed, and the starting level of summoned gods. The list per building
  is in buildings.js.
- **Upgrade lines:** a line is a chain of levels researched one after the other (`line`, `after`):
  a level needs the one before it (`Requires <Name>.`) and its own settlement `tier`. The Town
  Center has two, three levels each. *Work Songs → Master Craftsmen → Tireless Devotion* (hotkey
  K; tiers 1 / 2 / 3; +15% / +15% / +20% work speed) and *Hearty Meals → Healing Herbs → Blessed
  Vigor* (H; tiers 1 / 2 / 3; +20% health each, a share of the base 220, so 264 / 308 / 352).
  Health goes through the `unit` effect (`classes: ['worker']`), so every living Worshipper gains
  the new health at once (added to what it has) and every later one arrives with it.

### 5.5 Combat
- Damage after armor (WC3): armor ≥ 0 → `× (1 − 0.06·a / (1 + 0.06·a))`; armor < 0 → `× (2 − 0.94^(−a))`.
- Ranged attacks fire a projectile (`PROJECTILE_SPEED`); damage lands on arrival (homing,
  never misses unless the target died). Melee lands at the swing.
- Auto-acquire: idle and attack-moving non-worker units attack enemies within acquisition
  range `max(sight × 0.75, range + 1)`. Priority: closest enemy unit that can attack, then
  other units, then buildings. Hold position: attack only what is in range, never move.
- **Melee surround** (`src/sim/surround.js`): a ground melee attacker within `SURROUND_DIST`
  (7) of its target's edge claims its own free spot on a ring around it (radius rT + rU +
  0.25 for units; a rounded rectangle at rU + 0.25 around a building's footprint). Standing
  units and other attackers' claims block arcs; the attacker walks around the ring to its spot
  instead of pushing through the crowd, re-checks it every 12 ticks, and marks a spot bad for
  3 s when it makes no progress. With no free spot it waits outside the crowd (counts as blocked).
- **Re-targeting** (attack-move and auto-acquired attacks, on their scan tick): after
  `RETARGET_TICKS` (1 s) approaching, switch to an enemy already in range of the same or better
  priority; after 1 s blocked, switch to any enemy in range or the nearest reachable one. An
  unreachable target is skipped for 2 s on attack-move. Explicit `attack` orders keep their
  target. Melee acquisition keeps the category priority but, within the best category, takes
  the one of the 4 closest with the cheapest free spot; surrounded targets are skipped.
- Units with `canHitAir: false` cannot target air units. Air units ignore terrain and do not
  collide with ground units.
- When a unit is attacked while idle, it fights back (workers too, unless gathering/praying).
- Towers auto-attack the closest enemy unit in range.
- **Walls** block every ground unit's movement and have health and armor. Nobody auto-acquires a wall
  segment: `findTarget` skips them, so idle soldiers and towers leave a wall alone (an explicit
  `attack` on one works). A ground melee attacker whose way to its target is cut off (no attack spot
  of the target can be reached: `approachSpot` returns `'unreachable'` after `CUT_SPOTS` = 2 spots in
  a row) or whose attack-move stops short of its destination breaks through: `findBreach` picks the
  enemy segment within `BREACH_RANGE` (4) with the least health left (nearest on a tie), so a crowd
  works on one segment and a wooden stretch in a stone wall is where they break in. The order
  carries on once the segment falls and finds the way open. An attack-move drops the breach when an
  enemy unit comes within reach. Ranged attackers shoot over a wall at whatever is within their range; one
  that would have to come nearer and finds the wall in its way breaks it like anyone else (slowly: arrows
  against its armor), so no army stands outside a wall for good. The AI never targets a wall segment (10). Rams hit walls like any building. A wall segment is worth no
  experience (5.9); it pays spoils like any finished building. Nothing breaks a wall during a
  Decade of Peace (5.10).
- Neutral creeps (owner −1) sit at camps, attack anything within `CREEP_AGGRO_RANGE`, chase up
  to `CREEP_LEASH_RANGE` from camp, then walk back and heal to full. They give the killer's
  owner a bounty of `10 + 10 × tier` gold.
- **Spoils** (Norse Plunder, Aztec Flower War): a kill of an enemy unit, or the razing of a finished enemy
  building, pays the killer's owner gold (`plunder` × the victim's gold + wood cost) and/or faith (`sacrifice`
  × its pop). Creeps (they already pay a bounty), summoned units and unfinished sites pay nothing.

### 5.6 Gods
- Levels 1–6 by cumulative xp `GOD_XP_LEVELS`. When an enemy unit dies, every living god of
  the opposing side within `XP_RANGE` gets `xpValue(type)` split evenly between them.
- Each level above 1: +8% max hp and attack damage, +0.5 armor, +10% ability amounts.
- Abilities unlock at their `unlockLevel`. Gods regenerate 1 hp/s.
- When a god dies, it goes to the player's `fallen` list (with level & xp).

### 5.7 Team market
`trade { to, res, amount }` sends `amount` (whole number, at least `TRADE_MIN` 20) of
`gold`, `wood` or `faith` from the issuing player to a living teammate. The sender pays
`amount`; the market keeps `TRADE_TAX_PCT` (10%, rounded up) and the teammate receives the
rest, so feeding one player always costs the team. Enemies, defeated players and oneself
cannot be sent to; there is no cooldown. Each transfer emits
`{ type: 'trade', from, to, res, amt, got }`. Rules live in `src/sim/trade.js` (shared with
the HUD). AI players send part of their spare gold / wood (above 700 / 450, after the
think's purchases) to the poorest teammate who is nearly broke (under 120 gold / 60 wood),
from 1:30 on, at most once every 20 s each (`src/ai/team.js` planAid). A stand-in AI holding the seat of
a player who dropped out (7) sends nothing: it does not give away an absent player's resources.

### 5.8 Victory
A player is **defeated** when they own no buildings (finished or not; wall segments do not count).
Their remaining units die and so do their wall segments (an ally could never open them). A team wins when every player not on that team is defeated (neutral excluded).
`surrender` defeats the issuing player. Then `gameOver: { winningTeam }`. With Sacred Victory on (5.11) a
team that holds every sacred site for `SACRED_HOLD` seconds also wins: `gameOver: { winningTeam, how: 'sacred' }`.

### 5.9 Soldier ranks
Mortal soldiers (every unit the Barracks trains: Warrior, Archer, Priest, Battering Ram and the pantheon's
elite soldier; `canRank` in `src/data/ranks.js`) earn experience and rise through four ranks: Recruit, Veteran, Elite, Champion.
Worshippers, gods (they have levels), titans, creatures and summoned minions do not rank.
- **Experience:** the unit that lands the killing blow on an enemy unit earns what the kill is worth to
  gods (`xpValue`: `10 × pop + hp / 40`, so a Warrior is worth 31; gods `100 × level`, titans 400; neutral
  creeps count). The killing blow on a completed enemy building earns `hp / BUILDING_XP_HP` (50; a House
  is worth 10, a Barracks 24), which is how Battering Rams rank. A Priest earns `HEAL_XP` (0.1) for each hit
  point it actually restores. Nothing else counts (not damage dealt, not assists), so there is nothing to
  farm: a victim can only be killed once.
- **Ranks:** cumulative xp `RANK_XP` = 0 / 60 / 150 / 300, so about 2, 5 and 10 Warrior kills. Each rank
  adds `RANK_HP` (+10%) max hp, `RANK_DAMAGE` (+5%) attack damage and `RANK_ARMOR` (+0.5) armor, on top of
  building upgrades (`applyUnitStats`). A promotion adds the extra max hp to the current hp too (a full unit
  stays full) and emits `rankUp`. Experience is lost with the unit; a new soldier is a Recruit.
- **Shown:** one to three bronze / silver / gold diamonds over the unit (`StatusLayer.addRank`, always, not
  only when selected; not chevrons, because a buff icon already is a pair of gold ones), a rank numeral
  badge on the portrait and the multi-selection cells, and in the selection panel the rank, an xp bar and
  the stats with the rank bonus included. A promotion plays a small golden ring, the rank name floating
  over the unit and, for the player's own soldiers, a soft chime.
- **Net:** `rk` (rank, once above Recruit) and `xp` (whole xp, once at least 1) ride in the EntityView,
  so full snapshots, deltas and resyncs carry them with no codec change; `rankUp` is a packed event.

### 5.10 Decade of Peace (game mode)
An optional game mode the host picks in the lobby: `GameSetup.peaceMinutes` is 30, 45 or 60
(`PEACE_LENGTHS`; minutes of game time, so pausing a solo game does not use them up). A setup
without it is a normal game and nothing below applies. Until `world.peaceEnd` (`peaceMinutes ×
60` s) players cannot harm each other at all, so everyone has time to build up and mass armies
for one great battle. Rules live in `src/sim/peace.js` (helpers shared with the HUD) and
`World.canHarm` / `peaceBlocks`:
- `world.canHarm(a, b)` is `areEnemies(a, b)` except that two players are safe from each other
  while `world.peace` holds; `world.peaceBlocks(a, b)` is true when the peace is the only
  reason. `areEnemies` itself is unchanged (collision, placement, kill credit, AI intel and the
  UI read it), so everything that means "may I hurt this" uses `canHarm`: auto-acquire and
  attack orders (`canTarget`), tower targeting, splash and cleave, every harmful ability effect
  (damage, stun, slow, dot, debuff, field, chain, line, dash, knockback, pull), `target: 'enemy'`
  and harmful `target: 'unit'` casts, autocast and the AI's cast scoring, and debuff auras. An
  effect with `affects: 'all'` still hits the caster's own and allied units but skips rivals.
  Heals, shields and buffs on allies, summons and reveal are unaffected, so are friendly fire and
  hits between teammates (never enemies).
- Last line of defence: `dealDamage` returns 0 for a hit from one player on an enemy player
  while the peace holds, so a damage over time or a field cannot get through either.
- An `attack` or `smart` order aimed at another player's unit or building becomes a `move`
  to it, with one error per order ("The Decade of Peace holds for another m:ss: no attacking
  yet."); a cast aimed at a protected player is refused with the same error and costs nothing.
  Attack-move walks through rivals without stopping.
- Neutral creatures (owner −1) are never protected or held back: camps still wake, fight and
  pay bounty, and units fight them as usual.
- **Ground kept clear.** While the peace lasts nobody builds within `PEACE_BUILD_GAP` (20) empty
  tiles of an enemy Town Center, finished or still a site (`PEACE_ANCHOR`), so a rival cannot
  wall a base in, put towers on its doorstep or plant a camp beside it while attacking is
  off. The gap is the straight distance between the nearest tiles of the two footprints (0 when
  they touch), so the ground is a square around the Town Center with rounded corners, 44 tiles
  across. Only enemy Town Centers keep ground: not houses, towers or walls (any building would let
  a player creep a line of cheap ones across the map and claim it), not a teammate's, not your
  own (build as close to your own as you like). Rules: `peaceBlocksFootprint` in `src/sim/peace.js`
  (the footprint test shared with the client), `world.peaceBuildBlocks(i, tx, ty, size)` (the
  enemy Town Centers of player `i`, only while `world.peace` holds) and one line in
  `placementError`, so everything that places a building obeys it with the text above: a player's
  `build` and each tile of a wall line (tiles inside are left out like any tile that cannot be
  built on; the peace is the error when none can go up), a queued build when the worker arrives
  (cost refunded, 5.3), `findPlacement` and the AI (`canPlaceBuilding`), and the commands of a
  remote player, since the host's sim has the last word. When the peace ends the ground is free
  at once. Measured: starts of the generated maps are at least 62 tiles apart (small map, four
  players; 66 between enemies in a 2v2), and in four AI-vs-AI peace games of 20 minutes (small and
  medium maps, 2 to 4 players, Normal and Hard) no placement was ever refused for the peace, the
  nearest an AI building came to an enemy Town Center was 25 tiles, and every game played out
  exactly as with the rule switched off (same buildings, population and gold), so the AI's
  base and expansions never meet it; only a Town Center planted on purpose beside an enemy's does.
  Limits, kept on purpose: the rule is symmetric, so a Town Center planted just outside your 20
  tiles claims ground of its own that overlaps the strip between (no "older Town Center wins"
  rule); the refusal tells you a Town Center is within 20 tiles even if you have not seen it (the
  same leak as `Another building is in the way.`); a far chokepoint stays open to walls.
- The client shows the ground before the click (`src/game/placement.js` `checkFootprint` and
  `peaceAnchors`): the ghost's tiles inside it are red with the sim's text, from the enemy Town
  Centers the player has seen or remembers (`lastSeen`); one never scouted is refused only by the
  sim, which names the reason. While a building or wall line is placed the renderer tints the
  whole zone (`NoBuildZone` in `src/render/no-build-zone.js`: red, hatched, with a bright edge line
  on its rim; one mesh of tile quads on the terrain, rebuilt only when the known Town Centers
  change) and a tip by the cursor says why the ghost is red. A refused click shows the message
  and keeps the placement open. None of it is on the wire (no snapshot field or event).
- The peace ends at the start of the first tick with `time >= peaceEnd`: `world.peace` turns
  false and one `{ type: 'peaceEnd' }` event is emitted. There is no new snapshot field: clients
  derive the countdown from `setup.peaceMinutes` and the snapshot `time`
  (`ViewState.peaceLeft()`, rounded up to whole seconds on screen).
- AI: `scan` copies `world.peace` to `s.peace`. While it holds no wave leaves home (armies keep
  growing and mass at the rally point), threat and defence logic ignores other players, and
  focus fire only picks creatures. The first wave leaves as soon as the peace is over.
  Measured (seed 1, Normal vs Normal, small map, 30 minute peace): both sides reach 198–200 pop
  around minute 13 with 66–69 army units, no player-vs-player hit before 30:00, both waves leave
  at 30:01 and the first hit lands at about 30:25.
- Economy is unchanged. In that run the mines are mined out around minute 26–28 and each side
  still holds about 23 500 gold when the war starts, several times what the build-up cost, so
  mine sizes are not scaled for the mode. With no mines left the war is fought off that bank
  (one side was down to about 60 gold ten minutes in).

### 5.11 Sacred Sites (and Sacred Victory)
Neutral holy ground for every player to fight over, after Age of Empires IV's sacred sites. Every generated map
has 3 to 5 (`mapData.sacred`, 6.7); they exist in every game. Rules in `src/sim/sacred.js`, numbers in config.js.
- **Capture:** a Worshipper or Priest (`canCapture`: class `worker` or the Priest; not summoned) within
  `SITE_RADIUS` (3) tiles of a site's center captures it while no unit of a rival team stands there: a neutral
  site in `SITE_CAPTURE_TIME` (15 s); a rival's site is first torn down in `SITE_NEUTRALIZE_TIME` (10 s, `siteLost`)
  and then captured (`siteCaptured`). Units of two hostile teams at a site (any unit, soldiers too) freeze it
  (`contested`). Soldiers alone do not capture, but they hold their side's half-done capture; with nobody there
  a half-done capture fades at the capture rate. Teammates share a capture (the site goes to the first player of
  the team still there); a capture of another team's first has to fade. More capturers are not faster. A defeated
  holder lets go of its sites. During a Decade of Peace sites can be taken (standing is not harming).
- **Faith:** the holder gains `SITE_FAITH` (1) faith a second per site, shown in its faith rate (a full Shrine of 5
  praying Worshippers is 2.5).
- **Keep-out:** no building, wall or tower within `SITE_KEEP` (3) tiles of a site's center (`siteBlocksFootprint`,
  shared by `placementError` and the client's ghost): `Too close to a sacred site.`
- **Sacred Victory** (lobby toggle, `GameSetup.sacredVictory: true`): when every site is held by players of one
  team a countdown of `SACRED_HOLD` (480 s) starts (`world.sacred = { team, end }`, event `sacredHold`); losing any
  site stops it (`sacredBroken`); reaching `end` wins (`gameOver.how = 'sacred'`). No countdown runs while a
  Decade of Peace holds (guards that cannot be fought would make it unbreakable); it starts when the peace ends.
- **Placement** (`placeSacredSites` in mapgen, deterministic part): whole symmetry orbits, so every start is as
  near to the sites as every other: a site on the center when the middle is open ground (not a lake or camp), then
  an orbit between the starts (duel: two equidistant from both corners, or one on each corner's flank on a river
  map; 3–4 players: one between each pair of neighbouring corners; team layout: one on each side edge, between
  the teams), and stand-in orbits until there are 3 (4 on four-fold maps). Each needs open, footprint-free,
  reachable ground within `SITE_CLEAR` (3) tiles, at least `SITE_MIN_START_DIST` (16) from a start's Town Center,
  7 from a gold mine, 12 from a creep camp (9 if nothing fits) and 12 from another site; the search walks outward
  from the target and keeps the first tile whose every image qualifies.
- **Net:** snapshot `sites: [{ x, y, o, p?, c?, cn? }]` (holder, progress 0..1 rounded to 0.01, capturing player,
  contested) and `sacred: null | { tm, end }`; everyone sees every site's state (public, as in AoE IV). Events
  `siteCaptured { site, player }`, `siteLost { site, player }` (the former holder), `sacredHold { team, end }`,
  `sacredBroken { team }` are packed.
- **AI** (`src/ai/sacred.js`): from `pilgrimsFrom` (easy 6:00, normal 2:30, hard 1:40) up to `pilgrims` (1 / 2 / 3,
  +1 with Sacred Victory) gold or wood Worshippers walk to sites their team does not hold, the nearest first;
  normal and hard also take a rival's site when no rival soldier is within 8 tiles. A site with living creeps within
  9 tiles of the walk there is skipped, and one where a pilgrim died or gave up (90 s) waits 120 s. A pilgrim goes
  back to work once its team holds the site. When a rival team runs a Sacred Victory countdown the army leaves
  home (military mode `site`) for the nearest of their sites, with a pilgrim escorted in.
- **Client:** the 🛐 chip beside the clock (`src/ui/hud-sites.js`: sites held / total, and the countdown, green
  when it is your side's, red and pulsing when a rival's), alerts (9), the minimap diamond, the 3D site (8), the
  red ghost, How to Play, two tips, and the game-over line for a Sacred Victory.
### 5.12 Match statistics and score
Each player's `stats` (`newStats` in `src/data/score.js`, shared by the sim and the HUD) count:
`gathered` (gold + wood delivered) and the two apart (`gold`, `wood`); `faith` earned (prayer,
blessings, sacrifice spoils, resource spells, sacred sites; refunds do not count); `unitsTrained`; `kills` and
`losses` (units); `buildings` completed (walls excluded); `razed`, the finished enemy buildings
destroyed (walls excluded); `killValue`, the gold + wood + faith cost of the enemy units (not
summoned) and finished buildings destroyed, and `lostValue`, the same for one's own. The snapshot
adds `army`, the population in own fighting units right now (not worshippers, not summoned),
and floors `faith`. Bounties and plunder are income, not gathering.
- **Score** (`scoreOf`, Age of Empires style): economy `(gathered + faith) / 10`, military
  `killValue / 5`, civilization `100` per tier above Village and `25` per finished upgrade.
- Nothing here changes a rule; the numbers feed the after-game chronicle (section 9) and the alerts.

### 5.13 The guided first match (`src/sim/tutorial.js`)
A GameSetup with `tutorial: true` (built by `tutorialSetup({ name, version })`, started by the title
screen's Learn to Play, solo, no lobby) is the lesson of 9.2. Fixed: seed `TUTORIAL.seed`, the small map,
the learner as Greek on team 1 and a Norse AI "Raiders of the North" on team 2 with difficulty `'tutorial'`.
The World then (`tutorialStart`) gives the learner 600 gold, 300 wood and 100 faith, spawns no creep camps,
gives the raiders' Town Center 1200 health instead of 2000 and stands three Warriors and an Archer in front
of it. The `'tutorial'` AI (`src/ai/tutorial-ai.js`) sends its five Worshippers to its mine on its first tick
and does nothing else; its guards answer attacks like every unit. Every other rule is unchanged, so the
match stays a pure function of setup and commands. A scripted learner who does each objective as soon as
it can wins at 5:39 (tests/game/tutorial.test.js).

### 5.14 Trial of the Titans (survival game mode)
An optional game mode the host picks in the lobby (third button of the Game mode row; one mode at a time, so
picking it clears a Decade of Peace and the other two buttons clear it): `GameSetup.survival` is `true`. Every
player and AI plays on team 1 (`buildSetup`, and `World` forces it too), so one player alone may start it and the
lobby's team column reads "Together"; `mapOptions` passes one team to the map generator, so the bases stand side
by side in the team layout (6.7: two players share the top edge, a third and fourth the bottom edge). Rules live in `src/sim/survival.js` (the schedule helpers are shared with the
HUD) and run from `World.tick` (`updateSurvival`, before the units move):
- **The clock.** Wave n comes out at `SURVIVAL_FIRST_WAVE + (n − 1) × SURVIVAL_INTERVAL` game seconds (2:00, then every
  90 s), whether the last wave is beaten or not, so a slow defence is buried. Every `SURVIVAL_BOSS_EVERY` (5th) wave
  a hostile Titan of a random pantheon leads it.
- **What a wave holds** (`wavePlan`, deterministic from a `${seed}:survival` RNG): creatures of every pantheon worth
  `waveBudget(n, players) = round((4 + 3n + 0.08n²) × (0.6 + 0.4 × players))` population (60% of it on a boss wave;
  every wave larger than the last, and the step itself grows: 7 at wave 1, 42 at 10, 96 at 20 alone). Waves 1–2 are
  tier 1 only, tier 2 joins at wave 3 and tier 3 at wave 7; flyers stay out until wave 6 (the first Barracks has no
  archers yet) and are never more than a third of a wave. Health and damage grow every wave (`waveBoost`: ×1.33 /
  ×1.25 at wave 6, ×1.69 / ×1.52 at 11, ×3.27 / ×2.48 at 26) through `u.boost`, applied in `applyUnitStats`. The boss
  Titan has `bossBoost(n, players)`: health × n/10 × (0.7 + 0.3 × players) (half a Titan at wave 5 alone, a whole one at
  wave 10), damage × (0.6 + 0.04n). At most `SURVIVAL_MAX_ALIVE` (120) wave monsters live at once; a wave that would pass
  it comes smaller.
- **Where.** Every player still in the game with a building gets an even share of each wave (dealt out one monster
  at a time; the boss Titan goes at each player in turn), so nobody waits behind a teammate. A share comes out of the
  edge point nearest that player (two points from wave 10) of the eight around the map (corners and the middle of
  each side, 3 tiles in) that lie at least 30 tiles from every player building, as neutral (owner −1) units with no
  camp, so no leash, each with `u.waveTarget`. A share gets an attack-move on its player's nearest building (walls are
  broken through on the way, not hunted); once a second, any wave monster left with no order (its target fell, its
  fight is over) is sent on to its player's next nearest one, or anyone's once that player has none.
- **Pay.** Killing a wave monster pays the usual creep bounty. When the last monster of wave n dies, every player
  still in the game gets `waveReward(n) = 40 + 20n` gold once, with `{ type: 'waveCleared', n, gold }`.
- **The end.** Players fall as in 5.8 (no buildings left). Nobody wins: when the last player falls the game is over
  with `gameOver: { winningTeam: null, wave }`, the wave reached (the last that came out) as the score. Camps and the
  rest of the rules are unchanged.
- **Net.** The setup flag (validateSetup keeps it only when exactly `true` and there is no peace), a top-level
  snapshot record `sv: { w, m }` (waves out, wave monsters alive) that rides the delta's "everything else" keys, the
  `waveFront { n, player, count, x, y }` (one per share, just before), `wave { n, count, boss, x, y }` and
  `waveCleared { n, gold }` event shapes, and `gameOver.wave`.
- **Client.** `ViewState.survival()` → `{ wave, alive, next, nextBoss }` (next from the clock). A wave chip beside the
  game clock ("Wave 1 in 2:00", then "Wave 3 · 7 left · next 1:12"; gold when a Titan leads the next wave, pulsing
  in its last 10 s), an opening line, a "Wave n comes in 10 s" line, a banner (the whole wave), a line and a minimap ping for
  the local player's own share when a wave comes out (with the Titan's name and the summon sound on a boss wave), a gold line when one is beaten, a boss wave flashes the
  tab, and the music heats up. The end screen is titled "Wave n" with the best wave beside it.
- **Best wave.** The career (9.1) keeps it: the Game counts a finished trial with `CareerTracker.finish('survival',
  { wave })` (a trial left early counts with the wave it had reached, not as a loss), which raises `best.wave`; a
  trial is neither a win nor a loss, so the win rate leaves it out. The lobby line ("Your best: wave 12.") and the
  end screen ("A new best! Your old best was wave 9.") read `getCareer().best.wave`; two achievements, Hold the Line
  and Titans' Bane, ask for waves 10 and 20.
- **AI.** `scan` adds the living wave monsters to `s.enemyUnits`, so the usual threat and defence logic turns out
  against them and helps allies; with no rival players it never launches an attack.
  Measured (seeds 3 to 9, AIs only, with the steeper budget and shared waves): one Easy AI falls at wave 17 (26:27),
  one Normal AI at wave 20 (31:15), two Normal AIs at wave 23 (35:43), four Hard AIs at wave 24 (37:17).

### 5.15 Relics (src/data/relics.js, src/sim/relics.js)
Treasures of world myth that give creeping a reward beyond the bounty (WC3 items, Age of Mythology relics).
- **Where:** every creep camp of level `RELIC_CAMP_LEVEL` (2) or more guards one relic (4 or 5 on the usual
  maps; level 1 camps guard none). Types are drawn without repeats from the ten in `RELIC_LIST`, shuffled by an
  RNG seeded with `${seed}:relics` (the sim RNG is untouched, so nothing else in a game changes).
- **Dropping:** when the camp's last creature dies (`World.killEntity` calls `onCampMemberKilled`) the relic lies
  on the ground at the camp's centre and `{ type: 'relic', ev: 'drop', player }` names the killer's owner.
- **Carrying:** a smart order with `relic: index` sends the nearest unit that can carry (a Worshipper or a god of
  a player, not summoned, not already carrying one) to it; the rest of the selection walks along. Soldiers get
  `Only a Worshipper or a god can carry a relic.` A relic still guarded, or already taken, makes it a plain move.
  Picked up within 0.6 tiles (edge distance) (`ev: 'take'`), the carrier sets off at once for its owner's nearest
  finished Temple (an order `deliver`) unless more orders were queued; an idle carrier is sent there every
  10 ticks once a Temple stands. A carrier on its own finished Temple with a smart order delivers before it would
  pray or repair. Any player can take a relic from the ground, enemies included.
- **Resting:** next to the Temple it goes in (`ev: 'house'`) and its effects (the upgrade vocabulary of 4.3) are
  folded into the owner's mods: `computeMods(upList, pantheon, p.relics)` and `World.refreshMods(i)`, the same path
  as a researched upgrade, so every stat is applied at once. There is no limit per Temple.
- **Losing it:** a carrier that dies drops it where it fell; a Temple that falls drops what rested in it on its
  south side, and the owner loses the bonus (`ev: 'lose'`, player: the previous holder). A defeated player's
  relics fall with their last Temple.
  A relic on the ground under a building raised over it rolls to the nearest open tile (checked every 10 ticks).
- **The ten:** Golden Fleece (Greek, soldiers +10% health), Brísingamen (Norse, +25% Faith at Shrines and
  Temples), Eye of Horus (Egyptian, buildings +2 armor), Pot of Amrita (Hindu, gods regenerate +1.5 hp/s),
  Kusanagi (Japanese, Warriors and Archers +8% damage), Peaches of Immortality (Chinese, soldiers and creatures
  heal 0.5 hp/s), Smoking Mirror (Aztec, god and Titan abilities recharge 10% faster), Cauldron of the Dagda
  (Celtic, +2 gold and wood per trip), Tablet of Destinies (Mesopotamian, research and growing 20% faster), Box of
  Stories (West African, Worshippers work 10% faster). Each is a small, always-on edge, like a blessing (4.10).
- **Net:** the snapshot's `relics` list (6.3) changes only when a relic changes state (a carried one goes by its
  carrier's id, so walking costs nothing); the player record's `rl` lists the types resting in their Temples.
- **Shown:** a glowing jewel in a gold ring, tinted per relic, over the ground under a beam of light while it is
  guarded or free (brighter and pulsing once free), smaller over its carrier's head, circling over the Temple's
  roof once it rests there (src/render/relics.js); a gold diamond on the minimap; the cursor's hand over a free
  relic in sight; a relic chip at the top left ("1/5", the bonuses and where the others are in its tooltip); a
  chip on a carrier's selection panel and a Relics line on a Temple's; alerts when a camp I cleared drops one,
  when one comes to rest in my Temple or a rival's, and when I lose one. How to Play and a tip explain it.
- **AI:** `src/ai/relics.js` sends the nearest gathering or idle Worshipper for a free relic within 70 tiles of
  home once it has a finished Temple and no enemy stands within 10 tiles of the relic; the economy leaves a
  Worshipper on that errand alone (job `relic`). In AI-vs-AI games each side brought home two or three.

### 5.16 Campaign missions (`src/data/campaign.js`, `src/sim/campaign.js`)
A GameSetup with `campaign: '<mission id>'` (built by `campaignSetup(id, { name, version })`, started from the
chapter screen of 9.6, solo, no lobby) plays one mission of the campaign: Chapter I, "The Long Winter" (five
missions for the Greeks against Norse raiders), then Chapter II, "The Wolf Age" (five for the Norse against Loki),
in order (`CHAPTERS`, each mission carrying its `chapter` id and its number `n` in it; `MISSIONS` is all of them
in the order they open). The hero is always player 0; the mission's data fixes the seed, map size,
the computer players (name, pantheon, team, difficulty; `'tutorial'` is the sleeping camp of 5.13), whether creep
camps are spawned, and each side's start (`start[i]`: purse, a Town Center health in place of 2000, finished
buildings placed in front of the Town Center, some tagged, and units). The hero's Town Center is tagged `home`.
- Objectives (`kind`): `build` {type, count}, `gods` {count}, `army` {count}, `kill` {tag} (every unit an event
  spawned with the tag is dead), `destroy` {tag} (every start building with the tag has fallen), `protect` {tag}
  (fails the mission when every building with the tag has fallen), `survive` {seconds}, `hold` {count, seconds}
  (the hero's team holds that many sacred sites at once for that long without a break), `conquer`. `optional`
  ones are a bonus; `hidden` ones show once an event reveals them. Any but a protect one may carry a `limit` in
  seconds: still open then, it fails, and the mission with it (the panel shows the clock left). Judged once a second; a finished one stays
  finished.
- Events, in data order: `{ at: seconds }` or `{ after: objective id }`, with `say` (a line), `reveal`, and `spawn`
  `{ owner, tag, units, at, march, target, always }`: units in a line in front of the owner's Town Center (none if the
  owner is beaten, unless `always`: then from where that Town Center stood at the start, `cp.homes`), and with `march` sent by attack-move at the building tagged `target` or the hero's side's
  nearest building; idle marchers are sent again each second.
- The end (`gameOver.how: 'campaign'`): won when every objective that is neither optional nor a protect one is
  done, or when every enemy player is beaten (a conquest wins whatever is left undone, except what the
  mission's `waitFor` names: a story beat that must still happen, so that win waits until those objectives are
  done, and the mission plays on with no enemy left; `updateCampaign` then ends it); lost when a protect objective fails or the
  hero is beaten. The mission line-up (all checked by AI-only runs with a Normal AI as the hero, which wins all
  five; an Easy one wins the first three): Ashes on the Shore (build a Temple, summon a god, beat the raid that
  lands at 4:30), Burn the Longhouses (destroy three tagged Barracks of an Easy AI), The Narrow Pass (hold a
  tagged Temple ten minutes against six scripted waves, Spartans at 5:00), The Sacred Groves (hold three sacred
  sites for 2:00 against an Easy AI, frost trolls at 7:00), Twilight of the North (conquer a Normal Norse AI with
  an Egyptian ally; Surtr wakes at 14:00 and marches). Chapter II: The Wolf Winter (a Temple, a god, and a raid at
  4:30 that makes for the tagged winter stores, a Storehouse that must stand), The Last Link (destroy three tagged
  Shrines of an Easy AI within 15:00, Fenrir's wolves at 6:00), The Burning Bridge (hold a tagged Temple nine
  minutes against six waves, Valkyries for the hero at 4:30; `waitFor: ['hold']`: razing Helheim's town early
  does not win it, the clock still has to reach 9:00), The Ship of Nails (muster twelve soldiers, which
  reveals "burn the two tagged shipyards" of an Easy AI; a bonus for holding two sacred sites a minute), Ragnarök
  (conquer a Normal Norse AI with a Greek ally; Loki and four wolves walk at 13:00; `waitFor: ['loki']`: a host
  broken before then does not win it, Loki still comes, an `always` spawn from his beaten host's old seat, and
  must fall).

## 6. Simulation API (src/sim/)

```js
import { World, createWorld } from './sim/world.js';
const world = createWorld(setup);         // generateMap(setup) + new World(setup, mapData)
world.issueCommand(playerIndex, cmd);     // queued; applied at the start of the next tick
world.tick();                             // advance DT
const snap = world.getSnapshot();         // ViewSnapshot (6.3); includes and clears pending events
```

### 6.1 GameSetup
```js
{
  version: '0.1.0', seed: 12345, mapSize: 'small' | 'medium',
  landscape: 'highlands' | 'rivers' | 'islands' | 'forest', // optional (6.7): absent = the classic Wildlands; never 'random' (the host draws it)
  peaceMinutes: 30 | 45 | 60,  // optional, Decade of Peace (5.10): absent = a normal game
  sacredVictory: true,         // optional, Sacred Victory (5.11): absent = only conquest wins
  tutorial: true,              // optional, the guided first match (5.13); local only, never from a lobby
  survival: true,              // optional, Trial of the Titans (5.14): every player on team 1 against monster waves
  campaign: 'shore',           // optional, a campaign mission (5.16); local only, never from a lobby
  players: [ // dense, index = position in this array = start position index
    { index: 0, name: 'Austin', team: 1, pantheon: 'greek', color: '#d63a3a', kind: 'human', difficulty: null },
    { index: 1, name: 'AI (Normal)', team: 2, pantheon: 'norse', color: '#3a78d6', kind: 'ai', difficulty: 'normal' },
  ],
}
```

### 6.2 Commands (`world.issueCommand(playerIndex, cmd)`)
All unit ids must belong to `playerIndex`; invalid ids are dropped. `queue: true` appends
(shift-click) instead of replacing the current order, except that an open-ended order at the
end of the queue (gather, pray, hold, follow) is replaced by the queued one, as with a WC3/SC2
harvest order, and a Return Cargo there deposits and then runs it instead of resuming
gathering. `issueCommand` copies each command
through `normalizeCommand` (src/sim/commands.js): unknown types and malformed objects are
dropped, `units` becomes ≤ 512 distinct positive integer ids, x/y are clamped to the map, at
most 256 commands per player per tick are kept. An exception inside one command is caught and
counted in `world.perf.commandErrors`.
```js
{ type: 'move',       units: [ids], x, y, queue }
{ type: 'attackMove', units, x, y, queue }
{ type: 'attack',     units, target: id, queue }
{ type: 'smart',      units, x, y, target?: id, tx?, ty?, relic?: index, queue } // right-click; sim decides (below)
{ type: 'gather',     units, target?: mineId, tx?, ty? }          // mine or tree tile
{ type: 'pray',       units, target: buildingId }
{ type: 'returnCargo', units }
{ type: 'build',      units: [workerIds], building: typeId, tx, ty, queue, tx2?, ty2? } // footprint top-left tile; a wall type with tx2/ty2 is a line (5.3)
{ type: 'train',      building: id, unit: typeId }                // also creatures, gods, titan, revive
{ type: 'cancelTrain', building: id, index?, count? }  // take queue items back and refund them (5.4)
{ type: 'upgradeTier', building: id }
{ type: 'cancelBuild', building: id }                      // also takes a finished wall segment down (5.3)
{ type: 'upgradeWall', walls: [buildingIds] }             // wooden → stone on finished wall segments (5.3)
{ type: 'upgradeHouses', houses: [buildingIds] }          // each square of four Houses among them becomes a Manor (5.3)
{ type: 'repair',     units, target: buildingId, queue }   // on a construction site: help build
{ type: 'research',   building: id, upgrade: upgradeId }
{ type: 'autoRepair', on: bool }
{ type: 'trade',      to: playerIndex, res: 'gold'|'wood'|'faith', amount }   // team market (5.7)
{ type: 'autocast',   units, ability?: abilityId, on: bool }   // set autocast for one ability (or all) of own units
{ type: 'rally',      building: id, x, y, target?: id }
{ type: 'stop',       units }
{ type: 'hold',       units }
{ type: 'kill',       units }                                   // the Delete key: own units die, no killer (below)
{ type: 'cast',       unit: id, ability: abilityId, x?, y?, target?: id, queue }
{ type: 'godPower',   power: powerId, x?, y? }               // cast one of my pantheon's god powers (4.11); x / y for a strike
{ type: 'surrender' }
```
**smart** resolution: with `relic`, a free relic is picked up by the nearest carrier and the rest walk along
(5.15). Otherwise per unit: a relic carrier + own finished Temple → bring the relic in; enemy target → attack; worker + gold mine → gather; worker +
tree tile (tx,ty given or the clicked tile is forest) → gather wood; worker carrying cargo +
own drop-off → return cargo; worker + own unfinished building → help build; worker + own
damaged completed building → repair; worker + own completed Shrine/Temple → pray; otherwise ally target → follow (move to it); else move.
Units that cannot do the resolved action just move.

**kill** destroys the issuing player's own living units among `units` (another player's unit, a building and a
mine in the list are skipped) with `World.killEntity(unit, null)`: a normal death that has no killer. The `death`
event plays the death animation and sound, the unit's population is free at once, a loss is counted, a fallen god
stays in `fallen` to be revived at a Temple with its level, and its orders are cleaned up as in a fight (a paid
building is refunded, a prayer slot is freed). Nobody earns anything from it: no kill, no experience for gods or
soldiers, no plunder or sacrifice, no bounty. It works in a Decade of Peace and, like every command, not for a
defeated player or once the game is over.

Errors emit `{ type: 'error', player, message }` with these messages:
`Not enough gold.` `Not enough wood.` `Not enough faith.` `Not enough population. Build more Houses.`
`Population limit reached (200).` (the cap is already `POP_MAX`, so more Houses cannot help)
`Can't build there.` `Trees in the way.` `Another building is in the way.` `A gold mine is in the way.`
`Something is in the way.` `Too close to a gold mine.` `The wall is already there.` `Requires Town.` `Requires City.`
`Requires a <Building>.` (e.g. `Requires a Shrine.`) `Production queue is full.`
`Your settlement is already growing.` `You already have that god.` `You can only have 3 gods.`
`Your next god requires Town.` `Your next god requires City.` `You already have a Titan.`
`That ability is not ready.` `That ability unlocks at level N.` (N = the ability's `unlockLevel`)
`Target out of range.` `This Shrine is full.` / `This Temple is full.` (the building's name).
`That building is not damaged.` `Not enough gold to repair.` (wood / faith) `Already researched.`
`Already being researched.` `Requires <Upgrade name>.` (a line's earlier level, e.g. `Requires Work Songs.`)
`Select four Houses that stand together in a square.` `Those Houses do not make a square, two by two.`
`A House in the square is busy: wait for its research or upgrade to finish.`
`That House is being combined into a Manor.` (and `Not enough gold. Combined 1 of 2 squares.` when the purse
runs short part way) Trades: `Choose a teammate to send to.` `You can only send resources
to a teammate.` `That ally has been defeated.` `Send at least 20 gold.` (wood / faith)
`Choose gold, wood or faith to send.` `You cannot trade now.` Relics: `Only a Worshipper or a god can carry a relic.`

### 6.3 ViewSnapshot (`world.getSnapshot()`)
Short keys keep network deltas small. Numbers: positions rounded to 0.01, hp to integers.
```js
{
  tick, time,                 // time in seconds
  players: [{ i, name, team, pantheon, color, kind, gold, wood, faith, faithRate, pop, popCap,
              tier, defeated, gods: [typeIds alive], fallen: { typeId: level }, titan: bool,
              up: [upgradeIds researched, in order], ar: bool (Auto-Repair on),
              rl?: [relic types resting in their Temples] (5.15; omitted when none),
              stats: { gathered, gold, wood, faith, unitsTrained, kills, losses, buildings, razed, killValue, lostValue, army }, // 5.12
              gp, gb? }],               // god powers (4.11): gp bit i = the tier i+1 power is spent; gb = boons running [[stat, pct, seconds left]]
  entities: [EntityView],
  fields: [{ id, x, y, r, el, rem }], // active ground zones: radius, element, remaining seconds
  reveals: [{ x, y, r, tm, rem }],    // ability reveals: sight circle for team tm, remaining seconds
  relics: [{ i, t, s, x?, y?, c?, b?, o? }], // 5.15: index, type, state 'k' guarded | 'g' on the ground (x, y)
                              // | 'c' carried (c: carrier id, o) | 'h' resting in a Temple (b: its id, o)
  events: [Event],            // since the previous getSnapshot()
  felled: [[tx, ty], ...],    // trees felled since the previous getSnapshot()
  sites: [{ x, y, o, p?, c?, cn? }], // sacred sites (5.11): holder, capture progress, capturing player, contested
  sacred: null | { tm, end },  // Sacred Victory countdown: the team holding every site, the game time it wins at
  gameOver: null | { winningTeam, how?, wave? }, // how: 'sacred' for a Sacred Victory; wave: the Trial of the Titans' score (5.14)
  sv,                         // Trial of the Titans only: { w: waves out so far, m: wave monsters alive }
  cp,                         // a campaign mission only (5.16): { o: per objective [state 0 open 1 done 2 failed, value, shown 0/1], h: seconds held, at: [x, y] | null }
}
EntityView = {
  id, k,          // 'u' unit | 'b' building | 'm' gold mine
  t,              // type id
  o,              // owner index (-1 neutral)
  x, y, f,        // position, facing
  hp, mhp, sh,    // hp, max hp, shield
  st,             // 'idle'|'move'|'attack'|'gather'|'return'|'build'|'pray'|'cast'
  tg,             // current target entity id or 0
  // units:
  c,              // carrying: 0 | 'g' | 'w'
  lv, xp,         // gods: level and xp. Soldiers (5.9): xp once they have earned 1, and rk (rank 1..3) once promoted. Else omitted
  cd,             // { abilityId: secondsRemaining } (only abilities on cooldown)
  fx,             // status codes: subset of ['stun','slow','shield','invuln','buff','debuff','dot']
  ex,             // seconds until a summoned minion expires (omitted if permanent)
  mc,             // player units: abilities set to manual, bit i = def.abilities[i] (omitted when all autocast)
  bo,             // pending build order for workers: { b: typeId, tx, ty } (omitted otherwise)
  mw,             // 1 while a worker waits its turn at a gold mine (all MINE_SLOTS taken); omitted otherwise
  tk,             // workers: task 'gold'|'wood'|'pray'|'build'|'repair'|'idle'|'other' (HUD task counts)
  // buildings:
  tx, ty,         // footprint top-left tile
  bp,             // build progress 0..1 (1 = complete)
  q,              // queue [{ u: typeId | 'tier_up' | upgradeId, p: 0..1 }], up to MAX_QUEUE items (first item progressing; a wall segment's stone upgrade is { u: 'stone_wall' })
  tr,             // town center tier 1..3
  pr,             // praying worshipper count
  rp,             // rally [x, y] or null
  // mines:
  amt,            // gold remaining
  mn,             // workers mining it right now (0..MINE_SLOTS)
}
```
### 6.4 Events
```js
{ type: 'attack',  src, dst, ranged: bool }                          // a swing/shot starts
{ type: 'projectile', src, dst, kind, el, fx, fy, tx, ty, flight }  // flight seconds
{ type: 'hit',     dst, amount, src }
{ type: 'death',   id, t, o, x, y, k }                               // k: 'u' | 'b'
{ type: 'cast',    src, ability, x, y, target }
{ type: 'effect',  el, shape, x, y, r, fx?, fy?, points?, duration, src, ability, delay? }
                   // VFX request; fx/fy for lines, points for chains, delay (s) when > 0
{ type: 'bounty',  player, amount, x, y, res? }                      // creep-kill gold; res 'g' | 'f' for plunder gold / sacrifice faith
{ type: 'spawn',   id, t, o }                                        // unit trained/summoned/revived
{ type: 'construction', id, t, o }                                   // building placed
{ type: 'buildingComplete', id, t, o }
{ type: 'tierUp',  player, tier }
{ type: 'researched', player, up }                                   // a building upgrade finished
{ type: 'trade',   from, to, res, amt, got }                         // team market transfer (amt sent, got received)
{ type: 'relic',   ev, i, t, player, x, y }                          // 5.15: ev 'drop' (camp cleared by player) | 'take' | 'house' | 'lose'
{ type: 'levelUp', id, level }
{ type: 'rankUp',  id, rank }                                        // a soldier reached a new rank (5.9)
{ type: 'treeFelled', tx, ty }
{ type: 'resourceDepleted', id }
{ type: 'error',   player, message }
{ type: 'underAttack', player, x, y, id }                            // throttled 10 s per player
{ type: 'titanSummoning', player, t }                                // broadcast drama
{ type: 'playerDefeated', player }
{ type: 'peaceEnd' }                                                 // the Decade of Peace is over (once)
{ type: 'siteCaptured', site, player }                               // sacred site index taken (5.11)
{ type: 'siteLost', site, player }                                   // the holder lost it (torn down or defeated)
{ type: 'sacredHold', team, end }                                    // Sacred Victory countdown starts
{ type: 'sacredBroken', team }                                       // ... and stops
{ type: 'wave',    n, count, boss, x, y }                            // Trial of the Titans: wave n came out at (x, y); boss = Titan type or ''
{ type: 'waveCleared', n, gold }                                     // every monster of wave n is dead; each survivor got gold
{ type: 'campaignSay', e }                                           // a campaign mission's event e has a line to show and say (5.16)
{ type: 'objective', i, s }                                          // objective i was finished (s 1), failed (2) or revealed (0)
{ type: 'gameOver', winningTeam, how? }                              // how: 'sacred' (5.11) or 'campaign' (5.16)
{ type: 'godPower', player, power, x, y }                            // a god power was cast (4.11); x, y = its spot (a blessing: the caster's Town Center)
```

### 6.5 Read API (for AI and tests)
`world.entities: Map<id, Entity>` (internal objects, read-only for outsiders),
`world.players[i]` (gold, wood, faith, tier, team, pantheon, popUsed, popCap, defeated, fallen),
`world.map` (MapState: `width, height, terrain, inBounds(tx,ty), isPassable(tx,ty)` (ground),
`isBuildable(tx,ty)`, `isForest(tx,ty)`, `woodAt(tx,ty)`, `nearestForest(x, y, maxR)`),
`world.tickCount`, `world.time`, `world.rng`, `world.getEntity(id)`, `world.unitsOf(i)`,
`world.buildingsOf(i)`, `world.queryRadius(x, y, r, filter)`, `world.areEnemies(a, b)`
(owner indices), `world.canPlaceBuilding(i, typeId, tx, ty)`,
`world.placementError(i, typeId, tx, ty)` → the refusal text (5.3: `"Can't build there."`, `"Trees in the way."`,
`"Another building is in the way."`, `"A gold mine is in the way."`, `"Something is in the way."`,
`"The Decade of Peace holds for another m:ss: no building near an enemy Town Center yet."`, `"Too close to a sacred site."`,
`"Too close to a gold mine."`) `| null`, `world.peaceBuildBlocks(i, tx, ty, size)` (5.10: is that
footprint within `PEACE_BUILD_GAP` of an enemy Town Center while the peace holds),
`world.findPlacement(i, typeId, nearX, nearY, maxR)` → `{tx, ty} | null`,
`world.canAfford(i, cost)`, `world.hasBuilding(i, typeId, completedOnly = true)`,
`world.isGameOver()`, `world.winningTeam`.
Internal entity fields (also used by AI): `id, kind ('unit'|'building'|'mine'), type, owner,
x, y, hp, maxHp, state, order, carry, level, xp, cooldowns, constructed, buildProgress, queue,
tx, ty, size, amount`.

### 6.6 Visibility
`src/sim/visibility.js`: `computeVisibility(width, height, sources /* [{x, y, r}] */, explored /* Uint8Array, mutated */)`
→ `Uint8Array visible` (1 = visible). Circles, no line-of-sight blocking. Used client-side.

### 6.7 Map data (`src/sim/mapgen.js`)
`generateMap({ seed, mapSize, playerCount, teams, landscape })` → pure deterministic function (same input → identical output in every browser and in Node).
**Landscapes** (`src/data/landscapes.js`, picked in the lobby): every landscape keeps the same
fair base layout (starts, start mines, wood line behind each base, expansions, camps, sacred
sites); only the ground between the bases changes, drawn from noise fields averaged over the
symmetry orbits so every start sees the same ground. `classic` (shown as **Wildlands**, the
default and the original generator, byte-for-byte unchanged), `highlands` (two-tile rock ridges
along two contour lines of a smooth field, open moors with less forest, rock raised higher in the
cosmetic heights; lanes and the connectivity pass cut the passes), `rivers` (three- to four-tile
rivers along one contour line, no side lakes; where a lane crosses, its carve leaves a sandy ford),
`islands` (sea everywhere except an island under each base, expansion, camp and the center plus a
few noise islets; the lanes become sandy land bridges) and `forest` (Great Forest: about 60% of the
free ground is woods and the lanes are narrower). Ridges and rivers thin out near bases,
expansions and camps. The lobby may also hold `'random'`, which `buildSetup` resolves from the
seed (`resolveLandscape`) so the GameSetup always names a concrete landscape; the classic one is
left out of the setup. When the usual sacred-site spots are taken on a new landscape the search
widens over the rest of the map. `meta.landscape` names it. Preview: `node tools/map-preview.mjs
--landscapes highlands,islands --sheet`; in 3D: `tools/render-harness.html?landscape=islands`.
`mapOptions(setup)` builds these options from a GameSetup (`teams` = each player's team); host,
clients, World and the lobby's `mapHash` all use it, so teammates are grouped identically everywhere.
**Start positions** (`startPlan(playerCount, teams)`): 1–2 players and free-for-all use the
classic corners (2: top-left / bottom-right; 3: top-left, bottom-right, top-right; 4: top-left,
bottom-left, top-right, bottom-right). When a team has two players (2v2, 2v1, 2v1v1, co-op 2 vs 2)
the **team layout** is used: 180° symmetry, two bases along the top edge (about 27% in from each
side) for the larger / first team and their mirror images along the bottom edge for the rest,
so teammates start about 0.46 map widths apart and the nearest enemy about 0.67; each side gets a
natural per base on its side edge and a shared expansion between its two bases (no river). In
the 2v1 the spare bottom-left base becomes a rich expansion. A team of three (3v1) takes three
neighbouring corners in order (top-left, top-right, bottom-right) and the lone player the last.
Every player on one team (2 to 4 players, the Trial of the Titans, 5.14) also takes the team layout,
in player order (top-left, top-right, bottom-right, bottom-left); spare bases become rich expansions.
`meta.layout` is `'corners'` or `'teams'`.
```js
{
  width, height, seed,
  terrain: Uint8Array(w*h),        // TERRAIN codes from config
  heights: Float32Array((w+1)*(h+1)), // cosmetic vertex heights, render only (water ≈ -0.6, land 0..0.8); the renderer turns them into a smooth ground field (section 8)
  wood: Uint16Array(w*h),          // TREE_WOOD on forest tiles, 0 elsewhere
  starts: [{ x, y }],              // town center footprint top-left per player (playerCount entries)
  mines: [{ tx, ty, amount }],     // 3×3 footprint top-left; first `playerCount` are the start mines (same order as starts)
  camps: [{ x, y, level }],        // neutral creep camps (level 1–3)
  sacred: [{ x, y }],              // sacred site centers (5.11), whole symmetry orbits
  decor: [{ x, y, kind, rot, scale }], // render-only: 'rock'|'bush'|'flowers'|'ruin'|'stump'|'grass'
}
```

## 7. Networking (src/net/)

- **Host-authoritative.** The host browser runs `World` and the AIs. Clients send commands
  and receive delta snapshots every tick; they never simulate.
- Transports (`src/net/transport.js`) share one connection interface:
  `conn = { id, send(msg), onMessage(cb), onClose(cb), close() }`.
  - `peer` (PeerJS): host peer id = `PEER_ID_PREFIX + roomCode`; room code = 5 chars from
    `ROOM_CODE_ALPHABET`, regenerated if the id is taken. Default broker: the public PeerJS
    cloud (0.peerjs.com:443, path '/', secure) with ICE = Google + Cloudflare STUN + the PeerJS
    public TURN (eu-0/us-0.turn.peerjs.com:3478). URL params: `?turn=url1,url2&turnUser=&turnPass=`
    adds a TURN server, `?relay=1` forces relay-only ICE, `?peerHost=&peerPort=&peerPath=&peerSecure=0|1`
    selects a self-hosted broker (then no PeerJS TURN; tests use a local `peer` server).
    Invite links carry these params.
  - `local` (BroadcastChannel `mythicwar-<code>`, `?transport=local`): two tabs in one browser (testing).
  - `loopback` (in-memory pair) for Node tests.
  - Join errors (`PEER_MESSAGES`, transport.js): broker unreachable within `JOIN_TIMEOUT_MS`
    (15 s) → "Couldn't reach the matchmaking server (host). Check your internet connection and
    try again."; data channel not open within `CONNECT_TIMEOUT_MS` (15 s), ICE failed or channel
    error → "Couldn't connect to the host. You may be behind a strict firewall; try another
    network."; unknown room → "Room X was not found. Check the code and that the host is still
    in the lobby."
- **Frames and liveness** (protocol.js, transport.js): JSON frames, large messages split into
  chunk frames `~id,index,count|payload` (`CHUNK_SIZE` 16000, at most 64 KB each), heartbeat
  `h` every 2 s when idle, `b` on a clean close. Silence is counted in time the page actually
  ran: each heartbeat pulse adds at most `MAX_PULSE_GAP_MS` (1 s), any received frame resets it,
  so a main-thread stall or background tab never times a peer out before its queued messages
  are read. Timeout: `TIMEOUT_MS` 15 s in the lobby, `GAME_TIMEOUT_MS` 30 s in game
  (`conn.setTimeoutMs`, sessions' `connTimeoutMs`). A client that has heard nothing from the
  host for `STALL_NOTICE_MS` (3 s) reports it (`ClientSession.stalledMs` / `stalled`) so the HUD
  can say so long before the 30 s timeout; its ping figure then reads "…". On the host,
  a client whose data-channel send queue (`conn.buffered`) is over `MAX_CLIENT_BUFFER_BYTES`
  (128 KB) is skipped for that tick instead of queueing more: the next delta is encoded
  against what it last received, so it catches up in one step, with the skipped snapshots'
  events and felled trees carried over (a full snapshot, once the queue drains, if too many).
- **Untrusted input**: a reassembled message may be at most 1 MB from a client and 32 MB from
  the host; more than 100 malformed frames in 10 s closes with 'protocol-error'. Token buckets
  per client (rate/s, burst): in game `cmd` 40/80, `chat` 1/5, `ping` 4/8, `mark` 1.5/5 (`MARK_RATE`),
  `resync` at most one per second (deferred); in the lobby `lobby` patches 5/10, `chat` 1/5, `ping` 4/8, one `hello`.
  The host rebuilds every client command from a whitelist (src/net/sanitize.js: 20 types, typed
  fields, unit lists deduped and capped at 256, coordinates clamped, type ids own keys of the
  data tables, `player` never from the client). Names ≤ 20 and chat ≤ 200 code points with
  control/bidi characters stripped. Clients validate what the host sends: lobby states, the
  GameSetup (else kicked with "invalid game setup"), snapshots (`isValidSnapshot`), deltas
  (apply failure → `resync`), chat, and end/kick reasons (≤ 300 chars, else 'host-quit').
- Messages are JSON objects with `t`:
  - client→host: `hello {name, version}` (`version` is `PROTOCOL_VERSION` from
    src/net/wire-version.js: `GAME_VERSION` plus an 8-digit fingerprint of the message names,
    `EVENT_SHAPES`, the command whitelist, the team mark kinds and the unit / building / ability /
    pantheon ids, and of the rules themselves (every value in the data tables and config, so a balance
    change alone also marks older replays as from another build), so a stale tab after a deploy is refused with the "Version mismatch" text; it is
    only ever compared as a string), `lobby {patch}`, `cmd {cmd}`, `chat {text}`, `ping {ts}`,
    `mark {kind, x, y}`, `resync {}`
  - host→client: `welcome {slot, lobby}`, `lobby {lobby}`, `start {setup, you}`, `full {snap}`,
    `delta {d}`, `chat {from, name, text, system, voice?}` (`voice: true` marks a computer player's line, 10.1), `pong {ts}`, `mark {from, kind, x, y}` (to the sender's
    teammates only), `kick {reason}`, `end {reason}`
- **Team marks** (pings and markers, 9): a mark is a signal, not world state, so it never rides in a
  snapshot (snapshots go to everyone). The kinds are the table `MARKS` in `src/data/marks.js`. The sender's
  session shows its own mark at once (`onMark` fires with `from` = me, a local echo) and sends `mark {kind, x, y}`.
  The host takes it through the client's `mark` bucket, rebuilds it with `sanitizeMark` (a kind that is an own
  key of `MARKS`, a finite spot clamped to the map and rounded to a hundredth of a tile; anything else counts as
  invalid) and `relayMark`s `mark {from, kind, x, y}` with `from` always the connection's own player index, never
  a field of the message, to the open connections of the sender's teammates (same `team` in the setup) and
  nobody else, and to its own screen when the host is on that team. Other teams' connections never receive it,
  so an enemy client learns nothing from the wire; a player alone on a team marks for themselves only. A client
  shows a relayed mark only when `from` is an integer other than itself, on its own team, and the spot
  sanitizes, and drops more than `CLIENT_MARK_LIMIT` (8/s, burst 20) from a flooding host. A player sends at most
  `MARK_SEND_RATE` (1/s, burst 4, in `Game.sendMark`), a little under the host's bucket so a mark the sender saw
  go up is never one the host silently dropped; past it the HUD says "Slow down: too many pings." A client's mark
  that reaches the host before the match has started is ignored.
- Delta codec (`src/net/delta.js`, wire format v2; the header comment lists every key): host
  keeps the last snapshot sent to each client and sends only changes: movement as integer
  hundredth deltas in flat columns (`m`, `mf` with facing), other changed or added EntityView
  fields as per-path columns `c` (dotted paths into nested objects), removed keys `cr`, a
  whole-value fallback `cx`, new entities in full, removed ids, players when changed, events
  packed by shape (`EVENT_SHAPES` order is wire format), felled trees; `tick` is omitted when
  it is the previous one + 1. Exact: `apply(prev, encode(prev, next))` deep-equals `next`, so
  new EntityView keys need no codec change. About 13–14 KB/s per client on average in an
  18-minute 4-AI game (`node tools/net-bandwidth.mjs`). A production queue (`q`, up to 50 items) travels
  as any array of one shape does: a tick of progress is only the column `q.0.p` (about 20 bytes), while a
  change in its length resends the whole array (a 50-item queue is about 1.2 KB, so a unit queued or
  finished costs 1.3–1.5 KB for that building) and a full snapshot carries each queue whole. Queued
  units count against the population cap, so all queues of one player together hold at most `POP_MAX`
  items (about 5 KB of a full snapshot). Order is guaranteed (reliable
  channel). `resync` → host sends `full` (also includes `felledAll`, every tree felled so far).
- Lobby (`src/net/lobby.js`):
  ```js
  const host = await LobbyHost.create({ transport: 'peer'|'local'|'none', name });
  host.roomCode; host.state; host.onChange(cb); host.setSlot(i, patch); host.applyPreset('coop'|'1v1'|'2v2'|'ffa');
  host.setMapSize('small'|'medium'); host.setPeace(0|30|45|60); host.canStart(); host.onChat(cb); host.sendChat(text);
  const { setup, myIndex, conns } = host.start(); // conns: Map<playerIndex, conn>; resolves 'random' pantheons with the seed
  const client = await LobbyClient.join({ transport, roomCode, name });
  client.state; client.mySlot; client.onChange(cb); client.setMine({ pantheon, team, color });
  client.onStart(cb({ setup, myIndex, conn })); client.onKicked(cb(reason)); client.onChat(cb); client.sendChat(text);
  ```
  LobbyState: `{ roomCode, mapSize, landscape (a landscape id from 6.7 or 'random'; `LobbyHost.setLandscape`), peace (0 = standard game, or 30 | 45 | 60 for the Decade of Peace, 5.10), sacred (bool, Sacred Victory, 5.11; `LobbyHost.setSacred`; off in a trial), survival (true for the Trial of the Titans, 5.14; never beside a peace), slots: [4 × { kind: 'host'|'human'|'ai'|'open'|'closed', name, pantheon ('random' allowed), team (1–4), color (index into PLAYER_COLORS), difficulty ('easy'|'normal'|'hard'|'brutal'), peerId }] }`.
  Presets: `coop` = humans team 1 + AI Normal on team 2 filling remaining slots (2 humans vs 2 AI on medium);
  `1v1` = 2 slots, teams 1/2, small map; `2v2` = teams 1,1,2,2; `ffa` = each its own team.
  A preset lays out slots and map size only: `peace` stays as the host set it, and `buildSetup`
  turns it into `setup.peaceMinutes` (only a length `PEACE_LENGTHS` offers; `sanitizeLobbyState`
  and `validateSetup` drop anything else on the clients).
  Can start when ≥ 2 teams have players and every human slot is connected. `state.preset`
  stays lit through pantheon / color / name edits and players joining or leaving, and clears
  when a slot's kind, team or AI difficulty changes. In the GameSetup, repeated names get a
  number (`AI (Normal)`, `AI (Normal) 2`); lobby slots keep theirs. `LobbyClient.join` and
  `joinRoom` take an optional `signal` (AbortSignal): aborting rejects with `abortError()` and
  closes the half-open link. Closing the lobby after the start also closes any game connection
  still open one second later (a game that failed to load must not leave players hanging).
- Sessions:
  - `HostSession({ setup, myIndex, conns, createWorld, createAI })`: owns the World, runs the
    ticker (`src/net/ticker.js`, a Worker-driven metronome so ticks keep running in a background
    tab, with catch-up capped at 5 ticks), applies `cmd` messages as
    `world.issueCommand(slotOfConn, cmd)`, ticks AIs, pushes each snapshot into its local
    `ViewState`, sends deltas. A client that disconnects is played by a stand-in AI at the game's
    difficulty (`standInDifficulty`: the hardest computer player of the setup, Normal in a game of
    people only), created with `{ standIn: true }` so that it fights, gathers, builds and trains but
    casts none of the player's god powers and sends none of their resources to allies (10), and a
    system chat line says so ("An AI (Hard) plays for them until they rejoin, and keeps their god
    powers for them."). Single-player = HostSession with no conns.
  - Rejoining (`src/net/rejoin-ticket.js`, `LobbyHost.handleRejoin`, `HostSession.rejoin`,
    `LobbyClient.rejoin`): the lobby's `start` gives each client a secret `rejoin` token, which the
    client's browser keeps (localStorage `mythicwar-rejoin`: room code, token, seat, transport; six
    hours at most, dropped at game over or when the host refuses it). The room's endpoint stays open
    for the whole game. A connection after the start that says HELLO with a known token is handed to
    the game's session (`lobby.setRejoinHandler`, set by the Game): the stand-in AI gives the seat
    back (or a link of that player still open is replaced, its window told `REPLACED`), and the
    client gets `start` again and a full snapshot (the client keeps its career tally with the ticket,
    `saveTally`, and what it has seen, the fog explored and enemy buildings and mines as last seen, every
    10 s under `mythicwar-rejoin-view` with `saveView`, put back on rejoin; a quit it counted settles `rejoin:<token>`, so a rejoin neither recounts nor resets it); its new link may stay silent for
    `REJOIN_GRACE_MS` (120 s) while it builds the game, until three pings arrive. Anyone else is told
    the game has started. Refused: the host's seat, a computer player's, a finished game. The title
    screen shows Rejoin Online Game while a ticket is kept; the Game Ended screen after a lost link
    offers Rejoin Game. A host that leaves ends the game (nothing to rejoin). Check:
    `tools/rejoin-check.mjs` (two tabs, a reload mid-game).
  - `ClientSession({ setup, myIndex, conn })`: decodes full/delta into its `ViewState`;
    `sendCommand(cmd)` → `{t:'cmd', cmd}`; `ready` (promise, first full snapshot), `pingMs`,
    `stalledMs` / `stalled` (host silent for `STALL_NOTICE_MS`), `mapMismatch` (setup `mapHash` differs from the locally generated map). `onEnd({ reason })`:
    'host-left' (connection lost), 'host-quit', 'game-over', or the host's sanitized reason.
  - Both: `{ setup, myIndex, mapData, viewState, sendCommand(cmd), sendChat(text), sendMark({ kind, x, y }), onChat(cb), onMark(cb), onEnd(cb), start(), stop() }`
    (`sendMark` returns the clean mark or null; `onMark(cb({ from, name, kind, x, y }))` hears teammates' marks and my own).
- `ViewState` (`src/game/view-state.js`, used identically on host and client):
  ```js
  const vs = new ViewState({ setup, mapData, myIndex });
  vs.pushSnapshot(snap, nowMs);  // full ViewSnapshot
  vs.update(nowMs);              // interpolates: sets e.ix, e.iy, e.if on every entity (render ~INTERP_DELAY_MS behind)
  vs.entities  // Map<id, EntityView + {ix, iy, if}>
  vs.players, vs.me, vs.myIndex, vs.myTeam, vs.tick, vs.time, vs.fields, vs.gameOver
  vs.map       // mapData; felled trees set to GRASS, wood 0
  vs.visible, vs.explored // Uint8Array w*h for my team (recomputed each snapshot via computeVisibility)
  vs.isVisibleAt(x, y); vs.isExplored(tx, ty)
  vs.lastSeen  // Map<id, EntityView> of enemy buildings seen before (shown under fog)
  vs.on(type | '*', cb) → unsubscribe  // fired for every event in each pushed snapshot; also 'snapshot'
  vs.getEntity(id)
  vs.peaceLeft(); vs.peaceActive(); vs.canHarm(owner) // Decade of Peace (5.10): setup.peaceMinutes vs the snapshot time; may my units hurt this owner now
  vs.survivalActive(); vs.survival() // Trial of the Titans (5.14): { wave, alive, next, nextBoss } from snapshot.sv and the wave clock, or null
  vs.sites; vs.sacred; vs.sacredVictoryOn(); vs.sacredLeft(); vs.sitesHeld(team) // Sacred Sites (5.11): map.sacred until the first snapshot
  ```
  Host local view uses a 50 ms delay; clients use `INTERP_DELAY_MS`.

## 8. Rendering (src/render/)

Three.js scene owned by `GameRenderer` (`src/render/game-renderer.js`):
```js
const r = new GameRenderer(canvas, { viewState, setup, quality: 'low'|'medium'|'high'|'ultra' }); // default 'medium'
r.update(dtSeconds);   // sync meshes from viewState (interpolated positions), animate, VFX from events
r.render(rafTimestamp); // the timestamp feeds adaptive resolution (optional)
r.resize(w, h);
r.camera              // CameraController: target {x, y}, pan(dx, dy) tiles, zoomBy(steps), centerOn(x, y), getViewQuad() → 4 {x,y} ground corners,
                       // setFree(pose | null): an orbit pose {x, y, dist, pitch, yaw, lift, fov} read every update (the intro film, 11.1)
r.screenToWorld(sx, sy) → {x, y} | null      // ground point (raycast vs terrain)
r.pickEntity(sx, sy) → id | null             // visible entity under the cursor (projected-position pick, buildings by footprint)
r.entitiesInRect(x0, y0, x1, y1) → [ids]     // units whose projected position is inside the screen rect
r.worldToScreen(x, y, h = 0) → { sx, sy, onScreen }
r.setSelection(ids); r.setHover(id | null);
r.showPlacement(buildingTypeId, tx, ty, valid, tiles?); r.showWallLine(wallTypeId, tiles); r.hidePlacement();
r.showCommandMarker(x, y, 'move' | 'attack' | 'gather');
r.showFloatingText(x, y, text, color?, h?); r.setShowAllBars(on); r.setQuality(q); r.getStats();
r.dispose();
```
`pickEntity` first syncs building and mine views to the latest snapshot, so a building placed
between two frames is clickable at once. Units coming into sight are built within a 3 ms
per-frame budget, so a revealed army appears over a few frames.
- Models: `src/render/models/unit-models.js` exports `buildUnitModel(unitType, teamColor) → UnitModel`
  (`{ root: THREE.Group, height, animate(state, timeSec, dt, extra) }`, where `state` is the
  EntityView `st` plus `'dead'` for the death animation; `extra = { moving, attackPhase (0..1 after an attack event), level }`)
  and caches geometry/materials per unit type (the cache key includes the visual, so a pantheon's dressed
  mortal is a template of its own). `src/render/models/unit-looks.js` `unitLook(unitType, pantheonId)`
  returns the shared mortal with its pantheon's `looks` laid over the visual; `createUnitView` is the one
  place that picks the model for a unit. `src/render/models/building-models.js` exports
  `buildBuildingModel(buildingTypeId, pantheon, teamColor, tier) → { root, height, setProgress(bp) }`
  and `buildGoldMineModel()`. `src/render/models/props.js` exports tree instancing helpers
  (`createForest(mapData, heightFn)` → `{ object3d, fell(tx, ty) }`), `createDecor(mapData, heightFn)`;
  `src/render/models/ground-cover.js` exports `createGroundCover(mapData, heightFn, { quality })`
  (instanced grass and flowers, none on low).
- Joined parts (`buildJoined` in unit-models.js): a low-poly unit's rigid parts (torso, head, arms,
  legs, a creature's body and wings) are one skinned mesh, each vertex bound with full weight to the
  bone of its part, so a unit is one draw call (and one in the shadow pass) instead of five or six.
  The part objects stay what the animation poses (unit-anim.js); `syncJoined` turns their transforms
  in the rig into the bone matrices after each `animate`, so frames where a unit does not animate cost
  nothing. Joint morphs (knees, elbows, wings, waves) are slots of the joined geometry per (part, morph);
  a part's `morphTargetDictionary` points into the mesh's shared influences, so `inf` / `hinge` work
  unchanged. A worker's tool arms are extra bones on the right arm's slots, the one not in hand with a
  zero matrix. The slot count is padded to a multiple of 4 so the layouts share a few shader programs.
  Ghost parts keep their own transparent mesh; single-part bodies (serpents, birds, dragons) are drawn
  as before. Part objects with nothing to carry (no ghost mesh, no cargo below them) stay out of the
  scene graph. Late battle at the population cap, densest crowd at default zoom, draw calls stubbed
  out (`node tools/perf-late.mjs --focus --stub-draws --warm 10`): Medium 853 to 485 draw calls,
  render() 10.2 to 6.1 ms of JavaScript and renderer update 1.5 to 1.65 ms; Low 650 to 282 calls,
  render() 5.3 to 3.8 ms. The frames are pixel-identical. High and Ultra draw rich characters and barely change.
- Rich characters (high / ultra only; `GameRenderer.unitDetail()` / `detailFor(pantheon)`): humanoids and
  giants with a human head (`richSupported(unitType)`, `src/render/models/rich-humanoid.js`) are one
  skinned mesh on a 23-bone rig instead of rigid low-poly parts: lofted smooth bodies, layered garments,
  beveled weapons and shields, faces, baked AO (`rich-kit.js` MeshKit, `rich-gear.js`), moved by
  `rich-anim.js` from the same pose keys as the low-poly rig plus spine, head, foot, cape and hair
  motion. Low and medium keep the low-poly models. Only the pantheons in `RICH_PANTHEONS` have them
  in play: all ten, each after its own look pass (the Norse first, then the Greeks, the Egyptians, the Hindus, the Japanese, the
  Chinese, the Aztecs, the Celts, the Mesopotamians and the West Africans); a pantheon added later stays low-poly until it has had
  one. `setUnitDetail('rich' | 'base' | 'auto')`
  pins the choice for tools. The bones live outside the scene graph (detached bind mode): `applyRich`
  ends with `syncRich`, and rigid pieces (weapon, shield, tools, flames, cargo, wings) ride mounts
  (`mountOn`), so the pose costs nothing on frames where a unit does not animate. Winged units get
  four more bones (`B.wingR1` .. `B.wingL2`, 27 in all) carrying rigid feather pieces; the body skin
  never uses them. The builder is split by what it dresses: `rich-body.js` (anatomy), `rich-clothing.js`,
  `rich-headgear.js`, `rich-feathers.js`, `rich-regalia.js` (wings, spikes, jewelry, feather cloaks,
  chains, flames), `rich-gear.js` (weapons, shields), `rich-arms.js` (tridents, bolts, scepters, scythes,
  shells) and `rich-outfits.js`, where each pantheon registers only the layers (legs, torso, arms, armor,
  cloaks, head, extras) and the shield style in which its people dress differently from the default
  (`rich-outfit-default.js`, the Norse; `rich-outfits-greek.js`: chiton, peplos, himation, muscle
  cuirass, pteruges, greaves, sandals, laurels, crowns, the hoplon; `rich-outfits-egyptian.js`: pleated
  shendyt kilts with an apron, the beaded usekh collar, corselets, the gods' sheath dress, mummy
  wraps over dried skin (`outfit.skinPaint`), the nemes, the double crown, a tall hide shield;
  `rich-outfits-hindu.js`: dhotis with a team-colored border, the char-aina with steel plates, a
  tiger-skin wrap, saris, garlands, the topknot, crescent and tiered kirita crowns, the arch of
  flames behind a god's head (`addPrabhavali`: a rigid flickering piece on the head bone), the mace,
  the discus, the drum and a lotus; `rich-outfits-japanese.js`: kosode and hakama, the laced do-maru
  and o-yoroi with sode, kote and kusazuri, the kabuto with its kuwagata, the jingasa, eboshi and tokin,
  tiger-skin loincloths, geta, the katana, yumi, kanabo, shakujo, folding and feather fans, the sacred
  mirror and the jewel, a ring on the back for the sun (rays) and the thunder (drums:
  `addAuraRing` in `rich-regalia.js`) or a sashimono banner for the other gods; an outfit may also set
  `palette(pal, ctx)` to recolor the shared palette (the people's black hair, their skin) and `gear(ctx, item, side)`
  to change how an item is built in either hand (an iron club, a long bow, a ringed staff; `side` 1 the right
  hand, -1 the left); `rich-outfits-chinese.js`:
  the jacket closed in a diagonal across the breast (`addJiaoling`) and tied with a sash, trousers
  bound at the calf and cloth shoes under a bamboo douli, a wound scarf, a Taoist daoguan or the
  soldier's plumed helm; the mingguang cuirass with its round mirrors, pteruges and tunjian shoulder
  beasts; wide sleeves and the pibo ribbons of the goddess; a tiger-skin wrap; four kaoqi pennants on
  poles for the generals; the halberd (ji) and the crescent-bladed guandao, a repeating crossbow, the
  Ruyi staff, the yue axe, a crane-feather fan and a lantern; `rich-outfits-aztec.js`: the maxtlatl
  (`addMaxtlatl`: a loincloth with an apron before and behind, bordered, the hem checked) and a cloak
  knotted over one shoulder for the people, the quilted ichcahuipilli (`quilt` paint) under a crown of
  plumes for the soldiers, the priest's long robe under the quetzal-feather fan (`addQuetzalFan`), the
  Eagle Warrior's feathered suit (`featherRows` paint) under the eagle's head (`addEagleHelm`), the sun
  god's hummingbird helm (`addHummingbirdHelm`) and feathered kilt, the Smoking Mirror's jaguar pelt
  (`jaguarSpots` paint) and obsidian mirror, Tlaloc's goggles and fangs (`addTlalocMask`) with a fan of
  plumes at his back (`addQuetzalBack`); the macuahuitl (`rich-gear.js`: a flat paddle with obsidian
  teeth on both edges, built for a club or a sword), a chimalli with a fringe of feathers (and the sun
  god's five balls of down), a clay jar of rain; `rich-outfits-celtic.js`: long dresses under a plaid
  shawl for the people, trews woven in a check (`tartan` paint) and a mail shirt (`addMailShirt`,
  `mailSheen` paint) under a plaid brat pinned with a penannular brooch (`addBrooch`) for the soldiers,
  the torc (`addTorc`) at every neck, the tall oval shield with its spine, a bronze band and studs
  (`richShield` `band`, `roundels`), the druid's white robe, antlers (`addAntlers`) and oak staff with a
  crescent of gold, the Woad Raiders' bare skin painted in bands of blue (`skinPaint`) with limed hair
  and a double axe, the Dagda's fur mantle and studded club, the Morrigan's raven (`addRaven`, a rigid
  piece on the chest bone) and crown of feathers, Lugh's golden mail, Brigid's crown of flame
  (`addFlameCrown`, flickering like the Hindu arch) and torch, Balor's plaid kilt and iron torc;
  `rich-outfits-mesopotamian.js`: the kaunakes (`addKaunakes`: a skirt of woolly fleece in tiers of
  tufts, short for the workers, to the ankle for the priest and the gods) with a fringed shawl in the
  team's color (`addDrape` with a `fringe` of tassels, `addFringe`), the beard squared off in rows of
  curls (`addCurledBeard`) and the hair rolled at the nape (`addNapeBun`), the soldiers' coat of scale
  (`addScaleCoat`) under a pointed helmet (`addConeHelm`) and the tall wicker shield closing in an arch
  (`richShield` `arch`, `pattern: 'wicker'`, roundels with their own `sides`), the priest's plain white
  cap, the gods' crowns of horns, one pair over another (`addHornedTiara`; Ishtar's with a star), Enki's
  streams of water (`addWaterStreams`: glowing ribbons on the cape bones), Nergal's black iron, lion
  pelt and studded pear-headed mace (`pearMace`), the apkallu in the head and the skin of a fish
  (`addFishHood`, `addFishCloak`) and the Slinger's sling (its `gear` asks for `build: true` for a
  `whip`, which `rich-gear.js` builds as two cords, a pouch and a stone); `rich-outfits-west-african.js`:
  the people's skin a deep brown and their hair black (`palette`; the gods keep their data's), a wrapper of
  kente under a tunic in the team's color and a head tie (`addHeadWrap`, the gele) for the workers (`kente`
  paint: strips of color sewn edge to edge, banded across; `kenteAt` for a cloth laid out by its own grid,
  Anansi's toga), the war smock with a strap of leather charms and cowries across the chest (`addAmulets`)
  under a leather cap with antelope horns and a band of cowries (`addHornedCap`) and a tall oval shield
  of hide for the soldiers, a striped smock, the same cap with a plume of guinea fowl feathers for horns
  and a quiver at the hip (`addQuiver`) for the archers, the priest's agbada (wide sleeves, its front a bib in the team's color edged in
  gold, two sheets laid on the robe so that their edges stay sharp) under a folded cap (`addFila`) with
  the talking drum and its hooked stick (`rich-arms.js` `DRUMS` styles `talking` and `beater`: the
  outfit's `gear` tells the two hands apart by `side`), the Dart Hunter's smock of mud cloth (`mudcloth`
  paint: dark cotton, laddered and dotted in pale) with a leopard's skin over the shoulders, Shango's
  red and white, his stacked bangles (`addBangles`, a list of colors taken in turn), his beaded crown
  with its veil of strands (`addBeadedCrown`) and his oshe (a beaded staff with a double axe for a head),
  Oya's tall head tie, her wrapper of nine colors, nine copper bangles and fly whisk of horsehair, Ogun's
  skirt of palm fibre (`addRaffia`) and black iron with a crest of raffia (`addRaffiaCrest`) and his
  cutlass (a machete), Anansi's kente, his four more arms (the calabash and a talking drum) and the gold
  spider on his breast and at the head of his staff (`addSpiderPendant`, `spider` in `rich-gear.js`),
  the Aziza's leaves; an
  outfit's `gear` may ask the gear builder for a weapon that is not in `RICH_WEAPONS` (`build: true`:
  the double axe, the torch, the sling, Shango's oshe, Oya's whisk), and a held piece with a flicker morph flickers; an outfit's `shield` may
  be a function of the unit as well as a style object). Gods with more than two arms carry the extra two pairs as one rigid
  piece on the chest bone (`extraArmsPiece` in `rich-regalia.js`: each hand holds an item the arm
  builders already make, named by its id or as `{ id, opts }` with options for its builder, moved into
  place with `MeshKit.placed`); such units get a separate
  triangle allowance (`multi_arms` in the test).
  Animal heads the kit builds (`BEAST_HEADS`: the jackal, the falcon, the monkey, the crow, the demon) live in
  `rich-heads.js` and are skinned to the head bone like a human one; any other beast head keeps a
  unit out of `richSupported`. An upright beast (the body `beast_biped`) is built on the humanoid rig only
  for the pantheons in `RICH_BEAST_BIPEDS` in `rich-humanoid.js` (the Chinese monkeys); the other beast
  bipeds stay low-poly.
  Rich creatures (the units that are not on the humanoid rig): `creatureSupported` / `buildCreatureTemplate`
  in `rich-creatures.js`, called from `richSupported` / `buildRichTemplate`, pick a body plan by what a unit
  looks like (its `visual` body, head, heads and extras); a unit a plan cannot dress fully stays low-poly. Each
  plan is one skinned mesh on a skeleton of its own plus rigid pieces (wings), instanced and mounted like the
  humanoid's (`spec.fit` gives the culling sphere of a body that is not upright), and moved by
  `rich-creature-anim.js` (`applyCreature`, called from `unit-anim.js` when `m.rich.plan` is set) from the same
  pose keys as the low-poly rig, the spine, neck, tail wave, ears and paws added. Shared kit:
  `rich-creature-kit.js` (bones from a list, a path of stations to loft along), `rich-creature-parts.js` (a lock of
  hair or a spine, paws, hooves, collars, a ring of gems), `rich-creature-hair.js` (ruff, lion's mane, horse's
  mane, tails of hair), `rich-creature-wings.js` (feathered wings, two bones a side), `rich-mammal-heads.js` (the
  heads of a wolf, jackal, fox, cat, lion, bull and horse, with jaw and ears) and `rich-creature-human-head.js` (the
  humanoid's face and headgear on a beast's neck). The four-legged plan (`rich-quadruped.js`: canine, fox,
  feline, sphinx, bovine and equine builds, tables of proportions; three tails for a fox spirit with an aura, two
  more heads for Cerberus, wings for the pegasus and the lamassu, which a grounded unit holds up and back
  standing about) dresses the wolf of Fenrir, Cerberus, the pegasus, the sphinx, the jackal, the three fox
  spirits, the guardian lion, the jaguar spirit, the ahuizotl, the Cú Sídhe, the lamassu, the bull of heaven and Osebo.
  The bird plan (`rich-bird.js`, with `rich-bird-heads.js`) dresses the raven, the Bennu, the fenghuang, the battle
  crow and the Anzu: a feathered body, neck and head as one skinned loft (a corvid's, a phoenix's or a griffin's
  proportions from a table; the crow's or the falcon's head from the humanoid's head kit, the Anzu's lion head from
  the mammal tables), a tail of feathers bound to four bones (long, with two spade-tipped streamers, for the
  phoenixes), legs with toes, and feathered wings (two rigid pieces a side on two bones, with a covert pad over the
  leading edge) that beat from the pose's `wing` key with the outer bone trailing, folded along the sides when a
  grounded bird stands about; the Bennu's flames are a flickering rigid piece on the body bone.
  The serpent plan (`rich-serpent.js`, with `rich-reptile-heads.js`) dresses Apep, Xiuhcoatl, the Onini, the Ninki
  Nanka, the celestial dragon, Tiamat and the Yamata no Orochi: one skinned loft down a spine of twelve stations
  on bones of its own (a base `s0`, a neck of three bones to the head and its jaw, seven back bones to the tip of
  the tail), the head from a two-entry table of reptile skulls (serpent and dragon: slit pupils, brows, fangs, a
  tongue, horns, antlers or a crown on a dragon), skinned to the neck chain and the back chain at once with a blend
  across the base so the neck bends and strikes without tearing the body. The undulation runs down the back
  bones from the pose's `wavePhase` while the neck rises, sways and strikes from `st` and `lunge`, and the jaw
  opens from `jaw`; a dragon has four short legs that walk in diagonal pairs and tuck up in the air, a mane and a
  tail tuft as its look says; scales, a lighter underside and the team ring are paint, spikes and flames are
  rigid pieces. The hydra is a mound with a tail, four stumpy legs and a three-bone neck to each head (960
  triangles a neck and head, so a class that cannot afford the necks keeps its low-poly model), moss and cypress
  on its back. The pose keys of the low-poly rig stay the source of truth.
  The lizard plan (`rich-reptile.js`) dresses Cipactli, a crocodile, and the Mushussu, a dragon-headed beast, on the
  four-legged beasts' skeleton (so the quadruped pose code drives them from the same pose keys): a barrel and a
  short neck lofted as one body of plates (a crocodile) or scales (the Mushussu), a head from the reptile table
  (a crocodile's long flat snout with a row of teeth along each jaw and the eyes standing up on ridges, or the
  dragon's with its horns, antlers or crown), legs that stand out to the sides with the elbows beyond the body
  and a foot of splayed toes with claws, a long tail of four bones, a row of spikes down a dragon's back and a
  double row of low scutes down a crocodile's, the team's color in two bands round a big one's barrel or a
  cloth on a small one's back. A sprawling lizard's trunk wags from side to side as it walks, harder than a
  beast's. Anything else with a crocodile's or a dragon's head and four legs (a rider, a weapon, wings) keeps its
  low-poly model.
  The beast bipeds (the Vanara, the Ugallu, the Sasabonsam and the Bultungin) are not a plan of their own: they ride the
  humanoid's skeleton and pose code (`RICH_BODIES` in `rich-humanoid.js` takes `beast_biped` along with `humanoid` and
  `giant`) on the low-poly rig's beast-biped proportions (a stooped trunk, a long digitigrade leg, the head carried
  forward), except the monkey-headed ones (`UPRIGHT_BEASTS`: the Vanara and the Chinese monkeys keep the humanoid's
  build, so the monkeys already built are unchanged). `BEAST_HEADS` in `rich-heads.js` gained the lion, wolf and demon
  heads of a beast biped, built by `rich-beast-heads.js` (one table-driven carnivore skull: a skull, muzzle and jaw lofted
  from stations, nose, brows, eyes that glow or slit, fangs, ears rooted inside the skull; tables for a lion, a hyena
  with a dark mask and a bat with iron teeth). The shared pieces are `rich-beast.js` (claws on the hands, digitigrade
  legs, talon feet and paws, a lion's or a hyena's tail, a lion's mane of scalloped locks, a hyena's crest) and
  `rich-beast-wings.js` (the Sasabonsam's bat wings: an arm, four fingers and fans of scalloped leather, two rigid pieces
  a side on the humanoid's wing bones, beaten by the pose's `wing` key like a feathered pair). Each pantheon's outfit
  file dresses its beast: the Ugallu in a fleece skirt, a shawl and silver bands, the Bultungin in a spotted coat (a
  `skinPaint` hook and denser lofts for the spots to show on), a crest and a bushy tail, the Sasabonsam in a rag, iron
  bands, claws and hook feet. Costs: 5.4k triangles for the Vanara, 7.3k for the Sasabonsam, 7.6k for the Bultungin and
  8.3k for the Ugallu (a minion's budget is 8.5k).
  The spirits (the Greek Shade and the Celtic Banshee) ride the humanoid's skeleton and pose code as well (`RICH_BODIES`
  takes `spirit`), on a `spirit` profile in `unit-bodies.js` (the low-poly spirit's own proportions, now one shared
  object: a tall waist, a lean into the drift). Below the waist there is a wisp in place of legs: `humanoidSpec(d, {
  tail })` appends a chain of bones after the pelvis' (`tail0` to `tail3`, each the child of the one before, the first
  of the pelvis; `spec.tail = { first, count }`, and `spec.wing` says whether the wing bones are there), a bell of
  cloth and eleven ragged tongues are skinned along the chain with `alongPath` (`rich-spirit.js`), and a robe blends
  the torso's weights into the wisp's at the hip. Above it: the robe with the team's sash, a torn shawl, sleeves that
  open wide over bare forearms, long thin hands with curling fingers, and a hood drawn up to a peak (the Shade) or a
  veil, a circlet and long hair (the Banshee). A spirit is not dressed by its pantheon: `outfitFor(pantheon, body)`
  gives the body `spirit` the one `SPIRIT` outfit, coloured by the unit's palette (its `palette` hook brings a pale
  gown down to where the sun and the bloom do not burn it out to white), with two new outfit hooks, `hands(E)` and
  `face(E)`, for its own hands and its hollow burning eyes and mouth (a frown on the Shade, a wail on the Banshee;
  `addHeadAndNeck` takes a `face` option). The body is see-through: a paint may set `out.alpha`, and a built mesh with
  a faded vertex carries a four-component `color` attribute (three.js reads the fourth as the vertex's alpha);
  `ghostly(kit)` scales it by 0.88, keeps what glows strongly (the eyes) solid and gives the rest a faint light of
  its own so that a spirit still reads at dusk. The skinned ghost material is opacity 1 and depth-writing: its
  translucency is the vertices', faint toward the hem and the tips of the tongues and the hair. The pose code is
  `applyRich`'s (the `spirit` case of `unit-anim.js` keeps its float, lean and raised arms) plus `poseTail`, a wave
  that runs down the chain from `wavePhase`: it sways a still spirit and, quicker, lays the wisp back along the air
  behind a moving one. Costs: 6.2k triangles for the Shade (a minion), 7.6k for the Banshee.
  The nagas (the Hindu Naga, Nuwa and Quetzalcoatl) stand on the humanoid skeleton too (`RICH_BODIES` takes `naga`, on a
  `naga` profile in `unit-bodies.js`, the values the low-poly naga overrode inline) with a serpent's tail where the legs
  would be. `humanoidSpec(d, { tail, tailStyle })` takes the same chain of tail bones as the spirits' (`spec.tail = {
  first, count, style }`, style `wisp` or `serpent`): nine bones from the pelvis down the belly and back along the ground
  (`nagaBones`, `rich-naga.js`), and one smooth loft of forty stations (a Catmull-Rom curve through fourteen keys, an S on
  the ground that ends in a thin tip curling up) is skinned along them with `alongPath`. The loft's frame is the
  diagonal `ref` (the first radius lies along the back whether the tail runs down or along the ground; a fixed up
  vector flips where the path turns from vertical to horizontal) and the belly is kept off the ground. `nagaTail(E, o)`
  is called by each pantheon's `legs` layer where it would build the legs: `scalesOf` paints rows of diamonds, a ridge
  toned toward the second colour, a cream underside laid in plates and a mark of the unit's own (`dorsalDiamonds`, or
  lapped feathers with `o.feathers`), `o.bands` puts rings of gold or of the team's colour round it at fractions of its
  length, and `tailFan` roots a fan of feathers at the tip. `nagaWaist` is the belt that hides the seam between the torso's
  last ring and the tail's first. Above the waist each is dressed as its people dress a person: the Naga bare-chested with
  gold arm bands, a red sash and a golden kirita, with a cobra's head (`BEAST_HEADS` takes `serpent`: the serpents' skull
  from `rich-reptile-heads.js` on the head bone, under a broad hood of pale ribbed skin with the spectacle on its back,
  `rich-naga-head.js`); Nuwa in a pink tunic and wide sleeves, a jade belt, a tiara, hairpins, long hair and a red ribbon
  over a blue tail with gold rings, a staff and a stone; Quetzalcoatl bare-chested in a plume crown and the feathered
  wings of the gods, over a green tail of lapped feathers with a fan of quetzal plumes at its tip. The pose code is
  `applyRich`'s (the `naga` case of `unit-anim.js` calls it when the model is rich) plus a `serpent` style of `poseTail`:
  every bone yaws about the vertical by `sin(wavePhase - 0.8 i + seed) (0.05 + 0.03 i) sweep`, so a wave runs down the chain
  and grows toward the tip, small when the naga stands and twice as wide (`m.tailMove` eased in) when it glides. A dead
  naga's tail lies straight (`m.tailLie` eases to 1 and the bones blend toward `straighteningYaws`): the rig rolls onto its
  side, and an S on the ground would half bury and leave the tip floating.
  Costs: 5.6k triangles for the Naga (a creature, budget 10.5k), 8.7k for Nuwa and 9.0k for Quetzalcoatl (gods, budget
  9k: Quetzalcoatl has 12 triangles left, his wings alone are 1.5k).
  The centaurs (the Greek Centaur and the Celtic Dullahan) are a person on a horse's body (`rich-centaur.js`,
  `centaurSupported`: a human head or none, no headgear, the extras `beard long_hair cape armor eye_glow tail`). One skinned
  mesh on the humanoid's bones and nineteen of the horse's (`addCentaurBones`: `hips` under the root, `back`, `withers`, four
  tail bones, four legs of three, the forelegs hanging from the withers and the hind legs from the hips) with the person's
  pelvis a child of the withers, so the body pitches with the horse's front while the pose turns the pelvis back against it.
  `spec.ix` has the horse's bones by name (`spec.ix = { root }` first: a parent name missing from it gives `undefined` and
  silently detaches the bone). The person is dressed by the outfit layers as anyone is (`CENTAUR_OUTFITS` lays the centaur's
  layers over the pantheon's) and built in a frame of its own with the pelvis at x = 0, raised to stand on the back
  (`centaurFrame`, `raiseDims`), then the whole model is moved to the horse's middle (`settle`). `PROFILES.centaur` is the
  humanoid's values the low-poly centaur used inline (identical, so the low-poly models are vertex-identical); the rich
  person is drawn 1.12 times larger (`CENTAUR_PERSON` in `richDims`), the horse under it being a big one. `addHorse(E, o)` is
  the `legs` layer: a barrel of 17 stations skinned along the three back bones, legs with hooves, a tail with its strands
  and, unless `o.cloth` is false, a saddle cloth of the team's colour. The Centaur is a buckskin horse (the skin mixed toward
  the primary: the rider's own tan read as one body with it) under the team's saddle cloth, the rider bare to the waist with a
  baldric of the team's cloth, a quiver of six fletched arrows over the right shoulder, leather bracers and a bow; the
  Dullahan a black steed with a grey ragged tail, a black iron cuirass and pauldrons and a short cape of the team's colour
  (a longer one hangs through the barrel). He has no head: the neck ends in a raw stump (`addHeadAndNeck`'s headless
  branch), and his own (`severedHead`, `rich-dullahan.js`: a waxen face with glowing eyes and a grin, long dark hair) is
  held up by its hair in the left hand where a lantern would be, his whip a spine (`spineWhip`: a handle with a bone
  pommel, eleven vertebrae with spikes along a curved cord) in the right. An outfit's `gear` returns `{ head: true, pivot:
  true }` for the head: a `pivot` piece is built without a hand frame and rides a bone of its own at the palm
  (`addPalmBone`, `spec.ix.carry`) that the pose turns upright whatever the arm does (rigidly on the hand, the head lay
  sideways in a blow). The pose (`rich-centaur-anim.js`, `applyCentaur`, called by `applyCreature` for plan `centaur`) takes
  both halves from the low-poly pose keys (`quadPose` writes the quadruped's, the legs' and the arm and torso keys of a
  centaur): the horse is the quadruped plan's (bob, pitch through the three back bones so the hind legs stay planted,
  four legs swinging at the gallop, the tail's wave), the rider's the humanoid's (lean, twist, arms, cape and hair that
  lag). Costs: 7.5k triangles for the Centaur, 8.8k for the Dullahan (creatures, budget 10.5k), both 1.07 and 1.14 times
  the low-poly height.
  The insects are two plans. The Egyptian Scarab is a beetle (`rich-insect.js`, `insectSupported`: body `insect`, no head,
  headgear or weapon, the extras `shell eye_glow`), a plan of its own in `PLANS` (`rich-creatures.js`): one skinned mesh on 27
  bones, `root`, `body`, `head`, two mandibles, two antennae of two bones and a leg of three bones (`F1u F1l F1p`) for each of
  `BEETLE_LEGS` (`F1 F-1 M1 M-1 B1 B-1`, the front pair digging, a broad shin with teeth). The shell is lapis with a gold rim
  and a seam ridge of the team's colour down the back (a thin ridge was 2.9% of the top-down area, so it is widened to 4.8%);
  `insectLeg` and `bead` are shared with the scorpion. The pose is `applyInsect` (`rich-insect-anim.js`, called by
  `applyCreature` for plan `insect`; the `insect` case of `unit-anim.js` calls it when the model is rich): a tripod gait from
  the low-poly keys (`ga` swings each leg about the vertical at its hip, `la` and `lb` lift the two sets, which alternate: a
  right front leg steps with the left second and the right third), each leg folding as it lifts, the body bobbing and
  lunging (`bX`) and pitching (`bRz`), the head looking about while it stands and rearing then snapping down in a bite with
  the mandibles spread and shut, the antennae feeling ahead. The rich rig strides 0.9 (the low-poly default is 1.25: `blendPose`
  low-passes the keys, so a long stride at a fast cadence sweeps less than the ground goes by and the feet slid). 6.0k
  triangles, 1.01 times the low-poly height.
  The Mesopotamian Scorpion Man is a person on a scorpion's body (`rich-scorpion.js`, `scorpionSupported`: body `insect`, a
  human head, one head, no headgear, the extras `beard long_hair cape armor eye_glow tail`), built as the centaur is: by the
  humanoid template path (`buildRichTemplate`, `scorpion = v.body === 'insect'`), the person dressed by the pantheon's outfit
  (`outfitFor(pantheon, 'insect')` lays `SCORPION_OUTFITS[pantheon]` over it, `rich-scorpion-outfits.js`; `richSupported` asks
  for one, so an insect person of another pantheon keeps the low-poly model), built in a frame with his pelvis at x = 0
  (`scorpionFrame`: raised so that his waist stands at the top of the carapace), then settled onto the scorpion's middle
  (`settle`, which moves every bone including the root: the pose reads the root's rest position, `q.root`). `PROFILES.scorpion`
  is the humanoid's values that the low-poly `insectTemplate` used inline (identical, so the low-poly models are unchanged).
  The skeleton is the humanoid's 23 bones and 36 of the scorpion's (`addScorpionBones`: `body` under the root, `meso1`,
  `meso2`, `tail1` to `tail5`, `palpR1 palpR2 palpL1 palpL2` and eight legs of three, `SCORPION_LEGS` `a1 a-1 b1 b-1 c1 c-1 d1
  d-1`), the pelvis a child of `body`, so the carapace carries him. `addScorpion(E, o)` is the `legs` layer: a carapace of 14
  stations by 20 sides with a gold rim, an abdomen of seven overlapping scalloped plates with a plate of the team's colour down the back of each,
  a tail of five segments (`ref [0, 0, 1]`: the tail's path goes vertical, where a ring frame about `[0, 1, 0]` flips) with a
  bulb and a hooked ivory sting that glows at the tip, eight legs (`insectLeg` with the lighter profile) and two small
  pincers. The Scorpion Man is bare to the waist with a belt, bronze pauldrons and bands at the arm, a fringed shawl and a
  headband in the team's colour, black hair rolled at the nape and a curled beard, his bow in the left hand; the shell is
  chitin of the colour of old bronze, darker than his skin (the same tone read as one body). The pose is `applyScorpion`: the
  legs as the beetle's with a shorter sweep, the abdomen swaying behind in a wave, the five tail joints curled over the back
  and uncurling with the thrust of the sting (`st`), the pincers held out and flung wide for the blow, and the person
  steadied as a rider is (`poseRider`, shared with `applyCentaur`: lean, twist, arms, cape and hair that lag, the pelvis
  turned back against the body's pitch). 9.6k triangles (a creature's budget is 10.5k), 0.96 times the low-poly height.
  Airavata, the Hindu titan (the white king of elephants with his three heads, and Indra riding him in a howdah), is a person
  on an elephant, built as the centaur and the scorpion man are (`rich-elephant.js`, `elephantSupported`: body `elephant`, head
  `elephant` or none, one head or three, headgear none or `headdress`, no weapon or offhand, extras only `jewelry rider` and
  including `rider`; `richSupported` also asks for an `ELEPHANT_OUTFITS[unitType.lookOf || unitType.pantheon]` entry,
  `rich-elephant-outfits.js`, today only the Hindu). The unit's own head, headgear and heads are the elephant's, so the
  person is dressed from a context of his own (`riderContext`: the outfit's `rider` gives him a human head, the tall crown
  and the thunderbolt, and the extras he can wear stay), drawn 0.72 times the scorpion man's profile (`richDims(ctx,
  'rider')`: a small figure in a howdah) and seated by `elephantFrame` (`tx -0.04`, a lift that puts his hip at the top of
  the cushion), then settled onto the elephant's middle (`settle`). The skeleton is the humanoid's 23 bones and 43 of the
  elephant's (`addElephantBones`): `hips` (child of the root), `back`, `withers`, `tail1` to `tail4`, three bones for each of
  `ELEPHANT_LEGS` (`F1 F-1 B1 B-1`: forelegs from the withers, hind legs from the hips) and, for each head, `h0` (the
  middle one) `h1` `h2` under the withers with its trunk's five bones (`h0t1` to `h0t5`) and its ears' two (`h0eR h0eL`); the
  person's pelvis is a child of `back`, so the barrel carries the howdah. A unit with one head builds 16 bones fewer. The
  template is `kind: 'quadruped'` (the low-poly Airavata's) with `rich.plan = 'elephant'` and the rig `{ legLen 0.6, bodyY 0.6,
  sprawl false, stride 1.3, humanTop true, gait 'walk' }`; `humanTop` on a quadruped rig makes `quadPose` write the arm keys
  as a centaur's and `poseGroupsFor` blend them (no low-poly quadruped has `humanTop`). `addElephant(E, o)` is the `legs`
  layer: a barrel (17 stations by 18 sides on `alongPath` of the back's three bones, a squared section), four pillar
  legs (one loft each from inside the barrel to the sole, thick at the hip and the shoulder, creased at the knee and the
  ankle, the foot flaring to the ground; four toenails on a front foot, three on a hind one; two bands of gold above the
  ankle), a rope of a tail with a brush of hair, the three heads, the caparison (a `sheet` in the team's colour over the back
  and down the flanks with a gold border, a gold line and three gold tassels a side) and the howdah (a platform of lacquer
  rimmed in gold, a cushion in the team's colour, a gold rail and four posts, rigid on `back`). `elephantHead`
  (`rich-elephant-head.js`) builds a head in a frame of its own: a domed skull, a trunk whose loft is bound along the
  head's five trunk bones, two curving ivory tusks with a band of gold, ears as two-layer sheets on bones of their own (the
  inner one of a side head is left out), small eyes (a heavy lid on the middle head only), a forehead cloth in the team's
  colour bordered in gold and, on the middle head, a fan of seven plumes in gold and red; the two side heads are a `lean`
  build with fewer rings and sides. Indra is bare to the waist in a red cloth with a gold border, a belt and a sash in the
  team's colour, a cape in the team's colour, a collar and bands of gold, a garland, the tall crown with the flaming arch
  of the prabhavali behind his head and the thunderbolt in his right hand; his skin is bronze (`palette`: the unit's own
  white is the elephant's hide, a shade off white so that the light models it instead of blooming it). The pose is
  `applyElephant` (`rich-elephant-anim.js`, called by `applyCreature` for plan `elephant`) over the low-poly pose keys: a
  slow four-beat walk on pillar legs that bend little, the barrel bending through `back` and `withers` (0.45 and 0.55 of the
  pitch) so that the hind legs stay planted, a tail swish down its four bones, three heads that each look about on a phase of
  their own while the elephant stands, rear in the wind-up of a blow and come down with it, trunks (the tip curls most) that
  swing in time with the steps, curl up in the wind-up and fall with the blow, ears that flap (slowly standing, quicker
  walking, flared forward for the blow, laid back when it falls), and the person steadied as a rider is (`poseRider`: lean,
  twist, arms, cape and hair that lag; the pelvis turned back against the body's pitch by 0.85 and its yaw by 0.7). 13.5k
  triangles (a titan's budget is 14k), 66 bones, three meshes (the body, the flaming arch on the head bone, the thunderbolt
  on the right hand), 0.975 times the low-poly height, a template in about 100 ms.
  The battering ram, the siege engine every pantheon trains (the body `ram`), is the last unit to get a plan of its own
  (`rich-ram.js`, `ramSupported`: the body `ram` with no head, headgear, weapon, offhand or extras; the pieces are in
  `rich-ram-parts.js` and the pose in `rich-ram-anim.js`); with it every unit of every pantheon has a rich model. It is one
  skinned mesh on 11 bones and nothing rigid: `root`; `body` (the frame: two sills that curve up at their ends, four cross
  beams, an A-frame at each end, the ridge pole with a band of iron at each frame, a gabled roof of stitched hides in the
  team's colour over four battens, and the banner's pole with a finial in the pantheon's metal); `log` (a log of bark with
  the end grain showing at its butt, four bands of iron and the iron ram's head in the pantheon's metal: a flared socket, a
  skull with a high brow and a blunt muzzle, and a horn coiled about each cheek); `ropeA` and `ropeB` (a V of two ropes
  each, hung from the ridge to the eyes on the log's bands); `axleF` and `axleB` (an axle and its two wheels: an iron tire, a
  felloe, six spokes and a hub with a cap of metal; they are children of the root, so the frame rides above them); and
  `flag1` to `flag4` (a chain along the swallow-tailed cloth in the team's colour). The two roof panels (`hideRoof`) are
  laid on a surface puffed between the battens, with scalloped hems rolled over a rope (`hemRoll`), a coarse darker layer
  under the outer one and a trim in the pantheon's accent along the hem; the paint (a tone for each hide, a mottle,
  creases at the battens, a darker join under the ridge) only scales the team's colour, so the roof stays the owner's colour
  from above (56% of the top-down silhouette, against 64% for the low-poly ram). A pantheon dresses the same body in its own
  metal, timbers and trim, as the low-poly ram is dressed. The template keeps `kind: 'ram'` (so `animateModel` still picks the
  ram's pose) with `rich.plan = 'ram'` and the rig `{ wheelR }`. The pose keys of the low-poly rig stay the source of truth:
  the `ram` case of `unit-anim.js` integrates `m.wheelAngle` from the speed and blends the log's stroke `lx` as before, then
  hands a rich ram to `applyCreature` (`applyRam`). The wheels turn with the angle; the frame rides its axles (rising 0.008
  with each turn and rocking a little: a bone's local position is its rest offset from its parent, so a pose that moves one
  adds to the rest); the log hangs from the ridge on a pendulum (both pairs of ropes rotate about the ridge by
  asin(0.8 lx / 0.28) and the log moves on the circle to (L sin t, L (1 - cos t)), so it is drawn back and up in the wind-up,
  thrown forward and up in the blow, rocks on the bumps, drifts a little when it stands and slumps forward when the ram is
  wrecked); and the banner ripples down its four bones (a little when standing, slack when dead). The log's head and horns
  clear the end frames at every angle of the swing (the posts stand wide at the log's height and the tie is above its arc;
  a test sweeps them). 6.8k triangles (a mortal's budget is 8.5k), 11 bones, one mesh, 1.03 times the low-poly height, a
  template in about 60 ms (110 cold).
  Test budgets for the tier are separate (`tests/render/rich-models.test.js`); the
  low-poly budgets are unchanged.
- VFX: `src/render/vfx.js` exports `class VFXSystem(scene, getHeight)` with
  `spawnProjectile({ kind, el, from: {x, y, h}, to: {x, y, h}, flight })`,
  `spawnEffect({ el, shape, x, y, r, fx, fy, points, duration })`, `spawnHit({ x, y, h, el })`,
  `spawnDeath({ x, y, scale })`, `spawnLevelUp({ x, y })`, `spawnSummon({ x, y, scale, el })`,
  `spawnDust({ x, y, size })`, `update(dt)`, `dispose()`. Positions in sim coords; h = height above ground.
- Look: low-poly, flat-shaded. Units, buildings and terrain use `MeshStandardMaterial` with
  per-vertex roughness / metalness and baked AO; foliage and ground cover stay Lambert with a
  wind shader. Light: warm sun + hemisphere + image-based lighting from a procedural sky, with
  drifting cloud shadows on the sunlight and a rim light (`src/render/shading.js`,
  `patchWorldMaterial`); soft aerial fog at distance.
  Quality: low draws straight to the canvas with Neutral tone mapping. Medium / high / ultra
  draw through `src/render/post.js` (`PostFX`): 4x MSAA HDR target, bloom, ambient occlusion on
  high / ultra, Neutral tone mapping, grade, vignette, dithering, and adaptive resolution (the
  scene drops below the canvas size while frames are slow). Overlays (selection rings, bars,
  markers, flags, placement ghosts) live in their own scene drawn after post-processing, so they
  keep exact colors. Sun shadows on medium and up, unit mesh shadows on high / ultra, cloud
  shadows on medium and up; VFX point lights 0 / 2 / 4 (low / medium / high and ultra).
  The sun's shadow box (`updateShadowCamera`) is fitted each frame to the view's ground quad as the
  sun sees it (its extent along the light's right and up axes, plus a margin on the up-sun side for
  what stands 8 units above the ground), not a square as wide as the view: anything whose shadow
  falls in the view lies on the same sun ray as the point it darkens, so this covers every caster,
  and a low sun no longer stretches the box 100+ tiles up-sun (that drew every forest chunk along
  the strip into the map, more triangles than the visible scene). Its half sizes step by 2 tiles and
  its center snaps to texels. Forest chunks are culled by their instances' box as well as their
  bounding sphere (`chunkInFrustum` in props.js; the box grows by `CHUNK_BOX_PAD` for what the
  shader does to a tree: a spruce's own shape and the wind). Late game at the population cap, Medium, default
  zoom: shadow-pass triangles 1.0M to 0.6M, whole frame 1.75M to 1.1M, draw calls 373 to 228
  (`node tools/perf-late.mjs`, which also profiles the real game with `--game`).
  Buildings (`src/render/models/building-*.js`, four layers): `building-core.js` holds the colors,
  surface classes and geometry primitives and the Kit that merges a building's parts into four
  vertex-colored buckets (foundation, body, team, glow); `building-materials.js` the shared materials
  and the surface shader (stone courses, bricks, planks, tile and shingle courses, sod, thatch, a
  cobbled court, drawn from the object-space position and normal, plus grime and contact shading);
  `building-pieces.js` the palette and the reusable pieces (walls in each wall material, a roof in
  each roof style, props, ornaments); `building-models.js` the buildings and the public API. Roofs are
  laid in real courses (`courseSlope` for a gable, `courseLoft` for hipped, swept and stepped roofs,
  `courseCone` for cones and domes with smooth normals) and big masses have rounded edges (`bevelBox`,
  and `bevelFrustum` for battered walls), so edges catch the low sun; walls, towers, gates, temples
  and shrines are built the same way. The detail level follows the quality tier (`QUALITY.detail`:
  low 0, the essential forms; medium and up 1, which adds rounded edges, shutters, wall and lookout
  lamps that light after dusk, loose stones and grass, thick eaves); `GameRenderer.setQuality`
  switches it and rebuilds the models in place. Budgets, checked by the tests: at most 3000 triangles
  a building, 700 a wall segment (two meshes), 6 meshes; a style whose detailed build does not fit
  is built at the plain level (`getBuildingModelInfo(...).level`), which no roster pantheon needs.
  A test casts rays from the game camera to check that team color stays visible on every building.
  The Manor (four Houses combined, 4×4 tiles; `buildManor`) is a courtyard house in the pantheon's own
  style: a hall at the back with the door and the team banners, a lower wing on each side (round halls
  and cones for the round-roofed styles) around a paved court with a fountain, hedges, a barrel and
  sacks, the ornament pair at the gate and a flag on each side. It shows more than a House (1.1k to 1.9k
  triangles plain, 1.6k to 2.6k detailed) and stays in the same budgets.
  Terrain (`terrain.js`, `ground-field.js`, `terrain-textures.js`, `terrain-water.js`): the sim's
  vertex heights stay as they are, and the renderer builds one smooth ground field from them
  (`groundField(mapData)`, 4 samples a tile: a Catmull-Rom surface through the vertices, so the
  slope is continuous across tile edges). `heightAt` answers from that field, so trees, units,
  effects, the camera, picking, the water and the mesh all agree on where the ground is. Shores
  are rebuilt from a smoothed distance to the water tiles: the tile outline becomes a rounded,
  wandering coast with a gentle beach and a shallow shelf (the coast moves by a fraction of a tile;
  tiles stay what the sim says). Impassable rock tiles rise into sandstone outcrops about 0.7 tall,
  which nothing walks on. The mesh is 16x16-tile chunks over shared vertices (culled per chunk);
  a per-sample data texture (shore distance, outcrop rise, forest share, cavity) lets the shader
  follow the field: procedural texture array with height blending and bump, pale sand rim with a
  damp band and sand shelf, sandstone with strata on the faces, cliff-foot shade and sunlit tops.
  Water: its own mesh over the lake field, depth-colored teal that turns see-through at the edge,
  Fresnel sky reflection, sun glints, moving normals, white foam along the shore, caustics on the
  bed and a cyan glow at night (it reads the shared `WORLD_UNIFORMS` of `shading.js`: sun, sky,
  `uNight`; a fixed clear-noon stand-in covers any the build does not have); misty map border.
  The sim, pathing, AI and snapshots never read these heights.
  Fog of war (`src/render/fog.js`, installed after the other material patches): remembered
  ground dimmed and desaturated toward a cool grey, unexplored land under a drifting dark mist;
  enemy units hidden when not visible; enemy buildings shown as last seen.
- Time of day (`src/render/atmosphere.js`, render-only: no sim or protocol change). The match clock
  in every snapshot (`vs.renderTime`, sim seconds) maps to an hour (`DAY_SECONDS` = 900 a day, the
  match opens at 08:00, the dark of the night passes faster than the day) and the hour to a *look*:
  key light, hemisphere fill, haze, sky, exposure, bloom, grade, glow, light shafts and lamp level,
  blended with eased interpolation between eight keyframes (golden morning, bright day, warm
  afternoon, pink-lilac dusk, blue hour, moonlit teal night, violet predawn, peach dawn). The sun
  and the moon share one arc; the *key* light is the sun by day and the moon at night, swapped at
  the blue hour where both are at zero and never lower than 14 degrees, so shadows never jump or
  graze. Every client agrees because the hour is a pure function of the sim clock. The `timeOfDay`
  setting (`src/settings.js`, Settings and the in-game menu, default `cycle`) holds one time for the
  whole match instead: `golden`, `day`, `dusk`, `night`, `dawn` (`TIME_PRESETS`); `?tod=` in the
  address does the same for one page load (screenshots), and `GameRenderer.setTimeOfDay(mode)`
  takes a mode or an hour. `GameRenderer.updateLook` runs each frame: it sets the lights, the haze
  (measured from the point the camera looks at, so zooming out does not fog the middle), the sky
  environment (rebaked at most every 1.5 s), the post look, and the shared shader uniforms
  (`shading.js` `WORLD_UNIFORMS`: `uSunDirW`, `uSunColor`, `uMoonDirW`, `uMoonColor`, `uSkyZenith`,
  `uSkyHorizon`, `uSkyAmbient`, `uGroundAmbient`, `uRimColor`, `uNight` 0..1, `uLamp` 0..1, `uShaft`
  0..1, `uLampSpot[8]`). At low sun the cloud and canopy shadows stretch into long streaks along
  the light (`uShaft`); after dusk windows, doorways, lanterns and fires brighten (`uLamp`), and
  `GameRenderer.updateLamps` pools warm light on the ground round the finished buildings nearest
  the view (`uLampSpot`: xyz the lamp, w its reach; at most `LAMP_SPOTS` = 8, none by day). On
  medium and up the composite pass carries the grade, a glow veil from the horizon colour and the
  bloom; low has no post pass, so the grade is baked into the light colours. Night stays playable:
  units, team colours, selection rings, bars and the fog of war all stay readable (overlays draw
  after post). Tests: `tests/render/atmosphere.test.js`, `tests/render/game-renderer-lighting.test.js`;
  `tools/shot-lighting.mjs` captures any scene at any time of day and quality (`--canvas` for
  high / ultra under software GL).
- Far zoom (`camera.js`, `zoom-lod.js`, `far-units.js`, `models/props-far.js`; render-only: no sim,
  protocol or data change). The camera zooms from 10 to 170 tiles (`CAMERA_DEFAULTS`; the range
  used to end at 44, which is `midDistance` now): at 170 a whole medium map (128 tiles) fits a
  16:9 window with its border around it. The pitch keeps its old line (50° to 58°) up to 44, then
  rises on a rational curve to 66° at 170 (it has to stay under 70°: the bottom of the view would
  pass the vertical); the clip planes follow the zoom (`updateClipPlanes`: near 0.5 up to the
  default zoom, then 0.04 more a tile of distance up to 6; far 3.2 times the distance, never under
  400), so the depth buffer keeps its precision. `zoom-lod.js` holds every curve that follows the
  distance, as pure functions the renderer and the tests share; each gives the look the game
  always had up to `NEAR_RANGE` (44): `hazeStretch` (haze distances times (d/44)^0.7, so the far
  edge of a wide view keeps about the haze the old far view had instead of fading into it);
  `shadowShare` (the sun's shadow fades out between 48 and 88 tiles, the blob shadows under units
  take over, and from 88 the shadow pass is skipped: `shadowMap.autoUpdate` off, redrawn at once
  when the camera comes back; the light itself keeps turning with the day); `aoShare` (ambient occlusion on high / ultra fades out between 60
  and 110, the pass is skipped at 0); `overlayScale` (bars' thickness, status icons, floating
  text: the old curve, then growing with d^0.8 so the drawn size falls slowly); `crowdScale` (a
  unit's bar width and rank pips, d^0.5: an army of a hundred units a few pixels tall each does
  not vanish under its own bars); `ringLineScale` and `ringRadiusScale` (selection and hover rings
  are in tiles: the line grows with the distance and keeps the two pixels it had at 44, a unit's
  ring radius with its square root; buildings keep their radius); and the sound's hearing scale
  (`hearingScale` in `game.js`, up to 4.5, so a fight anywhere on a medium map is still heard). The
  terrain's border mist fades out past 80 tiles. What a wide view costs is what the far view is
  about: the late game (four AIs, ten minutes, 231 units, walls of forest) drew 1830 draw calls and
  2.2 M triangles at low from 170 tiles. Three detail levels go by *pixels on the screen*
  (`detailPixels`: `pixelsPerTile` in CSS pixels, so a bigger window keeps its detail longer; and
  none at all up to 44, so the old zoom range keeps every level at full detail in a short window
  too, where a 600 pixel high one has under 19 pixels a tile at the old limit), each with a
  way back at a different value (hysteresis) so a camera resting on an edge does not flicker:
  (1) `terrainStride`: the ground mesh draws every 2nd field sample below 16 pixels a tile (back
  above 19) and every 4th below 7 (back above 8.5): `createTerrain().setStride(n)` swaps each
  chunk's index (`buildTerrainLodIndex`, cached per step) over the same vertices, one step for the
  whole map so chunk edges, which lie on whole tiles, always meet; positions, normals, the data
  texture and the shader are shared, so only the triangle count changes. (2) `forestFar`: below 11
  pixels a tile (back above 13) the forest is drawn as plain crowns (`props-far.js`: smooth
  vertex-coloured shapes, 18 to 30 triangles a tree against 76 to 144, in the leaf colours of the
  full tree times 0.93, lit by the same foliage light, with no wind and no shadow), one
  InstancedMesh a variant for the whole map that copies the matrices and tints of the chunk
  meshes the first time it is wanted and is kept in step by `fell()`; `forest.setFar(on)` swaps
  them. (3) `unitFar`: a unit under 11 pixels tall on the screen (back to the model from 14),
  once the camera is past the old range and the view is under 20 pixels a tile (back from 22), is a marker:
  `far-units.js`, one instanced 54-triangle figure in its team colour for all of them (fog of war,
  fade-in and the blob shadow as for models), as tall as the unit from its foot to the top of its
  model (a flyer's from its hover, not from the ground); its model is hidden and not animated, and a unit
  that dies as a marker plays its death on its model. The levels are driven by
  `GameRenderer.updateLod()` and `syncUnits`; `renderer.lodPin = { stride, forestFar, unitFar }`
  pins any of them (tools and tests). Every curve above goes by `GameRenderer.zoomDistance`, the
  camera's distance, except while the camera is free (the intro film, 11.1): its authored framings
  (74 tiles out at the start) never see more than the old range, so the film keeps the look it was
  made for. Measured at low, 1280x720, the late game, 170 tiles: 1830
  to 420 draw calls, 2.2 M to 0.5 M triangles, about 2.5 times less time per frame under software
  GL (`tools/shot-zoom.mjs`: the same view at any distances with the levels auto, pinned `full`
  or pinned `far`, stills and the cost table; the harness has a `late` scenario for it). Tests:
  `tests/render/zoom-lod.test.js`, `game-renderer-zoom.test.js`, `far-units.test.js`, `props.test.js`,
  `game-renderer-parts.test.js`.
- Vision-edge fade (`src/render/unit-fade.js`): enemy and neutral units that come into sight
  after load fade in over `FADE_SECONDS` (0.25 s) and fade out the same way when they leave
  it (own and allied units, and everything visible at load, never fade). A fading-out unit is
  drawn but cannot be picked. Fading meshes swap to cached material variants quantized to 8
  levels (`alphaHash` for opaque materials, scaled opacity for transparent ones); shadows are
  off while a unit is see-through.
- Foliage (`src/render/models/props.js`, `foliage-shader.js`, `leaf-texture.js`): broadleaf, birch and
  bushes are built of *leaf puffs*. A puff is one quad of six vertices at a point (corners and radius in
  `aBb`) that the vertex shader spreads along the camera's right and up axes, so it reads as a sphere:
  a smooth round normal, a procedural leaf texture (`leafTexture()`, seeded, mipmapped), an outline cut
  into leaf tips (alpha to coverage on the multisampled target, a hard cut on low) and, on medium and
  up, the sphere's own depth (`sphereDepth`), so crowns meet buildings, the ground and each other
  round. Shadows come from the back of the crown (`foliageDepthMaterial({ puff: true })`). Spruces keep
  their layered skirts (reshaped per tree, six presets) and take the needle texture (sprays, drooping
  hem); ferns and palm fronds are ribbons cut by the same texture (`needles` option of
  `patchFoliageMaterial`). Leaves get wrapped light, light through them, a sun-side rim, a cool tint in
  the shade and a night grade that follows `WORLD_UNIFORMS.uNight`. `createForest` / `createDecor`
  take `{ quality }` and return `setQuality` (low draws the puffs as flat discs and keeps the early
  depth test). Triangle budgets: a tree up to 160, decor up to 200 (tests/render/props.test.js,
  foliage.test.js). Decor (map decor, undergrowth, boulders) keeps off the terrain's sandstone
  outcrops (`decorOffOutcrops`: plants not at all, boulders only at the foot, read from the ground
  field's rise). Look at them with `tools/gallery-foliage.html` and `tools/shot-foliage.mjs`.
- Status markers (`src/render/status-markers.js`, `StatusLayer`: instanced, procedural
  glyphs): icons above the health bar in the order buff, debuff, slow, dot; a rimmed bubble
  around shielded units; slow keeps a frosty ground ring, invulnerability a double gold ring,
  stun its stars. Flyers' selection/hover/status rings are drawn at flying height.
- Workers whose view has `mw` (waiting at a full gold mine) are animated idle, facing the
  mine. Construction sites are clipped at their build height and show a dark plank interior
  (back faces, and horizontal surfaces just below the cut) instead of the finished
  building's walls and ceiling.
- Selection rings colored: own green, ally yellow-green, enemy red, neutral yellow.
  Health bars over damaged/selected/hovered units (all with Alt held).
- Walls (`building-models.js` `buildWoodenWall` / `buildStoneWall`): a segment is a post with arms
  towards the neighbours its *connection mask* names (`wallConnections`: the low four bits are N, E,
  S, W; the same bits shifted up by `WALL_TOWER_SHIFT` mark a neighbour that is a tower, whose arm
  runs on into the tower's footprint because the tower stands well inside it). Each mask is a cached
  geometry of its own and `model.setConnections(mask)` swaps it in place. A segment is two meshes
  (body, team band) so a long wall costs two draws a segment; it has no foundation and no scaffold
  (a site rises out of the ground) and its look follows the pantheon's wall material.
  `GameRenderer.syncWallJoins` (once per snapshot, after the building views) computes every
  segment's mask from the same-owner wall and `joinsWalls` tiles around it (`wallTiles`), so a tower
  in line with a wall visibly joins it and a segment that fell is no longer reached for; a segment
  upgraded in place (the view's type changed) gets its stone model in place. Walls draw slim
  selection rings, no fires, no worn yard under them, a health bar only where hurt, hovered or with
  Alt held, and a progress bar only when hovered. `PlacementLayer.showLine(typeId, tiles, kindAt)` is
  the ghost of the dragged line: a segment per tile to build (red where blocked), joined to its
  neighbours and to the walls that stand, over a per-tile grid.
  In a Decade of Peace (5.10) `GameRenderer.setNoBuildZones(anchors)` (→ `PlacementLayer.setZones`)
  gives the layer the enemy Town Centers whose surroundings stay clear; `NoBuildZone`
  (`src/render/no-build-zone.js`) drapes one mesh of tile quads on the terrain over every tile within
  `PEACE_BUILD_GAP` of them (`zoneMask`, the sim's own `peaceBlocksFootprint` per tile): a red tint with
  diagonal hatching and a brighter pulsing line only where the zone ends (not along the map's edge),
  drawn in the overlay scene under the footprint grid, visible exactly while a building or wall ghost
  is, rebuilt only when the Town Centers change.
  Sacred sites (5.11): `SacredSiteLayer` (`src/render/sacred-sites.js`) draws each site from `map.sacred`: a paved
  circle with seven standing stones, a stepped altar and a floating crystal (about 520 triangles, the stone shared by
  every site), the crystal, runes and ring pale gold when neutral and in the holder's colour when held (with a faint
  light beam), and a ground arc at the capture radius filling with `p` in the capturer's colour (flickering while
  contested). Decor and ground cover keep off the paving, and mapgen's render part flattens the ground under it.

## 9. UI (src/ui/) — HTML/CSS overlay

- `menu.js` (+ `style.css`): title screen (Play vs AI, Host Online, Join Online, How to Play,
  Career (9.1), Settings; the big buttons in two columns, Play vs AI across both, or beside Continue when there is a
  save, the Daily Challenge across both when there is no Quick Match, and Load Game, How to Play, Career and Settings
  in one row of small buttons, so everything and the footer fit a 1280x720 window without scrolling; windows under
  820 px high get a smaller crest and tighter spacing; a "New" tag sits on its button's top edge), lobby screen (4 slot rows: color, name/kind dropdown, pantheon picker with
  Random, team, AI difficulty; presets; map size; landscape (Wildlands, Highlands, Rivers, Islands, Great Forest or Random, 6.7, as chips with a one-line note; clients see it as text); game mode (Standard, Decade of Peace with
  30 / 45 / 60 min buttons, or Trial of the Titans with its rules and the player's best wave, 5.14; the host's pick;
  clients see it as text), victory (a Sacred Victory toggle, 5.11, hidden in a trial;
  clients see it as text); room code with Copy and Copy Invite Link
  `?join=CODE`; chat; Start for host, in a footer under the lobby that stays on screen while the lobby scrolls
  above it, never over it), join screen (name + code), how-to-play (the rules in eight steps, then tips: Learn to
  Play, the Campaign, the Daily Challenge, saving and loading, replays), settings
  (name, volume, graphics quality, time of day, intro film with a narration toggle and a "Watch it now" button, edge scrolling). Pantheon picker shows each pantheon's gods,
  titan and creatures (from data) so choosing is fun, plus its two blessings and its elite soldier; the lobby
  preview shows the same rows.
  Play vs AI opens the lobby with one AI on a small map. Its AI players (the presets' too: `LobbyHost` option
  `aiDifficulty`) start on **Easy** until this device's career has a win against the computer (any difficulty,
  `hasBeatenComputer`, 9.1), then on **Normal**. While Easy is the default, that slot's dropdown reads
  "AI — Easy (suggested)" and a hint line under the players says the computer plays on Easy for a first game
  (hidden once no AI is on Easy). Online lobbies keep Normal and show neither; Quick Match keeps reusing the last
  lobby as it was. In the battle HUD a pantheon chip (top left, `rPantheon`) carries the pantheon's
  emblem and name, and its tooltip lists the blessings and the elite soldier. The top bar's left group stops short of
  the centre banner: when its chips (Market, clock, sites, peace or wave, ping, pantheon, relics) run long, the
  pantheon's name gives way and ends in an ellipsis (the name alone is hidden under 1100 px wide).
- `hud.js` (+ `hud.css`): WC3-like layout. Top bar: gold, wood, faith (+rate), population,
  game clock, menu button. Bottom panel: minimap (left), selection (center: single unit
  portrait/icon, name, hp, armor, damage, level/xp bar, statuses, queue with progress and
  cancel; multi-select grid of icons with hp), command card (right, 4×3 buttons with hotkeys,
  tooltips with cost/description, cooldown overlays, disabled when unaffordable/locked).
  Market button (⚖️, top bar, only while a teammate is alive) opens the team market panel
  (`src/ui/hud-market.js`): teammate picker with their gold / wood / faith, resource choice,
  amount with +50 / +100 / +250 / +500, Max and Clear, a line saying what arrives after the
  market's cut, and Send (disabled with the reason while the trade would be refused). Received
  and sent shipments show as messages.
  Sacred Sites (5.11): a 🛐 chip next to the clock shows the sites your side holds out of all of them and, while a
  side holds every one with Sacred Victory on, the countdown (green for yours, red and pulsing for a rival's). Alerts
  (`src/game/alerts.js`): your capture (a chime, all), a teammate's (all), a rival taking one or you or a teammate
  losing one (important, Space jumps there), a side holding every site and that hold broken (a gong), and a line
  with a gong at 2:00, 1:00 and 0:30 left on the countdown. The minimap draws each site as a diamond in the
  holder's colour. One line as a Sacred Victory game opens.
  Decade of Peace (5.10): a 🕊️ countdown chip sits next to the game clock (tooltip explains it,
  it turns amber and pulses for the last minute and is gone when the peace ends); one line as the
  game opens, a reminder at 5:00, 1:00 and 0:10 (not for marks already passed when the HUD
  opens), and a "war begins" banner with the horn on `peaceEnd`. Right-clicking or attack-ordering a
  protected player marks a walk, and the sword cursor does not show over it. Placing a building shows
  the ground an enemy Town Center keeps clear: tinted under the ghost, the ghost's tiles inside it red,
  and a red tip by the cursor with the reason (`InputController.showPeaceZone` / `peaceTip`; the same
  text a refused click and the sim give).
  God portraits top-left (click selects, double-click centers). Messages (alerts, "Kronos is being summoned!",
  the game's other events, chat on Enter) are the stone cards at the bottom left ("The message feed" below);
  an error is the red line over the console. Game-over overlay with the after-game chronicle (below), menu (surrender, quit).
  **After-game chronicle** (`src/game/chronicle.js`, `src/ui/hud-chronicle.js`): the victory / defeat / draw screen and
  the "game ended" screen have four tabs, after the Age of Empires score screens. Summary: pantheon, score (its tooltip
  splits it into economy, military and civilization, 5.11), kills, losses and gathered, then the awards: Warlord (most
  kills), Conqueror (most buildings razed), Tactician (best worth destroyed less worth lost), Marshal (largest army),
  Treasurer (most gathered), Prophet (most faith), Architect (most buildings), each to the best player or players on a
  tie, only when above zero and not shared by everyone, none in a match of one; the local player's awards are lit.
  Economy: gold, wood, faith, trained, buildings, research count, tier. Military: kills, losses, razed, worth destroyed,
  worth lost, largest army. Timeline: an SVG line chart, a line per player in their (sanitized) colour and the local
  player's thicker, of Score, Army, Resources (gathered + faith) or Kills. The `Chronicle` listens to the ViewState's
  snapshots and writes a sample at the first one, every `SAMPLE_EVERY` (30) s of game time and once at the game's end,
  and keeps each player's largest army; all of it is read from the players' snapshot records, so nothing is sent for
  it and a client charts the same match as the host (a player who joined late has a shorter chart).
  `tools/shot-chronicle.mjs` stills the four tabs over a made-up 24-minute match.
  **Play Again and Quick Match** (`src/game/rematch.js`): a game hosted here with only AI players besides the local
  one (`isSoloLaunch`) keeps its lobby state (checked by `sanitizeLobbyState`: one host slot, no other humans, two
  teams or more) in localStorage (`mythicwar-last-skirmish`). Its game-over screen leads with Play Again, which leaves
  the match like Return to Menu and starts that lobby anew with a fresh seed (`launchFrom` → `buildSetup`: a new map,
  random pantheons drawn again, the host slot named as in Settings). The title screen shows Quick Match under Play vs
  AI once a game is remembered ("Again: 1 vs 1 · Normal AI · small map", `skirmishLabel`), one click to that lobby.
  Online games offer neither.
  **Game speed and interface size** (settings `gameSpeed`, `uiScale`; factors `GAME_SPEEDS`, `UI_SCALES` in config.js;
  choices in `src/ui/speed-options.js`, shown in Settings and the F10 menu). A match with no other people in it
  (`Game.solo`, fixed at start) runs at Slow 0.5×, Normal, Fast 1.5× or Very fast 2×, changeable at any time from the
  F10 menu: `Ticker.setSpeed` runs that many more or fewer ticks a real second (each tick is still `DT` of game time,
  so the sim and its determinism are untouched), `ViewState.setRate` plays the snapshots back on local time × rate
  (re-anchoring the clock; above normal the interpolation delay stays as long in real time), and
  `GameRenderer.setSpeed` scales the animations' dt but not the camera's. Online games always run at Normal and their
  F10 menu leaves the row out. The interface size multiplies the HUD's base font size (`--hud-scale` on #hud-root):
  Small 0.85, Normal 1, Large 1.15, Larger 1.3; every HUD panel is sized in em, so all of it follows.
- Getting-started tips (`src/ui/hud-tips.js`): a checklist in the top-right corner (mine gold →
  build → pray at a Shrine → summon a god → Titan Gate). Steps tick themselves from the
  ViewState and stay ticked; ✕ or finishing every step saves `tipsDismissed: true`
  (src/settings.js), and Settings or the F10 menu can turn them back on. Hidden for spectators
  and defeated players.
- Alerts, tips and sounds: ways to pull a player back into the match and keep them company. All of it is
  client-side, driven by the ViewState and three settings (`alerts`, `hints`, `tabAlerts`, in Settings and
  the F10 menu); nothing is sent over the wire and the sim knows nothing of it.
  **Alerts** (`src/game/alerts.js`, `AlertEngine`, created in `Game.init()`; `Game.onAlert` carries each one
  out: HUD line, sound, minimap ping, the spot Space jumps to, the tab flash). It listens to ViewState events
  and, once per snapshot at least 0.5 s of game time after the last, surveys what the player holds and can see.
  Time is game time, so a paused or stalled match neither nags nor forgets, and a hidden tab (whose frames stop
  but whose snapshots do not) still gets its alerts. The first survey is the baseline: a match joined part-way
  announces nothing already behind it. `alerts` is `'all'` (default), `'important'` (warnings only) or `'off'`
  (no extra line, sound or ping; the game's own battle warnings still sound). Warnings: **enemies near**
  (a hostile unit in sight within 18 tiles of one of my buildings: line with a Space key cap, war drums, an amber
  ping and the Space jump; not within 8 s of an under-attack alert, at most once per 45 s, and a new sighting
  needs 10 s without enemies), **ally under attack** (softer drums, a ping in the ally's colour, once per 20 s
  per ally; Space only if my own alert is older than 15 s), and the **Decade of Peace marks** (a gong, louder
  at each of 5:00 / 1:00 / 0:10; the HUD writes the line). Reminders (`'all'` only): **idle Worshippers**
  (standing idle for 20 s, then every 60 s), **population cap** (at the cap below `POP_MAX` for 10 s
  with no House going up, every 120 s), **a god or Titan you can afford** (an idle Temple or Titan Gate and
  the means for 8 s; every 180 s / 240 s), **an idle army** (from 6:00, 6 or more soldiers, gods and
  creatures, 80% of them idle for 2 min, no peace and no enemy near; every 5 min), **research finished**,
  and **milestones** (kills 1, 10, 25 … 1000; population 25 … `POP_MAX`; gold and wood gathered; units
  trained; one cheer per 20 s). One alert sound per 2 s unless the next matters more (`PRIORITY`).
  **A tab left behind** (`src/ui/tab-attention.js`, `TabAttention`): while the page is hidden or the window
  unfocused, the alerts that need the player (an attack on the base or the forces, enemies near, an ally
  attacked, an enemy Titan rising, the peace ending, a god or Titan of mine arriving, a tier grown, the last two
  peace marks, the end of the match) flash the tab title ("(n) ⚠ Your base is under attack!", once a second) until
  the player returns. `tabAlerts` is `'title'` (default), `'off'` or `'notify'`, which also raises a silent
  desktop notification (one at a time, at most one per 15 s, closing itself after 8 s; a click focuses the
  window). The browser's permission is asked when the player picks Notification in the settings (a click);
  if it is refused, blocked or missing, the choice falls back to `'title'` and the note under it says why
  (a pick made while the prompt is still open stands: the late answer does not overwrite it).
  A single-player match pauses itself in a hidden tab (section 11), so the flash serves multiplayer and a
  window left unfocused beside the game.
  **Gameplay tips** (`src/ui/hint-data.js`, `src/ui/hud-hints.js`): about 40 one- or two-sentence tips
  (controls, economy, gods, war, walls, the Decade of Peace) in the card at the top right, under the
  getting-started checklist while that is up: the first 90 s into a match (30 s after joining part-way), then
  one every 150 s of game time. The tips heard least come first, and one that fits the match (it has
  Worshippers, an army, walls, a god, a Barracks, a damaged building, is in a peace or in a team) before a
  general one; none is told more than twice across matches (`localStorage` key `mythicwar-hints`). The card
  yields to a fight (30 s after the player's things were hit, and whenever a warning is shown to the player;
  one the settings silenced does not count), stays 9 to 18 s by
  length (while the pointer rests on it, and 4 s after), and has ✕ and "Turn tips off" (saves `hints: false`).
  A soft chime goes with it when `alerts` is `'all'`. A tip is text with `[[Key]]` markers drawn as `<kbd>`;
  the hotkeys and numbers it quotes come from the data (`tests/ui/hud-hints.test.js` checks them). The
  loading screen ("Preparing the battlefield…") shows one general tip under the spinner.
  **Sounds** (`src/audio/sfx-alerts.js`, merged into the tables of `sfx.js`): `nudge` (two soft notes: a
  reminder), `drums` (four war-drum beats), `gong` (the peace is about to end), `research` (an upgrade
  finished), `tip` (a tip appeared) and `milestone` (a short fanfare).
  **The message feed** (`Hud.message`, `Hud.chat`; `src/ui/hud.js`, `src/ui/hud-data.js`, the "messages" block of
  `hud.css`): everything the HUD tells the player (alerts and reminders, milestones, the game's own events, the
  peace marks, chat) is a card at the bottom left, above the idle button and the task counts, in the tips' carved
  stone: an emblem chip (the line's own sign, a unit's, building's or god's emoji or a resource's, else its kind's
  from `messageIcon`; the stylesheet draws it from the card's `data-icon`), an edge in the colour of its kind
  (blue news, gold good news, orange warning, grey system line, the sender's colour for chat) and the text at
  1.18 em. A card slides in with a flash of its colour (a warning pulses three times), stays 10 to 16 s by length
  (`messageDwell`: 8.5 s plus 45 ms a letter, 2.5 s more for a warning; chat 14 s) and fades. A line that comes
  again while its card is still up (enemies still near, a second "Temple completed.") counts up a ×N badge and
  slides in again instead of stacking another card. At most 6 cards stand, the oldest going first. A `[[Key]]`
  marker in a line is a key cap, as in a tip (the base-attack card ends in a Space cap, the idle-Worshipper card
  in a . cap), and the cards are text nodes only, never markup. The feed is `role="log"`, `aria-live="polite"`, ignores the pointer (clicks go
  through to the map) and keeps clear of the console, the minimap, the tips and the god portraits (measured from
  800×600 to 3440×1440 and at the 170-tile zoom). The three settings decide what is written, not how it looks.
  Reduced motion turns the animations off.
- Info panel (`src/ui/hud-info.js`): a selected gold mine shows "Gold left", "Miners n/2"
  (snapshot `mn` / `MINE_SLOTS`), how many of your Worshippers work there, and the
  2-at-once rule. A worker's state line reads "Gathering gold", "Chopping wood", "Repairing", or
  "Waiting its turn at the gold mine" (view key `mw`). An own building lists the Worshippers
  building, repairing or praying there and the upgrades researched for its type; armor, tower
  damage / range, housing and faith rates include the owner's upgrades (`players[i].up`); a
  Town Center lists only the highest level of each upgrade line. A Worshipper also shows a "Work"
  stat (Normal, or +N% from the work upgrades), and the gold mine's rule line and the Gather
  tooltip quote the viewer's own trip ("1.3 s per 12 gold"). A House's note tells how to combine four
  into a Manor and a Manor's says how much more housing it gives than the Houses it replaced (+16).
  **Queue row** (own buildings with a queue of up to `MAX_QUEUE` = 50): the big button is the item in progress
  (its bar, "Training Worshipper") with a "n / 50" count at the right once more than one is queued; after it,
  the rest of the queue as runs of the same item, one button each with a count on the runs of two or more
  (50 Worshippers are the one in progress and a single button with 49), at most `QUEUE_CHIPS` (12) buttons:
  more runs than that fold into a last "+N" button. A click takes one unit of a run back (the last of it),
  Shift-click the whole run; on the big button a click takes back the item in progress and Shift-click the
  whole queue; on "+N" a click takes back the last item and Shift-click everything it folds. A Shift-click is
  one `cancelTrain` with `count` (5.4), so a whole queue refunds in one command. Esc still takes back the
  last queued unit, and Shift + a train hotkey or button still queues 5 at a time (a held hotkey repeats).
- Worshipper tasks: a bar bottom-left, next to the idle button, counts own Worshippers per task
  (snapshot `tk`: gold, wood, pray, build, repair, idle, other); clicking a count selects them
  (Shift adds). A multi-selection with Worshippers shows the same counts for the selection.
- God power bar (`src/ui/hud-powers.js`, `PowerBar`): three round buttons on the left of the minimap, one per power
  of my pantheon (4.11), Village at the top. Locked (grey) until my settlement reaches the tier, ready (a slow
  golden glow) once it has, dark once spent; the tooltip names the power, its tier, what it does, its area and why
  it cannot be used now (`powerState`: tier, spent, or a strike during the Decade of Peace). A running blessing
  counts its seconds down on its button. Pressing a ready one arms `{ kind: 'target', order: 'power', power }`
  (`input.armPower`, the marker buttons' plumbing: the button again, Esc or right-click puts it away); the next
  click on the map or minimap casts it there, and while armed a ring (`.hud-powerring`, projected each frame) shows
  its area under the cursor, red where I cannot see. A strike aimed into the fog stays armed with "You must be able
  to see the target." Every cast is announced (`godPower` event, `game.js`): mine as a line and a chime; an ally's as
  a line and a gold minimap ping; an enemy's strike as an alert line, a red minimap ping and the Space jump, its
  cataclysm as a banner, and it flashes the tab (`power_enemy`). A telegraphed effect's sound waits for its
  `delay`, so a barrage cracks bolt by bolt.
- Team pings and markers (`src/data/marks.js`, `src/game/team-marks.js`, `src/ui/hud-marks.js`; the wire is in 7).
  Five kinds: Ping 📍 (stands 6 s), Attack ⚔️, Defend 🛡️, Help 🆘 (the urgent one: a louder chime) and Gather 🚩
  (12 s each). **Placing**: Alt+click or a middle click on the map or the minimap pings that spot (a unit or
  building under the cursor is marked where it stands). A middle press that ends within `PING_CLICK_MS` (350 ms)
  without moving more than `DRAG_THRESHOLD` (5 px) is the ping, anything else was a camera drag and pans as it
  always did (it starts to pan once it passes the threshold). Alt+click pings only while no order or placement
  is pending, because Alt held also shows every health bar and a click that aims an order stays an order; the
  middle button works in every mode. On the minimap either gesture is one press with no drag after it. The five
  marker buttons beside the minimap (`MarkPalette`) arm a targeting mode `{ kind: 'target', order: 'mark', mark }`
  that reuses the Esc / right-click / Shift plumbing: the next click on the map or the minimap places that marker
  (the button again, or Esc, puts it away), and a refused one (the pace limit) leaves it armed. **Who sees them**:
  the sender and their teammates (7); with no human teammate the buttons' tooltips say that only you see it, and
  the "Team ping: Alt+click or middle-click…" hint is shown once at the start of a match only when a teammate
  has a screen. **How they stand** (`TeamMarks`, one per `Game`): a mark lives `MARKS[kind].life` seconds; a
  player holds at most `MARK_MAX_PER_PLAYER` (3) marks, a new one retiring their oldest; a marker (not a ping)
  replaces its sender's earlier marker of the same kind, so each player has one Attack, one Defend and so on;
  at most `MARK_MAX_TOTAL` (16) stand on a screen. **On the map** (`MarksLayer`, DOM under the panels, projected
  each frame with `renderer.worldToScreen`): a pin with the sender's name, a round badge with the kind's icon
  (the kind's colour on the badge, the sender's colour on the ring), a stem and a ring on the ground. A mark out
  of view or under the top bar or bottom console becomes a chip on the edge of the play area with an arrow towards
  it (a spot behind the camera is aimed by where it lies on the ground, since it projects mirrored), and a click
  on the chip centres the camera on the mark. A spot in view but just under the top bar (less than `PIN_EM`, 5.6 em,
  below it) gets its pin hanging below it, stem up (`is-below`), so the pin never goes under the bar. Chips of marks in one direction can overlap (accepted). **On the
  minimap** (`Minimap.drawMarks`): two rings spreading in the sender's colour and a badge with the icon, kept
  inside the map. Every mark fades over its last 0.8 s. **Sound and text**: `ping`, or `ping_urgent` for Help,
  not positional; my own mark plays quieter; a teammate's marker (not a ping) also writes its words ("Attack
  here!") in the message area in their colour for a player with the sound off. The How to Play screen has a
  "Team signals" group.
- `input.js`: left click select, drag box select, shift add/remove, double-click selects same
  type on screen, Ctrl+1–9 groups, 1–9 recall (double tap centers), right-click smart command
  (shift queues), hotkeys from the command card, targeting modes (attack-move A, ability
  targeting, build placement with ghost (a refused click shows the client-side
  `checkPlacement(...).message`); Esc cancels; right-click cancels targeting; another command
  hotkey replaces the pending order), camera: edge scroll, arrow keys, mouse wheel zoom (one
  step per ~100 px of scroll, so trackpads zoom gently; each step is 16% of the distance, from 10
  tiles to 170, where a whole medium map is in view), middle-drag pan (a middle click that does not move
  pings the team instead), minimap click/drag, Space centers on selection or last alert, F1–F3 select gods,
  Alt shows all health bars (Alt+click pings the team, see Team pings and markers above).
  Key auto-repeat acts once per press, except arrows and Train hotkeys (hold W to queue).
  **Delete** destroys the selected own units (`kill`, 6.2; the whole selection, not only the active subgroup).
  **Backspace** does the same: it is the key a Mac keyboard labels "delete" (fn + delete sends Delete), and a
  question one of the two keys asked is answered by a press of either. Buildings are not units: they stay, and a
  selection of nothing but buildings says so (`Delete destroys units, not buildings.`; walls have D, an unfinished
  building Esc). Up to `DELETE_CONFIRM_ABOVE` (5) plain units go at once. More than that, or any god or Titan,
  first says what it would destroy (`Press Delete again to destroy 12 units, including Zeus.`) and goes on a second
  press within `DELETE_CONFIRM_MS` (2.5 s) while every selected unit was among those asked about: units lost or
  taken off the selection meanwhile do not matter, one added does. Esc (which then does nothing else), waiting or
  leaving the window takes the question back. Key auto-repeat, Ctrl / Alt / Cmd + either key, typing in chat and an
  open menu do nothing. Destroying units also ends a pending placement or targeting. The jump to your Town Center
  that Backspace used to be is **Home** now (fn + the left arrow on a Mac laptop). Rules and texts in
  `src/ui/delete-key.js`.
  **Walls**: with a wall type chosen in the build menu (W) the left button goes down on the first
  tile and the line follows the cursor in the nearest of eight directions (`wallLine`); releasing
  orders it for all selected workers (`build` with `tx2` / `ty2`; Shift keeps laying walls). A tip by
  the cursor says what the line would build and cost ("12 × Wooden Wall 🌲 144", red when it is
  short or nothing can be built); a refused line keeps the mode so a shorter one can be tried.
  The ghost shows tiles farther than `WALL_PLACE_RANGE` from every selected worker as blocked
  (`checkWallLine(..., workers)`, the sim's `Too far from your Worshippers.`).
  Right-click, Esc or losing the window drops the drag first and leaves placement on the second
  press; letting go where no ground shows (past the map's edge) orders nothing. A wall-only selection holds up to `MAX_WALL_SELECTION` (160) segments (any other selection
  `MAX_SELECTION`); a selection of more than 24 shows a crowd panel (a stack per type with its count,
  the total health, how many are hurt, being built or upgrading) in place of the icon grid (rebuilt when walls of the selection turn to stone); a drag box prefers other buildings
  over wall segments, so the walls are not picked by accident. `game.js` folds a run of
  destroyed segments into one "Your wall was breached!" message per 6 s.
- `command-card.js`: pure function `getCommandCard(selection, viewState, mode) → buttons[12]`.
  Hotkeys: units M move, S stop, H hold, A attack; workers + G gather, B build (submenu: House H,
  Barracks B, Shrine S, Storehouse O, Tower T, Temple E, Titan Gate G, Town Center C, Wooden Wall W), P pray,
  C return cargo, R repair (targets an own building), T Auto-Repair on/off (lit while on);
  abilities Q W E R in the bottom row. Buildings: train buttons (Town Center:
  Worshipper W, Grow U; Barracks: Warrior W, Archer A, Priest P, Ram R, pantheon elite E; Shrine: creatures Q W E;
  Temple: gods Q W E R + revive; Titan Gate: titan T), rally Y, cancel construction Esc.
  Wall segments: U upgrade to stone (every idle segment of the active subgroup, as many as the purse
  allows), D dismantle finished segments, C cancel unfinished segments or upgrades.
  Houses: U combine into a Manor (5.3), C cancel the combining. The button reads the same rule as the
  sim (`planMerges` in `src/data/houses.js`) from the finished Houses of the active subgroup: it says
  how many squares of four they make ("Combine into 2 Manors"; the cost is the sum), and is greyed out
  with the sim's own text when they make none (too few Houses, not a square, one of them busy) or locked
  until a Town; when the purse covers fewer squares than there are, the tooltip says how many it can pay
  for. A House being combined shows the upgrade in its queue and a Cancel button; a Manor's card
  offers the House upgrades (the Houses' list, shared) in the same slots.
  Each building's upgrades fill the free middle / bottom slots with their data hotkey (no two
  buttons of a card share a key); researched ones stay as dim "(researched)" buttons. An upgrade
  line takes one slot and shows its next level to research ("Level 2 of 3."), keeping the line's
  hotkey; the last level stays as the dim button when the line is done (`offeredUpgrades`).
  The Town Center card therefore reads Worshipper W, Grow U / Iron Picks I, Palisade L, Work
  K, Health H / Rally Y.
- `minimap.js`: 2D canvas: terrain colors, mines, trees, units/buildings as team-colored dots
  (visible only; wall segments as thin squares), fog, camera quad, the team's marks (rings and badges);
  click/drag moves camera, right-click issues smart move, Alt+click or middle-click pings the team.
- Audio `src/audio/sfx.js`: WebAudio-synthesized sounds, `sfx.play(name, { x, y })` with
  distance attenuation from `sfx.setListener(x, y, scale)` (the camera target; `scale` follows the
  zoom, 0.8 close, 1 at the default zoom, 4.5 at the 170 tile far limit, and stretches the hearing
  range so a zoomed-out view still hears its far side).
  Names: click, select, move, attack_melee, attack_ranged, hit, death, build, building_complete,
  train, summon_god, summon_titan, lightning, fire, magic, heal, error, victory, defeat,
  tier_up, chop, mine, pray, horn, ping, ping_urgent.
  The `AudioContext` is made, and asked to run, as the page loads (`sfx.init`, from `initAudio`). A browser that allows
  sound with no input (a site set to "Sound: Allow" in its site settings, Chrome's `--autoplay-policy=no-user-gesture-required`,
  a page reached by a click on a link of the site) runs it at once, and everything is heard from the
  first moment. The others keep it suspended until the first key press, click or tap (`pointerdown`, `pointerup`,
  `mousedown`, `click`, `keydown`, `touchend`, and the tab coming back to view), which resume it; mouse movement,
  scrolling, Esc and a modifier key alone are no input to the browsers, and nothing a page can do changes that.
  `sfx.ready` says whether a sound would be heard now, `sfx.onReady(cb)` calls back once it would (at once if it
  would be now), `sfx.supported` whether the browser has WebAudio at all.
- Music (`src/audio/music.js`, `music-composer.js`, `music-theory.js`, `music-themes.js`, `music-voices.js`, the hub
  `src/audio/audio.js`, and `src/game/music-director.js`): background music for the title screen and for matches,
  composed and synthesized live with WebAudio (no audio files). It shares the sound effects' `AudioContext` and master
  limiter (`sfx.shared`), so the browser's audio unlock (above) happens once for both, and it steps back
  under the stingers in `DUCKS` (`summon_god`, `summon_titan`, `victory`, `defeat`, `tier_up`, `horn`; heard through
  `sfx.onPlay`). `initAudio(settings)` and `syncAudio(settings, changed)` (`main.js`) start both engines and carry the
  settings over; `playTitleMusic()` is what each menu screen calls (a no-op while it already plays);
  `quietMusic()` clears whatever plays as the intro film (11.1) starts (the film starts a score of its own when its first
  frame shows, under its narration; `main.js` calls `playTitleMusic()` at the hand-over to the menu, which carries that
  score on or, after a skip, starts the title's own); `previewMusic(themeId, intensity)` is Settings → Music → Listen. The engine is
  `music.play(themeId)` (crossfades; remembered until the browser allows audio), `stop(fade)`, `setIntensity(0..1)`,
  `setVolume`, `mute`, `duck`, `state()`, and four things for the intro film: `conduct(v)` (the intensity set exactly, with
  none of the easing), `setStage(gain, tc, delay)` (see below), `setStingers(on)` (whether the sounds in `DUCKS` make
  the music step back; the film turns it off) and `play(id, { seed, joinAt })`: when a piece has been going on without
  being heard (the film, until a first visit's click), `joinAt()` is asked each time a run is made and answers
  `{ seconds, levelAt }`, so the run composes that many seconds of the piece without sounding them (`Run.skip`, at the
  intensity `levelAt` gives each bar) and comes in on the bar in progress, in the section the piece would be in (the held
  pad chord is struck again for it). `state().waiting` is true while a theme is wanted and only the browser's
  click is missing. All of it is a no-op where WebAudio is missing (Node), a voice that throws is muted from then on and five
  scheduler faults in a row switch the music off: it cannot break the game.
  **The score.** Eleven themes (`music-themes.js`: `menu`, the title screen's grand D minor with horns and a choir, and
  one per pantheon, each with its own mode, tempo, instruments and rhythms). A theme is data: mode, bar length, an
  instrument per role (`inst.leadHot` is the lead of tense sections), calm and tense chord progressions, a two-bar
  motif and the rhythm patterns of each layer. `music-composer.js` is pure and seeded (the same seed plays the same
  piece) and writes one bar at a time, in four-bar sections. Layers join as the intensity rises: pad, drone and the
  culture's plucked arp always, the lead on most bars (the theme's tune, or a wander), bass from 0.10, a soft pulse
  from 0.18, the groove from 0.40, war drums, horn calls, fills and crashes from 0.62. A section uses a calm
  progression until the intensity passes 0.55 and a darker one until it falls below 0.38. Every chord and note comes
  from the theme's mode, so any combination is consonant (`tests/audio/music-composer.test.js` checks it).
  **The engine.** A look-ahead scheduler (a tick every 250 ms) composes bars 1.6 s ahead and creates each note 0.6 s
  before it sounds (a note waiting in the audio graph is not free); after a stall it carries on from the clock instead
  of catching up, and a hidden tab fades the music out and stops making notes. Layers (pad, drone, bass, arp, lead,
  perc, war, fx) are buses with a gain and a send to one mono 2 s hall reverb; a new theme crossfades in, 0.9 s after the old
  one begins to leave (so two keys never ring together for long, and a piece begun just after another was let go of, as the
  film's score is after `quietMusic()`, waits out what is left of that); the intensity
  eases toward its target (1.5 s up, 7 s down: a fight ends slowly). The volume is `0.63 * v^1.5` into the limiter.
  The graph is layers → run mix → `bus` (the volume) → `duck` (the stingers' dip) → `stage` (the intro film's mix, a
  gain at 1 outside the film, moved by `setStage` and remembered for a context that does not exist yet) → `hide` (the
  hidden tab's fade) → the limiter: four gains that never touch each other's automation, so the film's mix and a stinger
  or a mute can overlap. `renderMusicOffline` takes a `stageAt(seconds)` for the same stage and a `fadeIn`.
  **The instruments** (`music-voices.js`, 49): plucked strings, a mallet, 14 breath, reed and bowed leads, 5 pads, 16
  drums, bells, gongs and horns, all oscillators, filters and noise. A score plays dozens of notes a second and every
  live node costs the audio thread for as long as it lives, so the recipes are lean: vibrato is a value curve, not an
  oscillator; filter sweeps and scoops run once per render block (`automationRate = 'k-rate'`, three to five times
  cheaper); a note's tail is cut 45 dB below its peak; a voice has one envelope and as few gains as will do.
  **Tension** (`music-director.js`, made by `Game.init`): a leaky "heat" fed from the ViewState (blows on the player's
  side or struck by it, losses, a Titan rising, the peace ending), cooling with a time constant of 10 s, becomes the
  intensity `1 - exp(-heat / 55)`. In the Decade of Peace it stays under 0.3 (creature fights only) until the horn.
  **Settings.** `musicVolume` (0..1, default 0.5) and `musicMuted`, apart from the sound effects' `volume`. Settings →
  Music has the slider, a Mute button and a Listen row that plays any theme as Calm, Tense or Battle; the F10 menu has
  "Sound effects" and "Music" rows. Moving the music slider lifts a mute.
  **Measured, not heard.** Nobody has listened to this score yet; what was measured, with the offline renders of
  `tools/music-render.mjs` (WAV files for ffmpeg's `ebur128`) and a live headless Chromium (the DevTools WebAudio
  domain's render capacity, the audio thread's share of its time budget): at the default volume every theme sits
  within about 1.5 dB of the others, about -32 LUFS when calm, -29 in between and -26 in a full battle, true peak at most
  -8.6 dBFS; the audio thread's load with the music is 5 to 7 % when calm and 9 to 13 % in battle (an idle audio context
  alone is 3.4 %, the heaviest theme is Aztec in battle). `tests/audio/music-budget.test.js` holds the number of
  sources sounding at once and of nodes made per second, the two things that load tracks, inside limits above
  today's. `tools/music-lab.html` plays any theme at any intensity.

### 9.1 Career and achievements (src/game/career.js, src/game/career-tracker.js, src/data/achievements.js, src/ui/menu-career.js)

Client only: nothing goes over the wire and the sim does not know about it. The career lives in
localStorage under `mythicwar-career` (guarded like the settings; a damaged value is cleaned by
`sanitizeCareer`): games, wins, losses, draws, game time played, kills and resources gathered, games
and wins per pantheon, records (most kills, most gathered, longest game, best Trial of the Titans wave:
`recordMatch` takes an optional `wave`, 5.14), wins against a side with a computer player in it (`aiWins`;
`hasBeatenComputer` is true with one, or with Proving Ground, Hard-Won or Undaunted unlocked, for a career kept
before `aiWins` existed: it sets Play vs AI's default difficulty, 9), the last 12 games, unlocked
achievements with the time, and the ones not yet seen.

- `CareerTracker` (built by Game for the local player; a spectator has none) reads the ViewState's
  events and snapshots: gods and Titans summoned (`spawn`), enemy Titans falling and own non-wall
  buildings lost (`death`), `tierUp`, `levelUp`, `rankUp`, and once a game second the player record
  (gods on the field, kills, gathered) and own entities (best god level and rank, a finished Manor or
  stone wall). The sides come from the setup: own pantheon, team size, enemies with kind and AI difficulty,
  and whether the Decade of Peace is on.
- An achievement is `{ id, group, name, icon, desc, test(m, c), progress?(c) }`: `m` the match's facts,
  `c` the career with the match counted. Mid-match the tracker checks with `m.result` null, so the ones
  that need no result (Summon a Titan, a Champion, a Manor...) unlock at once: a feed line "Achievement
  unlocked: …" with a chime. The match is counted once, at the game-over screen (victory, defeat or
  draw), or when the player leaves earlier: a loss if already defeated, or for a running match left
  after its first minute (one the host ended, or left in its first minute, is not counted).
- 40 achievements in six groups: Career (the two lesson medals of 9.2, first win, 10 games, 10 and 25 wins, every pantheon), Pantheons
  (a win with each), Gods and Titans, Battle (Champion, 100 kills, a win under 15 min, a win without
  losing a building, outnumbered), City (City Palace, 10,000 gathered, Manor, stone wall), Challenges
  (Normal, Hard and Brutal AI, a human enemy, an ally, the Decade of Peace, waves 10 and 20 of the Trial of the Titans, an hour-long game).
- Game-over screen: under the statistics, a card per achievement the match unlocked and a line
  "Career: W wins in G games (P%) · U of 40 achievements". Title screen: a Career button (a red count of
  unseen unlocks) opens the Career screen: profile tiles, wins by pantheon (at most five cards to a row, each
  name on one line), the last games as chips and
  the gallery (locked ones dimmed, progress bars for counted ones, "New" on the unseen, cleared on opening).
- The guided first match (9.2) is not a game of the career: no tracker runs in it. Its victory keeps the best
  medal (`best.medal`, 1 bronze … 3 gold, `recordTutorial`) and unlocks First Lessons (any medal) and Top of
  the Class (gold), which with the Trial's two and Brutal's one makes 40 achievements; the career screen lists the medal.

### 9.2 Guided first match (src/game/tutorial.js, src/ui/hud-tutorial.js, src/data/medals.js)
Learn to Play (title screen, under Play vs AI; a gold "New? Start here" tag while the career has no game and
no medal, then "your best: <medal>") starts the setup of 5.13 at once. In the match:
- `TutorialDirector` (Game, host only) reads the ViewState and the selection twice a second and walks
  `TUTORIAL_STEPS` in order, each `{ id, icon, title, text(c), done(c), progress?(c), target?(c), guide?(c) }`:
  choose the Worshippers (a selection with one), three mining (`tk` gold; the text sends the whole selection and
  asks to keep at least three on it), two chopping (any two, a miner will do: click one, Shift+click a second), a finished House,
  a Shrine, two praying, a Temple, a god on the field, a Barracks, four Barracks soldiers alive, and the
  victory. A step once done stays done, and several finish at once when the player ran ahead.
- HUD: the objective panel takes the getting-started checklist's corner (no checklist and no gameplay tips
  in this match): step n of 11, icon, title, the text with `[[Key]]` caps, the progress ("2/3", "Faith 140/200",
  "Their Town Center: 64%"), a row of step bars, a green glow for a moment when a step is finished. A gold
  "Here" pin (the team marks' layer, `GuidePointer`) stands over the step's spot (the Worshippers, the start
  mine, the forest tile nearest home, the Shrine, Temple, Barracks, the raiders' Town Center) and rides the
  screen edge as an arrow when it is out of view; a click takes the camera there. The command-card buttons
  the step needs glow (`lightCard`: Build and the building, the four god buttons, Warrior and Archer, Attack).
  A finished step puts "Done: <title>." in the feed with a chime and pings the next spot on the minimap.
- The end: a victory is "Lesson Complete" with a medal card by its game time (`MEDALS`: gold within 12:00,
  silver within 18:00, bronze after) and what the next better medal needs; it is saved with `recordTutorial`.

### 9.3 Daily challenge (src/game/daily.js, src/data/twists.js)
One game against the computer per local calendar day, the same on every device: everything comes from the day's
key ('YYYY-MM-DD'): the map seed, my pantheon, any AI ally's and the rivals' pantheons (no pantheon twice) and a
twist. The nine twists come round in a seeded shuffle of nine days, so every twist appears once a cycle:
- Start changes the sim applies to every city, AI included (`setup.twist`, read by the World through
  `startOf`; an unknown id is a normal game): Golden Age (three times the gold and wood), Blessed Start
  (+350 faith), Humble Beginnings (two worshippers, half the gold and wood), Crowded Hearths (ten worshippers).
- Sides and modes built into the lobby state: A Worthy Foe (one Hard AI), Outnumbered (a Normal and an Easy AI
  allied against me, medium map), Brothers in Arms (an AI ally against two Normal AIs), Holy Ground
  (Sacred Victory, 5.11), Trial of the Titans (with an AI ally, 5.14). Other twists face one Normal AI on a small map.

Title screen: a Daily Challenge button under Quick Match, "Today: <twist> · <my pantheons> vs <theirs>" and
today's best once played; the twist's text as its tooltip; a badge with the streak ("🔥 3", or "🔥 3 · keep it"
while today is not played yet), or "New today" with no streak. The match opens with a feed line naming the twist,
and a chip in the top bar's left group (`Hud.showTwist`: the twist's icon and name, its rule as the tooltip) keeps it
in view for the whole match, a loaded one too.
It counts once, like the career (9.1): at the game-over screen, or on leaving a match the career counts as a
loss. The score is the chronicle's (5.11, `scoreOf`) and the game-over screen says it against today's best
with the streak. Play Again replays the same day's challenge; it is not kept for Quick Match. The record lives in
localStorage under `mythicwar-daily`: `{ days: { day: { best, plays, won } } }`, the last 60 days. The streak
is the run of days played up to today, or up to yesterday while today is not played yet.

### 9.4 Saved games (src/game/save-game.js, src/game/save-store.js, src/game/game-saves.js, src/sim/save-graph.js)
A match against the computer (one human, the rest AI; not the guided first match) can be saved and carried on.
- In the match: the F10 menu has **Save Game** (three slots, each showing its match, game time and when it was
  saved; a click saves over it, the game stays paused), **Load Game** (the saved games listed as on the title
  screen, `saveTitle` / `saveLine`, the slot of this very match marked "this battle"; a click asks first, then
  leaves this match for the save: counted like Quit to Menu, a loss after the first minute, unless the save is of
  this very match (its `matchId`), when nothing is counted; a slot that cannot be read leaves the match running
  and says why) and **Save & Quit** (saves to the autosave slot and leaves
  without counting the match in the career: it counts when it ends after being carried on). The game is also
  autosaved every `AUTOSAVE_EVERY` (180) seconds of game time ("Game autosaved." in the feed). When the match
  ends, its own autosave is deleted (Continue must not bring back a finished game); slots are kept. **Quit to
  Menu** counts the match as lost (9.2) and deletes its autosave too. A counted match (ended or quit) is
  remembered by its id (localStorage `mythicwar-settled`, the last 40): a slot of it loaded later plays on but
  counts nothing again in the career or the daily challenge. The computer players' chat (10.1) does not greet
  again after a load, nor announce the gods already on the field (`AIVoices.resume`).
- Title screen: **Continue** (above Play vs AI) loads the newest save, autosave or slot; **Load Game** (small
  button, shown once a save exists) lists them all with Load and Delete.
- What is saved: the whole World (entities, map state, pathfinding queue, projectiles, statuses, powers, relics,
  sites, the sim RNG) and every computer player's `AIPlayer` (its own RNG, plans and memory), packed by
  `packGraph` (sim/save-graph.js): object identity and cycles, Maps, Sets, typed arrays, NaN, ±Infinity and -0
  survive; class instances come back on their prototypes (`CLASSES` in save-game.js; the pathfinder's scratch
  buffers are rebuilt, not saved; `World.onCommand`, the replay recorder's hook, is left out); unit and building data, config and the generated map are stored by name and
  looked up again (the map is generated again from the setup's seed). A function in the state throws with its
  path, so a test catches new state that cannot be saved. Also kept: the fog explored, enemy buildings and mines
  as last seen, the camera, control groups, the chronicle's samples, the career tracker's tally, and the match's
  replay recorded so far (`ReplayRecorder.carry`: the setup, commands, chat and checksums, 9.5), so a game carried
  on still gets a replay of the whole match. A recording over `MAX_CARRIED_COMMANDS` (150,000 commands, about
  3 hours of a 4-player game) or one cut short is not carried: that game, once loaded, records no replay.
- Determinism: the loaded game plays the same ticks exactly as the saved one would have (the packed state of both,
  compared after 90 more seconds of AI-vs-AI play, is identical: tests/game/save-game.test.js, also for the Trial of
  the Titans, the Decade of Peace and Sacred Victory). A loaded game's `HostSession` (`resumed: true`) drops the
  saved tick's leftover events and brings the felled trees down in its first snapshot.
- Storage: on this device only. The state (about 400 KB of JSON at minute 8 of a small map, gzipped with
  `CompressionStream` to a few tens of KB) goes to IndexedDB `mythicwar-saves`; the slot list goes to
  localStorage `mythicwar-saves`. `SAVE_FORMAT` is checked on load; a save from an older build of the game loads
  as long as the state it holds still fits the code (a save that no longer does fails on the start screen).

### 9.5 Replays (src/game/replay.js, replay-session.js, replay-store.js, src/ui/hud-replay.js, src/ui/menu-replays.js)
The sim is deterministic (same setup and the same commands on the same ticks give the same game), so a
replay is not a video: it is the GameSetup, every command the World accepted with its tick, the chat with
its ticks, and checksums.
- Recording (host only: a client has no World): `ReplayRecorder` sets `World.onCommand`, which
  `issueCommand` calls for each command it queues, from every player (the AIs and an AI that took over
  from a player who left too), as the compact form of `normalizeCommand`'s copy (empty fields dropped;
  normalizing it again gives the same command). On each host snapshot, at most every 10 s of game time,
  it keeps `worldChecksum` (the tick, every player's resources, every living unit's id, place and health,
  every building's health), and one on the last tick. The guided first match is not recorded. A saved game
  carries the recording so far in its extra (9.4); on load, `ReplayRecorder.resume` hangs a recorder on the
  loaded World that goes on from it (it must be from the same tick and seed, its rows well formed), so the
  replay kept at the end plays the whole match from the setup, across any number of saves and loads (the
  loaded game plays on exactly as the saved one would have). It keeps the match's start date. A save without
  a recording (from an earlier build, or one too long to carry) gives no replay.
- Kept: at the game-over screen (with the result) or on leaving (result null, "Left early"), when the game
  ran 30 s or more. `saveReplay` stores it in IndexedDB (`mythicwar-replays`: a `meta` list row and the
  `data`, gzip-compressed by CompressionStream; a 2-player 15-minute game is about 26 KB, a 4-player
  22-minute one about 100 KB), keeping the newest 12. Storage that is off keeps nothing, silently.
  A record: `{ format: 1, id, version (PROTOCOL_VERSION), date, setup, pov, ticks, result, winningTeam,
  mode, players, truncated, cmds: [[tick, player, cmd]], chat: [[tick, from, text, voice?, system?]],
  sums: [[tick, hash]] }`. Loading (and opening a file, untrusted) goes through `sanitizeReplay`:
  the setup through `validateSetup`, the commands in tick order through `normalizeCommand`.
- Playback: a Game built with `replay` runs a `ReplaySession` (the HostSession surface) whose World gets
  the recorded commands on their ticks: no AIs, no orders taken, no alerts, chronicle, career or recording.
  Speeds ½×, 1×, 2×, 4×, 8× (the ticker runs that fast, a snapshot every speed/2 ticks); the ViewState's
  `clock` is a `PlaybackClock` running at the same speed and stopping while paused, so units move smoothly
  at every speed. A jump ahead runs the ticks in 24 ms slices (events dropped, the trees felled on the way
  fall at once with `felledAll`). Going back starts a new Game at that tick (a World cannot run backwards,
  nor can the trees regrow), keeping speed, eyes and camera. A checksum that does not match marks the
  moment the replay parted from the recorded game (a replay from an earlier build, whose rules have
  changed): the timeline gets a red mark and the bar says so; one from another build says it may differ.
- Eyes: everyone (`myIndex` -1, no fog; the top bar hides its resource boxes and the pantheon chip, there being
  no player of mine to show) or one player (`ViewState.setViewer`: their fog of war and top bar;
  the map counts as explored, as no memory of it was kept). The free camera turns round its target and
  tilts (`CameraController.rotate`, `tiltBy`, `resetAngle`: pan and edge scroll turn with it; the pitch
  stays 22° to 68°).
- The bar (above the bottom panel; the command card and the marker and power buttons are hidden): ⏮, play /
  pause (↻ at the end), +30 s, the speeds, the timeline (click: go there), the eyes, turn ⟲ ⟳, tilt ⤒ ⤓,
  the normal view ⌖, Leave. Keys: Space play / pause, [ and ] speed, J +30 s, V next eyes, Q / E turn,
  R / F tilt. F10 opens the Replay Menu (it holds the replay; the camera stays free).
- Where: the game-over screen's Watch Replay (this match from its start), and the Career screen's Replays:
  each kept game with its sides, result, date, mode and length, Watch, Save (a `.mwreplay` file, the packed
  record) and Delete, and Open a replay file.

### 9.6 Campaign (src/ui/menu-campaign.js, src/ui/hud-campaign.js, src/game/campaign-progress.js, src/game/campaign-voice.js)
Campaign (title screen, under Learn to Play: "Chapter I: The Long Winter · n of 5 missions won", naming the chapter
of the next mission to play) opens the chapter screen: a tab per chapter (Chapter II locked until Chapter I's last
mission is won), the chosen chapter's five missions down the left (locked with a padlock until the one before is won, a tick and
the best time once won) and the chosen one's briefing on the right (where, who you face and who stands with
you, the shown objectives, Begin Mission, Hear the briefing). Progress lives in localStorage
`mythicwar-campaign` (`{ won: { id: { best, at } } }`); missions are not games of the career, nor saved (9.4); a mission is kept as a replay (9.5), whose panel and narrator follow the mission.
- The narrator: every briefing, every event's line and every victory text is a recorded clip in
  assets/narration/campaign (Kokoro "George", as the intro film: `tools/narration/render.py --lines`, with the
  list from `tools/narration/campaign-lines.mjs`), named `<mission>-<part>-<hash of the words>.mp3`, so new
  words need a new render (a test checks every clip exists). It follows the Narration setting and the volume,
  ducks the music while it speaks, and hands a line with no clip to the browser's voice. A briefing is read when
  the screen opens or a mission is chosen.
- In the match: the objective panel takes the checklist's corner (no checklist, no gameplay tips): "Chapter I ·
  Mission n" (the mission's chapter), the title, one row per shown objective (ticked, crossed out red when failed, dashed ring for a
  protect one, italic for a bonus) with its count ("0/1", "3 left", the clock left, "1:05 of 2:00"). The lesson's
  "Here" pin (`missionPointer`) stands over the current objective's spot from the snapshot's `cp.at`. An event
  line goes to the feed (an enemy spawn as a red banner with a horn) and is spoken; objectives finished, failed
  or revealed go to the feed.
- The end: "Mission Complete" with the victory text (also spoken) and what opened ("The next mission is open:
  …", a new best time, "Chapter I complete! … Chapter II is open: The Wolf Age."), and Next Mission ("Begin
  Chapter II" when it leads into the next chapter) (the chapter screen on the next briefing), Play
  It Again, Campaign; "Mission Failed" with the defeat text and Retry Mission.

## 10. AI (src/ai/)

`createAI(world, playerIndex, difficulty) → { tick() }` (difficulty `'tutorial'` is the sleeping camp of 5.13,
`src/ai/tutorial-ai.js`; it is never offered in the lobby). Called every sim tick on the host;
thinks every `AI_THINK_INTERVAL[difficulty]` ticks. Reads world state, acts **only** through
`world.issueCommand(playerIndex, cmd)`. Behavior: keep training worshippers up to what its
mines, wood line and prayer slots can use (at most 15/30/34/34 by difficulty; a mine takes only
2 miners at once, so it takes a second mine from about 5:30, hard 4:30, easy 11:00, and a
third later), split them gold / wood / prayer (more prayer once a Temple exists), build houses ahead of the pop cap, Barracks, Shrine, Temple, summon gods, tier up,
second Barracks, towers, Titan Gate in City; train a mix of warriors/archers/creatures; defend
when its buildings are attacked; attack in waves when its army is strong enough (later and
smaller on easy); target the nearest enemy base (prefer the weakest enemy in multi-enemy
games); gods cast abilities sensibly (damage on clumps, heals when allies hurt, ultimates in
big fights); retreat badly hurt gods to base. It combines no Houses into Manors (5.3: it keeps building Houses ahead of its cap) and builds no walls, and wall segments are invisible to its scans (`worldDigest`,
`scanWorld`, team targeting): they are neither buildings it counts nor targets it picks, and an army shut out by a
player's wall breaks through it like any soldier (5.5). Its Barracks also trains the pantheon elite soldier (4.10)
once it is a Town, as the melee or ranged soldier its army is short of. Hard is fair (no resource cheats), and so is Brutal. Army size stops at the
profile's `armyCap`, a share of `POP_MAX` (easy 40 %, normal 80 %, hard and brutal 93 %), so normal and harder fill the
population cap and easy stays well below it. In the Trial of the Titans (5.14) the wave monsters count as enemy
units near the base, so the AI defends against them (and helps allies) and never attacks. In a Decade of Peace (5.10) no wave leaves
home until the peace ends: the army keeps growing and masses at the rally point. The ground an
enemy Town Center keeps clear is closed to its building too: every site it tries goes through
`canPlaceBuilding`, so it simply takes another spot. It sends Worshippers to capture sacred sites and its army to
break a rival's Sacred Victory countdown (5.11).
God powers (4.11, `src/ai/powers.js`, every third think): a harvest blessing once 12 of its worshippers gather
(easy: more), a festival once 5 pray, a caravan from 1:30, a healing rain where its hurt army is missing 1,200
health or more within the rain; a strike on the enemy unit whose surroundings (the power's area) hold the most
enemy health, at least 1,800 (a cataclysm 3,600, where an enemy building counts a quarter of its health), and only
where its team can see (the sim's own `powerRefusal` decides). Easy's `castThreshold` raises every bar.
A stand-in AI (`createAI(world, index, difficulty, { standIn: true })`, `AIPlayer.standIn`: the AI
`HostSession` seats for an online player who dropped out, 7) casts none: each power is once per game and stays
the absent player's to spend when they rejoin. It sends no gifts either (5.7), and otherwise plays in full
(gathers, builds, trains, fights). Computer players' own AIs are not flagged.

**Difficulties** (`src/ai/profiles.js`): Easy, Normal, Hard and Brutal, every number in one profile each. All
four play fair: the same resources, rules and units as a player, with no bonus at any level. (They all
read the whole World, as they always have, so none of them scouts.) Hard and Brutal play smarter than Normal in two ways:

- **Worker raids** (`src/ai/raid.js`, profile `raids`): while the main army waits at home with enough left to hold
  it (`minArmy` pop), a squad of about `pop` population of its fastest soldiers (flyers first; no gods, Titans,
  siege or Priests, nobody under 70 % health) slips out to the enemy Worshippers worth hitting: three or more
  gathering in an 8-tile cell, at least 22 tiles from the centre of that enemy's army, with nothing there the squad
  cannot beat 1.6 to 1, of a player with no strike or cataclysm god power (4.11) still in hand (a squad is just
  what such a strike is waiting for). It marches along a ground route, attacks the Worshippers one by one, and moves on to a
  second cluster within 25 tiles if the first is gone. It turns for home when the base is in serious trouble, when
  its health falls under 45 %, when what it meets is stronger (local fight ratio under 1.1), after 100 s on the way
  or 45 s at the target. Home at the rally point it rejoins the army. One raid at a time, the next at least `every`
  seconds after the last came home (Hard from 5:30, every 110 s, 10 pop; Brutal from 4:30, every 80 s, 12 pop).
  A raid that lost more than it killed (a Worshipper counts 90 gold) doubles that wait, up to four times; one
  that paid sets it back.
  The squad is left out of the army's own orders and focus fire while it is away.
- **Wounded soldiers step back** (`src/ai/micro.js`, profile `pullWounded`): a soldier or creature in a fight
  under 30 % health (Brutal 32 %) with a Priest of its own within 14 tiles moves to a spot 2 tiles behind that
  Priest, away from its attacker, is healed there and rejoins the army at 65 % health, after 15 s, or when the
  Priest falls. Without a Priest near it fights on.

Every difficulty steers its army by where the bulk of it stands: the median position of its ground units
(`centroid` in `src/ai/military.js`), not their mean, which stragglers walking out from home used to drag 30
tiles back, so a siege kept restarting its march and a winning army stood idle by its first waypoint.

**Brutal** is Hard's play thinking every 3 ticks and raiding more often, and it plays fair like the rest (a 20 %
gather bonus was tried and taken out: the AIs never cheat). Earlier tiers, more workers, earlier and bolder waves
and pickier god casting were all measured on top of Hard and made no difference (28 to 36 wins in 64), so Brutal
keeps Hard's numbers. It is a little sharper than Hard rather than much stronger.

Measured (headless games like `tools/ai-tournament.mjs`, small maps, every map played twice with the sides
swapped). Before the god powers (4.11) came in, the new Hard beat the Hard from before in 38 of 64 games. With
them the AIs spend their strikes on raiding squads, and the new Hard and the Hard from before come out even (129
to 127 in 256 games): Hard now plays smarter rather than measurably stronger. Hard beats Normal in 54 of 64;
Brutal against the new Hard wins 28 to 36 of 64, within the noise of a 64-game run.
Army mixes chosen to "counter" the enemy were tried and dropped: a strength-per-gold pick, fewer archers, more
archers and a mix that answers the enemy's melee and ranged shares all did no better than the plain mix (the
strength-per-gold pick and fewer archers clearly worse). With no damage types in the game the one counter that
matters is anti-air against flyers, which every AI already does.

### 10.1 AI voices (src/ai/voice.js, src/ai/voice-lines.js)

Computer players talk, the way AoE II's AIs do: a short in-character chat line at the moments that
matter, each pantheon in its own voice (Olympian hubris, Norse sagas and mead, Egyptian eternity, karma
and the wheel, the kami's honour, the Mandate of Heaven, the hungry Fifth Sun, the wild Celtic woods,
Sumerian scribes and clay tablets, West African drums and ancestors). The moments (`VOICE_TRIGGERS`):
a greeting a few seconds in (70 % of AIs, staggered; in a match with no enemy player, the Trial of the Titans,
a greeting to allies instead, `greetAlly`, as one to rivals would be wrong there), first contact with another player (an enemy
player's unit within 14 tiles of one of its units or buildings, scanned every 2 game seconds; the
line names that player), the first blow a player strikes against it (the `underAttack` event, with
the nearest enemy player's unit as the attacker; wild creatures do not count), the end of a Decade
of Peace (one AI), a god's first arrival (a revived god comes back quietly), a Titan being summoned,
a god falling, being nearly beaten (its buildings down to 35 % of the most it had, at least 5, or no
Town Center left; once), its defeat, and victory (one AI of the winning team). `{unit}` and `{enemy}`
in a line are the god or Titan and the other player's name; every pantheon has at least two lines
per moment, walked in a shuffled order.

Rate limits (`VOICE`, game seconds, so a paused game stays quiet): an ordinary line waits 45 s after
the same AI's last line and 15 s after any AI's, and 150 s after that AI's last line of the same
kind; a Titan and "nearly beaten" skip those but stay 2 s apart; defeat and victory always go out.
A line that cannot go out is dropped, not queued; one AI says at most 24 lines a match. A whole
normal 1v1 comes to roughly one line a minute.

It runs on the host beside the AIs: `HostSession` (option `createVoices`, which the game controller
loads from `src/ai/ai.js` with `createAI`) feeds it each snapshot's events and broadcasts what it
returns as chat lines from that player with `voice: true`. Only the setup's own AI slots speak (an AI
that took over from a player who left keeps quiet). It only reads the World. Each player hides
the lines with the `aiChat` setting ("AI chatter", in Settings → Gameplay and the in-game menu;
default on): `showChatLine` in `src/game/game.js` filters them, live chat and the replayed log alike.
A shown line is not a feed card but a taunt at the top centre (`Hud.showTaunt`, `.hud-taunt` in hud.css),
under the banners: the speaker's pantheon emblem in a ring, their name in their colour, the words in
quotes at 1.6em (the feed's cards are 1.18em), slamming in with a short shake (none under reduced
motion), up for `tauntDwell` (6 to 9.5 s by length); the next taunt replaces it. The end screens (game over,
defeated, ended) take the top centre: the taunt up goes when one opens, and none is shown (nor heard) while
one is up (`Hud.endScreenUp`). It comes with the
`taunt` sound (sfx-alerts.js): two war-drum blows under a low brass fifth that bends down into the
note with a growl, measured at peak -3.6 dB / loudest 400 ms -13.1 dB RMS, next to the war horn's -5.2 / -14.0.

## 11. Game controller (src/game/game.js, src/main.js)

`main.js` boots settings, shows the menu, and on lobby start builds a HostSession or
ClientSession, then `new Game({ session, settings })`: creates GameRenderer on a canvas, HUD,
InputController, sfx listener; requestAnimationFrame loop: `viewState.update(now)`,
`renderer.update(dt)`, `renderer.render()`, `hud.update()`. Events from `viewState.on('*')`
drive VFX, sounds and HUD messages. The game also keeps the team's marks: `sendMark(kind, x, y)` (paced by
`MARK_SEND_RATE`, then `session.sendMark`) and `onMark(mark)` (stands it in `game.marks`, chimes, and for a teammate's
marker writes its words in the message area), see 7 and 9. Game over → overlay → back to menu. "Preparing the
battlefield…" covers the empty canvas while the renderer's code loads and its scene builds (with a
gameplay tip under it unless the player turned tips off). In a
single-player match (no clients) a hidden tab opens the F10 menu, which pauses the sim. `init()` also
creates the `AlertEngine` and the `TabAttention` (section 9, "Alerts, tips and sounds"); `onAlert(alert)` turns each alert into a HUD
line, a sound, a minimap ping, the spot Space jumps to and a tab flash, and tells the HUD to hold its tips
while the player is under pressure. It also makes the `MusicDirector` (section 9, "Music"):
`update(dt)` each frame turns the match's fighting into the score's intensity, and the director plays the player's
pantheon theme.

### 11.1 Intro film (src/intro/, src/ui/intro.js)

A 47 s film plays when the page opens and ends on the title screen, before the player can press Play: a flyover
of a Greek village at dawn, its worshippers praying and Zeus answering at the temple, the army marching out, the
two hosts clashing, Kronos and Surtr stepping out of their gates, and ten gods, one of each mythology, called up
in a line as the sun goes down. It is drawn live, by the real renderer on a world the real simulation runs, so it
needs no video file, follows the quality tier and shows the game as it is. Esc, Enter, Space or the Skip button
end it at any moment, even while it loads (a quick dip to black, then the title); the title screen under it never
sees those keys, so a second Enter cannot press Play. (On the card that waits for a key, below, Enter and Space begin
the film like any other key, and Esc and the Skip button skip it.)

**When it plays** (`introWanted`, `src/ui/intro.js`): once per page load, only at the start (never after a match).
The `intro` setting (`src/settings.js`, default true; Settings, "Intro film") turns it off for good, and Settings
has "▶ Watch it now", which plays it with the speed guard off and comes back to Settings. The address overrides
the setting: `?intro=0` never, `?intro=1` always. Without `?intro=1`, an invite link (`?join=`), an automated
browser (`navigator.webdriver`: the e2e tests) and `prefers-reduced-motion` skip it; a browser without WebGL 2
never plays it. A film that cannot start, or whose frame throws, is dropped (`'failed'`); on a machine that averages worse than
5 fps over 24 frames (after the first 3.5 film seconds, where shaders compile) the film is skipped (`'skipped'`).
The menu is hidden while it plays and shown again behind the black when it ends; the game's own code is fetched
(`warmUp`) after it, so the film has the machine to itself, and the film's renderer is freed before the title
shows. Its sounds are cues in the game's synthesized set (`sfx`).

**Sound on a first visit.** A browser keeps audio and speech off until the page has had a key press, a click or a tap (an
`AudioContext` stays `suspended`, `speechSynthesis.speak` is refused with `not-allowed`); a page cannot ask its way past
that, so there is no sound at page load by default, in any browser. The page does everything short of it: `sfx.init` makes
the context and asks it to run at load (9), so a browser that allows sound with no input (the site set to "Sound: Allow",
Chrome's autoplay switch, a visit reached by a click on a link of the site) plays the film with
its sound from the first frame, with no card at all. Where the browser says no and the player wants sound (`gate`, from
`watchIntro` in `main.js`: the volume above 0, or the music not muted and above 0), the film is held at its first frame
behind a card, "Press any key or click to begin" ("Tap to begin" on a touch screen), which the film loads behind, class
`is-gated` on the overlay. Any key but Esc and the modifiers (`beginsFilm`: a lone Shift, Ctrl, Alt, Meta, a function key
or a browser shortcut is no key press to the browsers), a click or a tap begins it, in the very event that unlocks the
audio (`beginFilm` also calls `sfx.unlock()`), so the score, the voice and the effects are there from the first second
and not at some click part-way through. The card also ends by itself if the browser allows sound after all (`sfx.onReady`: a
context that starts a moment late), and a skip ends it (`finish` releases the wait). A player with the sound off (volume 0,
and the music muted or at 0) is never held, and neither is a page with no WebAudio. Measured in Chromium (`--sound`, below):
Tab, letter keys, Enter, Space, the arrows, a click and a tap unlock the audio; mouse movement, scrolling, a lone Shift
and Esc do not; a reload after a click is locked again; a click on a link to a page of the same site leaves that page
unlocked. The one-time way to hear it with no input at all is the browser's own setting: in Chrome, the site information in the
address bar, Site settings, Sound, Allow (or `chrome://settings/content/sound`, "Allowed to play sound", add the site); verified
here by writing that exception into a profile, not by clicking through Chrome's menus. Nobody has heard it with speakers: the
checks read the audio context's state, the effects the engine schedules and what the voice is asked and answered.

**Narration** (`src/intro/narrator.js`, `src/intro/voiceover.js`): a voice reads each caption of `CAPTIONS` aloud as the
film's clock reaches the caption's `from` second. The lines are recorded: one short clip per caption in
`assets/narration/` (mono MP3, 64 kbps, -20 LUFS, about 90 KB in all), rendered offline with Kokoro-82M (Apache 2.0),
voice `bm_george` (a deep British narrator, Austin's pick of three) at speed 0.85, by `tools/narration/render.py`; a
changed caption needs its clip rendered again (`tests/intro/voiceover.test.js` checks every caption has one).
`RecordedSpeech` downloads and decodes them on the sound engine's context as the film loads and plays each through the
engine's master gain (so it follows the volume and the mute) with a 0.12 send to its hall reverb, 0.15 s after the
hand-over so the score has begun to step back. It has the browser speech synthesis's shape, so the narrator below is the
same for both: a line whose clip cannot be had (no Web Audio, a failed download or decode, or a clip not there 1.5 s after
its line came up) goes to the browser's own voice, as before; a suspended context that does not run within 0.4 s is
reported as a refusal (`not-allowed`), and the click that resumes it says the line. `?voice=browser` uses the browser's
voice alone. The browser's voice (`speechSynthesis`) says the caption's
own words, `en-US`, rate 0.9 and pitch 0.9, at the Settings volume (0 is silence), a line at a time (the browser
queues a line behind one still being said, so they never overlap; no voice is picked by name, since the browser's
default for English is its best and a list can open on a novelty voice). The overlay's `paint` hands the voice the film's second each frame, so it
follows the picture, and a caption that came and went between two frames is not read late. Every way out of the film
(`finish`: Esc, Enter, Space, the Skip button, the end, a failure, the speed guard) stops the voice first (after telling the
score, below), with `speechSynthesis.cancel()`, before the dip to black. The `narration` setting (default true; Settings, "Narration",
under the intro toggle) turns it off for good; it is independent of `intro`, so "Watch it now" is read even when the
film is off at start-up. A browser without `speechSynthesis` is silent (the Settings note says so), and a voice that
throws is ignored. Chrome will not speak until the page has had a key press, a click or a tap, unless the site is set
to Sound: Allow (the rule behind the card above, which is why the film normally begins with the voice allowed): a refused `speak`
fires an `error` event (`not-allowed`), which puts up a "Click for sound" hint at the top left (class `needs-click` on
the overlay, up while either the voice or the score below is waiting for a click), for the cases the card does not cover
(a browser that lets Web Audio run but not the voice); a click anywhere on the film then says the caption on screen (if it
has 1.2 s left) and takes the hint down, and the later lines speak by themselves. "Watch it now" always speaks, for the
player has just clicked.
`createNarrator({ speech, volume, captions, onBlocked, onSpeaking })` takes the speech synthesis as a parameter (tests
pass a stand-in). `onSpeaking(true)` is called as a line is handed to the browser, a moment before it is heard, and
`onSpeaking(false)` when none is left: at the browser's `end` or `error` event, or when the line's time has run out,
whichever comes first (some browsers never report an end), or at `stop()`; events of a line already settled are ignored.
A line's time is its caption's end, or `LINE_MAX` (4 s) after it was handed over if that is later, since a click can start
a line near the end of its caption (a first visit), and the voice takes about 3 s over the longest.

**The score** (`src/intro/score.js`, `createFilmScore()`; the engine is the music engine of 9): the title theme (`menu`,
D minor, the very piece the title screen goes on playing) as an overture under the film, so a hand-over has no seam.
No recorded audio. It is the music engine, told three things.
*The story*: `MUSIC_CURVE` / `musicAt(t)` in `script.js` (keyframes of the battle intensity, straight lines between) builds
with the film: the choir and the drone alone over the dawn (0.07), a light pulse for the prayer (0.16 to 0.3), the groove
as Zeus marches out (0.42 at 19 s), the war drums and horns for the clash (0.8 at 25 s), everything for the titans (0.97
to 1 from 30 to 36 s), the ten gods at the height, then down to the title's own level (`SCORE_END` 0.25, which a test keeps
equal to `TITLE_INTENSITY`) by the last frame. The engine composes a bar 1.6 s before it sounds and a bar lasts 3.8 s, so
the score reads the story `LEAD` = 3.5 s ahead of the film's clock (the value for the middle of the bar being composed) and
`conduct()`s the engine with it; a test checks that each bar is composed at the intensity of its middle. `SEED` (82) fixes
the piece: the same overture every time, with its four-bar sections falling on the film's beats (a section of the calm
progression with no tune over the dawn and the prayer; the tune coming in with the cut to Zeus at 15 s; a tense section, the tune
an octave up, starting as the titans do at 30 s; a calm one again from 43 s, which the title screen carries on). A test pins that
shape, and when a change to the composer breaks it, its failure message lists the seeds that fit. For the sections to fall there the
piece's clock must be the film's: `playIntro` begins the score with the film's first frame, not with the loading card (begun with the
card, it would run ahead of the film by the time the code took to load, and every section with it).
*The voice*: a `stage` gain (9) is at `LIFT` 1.4 (+2.9 dB, between the lines, and the opening) and steps back to `UNDER` 0.28
of that (-11 dB, 8 dB under the music's usual place) while a line is with the browser: time constant 0.1 s when the narrator hands a
line over, 0.55 s starting 0.2 s after its last word for the swell. `liftFor(volume)` holds the lift so that it is never
louder than the Music slider's top. The film's own cues (`AUDIO_CUES`) play over the score with the stingers' ducking switched
off (`setStingers(false)`: the cue table is the mix, the engine's rules are for a match).
*The way out*: `end('handover')` for a film that ran to its end: the same run plays on, the lift glides away over a few
seconds (time constant 1.5 s) and `playTitleMusic()` finds the piece already playing at the same intensity (a film left while it
still loads, skipped or failed, never began its score: there is nothing to hand over, and the title screen's own piece begins at
the hand-over). `end('cut')` for a skip, a failure or the speed guard while the film is showing: the piece fades out in 0.3 s inside
the dip to black, the stage is reset to 1 at 0.36 s (behind the fading piece, before the title's own is up), and the title screen
fades its own piece in from the hand-over (it comes in 0.9 s after the cut began, the delay any new piece waits after one leaving). `finish` tells the score first and stops the voice second, so a cut-off line cannot
swell it again.
It obeys the settings: the Music slider and mute are the engine's own, so the film plays on without a score (and with no hint)
while music is muted or at 0; "Intro film" and "Narration" decide whether there is a film and a voice (with no narration the
score simply stays at its lift). Every call is guarded: a failing engine costs a warning and a silent film. On a first visit
the card (above) holds the film until the browser allows audio, so the score begins with the film's first frame. Should the audio
still be off once the film is playing (a film begun some other way, or a context the browser suspended again), the film is silent
and shows the "Click for sound" hint (`state().waiting`); the first click starts the score at the film's moment, under the voice if one is
being said, and on the section the story is in: the score's `joinAt()` answers the film's second and `barLevel` (the story's
intensity for the middle of each bar), so the engine composes the bars before the click without a sound and a click at 31 s
comes in on the titans' battle, not on the dawn. (The sections' tunes after the second are the seed's chance, as in a match:
what a late click fixes is where in the piece it comes in.) **Measured, not heard.** Nobody has listened to this: with a flite stand-in voice at -26 LUFS and the Music slider
at its default (`node tools/music-render.mjs --film`, ffmpeg `ebur128`), the score is at -40 to -34 LUFS under the voice (14 to
8 dB below it, closer as the story swells) and -29 to -23.5 LUFS between the lines (+10 to +14 dB), -26.7 LUFS over the whole film,
true peak -11 dBFS before the voice is added; `tools/shot-intro.mjs --music` reads the same mix off the page's real Web Audio graph
in Chromium (stage 0.39 under every line, 1.40 between). The constants are guesses at an unmeasured voice: if the voice proves
quieter or louder than -26 LUFS, `UNDER` and `LIFT` in `score.js` are the knobs.

**The script** (`src/intro/script.js`, pure data and arithmetic, no DOM, three.js or simulation): `SHOTS` (each
with its `from` / `to` seconds, the `cut` into it, `hours` of the day it runs through, `ease`, and a camera of
specs `{ at, dx, dy, dist, pitch, yaw, lift, fov }`: the camera orbits a named point at `dist` and `pitch` degrees
below the horizon, `yaw` degrees round from due south, `lift` above the ground), `CAPTIONS`, `AUDIO_CUES` and the
curves `hourAt`, `fadeAt` (in from black, dips at `dip` cuts, out to black), `barsAt` (the letterbox), `captionAt`
and `cameraAt(t, locate, out)`. The names are anchors of the set, actors (`zeus`, `kronos`, `surtr`, `thor`) or
`crowd` (the middle of the soldiers, gods weighing three); the film resolves them every frame, so a camera on a
god follows the real one.

| shot | seconds | cut | what is on screen | hours |
|---|---|---|---|---|
| dawn | 0 – 8.6 | fade in | the village at work from far out, pulling in ("Raise a city of the faithful") | 6.9 – 8 |
| prayer | 8.6 – 15 | hard | the temple and its faithful; at 11.5 a pillar of light and Zeus ("Pray. Summon the gods.") | 8 – 8.8 |
| god | 15 – 19 | hard | Zeus in profile with the temple behind, lightning in hand, then marching out | 8.8 – 9.2 |
| war | 19 – 25 | dip | the two hosts closing across the meadow, seen from the north ("Lead them to war") | 9.8 – 11.6 |
| melee | 25 – 30 | hard | inside the clash, ultimates let off from 25 s | 11.6 – 14.4 |
| titans | 30 – 36 | hard | Kronos and Surtr arrive at 29.5 ("Unleash the titans") | 14.4 – 17.2 |
| lineup | 36 – 47 | dip | ten pillars of light in a ripple, ten gods in a line at dusk, a push in, fade out ("Ten mythologies. One war.") | 18.6 – 20.3 |

The hour only moves forward through the film, and a jump between shots (the dips at 19 and 36 s hide them) is
always behind a dip to black; the tests keep both rules, and that no caption straddles a dip.

**The stage** (`src/intro/stage.js`, Node-runnable, no renderer): seed 12345 on the small map, a Greek village
at the north-west start (a Town Center at tier 3 with a house or two under construction, barracks, shrine,
temple, Titan Gate, towers, a crew mining, cutting and building) and a Norse host across a meadow, played by the
real `World` with no AI and no player; `mapData.camps = []` and a glade of forest cut away for the finale
(`clearForest`). A `ViewState` with `myIndex: -1` (a spectator: nothing hidden) is fed a snapshot per tick as in
a match, minus the events a film does not want on screen (`levelUp`, `rankUp`, `bounty`, `error`). `advance(dt)`
runs at most 12 ticks (a stalled frame does not make the sim catch up). The scripted cues (`CUE_TIMES`): Zeus is
summoned at 11.5, the garrison and Zeus march at 17.5, the host marches at 19, Kronos and Surtr appear at 29.5
and the ten gods at 36.7 + 0.3 s apiece (the Norse are removed at the first, the gods `hold`, and `stage.finale`
keeps `castSpells` from drawing them into anything). Soldiers have 3× (Greek) and 2× (Norse) health so the clash
lasts the film's seconds; gods are level 5 (everything unlocked) and cast a ready ability once a second at the
nearest enemy, ultimates only from 25 s. The same film every time (the tests compare two runs). Density 0.6
(low quality) thins the cast.

**The film** (`src/intro/film.js`): `IntroFilm({ canvas, Renderer, quality })` owns the clock (`advance(dt)`,
at most 0.1 s a frame; `draw`; `view` = `{ t, fade, bars, caption }` for the overlay). Each frame it advances the
stage, eases each named subject's look-at point toward where it is (`FOLLOW` 5 per second; a cut clears them, so a
shot starts on its subject), writes the script's camera into `pose`, which the renderer's camera reads through
`CameraController.setFree(pose)` (it ignores the zoom limits, the map edge and the easing; `lift` raises the
look-at point), sets the hour with `renderer.atmo.setMode(hourAt(t))` and `renderer.update(dt)` (not
`setTimeOfDay` every frame, which would bake the environment map again each time). The renderer is otherwise
the game's: shadows, post-processing, foliage and (high and ultra) the rich characters, with the overlays a film
does not want taken out (health bars, rank pips, status icons) and the terrain's dark border mist hidden.
`FilmSky` (`src/intro/sky.js`) is a dome round the camera painted from the hour's look (horizon to zenith, the sun
and moon discs where they stand, cloud streaks, stars at night, the haze below the horizon), because the low shots
look past the edge of the map, which the game's camera never does.

**The page** (`src/ui/intro.js`, `src/ui/intro.css`): `playIntro({ root, quality, onHandover, createScore, … })` (the score,
below, begins with the film's first frame as the loading card lifts, follows each frame's film second, and is told how the film
was left) builds an overlay (z 30, over the menu) of a black card with the title and a pulse while the code loads (`import()`ed only
when the film plays, so it costs nothing for players who skip it), the film's canvas, a vignette, letterbox bars
that close over the film (the caption sits in the bottom bar), the Skip button and a black fade layer. It states
`loading → playing → leaving → done` (a film held at the card stays in `loading`, with its first frame already drawn, until the input comes); `leave` dips to black (320 ms, unless the film ran to its own end), frees the film, calls
`onHandover` once (the title appears underneath) and lifts the black over 900 ms. `manual: true` is for tools and
tests (`advance(dt)` moves the film and the overlay, `draw()` paints a frame, no frame loop runs).

**Looking at it**: `node tools/shot-intro.mjs --at 2,16,26,38 --sheet` renders stills (the film runs in manual
mode, so software GL is enough; `--pose x,y,dist,pitch,yaw,lift,fov` puts the camera where you say, `--hour H`
changes the sky, `--quality`, `--size`), and `--flow` checks the page flow in a browser (menu hidden while it
plays, the card and a key press, Esc to the title, the skips for an automated browser, `?join=` and `?intro=0`); `--narration` checks the
browser voice (`?voice=browser`) against a stand-in speech synthesis that records its calls (each caption read as it is on the
screen, Esc cutting it before the dip, the hint and the click, the setting); `--voice` checks the recorded voice in real Chromium (the real clips downloaded,
decoded and started on a running context, one per caption with it on screen, the browser's voice never asked, a first
visit's key starting the first line and Esc stopping it); `--music` plays the film without its renderer
in real time (a stand-in voice that takes time) and reads the page's real Web Audio graph (the stage's gain, an analyser on
the music's output) through the whole film, a skip in the middle of a line and a first visit before any click (about two
minutes; `--scenes 2` runs one of the three); `--sound` is a first visit in real Chromium under the browser's own autoplay
policy (the card holds the film, mouse movement, scrolling and Shift do not begin it and leave the audio off, a key or a click
begins it with the context running, the horn is scheduled, the voice is not refused, Esc at the card skips), with the policy
switched off (`--autoplay-policy=no-user-gesture-required`) and in a profile with the site set to Sound: Allow (no card, the
film plays with its sound at once); the other scenes run under the browser's own policy too, the tool no longer
launches Chromium with the autoplay switch (about three minutes; `--scenes 2` runs one of the four). `node tools/music-render.mjs --film --out DIR [--speech from-to,…]` renders the
score offline, with the mix stepping back over those speech windows, for ffmpeg to measure and mix (a stand-in voice from
ffmpeg's `flite` filter makes a preview). Don't sample stills at 19 or 36 s, the dips' black frames. Tests:
`tests/intro/{script,stage,film,narrator,voiceover,score}.test.js` (`score.test.js` runs the real engine and narrator over the whole
film on a strict fake audio context), `tests/render/camera-free.test.js`, `tests/ui/intro.test.js` (the card among them), `tests/audio/sfx.test.js` (the early start and `onReady`), and the engine's
side in `tests/audio/music-engine.test.js`.

Traps met while making it: the summon pillar of a god or titan (about 8 tiles tall, 1.75 s) washes out a close
frame, so the finale starts wide; `summon_god` plays at most once a second; an idle or held god auto-acquires
enemies, which is why the finale removes the Norse first; in software GL the page submits frames much faster than
they are drawn, so freeing the renderer waits for the backlog (half a minute in headless Chromium, nothing on a
GPU), which `--flow` allows for. Playwright's own `evaluate`, `waitFor*` and screenshot calls count as a user gesture to
Chromium, so after any of them an event that only asks the audio to resume (a lone Shift, say) works, which it does not for
a real visitor: `--sound` reads the page through raw protocol calls with no gesture until the input under test, and every
check before the input depends on that. The tool also no longer launches Chromium with
`--autoplay-policy=no-user-gesture-required` (only `--sound`'s own third scene does): with it no first visit was ever seen,
which is how a silent film got past every earlier check. A first visit prints Chrome's "The AudioContext was not allowed to
start" warning in the console: that is the browser saying what it does, not an error.

## 12. Repository layout & ownership

```
index.html, style.css             menu/lobby UI owner
src/config.js, src/data/*.js       foundation (do not edit; request changes)
src/data/pantheons/<id>.js         content owners
src/sim/*.js                       simulation owner (mapgen.js: map owner)
src/ai/*.js                        AI owner
src/net/*.js, src/game/view-state.js  network owner
src/render/game-renderer.js, terrain.js, camera.js, zoom-lod.js, far-units.js, fog.js, overlays.js  renderer owner
src/render/models/*.js             model owners
src/render/vfx.js                  VFX owner
src/ui/hud.js, hud.css, input.js, command-card.js, minimap.js  HUD owner
src/ui/menu.js, src/settings.js, src/audio/sfx.js  menu/audio owner
src/audio/music*.js, src/audio/audio.js, src/game/music-director.js  music owner (tools/music-lab.html, tools/music-render.mjs)
src/intro/*.js, src/ui/intro.js, intro.css  intro film owner (11.1)
src/game/career*.js, src/data/achievements.js, src/ui/menu-career.js  career owner (9.1)
src/sim/tutorial.js, src/ai/tutorial-ai.js, src/game/tutorial.js, src/ui/hud-tutorial.js, src/data/medals.js  guided first match (5.13, 9.2)
src/game/game.js, src/main.js      integration owner
tests/**                           each owner writes tests for its modules
tools/gallery-units.html, tools/gallery-buildings.html, tools/gallery-vfx.html   visual check pages (one per model/VFX owner)
tools/shot-intro.mjs              stills of the intro film, its page flow, voice, score and first-visit sound (11.1)
notes/                             decisions.md, interface-requests.md (append-only)
```
