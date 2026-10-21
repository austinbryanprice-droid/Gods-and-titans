// Terrain height lookups shared by the renderer, unit placement and props.
// mapData.heights is a (width + 1) × (height + 1) vertex grid; vertex (vx, vy)
// sits at world (vx, vy), so tile (tx, ty) spans vertices tx..tx+1, ty..ty+1.
// The ground the player sees is a smooth surface through those heights
// (ground-field.js): shorelines are rounded off and rock tiles rise into
// outcrops, so heightAt answers with the rendered ground, not with the raw grid.
import { groundField } from './ground-field.js';

/**
 * Terrain height at world point (x, y) (sim coordinates, tiles): the smooth ground
 * surface, which passes through the sim's vertex heights away from shores and
 * rock. Points outside the map are clamped to the border; a map without heights
 * is flat at 0.
 * @param {{width:number, height:number, heights:Float32Array}} mapData
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function heightAt(mapData, x, y) {
  const f = groundField(mapData);
  return f ? f.heightAt(x, y) : 0;
}

/**
 * Ground level for a size×size footprint whose top-left tile is (tx, ty): the
 * highest terrain vertex under it. Building models put their origin here; their
 * stone foundation reaches ~0.6 below it, which hides the slope on the low side.
 * @param {{width:number, height:number, heights:Float32Array}} mapData
 * @param {number} tx
 * @param {number} ty
 * @param {number} size
 * @returns {number}
 */
export function footprintHeight(mapData, tx, ty, size) {
  const hs = mapData && mapData.heights;
  if (!hs) return 0;
  const w = mapData.width;
  const h = mapData.height ?? mapData.width;
  const W = w + 1;
  const x0 = Math.max(0, Math.min(w, Math.floor(tx)));
  const y0 = Math.max(0, Math.min(h, Math.floor(ty)));
  const x1 = Math.max(0, Math.min(w, Math.floor(tx) + size));
  const y1 = Math.max(0, Math.min(h, Math.floor(ty) + size));
  let best = -Infinity;
  for (let vy = y0; vy <= y1; vy++) {
    for (let vx = x0; vx <= x1; vx++) {
      const v = hs[vy * W + vx];
      if (v > best) best = v;
    }
  }
  return best === -Infinity ? 0 : best;
}
