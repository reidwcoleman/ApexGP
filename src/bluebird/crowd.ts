// Bluebird: the visiting skiers you can see. Each one walks from the car park, stands in a lift line,
// rides a real chair, picks a trail it can handle, carves down it (wearing the snow as it goes), and
// eventually heads for lunch or home. How many there are follows the sim's crowd.
import * as THREE from 'three';
import { Mountain, RUNS, LIFTS, NODE_POS, BUILD_SPOTS, type NodeId, type RunPath } from './mountain.ts';
import type { Sim } from './sim.ts';
import type { Lift, Lifts, Rider } from './lifts.ts';
import { skierGeo, JACKETS, type Pose } from './people.ts';
import type { World } from './world.ts';

type State = 'walk' | 'queue' | 'ride' | 'ski' | 'lodge' | 'leave' | 'gone';

class Agent implements Rider {
  st: State = 'walk';
  x = 0; y = 0; z = 0; yaw = 0; lean = 0; pitch = 0;
  tx = 0; tz = 0; // walk target
  lift: Lift | null = null;
  chair = -1; seat = 0;
  run: RunPath | null = null;
  s = 0; lat = 0; phase = 0; amp = 4; v = 8; turnF = 0.5;
  skill: number;
  color: number;
  timer = 0;
  speedK: number;
  trackT = 0;
  constructor(public c: Crowd, public id: number) {
    const r = Math.random();
    this.skill = r < 0.3 ? 0 : r < 0.75 ? 1 : 2;
    this.color = JACKETS[(Math.random() * JACKETS.length) | 0];
    this.speedK = 0.85 + Math.random() * 0.3;
  }
  boarded(l: Lift, chair: number, seat: number) { this.st = 'ride'; this.lift = l; this.chair = chair; this.seat = seat; }
  unload(l: Lift) {
    this.lift = null; this.chair = -1;
    this.x = l.unloadPt.x; this.z = l.unloadPt.z;
    this.c.atNode(this, l.def.to, true);
  }
}

export class Crowd {
  agents: Agent[] = [];
  private nextId = 1;
  private meshes: Record<Pose, { j: THREE.InstancedMesh; r: THREE.InstancedMesh }>;
  private M = new THREE.Matrix4();
  private Q = new THREE.Quaternion();
  private E = new THREE.Euler(0, 0, 0, 'YXZ');
  private P = new THREE.Vector3();
  private F = new THREE.Vector3();
  private col = new THREE.Color();
  static MAX = 340;

