// The replay bar (DESIGN 9.3): over the bottom panel while a replay plays. Play / pause, the speeds,
// a timeline to click (ahead jumps in place, back starts over and jumps), +30 s, whose eyes to see
// through (everyone or one player, with their fog of war), the free camera (turn and tilt, back to
// the normal view) and leaving. It also says when the replay was recorded on another version of the
// game and where it parted from what happened. Keys: Space, [ and ], Q / E, R / F, V, J.
import { el, setText, setClass, setHidden, setStyle, safeColor } from './hud-dom.js';
import { formatClock } from './hud-data.js';
import { REPLAY_SPEEDS } from '../game/replay-session.js';
import { fromOtherBuild } from '../game/replay.js';
import { PANTHEON_EMBLEMS } from './menu-model.js';
import { TICK_RATE } from '../config.js';

export const JUMP_SECONDS = 30;
const TURN_STEP = 15; // degrees a press of Q / E turns the view
const TILT_STEP = 6; // degrees a press of R / F tilts it

function button(cls, label, title, onClick) {
  const b = el('button', `hud-rp-btn ${cls}`, label);
  b.type = 'button';
  b.tabIndex = -1;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    onClick(e);
  });
  return b;
}

const speedLabel = (s) => (s === 0.5 ? '½×' : `${s}×`);

