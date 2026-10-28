// The music director: what happens in the match becomes the battle intensity of the music (DESIGN 9,
// "Music"). It watches the ViewState like the alert engine does, adds "heat" for every blow struck on
// the player's side, every loss, a Titan rising or the peace ending, lets the heat cool as the
// fighting stops, and hands the result to the music as an intensity from 0 (a quiet day of
// building) to 1 (a full battle). The score (src/audio/music-composer.js) decides what each level
// sounds like; this file only decides how tense the match is. Pure and DOM-free.
//
//   const director = new MusicDirector({ viewState, music }).attach();   // plays the player's pantheon theme
//   director.update(dt);                                                  // once a frame, dt in real seconds
//   director.dispose();
import { UNITS } from '../data/index.js';
import { pantheonOf } from '../ui/hud-data.js';

/** Seconds for the heat to fall by 1/e once the fighting stops (the music then eases down on top of it). */
export const HEAT_TAU = 10;
/** The heat at which the intensity reaches 63%: a duel is a little tense, ten against ten a full battle. */
export const HEAT_SCALE = 55;
/** During the Decade of Peace the fights are with creatures only: the music stays below the war drums. */
export const PEACE_CEILING = 0.3;

/** How much heat each thing adds. Blows are the steady part; the rest are single shocks. */
export const HEAT = {
  ownHit: 1, // a unit or building of mine or an ally's was struck
  myHit: 0.8, // my side struck something
  sightedHit: 0.3, // others fighting where I can see
  underAttack: 14,
  ownDeath: 4,
  ownBuildingDeath: 8,
  ownBigDeath: 40, // a god or a Titan fell
  titanRising: 36, // a Titan is being summoned, or has appeared, anywhere
  peaceEnd: 40,
  wave: 20, // Trial of the Titans: a wave comes out (a Titan's wave counts as titanRising too)
};

/** Heat in, intensity out. */
export class TensionMeter {
  constructor() {
    this.heat = 0;
  }

  add(amount) {
    if (amount > 0) this.heat = Math.min(this.heat + amount, HEAT_SCALE * 6);
  }

  /** Cool by `dt` seconds and return the intensity (0..1). */
  step(dt) {
    if (dt > 0) this.heat *= Math.exp(-dt / HEAT_TAU);
    return this.level();
  }

  level() {
    return 1 - Math.exp(-this.heat / HEAT_SCALE);
  }

  reset() {
    this.heat = 0;
  }
}

export class MusicDirector {
  /**
   * @param {object} o
   * @param {object} o.viewState the match as the local player sees it
   * @param {{ play(id: string): void, setIntensity(v: number): void }} o.music the music engine
   */
  constructor({ viewState, music }) {
    this.vs = viewState;
    this.music = music;
    this.meter = new TensionMeter();
    this.offs = [];
    this.started = false;
    this.level = 0;
    this.sent = -1;
  }

  /** Start listening, and start the theme as soon as the first snapshot says whose pantheon it is. */
  attach() {
    this.offs.push(this.vs.on('*', (ev) => this.onEvent(ev)));
    this.offs.push(this.vs.on('snapshot', () => this.begin()));
    this.begin();
    return this;
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
  }

  /** Play the pantheon's theme once (a spectator hears the first player's). */
  begin() {
    if (this.started || !this.vs.snapshot) return;
    this.started = true;
    const vs = this.vs;
    const id = pantheonOf(vs, vs.myIndex >= 0 ? vs.myIndex : 0) || 'menu';
    this.music.play(id);
    this.send(0);
  }

  send(level) {
    this.sent = level;
    this.music.setIntensity(level);
  }

  /** My side: me or an ally. */
  isMine(entity) {
    if (!entity || this.vs.myIndex < 0) return false;
    const r = this.vs.relation(entity.o);
    return r === 'own' || r === 'ally';
  }

  /** Is the entity in sight (so a fight around it is one the player can watch)? */
  seen(entity) {
    return !!entity && Number.isFinite(entity.x) && Number.isFinite(entity.y) && this.vs.isVisibleAt(entity.x, entity.y);
  }

  onEvent(ev) {
    const vs = this.vs;
    if (vs.gameOver || (vs.me && vs.me.defeated)) return; // the match is decided: no more drama
    const add = (n) => this.meter.add(n);
    switch (ev.type) {
      case 'hit': {
        const dst = vs.entities.get(ev.dst);
        const src = vs.entities.get(ev.src);
        if (this.isMine(dst)) add(HEAT.ownHit);
        else if (this.isMine(src)) add(HEAT.myHit);
        else if (this.seen(dst) || this.seen(src)) add(HEAT.sightedHit);
        break;
      }
      case 'underAttack':
        if (ev.player === vs.myIndex) add(HEAT.underAttack);
        break;
      case 'death': {
        const r = vs.relation(ev.o);
        if (r !== 'own' && r !== 'ally') break;
        if (ev.k === 'b') add(HEAT.ownBuildingDeath);
        else {
          const t = UNITS[ev.t];
          add(t && (t.class === 'god' || t.class === 'titan') ? HEAT.ownBigDeath : HEAT.ownDeath);
        }
        break;
      }
      case 'titanSummoning':
        add(HEAT.titanRising);
        break;
      case 'spawn': {
        const t = UNITS[ev.t];
        if (t && t.class === 'titan') add(HEAT.titanRising);
        break;
      }
      case 'peaceEnd':
        add(HEAT.peaceEnd);
        break;
      case 'wave':
        add(ev.boss ? HEAT.titanRising : HEAT.wave);
        break;
      default:
        break;
    }
  }

  /** Once a frame. `dt` is the real seconds since the last one. Returns the intensity. */
  update(dt) {
    const vs = this.vs;
    if (vs.gameOver || (vs.me && vs.me.defeated)) this.meter.reset();
    let level = this.meter.step(Number.isFinite(dt) ? dt : 0);
    if (vs.peaceActive()) level = Math.min(level, PEACE_CEILING);
    this.level = level;
    // The music only hears real changes (and the way back to exactly calm).
    if (Math.abs(level - this.sent) >= 0.004 || (level === 0 && this.sent !== 0)) this.send(level);
    return level;
  }
}
