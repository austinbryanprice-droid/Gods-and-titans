// RTS camera (DESIGN 8): a perspective camera south of its ground target,
// looking north and down, Warcraft III style. Smooth wheel-step zoom between a
// close and a far limit (pitch steepens as it zooms out: gently up to the
// original far limit, then on toward a map-table view that holds a whole medium
// map), clip planes that follow the zoom, pan speed that scales with zoom,
// smooth damping, the target clamped to the map, and an optional shake offset.
// Pure math on a THREE.PerspectiveCamera (runs in Node).
import * as THREE from 'three';

const DEG = Math.PI / 180;

export const CAMERA_DEFAULTS = Object.freeze({
  fov: 40, // vertical field of view, degrees
  minDistance: 10, // distance from the camera to its ground target (close zoom)
  maxDistance: 170, // far zoom: a whole medium (128 tile) map fits a 16:9 window above the HUD
  midDistance: 44, // where the original zoom range ended: the pitch curve keeps its shape up to here
  defaultDistance: 25,
  pitchNear: 50, // degrees below the horizon at the closest zoom
  pitchMid: 58, // … at midDistance
  pitchFar: 66, // … and at maxDistance (it must stay under 70: the view's bottom edge would pass the vertical)
  zoomStep: 1.16, // distance factor per wheel step
  panDamping: 16, // 1/s, how fast the view follows pan / centerOn goals
  zoomDamping: 10, // 1/s
  edgeMargin: 3, // the target stays this far inside the map edge (tiles)
});

// Clip planes: the near plane stays at 0.5 up to the default zoom and moves out with the camera's height
// (the nearest ground is then tens of tiles away and the depth buffer keeps its precision for the far
// view); the far plane stays 400 until the farthest ground the view can show would pass it.
const NEAR_MIN = 0.5;
const NEAR_MAX = 6;
const NEAR_PER_TILE = 0.04; // near plane growth a tile of distance beyond the default zoom
const FAR_MIN = 400;
const FAR_PER_TILE = 3.2; // a wide window sees ground up to about 2.2 times the distance

// The free camera's tilt keeps the pitch between these (degrees below the horizon): low enough to look
// across the battlefield, never so steep that the view's bottom edge passes the vertical.
const MIN_PITCH = 22;
const MAX_PITCH = 68;

const _ndc = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _org = new THREE.Vector3();

