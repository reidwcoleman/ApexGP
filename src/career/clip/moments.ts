import { RF, type ReplayBuffer, type ReplayEvent } from '../../game/Replay.ts';
import type { CameraMode } from '../../game/Cameras.ts';
import type { DirectorContext } from '../../game/Director.ts';
import type { Track } from '../../world/Track.ts';
import type { WeatherState } from '../../world/Weather.ts';
import type { Entry } from '../../race/Teams.ts';
import { fmtTime } from '../../ui/HUD.ts';

/**
 * Finding a race's real moments in its recording, and planning each one as a short broadcast
 * package: the shots (time slice, speed, car, the kind of camera the director should use), the
 * words for the lower third, and a score for how much it's worth keeping.
 */

export type MomentKind = 'win' | 'podium' | 'lead' | 'overtake' | 'fastest' | 'finish' | 'pole' | 'save' | 'start' | 'crash' | 'spin' | 'battle';

export interface RaceCar {
  id: number;
  entry: Entry;
  code: string;
  first: string;
  last: string;
  /** team colour for the graphics */
  color: string;
  compound: string;
}

/** everything a finished session leaves for the highlights to be produced from */
export interface RaceInfo {
  id: string;
  replay: ReplayBuffer;
  track: Track;
  trackId: string;
  trackName: string;
  trackShort: string;
  laps: number;
  playerId: number;
  /** a simulated race: nobody's own moments */
  spectating: boolean;
  cars: RaceCar[];
  date: number;
  weather: WeatherState;
  /** the player's result ('P3', 'DNF') for the reel */
  result: string;
  /** the top three's names, for the podium's lower third */
  podium: string;
}

export interface ShotPlan {
  t0: number;
  t1: number;
  /** playback speed (0.5 = half-speed slow motion) */
  speed: number;
  focus: number;
  ctx: DirectorContext;
  /** a fixed camera, else the director picks from these groups */
  mode?: CameraMode;
  groups?: string[];
}

export interface MomentPlan {
  kind: MomentKind;
  /** replay time of the moment itself */
  t: number;
  score: number;
  kicker: string;
  title: string;
  sub: string;
  color: string;
  /** the cars it's about (lit in the tower) */
  cars: number[];
  lap: number;
  shots: ShotPlan[];
  from: number;
  to: number;
  /** the player took part */
  mine: boolean;
}

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** where on the lap s is: the corner's name, the main straight, or '' */
function whereAt(track: Track, s: number): string {
  for (const c of track.corners) if (track.delta(c.sStart - 70, s) >= 0 && track.delta(s, c.sEnd + 40) >= 0) return c.name;
  if (Math.abs(track.delta(track.startS, s)) < 300) return 'the main straight';
  return '';
}

/**
 * Analyse a recording and plan its best moments. A generator: it yields every few dozen
 * replay samples so the work can be spread over frames.
 */
