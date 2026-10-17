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
`data/mortals.js`, `data/buildings.js`, `data/index.js` (registry), `data/pantheons/<id>.js`.
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
};
```

### 4.3 Buildings
See `src/data/buildings.js`. Key fields: `size` (square footprint N×N tiles), `hp`, `armor`,
`cost`, `buildTime`, `tier` (required tier), `requires` (building ids the player must own,
completed), `produces` (array of unit ids, or `'creatures' | 'gods' | 'titan'` resolved per
pantheon by `producibleAt()`), `popProvided`, `dropOff`, `prayerSlots`, `faithRate`
(faith/s per praying worshipper), `attack` (towers), `tierUpgrades` (town center only).
Gold mines are 3×3 resource entities placed by the map.

### 4.4 Ability
```js
{
  id: 'greek_zeus_thunderbolt', name: 'Thunderbolt', key: 'Q',
  unlockLevel: 1,
  autocast: false,            // creatures/priest: sim casts automatically when a valid target exists
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
| T1 creature | ~80/0/40 | 2 | 350–500 | 9–12 | train 20 s, Village |
| T2 creature | ~120/20/100 | 3 | 550–800 (air 450–600) | 14–20 | 1 ability or strong passive, train 28 s, Town |
| T3 creature | ~180/60/180 | 5 | 1000–1400 | 25–40 | splash or siege (buildingMult 2), train 40 s, City |
| God (lvl 1) | 100/0/200 | 5 | 900–1200 | 18–24 | armor 3–5, speed 3.0–3.4, sight 10, summon 35 s |
| God abilities | | | | | Q: cd 8–14, ~120–160 dmg r≈2 or equivalent. W: cd 14–25 utility (heal/buff/cc/summon). R: cd 60–120, big (≈400 dmg r≈4, or an army buff, or a summon of 3–5 minions) |
| Titan | 400/200/800 | 10 | 5000–6500 | 70–100 | armor 6–8, speed 2.0–2.4, radius 1.2–1.6, splash ~1.5, buildingMult 2, summon 60 s; Q cd 20–40, R cd 60–90 |
| Minion | 0 | 0 | 150–400 | 6–12 | duration 20–40 s |

## 5. Rules

### 5.1 Start
Each player: Town Center (tier 1, Village) at its start position, 5 Worshippers, 400 gold,
200 wood, 50 faith. A gold mine (12000) 2–4 tiles from the Town Center, a forest edge 6–10
tiles away. Population cap = sum of `popProvided` of completed buildings, max 150.
Pop used = pop of living units + pop of everything queued in production.

### 5.2 Economy
- **Gold:** Worshipper walks to its own spot on the mine edge (one per tile around the
  footprint, the free one nearest its drop-off, kept for the whole order), mines `MINE_TIME`
  (1.5 s), carries `CARRY_AMOUNT` (10) to the nearest completed drop-off (Town Center or
  Storehouse), repeats. At most `MINE_SLOTS` (2) workers mine a mine at once (any owner);
  the others wait at their spot (state `gather`, view key `mw: 1`) and take a freed slot
  first come, first served. One mine therefore yields at most
  `MINE_SLOTS × 10 / MINE_TIME` ≈ 13.3 gold/s:
  about 3 gold/s per worker at a start mine, saturated by 5–6 workers. A mine at 0 is
  removed (`resourceDepleted` event); its workers move to the nearest mine within 16 tiles.
- **Wood:** each forest tile holds `TREE_WOOD` (50). A worker stands next to a tree and chops
  1 wood per `CHOP_INTERVAL` (0.6 s) up to 10, returns it, comes back to the same tree or the
  nearest other tree. A depleted tree tile becomes grass (`treeFelled` event) and is passable.
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
- Progress per second = `(1 + BUILD_HELPER_BONUS × (builders − 1)) / buildTime`; hp grows
  proportionally to max hp. Leaving pauses construction; a worker smart-clicking an
  unfinished own building resumes/helps.
- Placement: all footprint tiles in bounds, ground-passable (not forest/water/rock), no
  building/mine footprint overlap, no enemy units on it (own units are pushed out), and every
  drop-off (Town Center, Storehouse) keeps a gap of ≥ `DROPOFF_MINE_GAP` (3) empty tiles
  (Chebyshev: `max(gapX, gapY)`) from every gold mine footprint. Error: `Too close to a gold
  mine.` when the gap is the only problem, else `Can't build there.`;
  `world.placementError(i, typeId, tx, ty)` returns that text (null = valid) and
  src/game/placement.js `checkPlacement(...).message` gives the same on the client.
- `cancelBuild` on an unfinished building: removes it, refunds `CANCEL_BUILD_REFUND` (75%).

### 5.4 Production
- `train` puts an item in the building's queue (max 5). Cost and population are reserved
  when queued (refunded on `cancelTrain`). Units spawn at the footprint edge nearest the rally
  point and then follow the rally (rally on a mine/tree → worker gathers).
- Creatures need tier ≥ their tier. Gods: unique per player (no duplicates alive or queued),
  max `MAX_GODS` (3) alive+queued, and the n-th god needs tier `GOD_SLOT_TIER[n-1]`
  (1st Village, 2nd Town, 3rd City). Titan: max 1 alive+queued, needs Titan Gate (City).
- **Revive:** a fallen god can be re-summoned at a Temple for `REVIVE_COST_MULT` of its cost
  and time, keeping its level and xp (`train` with that god's id when it is in `fallen`).
- **Tier up:** `upgradeTier` on the Town Center queues a `tier_up` item (cost from
  `tierUpgrades`, `requires` buildings). While it runs, that Town Center cannot train.
  Player tier = highest tier among their completed Town Centers.

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
- Neutral creeps (owner −1) sit at camps, attack anything within `CREEP_AGGRO_RANGE`, chase up
  to `CREEP_LEASH_RANGE` from camp, then walk back and heal to full. They give the killer's
  owner a bounty of `10 + 10 × tier` gold.

### 5.6 Gods
- Levels 1–6 by cumulative xp `GOD_XP_LEVELS`. When an enemy unit dies, every living god of
  the opposing side within `XP_RANGE` gets `xpValue(type)` split evenly between them.
- Each level above 1: +8% max hp and attack damage, +0.5 armor, +10% ability amounts.
- Abilities unlock at their `unlockLevel`. Gods regenerate 1 hp/s.
- When a god dies, it goes to the player's `fallen` list (with level & xp).

### 5.7 Victory
A player is **defeated** when they own no buildings (finished or not). Their remaining units
die. A team wins when every player not on that team is defeated (neutral excluded).
`surrender` defeats the issuing player. Then `gameOver: { winningTeam }`.

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
{ type: 'build',      units: [workerIds], building: typeId, tx, ty, queue } // footprint top-left tile
{ type: 'train',      building: id, unit: typeId }                // also creatures, gods, titan, revive
{ type: 'cancelTrain', building: id, index }
{ type: 'upgradeTier', building: id }
{ type: 'cancelBuild', building: id }
{ type: 'rally',      building: id, x, y, target?: id }
{ type: 'stop',       units }
{ type: 'hold',       units }
{ type: 'cast',       unit: id, ability: abilityId, x?, y?, target?: id, queue }
{ type: 'surrender' }
```
**smart** resolution per unit: enemy target → attack; worker + gold mine → gather; worker +
tree tile (tx,ty given or the clicked tile is forest) → gather wood; worker carrying cargo +
own drop-off → return cargo; worker + own unfinished building → help build; worker + own
completed Shrine/Temple → pray; otherwise ally target → follow (move to it); else move.
Units that cannot do the resolved action just move.

Errors emit `{ type: 'error', player, message }` with these messages:
`Not enough gold.` `Not enough wood.` `Not enough faith.` `Not enough population. Build more Houses.`
`Can't build there.` `Too close to a gold mine.` `Requires Town.` `Requires City.`
`Requires a <Building>.` (e.g. `Requires a Shrine.`) `Production queue is full.`
`The Town Center is growing.` `You already have that god.` `You can only have 3 gods.`
`Your next god requires Town.` `Your next god requires City.` `You already have a Titan.`
`That ability is not ready.` `That ability unlocks at level N.` (N = the ability's `unlockLevel`)
`Target out of range.` `This Shrine is full.` / `This Temple is full.` (the building's name).

### 6.3 ViewSnapshot (`world.getSnapshot()`)
Short keys keep network deltas small. Numbers: positions rounded to 0.01, hp to integers.
```js
{
  tick, time,                 // time in seconds
  players: [{ i, name, team, pantheon, color, kind, gold, wood, faith, faithRate, pop, popCap,
              tier, defeated, gods: [typeIds alive], fallen: { typeId: level }, titan: bool,
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
  lv, xp,         // gods only (else omitted)
  cd,             // { abilityId: secondsRemaining } (only abilities on cooldown)
  fx,             // status codes: subset of ['stun','slow','shield','invuln','buff','debuff','dot']
  ex,             // seconds until a summoned minion expires (omitted if permanent)
  bo,             // pending build order for workers: { b: typeId, tx, ty } (omitted otherwise)
  mw,             // 1 while a worker waits its turn at a gold mine (all MINE_SLOTS taken); omitted otherwise
  // buildings:
  tx, ty,         // footprint top-left tile
  bp,             // build progress 0..1 (1 = complete)
  q,              // queue [{ u: typeId | 'tier_up', p: 0..1 }] (first item progressing)
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
{ type: 'bounty',  player, amount, x, y }                            // creep-kill gold
{ type: 'spawn',   id, t, o }                                        // unit trained/summoned/revived
{ type: 'construction', id, t, o }                                   // building placed
{ type: 'buildingComplete', id, t, o }
{ type: 'tierUp',  player, tier }
{ type: 'levelUp', id, level }
{ type: 'treeFelled', tx, ty }
{ type: 'resourceDepleted', id }
{ type: 'error',   player, message }
{ type: 'underAttack', player, x, y, id }                            // throttled 10 s per player
{ type: 'titanSummoning', player, t }                                // broadcast drama
{ type: 'playerDefeated', player }
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
`world.placementError(i, typeId, tx, ty)` → `"Can't build there." | "Too close to a gold mine." | null`,
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
`generateMap({ seed, mapSize, playerCount })` → pure deterministic function (same input → identical output in every browser and in Node):
```js
{
  width, height, seed,
  terrain: Uint8Array(w*h),        // TERRAIN codes from config
  heights: Float32Array((w+1)*(h+1)), // cosmetic vertex heights, render only (water ≈ -0.6, land 0..0.8)
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
  (`conn.setTimeoutMs`, sessions' `connTimeoutMs`).
- **Untrusted input**: a reassembled message may be at most 1 MB from a client and 32 MB from
  the host; more than 100 malformed frames in 10 s closes with 'protocol-error'. Token buckets
  per client (rate/s, burst): in game `cmd` 40/80, `chat` 1/5, `ping` 4/8, `resync` at most one
  per second (deferred); in the lobby `lobby` patches 5/10, `chat` 1/5, `ping` 4/8, one `hello`.
  The host rebuilds every client command from a whitelist (src/net/sanitize.js: 17 types, typed
  fields, unit lists deduped and capped at 256, coordinates clamped, type ids own keys of the
  data tables, `player` never from the client). Names ≤ 20 and chat ≤ 200 code points with
  control/bidi characters stripped. Clients validate what the host sends: lobby states, the
  GameSetup (else kicked with "invalid game setup"), snapshots (`isValidSnapshot`), deltas
  (apply failure → `resync`), chat, and end/kick reasons (≤ 300 chars, else 'host-quit').
- Messages are JSON objects with `t`:
  - client→host: `hello {name, version}`, `lobby {patch}`, `cmd {cmd}`, `chat {text}`, `ping {ts}`, `resync {}`
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
  host.setMapSize('small'|'medium'); host.canStart(); host.onChat(cb); host.sendChat(text);
  const { setup, myIndex, conns } = host.start(); // conns: Map<playerIndex, conn>; resolves 'random' pantheons with the seed
  const client = await LobbyClient.join({ transport, roomCode, name });
  client.state; client.mySlot; client.onChange(cb); client.setMine({ pantheon, team, color });
  client.onStart(cb({ setup, myIndex, conn })); client.onKicked(cb(reason)); client.onChat(cb); client.sendChat(text);
  ```
  LobbyState: `{ roomCode, mapSize, slots: [4 × { kind: 'host'|'human'|'ai'|'open'|'closed', name, pantheon ('random' allowed), team (1–4), color (index into PLAYER_COLORS), difficulty ('easy'|'normal'|'hard'), peerId }] }`.
  Presets: `coop` = humans team 1 + AI Normal on team 2 filling remaining slots (2 humans vs 2 AI on medium);
  `1v1` = 2 slots, teams 1/2, small map; `2v2` = teams 1,1,2,2; `ffa` = each its own team.
  Can start when ≥ 2 teams have players and every human slot is connected.
- Sessions:
  - `HostSession({ setup, myIndex, conns, createWorld, createAI })`: owns the World, runs the
    ticker (`src/net/ticker.js`, a Worker-driven metronome so ticks keep running in a background
    tab, with catch-up capped at 5 ticks), applies `cmd` messages as
    `world.issueCommand(slotOfConn, cmd)`, ticks AIs, pushes each snapshot into its local
    `ViewState`, sends deltas. A client that disconnects becomes an AI (Normal) and a system chat
    line is shown. Single-player = HostSession with no conns.
  - `ClientSession({ setup, myIndex, conn })`: decodes full/delta into its `ViewState`;
    `sendCommand(cmd)` → `{t:'cmd', cmd}`; `ready` (promise, first full snapshot), `pingMs`,
    `mapMismatch` (setup `mapHash` differs from the locally generated map). `onEnd({ reason })`:
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
  ```
  Host local view uses a 50 ms delay; clients use `INTERP_DELAY_MS`.

## 8. Rendering (src/render/)

Three.js scene owned by `GameRenderer` (`src/render/game-renderer.js`):
```js
const r = new GameRenderer(canvas, { viewState, setup, quality: 'low'|'medium'|'high' });
r.update(dtSeconds);   // sync meshes from viewState (interpolated positions), animate, VFX from events
r.render();
r.resize(w, h);
r.camera              // CameraController: target {x, y}, pan(dx, dy) tiles, zoomBy(steps), centerOn(x, y), getViewQuad() → 4 {x,y} ground corners
r.screenToWorld(sx, sy) → {x, y} | null      // ground point (raycast vs terrain)
r.pickEntity(sx, sy) → id | null             // visible entity under the cursor (projected-position pick, buildings by footprint)
r.entitiesInRect(x0, y0, x1, y1) → [ids]     // units whose projected position is inside the screen rect
r.worldToScreen(x, y, h = 0) → { sx, sy, onScreen }
r.setSelection(ids); r.setHover(id | null);
r.showPlacement(buildingTypeId, tx, ty, valid, tiles?); r.hidePlacement();
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
  and caches geometry/materials per unit type. `src/render/models/building-models.js` exports
  `buildBuildingModel(buildingTypeId, pantheon, teamColor, tier) → { root, height, setProgress(bp) }`
  and `buildGoldMineModel()`. `src/render/models/props.js` exports tree instancing helpers
  (`createForest(mapData)` → `{ object3d, fell(tx, ty) }`), `createDecor(mapData)`.
- VFX: `src/render/vfx.js` exports `class VFXSystem(scene, getHeight)` with
  `spawnProjectile({ kind, el, from: {x, y, h}, to: {x, y, h}, flight })`,
  `spawnEffect({ el, shape, x, y, r, fx, fy, points, duration })`, `spawnHit({ x, y, h, el })`,
  `spawnDeath({ x, y, scale })`, `spawnLevelUp({ x, y })`, `spawnSummon({ x, y, scale, el })`,
  `spawnDust({ x, y, size })`, `update(dt)`, `dispose()`. Positions in sim coords; h = height above ground.
- Look: low-poly, flat-shaded (`MeshLambertMaterial({ flatShading: true })` or Standard with roughness 1),
  warm sun + hemisphere light, soft fog at distance, shadows on medium/high quality.
  Terrain: vertex-colored grid using `heights`, water plane with gentle animated color.
  Fog of war: explored-but-not-visible areas darkened (~45%), unexplored near-black; enemy units
  hidden when not visible; enemy buildings shown as last seen.
- Vision-edge fade (`src/render/unit-fade.js`): enemy and neutral units that come into sight
  after load fade in over `FADE_SECONDS` (0.25 s) and fade out the same way when they leave
  it (own and allied units, and everything visible at load, never fade). A fading-out unit is
  drawn but cannot be picked. Fading meshes swap to cached material variants quantized to 8
  levels (`alphaHash` for opaque materials, scaled opacity for transparent ones); shadows are
  off while a unit is see-through.
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

## 9. UI (src/ui/) — HTML/CSS overlay

- `menu.js` (+ `style.css`): title screen (Play vs AI, Host Online, Join Online, How to Play,
  Settings), lobby screen (4 slot rows: color, name/kind dropdown, pantheon picker with
  Random, team, AI difficulty; presets; map size; room code with Copy and Copy Invite Link
  `?join=CODE`; chat; Start for host), join screen (name + code), how-to-play, settings
  (name, volume, graphics quality, edge scrolling). Pantheon picker shows each pantheon's gods,
  titan and creatures (from data) so choosing is fun.
- `hud.js` (+ `hud.css`): WC3-like layout. Top bar: gold, wood, faith (+rate), population,
  game clock, menu button. Bottom panel: minimap (left), selection (center: single unit
  portrait/icon, name, hp, armor, damage, level/xp bar, statuses, queue with progress and
  cancel; multi-select grid of icons with hp), command card (right, 4×3 buttons with hotkeys,
  tooltips with cost/description, cooldown overlays, disabled when unaffordable/locked).
  God portraits top-left (click selects, double-click centers). Messages (errors, alerts,
  "Kronos is being summoned!"), chat (Enter), game-over overlay with stats, menu (surrender, quit).
- Getting-started tips (`src/ui/hud-tips.js`): a checklist in the top-right corner (mine gold →
  build → pray at a Shrine → summon a god → Titan Gate). Steps tick themselves from the
  ViewState and stay ticked; ✕ or finishing every step saves `tipsDismissed: true`
  (src/settings.js), and Settings or the F10 menu can turn them back on. Hidden for spectators
  and defeated players.
- Info panel (`src/ui/hud-info.js`): a selected gold mine shows "Gold left", "Miners n/2"
  (snapshot `mn` / `MINE_SLOTS`), how many of your Worshippers work there, and the
  2-at-once rule. A worker's state line reads "Gathering gold", "Chopping wood", or "Waiting
  its turn at the gold mine" (view key `mw`).
- `input.js`: left click select, drag box select, shift add/remove, double-click selects same
  type on screen, Ctrl+1–9 groups, 1–9 recall (double tap centers), right-click smart command
  (shift queues), hotkeys from the command card, targeting modes (attack-move A, ability
  targeting, build placement with ghost (a refused click shows the client-side
  `checkPlacement(...).message`); Esc cancels; right-click cancels targeting), camera:
  edge scroll, arrow keys, mouse wheel zoom, middle-drag pan, minimap click/drag, Space centers
  on selection or last alert, F1–F3 select gods, Alt shows all health bars.
- `command-card.js`: pure function `getCommandCard(selection, viewState, mode) → buttons[12]`.
  Hotkeys: units M move, S stop, H hold, A attack; workers + G gather, B build (submenu: House H,
  Barracks B, Shrine S, Storehouse O, Tower T, Temple E, Titan Gate G, Town Center C), P pray,
  C return cargo; abilities Q W E R in the bottom row. Buildings: train buttons (Town Center:
  Worshipper W, Grow U; Barracks: Warrior W, Archer A, Priest P, Ram R; Shrine: creatures Q W E;
  Temple: gods Q W E R + revive; Titan Gate: titan T), rally Y, cancel construction Esc.
- `minimap.js`: 2D canvas: terrain colors, mines, trees, units/buildings as team-colored dots
  (visible only), fog, camera quad; click/drag moves camera, right-click issues smart move.
- Audio `src/audio/sfx.js`: WebAudio-synthesized sounds, `sfx.play(name, { x, y })` with
  distance attenuation from `sfx.setListener(x, y)`.
  Names: click, select, move, attack_melee, attack_ranged, hit, death, build, building_complete,
  train, summon_god, summon_titan, lightning, fire, magic, heal, error, victory, defeat,
  tier_up, chop, mine, pray, horn.

## 10. AI (src/ai/)

`createAI(world, playerIndex, difficulty) → { tick() }`. Called every sim tick on the host;
thinks every `AI_THINK_INTERVAL[difficulty]` ticks. Reads world state, acts **only** through
`world.issueCommand(playerIndex, cmd)`. Behavior: keep training worshippers (to ~16/22/26 by
difficulty), split them gold ~60% / wood ~25% / prayer the rest (more prayer once a Temple
exists), build houses ahead of the pop cap, Barracks, Shrine, Temple, summon gods, tier up,
second Barracks, towers, Titan Gate in City; train a mix of warriors/archers/creatures; defend
when its buildings are attacked; attack in waves when its army is strong enough (later and
smaller on easy); target the nearest enemy base (prefer the weakest enemy in multi-enemy
games); gods cast abilities sensibly (damage on clumps, heals when allies hurt, ultimates in
big fights); retreat badly hurt gods to base. Hard is fair (no resource cheats).

## 11. Game controller (src/game/game.js, src/main.js)

`main.js` boots settings, shows the menu, and on lobby start builds a HostSession or
ClientSession, then `new Game({ session, settings })`: creates GameRenderer on a canvas, HUD,
InputController, sfx listener; requestAnimationFrame loop: `viewState.update(now)`,
`renderer.update(dt)`, `renderer.render()`, `hud.update()`. Events from `viewState.on('*')`
drive VFX, sounds and HUD messages. Game over → overlay → back to menu.

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
