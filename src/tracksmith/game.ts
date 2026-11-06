import * as THREE from 'three';
import { Sim, DT, type Input, type CarState } from './sim.ts';
import { routeLine, type TrackData } from './track.ts';
import { Autopilot } from './autopilot.ts';
import { Stage, TrackView } from './render.ts';
import { CarView } from './car.ts';
import { ChaseCam } from './camera.ts';
import type { Audio } from './audio.ts';
import type { Controls } from './input.ts';
import { loadGhost, saveGhost, saveProfile, type Profile } from './store.ts';
import { Fx } from './fx.ts';

export interface RaceHooks {
  onTime?(ms: number): void;
  onCheck?(n: number, total: number, ms: number, delta: number | null): void;
  onFinish?(ms: number, pb: number | null, record: boolean): void;
  onStart?(): void;
  onRespawn?(): void;
  onSpeed?(kmh: number): void;
  onReset?(): void;
  /** a drift paid out, a clean landing */
  onStyle?(text: string, good: boolean): void;
}

const GHOST_EVERY = 2; // ticks per ghost frame (60 Hz)
/** the author's ghosts (tools/tsbot.mjs --ghosts) are thinner: 20 Hz */
const AUTHOR_EVERY = 6;
const authorGhosts = new Map<string, Float32Array | null>();

/** one track being driven: physics, views, ghost, timing */
export class Race {
  stage: Stage;
  sim!: Sim;
  track!: TrackData;
  view = new TrackView();
  car: CarView;
  ghostCar: CarView;
  cam = new ChaseCam();
  fx: Fx;
  hooks: RaceHooks = {};
  autopilot: Autopilot | null = null;
  testing = false;

  private acc = 0;
  private prev!: CarState;
  private cur!: CarState;
  private rec: number[] = [];
  private ghost: Float32Array | null = null;
  private ghostEvery = GHOST_EVERY;
  private splits: number[] = [];
  private time = 0;
  private lastInput: Input = { throttle: 0, brake: 0, steer: 0, hand: false };
  finishedAt = 0;
  paused = false;
  private seenFalls = 0;

  constructor(stage: Stage, private audio: Audio, private controls: Controls, private profile: Profile) {
    this.stage = stage;
    this.car = new CarView({ paint: profile.paint, accent: profile.accent });
    this.ghostCar = new CarView({ paint: 0xffffff, accent: 0xffffff }, true);
    this.fx = new Fx(stage.scene);
    stage.scene.add(this.view.group, this.car.root, this.ghostCar.root);
    this.ghostCar.root.visible = false;
  }

  /** a track id used for records: built-ins by id, user tracks by content */
  get recId() { return this.track.id; }

  load(td: TrackData, opts: { testing?: boolean; attract?: boolean } = {}) {
    this.sim?.free();
    this.track = td;
    this.testing = !!opts.testing;
    this.stage.setTheme(td.theme, td.pieces);
    this.view.build(td.pieces, this.stage.theme);
    this.sim = new Sim(td);
    this.autopilot = opts.attract && td.route ? new Autopilot(routeLine(td)) : null;
    this.restart();
  }

  restart() {
    this.sim.reset();
    this.prev = this.cur = this.sim.getState();
    this.acc = 0;
    this.rec = [];
    this.splits = [];
    this.finishedAt = 0;
    this.view.resetGates();
    this.ghost = this.profile.ghost && !this.autopilot ? loadGhost(this.recId) : null;
    this.ghostEvery = GHOST_EVERY;
    // no best of your own yet: you race the author
    if (!this.ghost && this.profile.ghost && !this.autopilot && this.track.route) this.authorGhost();
    this.ghostCar.root.visible = false;
    this.autopilot?.reset();
    this.seenFalls = 0;
    this.cam.reset();
    this.car.flame.visible = false;
    this.fx.clear();
    this.hooks.onReset?.();
    this.hooks.onTime?.(0);
  }

