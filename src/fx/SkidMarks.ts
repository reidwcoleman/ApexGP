import * as THREE from 'three';
import { SURF, type Track, type TrackFrame } from '../world/Track.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';
import { roadUniforms } from '../world/trackside/materials.ts';

/**
 * Tyre marks laid during a race and kept until the next one:
 *   - black rubber on tarmac/kerbs from lock-ups, wheelspin (launches off the grid),
 *     big slides, and a faint film from every hard stop (ABS-limited braking), which
 *     builds up lap after lap into the dark braking-zone streaks real circuits get
 *   - flattened, muddy tracks through the grass and furrows through the gravel
 *   - dirt dragged back onto the tarmac for a few dozen metres after an off
 *
 * Everything is ONE mesh / ONE draw call: a pool of independent quads (4 verts each)
 * split into two ring buffers — "heavy" marks (launches, lock-ups, slides, offs) and
 * "light" braking film — so the thousands of faint braking passes never overwrite the
 * iconic marks. The oldest segments of a full ring fade out before being reused.
 *
 * Quads are laid on the ground mesh (Track frame + the trackside's kerb/gravel/grass
 * heights), lifted 1 cm and polygon-offset. They are unlit and blended as a tint
 * over what is already drawn (dst × mix(1, tint, a)), so they darken lit and shadowed
 * road alike, show through the wet road's reflections, and a tint > 1 lightens (dust).
 */

/** height of the rendered ground above the road plane at (s, lateral); NaN = no marks there */
export type GroundLift = (s: number, lateral: number) => number;

const HEAVY = 20480;
const LIGHT = 12288;
const SEGS = HEAVY + LIGHT;
const LIFT = 0.012;

const K_RUBBER = 0;
const K_GRASS = 1;
const K_GRAVEL = 2;
const K_DUST = 3;

interface WheelTrail {
  active: boolean;
  light: boolean;
  kind: number;
  seed: number;
  /** last laid point: world centre, ground up, edges, tyre width, intensity, along-distance */
  cx: number; cy: number; cz: number;
  ux: number; uy: number; uz: number;
  tw: number;
  /** this strip's last quad (patched when the next one bends away), −1 = none */
  lastQ: number;
  lx: number; ly: number; lz: number;
  rx: number; ry: number; rz: number;
  dx: number; dz: number;
  inten: number;
  along: number;
  /** raw wheel position last frame (teleport detection) */
  px: number; pz: number;
  /** dirt carried on the tyre after an off (0..1) */
  dirt: number;
  hint: number;
  /** car position last frame (wheel 0's trail only: the field's distance for rubber build-up) */
  cx0: number; cz0: number;
}

const newTrail = (): WheelTrail => ({
  active: false, light: false, kind: 0, seed: 0,
  cx: 0, cy: 0, cz: 0, ux: 0, uy: 1, uz: 0, tw: 0.3, lastQ: -1, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, dx: 0, dz: 1,
  inten: 0, along: 0, px: 0, pz: 0, dirt: 0, hint: -1, cx0: 1e9, cz0: 1e9,
});

