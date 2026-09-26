import { CAMERA_GROUP, type CameraMode, type Cameras } from './Cameras.ts';
import type { ReplayEvent } from './Replay.ts';
import type { Track } from '../world/Track.ts';

/** what the director needs to know about each car (live or from the recording) */
export interface FieldCar {
  id: number;
  s: number;
  speed: number;
  position: number;
  pit: boolean;
  /** retired (and not a fresh crash worth showing) */
  out: boolean;
  finished: boolean;
}

type Context = 'crash' | 'battle' | 'overtake' | 'pit' | 'start' | 'finish' | 'normal';

const CONTEXT_LABEL: Record<Context, string> = {
  crash: 'Incident',
  battle: 'Battle',
  overtake: 'Overtake',
  pit: 'Pit stop',
  start: 'Race start',
  finish: 'Chequered flag',
  normal: '',
};

/**
 * The automatic TV director: picks the car worth watching (an incident, a
 * battle within a second, an overtake, a pit stop, the leader, the player) and
 * cuts between cameras that suit the moment — trackside cameras chosen by
 * where the car is on the lap, onboards, the helicopter — holding each shot
 * 4–8 s and never cutting to the same angle twice running.
 */
export class Director {
  focus = 0;
  mode: CameraMode = 'tv';
  /** why we're watching this car ('Battle for P4'…), '' when nothing special */
  caption = '';
  /** true on the frame a new shot starts */
  cutNow = false;
  private age = 0;
  private len = 5;
  private history: CameraMode[] = [];
  private score = new Float32Array(0);
  private partner = new Int16Array(0);
  private byPos: FieldCar[] = [];
  private context: Context = 'normal';
  private started = false;
  private evalT = 0;

  reset(focus: number) {
    this.focus = focus;
    this.age = 0;
    this.len = 0;
    this.history.length = 0;
    this.started = false;
    this.caption = '';
  }

  /**
   * Advance by dt (seconds of race), at session time t. `events` are the
   * recorded moments; in a replay `lookahead` > 0 lets the director cut to a
   * car a few seconds before something happens to it, as a real replay does.
   */
  update(dt: number, t: number, raceTime: number, field: FieldCar[], events: readonly ReplayEvent[], lookahead: number, cams: Cameras, track: Track, playerId: number) {
    this.cutNow = false;
    this.age += dt;
    const n = field.length;
    if (this.score.length !== n) {
      this.score = new Float32Array(n);
      this.partner = new Int16Array(n);
    }
    this.evalT -= dt;
    const shotOver = this.age >= this.len || !this.started;
    if (this.evalT > 0 && !shotOver) {
      // mid-shot: only a trackside camera that has lost the car ends early
      const f = field[this.focus];
      if (f && this.age > 2.5 && CAMERA_GROUP[this.mode] === 'trackside' && this.mode !== 'tv' && !cams.covers(this.mode, f.s)) this.cut(field, cams, track, raceTime);
      return;
    }
    this.evalT = 0.5;
    this.rate(t, raceTime, field, events, lookahead, track, playerId);
    // the best car now
    let best = this.focus;
    for (let i = 0; i < n; i++) if (this.score[i] > this.score[best]) best = i;
    const urgent = best !== this.focus && this.score[best] - this.score[this.focus] > 55 && this.age > 1.2;
    if (shotOver || urgent) {
      this.focus = best;
      this.cut(field, cams, track, raceTime);
    }
  }

  /** how interesting each car is right now */
  private rate(t: number, raceTime: number, field: FieldCar[], events: readonly ReplayEvent[], lookahead: number, track: Track, playerId: number) {
    const n = field.length;
    const sc = this.score;
    this.byPos.length = 0;
    for (const f of field) this.byPos[f.position - 1] = f;
    for (let i = 0; i < n; i++) {
      sc[i] = 0;
      this.partner[i] = -1;
    }
    const ctx: Context[] = new Array(n).fill('normal');
    for (const f of field) {
      const i = f.id;
      if (f.out) {
        sc[i] = -100;
        continue;
      }
      if (f.position === 1) sc[i] += 18;
      if (i === playerId) sc[i] += 14;
      sc[i] += Math.max(0, 10 - f.position) * 0.8;
      if (f.pit) {
        sc[i] += 26;
        ctx[i] = 'pit';
      }
      if (f.finished) sc[i] -= 30;
      // a battle: within a second of the car ahead on the road
      const ahead = this.byPos[f.position - 2];
      if (ahead && !ahead.out && !ahead.pit && !f.pit && !f.finished && f.speed > 20 && raceTime > 3) {
        const d = track.delta(f.s, ahead.s);
        const gap = d / Math.max(25, f.speed);
        if (d > 0 && gap < 1.0) {
          sc[i] += 30 + (1 - gap) * 20 + Math.max(0, 10 - f.position) * 1.5;
          this.partner[i] = ahead.id;
          if (ctx[i] === 'normal') ctx[i] = 'battle';
        }
      }
    }
    if (raceTime < 14) {
      const lead = this.byPos[0];
      if (lead) {
        sc[lead.id] += 45;
        ctx[lead.id] = 'start';
      }
    }
    // recent (and, in a replay, imminent) moments
    for (let k = events.length - 1; k >= 0; k--) {
      const e = events[k];
      if (e.t < t - 10) break;
      if (e.t > t + lookahead) continue;
      const age = t - e.t;
      const i = e.car;
      if (i < 0 || i >= n) continue;
      switch (e.kind) {
        case 'crash':
        case 'retired':
          if (age < 8) {
            sc[i] += e.kind === 'crash' ? 110 : 60;
            ctx[i] = 'crash';
            if (field[i].out && age < 8) sc[i] = Math.max(sc[i], 90);
          }
          break;
        case 'spin':
          if (age < 6) {
            sc[i] += 75;
            ctx[i] = 'crash';
          }
          break;
        case 'overtake':
        case 'lead':
          if (age < 5) {
            sc[i] += e.kind === 'lead' ? 80 : 60;
            ctx[i] = 'overtake';
            this.partner[i] = e.other;
          }
          break;
        case 'fastest':
          if (age < 4) sc[i] += 22;
          break;
        case 'finish':
          if (age < 7 && field[i].position <= 3) {
            sc[i] += 100;
            ctx[i] = 'finish';
          }
          break;
      }
    }
    // stick with the car we're on (no ping-pong)
    if (this.focus < n) sc[this.focus] += 20;
    this.context = ctx[this.focus] ?? 'normal';
    this.contexts = ctx;
  }
  private contexts: Context[] = [];

