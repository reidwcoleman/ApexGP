import { V3 } from './math.ts';

/**
 * RocketSim (github.com/ZealanL/RocketSim, MIT), compiled to WebAssembly: the real game's car, ball
 * and arena physics, tick for tick. src/boost/sim/rs holds the build (rs.mjs, rs.wasm, built from
 * tools/rocketsim/rsjs.cpp via tools/rocketsim/build.sh) and arena.bin, the arena's collision meshes from tools/boost_rsmesh.mjs.
 *
 * RocketSim's world is the mirror image of ours (its y is the car's right, ours its left), so
 * everything crosses through x → −x: positions and velocities flip x; spins (axial vectors) flip y
 * and z; a car's right becomes our −left.
 */

interface RSModule {
  HEAPF64: Float64Array;
  HEAPU8: Uint8Array;
  _rs_init(p: number, n: number): number;
  _rs_create(): void;
  _rs_add_car(team: number, preset: number): number;
  _rs_clear_cars(): void;
  _rs_controls(id: number, th: number, st: number, pi: number, ya: number, ro: number, j: number, b: number, h: number): void;
  _rs_step(n: number): void;
  _rs_tick(): number;
  _rs_set_tick(t: number): void;
  _rs_get_car(id: number, p: number): void;
  _rs_set_car(id: number, p: number): void;
  _rs_get_ball(p: number): void;
  _rs_set_ball(p: number): void;
  _rs_pad_count(): number;
  _rs_pad_info(k: number, p: number): void;
  _rs_get_pads(p: number): void;
  _rs_set_pads(p: number): void;
  _rs_events(p: number, max: number): number;
  _rs_malloc(n: number): number;
}

/** a car's state in RocketSim's layout (see rsjs.cpp), 73 numbers */
export const CS = 73;
export const BS = 18;
// offsets into a car state
export const K = {
  pos: 0,
  vel: 3,
  ang: 6,
  fwd: 9,
  right: 12,
  up: 15,
  onGround: 18,
  wheels: 19,
  hasJumped: 23,
  hasDoubleJumped: 24,
  hasFlipped: 25,
  flipTorque: 26,
  jumpTime: 29,
  flipTime: 30,
  isFlipping: 31,
  isJumping: 32,
  airTime: 33,
  airTimeSinceJump: 34,
  boost: 35,
  timeSinceBoosted: 36,
  isBoosting: 37,
  boostingTime: 38,
  isSupersonic: 39,
  supersonicTime: 40,
  handbrake: 41,
  isAutoFlipping: 42,
  autoFlipTimer: 43,
  autoFlipScale: 44,
  worldContact: 45,
  contactNormal: 46,
  otherCar: 49,
  bumpCooldown: 50,
  isDemoed: 51,
  demoTimer: 52,
  hitValid: 53,
  hitTick: 63,
  extraTick: 64,
  lastControls: 65,
} as const;

let M: RSModule | null = null;
let buf = 0;

/** load the module and the arena meshes (once, before any World is made) */
export async function loadRocketSim(): Promise<void> {
  if (M) return;
  const create = (await import('./rs/rs.mjs')).default as (o?: object) => Promise<RSModule>;
  const meshUrl = new URL('./rs/arena.bin', import.meta.url);
  let bin: Uint8Array;
  if (typeof window === 'undefined') {
    // (headless tools under node; the name is built so the bundler leaves it alone)
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync(u: URL): Uint8Array };
    bin = new Uint8Array(fs.readFileSync(meshUrl));
  } else bin = new Uint8Array(await (await fetch(meshUrl)).arrayBuffer());
  const m = await create();
  const p = m._rs_malloc(bin.length);
  m.HEAPU8.set(bin, p);
  let count = 0;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let o = 0; o < bin.length; o += 4 + dv.getInt32(o, true)) count++;
  m._rs_init(p, count);
  buf = m._rs_malloc(8 * 512);
  M = m;
}

export function rocketSimReady(): boolean {
  return M !== null;
}

function mod(): RSModule {
  if (!M) throw new Error('RocketSim not loaded: await loadRocketSim() first');
  return M;
}
const heap = () => new Float64Array(mod().HEAPF64.buffer, buf, 512);

/** the arena as it was made (ball on the spot, every pad live): what a reused arena is reset to */
let fresh: { ball: Float64Array; pads: Float64Array } | null = null;
let primed = true;

/** the arena's first step does seconds of one-off setup inside Bullet: the page calls this while it
 * loads (alongside the GPU compiling shaders) so it never lands on a frame of play. The ball, the pads
 * and the clock go back as they were; the cars move one tick. */
