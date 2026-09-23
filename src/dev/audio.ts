/**
 * Audio lab: click-to-start, automatic lap simulation, manual controls, event buttons,
 * and an offline renderer (window.__renderLap) used by tools/audiocheck.mjs.
 */
import { type AudioView, GameAudio, type OpponentAudioState, type PlayerAudioState } from '../core/Audio.ts';

declare global {
  interface Window {
    __ready?: boolean;
    __renderLap?: (opts?: RenderOpts) => Promise<RenderResult>;
  }
}

// ------------------------------------------------------------------------------------------
// Minimal longitudinal car model (same gearing as src/sim/CarPhysics.ts)

const GEARS = [17.2, 14.0, 11.6, 9.75, 8.25, 7.0, 5.95, 5.02];
const WHEEL_C = 2 * Math.PI * 0.36;
const IDLE = 4200;
const LIMIT = 12400;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

class SimCar {
  v = 0;
  gear = 1;
  rpm = IDLE;
  limiter = false;
  private shiftT = 0;
  private cutT = 0;
  constructor(public powerScale = 1) {}

  rpmIn(g: number): number {
    return (this.v / WHEEL_C) * 60 * GEARS[g - 1];
  }

  /** returns +1 / −1 on a gear change */
  step(dt: number, thr: number, brake: number, drs: boolean): number {
    let shift = 0;
    this.shiftT -= dt;
    this.cutT -= dt;
    if (this.shiftT <= 0) {
      if (thr > 0.3 && this.rpmIn(this.gear) > LIMIT - 350 && this.gear < 8) {
        this.gear++;
        shift = 1;
        this.shiftT = 0.15;
        this.cutT = 0.045;
      } else if (this.gear > 1 && this.rpmIn(this.gear - 1) < (brake > 0.1 ? LIMIT - 1500 : LIMIT - 2600)) {
        this.gear--;
        shift = -1;
        this.shiftT = brake > 0.1 ? 0.17 : 0.3;
      }
    }
    const m = 798;
    const v = this.v;
    const P = 760e3 * this.powerScale;
    const trac = (13 + 0.0017 * v * v) * m * Math.min(1.6, this.powerScale);
    let drive = thr * Math.min(P / Math.max(v, 3), trac);
    if (this.limiter) drive *= 0.25;
    if (this.cutT > 0) drive *= 0.1;
    const drag = 0.5 * 1.225 * (drs ? 1.0 : 1.22) * v * v + 250;
    const brk = brake * m * (17 + 0.0045 * v * v);
    this.v = Math.max(0, v + ((drive - drag - brk) / m) * dt);
    const rw = this.rpmIn(this.gear);
    const launch = IDLE + thr * 5200;
    let rpm = this.gear === 1 && rw < launch ? Math.max(rw, launch * (1 - Math.min(1, this.v / 18)) + rw * Math.min(1, this.v / 18)) : rw;
    rpm = Math.max(IDLE, rpm);
    this.limiter = rpm >= LIMIT - 10 && thr > 0.5;
    this.rpm = Math.min(LIMIT, rpm);
    return shift;
  }
}

interface Frame {
  player: PlayerAudioState;
  shift: number;
  opps: OpponentAudioState[];
  /** one-shot calls to make this frame (events script) */
  act?: (a: GameAudio) => void;
}

// ------------------------------------------------------------------------------------------
// Live lap driver

interface Seg {
  straight: number;
  vc: number; // corner speed km/h
  len: number;
  kerb: 'apex' | 'exit' | 'none';
  off?: 3 | 4;
  drs?: boolean;
  lock?: boolean;
}

const LAP: Seg[] = [
  { straight: 950, vc: 92, len: 90, kerb: 'exit', drs: true, lock: true },
  { straight: 420, vc: 165, len: 160, kerb: 'apex' },
  { straight: 260, vc: 70, len: 70, kerb: 'none', off: 3 },
  { straight: 650, vc: 215, len: 260, kerb: 'exit' },
  { straight: 340, vc: 125, len: 120, kerb: 'apex', off: 4 },
];

class LapDriver {
  car = new SimCar(1);
  seg = 0;
  phase: 'straight' | 'corner' = 'straight';
  d = 0;
  t = 0;
  offLeft = 0;
  offSurf = 0;
  lockT = 0;
  constructor() {
    this.car.v = 0;
  }

