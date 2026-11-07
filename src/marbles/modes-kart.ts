import * as THREE from 'three';
import type { Marble } from './physics.ts';
import type { Course } from './courses.ts';
import type { Sound } from './audio.ts';
import type { UI } from './ui.ts';
import { KART } from './kart-sim.ts';
import { Racer as Sim, RACE, stepRace, type KartHit } from './kart-race.ts';
import { Surf } from './kart-track.ts';
import { KartModel } from './kart-model.ts';
import { Bits, Skids } from './kart-fx.ts';
import { KartAudio } from './kart-audio.ts';

/**
 * The game side of the go-karts: a kart under every bean. Each browser steps the karts it owns (its
 * player, and on the host the bots), reads the rest from the network, and draws the lot: the
 * karts, the driver in the seat, the smoke, the sparks, the rubber on the road, the sound of it.
 */

type Bean = {
  m: Marble;
  c: { id: number; name: string; outfit: { a: number; b?: number; limb?: number }; player: boolean };
  rig: { root: THREE.Object3D; seat: THREE.Vector3 | null; tilt: THREE.Quaternion | null; steer: number | null };
  bot: unknown;
  local: boolean;
  out: boolean;
  fin: number;
  s: number;
};

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();

interface Mark {
  x: number;
  y: number;
  z: number;
  a: number;
  on: boolean;
}

