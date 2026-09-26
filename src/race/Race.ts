import type { Track } from '../world/Track.ts';
import { CarPhysics, F1_SPEC, wetGrip, type CarSpec, type DriveInput, type DamageMode } from '../sim/CarPhysics.ts';
import { AIDriver, type Neighbour } from '../sim/AIDriver.ts';
import { RacingProfile } from '../sim/RacingProfile.ts';
import { TEAMS, type Entry } from './Teams.ts';
import { PitLane, fitTyres, newPitState, DRY_COMPOUNDS, COMPOUNDS, isDry, tyreTypeFor, type Compound, type PitState, type PitNeighbour } from './Pit.ts';
import { Weather, type WeatherPlan, type WeatherState } from '../world/Weather.ts';

/**
 * Race session: grid, start lights, the physics/AI step, timing & scoring,
 * DRS, car-to-car contact, finish.
 */

export type RacePhase = 'grid' | 'lights' | 'racing' | 'finished';
/**
 * Track limits: 'strict' — all four wheels off at speed is an offence, three
 * warnings then +5 s; 'lenient' (default) — only a clear excursion (well past the
 * kerb, not a brief moment) that gained time counts, five warnings before a
 * penalty; 'off' — never.
 */
export type TrackLimitsMode = 'off' | 'lenient' | 'strict';
export type RaceMode = 'race' | 'timetrial';

export interface RaceOptions {
  mode: RaceMode;
  laps: number;
  /** multiplies every AI's pace (0.9 easy … 1.0 legend) */
  difficulty: number;
  playerEntry: Entry;
  /** 0-based grid slot for the player */
  playerGrid: number;
  entries: Entry[];
  /** the player's starting compound ('auto' = the team picks for the conditions; AI choose their own) */
  playerCompound?: Compound | 'auto';
  /** the session's forecast */
  weather: WeatherPlan;
  /** starting order from qualifying (overrides playerGrid) */
  gridOrder?: Entry[];
  /** crash damage (default full) */
  damage?: DamageMode;
  /** the player's car (career upgrades); AI cars run the base spec */
  playerSpec?: CarSpec;
  /** Dynamic difficulty: the AI's pace drifts a little (±1.5%) toward the player's during the race */
  dynamicAI?: boolean;
  /** track-limit rules (default lenient) */
  trackLimits?: TrackLimitsMode;
}

/**
 * An AI driver's pace factor: difficulty × car × driver. The car and driver
 * spreads are compressed so the field covers ~2% like a real grid, not ~6%.
 */
export function aiPace(entry: Entry, difficulty: number): number {
  const car = 1 - (1 - entry.team.pace) * 0.45;
  const driver = 0.988 + entry.driver.skill * 0.012;
  return difficulty * car * driver;
}

/**
 * AI qualifying laps at Monza: fitted to the AI's own flying laps on softs with
 * low fuel (T ≈ 26.9 + 50.8 / pace s in the dry), scaled for the conditions by
 * the speed profile at the grip the right tyre would have, plus a little
 * randomness. `gripNow` is that grip (1 = dry).
 */
export function aiQualifyingTime(entry: Entry, difficulty: number, wetFactor = 1, trackScale = 1): number {
  const pace = aiPace(entry, difficulty);
  const g = (Math.random() + Math.random() + Math.random() - 1.5) * 0.25;
  // fitted at Monza; other circuits scale by their speed-profile lap relative to Monza's
  return (26.9 + 50.8 / pace - 0.15) * trackScale * wetFactor + g;
}

export interface Competitor {
  id: number;
  entry: Entry;
  car: CarPhysics;
  ai: AIDriver | null;
  isPlayer: boolean;
  /** laps completed (−1 until the first crossing of the line from the grid) */
  laps: number;
  lapDist: number;
  raceDist: number;
  lapStart: number;
  lastLap: number;
  bestLap: number;
  lapTimes: number[];
  sector: number;
  sectorStart: number;
  sectorTimes: [number, number, number];
  lastSectors: [number, number, number];
  bestSectors: [number, number, number];
  position: number;
  gapLeader: number;
  gapAhead: number;
  finished: boolean;
  finishTime: number;
  drsEligible: boolean;
  drsZone: number;
  lapValid: boolean;
  penalty: number;
  /** track-limit warnings this race (reset after each penalty) */
  warnings: number;
  limitsOff: boolean;
  /** lenient track limits: the current excursion — time off, the time the stretch should have taken, went well past the kerb */
  exT: number;
  exExpect: number;
  exFar: boolean;
  exS: number;
  compound: Compound;
  compoundsUsed: Compound[];
  pit: PitState;
  /** AI: lap on which to stop (−1 = no stop planned) */
  pitLap: number;
  /** AI: the race's planned stops (laps, ascending; the next one is mirrored in pitLap) */
  pitPlan: number[];
  /** the planned stop is a weather call (cancelled if conditions swing back) */
  weatherCall: boolean;
  stops: number;
  /** seconds left of pit-exit protection: no contact with cars on the track while merging */
  pitGhost: number;
  /** metres of pit-exit protection left (through the first corners after the exit) */
  pitGhostM: number;
  /** wants to pit and is closing on the pit entry (moves to the pit side; no contact near the entry) */
  pitApproach: boolean;
  /** laps completed at the last stop (−9: none yet) */
  pitLastLap: number;
  /** ring of checkpoint pass times (every CP metres) for timing gaps */
  cpTimes: Float64Array;
  cpIndex: number;
  contactTimer: number;
  /** being lapped by a car close behind: blue flags */
  blueFlag: boolean;
  /** out of the race (car destroyed or broken): DNF */
  retired: boolean;
  /** race time of the retirement */
  retiredAt: number;
  /** the marshals have craned the wreck away: no longer on the track */
  removed: boolean;
  /** seconds a retired car has sat still */
  stopTimer: number;
}

export interface RaceEvent {
  kind:
    | 'fastest-lap'
    | 'personal-best'
    | 'sector'
    | 'drs-enabled'
    | 'track-limits'
    | 'penalty'
    | 'final-lap'
    | 'finish'
    | 'lap'
    | 'contact'
    | 'lights-out'
    | 'pit-in'
    | 'pit-stop'
    | 'pit-out'
    | 'box-now'
    | 'blue-flag'
    | 'retired'
    | 'damage';
  car: number;
  value?: number;
  sector?: number;
  valid?: boolean;
  color?: 'purple' | 'green' | 'yellow';
}

/** fuel for a lap of Monza at racing speed (kg) */
export const FUEL_PER_LAP = 1.8;

/** Dynamic difficulty: where a new player starts and the range the rating can move in (fraction of the limit) */
export const AI_SKILL = { start: 0.92, min: 0.72, max: 1.03 };
/** Dynamic difficulty: the most the AI's pace moves during a race */
const DYN_TRIM = 0.015;

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const a = xs.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const CP = 20;
/** lenient track limits: metres the car's centre must go past the outer kerb edge, and the shortest excursion (s) that counts */
const LENIENT_MARGIN = 2.3;
const LENIENT_MIN_TIME = 0.4;
const CP_RING = 1024;
const SUBSTEPS = 4;

