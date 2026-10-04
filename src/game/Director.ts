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

type Context = 'crash' | 'battle' | 'overtake' | 'pit' | 'start' | 'finish' | 'vsc' | 'normal';

const CONTEXT_LABEL: Record<Context, string> = {
  crash: 'Incident',
  battle: 'Battle',
  overtake: 'Overtake',
  pit: 'Pit stop',
  start: 'Race start',
  finish: 'Chequered flag',
  vsc: 'Virtual safety car',
  normal: '',
};

/**
 * The automatic TV director: picks the car worth watching (an incident, a
 * battle within a second, an overtake, a pit stop, the leader, the player) and
 * cuts between cameras that suit the moment — trackside cameras chosen by
 * where the car is on the lap, onboards, the helicopter — holding each shot
 * 7–13 s (real time, whatever the simulation speed) and never cutting to the same angle twice running.
 */
export class Director {
  focus = 0;
  mode: CameraMode = 'tv';
  /** why we're watching this car ('Battle for P4'…), '' when nothing special */
  caption = '';
  /** true on the frame a new shot starts */
  cutNow = false;
  /** follow only this car (−1: the director picks) — it still chooses the cameras */
  lock = -1;
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
    // (a trackside shot whose camera has just moved on to the next corner gets to show that angle)
    const shotOver = (this.age >= this.len && cams.angleAge > 3) || this.age >= this.len + 4 || !this.started;
    if (this.evalT > 0 && !shotOver) {
      // mid-shot: only a trackside camera that has lost the car ends early
      const f = field[this.focus];
      if (f && this.age > 4 && CAMERA_GROUP[this.mode] === 'trackside' && this.mode !== 'tv' && !cams.covers(this.mode, f.s)) this.cut(field, cams, track, raceTime);
      // the trackside camera lost the car behind something for a while: to a camera that can't be blocked
      else if (f && this.age > 2 && CAMERA_GROUP[this.mode] === 'trackside' && cams.lost) this.cut(field, cams, track, raceTime, true);
      return;
    }
    this.evalT = 0.5;
    this.rate(t, raceTime, field, events, lookahead, track, playerId);
    // the best car now
    let best = this.focus;
    for (let i = 0; i < n; i++) if (this.score[i] > this.score[best]) best = i;
    if (this.lock >= 0 && this.lock < n) best = this.lock;
    // (a real director lets a shot breathe: only a crash, a spin or the lead changing hands cuts a shot short)
    const urgent = best !== this.focus && this.score[best] - this.score[this.focus] > 70 && this.age > 5;
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
        case 'vsc':
          // the car that caused it: straight to the incident
          if (age < 12) {
            sc[i] += 130;
            ctx[i] = 'vsc';
          }
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
  private cut(field: FieldCar[], cams: Cameras, track: Track, raceTime: number, noTrackside = false) {
    const f = field[this.focus];
    if (!f) return;
    const ctx = this.contexts[this.focus] ?? 'normal';
    this.context = ctx;
    const s = f.s;
    const ahead = s + Math.min(160, f.speed * 2.5);
    const covers = (m: CameraMode) => cams.covers(m, s) && cams.covers(m, ahead);
    const w: [CameraMode, number][] = [];
    // sped up, the cars flash through a trackside camera's stretch: ride with them instead
    const fast = cams.timeScale > 1.5;
    const add = (m: CameraMode, weight: number) => {
      const g = CAMERA_GROUP[m];
      if (fast && g === 'trackside') weight *= 0.2;
      if (weight > 0 && !(noTrackside && g === 'trackside')) w.push([m, weight]);
    };
    const start = ctx === 'start' || raceTime < 14;
    const crash = ctx === 'crash' || ctx === 'vsc';
    const battle = ctx === 'battle' || ctx === 'overtake';
    const pit = ctx === 'pit' || f.pit;
    // trackside, by where the car is on the lap
    // (the broadcast mix: about two shots in three from the trackside cameras, mostly long lenses)
    add('tv', 4.6 * (crash ? 2 : 1) * (battle ? 1.4 : 1));
    if (covers('tower')) add('tower', 1.6 * (crash ? 2 : 1));
    if (covers('longlens')) add('longlens', 3.6 * (battle ? 1.4 : 1));
    if (covers('kerb')) add('kerb', 1.2);
    if (covers('grandstand')) add('grandstand', 1 * (start ? 2 : 1));
    if (cams.covers('pitwall', s)) add('pitwall', pit ? 5 : 1.2);
    if (covers('gantry')) add('gantry', start || ctx === 'finish' ? 4 : 0.8);
    // onboards (not for a car that's crashing or crawling in the pit lane)
    const ob = crash ? 0.15 : pit ? 0.5 : start ? 0.6 : 1;
    add('tcam', 2.2 * ob * (battle ? 1.3 : 1));
    add('cockpit', 1.1 * ob);
    add('nose', 0.3 * ob);
    add('fwing', 0.25 * ob);
    add('sidepod', 0.3 * ob);
    add('wheel', 0.2 * ob);
    add('wheelr', 0.12 * ob);
    add('tcamrev', (battle ? 1.2 : 0.3) * ob);
    add('sideback', (battle ? 0.5 : 0.15) * ob);
    add('bumper', 0.2 * ob);
    add('rwing', 0.4 * ob);
    // (the halo cam stays out of the mix: the highlights studio only hides the driver for the cockpit)
    // chase, drone and cinematic; the long-lens chase stacks a battle up in one frame
    add('gtchase', (crash || pit ? 0.3 : 1.3) * (battle ? 1.6 : 1));
    add('drone', 0.8 * (crash ? 1.4 : 1));
    add('cine', pit || ctx === 'finish' ? 1.6 : 0.4);
    add('chase', 0.3);
    add('lowchase', pit ? 0 : 0.35);
    // aerial
    add('heli', 1.6 * (crash || start ? 2 : 1) * (battle ? 1.3 : 1));
    add('blimp', start ? 1.4 : 0.2);
    add('topdown', battle ? 0.25 : 0.05);

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
    if (this.lock < 0 && battle && pick === 'tcamrev' && this.partner[this.focus] >= 0 && ctx === 'battle') this.focus = this.partner[this.focus];
    this.mode = pick;
    this.history.push(pick);
    if (this.history.length > 4) this.history.shift();
    const g = CAMERA_GROUP[pick];
    // long, calm shots: a trackside camera follows the car through its whole corner, an onboard lets
    // a straight and a braking zone play out, the aerials hold a wide stretch of the lap
    this.len = g === 'trackside' ? 8 + Math.random() * 5 : g === 'onboard' ? 7 + Math.random() * 5 : g === 'aerial' ? 8 + Math.random() * 6 : 8 + Math.random() * 5;
    if (crash) this.len += 2.5;
    if (start) this.len += 3;
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

  /**
   * Highlights (career/clip): the shot this director would cut to for car `id` in a given
   * context, drawn from `groups` when given (a few draws, then whatever came up last). The
   * no-repeat history carries over between calls, so successive shots vary. `focus` may move
   * to the car ahead (a rear-facing battle shot).
   */
  pickShot(id: number, context: Context, field: FieldCar[], cams: Cameras, track: Track, raceTime: number, groups?: readonly string[]): CameraMode {
    this.focus = id;
    while (this.contexts.length < field.length) this.contexts.push('normal');
    this.contexts[id] = context;
    for (let i = 0; i < 16; i++) {
      this.focus = id;
      this.cut(field, cams, track, raceTime);
      if (!groups || groups.includes(CAMERA_GROUP[this.mode])) break;
    }
    return this.mode;
  }
}

export type DirectorContext = Context;