  step(dt: number): Frame {
    this.t += dt;
    const s = LAP[this.seg];
    const car = this.car;
    const v = car.v;
    const vc = s.vc / 3.6;
    let thr = 0, brake = 0, slip = 0, surface = 0, onKerb = false, drs = false, ers = 0;
    if (this.phase === 'straight') {
      const remain = s.straight - this.d;
      const need = (v * v - vc * vc) / (2 * 36) + v * 0.05;
      if (v > vc * 1.02 && remain <= need) {
        brake = 1;
        slip = 0.25 + 0.15 * Math.random();
        if (s.lock && remain < need * 0.35 && this.lockT <= 0 && remain > need * 0.3) this.lockT = 0.25;
      } else if (remain <= need) {
        thr = 0.25;
      } else {
        thr = 1;
        const exit = Math.min(1, this.d / 60);
        slip = car.gear <= 2 ? 0.45 * (1 - exit) + 0.1 : 0.05;
        drs = !!s.drs && this.d > 200;
        ers = car.gear >= 3 ? 1 : 0;
      }
      if (this.lockT > 0) {
        this.lockT -= dt;
        slip = 0.95;
      }
      if (this.offLeft > 0) {
        surface = this.offSurf;
        this.offLeft -= v * dt;
        slip = Math.max(slip, 0.5);
      }
      this.d += v * dt;
      if (this.d >= s.straight) {
        this.phase = 'corner';
        this.d = 0;
      }
    } else {
      const x = this.d / s.len;
      thr = clamp(0.3 + (vc - v) * 0.12, 0.05, 0.75);
      if (x > 0.72) thr = Math.min(1, thr + (x - 0.72) * 3);
      slip = 0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, x * 1.1)) + (Math.random() - 0.5) * 0.08;
      if (s.kerb === 'apex' && x > 0.42 && x < 0.6) onKerb = true;
      if (s.kerb === 'exit' && x > 0.8 && x < 0.98) onKerb = true;
      if (onKerb) surface = 1;
      if (s.off && x > 0.85) {
        surface = s.off;
        this.offLeft = 35;
        this.offSurf = s.off;
      }
      this.d += v * dt;
      if (this.d >= s.len) {
        this.phase = 'straight';
        this.d = 0;
        this.seg = (this.seg + 1) % LAP.length;
      }
    }
    const shift = car.step(dt, thr, brake, drs);
    return {
      player: { rpm: car.rpm, throttle: thr, brake, speed: car.v, gear: car.gear, slip, surface, onKerb, drs, ers, limiter: car.limiter },
      shift,
      opps: [],
    };
  }
}

// ------------------------------------------------------------------------------------------
// Opponents: a couple of cars running around the player + optional fly-bys

class Traffic {
  t = 0;
  flybys: { x: number; u: number; lat: number; id: number; rpm: number }[] = [];
  nextId = 100;
  ambient = true;

  flyby(u = 70): void {
    this.flybys.push({ x: -170, u, lat: 3 + Math.random() * 3, id: this.nextId++, rpm: 11200 });
  }

  step(dt: number, playerRpm: number): OpponentAudioState[] {
    this.t += dt;
    const out: OpponentAudioState[] = [];
    if (this.ambient) {
      // car 1 ahead (drifting between 18 and 55 m), car 2 behind, cars 3–5 far
      const specs = [
        { id: 1, base: 36, amp: 18, w: 0.21, lat: 0.6 },
        { id: 2, base: -28, amp: 12, w: 0.17, lat: -0.8 },
        { id: 3, base: 120, amp: 40, w: 0.07, lat: 0.3 },
        { id: 4, base: -160, amp: 50, w: 0.05, lat: -0.2 },
        { id: 5, base: 260, amp: 30, w: 0.09, lat: 0.1 },
        { id: 6, base: -300, amp: 20, w: 0.11, lat: 0.4 },
      ];
      for (const s of specs) {
        const x = s.base + s.amp * Math.sin(this.t * s.w * 2 * Math.PI);
        const dx = s.amp * s.w * 2 * Math.PI * Math.cos(this.t * s.w * 2 * Math.PI);
        const d = Math.hypot(x, 2.5);
        out.push({ id: s.id, rpm: clamp(playerRpm + 300 * Math.sin(this.t * 1.3 + s.id), 4500, 12300), throttle: 0.8, distance: d, relVel: (-x * dx) / d, pan: clamp((s.lat * 2.5) / d + 0.15 * Math.sign(s.lat), -1, 1) });
      }
    }
    for (const f of this.flybys) {
      f.x += f.u * dt;
      const d = Math.hypot(f.x, f.lat);
      out.push({ id: f.id, rpm: f.rpm, throttle: 1, distance: d, relVel: (-f.x * f.u) / d, pan: clamp((-f.lat / d) * 1.2, -1, 1) });
    }
    this.flybys = this.flybys.filter((f) => f.x < 220);
    return out;
  }
}

