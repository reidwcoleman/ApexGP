import * as THREE from 'three';

/**
 * What the crowds and the trackside people react to, as shared uniforms and a little
 * state: where every car is along the track (and how exciting it is: the leader, a
 * battle, the player), hotspots where something happened (an overtake, a spin, a wreck,
 * the finish), an occasional Mexican wave rolling along the stands, and the flags the
 * marshals should be showing. Game feeds it the race once a frame (update); the
 * grandstand and bank crowds read the uniforms in their vertex shader (REACT_GLSL:
 * everything is in track distance, so a stand needs only its fans' `s`), the marshals and
 * the pit wall read the state.
 */

export const MAX_CARS = 24;
export const MAX_HOT = 6;

export interface ReactRacer {
  id: number;
  position: number;
  finished: boolean;
  retired: boolean;
  removed: boolean;
  blueFlag: boolean;
  gapAhead: number;
  isPlayer?: boolean;
  entry: { team: object };
  car: { s: number; vx: number };
  pit: { phase: string };
}

export interface ReactRace {
  cars: ReactRacer[];
  phase: string;
  raceTime: number;
  vsc: string;
  events: { kind: string; car: number; value?: number }[];
  track: { length: number };
}

export const crowdUniforms = {
  uCarS: { value: new Float32Array(MAX_CARS).fill(-1e6) },
  uCarW: { value: new Float32Array(MAX_CARS) },
  /** hotspots: (s, strength, radius, 0) */
  uHot: { value: Array.from({ length: MAX_HOT }, () => new THREE.Vector4(-1e6, 0, 60, 0)) },
  /** Mexican wave: (front s, width, strength, 0) */
  uMex: { value: new THREE.Vector4(-1e6, 9, 0, 0) },
  uTrackLen: { value: 5000 },
  /** 0 a race on … 1 nothing happening (the menu, the grid before the lights) */
  uQuiet: { value: 1 },
};

/**
 * GLSL (vertex): excitement at track distance `s` (0 calm … ~3 on their feet and roaring).
 * Cars excite the stand as they come (from ~150 m) and as they go by; hotspots and the wave add.
 */
export const REACT_GLSL = /* glsl */ `
uniform float uCarS[ ${MAX_CARS} ]; uniform float uCarW[ ${MAX_CARS} ];
uniform vec4 uHot[ ${MAX_HOT} ]; uniform vec4 uMex; uniform float uTrackLen; uniform float uQuiet;
float reactWrap( float d ) { return d - uTrackLen * floor( d / uTrackLen + 0.5 ); }
float crowdExcite( float s ) {
  float e = 0.0;
  for ( int i = 0; i < ${MAX_CARS}; i ++ ) {
    float d = reactWrap( s - uCarS[ i ] );
    // ahead of the car (it's coming): a long build-up; behind (it's gone): a short tail
    float w = d > 0.0 ? d / 130.0 : d / 55.0;
    e += uCarW[ i ] * exp( - w * w );
  }
  for ( int i = 0; i < ${MAX_HOT}; i ++ ) {
    float d = reactWrap( s - uHot[ i ].x ) / uHot[ i ].z;
    e += uHot[ i ].y * exp( - d * d );
  }
  float m = reactWrap( s - uMex.x ) / uMex.y;
  e += uMex.z * exp( - m * m );
  return e * ( 1.0 - 0.8 * uQuiet );
}
`;

interface Hot {
  s: number;
  strength: number;
  radius: number;
  life: number;
  age: number;
}

class CrowdReactions {
  /** track distances of the flags the marshals wave: yellow (incidents), blue (a car about to be lapped) */
  yellow: number[] = [];
  blue: number[] = [];
  /** the whole track under a virtual safety car */
  vsc = false;
  /** the race is on (the marshals stand ready, the crowd follows the cars) */
  live = false;
  /** a team celebrating (the winner's): its Team, seconds left */
  celebrate: { team: object; t: number } | null = null;
  private hot: Hot[] = [];
  private lastPos = new Map<number, number>();
  private mexT = 40;
  private mexS = -1e6;
  private mexLeft = 0;
  private incidents = new Map<number, number>();
  private readonly s = crowdUniforms;
  /** where the stands are (track distance ranges), for the Mexican wave to start in one */
  stands: [number, number][] = [];

  /** the circuit changed: stands (s ranges) and the track length */
  setTrack(length: number, stands: [number, number][]) {
    this.s.uTrackLen.value = length;
    this.stands = stands;
    this.hot.length = 0;
    this.lastPos.clear();
    this.incidents.clear();
    this.celebrate = null;
  }

  private addHot(s: number, strength: number, radius: number, life: number) {
    // merge into one close by
    for (const h of this.hot) {
      if (Math.abs(h.s - s) < radius * 0.6) {
        h.strength = Math.max(h.strength * (1 - h.age / h.life), strength);
        h.age = 0;
        h.life = Math.max(h.life, life);
        h.s = s;
        return;
      }
    }
    if (this.hot.length >= MAX_HOT) {
      this.hot.sort((a, b) => b.strength * (1 - b.age / b.life) - a.strength * (1 - a.age / a.life));
      this.hot.length = MAX_HOT - 1;
    }
    this.hot.push({ s, strength, radius, life, age: 0 });
  }