export class Race {
  readonly track: Track;
  readonly opts: RaceOptions;
  readonly profile: RacingProfile;
  readonly cars: Competitor[] = [];
  readonly player: Competitor;
  phase: RacePhase = 'grid';
  /** seconds since the session started */
  time = 0;
  /** race clock since lights out */
  raceTime = 0;
  lightsLit = 0;
  private lightsTimer = 0;
  private lightsHold = 0;
  bestLap = Infinity;
  bestLapCar = -1;
  bestSectors: [number, number, number] = [Infinity, Infinity, Infinity];
  leaderLaps = 0;
  finishOrder: number[] = [];
  events: RaceEvent[] = [];
  playerInput: DriveInput = { throttle: 0, brake: 0, steer: 0, ers: false, shiftUp: false, shiftDown: false };
  /** player's DRS button edge */
  playerDrsRequest = false;
  /** DRS assist: open automatically whenever allowed */
  playerDrsAuto = false;
  /** player asked the team to box this lap */
  playerPitRequest = false;
  /** compound the player will get at the next stop (null = the team picks) */
  playerPitCompound: Compound | null = null;
  readonly pitLane: PitLane;
  /** races this long must use two dry compounds (F1 rule, as in the game) */
  readonly twoCompoundRule: boolean;
  /** live delta to the player's best lap (s, NaN until there is one) */
  playerDelta = NaN;
  private deltaCur = new Float32Array(1).fill(-1);
  private deltaBest: Float32Array | null = null;
  private sectorLapDist: [number, number];
  private drsLapDist: { detect: number; start: number; end: number }[];
  private neighbours: Neighbour[] = [];
  /** cars in the pit lane this substep (queueing, safe release) */
  private pitCars: PitNeighbour[] = [];
  private gridStartDist: number[] = [];
  /** the session's weather; `weatherState` is the same object as weather.state (flashbacks snapshot it) */
  readonly weather: Weather;
  weatherState: WeatherState;
  private strategyTimer = 0;

  constructor(track: Track, opts: RaceOptions) {
    this.track = track;
    this.opts = opts;
    this.profile = RacingProfile.for(track, F1_SPEC);
    this.weather = new Weather(opts.weather);
    this.weatherState = this.weather.state;
    this.deltaCur = new Float32Array(Math.ceil(track.length / 10) + 2).fill(-1);
    this.sectorLapDist = [track.lapDistance(track.sectorS[0]), track.lapDistance(track.sectorS[1])];
    this.drsLapDist = track.drs.map((z) => ({ detect: track.lapDistance(z.detect), start: track.lapDistance(z.start), end: track.lapDistance(z.end) }));

    const entries = opts.mode === 'timetrial' ? [opts.playerEntry] : opts.entries;
    // grid order: from qualifying if we have it, else AI by pace with the player
    // dropped into their chosen slot
    let order: Entry[];
    if (opts.gridOrder && opts.mode === 'race') order = opts.gridOrder.slice();
    else {
      const ai = entries.filter((e) => e !== opts.playerEntry);
      ai.sort((a, b) => b.team.pace * b.driver.skill - a.team.pace * a.driver.skill);
      order = ai.slice();
      const pSlot = opts.mode === 'timetrial' ? 0 : Math.max(0, Math.min(order.length, opts.playerGrid));
      order.splice(pSlot, 0, opts.playerEntry);
    }

    order.forEach((entry, i) => {
      const isPlayer = entry === opts.playerEntry;
      const car = new CarPhysics(isPlayer && opts.playerSpec ? opts.playerSpec : F1_SPEC);
      car.weather = this.weather;
      car.damageMode = opts.damage ?? 'full';
      if (opts.mode === 'timetrial') {
        car.fuel = 5;
        car.burnFuel = false;
      } else car.fuel = opts.laps * FUEL_PER_LAP + 1.5;
      if (opts.mode === 'timetrial') {
        // flying lap: start on the pit straight behind the line at speed
        car.placeOnTrack(track, track.startS - 420, track.racingLineAt(track.startS - 420));
      } else {
        const g = track.gridSlot(i);
        car.placeOnTrack(track, g.s, g.lateral);
      }
      let aiDriver: AIDriver | null = null;
      if (!isPlayer) {
        const pace = aiPace(entry, opts.difficulty);
        aiDriver = new AIDriver(pace, entry.driver.aggression);
        aiDriver.startFrom(car, track);
        car.allowReverse = false;
      }
      const c: Competitor = {
        id: i,
        entry,
        car,
        ai: aiDriver,
        isPlayer,
        laps: -1,
        lapDist: track.lapDistance(car.s),
        raceDist: 0,
        lapStart: 0,
        lastLap: 0,
        bestLap: Infinity,
        lapTimes: [],
        sector: 0,
        sectorStart: 0,
        sectorTimes: [0, 0, 0],
        lastSectors: [0, 0, 0],
        bestSectors: [Infinity, Infinity, Infinity],
        position: i + 1,
        gapLeader: 0,
        gapAhead: 0,
        finished: false,
        finishTime: 0,
        drsEligible: false,
        drsZone: -1,
        lapValid: true,
        penalty: 0,
        warnings: 0,
        limitsOff: false,
        exT: 0,
        exExpect: 0,
        exFar: false,
        exS: 0,
        compound: 'medium',
        compoundsUsed: [],
        pit: newPitState(),
        pitLap: -1,
        pitPlan: [],
        weatherCall: false,
        stops: 0,
        pitGhost: 0,
        pitGhostM: 0,
        pitApproach: false,
        pitLastLap: -9,
        cpTimes: new Float64Array(CP_RING).fill(-1),
        cpIndex: -1,
        contactTimer: 0,
        blueFlag: false,
        retired: false,
        retiredAt: 0,
        removed: false,
        stopTimer: 0,
      };
      c.raceDist = c.laps * track.length + c.lapDist;
      this.cars.push(c);
      this.gridStartDist.push(c.lapDist);
    });
    this.player = this.cars.find((c) => c.isPlayer)!;

    // tyres & strategy
    this.pitLane = new PitLane(track);
    this.pitLane.trackSpeed = (s) => this.profile.at(s);
    this.pitLane.mergeBusy = (ps, tRel) => this.mergeBusy(ps, tRel);
    this.twoCompoundRule = opts.mode === 'race' && opts.laps >= 10;
    const startType = tyreTypeFor(this.weather.wetnessAt(0, 0));
    for (const c of this.cars) {
      let start: Compound;
      const pick = c.isPlayer ? (opts.playerCompound ?? 'auto') : 'auto';
      if (pick !== 'auto') start = pick;
      else if (startType === 1) start = 'inter';
      else if (startType === 2) start = 'wet';
      else if (opts.mode === 'timetrial' || opts.laps < 8) start = 'soft';
      else if (c.isPlayer) start = opts.laps >= 10 ? 'medium' : 'soft';
      else start = Math.random() < 0.6 ? 'medium' : Math.random() < 0.5 ? 'soft' : 'hard';
      c.compound = start;
      c.compoundsUsed = [start];
      fitTyres(c.car, start);
      if (!c.isPlayer && opts.mode === 'race') {
        c.pitPlan = this.planStops(start, c.id);
        c.pitLap = c.pitPlan.length ? c.pitPlan[0] : -1;
      }
    }
    if (opts.mode === 'timetrial') {
      this.player.car.setSpeed(60);
      this.player.car.gear = 7;
      this.player.laps = -1;
      this.phase = 'racing';
    }
  }