// ------------------------------------------------------------------------------------------
// Offline render: scripted acceleration through the gears, a braking/downshift sequence,
// a corner with squeal + kerb, and an opponent fly-by. Drives the SAME GameAudio graph.

interface RenderOpts {
  view?: AudioView;
  seconds?: number;
  sampleRate?: number;
  /** keep only these layers (see GameAudio._solo) */
  solo?: string[];
  /** force the native (no-AudioWorklet) fallback engine */
  native?: boolean;
  /** 'lap' (default) or 'events': UI sounds, start beeps, crowd, impacts, surfaces */
  script?: 'lap' | 'events';
}

interface RenderResult {
  sampleRate: number;
  frames: number;
  left: string; // base64 Float32
  right: string;
  timeline: { t: number; rpm: number; gear: number; thr: number; brake: number; speed: number; shift: number; opp: number; limiter: boolean; dop: number; surf: number; act: boolean }[];
  worklet: boolean;
  ms: number;
}

class RenderScript {
  car = new SimCar(1.9);
  constructor() {
    this.car.v = 21;
    this.car.gear = 2;
  }
  step(t: number, dt: number): Frame {
    const car = this.car;
    let thr = 0, brake = 0, slip = 0.05, surface = 0, onKerb = false, drs = false, ers = 0;
    if (t < 5.0) {
      thr = t < 0.05 ? 0.4 : 1;
      drs = t > 2.6;
      ers = 1;
      slip = t < 0.5 ? 0.45 : 0.05;
    } else if (t < 6.45) {
      brake = 1;
      slip = t > 6.1 && t < 6.35 ? 0.9 : 0.3;
    } else if (t < 7.35) {
      thr = clamp(0.3 + (t - 6.45) * 0.3, 0, 0.6);
      slip = 0.75 + 0.35 * Math.sin(((t - 6.45) / 0.9) * Math.PI);
      onKerb = t > 6.9 && t < 7.25;
      if (onKerb) surface = 1;
    } else {
      thr = 1;
      slip = 0.5;
    }
    const shift = car.step(dt, thr, brake, drs);
    // fly-by: closest approach at t = 7.0, 60 m/s relative, 3.5 m lateral
    const opps: OpponentAudioState[] = [];
    const x = 60 * (t - 7.0);
    if (Math.abs(x) < 240) {
      const d = Math.hypot(x, 3.5);
      opps.push({ id: 7, rpm: 11600, throttle: 1, distance: d, relVel: (-x * 60) / d, pan: clamp(-3.5 / d, -1, 1) * 0.9 });
    }
    return {
      player: { rpm: car.rpm, throttle: thr, brake, speed: car.v, gear: car.gear, slip, surface, onKerb, drs, ers, limiter: car.limiter },
      shift,
      opps,
    };
  }
}

/** Events: UI, start lights, crowd, two impacts, gravel / grass / kerb / squeal at 180 km/h. */
class EventsScript {
  private done = new Set<string>();
  private once(key: string, t: number, at: number, fn: (a: GameAudio) => void, acts: ((a: GameAudio) => void)[]) {
    if (t >= at && !this.done.has(key)) {
      this.done.add(key);
      acts.push(fn);
    }
  }
  step(t: number): Frame {
    const acts: ((a: GameAudio) => void)[] = [];
    this.once('m', t, 0.3, (a) => a.ui('move'), acts);
    this.once('s', t, 0.6, (a) => a.ui('select'), acts);
    this.once('b', t, 0.9, (a) => a.ui('back'), acts);
    for (let i = 0; i < 5; i++) this.once('beep' + i, t, 1.2 + i * 0.3, (a) => a.startBeep(false), acts);
    this.once('go', t, 2.9, (a) => a.startBeep(true), acts);
    this.once('c1', t, 3.0, (a) => a.crowd(1), acts);
    this.once('i1', t, 4.0, (a) => a.impact(0.35), acts);
    this.once('i2', t, 5.0, (a) => a.impact(1), acts);
    this.once('c0', t, 7.0, (a) => a.crowd(0), acts);
    const moving = t >= 6;
    const surface = t >= 6 && t < 7 ? 4 : t >= 7 && t < 8 ? 3 : t >= 8 && t < 9 ? 1 : 0;
    const player: PlayerAudioState = {
      rpm: moving ? 8200 : 4300, throttle: moving ? 0.35 : 0.02, brake: 0, speed: moving ? 50 : 0, gear: moving ? 4 : 1,
      slip: t >= 9 ? 1.0 : moving ? 0.1 : 0, surface, onKerb: surface === 1, drs: false, ers: 0, limiter: false,
    };
    // 7 cars weaving in distance so the 4-voice pool keeps re-assigning (click test)
    const opps: OpponentAudioState[] = [];
    for (let i = 0; i < 7; i++) {
      const w = 0.7 + i * 0.23;
      const d = 12 + 70 * (1 + Math.sin(w * t + i * 1.9));
      const dd = 70 * w * Math.cos(w * t + i * 1.9);
      opps.push({ id: 50 + i, rpm: 9000 + 2500 * Math.sin(t * 0.8 + i), throttle: 0.8, distance: d, relVel: -dd, pan: Math.sin(i * 2.1) * 0.8 });
    }
    return { player, shift: 0, opps, act: acts.length ? (a) => acts.forEach((f) => f(a)) : undefined };
  }
}