  /** calm everything down (menus, replays) */
  quiet(dt: number) {
    this.live = false;
    this.s.uQuiet.value = Math.min(1, this.s.uQuiet.value + dt * 0.5);
  }

  private race: ReactRace | null = null;

  update(dt: number, race: ReactRace) {
    const U = this.s;
    if (race !== this.race) {
      // a new session: forget the last one
      this.race = race;
      this.hot.length = 0;
      this.lastPos.clear();
      this.incidents.clear();
      this.celebrate = null;
      this.mexLeft = 0;
    }
    const L = race.track.length;
    U.uTrackLen.value = L;
    const racing = race.phase === 'racing' || race.phase === 'finished';
    this.live = racing || race.phase === 'lights';
    const wantQuiet = racing ? 0 : race.phase === 'lights' ? 0.35 : 0.8;
    U.uQuiet.value += (wantQuiet - U.uQuiet.value) * Math.min(1, dt * 1.5);
    this.vsc = race.vsc !== 'none';
    // cars
    const cars = race.cars;
    let lead: ReactRacer | null = null;
    for (const c of cars) if (!c.retired && (!lead || c.position < lead.position)) lead = c;
    for (let i = 0; i < MAX_CARS; i++) {
      const c = cars[i];
      if (!c || c.removed || (c.retired && c.car.vx < 1)) {
        U.uCarS.value[i] = -1e6;
        U.uCarW.value[i] = 0;
        continue;
      }
      let w = 0.55;
      if (c === lead) w += 0.7;
      if (c.isPlayer) w += 0.2;
      if (c.gapAhead > 0 && c.gapAhead < 0.7 && c.position > 1) w += 0.45;
      if (c.pit.phase !== 'none') w *= 0.4;
      if (c.finished) w *= 0.6;
      w *= THREE.MathUtils.clamp(c.car.vx / 40, 0.2, 1);
      U.uCarS.value[i] = c.car.s;
      U.uCarW.value[i] = w;
    }
    // overtakes: a car that gained a place since the last frame, on the track
    if (race.phase === 'racing') {
      for (const c of cars) {
        const was = this.lastPos.get(c.id);
        if (was !== undefined && c.position < was && !c.retired && c.pit.phase === 'none' && race.raceTime > 4) this.addHot(c.car.s, c.position <= 3 ? 1.8 : 1.2, 70, 4);
        this.lastPos.set(c.id, c.position);
      }
    }
    // incidents: spins and mistakes, damage, a car stopped
    for (const e of race.events) {
      const c = cars.find((x) => x.id === e.car);
      if (!c) continue;
      if (e.kind === 'mistake' || e.kind === 'damage' || e.kind === 'contact') {
        this.addHot(c.car.s, 1.4, 80, 5);
        this.incidents.set(c.id, 10);
      } else if (e.kind === 'retired') {
        this.addHot(c.car.s, 2.2, 90, 8);
        this.incidents.set(c.id, 30);
      } else if (e.kind === 'lights-out') this.addHot(c.car.s, 2.5, 300, 8);
      else if (e.kind === 'finish' && c.position === 1) {
        this.addHot(c.car.s, 3, 250, 16);
        this.celebrate = { team: c.entry.team, t: 60 };
      }
    }
    // yellow flags: incidents (and cars stopped on the track), blue: cars about to be lapped
    this.yellow.length = 0;
    this.blue.length = 0;
    for (const c of cars) {
      let t = this.incidents.get(c.id) ?? 0;
      if (c.retired && !c.removed) t = Math.max(t, 1);
      if (t > 0) {
        this.yellow.push(c.car.s);
        this.incidents.set(c.id, t - dt);
      }
      if (c.blueFlag && racing) this.blue.push(c.car.s);
    }
    // hotspots fade
    for (const h of this.hot) h.age += dt;
    this.hot = this.hot.filter((h) => h.age < h.life);
    for (let i = 0; i < MAX_HOT; i++) {
      const h = this.hot[i];
      const v = U.uHot.value[i];
      if (!h) v.set(-1e6, 0, 60, 0);
      else {
        const k = h.age / h.life;
        v.set(h.s, h.strength * Math.min(1, h.age * 3) * (1 - k * k), h.radius, 0);
      }
    }
    // now and then a Mexican wave rolls along a stand (not while cars are on the stand)
    if (racing && this.stands.length) {
      if (this.mexLeft > 0) {
        this.mexS += dt * 14;
        this.mexLeft -= dt * 14;
        U.uMex.value.set(this.mexS, 10, Math.min(1.6, this.mexLeft / 20, 1.6), 0);
      } else {
        U.uMex.value.z = 0;
        this.mexT -= dt;
        if (this.mexT <= 0) {
          this.mexT = 45 + Math.random() * 60;
          const [a, b] = this.stands[Math.floor(Math.random() * this.stands.length)];
          // only if no car is within 250 m
          const near = cars.some((c) => !c.retired && Math.abs(((c.car.s - a + L * 1.5) % L) - L / 2) < 250);
          if (!near && b - a > 60) {
            this.mexS = a;
            this.mexLeft = b - a + 60;
          }
        }
      }
    } else U.uMex.value.z = 0;
    if (this.celebrate) {
      this.celebrate.t -= dt;
      if (this.celebrate.t <= 0) this.celebrate = null;
    }
  }
}

export const crowdReactions = new CrowdReactions();