export class KartPlay {
  readonly arena;
  private sims: Sim[] = [];
  private byId = new Map<number, Sim>();
  private model: KartModel;
  private smoke = new Bits(520, false);
  private sparks = new Bits(320, true);
  private skids = new Skids(2600);
  private audio: KartAudio;
  /** each kart's last skid point per rear wheel */
  private marks = new Map<number, Mark[]>();
  /** the wheels as the drawing wants them */
  private wheelArgs = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0, r: 0, spin: 0, steer: 0, comp: 0 }));
  /** the chase camera */
  private camYaw = NaN;
  private camUp = new THREE.Vector3(0, 1, 0);
  private camAt = new THREE.Vector3();
  private bump = 0;
  private fov = 0;
  /** what's been called to the player */
  private lapSeen = 0;
  private boostSeen = 0;
  private bestSeen = 0;
  private wrongShown = false;
  private gearSeen = 1;
  private hud: HTMLElement;
  private hudEls: Record<string, HTMLElement> = {};
  private map: CanvasRenderingContext2D;
  private mapBase: HTMLCanvasElement;
  private mapK = 1;
  private mapX = 0;
  private mapZ = 0;
  private mapT = 0;
  private hits: KartHit[] = [];
  /** the headings other people's karts had last frame */
  private yaws = new Map<number, number>();

  constructor(
    private course: Course,
    private scene: THREE.Scene,
    private beans: () => Bean[],
    private ui: UI,
    private sound: Sound,
    slots: number[],
  ) {
    const A = (this.arena = course.kart!);
    const all = beans();
    all.forEach((r, k) => {
      const s = new Sim(r.m.id);
      s.grid(A.track, slots[k]);
      s.local = r.local;
      this.sims.push(s);
      this.byId.set(r.m.id, s);
      this.copy(r, s);
      this.marks.set(r.m.id, [{ x: 0, y: 0, z: 0, a: 0, on: false }, { x: 0, y: 0, z: 0, a: 0, on: false }]);
    });
    A.bind(this.sims);
    this.model = new KartModel(scene, all.length, all.map((r) => ({ a: r.c.outfit.a, b: r.c.outfit.b ?? r.c.outfit.limb ?? 0xffffff })));
    scene.add(this.smoke.mesh, this.sparks.mesh, this.skids.mesh);
    this.audio = new KartAudio(sound);
    // ---- the dash
    this.hud = document.createElement('div');
    this.hud.className = 'mk-dash';
    this.hud.innerHTML = `
      <div class="mk-lap"><span>LAP</span><b>1</b><i>/ ${RACE.laps}</i></div>
      <div class="mk-times"><span class="mk-now">0:00.0</span><span class="mk-best"></span></div>
      <canvas class="mk-map" width="340" height="340"></canvas>
      <div class="mk-gauge"><div class="mk-rev"><i></i></div><div class="mk-speed"><b>0</b><span>KM/H</span></div><div class="mk-gear">N</div></div>
      <div class="mk-drift"><i></i><span>DRIFT</span></div>
      <div class="mk-tow">SLIPSTREAM</div>
      <div class="mk-wrong">WRONG WAY</div>
      <div class="mk-help"><b>W / UP</b> go &nbsp; <b>S / DOWN</b> brake, then reverse &nbsp; <b>A D</b> steer &nbsp; <b>SPACE / SHIFT</b> hold to drift, let go for a boost</div>`;
    document.body.appendChild(this.hud);
    document.body.classList.add('mk-on');
    for (const k of ['lap', 'now', 'best', 'speed', 'gear', 'rev', 'drift', 'driftBox', 'tow', 'wrong', 'help'])
      this.hudEls[k] = this.hud.querySelector(
        { lap: '.mk-lap b', now: '.mk-now', best: '.mk-best', speed: '.mk-speed b', gear: '.mk-gear', rev: '.mk-rev i', drift: '.mk-drift i', driftBox: '.mk-drift', tow: '.mk-tow', wrong: '.mk-wrong', help: '.mk-help' }[k]!,
      ) as HTMLElement;
    const cv = this.hud.querySelector('.mk-map') as HTMLCanvasElement;
    this.map = cv.getContext('2d')!;
    this.mapBase = document.createElement('canvas');
    this.mapBase.width = this.mapBase.height = 340;
    this.drawMap();
  }

  dispose() {
    this.model.dispose();
    this.scene.remove(this.smoke.mesh, this.sparks.mesh, this.skids.mesh);
    this.smoke.dispose();
    this.sparks.dispose();
    this.skids.dispose();
    this.audio.dispose();
    this.hud.remove();
    document.body.classList.remove('mk-on');
    for (const r of this.beans()) {
      r.rig.seat = r.rig.tilt = null;
      r.rig.steer = null;
    }
    this.cam?.up.set(0, 1, 0);
  }
  private cam: THREE.Camera | null = null;

  private drawMap() {
    const tr = this.arena.track, c = this.mapBase.getContext('2d')!;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < tr.n; i++) {
      x0 = Math.min(x0, tr.P[i * 3]);
      x1 = Math.max(x1, tr.P[i * 3]);
      z0 = Math.min(z0, tr.P[i * 3 + 2]);
      z1 = Math.max(z1, tr.P[i * 3 + 2]);
    }
    this.mapK = 300 / Math.max(x1 - x0, z1 - z0);
    this.mapX = (x0 + x1) / 2;
    this.mapZ = (z0 + z1) / 2;
    const path = () => {
      c.beginPath();
      for (let i = 0; i <= tr.n; i += 3) {
        const k = tr.idx(i), [x, y] = this.toMap(tr.P[k * 3], tr.P[k * 3 + 2]);
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.closePath();
    };
    c.lineJoin = 'round';
    path();
    c.strokeStyle = 'rgba(10,12,30,0.75)';
    c.lineWidth = 19;
    c.stroke();
    path();
    c.strokeStyle = 'rgba(255,255,255,0.92)';
    c.lineWidth = 10;
    c.stroke();
    const [sx, sy] = this.toMap(tr.P[RACE.start * 3], tr.P[RACE.start * 3 + 2]);
    c.fillStyle = '#ffc21f';
    c.fillRect(sx - 3, sy - 12, 6, 24);
  }
  /** (north up, as the map of a place should be: the world's -z) */
  private toMap(x: number, z: number): [number, number] {
    return [170 + (x - this.mapX) * this.mapK, 170 + (z - this.mapZ) * this.mapK];
  }

  of(id: number) {
    return this.byId.get(id);
  }
  /** done its laps */
  done(id: number) {
    const s = this.byId.get(id);
    return !!s && s.prog >= RACE.laps * this.arena.track.length;
  }

  /** the sim's kart into the bean's body */
  private copy(r: Bean, s: Sim) {
    const m = r.m, k = s.kart;
    m.pos.copy(k.pos);
    m.vel.copy(k.vel);
    m.quat.copy(k.quat);
    m.yaw = Math.atan2(k.az.x, k.az.z);
    m.groundT = k.air > 0.22 ? 1 : 0;
    r.s = s.prog;
  }

  step(dt: number, t: number, go: number) {
    const A = this.arena, tr = A.track, x = t - go;
    if (dt <= 0) return;
    const all = this.beans();
    all.forEach((r, i) => {
      const s = this.sims[i], k = s.kart, m = r.m;
      s.held = m.frozen;
      if (!r.local) {
        // (someone else's: as reported)
        k.pos.copy(m.pos);
        k.vel.copy(m.vel);
        k.quat.copy(m.quat);
        k.refresh();
        tr.at(k.pos.x, k.pos.y, k.pos.z, k.hint, k.q);
        k.hint = k.q.i;
        s.prog = r.s;
        s.held = false;
        return;
      }
      if (r.fin || r.out) {
        s.input = { steer: s.input.steer * 0.9, throttle: 0, brake: 0.55, drift: false };
      } else if (!r.bot) {
        s.input = { steer: m.input.x, throttle: Math.max(0, m.input.z), brake: Math.max(0, -m.input.z), drift: m.jet };
      }
    });
    this.hits.length = 0;
    stepRace(this.sims, dt, tr, t, (h) => this.hits.push(h));
    all.forEach((r, i) => {
      const s = this.sims[i];
      if (!r.local) return;
      s.track(tr, Math.max(0, x));
      if (!s.held && s.watch(tr, dt, t) && r.c.player) this.ui.note('Back on track', 900);
      this.copy(r, s);
    });
    // the driver in the seat
    all.forEach((r, i) => {
      const k = this.sims[i].kart;
      r.rig.seat = (r.rig.seat ?? new THREE.Vector3()).copy(k.pos).addScaledVector(k.ay, -KART.hcg + 0.13).addScaledVector(k.az, -0.24);
      r.rig.tilt = (r.rig.tilt ?? new THREE.Quaternion()).copy(k.quat);
      r.rig.steer = k.hands;
    });
  }

  /** the lap calls, the boost, going the wrong way */
  calls(id: number) {
    const s = this.byId.get(id);
    if (!s) return;
    const k = s.kart;
    if (s.lap > this.lapSeen && s.prog > 0) {
      this.lapSeen = s.lap;
      if (s.lap === RACE.laps - 1) {
        this.ui.shout('FINAL LAP!', s.bestLap ? `Last lap ${lapTime(s.bestLap)}` : '', 1500);
        this.sound.notes([72, 76, 79, 84], 0.06, 0.4, true);
      }
    }
    if (k.fired !== this.boostSeen) {
      this.boostSeen = k.fired;
      if (k.fired) {
        this.ui.pop(k.fired === 2 ? 'SUPER BOOST!' : 'BOOST!', true);
        this.sound.notes(k.fired === 2 ? [79, 86, 91] : [76, 83], 0.04, 0.34, true);
        this.fov = Math.max(this.fov, k.fired === 2 ? 7 : 4);
        k.fired = 0;
        this.boostSeen = 0;
      }
    }
    const wrong = s.wrong > 1.2;
    if (wrong !== this.wrongShown) {
      this.wrongShown = wrong;
      this.hudEls.wrong.classList.toggle('on', wrong);
    }
  }

  /** this frame's jolt for the camera, from the hits and the landings */
  jolt(id: number) {
    const s = this.byId.get(id);
    if (!s) return 0;
    const v = this.bump;
    this.bump = 0;
    return v + (s.kart.q.mat === Surf.Kerb ? 0.012 : s.kart.q.mat >= Surf.Grass ? 0.03 : 0) * Math.min(1, s.kart.vel.length() / 20);
  }
  kick(_id: number) {
    const v = this.fov;
    this.fov = 0;
    return v;
  }

  /** the chase camera: it hangs back and swings wide of a slide, so a drift looks like one */
  aim(cam: THREE.PerspectiveCamera, id: number, dt: number, snap: boolean, look: THREE.Vector3) {
    this.cam = cam;
    const s = this.byId.get(id);
    if (!s) return;
    const k = s.kart, tr = this.arena.track, sp = k.vel.length();
    const nose = Math.atan2(k.az.x, k.az.z), way = sp > 5 ? Math.atan2(k.vel.x, k.vel.z) : nose;
    let d = way - nose;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const want = nose + d * 0.72;
    if (Number.isNaN(this.camYaw) || snap) this.camYaw = want;
    let e = want - this.camYaw;
    e = Math.atan2(Math.sin(e), Math.cos(e));
    this.camYaw += e * Math.min(1, dt * 6.5);
    const dist = 4.9 + Math.min(1.9, sp * 0.05), hgt = 2.05 + Math.min(0.4, sp * 0.012);
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    V.set(k.pos.x - fx * dist, k.pos.y + hgt, k.pos.z - fz * dist);
    // (not out through a barrier)
    const q = tr.at(V.x, V.y, V.z, k.hint, probeCam);
    const wall = (q.lat > 0 ? q.wl : q.wr) - 0.4, over = Math.abs(q.lat) - wall;
    if (over > 0) V.addScaledVector(V2.set(q.lx, q.ly, q.lz), -Math.sign(q.lat) * over);
    // (and above the road, on a bank)
    if (q.h < 1.1) V.y += 1.1 - q.h;
    if (snap) this.camAt.copy(V);
    else {
      const f = Math.min(1, dt * 16), fy = Math.min(1, dt * 7);
      this.camAt.x += (V.x - this.camAt.x) * f;
      this.camAt.z += (V.z - this.camAt.z) * f;
      this.camAt.y += (V.y - this.camAt.y) * fy;
    }
    cam.position.copy(this.camAt);
    look.set(k.pos.x + fx * 6, k.pos.y + 0.75, k.pos.z + fz * 6);
    // (the horizon leans a little with the banking)
    V2.set(0, 1, 0).lerp(V.set(k.q.nx, k.q.ny, k.q.nz), 0.5).normalize();
    this.camUp.lerp(V2, Math.min(1, dt * 4));
    cam.up.copy(this.camUp);
    cam.lookAt(look);
  }

  /** everything you see and hear of it */
  sync(t: number, dt: number, cam: THREE.PerspectiveCamera, focus: number, goLeft: number, show: boolean) {
    const A = this.arena, all = this.beans();
    this.hud.classList.toggle('on', show);
    // the gantry: five reds come on through the count, and go out on the off
    if (goLeft >= 0) A.lights(Math.min(5, Math.max(0, Math.ceil((2.1 - goLeft) / 0.42))), false);
    else A.lights(0, t - this.course.state.go < 3);
    const fs = this.byId.get(focus);
    this.model.begin();
    const ranked: { d: number; s: Sim; i: number }[] = [];
    all.forEach((r, i) => {
      const s = this.sims[i], k = s.kart, m = r.m;
      const sp = k.vel.length();
      const blink = s.ghost > t && Math.floor(t * 12) % 2 === 0;
      if (!r.local) {
        // (nothing's been simulated here: wheels and hands from how it's moving)
        k.vf = k.vel.dot(k.az);
        k.vl = k.vel.dot(k.ax);
        k.beta = sp > 2 ? Math.atan2(k.vl, Math.max(Math.abs(k.vf), 0.5)) : 0;
        // (near enough: revs climbing through each gear's band, steering from how fast the nose is turning)
        const nose = Math.atan2(k.az.x, k.az.z), lastY = this.yaws.get(m.id) ?? nose;
        this.yaws.set(m.id, nose);
        const turn = Math.atan2(Math.sin(nose - lastY), Math.cos(nose - lastY)) / Math.max(dt, 0.004);
        k.delta += (THREE.MathUtils.clamp((turn * 2) / Math.max(sp, 4), -0.42, 0.42) - k.delta) * Math.min(1, dt * 10);
        k.hands = -k.delta * 2.6;
        k.air = m.groundT > 0.5 ? 1 : 0;
        k.drifting = Math.abs(k.beta) > 0.2 && sp > 7;
        k.rpm = 7600 + ((sp * 3.6) % 34) * 170;
        for (const w of k.wheels) {
          w.spin += ((k.vf / w.r) * dt) % 6.283;
          w.comp = 0.05;
          w.on = k.air < 0.05;
          w.slide = Math.abs(k.beta) > 0.2 ? 1 : 0;
          w.q.nx = k.q.nx;
          w.q.ny = k.q.ny;
          w.q.nz = k.q.nz;
        }
      }
      k.wheels.forEach((w, j) => {
        const a = this.wheelArgs[j];
        a.x = w.x;
        a.z = w.z;
        a.r = w.r;
        a.y = w.y - (KART.rest - (w.on ? w.comp : 0));
        a.spin = w.spin;
        a.steer = w.front ? k.delta : 0;
      });
      const flame = k.boost > 0 ? 1 : k.level > 0 ? 0.25 : 0;
      this.model.put(i, k.pos, k.quat, k.hands, this.wheelArgs, blink, flame, k.brake > 0.2);
      if (blink) r.rig.root.visible = false;
      const near = k.pos.distanceToSquared(cam.position);
      ranked.push({ d: near, s, i });
      if (near < 110 * 110) this.tyreFx(r.m.id, s, dt, near);
    });
    this.model.end();
    // bangs
    for (const h of this.hits) {
      const near = V.set(h.x, h.y, h.z).distanceTo(cam.position);
      if (near > 90) continue;
      for (let n = 0; n < Math.min(26, h.power * 2.4); n++) this.spark(h.x, h.y, h.z, 1, 0.62, 0.22, 6 + h.power);
      this.audio.crash(h.power, Math.max(0.1, 1 - near / 70), this.panOf(cam, V));
      if ((h.a === focus || h.b === focus) && h.power > 3) this.bump = Math.max(this.bump, Math.min(0.32, h.power * 0.03));
    }
    for (const s of this.sims) {
      const k = s.kart;
      if (k.wallHit > 1.2) {
        const near = V.set(k.wx, k.wy, k.wz).distanceTo(cam.position);
        for (let n = 0; n < Math.min(34, k.wallHit * 3); n++) this.spark(k.wx, k.wy, k.wz, 1, 0.68, 0.28, 5 + k.wallHit);
        for (let n = 0; n < 4; n++) this.smoke.add(k.wx, k.wy, k.wz, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, 0.8, 1.2, 2.2, 0.82, 0.8, 0.74, 0.34);
        if (near < 80) this.audio.crash(k.wallHit, Math.max(0.1, 1 - near / 60), this.panOf(cam, V));
        if (s === fs) this.bump = Math.max(this.bump, Math.min(0.42, k.wallHit * 0.04));
      }
      if (k.scrape > 0) {
        for (let n = 0; n < 6; n++) this.spark(k.wx, k.wy, k.wz, 1, 0.78, 0.34, 7);
        if (s === fs) this.bump = Math.max(this.bump, Math.min(0.22, k.scrape * 0.03));
      }
      if (k.landed > 2 && s === fs) this.bump = Math.max(this.bump, Math.min(0.3, k.landed * 0.05));
      k.wallHit = k.scrape = k.landed = 0;
    }
    this.smoke.update(dt, window.innerHeight);
    this.sparks.update(dt, window.innerHeight);
    // the sound: your own kart, and the nearest three
    if (fs) {
      const k = fs.kart;
      this.audio.engine(0, k.rpm, k.throttle, 1, 0);
      let slide = 0, rough = 0;
      for (const w of k.wheels) {
        if (!w.on) continue;
        slide = Math.max(slide, w.mat <= Surf.Kerb ? Math.min(1.4, w.slide * 1.1) : 0);
        rough = Math.max(rough, w.mat === Surf.Kerb ? 0.5 : w.mat >= Surf.Grass ? 1 : 0);
      }
      this.audio.tyres(slide * Math.min(1, k.vel.length() / 8), rough, k.vel.length());
      if (k.gear !== this.gearSeen) {
        if (k.gear > this.gearSeen) this.audio.pop(1);
        this.gearSeen = k.gear;
      }
    }
    ranked.sort((a, b) => a.d - b.d);
    let v = 1;
    for (const e of ranked) {
      if (e.s === fs) continue;
      if (v > 3) break;
      const k = e.s.kart, d = Math.sqrt(e.d);
      this.audio.engine(v++, k.rpm, Math.min(1, k.throttle + 0.3), Math.max(0, 1 - d / 55) ** 2 * 0.7, this.panOf(cam, k.pos));
    }
    this.dash(fs, t);
  }

  private panOf(cam: THREE.Camera, p: THREE.Vector3) {
    V2.copy(p).sub(cam.position).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    return THREE.MathUtils.clamp(V2.dot(right), -1, 1);
  }

  private spark(x: number, y: number, z: number, r: number, g: number, b: number, sp: number) {
    const a = Math.random() * 6.28, u = Math.random();
    this.sparks.add(x, y, z, Math.cos(a) * sp * u, sp * 0.5 * Math.random() + 1, Math.sin(a) * sp * u, 0.25 + Math.random() * 0.45, 0.09, -0.08, r * 3, g * 3, b * 3, 1, 15);
  }

  /** smoke, dust, the drift's charge in sparks, and the black lines */
  private tyreFx(id: number, s: Sim, dt: number, near: number) {
    const k = s.kart, marks = this.marks.get(id)!;
    const sp = k.vel.length();
    k.wheels.forEach((w, j) => {
      if (!w.on || sp < 3) {
        if (j >= 2) marks[j - 2].on = false;
        return;
      }
      const dirt = w.mat >= Surf.Grass;
      const slide = Math.min(1, w.slide * 0.8);
      const wx = w.cx, wy = w.cy, wz = w.cz;
      if (dirt && Math.random() < dt * sp * 1.4) this.smoke.add(wx, wy + 0.1, wz, -k.vel.x * 0.08 + (Math.random() - 0.5), 1.2 + Math.random(), -k.vel.z * 0.08 + (Math.random() - 0.5), 0.8, 0.5, 1.6, w.mat === Surf.Gravel ? 0.84 : 0.56, w.mat === Surf.Gravel ? 0.74 : 0.58, w.mat === Surf.Gravel ? 0.56 : 0.34, 0.5);
      if (j < 2) {
        // (locked or scrubbing fronts: a wisp)
        if (!dirt && slide > 0.5 && Math.random() < dt * 24) this.smoke.add(wx, wy + 0.08, wz, k.vel.x * 0.1, 0.5, k.vel.z * 0.1, 0.6, 0.4, 1.8, 0.92, 0.92, 0.94, 0.16);
        return;
      }
      // (real smoke is for a real slide: a tyre working near its limit only leaves a faint line)
      const burn = k.drifting ? Math.max(slide, 0.6) : slide - 0.42;
      if (!dirt && burn > 0 && near < 70 * 70 && Math.random() < dt * 62 * burn) this.smoke.add(wx + (Math.random() - 0.5) * 0.2, wy + 0.1, wz + (Math.random() - 0.5) * 0.2, k.vel.x * 0.16, 0.7 + Math.random() * 0.8, k.vel.z * 0.16, 0.8 + Math.random() * 0.6, 0.45, 2.3, 0.94, 0.94, 0.96, 0.13 + burn * 0.14);
      // the charge: amber, then blue, thrown back off the rears
      if (k.level > 0 && Math.random() < dt * 80) {
        const hot = k.level === 2;
        this.sparks.add(wx, wy + 0.06, wz, -k.az.x * 5 + k.vel.x * 0.6 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, -k.az.z * 5 + k.vel.z * 0.6 + (Math.random() - 0.5) * 3, 0.3, 0.08, -0.05, hot ? 0.45 : 1, hot ? 0.75 : 0.62, hot ? 1.4 : 0.2, 1, 14);
      }
      const m = marks[j - 2];
      const a = !dirt && (slide > 0.24 || k.drifting) ? Math.min(0.62, 0.08 + slide * 0.62) : 0;
      if (a > 0) {
        if (m.on && Math.hypot(wx - m.x, wz - m.z) > 0.4) {
          this.skids.add(m.x, m.y, m.z, wx, wy, wz, w.q.lx, w.q.ly, w.q.lz, 0.14, m.a, a, 0.02);
          m.x = wx;
          m.y = wy;
          m.z = wz;
          m.a = a;
        } else if (!m.on) {
          m.x = wx;
          m.y = wy;
          m.z = wz;
          m.a = 0;
          m.on = true;
        }
      } else m.on = false;
    });
  }

  private dash(s: Sim | undefined, t: number) {
    const e = this.hudEls;
    if (s) {
      const k = s.kart, sp = k.vel.length();
      e.speed.textContent = String(Math.round(sp * 3.6));
      e.gear.textContent = k.gear === 0 ? 'R' : String(k.gear);
      e.rev.style.transform = `scaleX(${Math.min(1, k.rpm / KART.limit).toFixed(3)})`;
      e.rev.classList.toggle('hot', k.rpm > 12800);
      e.lap.textContent = String(Math.min(RACE.laps, s.lap + 1));
      const go = this.course.state.go < 1e8 ? Math.max(0, t - this.course.state.go) : 0;
      const last = s.laps[s.laps.length - 1] ?? 0;
      e.now.textContent = lapTime(Math.max(0, go - last));
      if (s.bestLap !== this.bestSeen) {
        this.bestSeen = s.bestLap;
        e.best.textContent = s.bestLap ? `BEST ${lapTime(s.bestLap)}` : '';
      }
      const f = k.level === 2 ? 1 : k.level === 1 ? 0.5 + 0.5 * Math.min(1, (k.driftT - KART.charge[0]) / (KART.charge[1] - KART.charge[0])) : Math.min(0.5, (k.driftT / KART.charge[0]) * 0.5);
      e.drift.style.transform = `scaleX(${f.toFixed(3)})`;
      e.driftBox.className = `mk-drift${k.drifting ? ' on' : ''}${k.level === 1 ? ' l1' : k.level === 2 ? ' l2' : ''}`;
      e.tow.classList.toggle('on', k.draft > 0.3);
      e.help.classList.toggle('off', go > 9);
    }
    // the map, a few times a second
    if (t < this.mapT) return;
    this.mapT = t + 0.08;
    const c = this.map;
    c.clearRect(0, 0, 340, 340);
    c.drawImage(this.mapBase, 0, 0);
    const all = this.beans();
    all.forEach((r, i) => {
      if (r.out && !r.fin) return;
      const k = this.sims[i].kart, [x, y] = this.toMap(k.pos.x, k.pos.z), me = r.c.player;
      c.beginPath();
      c.arc(x, y, me ? 10 : 6.5, 0, 7);
      c.fillStyle = `#${(r.c.outfit.a & 0xffffff).toString(16).padStart(6, '0')}`;
      c.fill();
      c.lineWidth = me ? 4 : 2;
      c.strokeStyle = me ? '#ffffff' : 'rgba(10,12,30,0.8)';
      c.stroke();
    });
  }
}

function lapTime(s: number) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

const probeCam = { i: 0, s: 0, lat: 0, h: 0, nx: 0, ny: 1, nz: 0, mat: 0, wl: 9, wr: 9, lx: 1, ly: 0, lz: 0 };
