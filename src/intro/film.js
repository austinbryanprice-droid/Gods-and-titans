// The intro film (DESIGN 11.1): the stage (stage.js) drawn by the real GameRenderer through the
// script's camera (script.js). It owns the film clock, nothing else: the page's overlay, the
// skip keys and the hand-over to the title screen are intro.js.
//
//   const film = new IntroFilm({ canvas, Renderer: GameRenderer, quality });
//   film.advance(dt); film.draw(now);       // once a frame
//   film.view                                // { t, fade, bars, caption } for the overlay
//   film.dispose();                          // frees the renderer's GL context
import { IntroStage } from './stage.js';
import { FilmSky } from './sky.js';
import { FILM_LENGTH, barsAt, cameraAt, captionAt, fadeAt, hourAt, shotAt } from './script.js';

const MAX_DT = 0.1;
const FOLLOW = 5; // 1/s: how quickly the camera's look-at follows a moving subject
const FALLBACK = { zeus: 'temple', kronos: 'gate', surtr: 'gate', thor: 'field' }; // where an actor is before it exists

export class IntroFilm {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {Function} o.Renderer the GameRenderer class
   * @param {'low'|'medium'|'high'|'ultra'} [o.quality]
   * @param {object} [o.webgl] an existing WebGL renderer (tests)
   */
  constructor({ canvas, Renderer, quality = 'medium', webgl = null }) {
    this.stage = new IntroStage({ density: quality === 'low' ? 0.6 : 1 });
    this.t = 0;
    this.shot = shotAt(0);
    this.pose = { x: 0, y: 0, dist: 30, pitch: 30, yaw: 0, lift: 0, fov: 40 };
    this.track = new Map(); // name → the smoothed point the camera looks at
    this.view = { t: 0, fade: 1, bars: 0, caption: null };
    this.locate = (name) => this.track.get(name) || null;
    this.renderer = new Renderer(canvas, { viewState: this.stage.vs, setup: this.stage.setup, quality, webgl, timeOfDay: hourAt(0) });
    this.renderer.camera.setFree(this.pose);
    // a film has no health bars, rank pips or status icons over the heads (a game's overlays; the rest of the picture is the game's)
    const quiet = () => {};
    if (this.renderer.bars) this.renderer.bars.add = quiet;
    if (this.renderer.status) {
      this.renderer.status.addRank = quiet;
      this.renderer.status.addIcons = quiet;
    }
    // the low shots look past the edge of the map: no dark mist there, a sky and the haze the land fades into
    this.sky = new FilmSky();
    this.renderer.scene.add(this.sky.mesh);
    if (this.renderer.terrain && this.renderer.terrain.border) this.renderer.terrain.border.visible = false;
    this.aim(0);
    this.paintSky();
  }

  get done() {
    return this.t >= FILM_LENGTH;
  }

  /** Move the film on by dt seconds: the sim, the sky, the camera. */
  advance(dt) {
    dt = Math.max(0, Math.min(MAX_DT, dt || 0));
    this.t = Math.min(FILM_LENGTH, this.t + dt);
    this.stage.advance(dt);
    this.aim(dt);
    this.renderer.atmo.setMode(hourAt(this.t));
    this.renderer.update(dt);
    this.paintSky();
    const v = this.view;
    v.t = this.t;
    v.fade = fadeAt(this.t);
    v.bars = barsAt(this.t);
    v.caption = captionAt(this.t);
  }

  paintSky() {
    this.sky.update(this.renderer.atmo.state, this.renderer.threeCamera.position, this.t);
  }

  /** Point the camera for the film's second: each subject of the shot is followed (easing toward where it is), then the script places the camera round them. */
  aim(dt) {
    const shot = shotAt(this.t);
    if (shot !== this.shot) {
      this.shot = shot;
      this.track.clear(); // a cut starts on its subjects, with no glide from the last shot's
    }
    const k = 1 - Math.exp(-FOLLOW * dt);
    for (const name of new Set(['village', ...shot.cam.map((c) => c.at)])) {
      const target = this.rawPoint(name);
      if (!target) continue;
      const p = this.track.get(name);
      if (!p) this.track.set(name, { x: target.x, y: target.y });
      else {
        p.x += (target.x - p.x) * k;
        p.y += (target.y - p.y) * k;
      }
    }
    cameraAt(this.t, this.locate, this.pose);
  }

  /** Where a named point of the set is: an anchor, an actor (its anchor until it exists, its last place once it has fallen), or the crowd. */
  rawPoint(name) {
    const stage = this.stage;
    if (name === 'crowd') return stage.crowd();
    const a = stage.anchors[name];
    if (a) return a;
    const unit = stage.actor(name);
    if (unit) return { x: unit.x, y: unit.y };
    return stage.seen.get(name) || stage.anchors[FALLBACK[name]] || null;
  }

  draw(now) {
    this.renderer.render(now);
  }

  resize(w, h) {
    this.renderer.resize(w, h);
  }

  dispose() {
    this.renderer.scene.remove(this.sky.mesh);
    this.sky.dispose();
    this.renderer.dispose();
  }
}