  get isTimeTrial() {
    return this.opts.mode === 'timetrial';
  }

  /** begin the start-light sequence */
  startLights() {
    if (this.phase !== 'grid') return;
    this.phase = 'lights';
    this.lightsLit = 0;
    this.lightsTimer = 0;
    this.lightsHold = 0.6 + Math.random() * 2.2;
  }

  update(dt: number) {
    this.events.length = 0;
    this.time += dt;
    this.weather.update(dt, this.phase === 'racing' ? 1 : 0.2);
    this.strategyTimer -= dt;
    if (this.strategyTimer <= 0) {
      this.strategyTimer = 1;
      this.weatherStrategy();
    }

    if (this.phase === 'lights') {
      this.lightsTimer += dt;
      const lit = Math.min(5, Math.floor(this.lightsTimer / 1.0) + 1);
      if (lit !== this.lightsLit && this.lightsTimer < 5) {
        this.lightsLit = lit;
      }
      if (this.lightsTimer >= 5 + this.lightsHold) {
        this.lightsLit = 0;
        this.phase = 'racing';
        this.raceTime = 0;
        for (const c of this.cars) {
          c.lapStart = 0;
          c.sectorStart = 0;
        }
        for (const c of this.cars) c.car.reverse = false;
        this.events.push({ kind: 'lights-out', car: this.player.id });
      }
    }

    const racing = this.phase === 'racing' || this.phase === 'finished';
    if (racing) this.raceTime += dt;

    this.aeroWake();
    if (racing && !this.isTimeTrial) this.blueFlags();

    const h = dt / SUBSTEPS;
    for (let k = 0; k < SUBSTEPS; k++) {
      this.neighbours.length = 0;
      this.pitCars.length = 0;
      for (const c of this.cars) {
        if (c.removed) continue;
        const pit = this.pitFlag(c);
        // (a car still behind the pit wall: racing cars keep clear of the edge it's about to join at)
        const pitLat = pit !== 0 ? pit * Math.min(c.car.lateral * pit, this.track.halfWidthAt(c.car.s)) : undefined;
        this.neighbours.push({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx, pit, pitLat });
        if (c.pit.phase !== 'none') this.pitCars.push({ id: c.id, ps: c.pit });
      }
      for (const c of this.cars) {
        if (c.removed) continue;
        const zone = this.drsLapDist[c.drsZone];
        const inZone = !!zone && c.drsEligible && this.inRange(c.lapDist, zone.start, zone.end);
        // pit assist: requested stop + crossing the takeover point → scripted pit lane
        if (this.pitStep(c, h)) continue;
        if (c.isPlayer) {
          const inp = this.playerInput;
          if ((this.playerDrsRequest || this.playerDrsAuto) && inZone) c.car.drsOpen = true;
          if (!inZone) c.car.drsOpen = false;
          if (this.phase === 'grid' || this.phase === 'lights') {
            // held on the grid; the throttle only revs the engine
            c.car.step(h, { ...inp, hold: true }, this.track, false);
          } else c.car.step(h, inp, this.track, inZone);
        } else if (c.ai) {
          const aiRacing = this.phase === 'racing' || this.phase === 'finished';
          const reset = c.ai.update(h, c.car, this.track, this.profile, aiRacing, this.neighbours, c.id);
          if (reset && !c.retired) this.resetCar(c);
          c.car.drsOpen = inZone && this.inRange(c.lapDist, zone!.start + 10, zone!.end - 60);
          c.car.step(h, c.ai.input, this.track, inZone);
        }
      }
      this.collideCars();
    }
    this.playerDrsRequest = false;
    this.retirements(dt);
    this.pitGhosts(dt);

    for (const c of this.cars) this.scoreCar(c, dt);
    this.rankCars();
    this.dynamicPace(dt);
  }

  /**
   * Damage outcomes: a destroyed car is out on the spot; an AI car with a broken
   * wheel parks it; a broken front wing sends an AI car into the pits for a new
   * nose. Stopped wrecks are craned away after a while.
   */
  private retirements(dt: number) {
    if (this.phase !== 'racing' && this.phase !== 'finished') return;
    for (const c of this.cars) {
      const car = c.car;
      if (!c.retired && !c.finished) {
        const broken = !c.isPlayer && car.susp.some((d) => d >= 0.999) && car.damageMode === 'full';
        if (car.destroyed || broken) {
          c.retired = true;
          c.retiredAt = this.raceTime;
          c.drsEligible = false;
          car.drsOpen = false;
          if (c.ai) {
            // coast off the racing line onto the verge on the nearer side
            c.ai.parkSide = car.lateral >= 0 ? 1 : -1;
          }
          this.events.push({ kind: 'retired', car: c.id, value: car.destroyed ? 1 : 0 });
        } else if (c.ai && c.pitLap < 0 && car.wingDamage > 0.45 && car.damageMode === 'full') {
          // a new nose at the end of this lap
          c.pitLap = c.laps + 1;
        }
        if (c.isPlayer && car.wingDamage > 0.45 && !this.warnedWing) {
          this.warnedWing = true;
          this.events.push({ kind: 'damage', car: c.id, value: car.wingDamage });
        }
        if (c.isPlayer && car.wingDamage < 0.1) this.warnedWing = false;
      }
      if (c.retired && !c.removed && !c.isPlayer) {
        if (car.speed < 1) c.stopTimer += dt;
        if (c.stopTimer > 14) c.removed = true;
      }
    }
  }
  private warnedWing = false;

  /**
   * Slipstream and dirty air from the car directly ahead on the road:
   * tow (less drag) builds from ~50 m and peaks close behind; dirty air (less
   * downforce) only matters within ~25 m and mostly in corners.
   */
  private aeroWake() {
    const cars = this.cars;
    for (const c of cars) {
      let tow = 0;
      let dirty = 0;
      for (const o of cars) {
        if (o === c || o.pit.phase !== 'none' || c.pit.phase !== 'none' || o.removed) continue;
        const ds = this.track.delta(c.car.s, o.car.s);
        if (ds <= 2 || ds > 55) continue;
        const dl = Math.abs(o.car.lateral - c.car.lateral);
        if (dl > 3.2) continue;
        const align = 1 - dl / 3.2;
        const speed = Math.min(1, Math.max(0, (c.car.vx - 30) / 40));
        tow = Math.max(tow, align * speed * Math.min(1, (55 - ds) / 40));
        dirty = Math.max(dirty, align * Math.max(0, 1 - ds / 26));
      }
      c.car.tow = tow;
      c.car.dirty = dirty;
    }
  }