  constructor(private w: World, private m: Mountain, private sim: Sim, private lifts: Lifts) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    const mk = (pose: Pose) => {
      const g = skierGeo(pose);
      const j = new THREE.InstancedMesh(g.jacket, mat, Crowd.MAX);
      const r = new THREE.InstancedMesh(g.rest, mat, Crowd.MAX);
      j.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Crowd.MAX * 3), 3);
      for (const im of [j, r]) { im.count = 0; im.frustumCulled = false; im.castShadow = true; w.scene.add(im); }
      return { j, r };
    };
    this.meshes = { ski: mk('ski'), sit: mk('sit'), stand: mk('stand') };
  }

  target() {
    const on = this.sim.onMountain;
    if (on <= 0.5) return 0;
    return Math.min(Crowd.MAX, Math.round(6 + on * 0.32));
  }

  private spawn() {
    const a = new Agent(this, this.nextId++);
    a.x = -90 + Math.random() * 290; a.z = 498 + Math.random() * 22;
    a.y = this.m.at(a.x, a.z);
    this.agents.push(a);
    this.atNode(a, 'base', false);
  }

  /** an agent arrives somewhere: decide what's next */
  atNode(a: Agent, node: NodeId, fromLift: boolean, skipLodge = false) {
    const sim = this.sim;
    const tooMany = this.agents.length > this.target() + 2;
    if (node === 'base' && !fromLift) {
      if (tooMany || !sim.isOpen) { this.goLeave(a); return; }
      const h = sim.hour;
      if (!skipLodge && Math.random() < 0.28 * Math.exp(-(((h - 12.3) / 1) ** 2)) && sim.lv('lodge')) { a.st = 'lodge'; [a.tx, a.tz] = BUILD_SPOTS.lodge; a.tz += 12; a.timer = 20 + Math.random() * 40; return; }
    }
    // runs from here
    const runs = RUNS.filter((r) => r.from === node && sim.runOpen(r.id) && this.okFor(a, r.diff));
    // lifts from here
    const lifts = LIFTS.filter((l) => l.from === node && sim.liftBuilt(l.id) && (l.kind !== 'carpet' || a.skill === 0 || Math.random() < 0.15) && this.liftOk(a, l.id));
    if (fromLift || (node !== 'base' && runs.length && (!lifts.length || Math.random() < (node === 'mid' ? 0.45 : 1)))) {
      if (runs.length) { this.startRun(a, runs[(Math.random() * runs.length) | 0].id); return; }
      // nothing to ski: ride back down isn't modelled; walk to the nearest run instead
      const any = RUNS.filter((r) => r.from === node && sim.runBuilt(r.id));
      if (any.length) { this.startRun(a, any[0].id); return; }
    }
    if (!lifts.length || !sim.isOpen) { if (node === 'base') this.goLeave(a); else if (runs.length) this.startRun(a, runs[0].id); else this.goLeave(a); return; }
    // shortest line, with a taste for the bigger lifts
    let best = lifts[0], bs = Infinity;
    for (const l of lifts) {
      const lift = this.lifts.by[l.id];
      const pref = l.kind === 'carpet' ? (a.skill === 0 ? -6 : 20) : l.id === 'gondola' ? -4 : l.id === 'ridge' ? (a.skill === 2 ? -3 : 30) : 0;
      const sc = lift.queue.length + pref + Math.random() * 6 + (sim.broken[l.id] ? 8 : 0);
      if (sc < bs) { bs = sc; best = l; }
    }
    const lift = this.lifts.by[best.id];
    a.lift = lift;
    a.st = 'walk';
    a.tx = lift.loadPt.x - lift.dir.x * 6; a.tz = lift.loadPt.z - lift.dir.y * 6;
  }

  private okFor(a: Agent, diff: string) {
    if (a.skill === 0) return diff === 'green';
    if (a.skill === 1) return diff !== 'black' && diff !== 'double';
    return true;
  }
  private liftOk(a: Agent, id: string) {
    const to = LIFTS.find((l) => l.id === id)!.to;
    // only ride where there's something you can ski down
    return RUNS.some((r) => r.from === to && this.sim.runBuilt(r.id) && (this.okFor(a, r.diff) || a.skill > 0));
  }

  private startRun(a: Agent, id: string) {
    const p = this.m.runOf[id];
    a.run = p; a.st = 'ski';
    a.s = 0; a.lat = (Math.random() - 0.5) * p.def.w * 0.4;
    a.phase = Math.random() * 6.28;
    a.amp = Math.min(p.def.w / 2 - 2, [7, 5, 3.5][a.skill] + Math.random() * 3);
    a.turnF = [0.32, 0.45, 0.62][a.skill] * (0.8 + Math.random() * 0.4);
    const base = { green: 6.5, blue: 9, black: 10.5, double: 10, park: 8.5 }[p.def.diff];
    a.v = base * [0.75, 1, 1.25][a.skill] * a.speedK;
  }

  private goLeave(a: Agent) { a.st = 'leave'; a.tx = Math.max(-90, Math.min(200, a.x + (Math.random() - 0.5) * 40)); a.tz = 512 + Math.random() * 10; }

  update(dt: number) {
    const sim = this.sim;
    const want = this.target();
    { const gap = want - this.agents.length; if (gap > 0) { const n = Math.min(gap, Math.random() < dt * (4 + gap * 0.25) ? 1 + Math.floor(gap / 40) : 0); for (let i = 0; i < n; i++) this.spawn(); } }
    const P = this.P;
    for (const a of this.agents) {
      switch (a.st) {
        case 'walk':
        case 'leave':
        case 'lodge': {
          const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
          const sp = a.st === 'walk' ? 3.2 : 2.2;
          if (d > 0.6) { a.x += (dx / d) * sp * dt; a.z += (dz / d) * sp * dt; a.yaw = Math.atan2(dx, dz); }
          else if (a.st === 'walk' && a.lift) { a.st = 'queue'; a.lift.enqueue(a); }
          else if (a.st === 'leave') a.st = 'gone';
          else if (a.st === 'lodge') { a.timer -= dt; if (a.timer < 0) { a.st = 'walk'; this.atNode(a, 'base', false, true); } }
          a.y = this.m.at(a.x, a.z);
          break;
        }
        case 'queue': {
          const l = a.lift!;
          const i = l.queue.indexOf(a);
          if (i < 0) { if (a.st === 'queue') this.atNode(a, 'base', false); break; }
          l.queueSlot(i, P);
          const dx = P.x - a.x, dz = P.z - a.z, d = Math.hypot(dx, dz);
          if (d > 0.1) { const st = Math.min(d, 2.4 * dt); a.x += (dx / d) * st; a.z += (dz / d) * st; }
          a.yaw = Math.atan2(l.dir.x, l.dir.y);
          a.y = this.m.at(a.x, a.z);
          // give up on hopeless lines
          if (i > 60 && Math.random() < dt * 0.02) { l.leaveQueue(a); this.atNode(a, 'base', false); }
          break;
        }
        case 'ride': {
          const l = a.lift!;
          l.seatPos(a.chair, a.seat, P, this.F);
          a.x = P.x; a.y = P.y; a.z = P.z;
          a.yaw = Math.atan2(this.F.x, this.F.z);
          break;
        }
        case 'ski': {
          const p = a.run!;
          a.phase += dt * a.turnF * Math.PI * 2 * (a.v / 9);
          const latT = Math.sin(a.phase) * a.amp + Math.sin(a.phase * 0.31 + a.id) * 2;
          const dLat = latT - a.lat;
          a.lat += dLat * Math.min(1, dt * 3);
          const i = this.m.idxAt(p, a.s);
          // slow on steeper bits for beginners, faster on groomers
          const q = sim.runQ[p.def.id] ?? 0.7;
          const v = a.v * (0.75 + q * 0.35);
          a.s += v * dt * Math.cos(Math.atan2(dLat * 3, v));
          const tx = p.tx[i], tz = p.tz[i];
          a.x = p.x[i] - tz * a.lat; a.z = p.z[i] + tx * a.lat;
          a.y = this.m.ground(a.x, a.z);
          const side = Math.cos(a.phase) * a.amp * a.turnF * 2;
          a.yaw = Math.atan2(tx, tz) - Math.atan2(side, v) * 0.9;
          a.lean = Math.max(-0.6, Math.min(0.6, -side * 0.08 * (a.v / 8)));
          a.trackT -= dt;
          if (a.trackT < 0) { a.trackT = 0.25; sim.track(a.x, a.z, 0.0035); }
          if (a.s >= p.len - 2) { a.run = null; a.lean = 0; this.atNode(a, p.def.to, false); }
          break;
        }
      }
    }
    // drop the ones who went home; when the sim wants fewer, the next base arrival leaves
    const gone = this.agents.filter((a) => a.st === 'gone');
    if (gone.length) this.agents = this.agents.filter((a) => a.st !== 'gone');
    // a lift's line at closing: everyone walks off
    if (!sim.isOpen) for (const l of this.lifts.list) for (const a of [...l.queue]) if (a instanceof Agent) { l.leaveQueue(a); this.goLeave(a); }
    this.draw();
  }

  /** for the player's "skiers nearby" camera and tracks */
  near(x: number, z: number, r: number) { return this.agents.filter((a) => (a.st === 'ski') && Math.abs(a.x - x) < r && Math.abs(a.z - z) < r); }

  private draw() {
    const cnt: Record<Pose, number> = { ski: 0, sit: 0, stand: 0 };
    const M = this.M, Q = this.Q, E = this.E, P = this.P;
    const S = new THREE.Vector3(1, 1, 1);
    for (const a of this.agents) {
      if (a.st === 'lodge' && Math.hypot(a.tx - a.x, a.tz - a.z) < 1) continue;
      const pose: Pose = a.st === 'ride' ? (a.lift?.isCarpet ? 'stand' : 'sit') : a.st === 'ski' ? 'ski' : 'stand';
      if (a.st === 'ride' && a.lift?.def.kind === 'gondola') continue; // inside the cabin
      const mm = this.meshes[pose];
      const i = cnt[pose]++;
      E.set(a.st === 'ski' ? 0.05 : 0, a.yaw, a.lean);
      Q.setFromEuler(E);
      P.set(a.x, a.y, a.z);
      M.compose(P, Q, S);
      mm.j.setMatrixAt(i, M);
      mm.r.setMatrixAt(i, M);
      mm.j.setColorAt(i, this.col.setHex(a.color));
    }
    for (const k of Object.keys(cnt) as Pose[]) {
      const mm = this.meshes[k];
      mm.j.count = mm.r.count = cnt[k];
      mm.j.instanceMatrix.needsUpdate = mm.r.instanceMatrix.needsUpdate = true;
      if (mm.j.instanceColor) mm.j.instanceColor.needsUpdate = true;
    }
  }
}

export { NODE_POS };
