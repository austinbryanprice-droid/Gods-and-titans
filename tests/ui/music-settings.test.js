// The music's settings in both places they can be changed, the main menu's Settings screen and the
// F10 menu in a match: a volume and a mute of their own (the sound effects keep theirs), moving the
// slider lifts a mute, and the Settings screen can audition each pantheon's score. The title music
// follows the menu. Fake DOM; the music engine is the real one, which in Node only remembers what
// it was asked to play.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDom } from './fake-dom.js';
import { getSettings, saveSettings } from '../../src/settings.js';
import { Overlays } from '../../src/ui/hud-overlays.js';
import { music } from '../../src/audio/music.js';
import { TITLE_INTENSITY, PREVIEW_MOODS, syncAudio, quietMusic, playTitleMusic } from '../../src/audio/audio.js';
import { PANTHEON_LIST } from '../../src/data/index.js';
import { THEMES } from '../../src/audio/music-themes.js';

let menuRoot;
let showMenu;
before(async () => {
  installFakeDom();
  globalThis.Node = class {
    static [Symbol.hasInstance](x) {
      return !!x && (x.nodeType === 1 || x.nodeType === 3);
    }
  };
  const anything = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : anything()), apply: () => anything() });
  FakeElement.prototype.getContext = function getContext() {
    this.ctxAny = this.ctxAny || anything();
    return this.ctxAny;
  };
  FakeElement.prototype.querySelectorAll = () => [];
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  const menu = await import('../../src/ui/menu.js');
  menuRoot = document.createElement('div');
  menu.createMenu({ root: menuRoot, onStart() {} });
  showMenu = menu.showMenu;
});

beforeEach(() => saveSettings({ volume: 0.7, musicVolume: 0.5, musicMuted: false }));

const field = (label) => menuRoot.findAll('mw-field').find((f) => f.find('mw-label') && f.find('mw-label').textContent === label);

/** The main menu's Settings screen: its Music field and Sound effects field. */
function settingsScreen() {
  showMenu('settings');
  const f = field('Music');
  const slider = f.find('mw-range');
  return {
    slider,
    out: f.find('mw-range-value'),
    mute: f.button('Mute') || f.button('Unmute'),
    name: f.find('mw-music-listen-name'),
    prev: f.all('button').find((b) => b.attrs['aria-label'] === 'Previous theme'),
    next: f.all('button').find((b) => b.attrs['aria-label'] === 'Next theme'),
    moods: f.findAll('mw-seg'),
    sfx: field('Sound effects').find('mw-range'),
    drag: (percent) => {
      slider.value = String(percent);
      slider.fire('input');
    },
  };
}

test('the Settings screen: Sound effects and Music each have a slider, and the music a mute', () => {
  saveSettings({ volume: 0.3, musicVolume: 0.65 });
  const s = settingsScreen();
  assert.equal(s.slider.attrs['aria-label'], 'Music volume');
  assert.equal(s.slider.attrs.value, '65');
  assert.equal(s.out.textContent, '65%');
  assert.equal(s.mute.textContent, 'Mute');
  assert.equal(s.mute.attrs['aria-pressed'], 'false');
  assert.equal(field('Sound effects').find('mw-range').attrs.value, '30');
  assert.equal(field('Sound effects').find('mw-range').attrs['aria-label'], 'Sound effects volume');
});

test('the music slider saves its own volume and leaves the sound effects alone', () => {
  const s = settingsScreen();
  s.drag(20);
  assert.equal(getSettings().musicVolume, 0.2);
  assert.equal(getSettings().volume, 0.7);
  assert.equal(s.out.textContent, '20%');
  assert.equal(s.slider.style.getPropertyValue('--fill'), '20%');
  s.sfx.value = '90';
  s.sfx.fire('input');
  assert.equal(getSettings().volume, 0.9);
  assert.equal(getSettings().musicVolume, 0.2);
});

test('the mute button toggles the mute and says what it will do next; the slider dims', () => {
  const s = settingsScreen();
  s.mute.click();
  assert.equal(getSettings().musicMuted, true);
  assert.equal(s.mute.textContent, 'Unmute');
  assert.equal(s.mute.attrs['aria-pressed'], 'true');
  assert.equal(s.slider.classList.contains('is-muted'), true);
  assert.equal(getSettings().musicVolume, 0.5, 'the volume is kept');
  s.mute.click();
  assert.equal(getSettings().musicMuted, false);
  assert.equal(s.mute.textContent, 'Mute');
  assert.equal(s.slider.classList.contains('is-muted'), false);
});

test('moving the slider while muted lifts the mute; dragging to zero does not', () => {
  const s = settingsScreen();
  s.mute.click();
  s.drag(0);
  assert.equal(getSettings().musicMuted, true, 'zero is no request to hear anything');
  s.drag(40);
  assert.equal(getSettings().musicMuted, false);
  assert.equal(getSettings().musicVolume, 0.4);
  assert.equal(s.mute.textContent, 'Mute');
});

test('the settings reach the music engine: volume, mute, and the sound effects separately', () => {
  const changes = [];
  const probe = { setVolume: music.setVolume.bind(music), mute: music.mute.bind(music) };
  music.setVolume = (v) => {
    changes.push(['volume', v]);
    probe.setVolume(v);
  };
  music.mute = (on) => {
    changes.push(['mute', on]);
    probe.mute(on);
  };
  try {
    syncAudio(getSettings(), ['volume']);
    assert.deepEqual(changes, [], 'the sound-effect volume is not the music');
    syncAudio({ ...getSettings(), musicVolume: 0.25 }, ['musicVolume']);
    syncAudio({ ...getSettings(), musicMuted: true }, ['musicMuted']);
    assert.deepEqual(changes, [['volume', 0.25], ['mute', true]]);
    assert.equal(music.state().volume, 0.25);
    assert.equal(music.state().muted, true);
  } finally {
    music.setVolume = probe.setVolume;
    music.mute = probe.mute;
    music.mute(false);
  }
});