  /** how much slower than dry a lap is right now on the tyre the conditions call for */
  conditionsLapFactor(): number {
    const wet = this.lineWetness;
    if (wet < 0.02) return 1;
    const type = tyreTypeFor(wet);
    const g = wetGrip(type, wet) * (type === 0 ? 1 : 0.985);
    return this.profile.lapTimeAt(g) / this.profile.lapTimeAt(1);
  }

  /** water level on the racing line right now */
  get lineWetness(): number {
    return this.weather.wetnessAt(0, 0);
  }

  /** the tyre type the conditions call for, looking `ahead` seconds into the forecast for rain arriving */
  conditionsType(): 0 | 1 | 2 {
    return tyreTypeFor(this.lineWetness);
  }

  /** the dry-race two-compound rule still applies (no inters/wets used) and isn't met yet */
  owesSecondCompound(c: Competitor): boolean {
    if (!this.twoCompoundRule) return false;
    if (c.compoundsUsed.some((k) => !isDry(k))) return false;
    return new Set(c.compoundsUsed).size < 2;
  }

  /**
   * Blue flags: a car about to be lapped (the car close behind is a lap or more
   * ahead in the race) is shown blue; the AI moves off the line and lifts a
   * touch on the next straight to let it by.
   */
  private blueFlags() {
    const L = this.track.length;
    for (const c of this.cars) {
      let blue = false;
      if (!c.finished && !c.retired && c.pit.phase === 'none') {
        for (const o of this.cars) {
          if (o === c || o.finished || o.retired || o.pit.phase !== 'none') continue;
          if (o.raceDist - c.raceDist < L * 0.6) continue;
          const behind = this.track.delta(o.car.s, c.car.s);
          if (behind > 0 && behind < 70) {
            blue = true;
            break;
          }
        }
      }
      if (blue && !c.blueFlag && c.isPlayer) this.events.push({ kind: 'blue-flag', car: c.id });
      c.blueFlag = blue;
      if (c.ai) c.ai.yieldSide = blue ? -Math.sign(this.track.racingLineAt(c.car.s + 60) || 1) : 0;
    }
  }

  /** the compound the player gets at the next stop: their pick, else one that suits conditions and rules */
  playerNextCompound(): Compound {
    const p = this.player;
    if (this.playerPitCompound) return this.playerPitCompound;
    return this.nextCompoundFor(p);
  }

  private nextCompoundFor(c: Competitor): Compound {
    const type = this.conditionsType();
    if (type === 1) return 'inter';
    if (type === 2) return 'wet';
    const lapsLeft = this.opts.laps - Math.max(0, c.laps);
    const want: Compound = lapsLeft > 12 ? 'hard' : lapsLeft > 7 ? 'medium' : 'soft';
    if (this.owesSecondCompound(c) && want === c.compound) {
      const others = DRY_COMPOUNDS.filter((k) => k !== c.compound);
      return lapsLeft > 12 && others.includes('hard') ? 'hard' : others.includes('medium') ? 'medium' : others[0];
    }
    return want;
  }

  private aiNextCompound(c: Competitor): Compound {
    return this.nextCompoundFor(c);
  }

  /**
   * AI weather calls, once a second: when the conditions want a different kind
   * of tyre (slick ↔ inter ↔ wet), box at the next opportunity — with a little
   * spread between drivers so they don't all come in on the same lap.
   */
  private weatherStrategy() {
    if (this.isTimeTrial || this.phase !== 'racing') return;
    const N = this.opts.laps;
    const wet = this.lineWetness;
    for (const c of this.cars) {
      if (c.isPlayer || c.finished || c.retired || c.pit.phase !== 'none') continue;
      const have = COMPOUNDS[c.compound].type;
      // the tyre the conditions call for, with some hysteresis around the crossovers (0.2 / 0.72) so
      // nobody flaps between inters and wets while the water level hovers at the line
      const want: 0 | 1 | 2 = have === 0 ? (wet < 0.25 ? 0 : wet < 0.8 ? 1 : 2) : have === 1 ? (wet < 0.14 ? 0 : wet < 0.8 ? 1 : 2) : wet < 0.12 ? 0 : wet < 0.62 ? 1 : 2;
      const lapsLeft = N - Math.max(0, c.laps);
      // just stopped: only a tyre that's badly wrong brings a car straight back in
      const fresh = c.laps - c.pitLastLap < 2 && Math.abs(want - have) < 2;
      if (have === want || lapsLeft < 1) {
        if (c.pitLap >= 0 && c.weatherCall) {
          // the conditions swung back: back to the planned stops
          c.weatherCall = false;
          c.pitLap = this.nextPlanned(c);
        }
      } else {
        // how wrong is the tyre? a gamble on slicks in a drizzle, never slicks in a downpour
        const gap = Math.abs(want - have);
        const brave = c.entry.driver.aggression;
        if (!fresh && (c.pitLap < 0 || c.pitLap > c.laps + 1)) {
          if (gap >= 2 || Math.random() < 0.08 + (1 - brave) * 0.12) {
            c.pitLap = c.laps + 1;
            c.weatherCall = true;
          }
        }
      }
      if (c.weatherCall || lapsLeft < 1) continue;
      // tyres going off: box this lap rather than on the planned one
      if (lapsLeft >= 3 && this.wearOf(c) > 0.6 && (c.pitLap < 0 || c.pitLap > c.laps + 1)) c.pitLap = c.laps + 1;
      // races of ten laps or more: everyone stops at least once (the two-compound rule, fresh wets in the rain)
      if (N >= 10 && c.stops === 0 && c.pitLap < 0 && lapsLeft <= 3) c.pitLap = c.laps + 1;
    }
  }

  // ------------------------------------------------------------------ pit stops

  /**
   * An AI car's stops for the race: races of 10+ laps get one stop (a few long
   * races two), placed by the life of the starting compound against the next
   * one's, spread over a few laps between drivers; 8–9 lap races an optional
   * single stop as before. Weather calls and worn tyres move stops later on.
   */
  private planStops(start: Compound, id: number): number[] {
    const N = this.opts.laps;
    if (N < 8) return [];
    const r = Math.random;
    const cl = (x: number) => Math.max(2, Math.min(N - 2, Math.round(x)));
    if (N < 10) {
      if (!isDry(start)) return [];
      const frac = start === 'soft' ? 0.35 : start === 'medium' ? 0.5 : 0.62;
      return [Math.max(2, Math.min(N - 1, Math.round(N * frac + (r() - 0.5) * 2)))];
    }
    const life: Record<Compound, number> = { soft: 0.62, medium: 1, hard: 1.55, inter: 0.95, wet: 1.1 };
    // a per-driver spread so the stops don't all fall on the same lap
    const spread = (((id * 7) % 5) - 2) * 0.35 + (r() - 0.5) * 1.6;
    const two = N >= 18 && r() < (N >= 30 ? 0.55 : N >= 24 ? 0.4 : 0.25);
    if (!two) {
      const next: Compound = !isDry(start) ? start : start === 'hard' ? 'medium' : start === 'soft' ? 'hard' : r() < 0.6 ? 'hard' : 'soft';
      return [cl((N * life[start]) / (life[start] + life[next]) + spread)];
    }
    const mid: Compound = !isDry(start) ? start : start === 'medium' ? 'hard' : 'medium';
    const last: Compound = !isDry(start) ? start : 'soft';
    const w = life[start] + life[mid] + life[last];
    const a = cl((N * life[start]) / w + spread);
    const b = Math.max(a + 3, cl((N * (life[start] + life[mid])) / w + spread * 0.6));
    return b <= N - 2 ? [a, b] : [a];
  }