export function* planMoments(info: RaceInfo, max = 7): Generator<void, MomentPlan[]> {
  const R = info.replay;
  const track = info.track;
  const L = track.length;
  const t0 = R.startTime + 0.3, t1 = R.endTime - 0.3;
  if (t1 - t0 < 8) return [];
  const car = (id: number) => info.cars[id];
  const P = info.spectating ? 0 : 1;
  const me = info.playerId;
  const clampShot = (s: ShotPlan): ShotPlan | null => {
    const a = Math.max(t0, s.t0), b = Math.min(t1, s.t1);
    return b - a >= 0.9 ? { ...s, t0: a, t1: b } : null;
  };
  const at = (t: number) => R.apply(Math.max(t0, Math.min(t1, t)), L);
  const lapOf = (id: number) => Math.max(1, Math.min(info.laps, (R.laps[id] ?? 0) + 1));
  const plans: MomentPlan[] = [];
  const add = (p: Omit<MomentPlan, 'from' | 'to' | 'shots'> & { shots: ShotPlan[] }) => {
    const shots = p.shots.map(clampShot).filter((s): s is ShotPlan => !!s);
    if (!shots.length) return;
    plans.push({ ...p, shots, from: Math.min(...shots.map((s) => s.t0)), to: Math.max(...shots.map((s) => s.t1)) });
  };
  const ev = R.events.slice();
  const start = ev.find((e) => e.kind === 'start');
  const tStart = start ? start.t : t0;

  // ---- the start: the gantry down the grid, then the helicopter with the pack into the first corner
  if (start) {
    at(start.t - 1);
    const pole = R.pos.indexOf(1);
    at(start.t + 9);
    const leader = R.pos.indexOf(1);
    const firstCorner = track.corners.find((c) => track.delta(track.startS, c.sApex) > 60)?.name ?? '';
    const lc = car(leader >= 0 ? leader : 0);
    add({
      kind: 'start',
      t: start.t,
      score: 58,
      kicker: 'Race start',
      title: `Lights out at ${info.trackShort}`,
      sub: lc ? `${lc.first} ${lc.last} leads${firstCorner ? ` into ${firstCorner}` : ''}` : info.trackName,
      color: lc?.color ?? '#ff2b3f',
      cars: [leader >= 0 ? leader : 0],
      lap: 1,
      mine: false,
      shots: [
        { t0: start.t - 3.8, t1: start.t + 4.2, speed: 1, focus: pole >= 0 ? pole : 0, ctx: 'start', mode: 'gantry' },
        { t0: start.t + 4.2, t1: start.t + 10.5, speed: 1, focus: leader >= 0 ? leader : 0, ctx: 'start', groups: ['aerial'] },
      ],
    });
  }
  yield;

  // ---- passes (the first-lap shuffle is the start's; lead changes and your own passes still count)
  const passes = ev.filter((e) => e.kind === 'overtake' || e.kind === 'lead');
  let n = 0;
  for (const e of passes) {
    const lead = e.kind === 'lead';
    const mine = e.car === me || e.other === me;
    if (e.t - tStart < 20 && !lead && !(mine && P)) continue;
    const A = car(e.car), B = car(e.other);
    if (!A || !B) continue;
    at(e.t);
    const where = whereAt(track, R.ghosts[e.car].s);
    const lap = lapOf(e.car);
    const pos = e.value;
    const score = lead ? 72 + (mine ? 25 * P : 0) : 22 + Math.max(0, 12 - pos) * 2.5 + (e.car === me ? 38 * P : e.other === me ? 10 * P : 0);
    // the slow-motion replay: from the passer's T-cam, or looking back from the car being passed
    const r = Math.random();
    const second: ShotPlan = r < 0.45 ? { t0: e.t - 1.7, t1: e.t + 1.1, speed: 0.5, focus: e.other, ctx: 'battle', mode: 'tcamrev' } : { t0: e.t - 1.7, t1: e.t + 1.1, speed: 0.5, focus: e.car, ctx: 'overtake', mode: r < 0.85 ? 'tcam' : 'cockpit' };
    add({
      kind: lead ? 'lead' : 'overtake',
      t: e.t,
      score,
      kicker: lead ? 'New leader' : 'Overtake',
      title: lead ? `${A.last} takes the lead` : `${A.last} passes ${B.last}`,
      sub: [lead ? `Past ${B.first} ${B.last}` : `For P${pos}`, where, `Lap ${lap}`].filter(Boolean).join(' · '),
      color: A.color,
      cars: [e.car, e.other],
      lap,
      mine: mine && !!P,
      shots: [{ t0: e.t - 4.6, t1: e.t + 2.2, speed: 1, focus: e.car, ctx: 'overtake', groups: ['trackside', 'aerial'] }, second],
    });
    if (++n % 6 === 0) yield;
  }

  // ---- incidents: crashes (merged with the retirement they cause), spins and saves
  const retiredAt = new Map<number, ReplayEvent>();
  for (const e of ev) if (e.kind === 'retired') retiredAt.set(e.car, e);
  for (const e of ev) {
    if (e.kind !== 'crash' && e.kind !== 'spin') continue;
    const A = car(e.car);
    if (!A) continue;
    const mine = e.car === me && !!P;
    at(e.t - 0.6);
    const before = Math.max(0, R.ghosts[e.car].vx);
    const posBefore = R.pos[e.car] || 20;
    at(e.t);
    const where = whereAt(track, R.ghosts[e.car].s);
    const lap = lapOf(e.car);
    const ret = retiredAt.get(e.car);
    const out = !!ret && ret.t - e.t < 20 && ret.t >= e.t - 1;
    if (e.kind === 'crash') {
      add({
        kind: 'crash',
        t: e.t,
        score: 50 + Math.min(25, e.value * 120) + (out ? 12 : 0) + (mine ? 30 : 0) + Math.max(0, 10 - posBefore),
        kicker: 'Incident',
        title: out ? `${A.last} crashes out` : `Contact for ${A.last}`,
        sub: [where, `Lap ${lap}`].filter(Boolean).join(' · '),
        color: A.color,
        cars: [e.car],
        lap,
        mine,
        shots: [
          { t0: e.t - 4, t1: e.t + 3, speed: 1, focus: e.car, ctx: 'crash', groups: ['trackside', 'aerial'] },
          { t0: e.t - 1.3, t1: e.t + 1.9, speed: 0.4, focus: e.car, ctx: 'crash', groups: ['aerial', 'chase'] },
        ],
      });
    } else {
      // a spin, or a big save: still flying afterwards, and hardly a place lost
      at(e.t + 2.4);
      const after = Math.max(0, R.ghosts[e.car].vx);
      const saved = before > 28 && after > before * 0.62 && Math.abs(R.ghosts[e.car].r) < 0.6 && (R.pos[e.car] || 20) - posBefore <= 1;
      add({
        kind: saved ? 'save' : 'spin',
        t: e.t,
        score: (saved ? 40 : 34) + (mine ? 26 : 0) + Math.max(0, 10 - posBefore),
        kicker: saved ? 'Big save' : 'Spin',
        title: saved ? `${A.last} holds on` : `${A.last} spins`,
        sub: [where, `Lap ${lap}`].filter(Boolean).join(' · '),
        color: A.color,
        cars: [e.car],
        lap,
        mine,
        shots: saved
          ? [
              { t0: e.t - 3.6, t1: e.t + 2.4, speed: 1, focus: e.car, ctx: 'crash', groups: ['trackside', 'aerial'] },
              { t0: e.t - 1.3, t1: e.t + 1.4, speed: 0.5, focus: e.car, ctx: 'overtake', mode: pick(['cockpit', 'tcam'] as CameraMode[]) },
            ]
          : [
              { t0: e.t - 3.6, t1: e.t + 2.6, speed: 1, focus: e.car, ctx: 'crash', groups: ['trackside', 'aerial'] },
              { t0: e.t - 1.1, t1: e.t + 1.7, speed: 0.45, focus: e.car, ctx: 'crash', groups: ['chase', 'aerial'] },
            ],
      });
    }
    if (++n % 6 === 0) yield;
  }

  // ---- the race's fastest lap (the last one set), across the line
  const fl = ev.filter((e) => e.kind === 'fastest').pop();
  if (fl && car(fl.car)) {
    const A = car(fl.car);
    at(fl.t);
    const lap = Math.max(1, Math.min(info.laps, R.laps[fl.car] ?? 1));
    add({
      kind: 'fastest',
      t: fl.t,
      score: 44 + (fl.car === me ? 22 * P : 0),
      kicker: 'Fastest lap',
      title: `${A.last} · ${fmtTime(fl.value)}`,
      sub: `Lap ${lap} · ${info.trackName}`,
      color: A.color,
      cars: [fl.car],
      lap,
      mine: fl.car === me && !!P,
      shots: [
        { t0: fl.t - 9, t1: fl.t - 2.4, speed: 1, focus: fl.car, ctx: 'normal', mode: 'tcam' },
        { t0: fl.t - 2.4, t1: fl.t + 2.6, speed: 1, focus: fl.car, ctx: 'finish', groups: ['trackside'] },
      ],
    });
  }

  // ---- the flag: the winner, and your own finish
  const fin = ev.filter((e) => e.kind === 'finish');
  const win = fin.find((e) => e.value === 1);
  const finishPlan = (e: ReplayEvent, winner: boolean) => {
    const A = car(e.car);
    if (!A) return;
    const podium = fin
      .filter((f) => f.value >= 2 && f.value <= 3)
      .sort((a, b) => a.value - b.value)
      .map((f) => `P${f.value} ${car(f.car)?.last ?? ''}`);
    add({
      kind: 'finish',
      t: e.t,
      score: winner ? 66 + (e.car === me ? 30 * P : 0) : 38 + (e.value <= 3 ? 18 : e.value <= 10 ? 6 : 0),
      kicker: 'Chequered flag',
      title: winner ? `${A.last} wins at ${info.trackShort}` : `${A.last} finishes P${e.value}`,
      sub: winner ? [`${info.laps} laps`, ...podium].join(' · ') : `${info.laps} laps · ${info.trackName}`,
      color: A.color,
      cars: [e.car],
      lap: info.laps,
      mine: e.car === me && !!P,
      shots: [
        { t0: e.t - 7, t1: e.t - 1.3, speed: 1, focus: e.car, ctx: 'finish', groups: ['trackside', 'aerial'] },
        { t0: e.t - 1.3, t1: e.t + 3.8, speed: 1, focus: e.car, ctx: 'finish', mode: pick(['gantry', 'pitwall', 'gantry'] as CameraMode[]) },
      ],
    });
  };
  if (win) finishPlan(win, true);
  const mineFin = fin.find((e) => e.car === me);
  if (P && mineFin && mineFin !== win) finishPlan(mineFin, false);
  yield;

  // ---- battles: two cars within 0.8 s for a good while (sampled once a second)
  const runs = new Map<string, { a: number; b: number; from: number; to: number; best: number; bestT: number; pos: number }>();
  const done: { a: number; b: number; from: number; to: number; best: number; bestT: number; pos: number }[] = [];
  const byPos: number[] = [];
  let k = 0;
  for (let t = tStart + 25; t < t1 - 10; t += 1) {
    at(t);
    byPos.length = 0;
    for (let i = 0; i < R.pos.length; i++) if (R.pos[i] > 0) byPos[R.pos[i]] = i;
    const live = new Set<string>();
    for (let p = 2; p < byPos.length; p++) {
      const a = byPos[p], b = byPos[p - 1];
      if (a === undefined || b === undefined) continue;
      const fa = R.flags[a], fb = R.flags[b];
      if ((fa | fb) & (RF.pit | RF.retired | RF.finished | RF.removed)) continue;
      if (R.gap[a] < 0 || R.gap[b] < 0) continue;
      const gap = R.gap[a] - R.gap[b];
      if (gap <= 0 || gap > 0.8) continue;
      const key = `${a}-${b}`;
      live.add(key);
      const r = runs.get(key);
      if (r) {
        r.to = t;
        if (gap < r.best) {
          r.best = gap;
          r.bestT = t;
        }
      } else runs.set(key, { a, b, from: t, to: t, best: gap, bestT: t, pos: p });
    }
    for (const [key, r] of runs)
      if (!live.has(key)) {
        runs.delete(key);
        if (r.to - r.from >= 12) done.push(r);
      }
    if (++k % 30 === 0) yield;
  }
  for (const r of runs.values()) if (r.to - r.from >= 12) done.push(r);
  for (const r of done) {
    const A = car(r.a), B = car(r.b);
    if (!A || !B) continue;
    const mine = (r.a === me || r.b === me) && !!P;
    const tb = Math.max(r.from + 3.5, Math.min(r.to - 8, r.bestT));
    at(tb);
    const where = whereAt(track, R.ghosts[r.a].s);
    const lap = lapOf(r.a);
    add({
      kind: 'battle',
      t: tb,
      score: 26 + Math.max(0, 10 - r.pos) * 2 + (mine ? 22 : 0) + Math.min(10, (r.to - r.from) / 6),
      kicker: 'Battle',
      title: `Battle for P${r.pos - 1}`,
      sub: [`${A.last} on ${B.last}`, where, `Lap ${lap}`].filter(Boolean).join(' · '),
      color: A.color,
      cars: [r.a, r.b],
      lap,
      mine,
      shots: [
        { t0: tb - 3.5, t1: tb + 3, speed: 1, focus: r.a, ctx: 'battle', groups: ['trackside', 'aerial', 'chase'] },
        { t0: tb + 3, t1: tb + 8, speed: 1, focus: r.a, ctx: 'battle', mode: 'tcam' },
      ],
    });
  }
  yield;

  // ---- the best few that don't overlap (a moment inside another's clip is part of it)
  plans.sort((a, b) => b.score - a.score);
  const keep: MomentPlan[] = [];
  for (const p of plans) {
    if (keep.length >= max) break;
    if (keep.some((q) => Math.min(q.to, p.to) - Math.max(q.from, p.from) > 1.5)) continue;
    keep.push(p);
  }
  return keep;
}
