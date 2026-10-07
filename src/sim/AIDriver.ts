import type { Track } from '../world/Track.ts';
import type { Assists, CarPhysics, DriveInput } from './CarPhysics.ts';
import type { RacingProfile } from './RacingProfile.ts';
import type { AILearning, CornerPass, DriverKnowledge } from './AILearning.ts';

/**
 * AI driver. Pure-pursuit steering toward the racing line (plus a lateral
 * offset used for overtaking and avoiding), speed tracking against the
 * precomputed profile, simple racecraft: follow, pick a side, commit, return.
 * With a `know`ledge of the circuit (AILearning) the speeds and braking points
 * are the driver's own, learned corner by corner from how each clean pass went.
 */

export interface Neighbour {
  id: number;
  s: number;
  lateral: number;
  speed: number;
  /** entering the pits / merging from the pit exit on this side of the road (−1 / 1; 0 or absent = racing): give it room */
  pit?: number;
  /** with `pit`: the lateral to keep clear of (a car still in the exit lane: where it will join the road) */
  pitLat?: number;
  /** a stricken car (spun, stopped, retired, crawling): a yellow flag — steer round it, no racing near it */
  hazard?: number;
}

/** metres driven since the mark `m` (NaN: never — Infinity) */
function since(track: Track, m: number, s: number): number {
  return m === m ? track.wrap(s - m) : Infinity;
}

/** curvature (1/m) of the path lat = f(s) through the road at s, from three points 10 m apart */
function pathCurv(track: Track, f: (s: number) => number, s: number): number {
  const n = track.n;
  const at = (ss: number, out: number[]) => {
    const w = ((ss % n) + n) % n;
    const i = Math.floor(w);
    const j = (i + 1) % n;
    const t = w - i;
    const lat = f(ss);
    out[0] = track.px[i] + track.rx[i] * lat + (track.px[j] + track.rx[j] * lat - track.px[i] - track.rx[i] * lat) * t;
    out[1] = track.pz[i] + track.rz[i] * lat + (track.pz[j] + track.rz[j] * lat - track.pz[i] - track.rz[i] * lat) * t;
  };
  at(s - 10, _pa);
  at(s, _pb);
  at(s + 10, _pc);
  const ux = _pb[0] - _pa[0], uz = _pb[1] - _pa[1];
  const wx = _pc[0] - _pb[0], wz = _pc[1] - _pb[1];
  const cx = _pc[0] - _pa[0], cz = _pc[1] - _pa[1];
  const den = Math.hypot(ux, uz) * Math.hypot(wx, wz) * Math.hypot(cx, cz);
  return den > 1e-6 ? (2 * Math.abs(ux * wz - uz * wx)) / den : 0;
}
const _pa = [0, 0];
const _pb = [0, 0];
const _pc = [0, 0];

/** a driver mistake, armed by the race and played out by the driver */
export const MISTAKE = { NONE: 0, LOCKUP: 1, WIDE: 2, SPIN: 3 } as const;
/** a virtual safety car: every car to this share of its racing speed */
export const VSC_SPEED = 0.62;

