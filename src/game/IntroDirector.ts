import * as THREE from 'three';
import type { Track } from '../world/Track.ts';
import type { Layout, GrandstandSpec } from '../world/env/layout.ts';
import type { AustinLayout } from '../world/env/venues/austin.ts';
import type { SakhirLayout } from '../world/env/venues/sakhir.ts';
import type { MexicoLayout } from '../world/env/venues/mexico.ts';
import { hotelPlan } from '../world/env/venues/yasmarina.ts';
import { makePlan, L as PIT_L } from '../world/pitlane/layout.ts';
import { H as PIT_H } from '../world/pitlane/building.ts';
import type { Sightlines } from './Sightlines.ts';

/**
 * The race intro, directed like a broadcast's opening titles: a fixed shot list built from the
 * circuit itself — its track frames, the pit building's plan (pitlane/layout.ts), the grandstands
 * and venue landmarks the scenery planned (env/layout.ts, venues/*) and the cars on the grid —
 * then filmed by evaluating one shot's camera move per frame.
 *
 *   1  establishing   the helicopter, high over the start/finish complex, orbiting slowly
 *   2  the venue      the circuit's signature: Eau Rouge, the Foro Sol, the Yas hotel, the old banking's bridge…
 *   3  the stand      a crane past the main grandstand, rising, the crowd sliding by
 *   4  the pits       a crane up the pit building's front from the pit lane, tilting down onto the grid
 *   5  the kerbs      a low tracking shot skimming the kerb into Turn 1
 *   6  the grid       a long lens straight down the grid from beyond the line, heat haze in it
 *   7  pole           a slow dolly across the pole sitter's nose
 *   8  your car       match cut to your car, the same framing, then round to the back of it —
 *                     where the game's race camera takes over (Game blends into it)
 *
 * Every shot is chosen from a few candidate moves (sides, heights, distances): each candidate is
 * sampled along its move and rejected if the camera would go under the terrain or into anything
 * solid (the Sightlines occupancy grid), and ranked by how much of the move keeps its subject in
 * clear view. The first good one is filmed; failing all, the best of them. So nothing is hand
 * placed per circuit beyond which landmark is the venue's signature, and the shots follow any
 * change to a circuit's layout.
 *
 * Cuts land on motion and alternate wide / close and high / low, as an editor would; two of
 * them are match cuts (the kerb's vanishing point onto the long lens's; the pole car's framing
 * onto your car's). `frame()` reports each cut so motion blur doesn't smear across it.
 */

export interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  /** vertical field of view (degrees) */
  fov: number;
  /** roll about the lens axis (radians, + counter-clockwise) */
  roll: number;
}

export interface IntroCaption {
  kick: string;
  title: string;
  sub?: string;
}

interface Shot {
  name: string;
  dur: number;
  /** the camera at u ∈ [0, 1] through the shot */
  pose(u: number, out: Pose): void;
  /** metres the lens keeps above the ground */
  clearance: number;
  /** occlusion within this many metres of the subject doesn't count (its own surroundings) */
  skipEnd: number;
  /** a lens with depth of field: focus point and range (m), bokeh scale */
  dof?: { target: THREE.Vector3; range: number; bokeh: number };
  /** heat haze in the shot (scaled by the day's own shimmer) */
  haze?: boolean;
  /** helicopter / handheld float (m) */
  float?: number;
  caption?: IntroCaption;
  /** the shadow/rain focus: the subject (default) or the air in front of the lens (aerials) */
  aerial?: boolean;
}

export interface IntroCars {
  /** the pole sitter (or P2 when that's you) and your car: s and lateral on the grid */
  pole: { s: number; lateral: number; caption: IntroCaption };
  player: { s: number; lateral: number; caption: IntroCaption };
}

