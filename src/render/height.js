// Terrain height lookups shared by the renderer, unit placement and props.
// mapData.heights is a (width + 1) × (height + 1) vertex grid; vertex (vx, vy)
// sits at world (vx, vy), so tile (tx, ty) spans vertices tx..tx+1, ty..ty+1.

/**
 * Bilinear terrain height at world point (x, y) (sim coordinates, tiles).
 * Points outside the map are clamped to the border.
 * @param {{width:number, height:number, heights:Float32Array}} mapData
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function heightAt(mapData, x, y) {
  const hs = mapData && mapData.heights;
  if (!hs) return 0;
  const w = mapData.width;
  const h = mapData.height ?? mapData.width;
  const W = w + 1;
  const cx = x > 0 ? (x < w ? x : w) : 0;
  const cy = y > 0 ? (y < h ? y : h) : 0;
  let x0 = Math.floor(cx);
  let y0 = Math.floor(cy);
  if (x0 > w - 1) x0 = w - 1;
  if (y0 > h - 1) y0 = h - 1;
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * W + x0;
  const h00 = hs[i];
  const h10 = hs[i + 1];
  const h01 = hs[i + W];
  const h11 = hs[i + W + 1];
  const top = h00 + (h10 - h00) * fx;
  const bot = h01 + (h11 - h01) * fx;
  return top + (bot - top) * fy;
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