  /** the next planned stop still to come (−1: none) */
  private nextPlanned(c: Competitor): number {
    for (const l of c.pitPlan) if (l >= c.laps + 1) return l;
    return -1;
  }

  /** a team-mate is in the pit lane on the way to (or in) the shared box */
  private mateInPits(c: Competitor): boolean {
    for (const o of this.cars) if (o !== c && o.entry.team === c.entry.team && (o.pit.phase === 'in' || o.pit.phase === 'stop')) return true;
    return false;
  }

  /** side of the road a car is entering the pits on / merging from (0: racing) — the AI gives it that side */
  private pitFlag(c: Competitor): number {
    const ps = c.pit, p = this.track.pit;
    if (ps.phase === 'in') return ps.s < p.sStart + 5 ? p.side : 0;
    // (flagged from well before the end of the lane, so the traffic is already over when it joins)
    if (ps.phase === 'out') return ps.s > p.sEnd - 140 ? p.side : 0;
    if (c.pitGhost > 0) return p.side;
    if (c.pitApproach && this.pitLane.toTakeover(c.car.s) < 220) return p.side;
    return 0;
  }

  /** a racing car would catch the car leaving the pits before it's released (the pit side of the road) */
  private mergeBusy(ps: PitState, tRelease: number): boolean {
    const t = this.track, P = this.pitLane;
    // (whichever side of the road it's on now: the line into the next corner may cross to the pit side)
    const toRelease = P.releaseS - ps.s;
    for (const o of this.cars) {
      if (o.removed || o.retired || o.pit.phase !== 'none') continue;
      // metres behind the exit car along the road (negative: already past it)
      const behind = t.delta(o.car.s, t.wrap(ps.s));
      if (behind < -4 || behind > 700) continue;
      const tR = (behind + toRelease) / Math.max(10, o.car.vx);
      if (tR < tRelease + 0.8) return true;
    }
    return false;
  }

  /** no car-to-car contact: in the pit lane (its own queueing keeps cars apart), entering, or merging back */
  private isPitGhost(c: Competitor): boolean {
    return c.pit.phase !== 'none' || c.pitGhost > 0 || (c.pitApproach && this.pitLane.toTakeover(c.car.s) < 160);
  }

  private pitGhosts(dt: number) {
    for (const c of this.cars) {
      if (c.pitGhost <= 0) continue;
      c.pitGhost -= dt;
      // protected until clear of the merge and the first corner after the exit
      c.pitGhostM -= Math.max(0, c.car.vx) * dt;
      if (c.pitGhostM > 0) c.pitGhost = Math.max(c.pitGhost, 0.1);
      if (c.pitGhost > 0) continue;
      // solid again as soon as it isn't overlapping anyone (never pop two cars apart; lingering
      // longer only lets racing cars side by side drive through each other)
      for (const o of this.cars) {
        if (o === c || o.removed || o.pit.phase !== 'none') continue;
        if (Math.abs(this.track.delta(c.car.s, o.car.s)) < 5.9 && Math.abs(o.car.lateral - c.car.lateral) < 2.2) {
          c.pitGhost = 0.05;
          break;
        }
      }
    }
  }

  /**
   * The pits for one car this substep: the takeover when a stop is wanted, then
   * the scripted drive. Returns true while the pit script drives the car.
   */
  private pitStep(c: Competitor, h: number): boolean {
    const racing = this.phase === 'racing' || this.phase === 'finished';
    if (c.pit.phase === 'none') {
      c.pitApproach = false;
      if (!racing || c.finished || c.retired) return false;
      const want = c.isPlayer ? this.playerPitRequest : c.pitLap >= 0 && c.laps + 1 >= c.pitLap;
      if (!want) return false;
      const ahead = this.pitLane.toTakeover(c.car.s);
      if (ahead > 0) {
        if (ahead < 420) {
          c.pitApproach = true;
          // AI: over to the pit side of the road in good time
          if (c.ai && ahead < 380) c.ai.yieldSide = this.track.pit.side;
        }
        return false;
      }
      if (ahead < -30) return false;
      // AI: don't stack behind a team-mate already in the pit lane (unless the weather is turning)
      if (!c.isPlayer && !c.weatherCall && this.mateInPits(c) && c.laps + 2 <= this.opts.laps - 1) {
        c.pitLap = c.laps + 2;
        c.pitPlan = c.pitPlan.map((l) => (l <= c.laps + 1 ? c.laps + 2 : l));
        return false;
      }
      const teamIdx = TEAMS.indexOf(c.entry.team);
      this.pitLane.begin(c.pit, c.car, this.pitLane.boxFor(teamIdx), c.isPlayer ? this.playerNextCompound() : this.aiNextCompound(c));
      // a clean stop is 2.1–2.6 s; now and then a sticky wheel nut costs a second or so
      const slow = Math.random() < (c.isPlayer ? 0.05 : 0.12);
      c.pit.stopTime = 2.1 + Math.random() * 0.45 + (slow ? 0.6 + Math.random() * 0.9 : 0);
      c.pit.slow = slow ? Math.floor(Math.random() * 4) : -1;
      c.pit.prev = c.compound;
      if (c.isPlayer) this.events.push({ kind: 'pit-in', car: c.id });
    }
    const wasStopped = c.pit.phase === 'stop';
    const released = this.pitLane.update(h, c.pit, c.car, this.pitCars, {
      onStop: () => {
        c.car.repairFrontWing();
        c.stops++;
        c.pitLastLap = c.laps;
        if (c.isPlayer) this.playerPitRequest = false;
        else {
          c.weatherCall = false;
          c.pitPlan = c.pitPlan.filter((l) => l > c.laps + 2);
          c.pitLap = c.pitPlan.length ? c.pitPlan[0] : -1;
        }
      },
      onTyres: () => {
        // the old set is off: a brand-new set goes on (100 % life, out of the blankets)
        fitTyres(c.car, c.pit.next);
        c.compound = c.pit.next;
        if (!c.compoundsUsed.includes(c.pit.next)) c.compoundsUsed.push(c.pit.next);
      },
      onRelease: () => {
        c.ai?.startFrom(c.car, this.track);
        // (the exit waited for a gap: a short tail of protection while it blends in, then racing as usual)
        c.pitGhost = 2.5;
        c.pitGhostM = 160;
      },
    });
    if (wasStopped && c.pit.phase === 'out' && c.isPlayer) this.events.push({ kind: 'pit-stop', car: c.id, value: c.pit.timer });
    if (released && c.isPlayer) this.events.push({ kind: 'pit-out', car: c.id });
    return true;
  }

  /** mean tyre wear of a competitor, 0..1 */
  wearOf(c: Competitor): number {
    return (c.car.wear[0] + c.car.wear[1] + c.car.wear[2] + c.car.wear[3]) / 4;
  }