export class AIDriver {
  /** 0.9..1.0: fraction of the profile speed this driver can carry */
  pace: number;
  /** Dynamic difficulty: a small race-long multiplier on the pace (≈1 ± 0.015), set by the race */
  trim = 1;
  aggression: number;
  offset = 0;
  targetOffset = 0;
  /** seconds from lights out to moving off (the race sets it: good and bad launches) */
  reaction: number;
  /** a bogged launch: seconds of half throttle after moving off */
  bog = 0;
  /** today's rhythm: a slow drift of the pace (±~0.5%) so battles ebb and flow (set by the race) */
  rhythm = 0;
  /** a failing car (mechanical trouble): pace multiplier, 1 = healthy */
  trouble = 1;
  /**
   * Wheel-to-wheel with the player (set by the race every step): `defend` — the player is right
   * behind, so cover the inside into the braking zones; `attack` — the player is just ahead, so
   * brake later and use the battery to get a run. `push`: the extra pace a driver finds in a fight.
   */
  defend = 0;
  attack = 0;
  push = 1;
  /** the cars this driver is racing for position (set by the race for every car): ahead / behind, −1 = none */
  attackId = -1;
  defendId = -1;
  /** the braking zone this driver last moved to defend (one move per corner) */
  private defendS = NaN;
  private defendSide = 0;
  /** metres past the move that the defence is held (to the apex) */
  private defendEnd = 0;
  /** metres past the move over which the defensive line costs corner speed (a tighter entry, a slower exit) */
  private defendCost = 0;
  /**
   * The next corner, scanned a few times a second from the speed profile: metres to its braking
   * point and to its slowest point (Infinity: flat out for now), and the side of the road its
   * inside is on (−1 / 1; the racing line sits at −sign(κ) at the apex).
   */
  private scanT = 0;
  brakeIn = Infinity;
  apexIn = Infinity;
  inside = 0;
  /** the car the current passing attempt is on, and whether we've already switched sides once (the dummy) */
  private passWith = -1;
  private switched = false;
  /** the corner we last threw it up the inside of (one dice roll for an over-late lunge per corner) */
  private lungeS = NaN;
  /** cutback in progress: seconds left and the car we're crossing behind */
  private cutT = 0;
  private cutWith = -1;
  /** the road a car alongside leaves us: our path stays right of capL and left of capR (±Infinity: free) */
  private capL = -Infinity;
  private capR = Infinity;
  /** a stricken car ahead: metres to it (yellow flag), Infinity = none (read by the tools) */
  yellowIn = Infinity;
  /** virtual safety car: slow to the VSC speed, no overtaking */
  vsc = false;
  /** the mistake in progress (see MISTAKE), whether it has started (0 armed, 1 happening), its clock and severity 0..1 */
  err = 0;
  errOn = 0;
  errT = 0;
  errSev = 0;
  private savedAssists: Assists | null = null;
  /** random numbers (the race hands in its seeded generator) */
  rand: () => number;
  private startTimer = 0;
  private stuckTimer = 0;
  private wobblePhase: number;
  private passSide = 0;
  private passTimer = 0;
  /** true once the race has started for this driver */
  launched = false;
  /** blue flags: side of the road to move to (−1 left, 1 right, 0 = racing) */
  yieldSide = 0;
  /** retired: pull off to this side of the road (−1 / 1) and stop; 0 = racing */
  parkSide = 0;
  /** the grip the driver believes the car has (lags the real thing) */
  gripEst = 1;
  /**
   * What this driver knows of the circuit: per corner, the speed they dare and where they brake,
   * learned from every clean pass (AILearning). null: the bare speed profile (the autopilot, the tools).
   */
  know: DriverKnowledge | null = null;
  /** the field's benchmark through each corner (the fastest clean pass today, anyone's): where there's time to find */
  bench: AILearning | null = null;
  /** learning from each pass (off for the cool-down lap) */
  learnOn = true;
  /**
   * 0 … 1: how long this driver has been in a close fight (attacking or defending within ~half a second).
   * Under pressure they push past what they know (and mistakes come from it); it fades once the fight is over.
   */
  pressure = 0;
  /** seconds stuck behind the same car within a second without a way past (makes them try harder) */
  stuckBehind = 0;
  private stuckWith = -1;
  /** the car ahead in our lane last step, its speed, and its acceleration (smoothed): is it braking harder than we are? */
  private leadId = -1;
  private leadV = 0;
  private leadA = 0;
  /** the corner being driven (learning): its index, whether the pass is clean so far, and what happened in it */
  private lcI = -1;
  private lcClean = false;
  private lcT = 0;
  private lcWide = 0;
  private lcOff = 0;
  private lcEdge = 0;
  private lcSlide = 0;
  private lcGrip = 0;
  private lcOver = 0;
  private lcUnder = 0;
  private lcLock = 0;
  private lcApex = NaN;
  private prevLat = 0;
  readonly input: DriveInput = { throttle: 0, brake: 0, steer: 0, ers: false, shiftUp: false, shiftDown: false };

  constructor(pace: number, aggression: number, rand: () => number = Math.random) {
    this.pace = pace;
    this.aggression = aggression;
    this.rand = rand;
    this.reaction = 0.18 + rand() * 0.08;
    this.wobblePhase = rand() * 100;
  }

  /** make a mistake: armed now, it happens at the next place it can (a braking zone, a corner exit) */
  mistake(kind: number, severity: number) {
    if (this.err !== 0 || this.parkSide !== 0 || this.vsc) return;
    this.err = kind;
    this.errOn = 0;
    this.errT = 0;
    this.errSev = Math.max(0, Math.min(1, severity));
  }

  /**
   * The next corner from the speed profile: the first slow point within reach, the braking point
   * for it (at ~3.7 g average) and the side of the road its inside is on.
   */
  private scan(car: CarPhysics, track: Track, profile: RacingProfile, v: number) {
    const reach = Math.max(220, v * 4.5);
    let vMin = Infinity;
    let dMin = -1;
    for (let d = 10; d <= reach; d += 10) {
      const vp = profile.at(car.s + d);
      if (vp < vMin) {
        vMin = vp;
        dMin = d;
      } else if (vp > vMin + 8) break;
    }
    if (dMin < 0 || vMin > v - 10) {
      this.brakeIn = this.apexIn = Infinity;
      this.inside = 0;
      return;
    }
    this.apexIn = dMin;
    this.brakeIn = dMin - (v * v - vMin * vMin) / (2 * 36);
    let k = 0;
    for (let d = Math.max(0, dMin - 40); d <= dMin + 30; d += 10) {
      const kk = track.kappaAt(car.s + d);
      if (Math.abs(kk) > Math.abs(k)) k = kk;
    }
    this.inside = Math.abs(k) > 1 / 500 ? -Math.sign(k) : 0;
  }

  /** a passing attempt on `o`: into a braking zone the inside if there's a car's width there, else round the outside */
  private choosePassSide(o: Neighbour, hw: number) {
    const roomL = o.lateral + hw;
    const roomR = hw - o.lateral;
    let sd = roomR > roomL ? 1 : -1;
    if (this.inside !== 0 && this.brakeIn < 350) sd = (this.inside > 0 ? roomR : roomL) > 3.2 ? this.inside : -this.inside;
    this.passSide = sd;
    this.passWith = o.id;
    this.switched = false;
    this.passTimer = 2.5 + this.rand();
  }

  /** start from wherever the car is (e.g. a grid slot) and merge onto the line gradually */
  startFrom(car: CarPhysics, track: Track) {
    this.offset = this.targetOffset = car.lateral - track.racingLineAt(car.s);
    // (dropped mid-corner: that pass teaches nothing)
    this.lcI = this.know ? this.know.cornerAt(car.s) : -1;
    this.lcClean = false;
  }