  private authorGhost() {
    const id = this.track.id;
    const use = (g: Float32Array | null) => {
      if (g && this.track.id === id && !this.ghost) {
        this.ghost = g;
        this.ghostEvery = AUTHOR_EVERY;
      }
    };
    if (authorGhosts.has(id)) return use(authorGhosts.get(id)!);
    fetch(`tracksmith/ghosts/${id}.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => {
      const g = b ? new Float32Array(b) : null;
      authorGhosts.set(id, g);
      use(g);
    }).catch(() => authorGhosts.set(id, null));
  }

  respawn() {
    if (!this.sim.started || this.sim.finished) return;
    this.sim.respawn();
    this.events();
  }

  get ms() { return (this.sim.ticks * 1000) / 120; }

  update(dt: number) {
    if (this.paused) { this.audio.drive(0, 0, 0, false, false, dt); return; }
    this.time += dt;
    let inp: Input = this.controls.read();
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= DT) {
      this.acc -= DT;
      if (this.autopilot) {
        const s = this.sim.getState();
        inp = this.autopilot.drive(s.p, s.q, s.v, this.sim.grounded > 0);
        if (this.sim.finished || (this.sim.started && this.sim.ticks > 120 * 200)) { this.restart(); return; }
        const { d } = this.autopilot.locate(s.p);
        if (this.sim.started && this.sim.grounded > 0 && d > 7) this.sim.respawn();
        if (this.sim.falls > this.seenFalls) this.autopilot.relocate(this.sim.getState().p);
        this.seenFalls = this.sim.falls;
      }
      this.lastInput = inp;
      this.prev = this.cur;
      this.sim.step(inp);
      this.cur = this.sim.getState();
      if (this.sim.started && !this.sim.finished && this.sim.ticks % GHOST_EVERY === 0) this.rec.push(...this.cur.p, ...this.cur.q);
      this.events();
    }
    const a = this.acc / DT;
    const p = new THREE.Vector3(...this.prev.p).lerp(new THREE.Vector3(...this.cur.p), a);
    const q = new THREE.Quaternion(...this.prev.q).slerp(new THREE.Quaternion(...this.cur.q), a);
    this.car.pose(p, q, this.sim.wheels);
    this.car.brake.color.setHex(inp.brake > 0 ? 0xff2a35 : 0x7a0d12);
    this.car.flame.visible = this.sim.boostT > 0 || this.sim.driftBoost > 0;
    if (this.car.flame.visible) this.car.flame.scale.set(1, 1, 0.8 + Math.random() * 0.5);

    // ghost
    if (this.ghost && this.sim.started) {
      const f = (this.sim.ticks + a) / this.ghostEvery;
      const n = this.ghost.length / 7;
      const i = Math.min(n - 1, Math.floor(f)), j = Math.min(n - 1, i + 1), t = f - Math.floor(f);
      const g = this.ghost;
      if (n > 1) {
        const gp = new THREE.Vector3(g[i * 7], g[i * 7 + 1], g[i * 7 + 2]).lerp(new THREE.Vector3(g[j * 7], g[j * 7 + 1], g[j * 7 + 2]), t);
        const gq = new THREE.Quaternion(g[i * 7 + 3], g[i * 7 + 4], g[i * 7 + 5], g[i * 7 + 6]).slerp(new THREE.Quaternion(g[j * 7 + 3], g[j * 7 + 4], g[j * 7 + 5], g[j * 7 + 6]), t);
        this.ghostCar.pose(gp, gq, null);
        this.ghostCar.root.visible = gp.distanceTo(p) > 2.2;
      }
    } else this.ghostCar.root.visible = false;

    const vel = new THREE.Vector3(...this.cur.v);
    this.cam.update(this.stage.camera, p, q, vel, this.sim.grounded > 0, dt);
    this.stage.followShadow(p.x, p.y, p.z);
    this.view.update(this.time);
    const slip = Math.max(...this.sim.wheels.map((w) => (w.hit ? w.slip : 0)));
    this.fx.update(dt, this.car, this.sim, slip);
    this.audio.drive(this.sim.speed, this.sim.finished ? 0 : this.lastInput.throttle, slip, this.sim.grounded === 0, true, dt);
    this.hooks.onSpeed?.(this.sim.kmh);
    if (this.sim.started && !this.sim.finished) this.hooks.onTime?.(this.ms + a * (1000 / 120));
  }

  private events() {
    for (const e of this.sim.events) {
      if (e.type === 'start') { this.hooks.onStart?.(); this.audio.go(); }
      if (e.type === 'respawn') {
        // (the sim puts the car back by itself when it leaves the road)
        this.prev = this.cur = this.sim.getState();
        this.cam.reset();
        this.audio.respawn();
        this.hooks.onRespawn?.();
      }
      if (e.type === 'wall') {
        this.audio.wall(e.speed);
        const w = this.sim.wallP;
        this.fx.sparks(new THREE.Vector3(w.x, w.y, w.z), this.sim.wallN ?? { x: 0, z: 0 }, 10 + Math.min(22, Math.round(e.speed * 1.5)));
        this.cam.kick(Math.min(0.4, e.speed * 0.03));
      }
      if (e.type === 'boost') { this.audio.boost(); this.fx.burst(this.car.root.position, 0xffb347, 18); }
      if (e.type === 'land') {
        if (e.speed > 4) this.audio.land(e.speed);
        this.fx.dust(this.car.root.position, Math.min(1, e.speed / 12));
        this.cam.kick(Math.min(0.5, e.speed * 0.04));
        if (e.clean) {
          this.audio.boost();
          this.fx.burst(this.car.root.position, 0x7df0ff, 14);
          this.hooks.onStyle?.('CLEAN LANDING', true);
        }
      }
      if (e.type === 'drift') {
        this.audio.boost();
        this.fx.burst(this.car.root.position, e.k > 0.75 ? 0x6fc8ff : 0xffb347, 10 + Math.round(e.k * 14));
        this.cam.kick(0.12);
        this.hooks.onStyle?.(e.k > 0.75 ? 'BIG DRIFT BOOST' : 'DRIFT BOOST', true);
      }
      if (e.type === 'check') {
        const ms = (e.ticks * 1000) / 120;
        this.splits.push(ms);
        const best = this.profile.splits[this.recId];
        const delta = best && best[e.n - 1] !== undefined ? ms - best[e.n - 1] : null;
        this.view.pass(e.i, delta === null ? 0x46e38a : delta <= 0 ? 0x4aa8ff : 0xff5a4a);
        this.audio.check(delta === null ? null : delta <= 0);
        this.fx.burst(this.car.root.position, this.stage.theme.accent, 26);
        if (!this.autopilot) this.hooks.onCheck?.(e.n, this.sim.checks.length, ms, delta);
      }
      if (e.type === 'finish') {
        const ms = (e.ticks * 1000) / 120;
        this.finishedAt = ms;
        if (this.autopilot) continue;
        const pb = this.profile.pbs[this.recId] ?? null;
        const record = pb === null || ms < pb;
        if (record) {
          this.profile.pbs[this.recId] = ms;
          this.profile.splits[this.recId] = this.splits.slice();
          this.rec.push(...this.cur.p, ...this.cur.q);
          saveGhost(this.recId, new Float32Array(this.rec));
          saveProfile(this.profile);
        }
        this.audio.finish(record);
        this.fx.confetti(this.car.root.position);
        this.hooks.onFinish?.(ms, pb, record);
      }
    }
    this.sim.events.length = 0;
  }

  setCam(mode: number) { this.cam.mode = mode; this.cam.reset(); }

  dispose() {
    this.sim?.free();
    this.view.dispose();
    this.stage.scene.remove(this.view.group, this.car.root, this.ghostCar.root);
    this.car.dispose();
    this.ghostCar.dispose();
    this.fx.dispose();
  }
}