function f32ToB64(f: Float32Array): string {
  const u8 = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode(...u8.subarray(i, i + CH));
  return btoa(s);
}

async function renderLap(opts: RenderOpts = {}): Promise<RenderResult> {
  const t0 = performance.now();
  const sr = opts.sampleRate ?? 48000;
  const dur = opts.seconds ?? 8;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(sr * dur), sampleRate: sr });
  const audio = new GameAudio({ context: ctx, engine: opts.native ? 'native' : 'auto' });
  await audio.init();
  audio.setView(opts.view ?? 'chase');
  audio.setVolume(0.8);
  if (opts.solo) audio._solo(opts.solo);
  const step = 768 / sr;
  const script = opts.script === 'events' ? new EventsScript() : new RenderScript();
  const timeline: RenderResult['timeline'] = [];
  const tick = (t: number) => {
    const f = script.step(t, step);
    f.act?.(audio);
    audio.updatePlayer(f.player);
    if (f.shift) audio.shift(f.shift > 0);
    audio.updateOpponents(f.opps);
    audio.update(step);
    const p = f.player;
    timeline.push({ t, rpm: p.rpm, gear: p.gear, thr: p.throttle, brake: p.brake, speed: p.speed, shift: f.shift, opp: f.opps.length ? f.opps[0].distance : -1, limiter: p.limiter, dop: audio._info().dop, surf: p.surface, act: !!f.act });
  };
  tick(0);
  const n = Math.floor(dur / step);
  for (let k = 1; k < n; k++) {
    const t = k * step;
    void ctx.suspend(t).then(() => {
      tick(t);
      return ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  return {
    sampleRate: sr,
    frames: buf.length,
    left: f32ToB64(buf.getChannelData(0)),
    right: f32ToB64(buf.getChannelData(1)),
    timeline,
    worklet: audio.workletEngine,
    ms: Math.round(performance.now() - t0),
  };
}

function wavBlob(l: Float32Array, r: Float32Array, sr: number): Blob {
  const n = l.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    dv.setInt16(44 + i * 4, clamp(l[i], -1, 1) * 32767, true);
    dv.setInt16(46 + i * 4, clamp(r[i], -1, 1) * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

window.__renderLap = renderLap;

// ------------------------------------------------------------------------------------------
// UI

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = new GameAudio();
(window as unknown as { __audio: GameAudio }).__audio = audio;
let started = false;
let auto = new URLSearchParams(location.search).get('auto') !== '0';
let parked = false;
let driver = new LapDriver();
const traffic = new Traffic();
let view: AudioView = 'chase';
let last = performance.now();
let lastFrame: Frame | null = null;
let cost = 0; // smoothed main-thread ms per frame spent in GameAudio calls

$('start').addEventListener('click', async () => {
  await audio.init();
  started = true;
  $('status').textContent = audio.workletEngine ? 'running · AudioWorklet engine' : 'running · native fallback engine';
  $('start').textContent = 'Audio running';
});

$<HTMLInputElement>('vol').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  $('volv').textContent = v.toFixed(2);
  audio.setVolume(v);
});

function setAuto(on: boolean) {
  auto = on;
  $('auto').classList.toggle('on', on);
  $('manual').classList.toggle('disabled', on);
  if (on) parked = false;
  $('park').classList.toggle('on', parked);
}
$('auto').addEventListener('click', () => setAuto(!auto));
$('park').addEventListener('click', () => {
  parked = !parked;
  if (parked) setAuto(false);
  $('park').classList.toggle('on', parked);
});
$('up').addEventListener('click', () => audio.shift(true));
$('down').addEventListener('click', () => audio.shift(false));
setAuto(auto);

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  b.addEventListener('click', () => {
    view = b.dataset.view as AudioView;
    audio.setView(view);
    document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b));
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ui]')) {
  b.addEventListener('click', () => audio.ui(b.dataset.ui as 'move' | 'select' | 'back'));
}
$('flyby').addEventListener('click', () => traffic.flyby(parked ? 85 : 60));
$('imp1').addEventListener('click', () => audio.impact(0.3));
$('imp2').addEventListener('click', () => audio.impact(1));
$('lights').addEventListener('click', () => {
  for (let i = 0; i < 5; i++) setTimeout(() => audio.startBeep(false), i * 1000);
  setTimeout(() => audio.startBeep(true), 5000 + 600 + Math.random() * 1400);
});
$<HTMLInputElement>('crowd').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  $('crowdv').textContent = v.toFixed(2);
  audio.crowd(v);
});