  /** returns true if the car should be reset onto the track */
  update(dt: number, car: CarPhysics, track: Track, profile: RacingProfile, racing: boolean, others: Neighbour[], selfId: number): boolean {
    const inp = this.input;
    if (!racing) {
      inp.throttle = 0;
      inp.brake = 1;
      inp.steer = 0;
      inp.hold = true;
      this.startTimer = 0;
      return false;
    }
    inp.hold = false;
    // taking over a car that's already moving (cool-down lap, pit exit): no launch, no calm start
    if (this.startTimer === 0 && car.vx > 3) this.startTimer = 15;
    this.startTimer += dt;
    if (this.startTimer < this.reaction) {
      inp.throttle = 0.55;
      inp.brake = 0;
      inp.hold = true;
      return false;
    }
    this.launched = true;

    const v = Math.max(0, car.vx);
    const L = car.spec.a + car.spec.b;
    const hw = track.halfWidthAt(car.s);
    // opening seconds: hold station in grid lanes, leave bigger gaps, no dive-bombs
    const calm = Math.max(0, 1 - this.startTimer / 15);

    // ---- the next corner (a few times a second): its braking point and which side its inside is
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.1;
      this.scan(car, track, profile, v);
    }
    // chicanes and hairpins are single file: squeeze back toward the line before a
    // tight corner instead of trying to go round it two abreast
    const vAhead = profile.at(car.s + Math.max(30, v * 1.2));
    const tight = Math.max(0, Math.min(1, (48 - vAhead) / 18));

    // ---- racecraft: traffic ahead / alongside / behind
    let followSpeed = Infinity;
    let blockL = false;
    let blockR = false;
    const myLat = car.lateral;
    // a car diving into the pit entry or merging from the pit exit nearby: leave it that side of the road
    let giveSide = 0;
    let giveLat = 0;
    // the car in our lane ahead, the nearest car behind, the nearest car overlapping us
    let lead: Neighbour | null = null;
    let leadDs = Infinity;
    let chaser: Neighbour | null = null;
    let chaserDs = -Infinity;
    let side: Neighbour | null = null;
    let sideDs = 0;
    // a stricken car ahead: metres to it (the yellow flag) and the lateral to steer round it at (NaN: no need)
    let yellow = Infinity;
    let evadeLat = NaN;
    let evadeDs = Infinity;
    let capL = -Infinity;
    let capR = Infinity;
    for (const o of others) {
      if (o.id === selfId) continue;
      const ds = track.delta(car.s, o.s);
      const dl = o.lateral - myLat;
      if (o.pit && ds > -18 && ds < Math.max(120, (v - o.speed) * 5) && (giveSide === 0 || Math.abs(dl) < Math.abs(giveLat - myLat))) {
        giveSide = -o.pit;
        giveLat = o.pitLat ?? o.lateral;
      }
      // not (yet) clear of it: don't drive through it, sit behind until there's room
      if (o.pit && ds > 0 && ds < 80 && Math.abs(dl) < 2.5) followSpeed = Math.min(followSpeed, o.speed + Math.max(0, ds - 12) * 0.3);
      // alongside: keep a car's width between us
      if (Math.abs(ds) < 6) {
        if (dl > 0 && dl < 2.6) blockR = true;
        if (dl < 0 && dl > -2.6) blockL = true;
        if (Math.abs(dl) < 3.6 && (!side || Math.abs(ds) < Math.abs(sideDs))) {
          side = o;
          sideDs = ds;
        }
      }
      // overlapping: never steer into its space — whatever the line does, our path keeps a car's width
      // from it (side by side through the corner: the inside car takes the apex, the outside car the long
      // way round); no room left on our side and it's ahead: we're the one to back out
      if (Math.abs(ds) < 6.5 && Math.abs(dl) < 4.5 && !o.pit) {
        if (dl > 0) capR = Math.min(capR, o.lateral - 2.6);
        else capL = Math.max(capL, o.lateral + 2.6);
        const squeezed = dl > 0 ? o.lateral - 2.6 < -hw + 1.1 : o.lateral + 2.6 > hw - 1.1;
        // who has the corner: into a slow corner (or a chicane, where two don't fit) the car that is
        // less than half alongside, or round the outside of a tight one, backs out and tucks in behind
        const nearApex = tight > 0.3 || (this.inside !== 0 && this.apexIn < 70);
        const outside = this.inside !== 0 && Math.sign(dl) === this.inside;
        const concede = nearApex && ds > 0 && (ds > 2.5 || (outside && tight > 0.5));
        if ((squeezed && ds > 0.5) || concede) followSpeed = Math.min(followSpeed, o.speed - 1.5);
      }
      // a stricken car ahead (spun, stopped, retired, crawling): yellow flag — steer round it on the
      // side with more road, and if there's no way round, stop behind it. Never a pile-up.
      if (ds > 0 && ds < 320 && !o.pit && Math.abs(o.lateral) < hw + 3 && ((o.hazard ?? 0) > 0 || (calm === 0 && o.speed < 0.45 * profile.at(o.s)))) {
        yellow = Math.min(yellow, ds);
        const reach = 35 + Math.max(0, v * v - o.speed * o.speed) / 40;
        if (ds < reach && Math.abs(dl) < 3.4 && ds < evadeDs) {
          const roomL = o.lateral + hw;
          const roomR = hw - o.lateral;
          const sd = roomR > roomL ? 1 : -1;
          evadeDs = ds;
          evadeLat = Math.max(-hw + 1.2, Math.min(hw - 1.2, o.lateral + sd * 3.4));
          if (Math.max(roomL, roomR) < 3.2) followSpeed = Math.min(followSpeed, Math.max(0, o.speed) + Math.max(0, ds - 9) * 0.35);
        }
        continue;
      }
      if (ds > 0 && ds < 70 && Math.abs(dl) < 2.1 && ds < leadDs) {
        lead = o;
        leadDs = ds;
      }
      if (ds < -2 && ds > -40 && ds > chaserDs) {
        chaser = o;
        chaserDs = ds;
      }
    }
    this.yellowIn = yellow;
    this.capL = capL;
    this.capR = capR;
    this.passTimer -= dt;
    this.cutT -= dt;
    // racing is on: not in the opening seconds' procession, under the VSC, a yellow flag or a blue flag
    const racingOn = calm < 0.6 && !this.vsc && yellow > 250 && this.yieldSide === 0;
    // the car ahead in our lane: how hard is it slowing? (one braking harder than we expect — backing out
    // of a move, lifting, locked up — is how rear-enders happen)
    if (lead && lead.id === this.leadId) this.leadA += ((lead.speed - this.leadV) / Math.max(dt, 1e-3) - this.leadA) * Math.min(1, dt * 12);
    else this.leadA = 0;
    this.leadId = lead ? lead.id : -1;
    this.leadV = lead ? lead.speed : 0;
    // a close fight (on its gearbox, or it on ours, or wheel to wheel) builds pressure; it fades after
    const fighting = racingOn && ((this.attack > 0.5 && !!lead && leadDs < 25) || (this.defend > 0.5 && !!chaser && chaserDs > -20) || !!side);
    this.pressure += ((fighting ? 1 : 0) - this.pressure) * Math.min(1, dt / (fighting ? 14 : 6));
    // stuck behind the same car: the longer it goes on, the more willing to try something (sooner for the aggressive)
    if (racingOn && lead && leadDs < 45 && this.attack > 0.5) {
      if (lead.id !== this.stuckWith) {
        this.stuckWith = lead.id;
        this.stuckBehind = 0;
      }
      this.stuckBehind += dt;
    } else if (!lead) this.stuckBehind = Math.max(0, this.stuckBehind - dt * 2);
    const frustration = Math.min(1, this.stuckBehind / (6 + 10 * (1 - this.aggression)));