  resetCar(c: Competitor) {
    const s = c.car.s - 15;
    c.car.placeOnTrack(this.track, s, this.track.racingLineAt(s));
    c.car.setSpeed(8);
    c.car.gear = 2;
    c.ai?.startFrom(c.car, this.track);
  }

  private inRange(d: number, a: number, b: number) {
    return a <= b ? d >= a && d <= b : d >= a || d <= b;
  }

  private scoreCar(c: Competitor, dt: number) {
    const track = this.track;
    const L = track.length;
    const prev = c.lapDist;
    const d = track.lapDistance(c.car.s);
    c.lapDist = d;
    const racing = this.phase === 'racing' || this.phase === 'finished';
    if (!racing) {
      c.raceDist = c.laps * L + d;
      return;
    }
    const t = this.raceTime;
    const crossedLine = prev > L - 60 && d < 60;
    const crossedBack = prev < 60 && d > L - 60;
    if (crossedBack) c.laps--;
    if (crossedLine) {
      c.laps++;
      if (c.laps >= 1) {
        const lapTime = t - c.lapStart;
        c.lastLap = lapTime;
        c.lapTimes.push(lapTime);
        // sector 3 closes with the lap
        this.closeSector(c, 2, t);
        const valid = c.lapValid;
        if (valid && lapTime < c.bestLap) {
          c.bestLap = lapTime;
          if (c.isPlayer) {
            this.deltaBest = this.deltaCur.slice();
            this.deltaBest[this.deltaBest.length - 1] = lapTime;
          }
          if (lapTime < this.bestLap) {
            this.bestLap = lapTime;
            this.bestLapCar = c.id;
            this.events.push({ kind: 'fastest-lap', car: c.id, value: lapTime });
          } else if (c.isPlayer) this.events.push({ kind: 'personal-best', car: c.id, value: lapTime });
        }
        if (c.isPlayer) this.events.push({ kind: 'lap', car: c.id, value: lapTime, valid });
      }
      c.lapStart = t;
      c.sectorStart = t;
      c.sector = 0;
      c.lapValid = true;
      if (!this.isTimeTrial) {
        if (c.laps > this.leaderLaps) this.leaderLaps = c.laps;
        if (c.isPlayer && c.laps === this.opts.laps - 1) this.events.push({ kind: 'final-lap', car: c.id });
        if (!c.finished && !c.retired && (c.laps >= this.opts.laps || (this.phase === 'finished' && c.laps >= 1))) {
          c.finished = true;
          // two-compound rule: finishing a long race on one compound costs 30 s
          if (this.owesSecondCompound(c)) {
            c.penalty += 30;
            if (c.isPlayer) this.events.push({ kind: 'penalty', car: c.id, value: 30 });
          }
          c.finishTime = t + c.penalty;
          // cool-down lap
          if (c.ai) c.ai.pace *= 0.72;
          this.finishOrder.push(c.id);
          if (this.phase !== 'finished') this.phase = 'finished';
          this.events.push({ kind: 'finish', car: c.id });
        }
      }
    }
    // sectors
    if (c.laps >= 0) {
      if (c.sector === 0 && this.crossed(prev, d, this.sectorLapDist[0])) this.closeSector(c, 0, t);
      else if (c.sector === 1 && this.crossed(prev, d, this.sectorLapDist[1])) this.closeSector(c, 1, t);
    }
    this.trackLimits(c, dt);
    // DRS detection
    for (let zi = 0; zi < this.drsLapDist.length; zi++) {
      const z = this.drsLapDist[zi];
      if (this.crossed(prev, d, z.detect)) {
        const allowed = this.isTimeTrial || (c.laps >= 1 && !this.cars.some((o) => o.finished));
        const gap = this.gapToAhead(c);
        const was = c.drsEligible;
        c.drsEligible = allowed && (this.isTimeTrial || (gap > 0 && gap < 1.0));
        c.drsZone = zi;
        if (c.isPlayer && c.drsEligible && !was) this.events.push({ kind: 'drs-enabled', car: c.id });
      }
      if (c.drsZone === zi && this.crossed(prev, d, z.end)) {
        c.drsEligible = false;
      }
    }
    // live delta to the player's best lap (lap time sampled every 10 m)
    if (c.isPlayer && c.laps >= 0) {
      if (crossedLine) this.deltaCur.fill(-1);
      const lt = t - c.lapStart;
      const k = Math.min(this.deltaCur.length - 2, Math.floor(d / 10));
      if (this.deltaCur[k] < 0) this.deltaCur[k] = lt;
      const ref = this.deltaBest;
      if (ref && ref[k] >= 0 && ref[k + 1] >= 0) {
        const f = d / 10 - Math.floor(d / 10);
        this.playerDelta = lt - (ref[k] + (ref[k + 1] - ref[k]) * f);
      } else this.playerDelta = NaN;
    }
    // checkpoint timing for gaps
    const cp = Math.floor((c.laps * L + d) / CP);
    if (cp !== c.cpIndex && cp >= 0) {
      for (let k = Math.max(c.cpIndex + 1, cp - 5); k <= cp; k++) c.cpTimes[((k % CP_RING) + CP_RING) % CP_RING] = t;
      c.cpIndex = cp;
    }
    c.raceDist = c.laps * L + d;
  }

  /** track-limit warnings allowed before the next offence is a 5 s penalty */
  get limitWarnings(): number {
    return this.limitsMode === 'strict' ? 3 : 5;
  }

  get limitsMode(): TrackLimitsMode {
    return this.opts.trackLimits ?? 'lenient';
  }

  /**
   * Track limits, F1-game style. Strict: all four wheels off at speed is an
   * offence the moment it happens. Lenient: the excursion is judged when the car
   * is back on the road — it counts only if the car went well past the kerb, for
   * more than a moment, and covered that stretch faster than a clean lap at the
   * limit would (cutting a chicane, running wide flat out); running wide and
   * losing time is its own punishment. An offence deletes the lap; in a race it
   * is a warning, and after `limitWarnings` of them the next is +5 s.
   */
  private trackLimits(c: Competitor, dt: number) {
    const mode = this.limitsMode;
    const car = c.car;
    if (mode === 'off' || c.laps < 0 || c.pit.phase !== 'none' || c.retired) {
      c.limitsOff = false;
      c.exT = 0;
      return;
    }
    if (mode === 'strict') {
      const off = car.offTrack && car.speed > 15;
      if (off && !c.limitsOff) {
        c.limitsOff = true;
        this.limitsOffence(c);
      }
      if (!car.offTrack) c.limitsOff = false;
      return;
    }
    // lenient: track the excursion while all four wheels are off
    if (car.offTrack && car.speed > 15) {
      if (!c.limitsOff) {
        c.limitsOff = true;
        c.exT = 0;
        c.exExpect = 0;
        c.exFar = false;
        c.exS = car.s;
      }
      c.exT += dt;
      // how far past the kerb the car's centre is (all four wheels off ≈ 0.8 m)
      const side = car.lateral >= 0 ? 1 : -1;
      const past = Math.abs(car.lateral) - this.track.halfWidthAt(car.s) - this.track.kerbAt(car.s, side);
      if (past > LENIENT_MARGIN) c.exFar = true;
      // the time a clean lap at ~the limit takes over the ground covered
      const ds = Math.max(0, this.track.delta(c.exS, car.s));
      c.exS = car.s;
      c.exExpect += ds / Math.max(10, this.profile.atGrip(car.s, car.gripFactor) * 0.94);
    } else if (c.limitsOff) {
      c.limitsOff = false;
      const gained = c.exT < c.exExpect;
      if (c.exFar && c.exT > LENIENT_MIN_TIME && gained) this.limitsOffence(c);
      c.exT = 0;
    }
  }