export class ReplayBar {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root the HUD root
   * @param {object} o.game the Game (session is a ReplaySession; renderer for the camera)
   * @param {(tick: number) => void} o.onSeekBack start the replay over at a tick before the current one
   */
  constructor({ root, game, onSeekBack }) {
    this.game = game;
    this.session = game.session;
    this.onSeekBack = onSeekBack;
    this.sig = '';
    this.offs = [];
    const s = this.session;

    this.playBtn = button('hud-rp-play', '▶', 'Play / pause (Space)', () => s.togglePause());
    this.restartBtn = button('hud-rp-restart', '⏮', 'From the start', () => this.seekTo(0));
    this.speedBtns = REPLAY_SPEEDS.map((sp) => {
      const b = button('hud-rp-speed', speedLabel(sp), `Speed ${speedLabel(sp)} ([ and ])`, () => s.setSpeed(sp));
      b.dataset.speed = String(sp);
      return b;
    });
    this.jumpBtn = button('hud-rp-jump', `+${JUMP_SECONDS}s`, `Jump ${JUMP_SECONDS} seconds ahead (J)`, () => this.jump(JUMP_SECONDS));

    this.time = el('span', 'hud-rp-time');
    this.fill = el('div', 'hud-rp-fill');
    this.driftMark = el('div', 'hud-rp-drift');
    this.driftMark.hidden = true;
    this.track = el('div', 'hud-rp-track', this.fill, this.driftMark);
    this.track.title = 'Click to go to that moment';
    this.track.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const r = this.track.getBoundingClientRect();
      const f = r.width > 0 ? (e.clientX - r.left) / r.width : 0;
      this.seekTo(Math.round(Math.max(0, Math.min(1, f)) * s.length));
    });

    // Whose eyes: everyone, or one player (their fog of war and their resources in the top bar).
    this.vision = el('select', 'hud-rp-vision');
    this.vision.title = 'See the game as everyone, or through one player\'s eyes (V)';
    this.vision.setAttribute('aria-label', 'Vision');
    this.vision.appendChild(new Option('👁 Everyone', '-1'));
    s.record.players.forEach((p, i) => {
      const o = new Option(`${PANTHEON_EMBLEMS[p.pantheon] || '✦'} ${p.name}`, String(i));
      o.style.color = safeColor(p.color);
      this.vision.appendChild(o);
    });
    this.vision.addEventListener('change', () => this.setViewer(Number(this.vision.value)));

    const cam = () => (game.renderer ? game.renderer.camera : null);
    this.turnL = button('hud-rp-cam', '⟲', 'Turn the view left (Q)', () => cam() && cam().rotate(-TURN_STEP));
    this.turnR = button('hud-rp-cam', '⟳', 'Turn the view right (E)', () => cam() && cam().rotate(TURN_STEP));
    this.tiltUp = button('hud-rp-cam', '⤒', 'Tilt the view up, toward the horizon (R)', () => cam() && cam().tiltBy(-TILT_STEP));
    this.tiltDown = button('hud-rp-cam', '⤓', 'Tilt the view down (F)', () => cam() && cam().tiltBy(TILT_STEP));
    this.resetCam = button('hud-rp-cam hud-rp-reset', '⌖', 'The normal view: north up, the usual tilt', () => cam() && cam().resetAngle());

    this.exitBtn = button('hud-rp-exit', 'Leave', 'Leave the replay', () => game.quitToMenu());

    this.note = el('div', 'hud-rp-note');
    this.note.hidden = true;
    this.title = el('div', 'hud-rp-title', el('b', null, 'Replay'), ` · ${s.record.mode}`);

    this.root = el('div', 'hud-replay hud-panel',
      el('div', 'hud-rp-row',
        this.title,
        el('div', 'hud-rp-group', this.restartBtn, this.playBtn, this.jumpBtn),
        el('div', 'hud-rp-group hud-rp-speeds', ...this.speedBtns),
        el('div', 'hud-rp-group', this.vision),
        el('div', 'hud-rp-group', this.turnL, this.turnR, this.tiltUp, this.tiltDown, this.resetCam),
        this.exitBtn),
      el('div', 'hud-rp-row hud-rp-timeline', this.time, this.track),
      this.note);
    this.root.addEventListener('mousedown', (e) => {
      if (e.target !== this.vision) e.preventDefault();
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.appendChild(this.root);
    if (fromOtherBuild(s.record)) this.showNote('This replay was recorded on an earlier version of the game. It may play out differently from how the match went.', false);
    this.offs.push(s.onChange(() => this.render()));
    this.render();
  }

  setViewer(i) {
    this.session.setViewer(i);
    const g = this.game;
    if (g.selection) g.selection.set([]);
    if (g.renderer) g.needsRender = true;
  }

  /** One step through the vision list (V). */
  cycleViewer() {
    const n = this.session.record.players.length;
    const cur = this.session.myIndex;
    this.setViewer(cur + 1 >= n ? -1 : cur + 1);
  }

  jump(seconds) {
    const s = this.session;
    this.seekTo(Math.min(s.length, (s.seeking ? s.seeking.target : s.tick) + seconds * TICK_RATE));
  }

  seekTo(tick) {
    const s = this.session;
    const t = Math.max(0, Math.min(s.length, Math.round(tick)));
    if (t >= s.tick) s.seek(t);
    else this.onSeekBack(t);
  }

  /** The replay's keys; true when the key was one of them. */
  onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const s = this.session;
    const cam = this.game.renderer ? this.game.renderer.camera : null;
    const rep = e.repeat === true;
    switch (e.key) {
      case ' ':
        if (!rep) s.togglePause();
        break;
      case '[':
        if (!rep) s.nudgeSpeed(-1);
        break;
      case ']':
        if (!rep) s.nudgeSpeed(1);
        break;
      case 'j':
      case 'J':
        if (!rep) this.jump(JUMP_SECONDS);
        break;
      case 'v':
      case 'V':
        if (!rep) this.cycleViewer();
        break;
      case 'q':
      case 'Q':
        if (cam) cam.rotate(-TURN_STEP / 3);
        break;
      case 'e':
      case 'E':
        if (cam) cam.rotate(TURN_STEP / 3);
        break;
      case 'r':
      case 'R':
        if (cam) cam.tiltBy(-TILT_STEP / 2);
        break;
      case 'f':
      case 'F':
        if (cam) cam.tiltBy(TILT_STEP / 2);
        break;
      default:
        return false;
    }
    e.preventDefault();
    return true;
  }

  showNote(text, danger) {
    setText(this.note, text);
    setClass(this.note, 'is-danger', !!danger);
    setHidden(this.note, false);
  }

  /** Per frame (cheap: only what changed is touched). */
  update() {
    const g = this.game;
    const h = g.hud && g.hud.bottom ? g.hud.bottom.offsetHeight : 0;
    setStyle(this.root, 'bottom', `${h + 8}px`);
    this.render();
  }

  render() {
    const s = this.session;
    const seeking = s.seekProgress();
    const shown = s.seeking ? s.seeking.target : s.tick;
    const sig = `${s.tick}|${s.playing}|${s.ended}|${s.speed}|${s.myIndex}|${s.drift}|${seeking}`;
    if (sig === this.sig) return;
    this.sig = sig;
    setText(this.playBtn, s.ended ? '↻' : s.userPaused ? '▶' : '❚❚');
    this.playBtn.title = s.ended ? 'Watch again from the start (Space)' : s.userPaused ? 'Play (Space)' : 'Pause (Space)';
    setClass(this.root, 'is-paused', s.userPaused || s.ended);
    for (const b of this.speedBtns) setClass(b, 'is-on', Number(b.dataset.speed) === s.speed);
    const len = Math.max(1, s.length);
    setText(this.time, seeking !== null ? `Going to ${formatClock(shown / TICK_RATE)}… ${Math.round(seeking * 100)}%` : `${formatClock(s.tick / TICK_RATE)} / ${formatClock(s.length / TICK_RATE)}`);
    setStyle(this.fill, 'width', `${Math.min(100, (s.tick / len) * 100).toFixed(2)}%`);
    if (this.vision.value !== String(s.myIndex)) this.vision.value = String(s.myIndex);
    this.jumpBtn.disabled = s.ended;
    if (s.drift !== null) {
      setHidden(this.driftMark, false);
      setStyle(this.driftMark, 'left', `${Math.min(100, (s.drift / len) * 100).toFixed(2)}%`);
      this.showNote(`From ${formatClock(s.drift / TICK_RATE)} on, this replay no longer matches the recorded match (it was made on ${fromOtherBuild(s.record) ? 'an earlier version of the game' : 'another build'}). What follows is how this version plays the same orders.`, true);
    } else if (s.ended && !this.note.classList.contains('is-danger')) {
      this.showNote(s.record.truncated ? 'The end of the recording (it was cut short: the match was too long to keep in full).' : 'The end of the match. Press ↻ to watch it again, or Leave.', false);
    } else if (!s.ended && !fromOtherBuild(s.record) && !this.note.classList.contains('is-danger')) setHidden(this.note, true);
  }

  dispose() {
    for (const off of this.offs.splice(0)) off();
    this.root.remove();
  }
}