/** Camera controller. `target` is the ground point (sim coords) the view centers on. */
export class CameraController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} o
   * @param {number} o.mapWidth map size in tiles
   * @param {number} o.mapHeight
   * @param {(x:number, y:number)=>number} [o.heightFn] terrain height (keeps the look-at on the ground)
   * @param {object} [o.options] overrides of CAMERA_DEFAULTS
   */
  constructor(camera, { mapWidth, mapHeight, heightFn = null, options = {} }) {
    this.camera = camera;
    this.opts = { ...CAMERA_DEFAULTS, ...options };
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.heightFn = heightFn;
    camera.fov = this.opts.fov;
    camera.near = NEAR_MIN;
    camera.far = FAR_MIN;
    camera.updateProjectionMatrix();
    /** Current (smoothed) look-at ground point, sim coords. */
    this.target = { x: mapWidth / 2, y: mapHeight / 2 };
    /** Where the view is heading. */
    this.goal = { x: this.target.x, y: this.target.y };
    this.distance = this.opts.defaultDistance;
    this.goalDistance = this.distance;
    this.groundY = heightFn ? heightFn(this.target.x, this.target.y) : 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.viewportWidth = 1;
    this.viewportHeight = 1;
    /** The framing set by setFree (the intro film), or null while the player's controls frame the view. */
    this.free = null;
    /** The free camera of a replay (DESIGN 9.4): turned round the target (radians, 0 = looking north) and tilted (degrees on the pitch). */
    this.yaw = 0;
    this.tilt = 0;
    this.apply();
  }

  // ------------------------------------------------------------------ controls

  /** 0 at the closest zoom, 1 at the farthest. */
  get zoom() {
    const { minDistance: a, maxDistance: b } = this.opts;
    return (this.distance - a) / (b - a);
  }

  /**
   * Current pitch in radians (below the horizon): linear in the distance from pitchNear to pitchMid up to
   * midDistance, then it keeps rising at the rate it ended with and settles toward pitchFar at maxDistance
   * (x m / (1 + x m / a), a rational curve with the same slope at midDistance and pitchFar - pitchMid at the end).
   * While the camera is free (setFree, the intro film) it is the pose's own pitch.
   */
  get pitch() {
    if (this.free) return this.free.pitch * DEG;
    const base = this.basePitch();
    return this.tilt ? Math.max(MIN_PITCH, Math.min(MAX_PITCH, base / DEG + this.tilt)) * DEG : base;
  }

  /** The zoom's own pitch (radians), before a replay's tilt. */
  basePitch() {
    const { pitchNear, pitchMid, pitchFar, minDistance, midDistance, maxDistance } = this.opts;
    const d = this.distance;
    if (d <= midDistance) {
      const t = Math.max(0, (d - minDistance) / (midDistance - minDistance));
      return (pitchNear + (pitchMid - pitchNear) * t) * DEG;
    }
    const span = maxDistance - midDistance;
    const rise = pitchFar - pitchMid;
    if (!(span > 0) || !(rise > 0)) return pitchMid * DEG;
    const x = Math.min(d - midDistance, span);
    const m = (pitchMid - pitchNear) / (midDistance - minDistance); // degrees a tile where the near range ended
    const ml = m * span;
    if (!(ml > rise * 1.001)) return (pitchMid + (rise * x) / span) * DEG; // the near slope is too gentle to ease out of
    const a = (rise * ml) / (ml - rise);
    return (pitchMid + (m * x) / (1 + (m * x) / a)) * DEG;
  }

  /** Pan speed factor: 1 at the default zoom, more when zoomed out. */
  get zoomScale() {
    return this.goalDistance / this.opts.defaultDistance;
  }

  /** Move the view by exactly (dx, dy) tiles (eased): screen right and down, which turn with the yaw. */
  pan(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const [wx, wy] = this.toGround(dx, dy);
    this.setGoal(this.goal.x + wx, this.goal.y + wy);
  }

  /** A step screen-right dx and screen-down dy as a step on the map, for the camera's yaw. */
  toGround(dx, dy) {
    if (!this.yaw) return [dx, dy];
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return [dx * c + dy * s, dy * c - dx * s];
  }

  /** Turn the view round its target (a replay's free camera), by degrees. */
  rotate(deg) {
    if (!Number.isFinite(deg)) return;
    let y = this.yaw + deg * DEG;
    y = Math.atan2(Math.sin(y), Math.cos(y));
    this.yaw = Math.abs(y) < 1e-9 ? 0 : y;
  }

  /** Tilt the view up or down from the zoom's own pitch (a replay's free camera), by degrees. */
  tiltBy(deg) {
    if (!Number.isFinite(deg)) return;
    const base = this.basePitch() / DEG;
    this.tilt = Math.max(MIN_PITCH - base, Math.min(MAX_PITCH - base, this.tilt + deg));
  }

  /** Back to the player's view: looking north at the zoom's own pitch. */
  resetAngle() {
    this.yaw = 0;
    this.tilt = 0;
  }

  /**
   * Scroll (edge scroll, arrow keys): (dx, dy) tiles at the default zoom, scaled
   * by the current zoom so a scroll covers the same share of the screen at
   * every zoom level.
   */
  scroll(dx, dy) {
    const k = this.zoomScale;
    this.pan(dx * k, dy * k);
  }

  /**
   * Drag the ground with the mouse (middle-drag): the world follows the cursor
   * by (dxPx, dyPx) CSS pixels. Applied immediately (no damping lag).
   */
  panPixels(dxPx, dyPx) {
    const h = Math.max(1, this.viewportHeight);
    const worldPerPx = (2 * this.distance * Math.tan((this.opts.fov * DEG) / 2)) / h;
    const [wx, wy] = this.toGround(-dxPx * worldPerPx, -(dyPx * worldPerPx) / Math.sin(this.pitch));
    this.setGoal(this.goal.x + wx, this.goal.y + wy);
    this.target.x = this.goal.x;
    this.target.y = this.goal.y;
  }

  /** Zoom by mouse-wheel steps: positive = closer, negative = farther. */
  zoomBy(steps) {
    if (!Number.isFinite(steps) || steps === 0) return;
    const { minDistance, maxDistance, zoomStep } = this.opts;
    this.goalDistance = Math.max(minDistance, Math.min(maxDistance, this.goalDistance / zoomStep ** steps));
  }

  /** Set the zoom distance directly (clamped); `instant` skips the easing. */
  setDistance(d, instant = false) {
    const { minDistance, maxDistance } = this.opts;
    this.goalDistance = Math.max(minDistance, Math.min(maxDistance, d));
    if (instant) this.distance = this.goalDistance;
  }

  /** Center the view on a sim point (instantly unless smooth). */
  centerOn(x, y, smooth = false) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.setGoal(x, y);
    if (!smooth) {
      this.target.x = this.goal.x;
      this.target.y = this.goal.y;
      if (this.heightFn) this.groundY = this.heightFn(this.target.x, this.target.y);
      this.apply();
    }
  }

  setGoal(x, y) {
    const m = this.opts.edgeMargin;
    this.goal.x = Math.max(m, Math.min(this.mapWidth - m, x));
    this.goal.y = Math.max(m, Math.min(this.mapHeight - m, y));
  }

  setViewport(w, h) {
    this.viewportWidth = Math.max(1, w);
    this.viewportHeight = Math.max(1, h);
    this.camera.aspect = this.viewportWidth / this.viewportHeight;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Frame the view directly instead of by the player's controls (the intro film): the camera orbits
   * the ground point (x, y), `lift` above it, at `dist` from it, `yaw` degrees round from due south
   * (the RTS view is yaw 0) and `pitch` degrees below the horizon, through a lens of `fov` degrees.
   * The pose is read on every update, so the caller moves it by changing its fields; it ignores the
   * zoom limits, the map edge and the easing. null hands the camera back to the player.
   * @param {{ x: number, y: number, dist: number, pitch: number, yaw?: number, lift?: number, fov?: number } | null} pose
   */
  setFree(pose) {
    this.free = pose || null;
    if (!pose && this.camera.fov !== this.opts.fov) {
      this.camera.fov = this.opts.fov;
      this.camera.updateProjectionMatrix();
    }
    this.update(0);
  }

  /** Shake offset in world units (applied to the camera, not the target). */
  setShake(x, y) {
    this.shakeX = x;
    this.shakeY = y;
  }

  /** Ease toward the goal and update the camera matrices. */
  update(dt) {
    if (this.free) {
      this.followFree();
      return;
    }
    const d = Math.max(0, Math.min(0.25, dt || 0));
    const kp = 1 - Math.exp(-this.opts.panDamping * d);
    const kz = 1 - Math.exp(-this.opts.zoomDamping * d);
    this.target.x += (this.goal.x - this.target.x) * kp;
    this.target.y += (this.goal.y - this.target.y) * kp;
    if (Math.abs(this.goal.x - this.target.x) < 1e-4) this.target.x = this.goal.x;
    if (Math.abs(this.goal.y - this.target.y) < 1e-4) this.target.y = this.goal.y;
    this.distance += (this.goalDistance - this.distance) * kz;
    if (Math.abs(this.goalDistance - this.distance) < 1e-4) this.distance = this.goalDistance;
    if (this.heightFn) {
      const g = Math.max(-0.2, this.heightFn(this.target.x, this.target.y));
      this.groundY += (g - this.groundY) * (1 - Math.exp(-3 * d));
    }
    this.apply();
  }

  /** Near and far clip planes for the current distance (the projection is rebuilt only when they change). */
  updateClipPlanes() {
    const cam = this.camera;
    const near = Math.min(NEAR_MAX, NEAR_MIN + Math.max(0, this.distance - this.opts.defaultDistance) * NEAR_PER_TILE);
    const far = Math.max(FAR_MIN, this.distance * FAR_PER_TILE);
    if (Math.abs(cam.near - near) < 1e-3 && Math.abs(cam.far - far) < 1e-3) return;
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();
  }

  /** The free pose becomes the camera's state at once, so everything that reads target, distance and groundY sees the film's view. */
  followFree() {
    const f = this.free;
    this.target.x = this.goal.x = f.x;
    this.target.y = this.goal.y = f.y;
    this.distance = this.goalDistance = f.dist;
    this.groundY = this.heightFn ? Math.max(-0.2, this.heightFn(f.x, f.y)) : 0;
    const fov = f.fov || this.opts.fov;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.apply();
  }

  apply() {
    const cam = this.camera;
    this.updateClipPlanes();
    const p = this.pitch;
    const yaw = this.free ? (this.free.yaw || 0) * DEG : this.yaw;
    const tx = this.target.x + this.shakeX;
    const tz = this.target.y + this.shakeY;
    const ty = this.groundY + (this.free ? this.free.lift || 0 : 0);
    const flat = this.distance * Math.cos(p);
    cam.position.set(tx + flat * Math.sin(yaw), ty + this.distance * Math.sin(p), tz + flat * Math.cos(yaw));
    cam.lookAt(tx, ty, tz);
    cam.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ queries

  /**
   * Ray through normalized device coords (nx, ny ∈ [-1, 1]) into out.origin/out.dir.
   * @returns {{origin: THREE.Vector3, dir: THREE.Vector3}}
   */
  rayFromNdc(nx, ny, out = { origin: new THREE.Vector3(), dir: new THREE.Vector3() }) {
    const cam = this.camera;
    out.origin.copy(cam.position);
    _ndc.set(nx, ny, 0.5).unproject(cam);
    out.dir.copy(_ndc).sub(cam.position).normalize();
    return out;
  }

  /**
   * The four ground corners of the view (screen top-left, top-right,
   * bottom-right, bottom-left) intersected with the ground plane at the target's
   * height, in sim coords. For the minimap's camera frame.
   * @param {{x:number,y:number}[]} [out]
   */
  getViewQuad(out = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]) {
    const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    const cam = this.camera;
    const gy = this.groundY;
    for (let i = 0; i < 4; i++) {
      _org.copy(cam.position);
      _ndc.set(corners[i][0], corners[i][1], 0.5).unproject(cam);
      _dir.copy(_ndc).sub(_org).normalize();
      // a corner ray that would (almost) miss the ground is clamped to ~6° below the horizon
      let dy = _dir.y;
      if (dy > -0.1) {
        const horiz = Math.hypot(_dir.x, _dir.z) || 1;
        _dir.x = (_dir.x / horiz) * 0.995;
        _dir.z = (_dir.z / horiz) * 0.995;
        _dir.y = dy = -0.1;
      }
      const t = (gy - _org.y) / dy;
      out[i].x = _org.x + _dir.x * t;
      out[i].y = _org.z + _dir.z * t;
    }
    return out;
  }
}