    // (no new lines picked mid-corner or into a chicane: the offset can barely move there, and an offset
    // frozen through an S-bend runs the car out of road on the exit)
    const inCorner = tight > 0.3 || Math.abs(track.kappaAt(car.s)) > 1 / 150 || Math.abs(track.kappaAt(car.s + v * 0.5)) > 1 / 150;
    if (lead) {
      const ds = leadDs;
      const closing = v - lead.speed;
      // pull out of the tow once close enough for the run to carry us alongside before the braking
      // point: sooner with a big speed difference, late on the straight to dive down the inside
      const pullAt = 9 + Math.max(0, closing) * 1.8 + (this.brakeIn < 160 ? 14 : 0) + 6 * this.attack + 8 * frustration * (0.4 + this.aggression);
      if (racingOn && !inCorner && ds < Math.min(32, pullAt) && (closing > 0.3 - 0.25 * frustration || (this.attack > 0.5 && ds < 15 + 6 * frustration))) {
        if (this.passTimer <= 0) this.choosePassSide(lead, hw);
        else this.passWith = lead.id;
      } else if (racingOn && !inCorner && this.passTimer <= 0 && ds < 40 && this.brakeIn > 120) {
        // in its slipstream: tuck in right behind it down the straight
        this.targetOffset = Math.max(-2.5, Math.min(2.5, lead.lateral - track.racingLineAt(lead.s) * 0.9));
      }
      if (this.passTimer > 0 && this.passWith === lead.id && !inCorner) {
        // it moved across to cover the side we picked before we got alongside: switch once (the dummy)
        const room = this.passSide > 0 ? hw - lead.lateral : lead.lateral + hw;
        if (room < 3.0 && !this.switched && ds > 7) {
          this.passSide = -this.passSide;
          this.switched = true;
          this.passTimer = Math.max(this.passTimer, 1.5);
        }
        const want = Math.max(-hw + 1.5, Math.min(hw - 1.5, lead.lateral + this.passSide * 2.9));
        this.targetOffset = want - track.racingLineAt(car.s + 10) * 0.9;
        // still not alongside at the braking point: it didn't come off — back in line behind it
        if (this.brakeIn < 15 && ds > 6) this.passTimer = 0;
      }
      // don't run into the back of it (nose to tail in a train once the start is done)
      const tGap = ds / Math.max(1, v);
      // (more room through the chicanes and hairpins: cars turned across the road are longer than the gap along it)
      const minGap = 7.5 + 8.5 * calm + 1.5 * tight;
      if (tGap < 0.36 + 0.5 * calm || ds < minGap) followSpeed = Math.min(followSpeed, lead.speed - (minGap - ds) * 0.4);
      // it's slowing more than the corner calls for (backing out of a move, lifting, a mistake, a car ahead
      // of it): our stopping distance (what our brakes have over its) must fit in the gap — brake now, not
      // at our own braking point (a car just braking for the corner is out-braked, not followed)
      if (closing > 0 && this.leadA < -6 && lead.speed < profile.atGrip(lead.s, this.gripEst) * this.pace * 0.95 - 2) {
        const aRel = Math.max(3, 18 + 0.35 * v + this.leadA);
        followSpeed = Math.min(followSpeed, lead.speed + Math.sqrt(2 * aRel * Math.max(0, ds - minGap * 0.8)));
      }
    }