test('the title screen plays the title theme, and the other menu screens keep it going', () => {
  showMenu('title');
  assert.equal(music.state().wanted, 'menu');
  assert.equal(music.state().target, TITLE_INTENSITY);
  showMenu('how');
  assert.equal(music.state().wanted, 'menu');
});

test('the intro film plays over silence: quietMusic takes the music down until the title music is asked for again', () => {
  showMenu('title');
  assert.equal(music.state().wanted, 'menu');
  quietMusic();
  assert.equal(music.state().wanted, null);
  assert.equal(music.state().playing, false);
  playTitleMusic(); // what the film's hand-over does
  assert.equal(music.state().wanted, 'menu');
  assert.equal(music.state().target, TITLE_INTENSITY);
});

test('Settings can audition every pantheon at a calm, tense or battle moment, and leaving brings the title music back', () => {
  showMenu('title');
  const s = settingsScreen();
  assert.equal(s.name.textContent, 'Title screen');
  assert.equal(music.state().wanted, 'menu', 'opening Settings changes nothing');
  assert.equal(music.state().target, TITLE_INTENSITY);
  const heard = [];
  for (let i = 0; i < PANTHEON_LIST.length; i++) {
    s.next.click();
    heard.push(music.state().wanted);
    assert.equal(s.name.textContent, PANTHEON_LIST[i].name);
    assert.equal(music.state().wanted, PANTHEON_LIST[i].id);
  }
  assert.deepEqual(heard, PANTHEON_LIST.map((p) => p.id));
  for (const id of heard) assert.ok(Object.hasOwn(THEMES, id), `${id} has a theme`);
  s.next.click();
  assert.equal(s.name.textContent, 'Title screen', 'the tenth step wraps to the title screen');
  assert.equal(music.state().wanted, 'menu');
  s.prev.click();
  assert.equal(s.name.textContent, PANTHEON_LIST[PANTHEON_LIST.length - 1].name, 'and backwards');
  PREVIEW_MOODS.forEach(([label, level], i) => {
    s.moods[i].click();
    assert.equal(s.moods[i].textContent, label);
    assert.equal(music.state().target, level, label);
    assert.equal(s.moods.filter((b) => b.classList.contains('is-active')).length, 1);
    assert.equal(s.moods[i].classList.contains('is-active'), true);
  });
  assert.ok(PREVIEW_MOODS[0][1] < PREVIEW_MOODS[1][1] && PREVIEW_MOODS[1][1] < PREVIEW_MOODS[2][1]);
  showMenu('title');
  assert.equal(music.state().wanted, 'menu', 'back on the title screen: the title music');
  assert.equal(music.state().target, TITLE_INTENSITY);
});

// ---------------------------------------------------------------- the F10 menu

function f10Game() {
  return { session: null, viewState: { myIndex: 0, time: 125, me: { defeated: false } }, setPaused: () => false, quitToMenu() {}, surrender() {} };
}

function f10Menu() {
  const root = document.createElement('div');
  new Overlays(root, f10Game()).openMenu();
  const rows = root.findAll('hud-vol');
  const row = (label) => rows.find((r) => r.textContent.startsWith(label));
  const toggle = root.findAll('hud-toggle').find((t) => t.textContent.startsWith('Music'));
  return {
    root,
    toggle: toggle.all('input')[0],
    slider: row('Music volume').all('input')[0],
    text: row('Music volume').find('hud-vol-text'),
    sfxSlider: row('Sound effects').all('input')[0],
  };
}

test('F10 menu: a Music switch and a Music volume of their own, after the sound effects', () => {
  saveSettings({ musicVolume: 0.8, musicMuted: true });
  const s = f10Menu();
  assert.equal(s.toggle.checked, false, 'the switch shows the mute');
  assert.equal(s.slider.value, '80');
  assert.equal(s.text.textContent, '80%');
  assert.equal(s.sfxSlider.value, '70');
  const text = s.root.find('hud-options').textContent;
  assert.ok(text.indexOf('Sound effects') >= 0 && text.indexOf('Sound effects') < text.indexOf('Music'));
});

test('F10 menu: the switch mutes the music, the slider sets its volume and lifts a mute', () => {
  const s = f10Menu();
  s.toggle.checked = false;
  s.toggle.fire('change');
  assert.equal(getSettings().musicMuted, true);
  s.slider.value = '0';
  s.slider.fire('input');
  assert.equal(getSettings().musicMuted, true, 'zero lifts nothing');
  assert.equal(getSettings().musicVolume, 0);
  s.slider.value = '35';
  s.slider.fire('input');
  assert.equal(getSettings().musicVolume, 0.35);
  assert.equal(getSettings().musicMuted, false);
  assert.equal(s.toggle.checked, true, 'the switch follows');
  assert.equal(s.text.textContent, '35%');
  assert.equal(getSettings().volume, 0.7, 'the sound effects are untouched');
  s.toggle.checked = false;
  s.toggle.fire('change');
  s.toggle.checked = true;
  s.toggle.fire('change');
  assert.equal(getSettings().musicMuted, false);
});
