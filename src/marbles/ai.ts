import * as THREE from 'three';
import { courseAI, hzDist, type CourseAI } from './ai-course.ts';
import { PlateBrain } from './ai-plate.ts';
import type { Course } from './courses.ts';
import { GRAVITY, JUMP_V, RADIUS, type Marble } from './physics.ts';

/**
 * The other contestants. A bot drives a racing line worked out from the course (a rubber band
 * pulled tight between the walls) at the speed each point of it allows, braking for the bends and
 * drops ahead and carrying speed where it's safe. About ten times a second it plays its next 1.6 s
 * forward for a spread of lines across the chute, each flat out, easing off or stopping: it asks
 * every obstacle there where it will be at each moment of that run, whether there's floor under
 * it (gaps, holes, a turntable, a platform that comes and goes), and where the others will be, and
 * takes the cheapest — so it threads a hammer's swing, picks the open door, waits for a slider and
 * hops a low sweeper when hopping is what clears it. Steering is every frame: a held line with its
 * sideways speed damped (no weaving off a beam), a feed-forward into the bend. It runs up to a gap
 * at the speed that clears it and hops at the lip; it dashes on a clear straight, to finish, to get
 * out of a scrum, and (an aggressive one) into a rival who's nearer an open edge than it is.
 * Its mistakes shrink with skill: a misjudged clock on the obstacles, a slower glance ahead, a
 * looser line and less pace, corners taken a bit hot, the odd lapse of concentration.
 * On the plate (survival) it hands over to PlateBrain.
 */

const TMP = new THREE.Vector3();
const PT = new THREE.Vector3();
/** a run's horizon (s) and the metres between its predicted points */
const HORIZON = 1.6;
const STEP_M = 0.8;
/** easing off: the speed it picks its way through at */
const EASE = 8;
const MAX_O = 24;
/** the others near me at think time: position, velocity */
const OX = new Float32Array(MAX_O * 6);
/** per run: the nearest each obstacle came (and when) */
let HMIN = new Float32Array(64);
let HDISC = new Float32Array(64);
let HV = new Float32Array(64);
const TOUCHED: number[] = [];
/** think's flat-out candidates (lateral, cost) */
const CAND = 16;
const CL = new Float32Array(CAND);
const CC = new Float32Array(CAND);