    // side by side into a braking zone: down the inside, brake late and make it stick (now and then too
    // late: a lock-up, running wide); round the outside and out-braked, brake a touch early and cut back
    // behind it for the better exit
    let craftLate = 0;
    if (side && racingOn && this.inside !== 0 && this.brakeIn < 60 && this.apexIn < 240 && this.err === 0) {
      const onInside = Math.sign(myLat - side.lateral) === this.inside;
      if (onInside && sideDs > -4.5) {
        craftLate = 4 + 7 * this.aggression;
        if (!(since(track, this.lungeS, car.s) < 200)) {
          this.lungeS = car.s;
          if (this.rand() < 0.04 + 0.1 * this.aggression) this.mistake(MISTAKE.LOCKUP, 0.1 + 0.35 * this.rand());
        }
      } else if (!onInside && sideDs > 0.5) {
        craftLate = -5;
        this.cutT = 2.4;
        this.cutWith = side.id;
      }
    }
    if (this.cutT > 0 && racingOn) {
      for (const o of others) {
        if (o.id !== this.cutWith) continue;
        const ds = track.delta(car.s, o.s);
        if (ds > 0 && ds < 35) {
          this.targetOffset = o.lateral - track.racingLineAt(o.s) * 0.9;
          this.passTimer = Math.max(this.passTimer, 0.2);
        }
        break;
      }
    }
    // (back toward the line for the corner unless racing someone side by side into it)
    const settle = this.brakeIn < 120 && !side ? 1.4 : 0;
    if (this.passTimer <= 0 || tight > 0.3) this.targetOffset *= Math.max(0, 1 - dt * (0.6 * (1 - 0.7 * calm) + 2.4 * tight + settle));
    // blue flag: move over on the straight to let the leaders through
    if (this.yieldSide !== 0 && tight < 0.3) this.targetOffset = this.yieldSide * (hw - 2.3) - track.racingLineAt(car.s + 20);
    const maxOff = 5.5 - 3.8 * tight;
    this.targetOffset = Math.max(-maxOff, Math.min(maxOff, this.targetOffset));
    // round a stricken car (whatever the corner)
    const evading = evadeLat === evadeLat;
    if (evading) {
      this.targetOffset = evadeLat - track.racingLineAt(car.s + 10) * 0.9;
      this.passTimer = Math.max(this.passTimer, 0.3);
    }

    // defending: the car behind is racing us (within a second) — one move to the inside before the
    // braking zone, made while it's still behind (never into a car alongside), held to turn-in: it has
    // to go round the outside, or wait for the exit (the tighter defensive line costs a little speed)
    if (this.defend > 0.5 && racingOn && !evading && followSpeed === Infinity && giveSide === 0) {
      // (a real threat: close, or closing, or already pulled out of our wake)
      const threat = !!chaser && chaserDs > -32 && chaserDs < -5.5 && (chaserDs > -15 || chaser.speed > v + 0.5 || Math.abs(chaser.lateral - myLat) > 1.2);
      if (threat && this.inside !== 0 && this.brakeIn > 0 && this.brakeIn < Math.max(90, v * 2.4) && !(since(track, this.defendS, car.s) < 250)) {
        this.defendS = car.s;
        this.defendSide = this.inside;
        // (held through the braking zone to turn-in; past that the car has to turn and the line takes over)
        this.defendEnd = Math.max(25, this.brakeIn + 20);
        this.defendCost = this.apexIn + 40;
      }
      if (this.defendSide !== 0 && since(track, this.defendS, car.s) < this.defendEnd) {
        this.targetOffset = this.defendSide * (hw - 3.0) - track.racingLineAt(car.s + 10) * 0.9;
        this.passTimer = Math.max(this.passTimer, 0.05);
      } else if (this.defendSide !== 0) {
        // released at turn-in: straight back toward the line (no lingering offset into the corner)
        this.defendSide = 0;
        this.targetOffset = 0;
        this.passTimer = 0;
      }
    } else if (this.defend <= 0.5) this.defendSide = 0;
    if (blockL) this.targetOffset = Math.max(this.targetOffset, myLat - track.racingLineAt(car.s) + 0.6);
    if (blockR) this.targetOffset = Math.min(this.targetOffset, myLat - track.racingLineAt(car.s) - 0.6);
    if (giveSide !== 0 && this.yieldSide !== -giveSide) {
      // stay a lane clear of it (not past the far edge of the road)
      const lim = Math.max(-hw + 1.3, Math.min(hw - 1.3, giveLat + giveSide * 3.4));
      const off = lim - track.racingLineAt(car.s) * 0.9;
      this.targetOffset = giveSide > 0 ? Math.max(this.targetOffset, off) : Math.min(this.targetOffset, off);
    }

    // lateral offset eases toward its target — moving across mid-corner tightens the
    // path beyond the grip the speed target assumes, so do it on the straights
    const kHere = Math.max(Math.abs(track.kappaAt(car.s)), Math.abs(track.kappaAt(car.s + v * 0.6)));
    // (a car merging from the pit exit or diving into the entry: move over briskly)
    // (but back toward the line it may always ease: an offset frozen through an S-bend is worse)
    const back = Math.abs(this.targetOffset) < Math.abs(this.offset) && Math.sign(this.targetOffset - this.offset) === -Math.sign(this.offset);
    const maxRate = (giveSide !== 0 || evading ? 3.6 : 2.2) * Math.max(back ? 0.5 : 0.15, 1 - kHere * 180);
    this.offset += Math.max(-maxRate * dt, Math.min(maxRate * dt, this.targetOffset - this.offset));
    // an offset past the edge of the road means nothing (the path is clamped there) — absorb it, so when
    // the line itself swings to that side (the apex of the corner we covered the inside of) the offset is
    // already gone and the path opens out with the line on the exit instead of hugging the inside
    const lineHere = track.racingLineAt(car.s) * 0.9;
    this.offset = Math.max(-hw + 0.6 - lineHere, Math.min(hw - 0.6 - lineHere, this.offset));

