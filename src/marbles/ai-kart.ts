import * as THREE from 'three';
import type { KartTrack } from './kart-track.ts';
import type { Racer } from './kart-race.ts';

/**
 * The kart bots. They don't run on rails: a bot has the wheel and the pedals, and the same physics
 * as you, so where it ends up is wherever its driving put it.
 *
 * Every lap each one works out its own lap from scratch. Round each bend it picks an apex (early or
 * late), how much of the road to use, how deep to brake, and how brave to be; along the straights
 * it wanders within the width; the speeds it plans come from the line it actually chose. On top of
 * that it reacts to who's round it (picking a side to pass, leaving room, defending) and it
 * makes mistakes: a late lunge that runs wide, a moment's lost concentration.
 *
 * Skill is how much of the grip it dares to use, how quick its hands are and how often it slips up.
 * Even the best bot leaves time on the table: it doesn't use the drift boost as well as you can
 * and never drives at the limit of the tyres.
 */

interface Corner {
  a: number;
  b: number;
  apex: number;
  dir: number;
}

/** the bends, found from the curvature */
function corners(tr: KartTrack): Corner[] {
  const out: Corner[] = [];
  const n = tr.n, on = (i: number) => Math.abs(tr.curve[tr.idx(i)]) > 0.011;
  let i = 0;
  while (on(i) && i < n) i++;
  const first = i;
  for (let k = 0; k < n; k++) {
    const j = first + k;
    if (!on(j)) continue;
    const a = j;
    let e = j, best = 0, apex = j;
    while (on(e) && e - a < n && Math.sign(tr.curve[tr.idx(e)]) === Math.sign(tr.curve[tr.idx(a)])) {
      const c = Math.abs(tr.curve[tr.idx(e)]);
      if (c > best) {
        best = c;
        apex = e;
      }
      e++;
    }
    k = e - first;
    out.push({ a, b: e, apex, dir: Math.sign(tr.curve[tr.idx(apex)]) });
  }
  return out;
}

export class KartBrain {
  private rnd: () => number;
  /** this lap's line and speeds */
  readonly line: Float32Array;
  readonly plan: Float32Array;
  private bends: Corner[];
  /** how much of the road it's using for traffic, now and wanted */
  private shift = 0;
  private shiftTo = 0;
  private lapSeen = -9;
  private steerNow = 0;
  /** how long it's been going nowhere; it backs out for this long */
  private stall = 0;
  private backT = 0;
  private backDir = 0;
  /** lost concentration until */
  private lapse = 0;
  private think = 0;
  /** where it dives late this lap (a sample) and how badly */
  private lunge = -1;
  private lungeK = 0;
  /** at this bend it'll throw it sideways */
  private drifts = new Set<number>();
  private driftOn = false;
  private react: number;
  private grip: number;
  /** a personality: brave on the brakes, tidy or ragged, likes the outside or the inside */
  private brave: number;
  private rag: number;
  private drifter: number;
  readonly out = { steer: 0, throttle: 0, brake: 0, drift: false };

  constructor(
    readonly me: Racer,
    readonly tr: KartTrack,
    readonly skill: number,
    seed: number,
    private aggr: number,
    boost = 0,
  ) {
    let s = (seed * 9301 + 49297) % 2147483647;
    if (s <= 0) s += 2147483646;
    this.rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    this.line = new Float32Array(tr.n);
    this.plan = new Float32Array(tr.n);
    this.bends = corners(tr);
    this.react = 0.05 + (1 - skill) * 0.16;
    this.grip = 0.84 + 0.17 * skill + boost * 0.07 + (this.rnd() - 0.5) * 0.05;
    this.brave = this.rnd();
    this.rag = (1 - skill) * (0.6 + this.rnd() * 0.8);
    this.drifter = this.rnd() * (0.25 + skill * 0.55);
    this.dream();
  }