  private limitsOffence(c: Competitor) {
    c.lapValid = false;
    if (this.isTimeTrial) {
      if (c.isPlayer) this.events.push({ kind: 'track-limits', car: c.id, value: 0 });
      return;
    }
    c.warnings++;
    if (c.warnings > this.limitWarnings) {
      c.warnings = 0;
      c.penalty += 5;
      if (c.isPlayer) this.events.push({ kind: 'penalty', car: c.id, value: 5 });
    } else if (c.isPlayer) this.events.push({ kind: 'track-limits', car: c.id, value: c.warnings });
  }

  private crossed(prev: number, cur: number, mark: number) {
    if (prev <= cur) return prev < mark && cur >= mark;
    return prev < mark || cur >= mark; // wrapped
  }

  private closeSector(c: Competitor, idx: number, t: number) {
    const st = t - c.sectorStart;
    c.sectorTimes[idx] = st;
    c.lastSectors[idx] = st;
    c.sectorStart = t;
    c.sector = idx + 1;
    if (c.laps < 0) return;
    let color: 'purple' | 'green' | 'yellow' = 'yellow';
    if (c.lapValid && st < this.bestSectors[idx]) {
      this.bestSectors[idx] = st;
      c.bestSectors[idx] = Math.min(c.bestSectors[idx], st);
      color = 'purple';
    } else if (c.lapValid && st < c.bestSectors[idx]) {
      c.bestSectors[idx] = st;
      color = 'green';
    }
    if (c.isPlayer) this.events.push({ kind: 'sector', car: c.id, sector: idx, value: st, color });
  }

  /** time gap to the car directly ahead on the road (s), 0 if none */
  gapToAhead(c: Competitor): number {
    const ahead = this.cars.find((o) => o.position === c.position - 1);
    if (!ahead) return 0;
    return this.timeGap(c, ahead);
  }

  private timeGap(c: Competitor, ahead: Competitor): number {
    if (c.cpIndex < 0) return 0;
    const k = c.cpIndex;
    if (ahead.cpIndex < k) return 0;
    if (ahead.cpIndex - k >= CP_RING - 10) return 999;
    const ta = ahead.cpTimes[((k % CP_RING) + CP_RING) % CP_RING];
    const tc = c.cpTimes[((k % CP_RING) + CP_RING) % CP_RING];
    if (ta < 0 || tc < 0) return 0;
    return Math.max(0, tc - ta);
  }

  private rankCars() {
    const sorted = this.cars.slice().sort((a, b) => {
      // finished cars: more laps first, then total time including penalties
      // retired cars drop behind everyone still running, in the order they got furthest
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      if (a.retired && b.retired) return b.raceDist - a.raceDist;
      if (a.finished && b.finished) return b.laps - a.laps || a.finishTime - b.finishTime;
      if (a.finished !== b.finished) {
        // a finished car is ahead of anyone on the same or fewer laps
        return a.finished ? -1 : 1;
      }
      return b.raceDist - a.raceDist;
    });
    const leader = sorted[0];
    sorted.forEach((c, i) => {
      c.position = i + 1;
      if (i === 0) {
        c.gapLeader = 0;
        c.gapAhead = 0;
      } else {
        const ahead = sorted[i - 1];
        const lapsDown = Math.floor((leader.raceDist - c.raceDist) / this.track.length);
        c.gapLeader = lapsDown >= 1 && !c.finished ? -lapsDown : c.finished && leader.finished ? c.finishTime - leader.finishTime : this.timeGap(c, leader);
        c.gapAhead = this.timeGap(c, ahead);
      }
    });
  }

  /**
   * Car-to-car contact: each car is three discs along its centreline (nose,
   * middle, gearbox). Overlaps are separated and resolved with an impulse at the
   * contact point — including rotation and tyre-on-tyre friction — so a tap on
   * the rear wheel turns a car around and a side-by-side rub just scrubs speed.
   */
  private collideCars() {
    const cars = this.cars;
    const R = 0.86;
    const OFFS = [1.75, 0, -1.8];
    for (let i = 0; i < cars.length; i++) {
      const A = cars[i].car;
      // cars in, entering or merging from the pit lane don't touch anyone
      if (this.isPitGhost(cars[i]) || cars[i].removed) continue;
      for (let j = i + 1; j < cars.length; j++) {
        if (this.isPitGhost(cars[j]) || cars[j].removed) continue;
        const B = cars[j].car;
        const dxc = A.x - B.x;
        const dzc = A.z - B.z;
        if (dxc * dxc + dzc * dzc > 36) continue;
        // a figure of eight (Suzuka): the car on the bridge and the one under it never touch
        if (Math.abs(this.track.delta(A.s, B.s)) > 60) continue;
        const sa = Math.sin(A.yaw), ca = Math.cos(A.yaw);
        const sb = Math.sin(B.yaw), cb = Math.cos(B.yaw);
        // deepest disc pair
        let best = 0, nx = 0, nz = 0, px = 0, pz = 0;
        for (const oa of OFFS) {
          const ax = A.x + sa * oa, az = A.z + ca * oa;
          for (const ob of OFFS) {
            const bx = B.x + sb * ob, bz = B.z + cb * ob;
            const ddx = ax - bx, ddz = az - bz;
            const d = Math.hypot(ddx, ddz);
            const pen = R * 2 - d;
            if (pen > best && d > 1e-4) {
              best = pen;
              nx = ddx / d;
              nz = ddz / d;
              px = (ax + bx) / 2;
              pz = (az + bz) / 2;
            }
          }
        }
        if (best <= 0) continue;
        // separate (equal masses)
        A.x += nx * best * 0.5;
        A.z += nz * best * 0.5;
        B.x -= nx * best * 0.5;
        B.z -= nz * best * 0.5;
        // relative velocity at the contact point (n points from B to A)
        const [avx, avz] = A.pointVelocity(px, pz);
        const [bvx, bvz] = B.pointVelocity(px, pz);
        const rvx = avx - bvx, rvz = avz - bvz;
        const vn = rvx * nx + rvz * nz;
        cars[i].contactTimer = 0.3;
        cars[j].contactTimer = 0.3;
        if (vn >= 0) continue;
        const m = A.spec.mass;
        const I = A.spec.iz;
        const rAn = (pz - A.z) * nx - (px - A.x) * nz;
        const rBn = (pz - B.z) * nx - (px - B.x) * nz;
        const e = 0.18;
        const jn = (-(1 + e) * vn) / (2 / m + (rAn * rAn) / I + (rBn * rBn) / I);
        // friction along the tangent (tyre on tyre / bodywork rub)
        let tx = rvx - vn * nx, tz = rvz - vn * nz;
        const vt = Math.hypot(tx, tz);
        let jt = 0;
        if (vt > 1e-3) {
          tx /= vt;
          tz /= vt;
          const rAt = (pz - A.z) * tx - (px - A.x) * tz;
          const rBt = (pz - B.z) * tx - (px - B.x) * tz;
          jt = Math.min(0.35 * jn, vt / (2 / m + (rAt * rAt) / I + (rBt * rBt) / I));
        }
        const jx = nx * jn - tx * jt;
        const jz = nz * jn - tz * jt;
        A.applyImpulse(px, pz, jx, jz);
        B.applyImpulse(px, pz, -jx, -jz);
        const strength = -vn;
        // a rub or a nudge isn't news: only a proper hit is reported
        if (strength > 4.5 && (cars[i].isPlayer || cars[j].isPlayer)) this.events.push({ kind: 'contact', car: cars[i].isPlayer ? i : j, value: strength });
        // bodywork damage on both cars where they touched (carbon on carbon, glancing: much softer than a wall)
        const localA = [(px - A.x) * sa + (pz - A.z) * ca, (px - A.x) * ca - (pz - A.z) * sa];
        const localB = [(px - B.x) * sb + (pz - B.z) * cb, (px - B.x) * cb - (pz - B.z) * sb];
        A.addImpact(localA[0], localA[1], strength * 0.75, px, pz, -nx, -nz);
        B.addImpact(localB[0], localB[1], strength * 0.75, px, pz, nx, nz);
      }
    }
  }