export interface IntroWorld {
  track: Track;
  sight: Sightlines | null;
  heightAt(x: number, z: number): number;
  /** the scene, for venue landmarks found by name */
  scene: THREE.Object3D;
  cars: IntroCars;
  /** title of the circuit's signature shot, if the caller wants to override it */
  heroLabel?: string;
  /** the cars run their headlights (after dark, from twilight): film them from behind, not into the lamps */
  headlights?: boolean;
  /** full night: nothing to see down at kerb level (nights are dark on purpose: no floodlights) */
  dark?: boolean;
}

/** what a frame of the intro looks like */
export interface IntroFrame {
  /** shot index (−1: past the end) */
  index: number;
  /** this frame starts a new shot */
  cut: boolean;
  dof: Shot['dof'] | null;
  haze: boolean;
  caption: IntroCaption | null;
  /** where shadows and rain should centre */
  focus: THREE.Vector3;
}

const ease = (u: number) => u * u * (3 - 2 * u);
/** half linear, half eased: the move is already running when we cut in, and settles at the end */
const glide = (u: number) => 0.45 * u + 0.55 * ease(u);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const D2R = Math.PI / 180;

/** the scenery's layout of this circuit (stands, landmarks), if it is the one built */
function layoutOf(track: Track): Layout | null {
  const park = (globalThis as unknown as { __park?: { map?: { track?: Track }; layout?: Layout } }).__park;
  return park?.map?.track === track && park.layout ? park.layout : null;
}

interface Hero {
  kind: 'object' | 'skyline' | 'track';
  pos: THREE.Vector3;
  height: number;
  radius: number;
  /** for 'track': the s the move heads for */
  s?: number;
  label: string;
}