const VERT = /* glsl */ `
attribute vec4 aSkid;
uniform vec4 uRing;   // heavy head, heavy full (0/1), light head, light full
varying vec4 vS;
varying float vFade;
varying float vDepth;
void main() {
  vS = aSkid;
  float seg = floor(float(gl_VertexID) / 4.0 + 0.01);
  float fade = 1.0;
  if (seg < ${HEAVY}.0) {
    float age = mod(uRing.x - 1.0 - seg + ${HEAVY}.0, ${HEAVY}.0) / ${HEAVY}.0;
    fade = mix(1.0, 1.0 - smoothstep(0.8, 1.0, age), uRing.y);
  } else {
    float age = mod(uRing.z - 1.0 - (seg - ${HEAVY}.0) + ${LIGHT}.0, ${LIGHT}.0) / ${LIGHT}.0;
    fade = mix(1.0, 1.0 - smoothstep(0.6, 1.0, age), uRing.w);
  }
  vFade = fade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec4 vS;
varying float vFade;
varying float vDepth;
float skH(float n) { return fract(sin(n) * 43758.5453); }
float skN(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(skH(i), skH(i + 1.0), f); }
void main() {
  float x = vS.x;
  float kind = floor(vS.w + 0.001);
  float seed = fract(vS.w) * 97.0;
  float fw = max(fwidth(x), 1e-4);
  // soft edges, widened when the strip gets thin on screen; thinner than ~2 px fades instead of shimmering
  float edge = 1.0 - smoothstep(1.0 - min(0.9, 0.25 + fw * 1.5), 1.0, abs(x));
  float cover = min(1.0, 1.0 / (fw * 1.2));
  // striations along the mark (grooves the stones cut in the rubber), waviness along it
  float st = skN(x * 7.0 + seed) * 0.6 + skN(x * 19.0 + seed * 3.1) * 0.4;
  float wav = skN(vS.y * 0.45 + seed * 1.7);
  float a = vS.z * vFade * edge * cover;
  vec3 tint;
  if (kind < 0.5) {
    // rubber: darker at the edges of a locked tyre (rubber rolls outward), streaky, patchy along
    a *= (0.72 + 0.28 * st) * (0.78 + 0.22 * wav) * (0.85 + 0.15 * smoothstep(0.4, 0.9, abs(x)));
    tint = vec3(0.13, 0.13, 0.14);
  } else if (kind < 1.5) {
    // grass: flattened blades and torn turf, muddy where it dug in
    a *= (0.75 + 0.25 * st) * (0.8 + 0.2 * wav);
    tint = mix(vec3(0.5, 0.44, 0.24), vec3(0.3, 0.22, 0.13), smoothstep(0.45, 0.85, st * wav + 0.35 * vS.z));
  } else if (kind < 2.5) {
    // gravel: a furrow, darker disturbed (damp, shaded) stones with ridges thrown up at its sides
    float ridge = smoothstep(0.6, 0.95, abs(x));
    a *= 0.8 + 0.2 * st;
    tint = mix(vec3(0.42, 0.39, 0.35), vec3(1.3, 1.24, 1.15), ridge);
  } else {
    // dust dragged back onto the tarmac: lightens it
    a *= (0.6 + 0.4 * st) * (0.65 + 0.35 * wav);
    tint = vec3(3.0, 2.6, 2.0);
  }
  a *= 1.0 - smoothstep(320.0, 700.0, vDepth);
  if (a < 0.003) discard;
  gl_FragColor = vec4(tint * a, a);
}
`;