  // ------------------------------------------------------------------ dynamic difficulty

  /** Dynamic AI: the pace trim every AI car runs right now (1 ± DYN_TRIM) */
  aiTrim = 1;
  private aiTrimTarget = 1;
  private dynTimer = 0;
  /** time-weighted trim over the race (the post-race rating allows for it) */
  private trimSum = 0;
  private trimTime = 0;

  /**
   * Dynamic difficulty during the race: once a second, judge whether the player
   * is quicker or slower than the cars around them (last-lap pace against the
   * cars within three places, and whether they're alone out front or dropped off
   * the back), and ease every AI's pace by at most ±1.5%, over ~15 s. All the
   * cars move together, so the order among the AI never shuffles.
   */
  private dynamicPace(dt: number) {
    if (!this.opts.dynamicAI || this.isTimeTrial) return;
    if (this.phase === 'racing') {
      this.trimSum += this.aiTrim * dt;
      this.trimTime += dt;
    }
    this.dynTimer -= dt;
    if (this.dynTimer <= 0) {
      this.dynTimer = 1;
      this.aiTrimTarget = 1 + DYN_TRIM * this.paceSignal();
    }
    const step = (DYN_TRIM / 15) * dt;
    this.aiTrim += Math.max(-step, Math.min(step, this.aiTrimTarget - this.aiTrim));
    for (const c of this.cars) if (c.ai) c.ai.trim = this.aiTrim;
  }

  /** −1 … 1: + = the player is getting away from the AI around them (they should be a touch quicker) */
  private paceSignal(): number {
    const p = this.player;
    const hold = (this.aiTrimTarget - 1) / DYN_TRIM;
    if (this.phase !== 'racing' || this.raceTime < 30 || p.finished || p.retired || p.pit.phase !== 'none') return hold;
    const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
    // last-lap pace against the cars around (clean-ish laps only: no pit stops or big moments)
    let ePace = 0;
    let havePace = false;
    const fair = (c: Competitor) => c.laps >= 2 && c.lastLap > 0 && c.lastLap < Math.min(c.bestLap, 1e6) * 1.1;
    if (fair(p) || (p.laps >= 2 && !isFinite(p.bestLap) && p.lastLap > 0)) {
      const around = this.cars.filter((o) => o.ai && !o.retired && Math.abs(o.position - p.position) <= 3 && fair(o)).map((o) => o.lastLap);
      if (around.length >= 2) {
        const med = median(around);
        ePace = clamp((med - p.lastLap) / (med * 0.02), -1, 1);
        havePace = true;
      }
    }
    // gaps: leading and pulling away, or last and dropping away (seconds, capped)
    const ahead = this.cars.find((o) => o.position === p.position - 1);
    const behind = this.cars.find((o) => o.position === p.position + 1 && !o.retired && !o.finished);
    const gA = Math.min(30, p.gapAhead);
    const gB = behind ? Math.min(30, behind.gapAhead) : 0;
    let eGap = 0;
    if (!ahead && behind) eGap = clamp((gB - 3) / 10, 0, 1);
    else if (ahead && !behind) eGap = -clamp((gA - 3) / 10, 0, 1);
    else if (ahead && behind) {
      const x = gB - gA;
      eGap = Math.sign(x) * clamp((Math.abs(x) - 4) / 12, 0, 1) * 0.5;
    }
    return clamp(havePace ? 0.6 * ePace + 0.4 * eGap : eGap, -1, 1);
  }

  /**
   * Dynamic difficulty after the race: the AI level (fraction of the limit) for
   * the next one. Mostly the lap-time comparison — the player's typical clean lap
   * against the field's, converted to the pace that would match it — plus a
   * nudge from the result. Can move up to ±6% in one race.
   */
  rateAiSkill(): number {
    const old = this.opts.difficulty;
    const p = this.player;
    const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
    // typical clean racing lap: no standing start, no cool-down lap, nothing 7% off the best
    const clean = (c: Competitor) => {
      const laps = c.lapTimes.slice(1, this.opts.laps);
      if (!laps.length) return NaN;
      const best = Math.min(...laps);
      return median(laps.filter((t) => t < best * 1.07));
    };
    const n = this.cars.length;
    const result = p.retired ? -0.012 : clamp((n * 0.4 - p.position) * 0.0025, -0.025, 0.02);
    let next = old + result;
    const mine = clean(p);
    const field = this.cars.filter((c) => c.ai).map(clean).filter((t) => isFinite(t));
    if (isFinite(mine) && field.length >= 3) {
      const trim = this.trimTime > 0 ? this.trimSum / this.trimTime : 1;
      // a lap ≈ fixed part + a pace-sensitive part (~65% at the limit) / pace
      const ratio = mine / median(field);
      const match = old * trim * (1 - (ratio - 1) / 0.65);
      next = old + (match - old) * 0.75 + result * 0.5;
    }
    return clamp(old + clamp(next - old, -0.06, 0.06), AI_SKILL.min, AI_SKILL.max);
  }

  /** classification rows for the results screen */
  classification() {
    const L = this.track.length;
    return this.cars
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        pos: c.position,
        entry: c.entry,
        isPlayer: c.isPlayer,
        laps: Math.max(0, c.laps),
        time: c.finished ? c.finishTime : NaN,
        gap: c.position === 1 ? 0 : c.gapLeader,
        best: c.bestLap,
        penalty: c.penalty,
        fastest: c.id === this.bestLapCar,
        raceDist: c.raceDist / L,
        dnf: c.retired,
      }));
  }
}

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