    // ---- steering: curvature feedforward + Stanley feedback at the front axle
    const a = car.spec.a;
    const syaw = Math.sin(car.yaw);
    const cyaw = Math.cos(car.yaw);
    const fx = car.x + syaw * a;
    const fz = car.z + cyaw * a;
    const pf = track.project(fx, fz, car.hint);
    const sF = pf.s;
    // AI keeps ~0.6 m of margin off the extreme racing line (kerb to kerb)
    const pathLat = (ss: number) => {
      const hwS = track.halfWidthAt(ss);
      // retired: onto the verge, clear of the road (inside the barrier)
      if (this.parkSide !== 0) return this.parkSide * Math.min(hwS + 2.2, track.barrierAt(ss, this.parkSide) - 1.4);
      const lat = Math.max(-hwS + 1.1, Math.min(hwS - 1.1, track.racingLineAt(ss) * 0.9 + this.offset));
      // (a car alongside: its space is off limits)
      const cl = this.capL > this.capR ? (this.capL + this.capR) / 2 : Math.max(this.capL, Math.min(this.capR, lat));
      // (never off the road for it: if there's no room, it's the speed that gives — see `squeezed`)
      return Math.max(-hwS + 0.9, Math.min(hwS - 0.9, cl));
    };
    const latP = pathLat(sF);
    const dlat = (pathLat(sF + 2) - pathLat(sF - 2)) / 4;
    // heading error relative to the path (path heading rel. track = −atan(dlat/ds))
    let rel = car.yaw - track.frame(sF).heading;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const headErr = -Math.atan(dlat) - rel;
    const crossErr = pf.lateral - latP; // + = car right of path → steer left
    const kPath = profile.lineK[Math.floor(track.wrap(sF + v * 0.08))] ?? 0;
    const ff = Math.atan(L * kPath) * (1 + 0.0002 * v * v);
    const fb = headErr + Math.atan2(2.2 * crossErr, v + 3);
    // yaw-rate damping against the path's expected yaw rate
    const damp = -0.035 * (car.r - v * kPath);
    let steer = ff + fb + damp;
    // countersteer toward the direction of travel when the car slides
    steer += 0.25 * Math.atan2(car.vy, Math.max(5, v));
    // small human wobble
    this.wobblePhase += dt;
    steer += Math.sin(this.wobblePhase * 1.7) * 0.002;
    // never steer past the front tyres' peak — more lock only plows the car wide —
    // except to countersteer a slide
    const lim = car.gripSteerLimit(v) * 1.04;
    // a sliding rear (rear slip angle past its peak) is what calls for countersteer
    const aR = Math.atan2(car.vy - car.spec.b * car.r, Math.max(3, v));
    const room = Math.min(0.3, Math.max(0, Math.abs(aR) - 0.09) * 1.4);
    // dirty air: the wake buffets the car behind — small quick corrections at the wheel
    if (car.dirty > 0.05) steer += lim * 0.1 * car.dirty * Math.sin(this.wobblePhase * 9.3) * Math.sin(this.wobblePhase * 3.1 + 1.3);
    const hiLim = lim + (aR > 0 ? room : 0);
    const loLim = lim + (aR < 0 ? room : 0);
    inp.steer = Math.max(-loLim, Math.min(hiLim, steer));

    if (this.parkSide !== 0) {
      // no engine: roll off the road, brake gently, stop
      inp.throttle = 0;
      inp.brake = v > 30 ? 0.2 : v > 2 ? 0.45 : 1;
      inp.ers = false;
      return false;
    }

    // ---- speed
    const offLine = Math.abs(this.offset);
    const corner = Math.abs(track.kappaAt(car.s + v * 0.5)) > 1 / 300 ? 1 : 0;
    // dirty air costs downforce: carry less speed through corners when close behind someone.
    // The grip the tyres have today (weather, temperature, compound, wear) picks the profile —
    // judged with a lag and a little caution, the way a driver feels it out
    this.gripEst += (car.gripFactor - this.gripEst) * Math.min(1, dt * 0.8);
    const g = Math.min(car.gripFactor, this.gripEst) * (car.gripFactor < 0.9 ? 0.985 : 1);
    const dirtyLoss = corner * car.dirty * 0.06;
    // the driver's own speed for each corner, learned (see AILearning) — and in a long fight a little more
    // than they know is safe: that's where the mistakes come from
    const know = this.know;
    const beyond = know ? 0.005 * this.pressure * (0.4 + 0.6 * this.aggression) : 0;
    const vAt = know ? (ss: number) => profile.atGrip(ss, g) * know.factor(ss, beyond) : (ss: number) => profile.atGrip(ss, g);
    // off the line = a tighter radius: slow corners punish it far more than fast ones