export class Bot {
  hint = 0;
  private rnd: () => number;
  // personality
  private aggr: number;
  private bias: number;
  // what skill buys
  private pace: number;
  private cornerK: number;
  private lineUse: number;
  private thinkDt: number;
  private tSigma: number;
  private margin: number;
  private jumpSigma: number;
  private dashUse: number;
  private react: number;
  /** the fastest it dares go, downhill or not */
  private nerve: number;
  // the plan
  private latT = 0;
  /** the plan's offset from (this bot's share of) the racing line */
  private dL = 0;
  private rHit = 0;
  private mode = 0;
  private jumpAt = Infinity;
  private planHit = 0;
  private nextThink = 0;
  private tErr = 0;
  private hot = 0;
  private lapseEnd = 0;
  private jErr = 0;
  private stuckT = 0;
  private sMark = 0;
  private sMarkT = 0;
  private plate: PlateBrain | null = null;
  /** riding round the outside wall of a bend too fast to hold the line in */
  private riding = false;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    seed: number,
  ) {
    let s = (seed * 9301 + 49297) % 2147483647;
    if (s <= 0) s += 2147483646;
    this.rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const k = skill;
    this.aggr = this.rnd();
    this.bias = (this.rnd() - 0.5) * 0.8;
    this.pace = 0.86 + 0.14 * k;
    this.cornerK = 0.62 + 0.38 * k;
    this.lineUse = 0.35 + 0.65 * k;
    this.thinkDt = 0.07 + (1 - k) * 0.16;
    this.tSigma = 0.02 + (1 - k) * 0.4;
    this.margin = 0.12 + (1 - k) * 0.45;
    this.jumpSigma = 0.004 + (1 - k) * 0.07;
    this.dashUse = Math.max(0, (k - 0.35) / 0.62) ** 1.5;
    this.react = 0.03 + (1 - k) * (0.1 + this.rnd() * 0.3);
    this.nerve = 12 + 16 * k;
    this.newJumpErr();
  }

  private gauss() {
    return (this.rnd() + this.rnd() + this.rnd() - 1.5) * 1.15;
  }
  private newJumpErr() {
    this.jErr = this.gauss() * this.jumpSigma;
  }

  reset(hint: number) {
    this.hint = hint;
    this.latT = 0;
    this.dL = 0;
    this.mode = 0;
    this.jumpAt = Infinity;
    this.nextThink = 0;
    this.stuckT = 0;
    this.sMarkT = 0;
  }

  update(dt: number, t: number, c: Course, all: Marble[]) {
    const m = this.m;
    // (the course's analysis: worked out on the first look, while the field waits at the gate)
    if (c.path) courseAI(c);
    // (before the start the menu's attract mode moves them, if anything does)
    if (t < c.state.go) return;
    m.input.set(0, 0, 0);
    if (!m.active || m.frozen) return;
    if (c.plate) {
      this.plate ??= new PlateBrain(m, this.skill, this.rnd, this.aggr);
      return this.plate.update(dt, t, c, all);
    }
    if (t < c.state.go + this.react) return;
    const A = courseAI(c);
    const path = A.path;
    const pr = path.project(m.pos, this.hint, 40);
    this.hint = pr.i;
    const s = pr.s, lat = pr.lat, i = pr.i;
    // the frame here, flattened (the input is a horizontal direction)
    const T = path.T[i], R = path.Rt[i];
    const tl = Math.hypot(T.x, T.z) || 1, rl = Math.hypot(R.x, R.z) || 1;
    const tx = T.x / tl, tz = T.z / tl, rx = R.x / rl, rz = R.z / rl;
    const vAlong = m.vel.x * tx + m.vel.z * tz;
    const vLat = m.vel.x * rx + m.vel.z * rz;
    // over the line: roll to a stop
    if (s > A.finishS + 1.5) {
      m.input.set(-m.vel.x, 0, -m.vel.z).multiplyScalar(0.25);
      if (m.input.lengthSq() > 1) m.input.normalize();
      return;
    }
    const lapse = t < this.lapseEnd;
    if (!lapse && this.rnd() < (1 - this.skill) ** 2 * dt * 0.22) this.lapseEnd = t + 0.4 + this.rnd() * 0.6;
    if (t >= this.nextThink && !lapse) {
      // (nothing ahead but chute and nobody near: a glance now and then will do)
      const busy = this.think(t, A, s, lat, vAlong, vLat, m.groundT < 0.08, all);
      this.nextThink = t + (busy ? this.thinkDt : Math.max(this.thinkDt, 0.22)) * (0.8 + this.rnd() * 0.4);
    }
    // ---- the line: where to be a moment ahead, and the sideways speed to get there (damped)
    const look = Math.max(1.5, vAlong * 0.25);
    const iL = A.index(s + look);
    let latGoal = THREE.MathUtils.clamp(A.line[iL] * this.lineUse + this.dL, A.lo[iL], A.hi[iL]);
    const open = A.openL[i] || A.openR[i];
    const kp = open ? 2.6 : 2.2;
    const iK = A.index(s + vAlong * 0.12);
    const kap = A.kap[iK];
    // too fast for the line through this bend: don't fight it, ride the outside wall round
    const need = Math.abs(kap) * vAlong * vAlong;
    this.riding = !Number.isNaN(A.ride[iK]) && need > A.hold[iK] * (this.riding ? 0.85 : 1.1);
    if (this.riding) latGoal = A.ride[iK];
    const vlWant = THREE.MathUtils.clamp((latGoal - lat) * kp, -6, 6);
    // (the bend's pull, less what the banking gives for free)
    const ff = THREE.MathUtils.clamp(kap * vAlong * Math.abs(vAlong) - GRAVITY * Math.sin(path.sec[iK].bank), -13, 13);
    let aLat = (vlWant - vLat) * (open ? 5 : 4) + (this.riding ? 0 : ff);
    // ---- the speed: the profile (braking for what's ahead), or easing off / stopping for the plan
    let vT = Math.min(this.nerve, A.vcap[A.index(s + 1 + vAlong * 0.1)] * (this.cornerK + this.hot));
    if (this.mode === 1) vT = Math.min(vT, EASE);
    else if (this.mode === 2) vT = 0;
    // a jump ahead: run up at the speed that clears it, straight, and hop at the lip
    const J = this.nextJump(A, s);
    let jumping = false;
    if (J && s > J.s0 - 26 && s < J.s1) {
      jumping = true;
      if (s < J.s0) vT = Math.max(vT, J.vNeed + 3);
      const lead = vAlong * (1 / 60 + this.jErr) + 0.25;
      // (at the lip, or on a kicker that's bouncing me: the last touch may be this one)
      const lip = m.groundT < 0.12 && s + lead >= J.s0 && s < J.s0 + 1.2;
      const bounce = m.groundT < 0.02 && s > J.s0 - 1.6 && s < J.s0;
      if (lip || bounce) {
        m.jump = true;
        this.newJumpErr();
      }
    }
    let fwd: number;
    if (vAlong < vT - 0.3) fwd = vT > 30 ? 1 : THREE.MathUtils.clamp((vT - vAlong) * 0.9, 0.25, 1);
    else if (vAlong > vT + 0.4) fwd = -THREE.MathUtils.clamp((vAlong - vT) * 0.4, 0, 1);
    else fwd = this.mode === 2 ? 0 : 0.15;
    let inLat = aLat / 13;
    if (Math.abs(inLat) > 1) inLat = Math.sign(inLat);
    if (fwd * fwd + inLat * inLat > 1) fwd = Math.sign(fwd) * Math.sqrt(Math.max(0, 1 - inLat * inLat));
    const k = fwd > 0 ? this.pace : 1;
    m.input.set((tx * fwd + rx * inLat) * k, 0, (tz * fwd + rz * inLat) * k);
    // ---- a planned hop (over a low arm, a roller, a fin)
    if (this.jumpAt <= t + dt * 0.5) {
      if (m.groundT < 0.12) m.jump = true;
      this.jumpAt = Infinity;
    }
    // ---- dashes
    if (m.dashCD <= 0 && m.grounded && !lapse && this.mode === 0) {
      const aligned = Math.abs(vLat) < 3 && (!open || Math.abs(latGoal - lat) < 0.7);
      const finish = s > A.finishS - 45;
      // (the speed profile is already braked back from every bend: under it here, a dash is free speed)
      const room = Math.min(A.vcap[A.index(s + 1.5)], A.vcap[A.index(s + 5)]) * this.cornerK;
      const straight = Math.abs(A.kap[A.index(s + 4)]) < 0.035 && Math.abs(A.kap[A.index(s + 10)]) < 0.05;
      const runUp = jumping && s < J!.s0 && vAlong < J!.vNeed + 2;
      const clear = this.planHit < 0.05 && Math.min(room, this.nerve) > vAlong + 7 - 6 * this.skill && straight && !(jumping && !runUp);
      if (aligned && (clear || runUp || (finish && room > vAlong + 4)) && this.rnd() < this.dashUse * dt * (finish || runUp ? 12 : 4)) {
        m.input.set(tx, 0, tz).addScaledVector(TMP.set(rx, 0, rz), THREE.MathUtils.clamp((latGoal - lat) * 0.15, -0.2, 0.2)).normalize();
        m.dash = true;
      } else if (open && this.aggr * this.skill > 0.3) this.barge(dt, A, i, lat, tx, tz, rx, rz, all);
    }
    // ---- stuck (not waiting on purpose): hop, dash, go
    const slow = m.vel.lengthSq() < 0.6 * 0.6 && this.mode !== 2;
    this.stuckT = slow ? this.stuckT + dt : Math.max(0, this.stuckT - dt * 2);
    if (t - this.sMarkT > 2.5) {
      if (this.sMarkT > 0 && s - this.sMark < 1.5 && this.mode !== 2) this.stuckT = Math.max(this.stuckT, 0.9);
      this.sMark = s;
      this.sMarkT = t;
    }
    if (this.stuckT > 0.8) {
      m.jump = true;
      m.input.set(tx, 0, tz).addScaledVector(TMP.set(rx, 0, rz), THREE.MathUtils.clamp(-lat * 0.3, -0.6, 0.6)).normalize();
      m.dash = true;
      this.stuckT = 0;
      this.nextThink = 0;
    }
  }

  private nextJump(A: CourseAI, s: number) {
    for (const j of A.jumps) if (s < j.s1) return j;
    return null;
  }

  /** a shove: a rival beside me, nearer an open edge than I am */
  private barge(dt: number, A: CourseAI, i: number, lat: number, tx: number, tz: number, rx: number, rz: number, all: Marble[]) {
    const m = this.m;
    if (this.rnd() > this.aggr * dt * 3) return;
    for (const o of all) {
      if (o === m || !o.active || o.frozen) continue;
      const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z, dy = o.pos.y - m.pos.y;
      if (Math.abs(dy) > 1) continue;
      const ds = dx * tx + dz * tz, dl = dx * rx + dz * rz;
      if (Math.abs(ds) > 1.3 || Math.abs(dl) < 0.9 || Math.abs(dl) > 2.4) continue;
      const side = Math.sign(dl);
      if (!(side < 0 ? A.openL[i] : A.openR[i])) continue;
      // (me safely inside after it)
      if (side * lat > (side < 0 ? -A.lo[i] : A.hi[i]) - 1.2) continue;
      m.input.set(dx, 0, dz).normalize();
      m.dash = true;
      return;
    }
  }

  // ------------------------------------------------------------------------------ the plan
  private think(t: number, A: CourseAI, s: number, lat: number, vAlong: number, vLat: number, grounded: boolean, all: Marble[]) {
    const m = this.m;
    // this bot's sense of the obstacles' clock drifts (a good one's barely)
    this.tErr = this.tErr * 0.85 + this.gauss() * this.tSigma * 0.55;
    this.hot = this.hot * 0.9 + this.gauss() * (1 - this.skill) * 0.05;
    // the others near enough to matter
    let no = 0;
    const T0 = A.path.T[A.index(s)];
    const reach = Math.max(vAlong, 4) * 1.15 + 3;
    for (const o of all) {
      if (o === m || !o.active || no >= MAX_O) continue;
      const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z;
      const ahead = dx * T0.x + dz * T0.z;
      if (ahead < -3 || ahead > reach || dx * dx + dz * dz > reach * reach || Math.abs(o.pos.y - m.pos.y) > 4) continue;
      const k = no++ * 6;
      OX[k] = o.pos.x, OX[k + 1] = o.pos.y, OX[k + 2] = o.pos.z;
      const f = o.frozen ? 0 : 1;
      OX[k + 3] = o.vel.x * f, OX[k + 4] = 0, OX[k + 5] = o.vel.z * f;
    }
    const sLook = s + THREE.MathUtils.clamp(vAlong * 0.6, 3, 9);
    const iL = A.index(sLook);
    const lo = A.lo[iL], hi = A.hi[iL];
    const lineL = A.line[iL] * this.lineUse + this.bias * (hi - lo) * 0.08;
    const N = 9;
    let best = this.latT, bestM = 0, bestC = Infinity, bestHit = 0;
    let tried = 0;
    const tryOne = (L: number, mode: number, jd: number) => {
      const cost = this.run(t, A, s, lat, vAlong, vLat, L, mode, jd, grounded, no, lineL);
      // a line nearer the racing line and the current plan is worth a little
      const c = cost + 0.02 * Math.abs(L - lineL) + 0.05 * Math.abs(L - this.latT) + (mode === this.mode ? 0 : 0.03) + (jd >= 0 ? 0.05 : 0) + this.rnd() * (1 - this.skill) * 0.15;
      if (mode === 0 && jd < 0 && tried < CAND) (CL[tried] = L), (CC[tried++] = c);
      if (c < bestC) {
        bestC = c;
        best = L;
        bestM = mode;
        bestHit = this.rHit;
        return true;
      }
      return false;
    };
    // flat out: a spread across the chute, the racing line, the current plan
    for (let k = 0; k < N; k++) tryOne(lo + ((hi - lo) * k) / (N - 1), 0, -1);
    tryOne(THREE.MathUtils.clamp(lineL, lo, hi), 0, -1);
    tryOne(THREE.MathUtils.clamp(this.latT, lo, hi), 0, -1);
    // something in the way of every one: easing off or stopping on the three most promising
    if (bestHit >= 0.02) {
      for (let r = 0; r < 3; r++) {
        let bi = -1;
        for (let k = 0; k < tried; k++) if (CC[k] < Infinity && (bi < 0 || CC[k] < CC[bi])) bi = k;
        if (bi < 0) break;
        CC[bi] = Infinity;
        tryOne(CL[bi], 1, -1);
        tryOne(CL[bi], 2, -1);
      }
    }
    // finer, round the best
    const bm = bestM;
    for (const d of [-0.7, -0.35, 0.35, 0.7]) tryOne(THREE.MathUtils.clamp(best + d, lo, hi), bm, -1);
    // still hitting something: would a hop clear it?
    let jd = -1;
    if (bestHit > 0.25 && grounded) {
      const lats = [best, THREE.MathUtils.clamp(lineL, lo, hi), lat];
      for (const L of lats)
        for (const d of [0, 0.1, 0.2, 0.3, 0.45])
          if (tryOne(L, 0, d)) jd = d;
      if (bestM !== 0) jd = -1;
    }
    this.latT = best;
    this.dL = best - lineL;
    this.mode = bestM;
    this.planHit = bestHit;
    this.jumpAt = jd >= 0 ? t + jd + this.gauss() * this.jumpSigma : Infinity;
    return no > 0 || !A.quiet(s, s + Math.max(vAlong, 6) * HORIZON + 4);
  }

  /** one run of the next 1.6 s: toward lateral L (held along the racing line), at a mode, maybe a hop */
  private run(t: number, A: CourseAI, s0: number, lat0: number, v0: number, vl0: number, L: number, mode: number, jd: number, grounded: boolean, no: number, lineL: number) {
    const path = A.path;
    let s = s0, lat = lat0, vs = Math.max(0, v0), vl = vl0, z = 0, vz = 0, jumped = false;
    if (!grounded) {
      const pr = this.m.pos;
      z = Math.max(0, pr.y - path.at(s0, lat0, RADIUS, PT).y);
      vz = this.m.vel.y;
    }
    const te = t + this.tErr;
    const dL = L - lineL;
    // (a jump on the way is the run-up's business: taken at speed, it's floor)
    const gap = this.nextJump(A, s0);
    const top = 14.5 * this.pace;
    let cost = 0, hit = 0, tau = 0;
    const margin = this.margin;
    if (HMIN.length < A.hz.length) (HMIN = new Float32Array(A.hz.length * 2)), (HDISC = new Float32Array(A.hz.length * 2)), (HV = new Float32Array(A.hz.length * 2));
    TOUCHED.length = 0;
    while (tau < HORIZON) {
      const dt = THREE.MathUtils.clamp(STEP_M / Math.max(vs, 1), 0.045, 0.12);
      tau += dt;
      const i = A.index(s);
      const disc = 1 - (0.4 * tau) / HORIZON;
      // speed
      if (z <= 0) {
        let vT = Math.min(this.nerve, A.vcap[A.index(s + 1)] * (this.cornerK + this.hot));
        if (mode === 1) vT = Math.min(vT, EASE);
        else if (mode === 2) vT = 0;
        const g = GRAVITY * A.fall[i];
        if (vs < vT) vs = Math.min(vT, vs + ((vs < top ? 12 : 0) + g) * dt);
        else vs = Math.max(vT, vs - Math.max(2, 11 - g) * dt);
        if (vs < 0) vs = 0;
      }
      // sideways: toward the line held at L
      const ii = A.index(s);
      let latCmd = THREE.MathUtils.clamp(A.line[ii] * this.lineUse + dL, A.lo[ii], A.hi[ii]);
      if (!Number.isNaN(A.ride[ii]) && Math.abs(A.kap[ii]) * vs * vs > A.hold[ii] * 1.1) latCmd = A.ride[ii];
      const vlDes = THREE.MathUtils.clamp((latCmd - lat) * 2.4, -6, 6);
      vl += THREE.MathUtils.clamp((vlDes - vl) * 4.5 * dt, -13 * dt, 13 * dt);
      lat += vl * dt;
      s += vs * dt;
      // a hop
      if (jd >= 0 && !jumped && tau >= jd && z <= 0) {
        vz = JUMP_V;
        jumped = true;
      }
      if (z > 0 || vz > 0) {
        z += vz * dt;
        vz -= GRAVITY * dt;
        if (z <= 0) (z = 0), (vz = 0);
      }
      // the floor: off an open edge, or nothing underneath
      if (z <= 0.05 && !(gap && s > gap.s0 - 0.5 && s < gap.s1 + 0.6 && vs > gap.vNeed * 0.9)) {
        const j = A.index(s);
        const off = (lat < A.lo[j] - 0.75 && A.openL[j]) || (lat > A.hi[j] + 0.75 && A.openR[j]);
        if (off || !A.supported(s, lat, te + tau)) {
          cost += 5 * disc;
          break;
        }
      }
      // the obstacles, where they'll be then
      const ids = A.hazardsAt(s);
      if (ids.length) {
        let p: THREE.Vector3 | null = null;
        for (let q = 0; q < ids.length; q++) {
          const h = A.hz[ids[q]];
          if (s < h.s0 || s > h.s1 || lat < h.l0 || lat > h.l1) continue;
          p ??= path.at(s, lat, RADIUS + z, PT);
          const d = hzDist(h, te + tau, p.x, p.y, p.z) - RADIUS;
          if (d >= margin) continue;
          const id = ids[q];
          if (!TOUCHED.includes(id)) TOUCHED.push(id), (HMIN[id] = d), (HDISC[id] = disc), (HV[id] = vs);
          else if (d < HMIN[id]) (HMIN[id] = d), (HDISC[id] = disc), (HV[id] = vs);
        }
      }
      // the others, carried on as they're going
      if (tau < 1.1 && no) {
        const p = path.at(s, lat, RADIUS + z, PT);
        for (let k = 0; k < no; k++) {
          const o = k * 6;
          const dx = OX[o] + OX[o + 3] * tau - p.x, dy = OX[o + 1] - p.y, dz = OX[o + 2] + OX[o + 5] * tau - p.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 1.3 * 1.3) cost += (1.3 - Math.sqrt(d2)) * (A.openL[i] || A.openR[i] ? 0.35 : 0.12) * disc * (dt / 0.05);
        }
      }
    }
    // (all in seconds lost) each obstacle touched: how squarely, how fast, and how bad that one is
    // (a glance off a peg at a jog costs little; a head-on one flat out stops you dead)
    for (const id of TOUCHED) {
      const d = HMIN[id], h = A.hz[id];
      const speed = (h.k.pose || h.k.kick > 0 ? Math.max(HV[id], 8) : HV[id]) / 12;
      hit += (d < 0 ? 0.3 + Math.min(1, -d / 0.4) * 1.2 : 0.25 * (1 - d / margin)) * h.w * HDISC[id] * speed;
    }
    cost += hit;
    // progress: how far this run got, and the speed it's left with
    cost -= (s - s0) / 13;
    cost += Math.max(0, Math.min(A.vcap[A.index(s)], 14) - vs) / 24;
    this.rHit = hit;
    return cost;
  }
}
