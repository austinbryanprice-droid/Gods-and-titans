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
  Camera sits south of its target looking north and down (~56° pitch).
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

## 5. Rules

### 5.1 Start
Each player: Town Center (tier 1, Village) at its start position, 5 Worshippers, 400 gold,
200 wood, 50 faith. A gold mine (12000) 2–4 tiles from the Town Center, a forest edge 6–10
tiles away. Population cap = sum of `popProvided` of completed buildings, max `POP_MAX` (200): a Town
Center gives 12 and a House 8 (10 with Large Families), so 24 Houses and a Town Center reach it (19 with
Large Families).
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
  (Chebyshev: `max(gapX, gapY)`) from every gold mine footprint. The error names the reason,
  the first that applies of: water, rock or the map edge (`Can't build there.`), `Trees in the
  way.`, `Another building is in the way.`, `A gold mine is in the way.`, `Something is in the
  way.` (an enemy or neutral unit), `Too close to a gold mine.` (the gap alone);
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
- `train` puts an item in the building's queue (max 5). Cost and population are reserved
  when queued (refunded on `cancelTrain`). Units spawn at the footprint edge nearest the rally
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
from 1:30 on, at most once every 20 s each (`src/ai/team.js` planAid).

### 5.8 Victory
A player is **defeated** when they own no buildings (finished or not; wall segments do not count).
Their remaining units die and so do their wall segments (an ally could never open them). A team wins when every player not on that team is defeated (neutral excluded).
`surrender` defeats the issuing player. Then `gameOver: { winningTeam }`.

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
  peaceMinutes: 30 | 45 | 60,  // optional, Decade of Peace (5.10): absent = a normal game
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
{ type: 'smart',      units, x, y, target?: id, tx?, ty?, queue } // right-click; sim decides (below)
{ type: 'gather',     units, target?: mineId, tx?, ty? }          // mine or tree tile
{ type: 'pray',       units, target: buildingId }
{ type: 'returnCargo', units }
{ type: 'build',      units: [workerIds], building: typeId, tx, ty, queue, tx2?, ty2? } // footprint top-left tile; a wall type with tx2/ty2 is a line (5.3)
{ type: 'train',      building: id, unit: typeId }                // also creatures, gods, titan, revive
{ type: 'cancelTrain', building: id, index }
{ type: 'upgradeTier', building: id }
{ type: 'cancelBuild', building: id }                      // also takes a finished wall segment down (5.3)
{ type: 'upgradeWall', walls: [buildingIds] }             // wooden → stone on finished wall segments (5.3)
{ type: 'repair',     units, target: buildingId, queue }   // on a construction site: help build
{ type: 'research',   building: id, upgrade: upgradeId }
{ type: 'autoRepair', on: bool }
{ type: 'trade',      to: playerIndex, res: 'gold'|'wood'|'faith', amount }   // team market (5.7)
{ type: 'autocast',   units, ability?: abilityId, on: bool }   // set autocast for one ability (or all) of own units
{ type: 'rally',      building: id, x, y, target?: id }
{ type: 'stop',       units }
{ type: 'hold',       units }
{ type: 'cast',       unit: id, ability: abilityId, x?, y?, target?: id, queue }
{ type: 'surrender' }
```
**smart** resolution per unit: enemy target → attack; worker + gold mine → gather; worker +
tree tile (tx,ty given or the clicked tile is forest) → gather wood; worker carrying cargo +
own drop-off → return cargo; worker + own unfinished building → help build; worker + own
damaged completed building → repair; worker + own completed Shrine/Temple → pray; otherwise ally target → follow (move to it); else move.
Units that cannot do the resolved action just move.

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
`Already being researched.` `Requires <Upgrade name>.` (a line's earlier level, e.g. `Requires Work Songs.`) Trades: `Choose a teammate to send to.` `You can only send resources
to a teammate.` `That ally has been defeated.` `Send at least 20 gold.` (wood / faith)
`Choose gold, wood or faith to send.` `You cannot trade now.`

### 6.3 ViewSnapshot (`world.getSnapshot()`)
Short keys keep network deltas small. Numbers: positions rounded to 0.01, hp to integers.
```js
{
  tick, time,                 // time in seconds
  players: [{ i, name, team, pantheon, color, kind, gold, wood, faith, faithRate, pop, popCap,
              tier, defeated, gods: [typeIds alive], fallen: { typeId: level }, titan: bool,
              up: [upgradeIds researched, in order], ar: bool (Auto-Repair on),
              stats: { gathered, unitsTrained, kills, losses, buildings } }],
  entities: [EntityView],
  fields: [{ id, x, y, r, el, rem }], // active ground zones: radius, element, remaining seconds
  reveals: [{ x, y, r, tm, rem }],    // ability reveals: sight circle for team tm, remaining seconds
  events: [Event],            // since the previous getSnapshot()
  felled: [[tx, ty], ...],    // trees felled since the previous getSnapshot()
  gameOver: null | { winningTeam },
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
  q,              // queue [{ u: typeId | 'tier_up' | upgradeId, p: 0..1 }] (first item progressing; a wall segment's stone upgrade is { u: 'stone_wall' })
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
{ type: 'levelUp', id, level }
{ type: 'rankUp',  id, rank }                                        // a soldier reached a new rank (5.9)
{ type: 'treeFelled', tx, ty }
{ type: 'resourceDepleted', id }
{ type: 'error',   player, message }
{ type: 'underAttack', player, x, y, id }                            // throttled 10 s per player
{ type: 'titanSummoning', player, t }                                // broadcast drama
{ type: 'playerDefeated', player }
{ type: 'peaceEnd' }                                                 // the Decade of Peace is over (once)
{ type: 'gameOver', winningTeam }
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
`"Too close to a gold mine."`) `| null`,
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
`generateMap({ seed, mapSize, playerCount, teams })` → pure deterministic function (same input → identical output in every browser and in Node).
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
  per client (rate/s, burst): in game `cmd` 40/80, `chat` 1/5, `ping` 4/8, `resync` at most one
  per second (deferred); in the lobby `lobby` patches 5/10, `chat` 1/5, `ping` 4/8, one `hello`.
  The host rebuilds every client command from a whitelist (src/net/sanitize.js: 20 types, typed
  fields, unit lists deduped and capped at 256, coordinates clamped, type ids own keys of the
  data tables, `player` never from the client). Names ≤ 20 and chat ≤ 200 code points with
  control/bidi characters stripped. Clients validate what the host sends: lobby states, the
  GameSetup (else kicked with "invalid game setup"), snapshots (`isValidSnapshot`), deltas
  (apply failure → `resync`), chat, and end/kick reasons (≤ 300 chars, else 'host-quit').