export class IntroDirector {
  readonly shots: Shot[] = [];
  /** shot start times */
  private readonly starts: number[] = [];
  readonly length: number;
  private last = -1;
  private readonly w: IntroWorld;
  private readonly t: Track;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly pose: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, roll: 0 };
  /** the shots that were picked and how well they could see (dev: window.__game.introDirector.report) */
  readonly report: string[] = [];

  constructor(w: IntroWorld) {
    this.w = w;
    this.t = w.track;
    const layout = layoutOf(this.t);
    const add = (s: Shot | null) => {
      if (s) this.shots.push(s);
    };
    add(this.establishing());
    add(this.venue(layout));
    add(this.grandstand(layout));
    add(this.pitBuilding());
    if (!w.dark) add(this.kerbs());
    add(this.longLens());
    add(this.carShot('pole'));
    add(this.carShot('player'));
    let t = 0;
    for (const s of this.shots) {
      this.starts.push(t);
      t += s.dur;
    }
    this.length = t;
  }

  /** the camera at intro time t (writes `camera`); null once past the end */
  frame(time: number, camera: THREE.PerspectiveCamera): IntroFrame | null {
    if (time >= this.length) return null;
    let i = this.shots.length - 1;
    while (i > 0 && this.starts[i] > time) i--;
    const shot = this.shots[i];
    const u = THREE.MathUtils.clamp((time - this.starts[i]) / shot.dur, 0, 1);
    const p = this.pose;
    shot.pose(u, p);
    if (shot.float) {
      // a helicopter / operator never holds perfectly still
      const f = shot.float;
      p.pos.x += (Math.sin(time * 0.71) + 0.5 * Math.sin(time * 1.37 + 2)) * f;
      p.pos.y += (Math.sin(time * 0.53 + 1) + 0.4 * Math.sin(time * 1.9)) * f * 0.6;
      p.pos.z += (Math.cos(time * 0.61) + 0.5 * Math.sin(time * 1.13 + 4)) * f;
    }
    // never under the ground, whatever the move does between its tested samples (the low shots
    // ride the road itself: against the grid's coarse 3 m cells they'd jitter, so only the terrain)
    const g = (shot.clearance < 1 ? this.w.heightAt(p.pos.x, p.pos.z) : this.ground(p.pos.x, p.pos.z)) + Math.min(shot.clearance, 0.3);
    if (p.pos.y < g) p.pos.y = g;
    camera.position.copy(p.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(p.look);
    if (p.roll) camera.rotateZ(p.roll);
    camera.fov = p.fov;
    camera.updateProjectionMatrix();
    const cut = i !== this.last;
    this.last = i;
    let focus = p.look;
    if (shot.aerial) {
      const d = p.pos.distanceTo(p.look);
      focus = this.tmp2.copy(p.look).sub(p.pos).multiplyScalar(Math.min(1, 70 / Math.max(1, d))).add(p.pos);
    }
    return { index: i, cut, dof: shot.dof ?? null, haze: !!shot.haze, caption: shot.caption ?? null, focus };
  }

  // ------------------------------------------------------------------ checking a move

  private ground(x: number, z: number): number {
    const a = this.w.heightAt(x, z);
    const b = this.w.sight?.groundAt(x, z) ?? -1e9;
    return Math.max(a, b);
  }

  /**
   * How good a move is: −1 if the lens ever goes into the ground or anything solid, else the share
   * of the move with a clear line to what it looks at.
   */
  private score(s: Shot): number {
    const N = 10;
    const sg = this.w.sight;
    let seen = 0;
    const p: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, roll: 0 };
    for (let k = 0; k <= N; k++) {
      s.pose(k / N, p);
      if (p.pos.y < this.ground(p.pos.x, p.pos.z) + s.clearance) return -1;
      if (sg && sg.solidAt(p.pos.x, p.pos.y, p.pos.z, true)) return -1;
      if (!sg || sg.clear(p.pos, p.look, s.skipEnd, 2.5)) seen++;
    }
    return seen / (N + 1);
  }

  private pick(name: string, cands: Shot[]): Shot | null {
    let best: Shot | null = null;
    let bestScore = -1;
    let k = 0;
    for (const c of cands) {
      const sc = this.score(c);
      if (sc >= 0.9) {
        this.report.push(`${name}: #${k} ${sc.toFixed(2)}`);
        return c;
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
      k++;
    }
    this.report.push(`${name}: best ${bestScore.toFixed(2)} of ${cands.length}`);
    return bestScore >= 0.45 ? best : null;
  }

  private tp(s: number, lat: number, h: number): THREE.Vector3 {
    return this.t.point(s, lat, h, new THREE.Vector3());
  }

  // ------------------------------------------------------------------ the shots

  /** 1 — the helicopter, high over the start/finish complex, orbiting slowly as it sinks */
  private establishing(): Shot {
    const t = this.t;
    const s0 = t.startS;
    const P = t.pit.side;
    const f = t.frame(s0 - 60);
    const C = this.tp(s0 - 60, P * 8, 0);
    const T = f.tangent.clone().setY(0).normalize();
    const R = f.right.clone().setY(0).normalize();
    const cands: Shot[] = [];
    const make = (side: number, a0: number, a1: number, h: number, r: number): Shot => ({
      name: 'establishing',
      dur: 4.6,
      clearance: 12,
      skipEnd: 70,
      float: 0.6,
      aerial: true,
      pose(u, o) {
        const e = glide(u);
        const a = lerp(a0, a1, e) * D2R;
        const rr = lerp(r, r * 0.86, e);
        o.pos.copy(C).addScaledVector(T, -Math.cos(a) * rr).addScaledVector(R, side * Math.sin(a) * rr);
        o.pos.y = C.y + lerp(h, h * 0.8, e);
        o.look.copy(C).addScaledVector(T, lerp(10, 50, e));
        o.fov = lerp(46, 40, e);
        o.roll = lerp(2.2, -0.8, e) * D2R * side;
      },
    });
    // behind the grid over the grandstand side, swinging round toward the pits (then mirrored, higher, …)
    for (const [h, r] of [[120, 310], [165, 340], [210, 380]])
      for (const side of [-P, P]) cands.push(make(side, 58, 30, h, r), make(side, 120, 150, h, r));
    return this.pick('establishing', cands) ?? cands[0];
  }

  /** the circuit's signature, as the scenery built it */
  private hero(layout: Layout | null): Hero | null {
    const t = this.t;
    const id = t.def.id;
    const corner = (name: string, label = name): Hero | null => {
      const c = t.corners.find((k) => k.name === name);
      return c ? { kind: 'track', pos: this.tp(c.sApex, 0, 0), height: 6, radius: 30, s: c.sApex, label } : null;
    };
    const named = (name: string, label: string, kind: 'object' | 'skyline'): Hero | null => {
      const o = this.w.scene.getObjectByName(name);
      if (!o) return null;
      const b = new THREE.Box3().setFromObject(o);
      if (b.isEmpty()) return null;
      const c = b.getCenter(new THREE.Vector3());
      const sz = b.getSize(new THREE.Vector3());
      return { kind, pos: new THREE.Vector3(c.x, b.min.y, c.z), height: sz.y, radius: Math.max(sz.x, sz.z) / 2, label };
    };
    const at = (x: number, z: number, height: number, radius: number, label: string): Hero => ({
      kind: 'object',
      pos: new THREE.Vector3(x, this.w.heightAt(x, z), z),
      height,
      radius,
      label,
    });
    switch (id) {
      case 'monza': {
        // the old banking's bridge over the circuit (the oval itself is buried in the park's woods)
        const ov = layout?.oval;
        return ov ? { kind: 'track', pos: this.tp(ov.bridgeS, 0, 0), height: 12, radius: 20, s: ov.bridgeS, label: 'The Sopraelevata' } : corner('Parabolica', 'Curva Alboreto');
      }
      case 'spa':
        return corner('Eau Rouge', 'Eau Rouge · Raidillon');
      case 'silverstone':
        return corner('Becketts', 'Maggotts · Becketts');
      case 'zandvoort':
        return corner('Arie Luyendijkbocht', 'Arie Luyendijkbocht');
      case 'hungaroring':
        return corner('Turn 1', 'Turn 1');
      case 'suzuka': {
        const fw = layout?.landmarks?.find((l) => l.kind === 'ferris');
        return fw ? at(fw.x, fw.z, fw.size * 2.3, fw.size, 'The Ferris wheel') : corner('S Curves', 'The Esses');
      }
      case 'austin': {
        const tw = (layout as AustinLayout | null)?.austin?.tower;
        return tw ? at(tw.x, tw.z, 77, 14, 'The Observation Tower') : corner('Turn 1', 'Turn 1');
      }
      case 'sakhir': {
        const tw = (layout as SakhirLayout | null)?.sakhir?.tower;
        return tw ? at(tw.x, tw.z, 62, 27, 'The Sakhir Tower') : corner('Turn 1', 'Turn 1');
      }
      case 'mexico': {
        const fo = (layout as MexicoLayout | null)?.mexico?.foro;
        return fo ? at(fo.x, fo.z, 20, 80, 'Foro Sol') : corner('Peraltada', 'Peraltada');
      }
      case 'yasmarina': {
        const hp = hotelPlan(t);
        return { kind: 'track', pos: this.tp(hp.sBridge, 0, 0), height: 30, radius: 30, s: hp.sBridge, label: 'The Yas Hotel' };
      }
      case 'spielberg':
        return named('spielberg_bull', 'The Bull', 'object') ?? corner('Remus', 'Remus');
      case 'montreal':
        return named('mtl_city_towers', 'Montréal', 'skyline') ?? corner('Wall of Champions');
      case 'melbourne':
        return named('mel_city', 'Melbourne', 'skyline') ?? corner('Lauda');
      case 'interlagos':
        return corner('S do Senna', 'S do Senna') ?? named('SaoPaulo', 'São Paulo', 'skyline');
    }
    return t.corners.length ? corner(t.corners.find((c) => t.delta(t.startS, c.sApex) > 150)?.name ?? t.corners[0].name) : null;
  }

  /** 2 — the venue's signature, the track in the foreground */
  private venue(layout: Layout | null): Shot | null {
    const H = this.hero(layout);
    if (!H) return null;
    const t = this.t;
    const caption: IntroCaption = { kick: t.def.name, title: this.w.heroLabel ?? H.label };
    const cands: Shot[] = [];
    const base = { name: 'venue', dur: 4, caption } as const;
    if (H.kind === 'track') {
      // a drone running down the approach toward it, sinking as it goes
      const s = H.s!;
      const hw = t.halfWidthAt(s);
      // (under a bridge — the Yas hotel's gridshell, Monza's banking — stay low: a drone run along the road)
      const heights = H.height > 10 ? [9, 6, 14] : [14, 26, 8];
      for (const [d0, d1] of [[150, 80], [190, 110], [110, 45]])
        for (const lat of [hw + 4, -(hw + 4), 0])
          for (const h of heights)
            cands.push({
              ...base,
              clearance: 3,
              // (a bridge over the road — the Yas hotel, Monza's banking — stands right at the subject)
              skipEnd: H.height > 10 ? 30 : 8,
              float: 0.25,
              pose: (u, o) => {
                const e = glide(u);
                this.t.point(s - lerp(d0, d1, e), lat * lerp(1, 0.55, e), lerp(h, h * 0.7, e), o.pos);
                this.t.point(s + lerp(-10, 60, e), 0, lerp(Math.min(H.height * 0.3, 3), 1.5, e), o.look);
                o.fov = lerp(44, 40, e);
                o.roll = 0;
              },
            });
    } else {
      // from the track's side of it: the nearest stretch of track between the lens and the landmark
      const pr = t.project(H.pos.x, H.pos.z);
      const near = this.tp(pr.s, 0, 0);
      const toward = new THREE.Vector3(H.pos.x - near.x, 0, H.pos.z - near.z);
      const dist = toward.length();
      toward.normalize();
      const skyline = H.kind === 'skyline';
      // (a skyline: aim low on it, the horizon mid-frame and the circuit in front of it)
      const lookY = H.pos.y + (skyline ? Math.min(H.height * 0.15, 30) : H.height * 0.5);
      const side = new THREE.Vector3(-toward.z, 0, toward.x);
      // stand off far enough to have it whole in frame (vertical fov ≈ 40°) and the track ahead of it
      const fit = Math.max(H.height * 1.7, H.radius * 1.6, 60);
      for (const back of skyline ? [40, 90, 160] : [Math.max(25, fit - dist), Math.max(25, fit - dist) + 60, 15])
        for (const ang of [0, 28, -28, 55, -55])
          for (const h of skyline ? [30, 50, 20] : [Math.max(30, H.height * 0.45), Math.max(45, H.height * 0.8), 22])
            cands.push({
              ...base,
              clearance: 3,
              skipEnd: skyline ? 200 : Math.max(8, H.radius * 0.9),
              float: 0.3,
              aerial: skyline,
              pose: (u, o) => {
                const e = glide(u);
                const a = (ang + lerp(-6, 6, e)) * D2R;
                const dir = this.tmp.copy(toward).multiplyScalar(-Math.cos(a)).addScaledVector(side, Math.sin(a));
                const r = Math.max(dist + back, fit) * lerp(1, 0.9, e);
                o.pos.copy(H.pos).addScaledVector(dir, r).setY(0);
                o.pos.y = Math.max(this.ground(o.pos.x, o.pos.z), near.y) + lerp(h, h * 1.15, e);
                o.look.set(H.pos.x, lookY, H.pos.z).addScaledVector(side, lerp(-1, 1, e) * H.radius * 0.15);
                o.fov = skyline ? lerp(36, 32, e) : lerp(44, 40, e);
                o.roll = 0;
              },
            });
    }
    return this.pick('venue', cands);
  }

  /** the main grandstand opposite the pits, its segments merged */
  private mainStand(layout: Layout | null): { sA: number; sB: number; side: number; front: number; height: number; name: string } | null {
    const t = this.t;
    const s0 = t.startS;
    const P = t.pit.side;
    const near = (layout?.grandstands ?? []).filter((g) => {
      const a = t.delta(s0, g.sA), b = t.delta(s0, g.sB);
      return g.side === -P && Math.max(a, b) > -320 && Math.min(a, b) < 260;
    });
    if (!near.length) return null;
    // the tallest name along the straight
    const by = new Map<string, GrandstandSpec[]>();
    for (const g of near) by.set(g.name, [...(by.get(g.name) ?? []), g]);
    let best: GrandstandSpec[] = [];
    let bh = -1;
    for (const gs of by.values()) {
      const h = Math.max(...gs.map((g) => g.height)) + gs.length * 0.5 + (gs[0].style === 'centrale' ? 3 : 0);
      if (h > bh) {
        bh = h;
        best = gs;
      }
    }
    const a = Math.min(...best.map((g) => t.delta(s0, g.sA)));
    const b = Math.max(...best.map((g) => t.delta(s0, g.sB)));
    return {
      sA: s0 + a,
      sB: s0 + b,
      side: best[0].side,
      front: Math.min(...best.map((g) => g.front)),
      height: Math.max(...best.map((g) => g.height)),
      name: best[0].name,
    };
  }

  /** 3 — a crane past the main grandstand, rising as the crowd slides by */
  private grandstand(layout: Layout | null): Shot | null {
    const t = this.t;
    const P = t.pit.side;
    const G = this.mainStand(layout) ?? { sA: t.startS - 160, sB: t.startS + 60, side: -P, front: t.halfWidthAt(t.startS) + 22, height: 12, name: '' };
    const len = G.sB - G.sA;
    const cands: Shot[] = [];
    for (const [lat, h0, h1] of [[-G.side * 3, 4, 11], [-G.side * 8, 6, 15], [G.side * 2, 3, 8], [-G.side * 12, 10, 20]])
      for (const dirn of [1, -1])
        cands.push({
          name: 'grandstand',
          dur: 3.2,
          clearance: 1.5,
          skipEnd: 22,
          float: 0.08,
          pose: (u, o) => {
            const e = glide(u);
            const a = dirn > 0 ? G.sA + len * 0.12 : G.sB - len * 0.12;
            const s = a + dirn * lerp(0, Math.min(len * 0.32, 60), e);
            this.t.point(s, lat, lerp(h0, h1, e), o.pos);
            this.t.point(s + dirn * 42, G.side * (G.front + G.height * 0.6), G.height * lerp(0.35, 0.5, e), o.look);
            o.fov = 40;
            o.roll = 0;
          },
        });
    return this.pick('grandstand', cands);
  }

  /** 4 — up the pit building's front from the pit lane, tilting down onto the grid as it clears the roof */
  private pitBuilding(): Shot | null {
    const t = this.t;
    const plan = makePlan(t);
    const P = plan.side;
    const s0 = t.startS;
    const lo = plan.bldgS0 + 25, hi = plan.bldgS1 - 25;
    const cands: Shot[] = [];
    // from beyond the line looking back down the grid (or from behind it looking up the straight):
    // the tilt ends on the cars, along the straight, not straight down on them
    const gridS = s0 - 50;
    const grid = this.tp(gridS, -P * 2, 0.8);
    for (const [ds, dir] of [[90, -1], [60, -1], [140, -1], [-230, 1], [-300, 1]]) {
      const s = THREE.MathUtils.clamp(s0 + ds, lo, hi);
      // (the building may end short of the spot: the grid must still lie well ahead of the lens)
      if (dir * t.delta(s, gridS) < 70) continue;
      // in the pit lane; failing that (an overhanging upper floor, the pit-wall stands' roofs), from
      // over the pit side of the track, across the wall
      for (const lat of [PIT_L.box, PIT_L.fast, PIT_L.laneOuter - 1, t.halfWidthAt(s) - 1.5, 2])
        cands.push({
          name: 'pits',
          dur: 3.4,
          clearance: 1.5,
          skipEnd: 8,
          float: 0.06,
          pose: (u, o) => {
            const e = ease(u);
            this.t.point(s + dir * (-4 + 10 * e), P * lat, lerp(2.2, PIT_H.roofTop + 10, e), o.pos);
            // the façade alongside, then down onto the grid
            const A = this.t.point(s + dir * 26, P * (PIT_L.front - 1.5), 3, this.tmp);
            const k = ease(THREE.MathUtils.clamp((u - 0.2) / 0.8, 0, 1));
            o.look.copy(A).lerp(grid, k);
            o.fov = lerp(44, 40, e);
            o.roll = 0;
          },
        });
    }
    return this.pick('pits', cands);
  }

  /** 5 — skimming the kerb into the first corner (the vanishing point the long lens matches) */
  private kerbs(): Shot | null {
    const t = this.t;
    const s0 = t.startS;
    // the first real corner after the grid, then the last one before it
    const after = t.corners.filter((c) => t.delta(s0, c.sApex) > 160 && c.radius < 260).sort((a, b) => t.delta(s0, a.sApex) - t.delta(s0, b.sApex));
    const before = t.corners.filter((c) => t.delta(s0, c.sApex) < -260 && c.radius < 260).sort((a, b) => t.delta(s0, b.sApex) - t.delta(s0, a.sApex));
    const cands: Shot[] = [];
    // (kerbed corners first: the shot is the kerb)
    const kerbed = (c: (typeof t.corners)[number]) => t.kerbAt(c.sApex, -c.dir) > 0.4;
    const pool = [...after.slice(0, 3), ...before.slice(0, 1)];
    for (const c of [...pool.filter(kerbed), ...pool.filter((k) => !kerbed(k))]) {
      const inside = -c.dir;
      // (one kerb width for the whole move: the per-metre one steps where the kerb starts)
      const kw = Math.max(t.kerbAt(c.sApex, inside), 0.6);
      for (const [d0, d1, h] of [[28, -14, 0.34], [40, 0, 0.3], [18, -24, 0.42]]) {
        cands.push({
          name: 'kerbs',
          dur: 2.6,
          clearance: 0.15,
          skipEnd: 2,
          pose: (u, o) => {
            const s = c.sApex - lerp(d0, d1, u);
            this.t.point(s, inside * (this.t.halfWidthAt(s) + kw * 0.35), h, o.pos);
            // along the kerb: its stripes run off into the corner
            const sl = s + 20;
            this.t.point(sl, inside * (this.t.halfWidthAt(sl) + kw * 0.2), 0.1, o.look);
            o.fov = 50;
            o.roll = inside * -1.5 * D2R;
          },
        });
      }
    }
    return this.pick('kerbs', cands);
  }

  /** 6 — the long lens from beyond the line, straight down the grid, the air shimmering */
  private longLens(): Shot | null {
    const t = this.t;
    const s0 = t.startS;
    const P = t.pit.side;
    // after dark, from behind the grid into the tail lights (head on, the lamps fill a long lens)
    const rev = this.w.headlights ? -1 : 1;
    const back = s0 - 7 - 8 * 21;
    const front = rev > 0 ? this.tp(s0 - 7, 0, 0.7) : this.tp(back + 8, 0, 0.7);
    const mid = this.tp(rev > 0 ? s0 - 7 - 8 * 5 : back + 8 * 6, 0, 0.7);
    const cands: Shot[] = [];
    for (const D of [200, 160, 240, 130, 100, 280, 70])
      for (const lat of [0, -P * 3, P * 3, -P * 6])
        cands.push({
          name: 'longlens',
          dur: 3.4,
          clearance: 0.8,
          skipEnd: 4,
          haze: true,
          float: 0.015,
          dof: { target: mid, range: 22, bokeh: 1.4 },
          pose: (u, o) => {
            const e = glide(u);
            this.t.point(rev > 0 ? s0 + D : back - D * 0.6, lat + lerp(-0.6, 0.6, e), lerp(2, 2.4, e), o.pos);
            o.look.copy(front).lerp(mid, lerp(0.15, 0.55, e));
            o.look.y += 0.1;
            const dist = o.pos.distanceTo(o.look);
            // a frame ~6.5 m tall at the cars, pushing in a touch
            o.fov = (2 * Math.atan(3.2 / dist) * lerp(1, 0.84, e)) / D2R;
            o.roll = 0;
          },
        });
    // the line must reach the front row AND the cars further back
    const sg = this.w.sight;
    const seesGrid = (s: Shot) => {
      if (!sg) return true;
      const p: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 5, roll: 0 };
      s.pose(0.5, p);
      return sg.clear(p.pos, front, 4, 2) && sg.clear(p.pos, mid, 4, 2);
    };
    return this.pick('longlens', cands.filter(seesGrid).concat(cands.slice(0, 1)));
  }

  /**
   * 7, 8 — close on the pole sitter, a slow dolly across the nose; then the match cut: your car in
   * the same framing, swinging round to the back of it where the race camera takes over.
   */
  private carShot(which: 'pole' | 'player'): Shot | null {
    const t = this.t;
    const c = this.w.cars[which];
    const f = t.frame(c.s);
    const C = t.point(c.s, c.lateral, 0, new THREE.Vector3());
    const F = f.tangent.clone();
    const R = f.right.clone();
    const U = f.up.clone();
    // toward the middle of the track from YOUR column (both shots use it, so the cut matches): the
    // side with room (the other column is 5.6 m across and 8 m along)
    const open = this.w.cars.player.lateral > 0 ? -1 : 1;
    // after dark the headlights would burn out a lens at the nose: the same moves round the back
    const fz = this.w.headlights ? -1 : 1;
    const rel = (x: number, y: number, z: number, out: THREE.Vector3) => out.copy(C).addScaledVector(R, x).addScaledVector(U, y).addScaledVector(F, z * fz);
    const focus = rel(0, 0.55, 0.3, new THREE.Vector3());
    const dof = { target: focus, range: 2.6, bokeh: 2.2 };
    // the shared framing at the cut: just off the nose, low, on the open side
    const MX = open * -1.1, MY = 0.55, MZ = 5.8;
    if (which === 'pole') {
      return {
        name: 'pole',
        dur: 3,
        clearance: 0.15,
        skipEnd: 1,
        float: 0.01,
        dof,
        caption: c.caption,
        pose(u, o) {
          const e = glide(u);
          rel(lerp(open * 3.6, MX, e), lerp(0.7, MY, e), lerp(3.4, MZ, e), o.pos);
          rel(0, lerp(0.55, 0.5, e), lerp(1.4, 0.8, e), o.look);
          o.fov = lerp(30, 34, e);
          o.roll = 0;
        },
      };
    }
    const a0 = Math.atan2(MX, MZ);
    // round the side to the rear three-quarter, where the race camera sits (after dark, the moves
    // are mirrored to the back: a swing across behind the car instead, rising and pulling away)
    const a1 = this.w.headlights ? open * 34 * D2R : open * 145 * D2R;
    const r0 = Math.hypot(MX, MZ);
    return {
      name: 'player',
      dur: 4.2,
      clearance: 0.15,
      skipEnd: 1,
      float: 0.01,
      dof,
      caption: c.caption,
      pose(u, o) {
        const e = ease(u);
        const a = lerp(a0, a1, e);
        const r = lerp(r0, 6.4, e);
        rel(Math.sin(a) * r, lerp(MY, 1.55, e * e), Math.cos(a) * r, o.pos);
        rel(0, lerp(0.5, 0.7, e), lerp(0.8, 1.5, e), o.look);
        o.fov = lerp(34, 46, e);
        o.roll = 0;
      },
    };
  }
}
