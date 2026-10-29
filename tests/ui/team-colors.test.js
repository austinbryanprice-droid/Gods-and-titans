// The colour-blind-safe team palette (src/team-colors.js): each lobby colour has a stand-in, the
// stand-ins stay apart under simulated colour blindness, and changing the palette is heard.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_COLORS } from '../../src/config.js';
import { SAFE_PLAYER_COLORS, displayColor, relationColor, markerColors, setTeamPalette, teamPalette, onTeamPaletteChange } from '../../src/team-colors.js';

afterEach(() => setTeamPalette('standard'));

// Machado, Oliveira & Fernandes (2009), severity 1, applied in linear RGB; distance in CIELAB.
const SIM = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function lab(hex, m) {
  const c = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const [r, g, b] = SIM[m].map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])));
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
function worstPair(colors) {
  let worst = Infinity;
  for (const m of Object.keys(SIM)) {
    const L = colors.map((c) => lab(c, m));
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) worst = Math.min(worst, Math.hypot(L[i][0] - L[j][0], L[i][1] - L[j][1], L[i][2] - L[j][2]));
  }
  return worst;
}

test('one stand-in per lobby colour, all different', () => {
  assert.equal(SAFE_PLAYER_COLORS.length, PLAYER_COLORS.length);
  assert.equal(new Set(SAFE_PLAYER_COLORS).size, SAFE_PLAYER_COLORS.length);
});

test('the safe set stays apart under protanopia, deuteranopia and tritanopia; the lobby set does not', () => {
  assert.ok(worstPair(SAFE_PLAYER_COLORS) > 18, `safe worst pair ${worstPair(SAFE_PLAYER_COLORS).toFixed(1)}`);
  assert.ok(worstPair(PLAYER_COLORS) < 5); // blue and purple under deuteranopia
  const rel = ['own', 'ally', 'enemy', 'neutral'];
  assert.ok(worstPair(rel.map((r) => relationColor(r, 'colorblind'))) > 18);
  assert.ok(worstPair(rel.map((r) => relationColor(r, 'standard'))) < 5); // green and lime
  const mk = markerColors('colorblind');
  assert.ok(worstPair([mk.move, mk.attack, mk.gather]) > 18);
});

test('displayColor swaps lobby colours only under the colour-blind palette', () => {
  assert.equal(displayColor(PLAYER_COLORS[0]), PLAYER_COLORS[0]);
  setTeamPalette('colorblind');
  PLAYER_COLORS.forEach((c, i) => assert.equal(displayColor(c), SAFE_PLAYER_COLORS[i]));
  assert.equal(displayColor(PLAYER_COLORS[1].toUpperCase()), SAFE_PLAYER_COLORS[1]);
  assert.equal(displayColor('#123456'), '#123456'); // not a lobby colour: as it is
  assert.equal(displayColor(undefined), undefined);
  assert.equal(relationColor('own'), '#3aa8ff');
  assert.equal(relationColor('nonsense'), relationColor('neutral'));
});

test('a palette change is heard once; an unknown id is the standard palette', () => {
  const heard = [];
  const off = onTeamPaletteChange((p) => heard.push(p));
  assert.equal(setTeamPalette('colorblind'), true);
  assert.equal(setTeamPalette('colorblind'), false);
  setTeamPalette('pastel');
  assert.equal(teamPalette(), 'standard');
  off();
  setTeamPalette('colorblind');
  assert.deepEqual(heard, ['colorblind', 'standard']);
});