- Messages are JSON objects with `t`:
  - client→host: `hello {name, version}` (`version` is `PROTOCOL_VERSION` from
    src/net/wire-version.js: `GAME_VERSION` plus an 8-digit fingerprint of the message names,
    `EVENT_SHAPES`, the command whitelist and the unit / building / ability / pantheon ids, so
    a stale tab after a deploy is refused with the "Version mismatch" text; it is only ever
    compared as a string), `lobby {patch}`, `cmd {cmd}`, `chat {text}`, `ping {ts}`, `resync {}`
  - host→client: `welcome {slot, lobby}`, `lobby {lobby}`, `start {setup, you}`, `full {snap}`,
    `delta {d}`, `chat {from, text}`, `pong {ts}`, `kick {reason}`, `end {reason}`
- Delta codec (`src/net/delta.js`, wire format v2; the header comment lists every key): host
  keeps the last snapshot sent to each client and sends only changes: movement as integer
  hundredth deltas in flat columns (`m`, `mf` with facing), other changed or added EntityView
  fields as per-path columns `c` (dotted paths into nested objects), removed keys `cr`, a
  whole-value fallback `cx`, new entities in full, removed ids, players when changed, events
  packed by shape (`EVENT_SHAPES` order is wire format), felled trees; `tick` is omitted when
  it is the previous one + 1. Exact: `apply(prev, encode(prev, next))` deep-equals `next`, so
  new EntityView keys need no codec change. About 13–14 KB/s per client on average in an
  18-minute 4-AI game (`node tools/net-bandwidth.mjs`). Order is guaranteed (reliable
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
  LobbyState: `{ roomCode, mapSize, peace (0 = standard game, or 30 | 45 | 60 for the Decade of Peace, 5.10), slots: [4 × { kind: 'host'|'human'|'ai'|'open'|'closed', name, pantheon ('random' allowed), team (1–4), color (index into PLAYER_COLORS), difficulty ('easy'|'normal'|'hard'), peerId }] }`.
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
    `ViewState`, sends deltas. A client that disconnects becomes an AI (Normal) and a system chat
    line is shown. Single-player = HostSession with no conns.
  - `ClientSession({ setup, myIndex, conn })`: decodes full/delta into its `ViewState`;
    `sendCommand(cmd)` → `{t:'cmd', cmd}`; `ready` (promise, first full snapshot), `pingMs`,
    `stalledMs` / `stalled` (host silent for `STALL_NOTICE_MS`), `mapMismatch` (setup `mapHash` differs from the locally generated map). `onEnd({ reason })`:
    'host-left' (connection lost), 'host-quit', 'game-over', or the host's sanitized reason.
  - Both: `{ setup, myIndex, mapData, viewState, sendCommand(cmd), sendChat(text), onChat(cb), onEnd(cb), start(), stop() }`.
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
  ```
  Host local view uses a 50 ms delay; clients use `INTERP_DELAY_MS`.

## 8. Rendering (src/render/)

Three.js scene owned by `GameRenderer` (`src/render/game-renderer.js`):
```js
const r = new GameRenderer(canvas, { viewState, setup, quality: 'low'|'medium'|'high'|'ultra' }); // default 'medium'
r.update(dtSeconds);   // sync meshes from viewState (interpolated positions), animate, VFX from events
r.render(rafTimestamp); // the timestamp feeds adaptive resolution (optional)
r.resize(w, h);
r.camera              // CameraController: target {x, y}, pan(dx, dy) tiles, zoomBy(steps), centerOn(x, y), getViewQuad() → 4 {x,y} ground corners
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

## 9. UI (src/ui/) — HTML/CSS overlay

- `menu.js` (+ `style.css`): title screen (Play vs AI, Host Online, Join Online, How to Play,
  Settings), lobby screen (4 slot rows: color, name/kind dropdown, pantheon picker with
  Random, team, AI difficulty; presets; map size; game mode (Standard or Decade of Peace with
  30 / 45 / 60 min buttons, the host's pick; clients see it as text); room code with Copy and Copy Invite Link
  `?join=CODE`; chat; Start for host), join screen (name + code), how-to-play, settings
  (name, volume, graphics quality, time of day, edge scrolling). Pantheon picker shows each pantheon's gods,
  titan and creatures (from data) so choosing is fun, plus its two blessings and its elite soldier; the lobby
  preview shows the same rows. In the battle HUD a pantheon chip (top left, `rPantheon`) carries the pantheon's
  emblem and name, and its tooltip lists the blessings and the elite soldier.
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
  Decade of Peace (5.10): a 🕊️ countdown chip sits next to the game clock (tooltip explains it,
  it turns amber and pulses for the last minute and is gone when the peace ends); one line as the
  game opens, a reminder at 5:00, 1:00 and 0:10 (not for marks already passed when the HUD
  opens), and a "war begins" banner with the horn on `peaceEnd`. Right-clicking or attack-ordering a
  protected player marks a walk, and the sword cursor does not show over it.
  God portraits top-left (click selects, double-click centers). Messages (errors, alerts,
  "Kronos is being summoned!"), chat (Enter), game-over overlay with stats, menu (surrender, quit).
- Getting-started tips (`src/ui/hud-tips.js`): a checklist in the top-right corner (mine gold →
  build → pray at a Shrine → summon a god → Titan Gate). Steps tick themselves from the
  ViewState and stay ticked; ✕ or finishing every step saves `tipsDismissed: true`
  (src/settings.js), and Settings or the F10 menu can turn them back on. Hidden for spectators
  and defeated players.
- Info panel (`src/ui/hud-info.js`): a selected gold mine shows "Gold left", "Miners n/2"
  (snapshot `mn` / `MINE_SLOTS`), how many of your Worshippers work there, and the
  2-at-once rule. A worker's state line reads "Gathering gold", "Chopping wood", "Repairing", or
  "Waiting its turn at the gold mine" (view key `mw`). An own building lists the Worshippers
  building, repairing or praying there and the upgrades researched for its type; armor, tower
  damage / range, housing and faith rates include the owner's upgrades (`players[i].up`); a
  Town Center lists only the highest level of each upgrade line. A Worshipper also shows a "Work"
  stat (Normal, or +N% from the work upgrades), and the gold mine's rule line and the Gather
  tooltip quote the viewer's own trip ("1.3 s per 12 gold").
- Worshipper tasks: a bar bottom-left, next to the idle button, counts own Worshippers per task
  (snapshot `tk`: gold, wood, pray, build, repair, idle, other); clicking a count selects them
  (Shift adds). A multi-selection with Worshippers shows the same counts for the selection.
- `input.js`: left click select, drag box select, shift add/remove, double-click selects same
  type on screen, Ctrl+1–9 groups, 1–9 recall (double tap centers), right-click smart command
  (shift queues), hotkeys from the command card, targeting modes (attack-move A, ability
  targeting, build placement with ghost (a refused click shows the client-side
  `checkPlacement(...).message`); Esc cancels; right-click cancels targeting; another command
  hotkey replaces the pending order), camera: edge scroll, arrow keys, mouse wheel zoom (one
  step per ~100 px of scroll, so trackpads zoom gently), middle-drag pan, minimap click/drag,
  Space centers on selection or last alert, F1–F3 select gods, Alt shows all health bars.
  Key auto-repeat acts once per press, except arrows and Train hotkeys (hold W to queue).
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
  Each building's upgrades fill the free middle / bottom slots with their data hotkey (no two
  buttons of a card share a key); researched ones stay as dim "(researched)" buttons. An upgrade
  line takes one slot and shows its next level to research ("Level 2 of 3."), keeping the line's
  hotkey; the last level stays as the dim button when the line is done (`offeredUpgrades`).
  The Town Center card therefore reads Worshipper W, Grow U / Iron Picks I, Palisade L, Work
  K, Health H / Rally Y.
- `minimap.js`: 2D canvas: terrain colors, mines, trees, units/buildings as team-colored dots
  (visible only; wall segments as thin squares), fog, camera quad; click/drag moves camera, right-click issues smart move.
- Audio `src/audio/sfx.js`: WebAudio-synthesized sounds, `sfx.play(name, { x, y })` with
  distance attenuation from `sfx.setListener(x, y, scale)` (the camera target; `scale` follows the
  zoom, 0.8 close to 1.8 far, and stretches the hearing range so a zoomed-out view still hears its
  far side).
  Names: click, select, move, attack_melee, attack_ranged, hit, death, build, building_complete,
  train, summon_god, summon_titan, lightning, fire, magic, heal, error, victory, defeat,
  tier_up, chop, mine, pray, horn.

## 10. AI (src/ai/)

`createAI(world, playerIndex, difficulty) → { tick() }`. Called every sim tick on the host;
thinks every `AI_THINK_INTERVAL[difficulty]` ticks. Reads world state, acts **only** through
`world.issueCommand(playerIndex, cmd)`. Behavior: keep training worshippers up to what its
mines, wood line and prayer slots can use (at most 15/30/34 by difficulty; a mine takes only
2 miners at once, so it takes a second mine from about 5:30, hard 4:30, easy 11:00, and a
third later), split them gold / wood / prayer (more prayer once a Temple exists), build houses ahead of the pop cap, Barracks, Shrine, Temple, summon gods, tier up,
second Barracks, towers, Titan Gate in City; train a mix of warriors/archers/creatures; defend
when its buildings are attacked; attack in waves when its army is strong enough (later and
smaller on easy); target the nearest enemy base (prefer the weakest enemy in multi-enemy
games); gods cast abilities sensibly (damage on clumps, heals when allies hurt, ultimates in
big fights); retreat badly hurt gods to base. It builds no walls, and wall segments are invisible to its scans (`worldDigest`,
`scanWorld`, team targeting): they are neither buildings it counts nor targets it picks, and an army shut out by a
player's wall breaks through it like any soldier (5.5). Its Barracks also trains the pantheon elite soldier (4.10)
once it is a Town, as the melee or ranged soldier its army is short of. Hard is fair (no resource cheats). Army size stops at the
profile's `armyCap`, a share of `POP_MAX` (easy 40 %, normal 80 %, hard 93 %), so normal and hard fill the
population cap and easy stays well below it. In a Decade of Peace (5.10) no wave leaves
home until the peace ends: the army keeps growing and masses at the rally point.

## 11. Game controller (src/game/game.js, src/main.js)

`main.js` boots settings, shows the menu, and on lobby start builds a HostSession or
ClientSession, then `new Game({ session, settings })`: creates GameRenderer on a canvas, HUD,
InputController, sfx listener; requestAnimationFrame loop: `viewState.update(now)`,
`renderer.update(dt)`, `renderer.render()`, `hud.update()`. Events from `viewState.on('*')`
drive VFX, sounds and HUD messages. Game over → overlay → back to menu. "Preparing the
battlefield…" covers the empty canvas while the renderer's code loads and its scene builds. In a
single-player match (no clients) a hidden tab opens the F10 menu, which pauses the sim.

## 12. Repository layout & ownership

```
index.html, style.css             menu/lobby UI owner
src/config.js, src/data/*.js       foundation (do not edit; request changes)
src/data/pantheons/<id>.js         content owners
src/sim/*.js                       simulation owner (mapgen.js: map owner)
src/ai/*.js                        AI owner
src/net/*.js, src/game/view-state.js  network owner
src/render/game-renderer.js, terrain.js, camera.js, fog.js, overlays.js  renderer owner
src/render/models/*.js             model owners
src/render/vfx.js                  VFX owner
src/ui/hud.js, hud.css, input.js, command-card.js, minimap.js  HUD owner
src/ui/menu.js, src/settings.js, src/audio/sfx.js  menu/audio owner
src/game/game.js, src/main.js      integration owner
tests/**                           each owner writes tests for its modules
tools/gallery-units.html, tools/gallery-buildings.html, tools/gallery-vfx.html   visual check pages (one per model/VFX owner)
notes/                             decisions.md, interface-requests.md (append-only)
```
