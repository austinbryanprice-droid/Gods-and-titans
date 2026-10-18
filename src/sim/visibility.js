// Fog of war: which tiles a team can currently see. Pure function, used by the
// client-side ViewState (and by the AI if it wants fair information).

/**
 * Stamp sight circles into a visibility grid.
 * @param {number} width
 * @param {number} height
 * @param {{x:number, y:number, r:number}[]} sources sight sources in tile coords
 * @param {Uint8Array} [explored] optional; tiles seen now are set to 1 (mutated)
 * @param {Uint8Array} [out] optional reusable output buffer (cleared first)
 * @returns {Uint8Array} visible, 1 where currently visible
 */
export function computeVisibility(width, height, sources, explored, out) {
  const visible = out && out.length === width * height ? out : new Uint8Array(width * height);
  visible.fill(0);
  for (const s of sources) {
    const r = s.r;
    if (!(r > 0)) continue;
    const r2 = r * r;
    const y0 = Math.max(0, Math.floor(s.y - r));
    const y1 = Math.min(height - 1, Math.floor(s.y + r));
    for (let ty = y0; ty <= y1; ty++) {
      const dy = ty + 0.5 - s.y;
      if (dy * dy > r2) continue; // row centre outside the circle: no lone tile beyond the rim
      const span = Math.sqrt(r2 - dy * dy);
      const x0 = Math.max(0, Math.floor(s.x - span));
      const x1 = Math.min(width - 1, Math.floor(s.x + span));
      const row = ty * width;
      for (let tx = x0; tx <= x1; tx++) {
        visible[row + tx] = 1;
      }
    }
  }
  if (explored) {
    for (let i = 0; i < visible.length; i++) if (visible[i]) explored[i] = 1;
  }
  return visible;
}