const _frame = {
  s: 0, pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(),
  heading: 0, kappa: 0, halfWidth: 0,
} as TrackFrame;

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly attr: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly skidAttr: THREE.BufferAttribute;
  private readonly ring = new THREE.Vector4(0, 0, 0, 0);
  private headH = 0;
  private headL = 0;
  /** segments touched this frame: [dLo, dHi) */
  private dLo = SEGS;
  private dHi = 0;
  private readonly trails = new Map<number, WheelTrail[]>();
  private seedN = 0;
  /** total segments laid (stats) */
  laid = 0;
  enabled = true;
  /** metres driven by the whole field this session (drives the road's rubber build-up) */
  private driven = 0;

  constructor(private readonly track: Track, private readonly lift: GroundLift = () => 0) {
    const nv = SEGS * 4;
    this.pos = new Float32Array(nv * 3);
    this.attr = new Float32Array(nv * 4);
    const idx = new Uint32Array(SEGS * 6);
    for (let q = 0; q < SEGS; q++) {
      const v = q * 4;
      const o = q * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.skidAttr = new THREE.BufferAttribute(this.attr, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSkid', this.skidAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // the marks span the whole circuit: never culled (one draw, ~130k tiny verts)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uRing: { value: this.ring } },
      depthWrite: false,
      depthTest: true,
      transparent: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'skidmarks';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    // after the road (1) and its painted markings (2): rubber goes over the paint
    this.mesh.renderOrder = 2.5;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
  }

  /** forget every mark (new race / new track) */
  clear() {
    this.pos.fill(0);
    this.attr.fill(0);
    this.headH = this.headL = 0;
    this.ring.set(0, 0, 0, 0);
    this.trails.clear();
    this.dLo = SEGS;
    this.dHi = 0;
    this.posAttr.clearUpdateRanges();
    this.skidAttr.clearUpdateRanges();
    this.posAttr.needsUpdate = true;
    this.skidAttr.needsUpdate = true;
    this.laid = 0;
    this.driven = 0;
    roadUniforms.uRaceRubber.value = 0;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  /** end every strip without laying anything (after a flashback / teleport) */
  breakAll() {
    for (const ws of this.trails.values())
      for (const w of ws) {
        w.active = false;
        w.lastQ = -1;
      }
  }

  /**
   * Lay marks for every car on track. Call once per frame while a session runs
   * (not in replays / flashbacks: marks just stay as they are).
   */
  update(cars: readonly { id: number; removed: boolean; car: CarPhysics }[], wetness: number) {
    if (!this.enabled) return;
    // water: rubber barely transfers onto a wet road (and it's washed away), dirt still does
    const rubberK = 1 - 0.85 * smooth(0.08, 0.5, wetness);
    let n = 0;
    for (const c of cars) {
      if (c.removed) continue;
      n++;
      let ws = this.trails.get(c.id);
      if (!ws) this.trails.set(c.id, (ws = [newTrail(), newTrail(), newTrail(), newTrail()]));
      const w = ws[0];
      const dx = c.car.x - w.cx0, dz = c.car.z - w.cz0;
      const step = Math.hypot(dx, dz);
      if (step < 8) this.driven += step * rubberK;
      w.cx0 = c.car.x;
      w.cz0 = c.car.z;
      this.car(c.car, ws, rubberK);
    }
    // the racing line rubbers in over the first few laps (average laps covered by the field)
    const laps = this.driven / (Math.max(1, n) * this.track.length);
    roadUniforms.uRaceRubber.value = 1 - Math.exp(-laps / 1.6);
    this.flush();
  }

  private car(car: CarPhysics, ws: WheelTrail[], rubberK: number) {
    const sp = car.spec;
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    const [vwx, vwz] = car.worldVelocity();
    const v = Math.hypot(vwx, vwz);
    const t = this.track;
    for (let i = 0; i < 4; i++) {
      const w = ws[i];
      const front = i < 2;
      // body frame: x forward, y left (see CarPhysics.wx/wy)
      const bx = front ? sp.a : -sp.b;
      const by = (i % 2 === 0 ? 1 : -1) * (front ? sp.trackF : sp.trackR) * 0.5;
      const x = car.x + sy * bx + cy * by;
      const z = car.z + cy * bx - sy * by;
      const jump = (x - w.px) * (x - w.px) + (z - w.pz) * (z - w.pz);
      w.px = x;
      w.pz = z;
      if (jump > 64) {
        // teleported (flashback, reset, recovery): never bridge the gap
        w.active = false;
        w.hint = -1;
        w.dirt = 0;
      }
      if (v < 1.2 && !(w.active && v > 0.3)) {
        if (w.active) this.end(w);
        continue;
      }
      const surf = car.surface[i];
      const kp = sp.slipRatioPeak;
      const ap = front ? sp.slipAnglePeak : sp.slipAnglePeakRear;
      const k = car.slipRatio[i] / kp;
      const a = Math.abs(Math.tan(car.slipAngle[i])) / ap;
      const offGrass = surf === SURF.GRASS;
      const offGravel = surf === SURF.GRAVEL;

      let inten = 0;
      let kind = K_RUBBER;
      let light = false;
      if (offGrass || offGravel) {
        kind = offGrass ? K_GRASS : K_GRAVEL;
        inten = Math.min(1, 0.6 + v / 30 + 0.3 * smooth(0.8, 2, Math.max(a, Math.abs(k))));
        w.dirt = 1;
      } else {
        const lock = smooth(1.1, 2.6, -k);
        const spin = smooth(1.1, 3.0, k);
        const slide = smooth(1.2, 2.8, a) * 0.9;
        // launches: TC holds the rears near peak slip, which still lays rubber off the line
        const launch = !front && k > 0.45 && v < 26 ? (0.3 + 0.45 * smooth(0.45, 1, k)) * (1 - smooth(6, 26, v)) : 0;
        inten = Math.max(lock, spin, slide, launch) * rubberK;
        if (inten < 0.06) {
          // a hard stop at the ABS limit: a faint film that builds up lap after lap
          const brake = k < -0.72 && v > 14 ? (0.05 + 0.1 * smooth(0.72, 0.98, -k)) * rubberK : 0;
          if (brake > 0.02) {
            inten = brake;
            light = true;
          }
        }
        // dirt carried back from an off: a dusty trail that thins out over ~30 m
        if (w.dirt > 0.04) {
          const dustI = Math.min(1, w.dirt * 1.1);
          if (dustI > inten) {
            inten = dustI;
            kind = K_DUST;
            light = false;
          }
        }
      }
      if (w.dirt > 0 && !(offGrass || offGravel)) w.dirt *= Math.exp(-Math.sqrt(jump) / 28); // thins out over ~30 m of tarmac

      if (inten < 0.04) {
        if (w.active) this.end(w);
        continue;
      }
      // a change of kind or ring starts a new strip at the same spot
      if (w.active && (w.kind !== kind || w.light !== light)) this.end(w);

      const pr = t.project(x, z, w.hint >= 0 ? w.hint : Math.floor(car.s), 6);
      w.hint = pr.index;
      const h = this.lift(pr.s, pr.lateral);
      if (!(h === h)) {
        if (w.active) this.end(w);
        continue;
      }
      // tyre width; a furrow in the gravel is wider (with ridges thrown up either side)
      const tw = (front ? 0.3 : 0.38) * (kind === K_GRAVEL ? 1.45 : kind === K_GRASS ? 1.15 : 1);
      if (!w.active) {
        this.begin(w, pr.s, pr.lateral, h, kind, light, inten, vwx, vwz, v, tw);
        continue;
      }
      const ddx = x - (w.cx), ddz = z - (w.cz);
      const d = Math.hypot(ddx, ddz);
      const spacing = Math.min(2.6, Math.max(0.35, v * 0.035));
      let emit = d >= spacing;
      if (!emit && d > 0.2) {
        // turning or changing intensity: lay a shorter segment
        const turn = (ddx * w.dz - ddz * w.dx) / d;
        emit = Math.abs(turn) > 0.12 || Math.abs(inten - w.inten) > 0.25;
      }
      if (emit) this.segment(w, pr.s, pr.lateral, h, inten, tw, ddx / d, ddz / d, d);
    }
  }

  private begin(w: WheelTrail, s: number, lat: number, h: number, kind: number, light: boolean, inten: number, vx: number, vz: number, v: number, tw: number) {
    w.active = true;
    w.lastQ = -1;
    w.kind = kind;
    w.light = light;
    w.seed = ((this.seedN++ * 0.618034) % 1) * 0.98;
    w.along = 0;
    // start faint so strips fade in
    w.inten = inten * 0.25;
    const dx = vx / v, dz = vz / v;
    w.dx = dx;
    w.dz = dz;
    this.placePoint(w, s, lat, h, dx, dz, tw);
  }

  private end(w: WheelTrail) {
    // fade the strip out: its last quad's far end drops to zero
    if (w.lastQ >= 0) {
      const o = w.lastQ * 16;
      this.attr[o + 10] = 0;
      this.attr[o + 14] = 0;
      this.markDirty(w.lastQ);
    }
    w.active = false;
    w.lastQ = -1;
  }

  /** world centre + edges of a strip point at (s, lat) for a path direction (dx, dz) */
  private placePoint(w: WheelTrail, s: number, lat: number, h: number, dx: number, dz: number, tw: number) {
    const f = this.track.frame(s, _frame);
    const ux = f.up.x, uy = f.up.y, uz = f.up.z;
    const lift = h + LIFT;
    w.cx = f.pos.x + f.right.x * lat + ux * lift;
    w.cy = f.pos.y + f.right.y * lat + uy * lift;
    w.cz = f.pos.z + f.right.z * lat + uz * lift;
    w.ux = ux; w.uy = uy; w.uz = uz;
    w.tw = tw;
    this.edges(w, w.cx, w.cy, w.cz, ux, uy, uz, dx, dz, tw);
  }

  /** strip edges at a centre: ± half the tyre width along up × dir (in the ground plane) */
  private edges(w: WheelTrail, cx: number, cy: number, cz: number, ux: number, uy: number, uz: number, dx: number, dz: number, tw: number) {
    let px = uy * dz;
    let py = uz * dx - ux * dz;
    let pz = -uy * dx;
    const k = (tw * 0.5) / (Math.hypot(px, py, pz) || 1);
    px *= k; py *= k; pz *= k;
    w.lx = cx + px; w.ly = cy + py; w.lz = cz + pz;
    w.rx = cx - px; w.ry = cy - py; w.rz = cz - pz;
  }

  private segment(w: WheelTrail, s: number, lat: number, h: number, inten: number, tw: number, dx: number, dz: number, d: number) {
    // re-aim the previous point's edges along the joint direction (average of the last and this
    // segment) and patch the previous quad's far end, so strips bend without gaps or overlaps
    let jx = w.dx + dx, jz = w.dz + dz;
    const jl = Math.hypot(jx, jz);
    if (jl > 1e-3) {
      jx /= jl;
      jz /= jl;
      this.edges(w, w.cx, w.cy, w.cz, w.ux, w.uy, w.uz, jx, jz, w.tw);
      if (w.lastQ >= 0) {
        const o = w.lastQ * 12;
        const p = this.pos;
        p[o + 6] = w.rx; p[o + 7] = w.ry; p[o + 8] = w.rz;
        p[o + 9] = w.lx; p[o + 10] = w.ly; p[o + 11] = w.lz;
        this.markDirty(w.lastQ);
      }
    }
    const l0x = w.lx, l0y = w.ly, l0z = w.lz, r0x = w.rx, r0y = w.ry, r0z = w.rz;
    const i0 = w.inten, a0 = w.along;
    this.placePoint(w, s, lat, h, dx, dz, tw);
    w.dx = dx;
    w.dz = dz;
    w.inten = inten;
    w.along = a0 + d;
    const q = this.alloc(w.light);
    w.lastQ = q;
    const kw = w.kind + w.seed;
    const p = this.pos, A = this.attr;
    let o = q * 12;
    p[o] = l0x; p[o + 1] = l0y; p[o + 2] = l0z;
    p[o + 3] = r0x; p[o + 4] = r0y; p[o + 5] = r0z;
    p[o + 6] = w.rx; p[o + 7] = w.ry; p[o + 8] = w.rz;
    p[o + 9] = w.lx; p[o + 10] = w.ly; p[o + 11] = w.lz;
    o = q * 16;
    A[o] = 1; A[o + 1] = a0; A[o + 2] = i0; A[o + 3] = kw;
    A[o + 4] = -1; A[o + 5] = a0; A[o + 6] = i0; A[o + 7] = kw;
    A[o + 8] = -1; A[o + 9] = w.along; A[o + 10] = inten; A[o + 11] = kw;
    A[o + 12] = 1; A[o + 13] = w.along; A[o + 14] = inten; A[o + 15] = kw;
    this.laid++;
  }

  /** next free segment in the heavy or light ring (overwrites the oldest when full) */
  private alloc(light: boolean): number {
    let q: number;
    if (light) {
      q = HEAVY + this.headL;
      this.headL++;
      if (this.headL >= LIGHT) {
        this.headL = 0;
        this.ring.w = 1;
      }
      this.ring.z = this.headL;
    } else {
      q = this.headH;
      this.headH++;
      if (this.headH >= HEAVY) {
        this.headH = 0;
        this.ring.y = 1;
      }
      this.ring.x = this.headH;
    }
    // a strip whose last quad was just recycled must not patch it any more
    for (const ws of this.trails.values()) for (const t of ws) if (t.lastQ === q) t.lastQ = -1;
    this.markDirty(q);
    return q;
  }

  private markDirty(q: number) {
    if (q < this.dLo) this.dLo = q;
    if (q + 1 > this.dHi) this.dHi = q + 1;
  }

  private flush() {
    if (this.dHi <= this.dLo) return;
    // one contiguous upload per frame: new quads are allocated sequentially, patched ones are recent
    const a = this.dLo, b = this.dHi;
    this.posAttr.clearUpdateRanges();
    this.skidAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(a * 12, (b - a) * 12);
    this.skidAttr.addUpdateRange(a * 16, (b - a) * 16);
    this.posAttr.needsUpdate = true;
    this.skidAttr.needsUpdate = true;
    this.dLo = SEGS;
    this.dHi = 0;
    this.mesh.visible = true;
    // draw only the part of the pool in use (until the light ring starts, the heavy one's used prefix)
    const used = this.ring.w || this.headL > 0 ? HEAVY + (this.ring.w ? LIGHT : this.headL) : this.ring.y ? HEAVY : this.headH;
    this.mesh.geometry.setDrawRange(0, used * 6);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