export function primeRocketSim(): void {
  if (primed || !M || !fresh) return;
  primed = true;
  const ball = new Float64Array(BS);
  const pads = new Float64Array(fresh.pads.length);
  const a = Object.create(RSArena.prototype) as RSArena;
  a.getBall(ball);
  a.getPads(pads);
  const t = M._rs_tick();
  M._rs_step(1);
  a.setBall(ball);
  a.setPads(pads);
  M._rs_set_tick(t);
}

/** one RocketSim arena. The module holds a single one, and building it (the collision meshes into
 * Bullet, then its first step) takes seconds, so it's built once: every later arena clears the cars
 * and puts the ball, the pads and the clock back to how they started. */
export class RSArena {
  constructor() {
    const m = mod();
    if (!fresh) {
      m._rs_create();
      fresh = { ball: new Float64Array(BS), pads: new Float64Array(this.padCount() * 3) };
      this.getBall(fresh.ball);
      this.getPads(fresh.pads);
      primed = false;
    } else {
      m._rs_clear_cars();
      this.setBall(fresh.ball);
      this.setPads(fresh.pads);
      m._rs_set_tick(0);
      this.events();
    }
  }
  /** preset: the hitbox class (0 octane, 1 dominus, 2 plank, 3 breakout, 4 hybrid, 5 merc) */
  addCar(team: number, preset = 0): number {
    return mod()._rs_add_car(team, preset);
  }
  clearCars(): void {
    mod()._rs_clear_cars();
  }
  controls(id: number, th: number, st: number, pi: number, ya: number, ro: number, j: boolean, b: boolean, h: boolean): void {
    mod()._rs_controls(id, th, st, pi, ya, ro, j ? 1 : 0, b ? 1 : 0, h ? 1 : 0);
  }
  step(n = 1): void {
    mod()._rs_step(n);
  }
  get tick(): number {
    return mod()._rs_tick();
  }
  set tick(t: number) {
    mod()._rs_set_tick(t);
  }
  /** a car's raw state (RocketSim's frame) into out */
  getCar(id: number, out: Float64Array | Float32Array, o = 0): void {
    mod()._rs_get_car(id, buf);
    const h = heap();
    for (let k = 0; k < CS; k++) out[o + k] = h[k];
  }
  setCar(id: number, src: ArrayLike<number>, o = 0): void {
    const h = heap();
    for (let k = 0; k < CS; k++) h[k] = src[o + k];
    mod()._rs_set_car(id, buf);
  }
  getBall(out: Float64Array | Float32Array, o = 0): void {
    mod()._rs_get_ball(buf);
    const h = heap();
    for (let k = 0; k < BS; k++) out[o + k] = h[k];
  }
  setBall(src: ArrayLike<number>, o = 0): void {
    const h = heap();
    for (let k = 0; k < BS; k++) h[k] = src[o + k];
    mod()._rs_set_ball(buf);
  }
  padCount(): number {
    return mod()._rs_pad_count();
  }
  /** a pad's position in our frame and whether it's big */
  padInfo(k: number): { x: number; y: number; big: boolean } {
    mod()._rs_pad_info(k, buf);
    const h = heap();
    return { x: -h[0], y: h[1], big: h[3] > 0.5 };
  }
  getPads(out: Float64Array | Float32Array, o = 0): void {
    mod()._rs_get_pads(buf);
    const h = heap();
    const n = this.padCount() * 3;
    for (let k = 0; k < n; k++) out[o + k] = h[k];
  }
  setPads(src: ArrayLike<number>, o = 0): void {
    const h = heap();
    const n = this.padCount() * 3;
    for (let k = 0; k < n; k++) h[k] = src[o + k];
    mod()._rs_set_pads(buf);
  }
  /** bumps since the last call, as [hitter id, victim id, demo] */
  events(): [number, number, boolean][] {
    const n = mod()._rs_events(buf, 300);
    const h = heap();
    const r: [number, number, boolean][] = [];
    for (let k = 0; k + 2 < n; k += 3) r.push([h[k], h[k + 1], h[k + 2] > 0.5]);
    return r;
  }
}

// ---- crossing the mirror (x → −x)
export function vecIn(s: ArrayLike<number>, o: number, out: V3): V3 {
  return out.set(-s[o], s[o + 1], s[o + 2]);
}
export function vecOut(v: V3, s: { [k: number]: number }, o: number): void {
  s[o] = -v.x;
  s[o + 1] = v.y;
  s[o + 2] = v.z;
}
/** spins and torques are axial: in the mirror their y and z change sign */
export function spinIn(s: ArrayLike<number>, o: number, out: V3): V3 {
  return out.set(s[o], -s[o + 1], -s[o + 2]);
}
export function spinOut(v: V3, s: { [k: number]: number }, o: number): void {
  s[o] = v.x;
  s[o + 1] = -v.y;
  s[o + 2] = -v.z;
}