  /** a new lap: its own line through every bend, and the speeds that line allows */
  dream() {
    const { tr, rnd, line } = this, n = tr.n;
    // the base line, bent and smoothed by this lap's choices
    const shift = new Float32Array(n), push = new Float32Array(n);
    for (const c of this.bends) {
      // early apex or late; how far from the kerb it stays
      const late = (rnd() - 0.45) * 14 * (0.6 + this.rag);
      const span = c.b - c.a + 30;
      const away = -c.dir * rnd() * (0.6 + this.rag * 2.4);
      for (let k = -span; k <= span; k++) {
        const i = tr.idx(c.apex + k), w = 0.5 + 0.5 * Math.cos((k / span) * Math.PI);
        shift[i] += late * w;
        push[i] += away * w;
      }
    }
    // the drift between bends: slow waves, a new set each lap
    const a1 = 0.6 + rnd() * 1.4, a2 = 0.3 + rnd() * 0.9, f1 = (2 * Math.PI * (2 + Math.floor(rnd() * 4))) / n, f2 = (2 * Math.PI * (5 + Math.floor(rnd() * 7))) / n, p1 = rnd() * 6.28, p2 = rnd() * 6.28;
    for (let i = 0; i < n; i++) {
      const j = i - shift[i], f = j - Math.floor(j), a = tr.idx(Math.floor(j)), b = tr.idx(Math.floor(j) + 1);
      const base = tr.line[a] + (tr.line[b] - tr.line[a]) * f;
      const m = tr.hw[i] - 1.2;
      line[i] = THREE.MathUtils.clamp(base + push[i] + a1 * Math.sin(i * f1 + p1) + a2 * Math.sin(i * f2 + p2), -m, m);
    }
    // (a little smoothing, so no choice makes a kink it can't drive)
    const B = new Float32Array(n);
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let d = -6; d <= 6; d++) s += line[tr.idx(i + d)];
        B[i] = s / 13;
      }
      line.set(B);
    }
    // today's nerve
    const grip = this.grip * (0.97 + rnd() * 0.05);
    tr.speeds(line, grip, 9.5 + this.skill * 3 + this.brave * 1.2, 9, 36, this.plan);
    // one bend per lap or so it overdoes
    this.lunge = -1;
    if (rnd() < 0.18 + this.rag * 0.75) {
      const c = this.bends[Math.floor(rnd() * this.bends.length)];
      this.lunge = c.a;
      this.lungeK = 1.06 + rnd() * 0.1 * (0.5 + this.rag);
    }
    // the tight ones it might throw sideways
    this.drifts.clear();
    this.bends.forEach((c, k) => {
      // (only with room to run wide if it goes wrong)
      const i = tr.idx(c.apex), room = (c.dir > 0 ? tr.wr[i] : tr.wl[i]) - tr.hw[i];
      if (Math.abs(tr.curve[i]) > 0.03 && room > 9 && rnd() < this.drifter) this.drifts.add(k);
    });
  }

  /** the other karts: pick a side, leave room */
  private traffic(all: Racer[], s: number, lat: number, v: number) {
    const { tr, me } = this;
    let want = 0, blocked = 1e9;
    for (const o of all) {
      if (o === me || o.held) continue;
      const q = o.kart.q;
      let ds = q.s - s;
      if (ds > tr.n / 2) ds -= tr.n;
      else if (ds < -tr.n / 2) ds += tr.n;
      if (ds < -7 || ds > 26) continue;
      if (Math.abs(o.kart.pos.y - me.kart.pos.y) > 3) continue;
      const dl = q.lat - lat, ov = o.kart.vel.length();
      if (Math.abs(ds) < 3.4) {
        // alongside: hold a car's width, a brave one a bit less
        if (Math.abs(dl) < 2.7) want += (dl > 0 ? -1 : 1) * (2.7 - Math.abs(dl)) * (1.4 - this.aggr * 0.4);
      } else if (ds > 0 && v > ov - 1.5 && Math.abs(dl) < 2.6) {
        // catching someone: go by, on whichever side the next bend favours, or the side with room
        const nextBend = tr.curve[tr.idx(Math.round(s + 26))];
        const hw = tr.hw[tr.idx(Math.round(s))] - 1.6;
        const roomL = hw - q.lat, roomR = q.lat + hw;
        let side = Math.abs(nextBend) > 0.008 ? Math.sign(nextBend) : roomL > roomR ? 1 : -1;
        if (side > 0 && roomL < 2.7) side = -1;
        else if (side < 0 && roomR < 2.7) side = 1;
        const closing = 1 - ds / 26;
        want += (q.lat + side * 3 - lat) * closing * 0.9;
        if (ds < 6) blocked = Math.min(blocked, ov);
      }
    }
    return { want, blocked };
  }

  drive(dt: number, t: number, all: Racer[], ease: number) {
    const { tr, me, out } = this, k = me.kart;
    const s = k.q.s, lat = k.q.lat, v = k.vel.length();
    if (me.lap !== this.lapSeen) {
      if (this.lapSeen !== -9) this.dream();
      this.lapSeen = me.lap;
    }
    // ---- beached: back out, wheels the other way, and go again
    if (this.backT > 0) {
      this.backT -= dt;
      out.throttle = 0;
      out.brake = 1;
      out.drift = false;
      out.steer = this.backDir;
      return out;
    }
    this.stall = v < 1.6 && t > 0 ? this.stall + dt : 0;
    if (this.stall > 1.1) {
      this.stall = 0;
      this.backT = 1 + this.rnd() * 0.7;
      // (reversing, the wheels go the way you want the tail to go: tail toward the wall, nose out)
      this.backDir = lat > 0 ? 1 : -1;
      return out;
    }
    // ---- who's round me
    if (t >= this.think) {
      this.think = t + 0.06 + this.react * 0.8;
      const { want, blocked } = this.traffic(all, s, lat, v);
      this.shiftTo = THREE.MathUtils.clamp(want, -5.5, 5.5);
      this.blocked = blocked;
      if (this.rnd() < dt * (0.02 + this.rag * 0.09)) this.lapse = t + 0.2 + this.rnd() * 0.45;
    }
    this.shift += (this.shiftTo - this.shift) * Math.min(1, dt * 3.2);
    // ---- where to point it: a spot on my line, as far ahead as I'm quick
    const look = Math.max(4.5, v * 0.42);
    const j = tr.idx(Math.round(s + look));
    const m = tr.hw[j] - 1.1;
    const aim = THREE.MathUtils.clamp(this.line[j] + this.shift, -m, m);
    tr.point(j, aim, 0, P);
    const dx = P.x - k.pos.x, dz = P.z - k.pos.z;
    const ang = Math.atan2(dx * k.ax.x + dz * k.ax.z, dx * k.az.x + dz * k.az.z);
    const want = THREE.MathUtils.clamp(-ang * 3.2, -1, 1);
    // (hands aren't instant, and a tired one saws at the wheel a bit)
    this.steerNow += (want - this.steerNow) * Math.min(1, dt / this.react);
    const lazy = t < this.lapse ? 0.72 : 1;
    out.steer = this.steerNow * lazy + Math.sin(t * 2.3 + this.me.id) * 0.03 * this.rag;
    // ---- how fast: the plan, read a little ahead
    const c = tr.idx(Math.round(s + 2 + v * 0.1));
    let vp = this.plan[c] * (1 - 0.13 * ease);
    // this is the bend it's going in too deep on
    if (this.lunge >= 0) {
      const d = tr.idx(this.lunge - Math.round(s));
      if (d < 26 || d > tr.n - 22) vp *= this.lungeK;
    }
    if (t < this.lapse) vp *= 0.95;
    if (this.driftOn) vp *= 0.9;
    // (not into the back of anyone)
    if (this.blocked < 1e8 && Math.abs(this.shift) < 1.4) vp = Math.min(vp, this.blocked + 0.4);
    // off the road, it's not going to hold the speed it planned
    const edge = Math.abs(lat) - tr.hw[k.q.i];
    if (edge > 1.2) vp = Math.min(vp, 13);
    const e = vp - v;
    out.throttle = e > 0 ? Math.min(1, 0.35 + e * 0.5) : 0;
    out.brake = e < -0.7 ? Math.min(1, -e * 0.55) : 0;
    // a slide it didn't ask for: off the power till the rear comes back
    if (Math.abs(k.beta) > 0.34 && !this.driftOn) out.throttle *= 0.3;
    // ---- the tight bends, for the ones who like that sort of thing
    // (a flick in at the turn-in, off again by the apex and let it snap straight onto the power)
    let sideways = false;
    for (const b of this.drifts) {
      const d = tr.idx(Math.round(s) - this.bends[b].apex + 12);
      if (d < 18) sideways = v > 10;
    }
    if (sideways && !this.driftOn && Math.abs(out.steer) > 0.3) this.driftOn = true;
    else if (this.driftOn && !sideways) this.driftOn = false;
    out.drift = this.driftOn;
    return out;
  }
  private blocked = 1e9;
}
const P = new THREE.Vector3();