    // ---- mistakes (armed by the race): a late brake that locks the fronts and runs
    // wide, a corner exit taken too fast, a snap of oversteer on the power
    let late = 0;
    let over = 1;
    let noLift = false;
    let spinNow = false;
    if (this.err !== 0) {
      this.errT += dt;
      const needBrake = vAt(car.s + v * 0.12) < v - 4;
      if (this.errOn === 0) {
        const ready =
          this.err === MISTAKE.LOCKUP ? needBrake && v > 25
          : this.err === MISTAKE.WIDE ? corner === 1 && v > 25
          : corner === 1 && Math.abs(kPath) > 1 / 260 && !needBrake && v > 18;
        if (ready) {
          this.errOn = 1;
          this.errT = 0;
          if (this.err === MISTAKE.SPIN) car.r += Math.sign(kPath) * (0.25 + 0.35 * this.errSev);
        } else if (this.errT > 12) this.err = 0;
      }
      if (this.errOn === 1) {
        const dur = this.err === MISTAKE.LOCKUP ? 1.3 + this.errSev : this.err === MISTAKE.WIDE ? 2 + this.errSev : 1.2;
        if (this.errT > dur) this.err = this.errOn = 0;
        else if (this.err === MISTAKE.LOCKUP) late = 12 + 26 * this.errSev;
        else if (this.err === MISTAKE.WIDE) {
          over = 1.03 + 0.035 * this.errSev;
          noLift = true;
        } else spinNow = true;
      }
    }
    // attacking: out-brake the car ahead when right on its gearbox
    if (this.attack > 0.5 && followSpeed < Infinity && !this.vsc) late = Math.max(late, 4 + 3 * this.aggression + 3 * frustration);
    // side by side into the corner (see craftLate): later down the inside, earlier round the outside
    if (craftLate > 0) late = Math.max(late, craftLate);
    else if (craftLate < 0 && late === 0) late = craftLate;
    // the assists come back as soon as the moment is over
    const lockNow = this.err === MISTAKE.LOCKUP && this.errOn === 1;
    if (this.savedAssists && !spinNow && !lockNow) {
      car.assists = this.savedAssists;
      this.savedAssists = null;
    }
    if ((spinNow || lockNow) && !this.savedAssists) {
      this.savedAssists = car.assists;
      car.assists = spinNow ? { ...car.assists, traction: 'off', stability: false } : { ...car.assists, abs: false };
    }

    // the speed our actual path allows: an offset held through a corner (covering the inside, side by
    // side, round the outside, held off by a car alongside) changes its radius — hugging the inside after
    // the apex is far tighter than the line. Compare the path's curvature with the default line's at a few
    // points ahead and slow for the tightest (braking for the far ones in time)
    let pathK = 1;
    if (Math.abs(this.offset) > 0.3 || this.capL > -1e9 || this.capR < 1e9) {
      const base = (ss: number) => {
        const hwS = track.halfWidthAt(ss);
        return Math.max(-hwS + 1.1, Math.min(hwS - 1.1, track.racingLineAt(ss) * 0.9));
      };
      const s0 = car.s + v * 0.12;
      const vBase = Math.max(1, vAt(s0));
      for (let k = 0; k < 5; k++) {
        const d = 8 + k * Math.max(12, v * 0.45);
        const ss = s0 + d;
        const r = Math.min(1, Math.sqrt((pathCurv(track, base, ss) + 1 / 600) / (pathCurv(track, pathLat, ss) + 1 / 600)));
        if (r > 0.995) continue;
        const vReq = vAt(ss) * Math.max(0.5, r);
        pathK = Math.min(pathK, Math.sqrt(vReq * vReq + 2 * 28 * d) / vBase);
      }
    }
    const offLoss = 1 - Math.min(1, pathK) + corner * Math.min(0.05, offLine * 0.004);
    // braking later only moves the braking point: once the profile stops falling (the apex) the corner
    // speed is the corner speed again — carried into the apex it just runs the car wide on the exit (a
    // locked-up brake excepted: that one is meant to overshoot)
    const sNow = car.s + v * 0.12;
    // the braking point this driver has learned for the corner ahead
    if (know && !lockNow) late += know.brakeLate(sNow);
    const stillBraking = vAt(sNow + 12) < vAt(sNow) - 0.5;
    const vRef = late > 0 && !stillBraking && !lockNow ? vAt(sNow) : vAt(sNow - late);
    let vt = vRef * this.pace * this.trim * this.push * (1 + this.rhythm) * this.trouble * (corner ? over : 1) * (1 - offLoss) * (1 - dirtyLoss) * (this.yieldSide !== 0 ? 0.97 : 1) * (1 - 0.04 * calm) * (yellow < 250 ? 0.96 : 1) * (corner && since(track, this.defendS, car.s) < this.defendCost ? 0.985 : 1);
    // understeer in traffic: the wheel at the front tyres' limit and the car still drifting wide of the path
    // (turned in from the inside, off its line, in dirty air): scrub speed until the nose bites, like a driver
    // would (alone on the line the profile already has the margin: the solo pace is untouched)
    const wideNow = Math.abs(kPath) > 1 / 400 ? crossErr * Math.sign(kPath) : 0;
    if ((lead || side || chaser || Math.abs(this.offset) > 0.3) && Math.abs(inp.steer) > lim * 0.97 && wideNow > 1.0 && !noLift) vt *= 1 - Math.min(0.18, (wideNow - 1.0) * 0.06);
    // virtual safety car: everyone at the same reduced speed (the gaps hold)
    if (this.vsc) vt = Math.min(vt, Math.max(15, vAt(car.s + v * 0.12) * VSC_SPEED));
    vt = Math.min(vt, followSpeed);
    const err = vt - v;
    let edgeLift = false;
    if (err > 0) {
      inp.throttle = Math.min(1, 0.35 + err * 0.3);
      inp.brake = 0;
      // running wide on the exit: ease off like a driver would to hold the line
      if (Math.abs(kPath) > 1 / 400) {
        const wide = crossErr * Math.sign(kPath);
        if (wide > 0.35 && !noLift) inp.throttle *= Math.max(0.15, 1 - (wide - 0.35) * 0.7);
      }
      // about to run out of road (outer wheels at the kerb's edge and drifting out): lift
      const side = car.lateral >= 0 ? 1 : -1;
      const edge = hw + track.kerbAt(car.s + v * 0.2, side) - 0.95;
      const outward = ((car.lateral - this.prevLat) / Math.max(dt, 1e-3)) * side;
      const near = Math.abs(car.lateral) - (edge - 1.2);
      // (not at the inside edge of a steeply banked corner: the long apex there is the line)
      const bankedApex = track.banked[Math.floor(track.wrap(car.s))] !== 0 && Math.abs(kPath) > 1 / 400 && side !== Math.sign(kPath);
      if (near > 0 && outward > 0.4 && !bankedApex && !noLift) {
        inp.throttle *= Math.max(0.1, 1 - near * 0.55 - outward * 0.06);
        edgeLift = true;
      }
    } else {
      inp.throttle = err > -0.6 ? 0.25 : 0;
      inp.brake = err < -0.8 ? Math.min(1, -err * 0.22) : 0;
    }
    // a locked-up brake: stamps on it (the fronts lock, the car goes straight on)
    if (lockNow && inp.brake > 0.2) inp.brake = 1;
    // the snap: full power with the rear already stepping out, no countersteer yet
    if (spinNow) {
      inp.throttle = 1;
      inp.brake = 0;
      inp.steer = Math.max(-lim, Math.min(lim, inp.steer - 0.25 * Math.atan2(car.vy, Math.max(5, v))));
    }
    // a bogged launch: half throttle for a moment after moving off
    if (this.bog > 0 && this.startTimer < this.reaction + this.bog) inp.throttle = Math.min(inp.throttle, 0.5);
    this.prevLat = car.lateral;
    // ERS in the second half of straights when behind someone
    inp.ers = (followSpeed < Infinity || this.attack > 0.5 || this.defend > 0.5) && corner === 0 && car.ers > (this.attack > 0.5 ? 0.12 : 0.3);