const man = () => ({
  rpm: Number($<HTMLInputElement>('m_rpm').value),
  thr: Number($<HTMLInputElement>('m_thr').value),
  spd: Number($<HTMLInputElement>('m_spd').value),
  slip: Number($<HTMLInputElement>('m_slip').value),
  surf: Number($<HTMLSelectElement>('m_surf').value),
  drs: $<HTMLInputElement>('m_drs').checked,
  ers: $<HTMLInputElement>('m_ers').checked,
  lim: $<HTMLInputElement>('m_lim').checked,
});

$('render').addEventListener('click', async () => {
  $('renderOut').textContent = 'rendering…';
  const res = await renderLap({ view });
  const dec = (b64: string) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Float32Array(u8.buffer);
  };
  const url = URL.createObjectURL(wavBlob(dec(res.left), dec(res.right), res.sampleRate));
  $('renderOut').innerHTML = `done in ${res.ms} ms · <a href="${url}" download="apex_${view}.wav">download apex_${view}.wav</a>`;
});

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let f: Frame;
  if (auto) {
    f = driver.step(dt);
  } else if (parked) {
    f = { player: { rpm: 4300 + Math.random() * 60, throttle: 0.02, brake: 0, speed: 0, gear: 1, slip: 0, surface: 0, onKerb: false, drs: false, ers: 0, limiter: false }, shift: 0, opps: [] };
  } else {
    const m = man();
    $('m_rpmv').textContent = String(m.rpm);
    $('m_thrv').textContent = m.thr.toFixed(2);
    $('m_spdv').textContent = String(m.spd);
    $('m_slipv').textContent = m.slip.toFixed(2);
    f = { player: { rpm: m.rpm, throttle: m.thr, brake: 0, speed: m.spd / 3.6, gear: 5, slip: m.slip, surface: m.surf, onKerb: m.surf === 1, drs: m.drs, ers: m.ers ? 1 : 0, limiter: m.lim }, shift: 0, opps: [] };
  }
  traffic.ambient = auto;
  f.opps = traffic.step(dt, f.player.rpm);
  if (started) {
    const c0 = performance.now();
    audio.updatePlayer(f.player);
    if (f.shift) audio.shift(f.shift > 0);
    audio.updateOpponents(f.opps);
    audio.update(dt);
    cost = cost * 0.98 + (performance.now() - c0) * 0.02;
  }
  lastFrame = f;
  const p = f.player;
  const near = f.opps.slice().sort((a, b) => a.distance - b.distance)[0];
  $('readout').textContent =
    `gear ${p.gear}   rpm ${p.rpm.toFixed(0).padStart(5)}   ${(p.speed * 3.6).toFixed(0).padStart(3)} km/h   ` +
    `thr ${p.throttle.toFixed(2)}  brk ${p.brake.toFixed(2)}  slip ${p.slip.toFixed(2)}\n` +
    `surface ${p.surface}  kerb ${p.onKerb ? 'Y' : '-'}  drs ${p.drs ? 'OPEN' : '-'}  ers ${p.ers}  limiter ${p.limiter ? 'ON' : '-'}\n` +
    `firing ${(p.rpm / 20).toFixed(1)} Hz   nearest opp ${near ? near.distance.toFixed(1) + ' m  relVel ' + near.relVel.toFixed(1) : '-'}\n` +
    `audio main-thread cost ${cost.toFixed(3)} ms/frame   ctx ${audio.context ? (audio.context as AudioContext).state ?? '' : '-'}`;
  (window as unknown as { __audioCost: number }).__audioCost = cost;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
void lastFrame;
window.__ready = true;