  /** choose the next shot for the focused car */
  private cut(field: FieldCar[], cams: Cameras, track: Track, raceTime: number) {
    const f = field[this.focus];
    if (!f) return;
    const ctx = this.contexts[this.focus] ?? 'normal';
    this.context = ctx;
    const s = f.s;
    const ahead = s + Math.min(160, f.speed * 2.5);
    const covers = (m: CameraMode) => cams.covers(m, s) && cams.covers(m, ahead);
    const w: [CameraMode, number][] = [];
    const add = (m: CameraMode, weight: number) => {
      if (weight > 0) w.push([m, weight]);
    };
    const start = ctx === 'start' || raceTime < 14;
    const crash = ctx === 'crash';
    const battle = ctx === 'battle' || ctx === 'overtake';
    const pit = ctx === 'pit' || f.pit;
    // trackside, by where the car is on the lap
    add('tv', 3 * (crash ? 2 : 1) * (battle ? 1.4 : 1));
    if (covers('tower')) add('tower', 1.6 * (crash ? 2 : 1));
    if (covers('longlens')) add('longlens', 2.2 * (battle ? 1.4 : 1));
    if (covers('kerb')) add('kerb', 1.2);
    if (covers('grandstand')) add('grandstand', 1 * (start ? 2 : 1));
    if (cams.covers('pitwall', s)) add('pitwall', pit ? 5 : 1.2);
    if (covers('gantry')) add('gantry', start || ctx === 'finish' ? 4 : 0.8);
    // onboards (not for a car that's crashing or crawling in the pit lane)
    const ob = crash ? 0.15 : pit ? 0.5 : start ? 0.6 : 1;
    add('tcam', 2.2 * ob * (battle ? 1.3 : 1));
    add('cockpit', 1.1 * ob);
    add('nose', 0.7 * ob);
    add('fwing', 0.5 * ob);
    add('sidepod', 0.6 * ob);
    add('wheel', 0.7 * ob);
    add('wheelr', 0.45 * ob);
    add('tcamrev', (battle ? 1.2 : 0.3) * ob);
    add('rwing', 0.5 * ob);
    // chase, drone and cinematic
    add('drone', 1.3 * (crash ? 1.2 : 1));
    add('cine', pit || ctx === 'finish' ? 2 : 0.4);
    add('chase', 0.3);
    // aerial
    add('heli', 1.6 * (crash || start ? 2 : 1) * (battle ? 1.3 : 1));
    add('blimp', start ? 1.8 : 0.5);
    add('topdown', battle ? 1.1 : 0.35);

    // no jump cuts: never the same angle twice running, rarely a recent one, and a change of group on the same car
    const last = this.history[this.history.length - 1];
    const prevGroup = last ? CAMERA_GROUP[last] : null;
    let total = 0;
    for (const e of w) {
      if (e[0] === last) e[1] = 0;
      else if (this.history.includes(e[0])) e[1] *= 0.3;
      if (prevGroup && CAMERA_GROUP[e[0]] === prevGroup && prevGroup !== 'trackside') e[1] *= 0.35;
      total += e[1];
    }
    let r = Math.random() * total;
    let pick: CameraMode = w[0]?.[0] ?? 'tv';
    for (const e of w) {
      r -= e[1];
      if (r <= 0 && e[1] > 0) {
        pick = e[0];
        break;
      }
    }
    this.caption = this.captionFor(ctx, field);
    // in a battle, sometimes show it from the car ahead looking back
    if (battle && pick === 'tcamrev' && this.partner[this.focus] >= 0 && ctx === 'battle') this.focus = this.partner[this.focus];
    this.mode = pick;
    this.history.push(pick);
    if (this.history.length > 4) this.history.shift();
    const g = CAMERA_GROUP[pick];
    this.len = g === 'trackside' ? 4.5 + Math.random() * 3.5 : g === 'onboard' ? 4 + Math.random() * 3 : 5 + Math.random() * 3;
    if (crash) this.len += 1.5;
    this.age = 0;
    this.started = true;
    this.cutNow = true;
  }

  private captionFor(ctx: Context, field: FieldCar[]): string {
    const f = field[this.focus];
    if (!f) return '';
    if (ctx === 'battle') return `Battle for P${Math.max(1, f.position - 1)}`;
    if (ctx === 'normal') return f.position === 1 ? 'Race leader' : '';
    return CONTEXT_LABEL[ctx];
  }
}
