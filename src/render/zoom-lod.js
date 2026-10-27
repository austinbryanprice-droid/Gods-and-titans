// What changes with the camera's zoom distance (DESIGN 8, "Far zoom"). Pure functions of the distance
// the camera controller reports, so the renderer, the HUD and the tests share one set of curves and the
// numbers can be tuned in one place. Up to NEAR_RANGE (the original far limit of 44 tiles) every curve
// gives the look the game always had; beyond it the view takes in more and more of the map.
//
// The detail levels (terrainStride, forestFar, unitFar) go by what the eye can tell apart, pixels on the
// screen (CSS pixels), not by the distance alone: a bigger window keeps the detail longer. Each has
// a way down and a way back up at a different value (hysteresis), so a camera resting on the edge does not
// flicker between two looks.
import { CAMERA_DEFAULTS } from './camera.js';

/** The camera distance where the original zoom range ended. */
export const NEAR_RANGE = CAMERA_DEFAULTS.midDistance;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 0 below `a`, 1 above `b`, smooth between. */
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * How much the haze distances (offsets from the point the camera looks at, atmosphere.js) stretch: 1 up to
 * NEAR_RANGE, then with the zoom to the power 0.7, so the far edge of a wide view keeps about the haze the
 * old far view had at its edge instead of fading into it.
 */
export function hazeStretch(distance) {
  return distance <= NEAR_RANGE ? 1 : (distance / NEAR_RANGE) ** 0.7;
}

/** The share of the sun's shadow still drawn: all of it up to 48, none from 88 (smooth in between). */
export function shadowShare(distance) {
  return 1 - smoothstep(48, 88, distance);
}

/** The share of ambient occlusion (high and ultra) still drawn: all of it up to 60, none from 110. */
export function aoShare(distance) {
  return 1 - smoothstep(60, 110, distance);
}

/**
 * Size factor for the overlays that are read on the screen (health bars, selection rings, status icons,
 * floating text). A bit bigger when zoomed out, as always (the distance to the default zoom to the power 0.55,
 * 0.78 .. 1.45); past the point where that stops (about 49 tiles) it keeps growing, slower than the view
 * shrinks, so a bar or a ring stays a few pixels thick when a unit is only a few pixels tall.
 */
export function overlayScale(distance, defaultDistance = CAMERA_DEFAULTS.defaultDistance) {
  const k = (distance / defaultDistance) ** 0.55;
  if (k <= 1.45) return Math.max(0.78, k);
  return 1.45 * (k / 1.45) ** (0.8 / 0.55);
}

/**
 * The same for what is drawn over a crowd (the width of a unit's health bar, its rank pips): the same up to the
 * point where the old curve stopped growing, then it follows the zoom more slowly (to the power 0.5 where
 * overlayScale takes 0.8), so the bars and pips of an army of a hundred units a few pixels tall each do not
 * cover it. A bar keeps its thickness (overlayScale); only its width and the pips shrink on the screen.
 */
export function crowdScale(distance, defaultDistance = CAMERA_DEFAULTS.defaultDistance) {
  const k = (distance / defaultDistance) ** 0.55;
  if (k <= 1.45) return Math.max(0.78, k);
  return 1.45 * (k / 1.45) ** (0.5 / 0.55);
}

/**
 * Selection and hover rings are drawn in tiles, so past the old limit their line would thin to under a pixel.
 * The line grows with the distance (the width on the screen stays what it was at NEAR_RANGE, about two
 * pixels) and the radius with its square root (a ring stays a ring around a unit that is a few pixels tall,
 * without the rings of an army running into one another). Both are 1 up to NEAR_RANGE.
 */
export function ringLineScale(distance) {
  return distance <= NEAR_RANGE ? 1 : distance / NEAR_RANGE;
}

export function ringRadiusScale(distance) {
  return distance <= NEAR_RANGE ? 1 : Math.sqrt(distance / NEAR_RANGE);
}

/** Pixels one tile spans on the screen at the point the camera looks at (a window `viewH` pixels high). */
export function pixelsPerTile(distance, viewH, fov = CAMERA_DEFAULTS.fov) {
  if (!(distance > 0) || !(viewH > 0)) return Infinity;
  return viewH / (2 * distance * Math.tan((fov * Math.PI) / 360));
}

/**
 * Ground mesh detail, as the step through the field's samples (FIELD_RES = 4 per tile): 1 every sample,
 * 2 every other one (a vertex every half tile), 4 one per tile. Coarser from 16 and from 7 pixels per tile
 * (the vertices are then 8 and 7 pixels apart at most); finer again above 19 and 8.5. It is one step for
 * the whole map, so neighbouring chunks always meet edge to edge.
 * @param {number} ppt pixelsPerTile
 * @param {number} [prev] the step now in use
 */
export function terrainStride(ppt, prev = 1) {
  let s = prev;
  if (s === 1 && ppt < 16) s = 2;
  if (s === 2 && ppt < 7) s = 4;
  if (s === 4 && ppt > 8.5) s = 2;
  if (s === 2 && ppt > 19) s = 1;
  return s;
}

/**
 * Whether the forest is drawn as plain crowns (a few dozen triangles a tree, no leaf quads) instead of the
 * full trees: from 11 pixels per tile, where a tree is under 20 pixels tall and its leaves are less than
 * two pixels across; back to the full trees above 13.
 */
export function forestFar(ppt, prev = false) {
  return prev ? ppt < 13 : ppt < 11;
}

/**
 * Whether a unit is drawn as a far marker (one shared instanced mesh in its team color) instead of its model:
 * under 11 pixels tall on the screen (a head, a body and a weapon are then a handful of pixels); back to the
 * model from 14. Only once the view is wider than the original zoom range (under 20 pixels a tile, a little
 * past 50 tiles up in a 720 pixel window; back to the models from 22): a tiny creature close up, and every
 * unit in the range the game always had, are drawn as themselves.
 * @param {number} heightPx the unit's height on the screen, foot to head
 * @param {number} ppt pixelsPerTile
 * @param {boolean} [prev]
 */
export function unitFar(heightPx, ppt, prev = false) {
  if (!(ppt < (prev ? 22 : 20))) return false;
  return prev ? heightPx < 14 : heightPx < 11;
}