    // ---- learning the circuit (see AILearning): how this pass through the corner is going, and at its end
    // what it taught. Only a pass driven alone, on the line, at the driver's own pace counts.
    if (know) {
      const c = know.cornerAt(car.s);
      if (c !== this.lcI) {
        if (this.lcI >= 0 && this.lcClean && this.lcT > 0.5) {
          const pass: CornerPass = { time: this.lcT, wide: this.lcWide, off: this.lcOff > 0.05 || this.lcEdge > 0.6, slide: this.lcSlide, grip: this.lcGrip, over: this.lcOver, under: this.lcUnder, lock: this.lcLock, apex: this.lcApex === this.lcApex ? this.lcApex : 0, wet: g < 0.9 };
          const bench = this.bench;
          know.learn(this.lcI, pass, bench ? bench.pushFor(this.lcI, this.lcT, selfId) : 0);
          bench?.benchmark(this.lcI, this.lcT, selfId);
        }
        this.lcI = c;
        this.lcClean = c >= 0;
        this.lcT = this.lcWide = this.lcOff = this.lcEdge = this.lcSlide = this.lcGrip = this.lcOver = this.lcUnder = this.lcLock = 0;
        this.lcApex = NaN;
      }
      if (c >= 0) {
        // (traffic is fine as long as it didn't change how we drove the corner: not held up, not alongside, not in dirty air)
        const alone = this.learnOn && calm === 0 && racingOn && this.err === 0 && !side && followSpeed === Infinity && giveSide === 0 && !evading;
        if (!alone || Math.abs(this.offset) > 0.6 || capL > -1e9 || capR < 1e9 || car.dirty > 0.2 || this.trouble < 1 || this.defendSide !== 0 || this.pressure > 0.35) this.lcClean = false;
        this.lcT += dt;
        if (Math.abs(kPath) > 1 / 400) this.lcWide = Math.max(this.lcWide, wideNow);
        // (how much of the front tyres' grip the corner itself took, off the brakes: 1 = at the peak)
        if (inp.brake < 0.1) this.lcGrip = Math.max(this.lcGrip, car.slipFront);
        if (car.offTrack) this.lcOff += dt;
        if (edgeLift) this.lcEdge += dt;
        this.lcSlide = Math.max(this.lcSlide, Math.abs(aR));
        this.lcLock = Math.max(this.lcLock, car.lockup);
        if (track.delta(car.s, know.z.apex[c]) > 0) {
          // before the apex: still over the target on full brakes (braked too late), or back on the power under it (too early)
          if (inp.brake > 0.9 && v > vt + 2) this.lcOver += dt;
          if (inp.throttle > 0.5 && v < vt - 1.5 && stillBraking && !edgeLift && wideNow < 0.6) this.lcUnder += dt;
        } else if (this.lcApex !== this.lcApex) this.lcApex = v - vt;
      }
    }

    // ---- stuck / wrong way detection
    if (v < 2 || Math.abs(car.relYaw) > 1.8) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    if (this.stuckTimer > 2.5) {
      this.stuckTimer = 0;
      return true;
    }
    return false;
  }
}
