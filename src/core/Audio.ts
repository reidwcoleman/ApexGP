/**
 * APEX GP — synthesized game audio (Web Audio API only, no audio files).
 *
 * Engine: a physically-flavoured V6 turbo-hybrid voice running in an AudioWorklet
 * (see audio/engineWorklet.ts) split into exhaust / rasp / intake / roar / pops / mechanical
 * layers, plus native turbo whistle, gearbox whine and ERS whine. Views re-balance the layers:
 * cockpit = intake + mechanical + low-passed "outside", chase = exhaust dominant,
 * tv = distant trackside camera with doppler.
 *
 * Mix:  near(player cockpit-side) ─┬─────────────────────────────┐
 *       far (exhaust) ─────────────┼→ outside ─ LP(view) ─┬───────┼→ glue comp → volume → fade → limiter → soft clip → out
 *       opponents / crowd ─────────┘                      └ reverb┘
 *       ui ────────────────────────────────────────────────────────────────→ volume
 *
 * Usage: `const audio = new GameAudio(); await audio.init()` from a user gesture, then call
 * updatePlayer()/updateOpponents()/update(dt) every frame. All methods are no-ops before init.
 * `new GameAudio({ context: offlineCtx })` renders the same graph offline (see src/dev/audio.ts).
 */
import { type AudioBuffers, biquad, chain, clamp, gainNode, loopSource, makeBuffers, setT, softClipCurve } from './audio/dsp.ts';
import { createEngineSource, type EngineMix, loadEngineWorklet, OpponentVoice, PlayerEngine } from './audio/engine.ts';
import { beepSound, CarFx, type CarFxMix, Crowd, impactSound, explosionSound, uiSound, WeatherSound } from './audio/fx.ts';

export type AudioView = 'chase' | 'cockpit' | 'tv';

export interface PlayerAudioState {
  /** engine rpm (≈4000–12500; < 300 = engine off) */
  rpm: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** road speed, m/s */
  speed: number;
  gear: number;
  /** tyre slip 0..1+ (≈0.6 = at the limit, > 1 = sliding / locking) */
  slip: number;
  /** 0 road, 1 kerb, 2 asphalt run-off, 3 grass, 4 gravel */
  surface: number;
  onKerb: boolean;
  drs: boolean;
  /** ERS deploy 0..1 */
  ers: number;
  limiter: boolean;
}

export interface OpponentAudioState {
  id: number;
  rpm: number;
  throttle: number;
  distance: number;
  /** m/s along the line of sight, positive = approaching */
  relVel: number;
  /** −1 (left) … +1 (right) */
  pan: number;
}

interface ViewMix extends EngineMix, CarFxMix {
  /** player's near layers straight to the mix (1) or through the outside filter (0) */
  nearDirect: number;
  /** low-pass on everything outside the cockpit (Hz) */
  outsideLP: number;
  reverb: number;
  /** low-shelf dB on near layers (chassis/helmet boom) */
  body: number;
  opponents: number;
}

const VIEWS: Record<AudioView, ViewMix> = {
  cockpit: {
    exhaust: 0.5, rasp: 0.4, pops: 0.55, intake: 1.0, roar: 1.0, mech: 1.0, whistle: 1.0, gear: 1.0,
    tyres: 0.9, wind: 1.0, buffet: 1.0, nearDirect: 1, outsideLP: 3400, reverb: 0.03, body: 5, opponents: 0.8,
  },
  chase: {
    exhaust: 1.0, rasp: 1.0, pops: 1.0, intake: 0.3, roar: 0.32, mech: 0.22, whistle: 0.55, gear: 0.35,
    tyres: 1.0, wind: 0.45, buffet: 0, nearDirect: 1, outsideLP: 20000, reverb: 0.08, body: 1.5, opponents: 1.0,
  },
  tv: {
    exhaust: 1.0, rasp: 0.85, pops: 0.9, intake: 0.14, roar: 0.14, mech: 0.08, whistle: 0.3, gear: 0.15,
    tyres: 0.8, wind: 0.12, buffet: 0, nearDirect: 0, outsideLP: 12000, reverb: 0.3, body: 0, opponents: 1.0,
  },
};

const OPP_VOICES = 4;
const C_SOUND = 343;

function isRealtime(ctx: BaseAudioContext): ctx is AudioContext {
  return typeof AudioContext !== 'undefined' && ctx instanceof AudioContext;
}

export class GameAudio {
  private ctx: BaseAudioContext | null = null;
  private ready = false;
  private initP: Promise<void> | null = null;
  private vol = 0.8;
  private view: AudioView = 'chase';
  private b!: AudioBuffers;

  // buses
  private direct!: GainNode;
  private outside!: GainNode;
  private outsideLP!: BiquadFilterNode;
  private revSend!: GainNode;
  private master!: GainNode;
  private fade!: GainNode;
  private uiBus!: GainNode;
  private nearIn!: GainNode;
  private nearBody!: BiquadFilterNode;
  private nearAtt!: GainNode;
  private nearPan!: StereoPannerNode;
  private nearDirect!: GainNode;
  private nearOut!: GainNode;
  private farAtt!: GainNode;
  private farPan!: StereoPannerNode;
  private oppBus!: GainNode;
  private whooshG!: GainNode;
  /** one-shots (impacts, beeps): direct + a little room */
  private fxBus!: GainNode;

  private engine!: PlayerEngine;
  private fx!: CarFx;
  private crowdFx!: Crowd;
  private weatherFx!: WeatherSound;
  private voices: OpponentVoice[] = [];

  // player state
  private ps: PlayerAudioState = { rpm: 4200, throttle: 0, brake: 0, speed: 0, gear: 1, slip: 0, surface: 0, onKerb: false, drs: false, ers: 0, limiter: false };
  private boost = 0;
  private popBoost = 0;
  private dop = 1;
  private suspendToken = 0;

  // tv camera (synthetic trackside cameras unless setTvCamera() feeds real ones)
  private tv = { x: -120, lat: 14, side: 1, extT: -1e9, dist: 30, relVel: 0, pan: 0 };

  private forceNative: boolean;

  /**
   * @param opts.context render into an existing (e.g. Offline) context instead of creating one
   * @param opts.engine 'native' forces the PeriodicWave fallback engine (testing)
   */
  constructor(opts: { context?: BaseAudioContext; engine?: 'auto' | 'native' } = {}) {
    if (opts.context) this.ctx = opts.context;
    this.forceNative = opts.engine === 'native';
  }

  /** The underlying context (null before init()). */
  get context(): BaseAudioContext | null {
    return this.ctx;
  }

  /** True when the engine runs in the AudioWorklet (false = native fallback). */
  workletEngine = false;

  init(): Promise<void> {
    if (!this.ctx) {
      const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    const ctx = this.ctx;
    if (isRealtime(ctx) && ctx.state !== 'running') void ctx.resume().catch(() => {});
    if (!this.initP) this.initP = this.build();
    return this.initP;
  }

  private now(): number {
    return this.ctx!.currentTime;
  }

  /** Skip parameter traffic while a realtime context is paused (automation would pile up). */
  private live(): boolean {
    if (!this.ready) return false;
    const ctx = this.ctx!;
    return !isRealtime(ctx) || ctx.state === 'running';
  }

  private async build(): Promise<void> {
    const ctx = this.ctx!;
    const worklet = !this.forceNative && (await loadEngineWorklet(ctx));
    this.workletEngine = worklet;
    this.b = makeBuffers(ctx);
    const v = VIEWS[this.view];

    // --- master chain
    const glue = new DynamicsCompressorNode(ctx, { threshold: -20, knee: 10, ratio: 3, attack: 0.006, release: 0.22 });
    this.master = gainNode(ctx, this.vol);
    this.fade = gainNode(ctx, 1);
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -4, knee: 2, ratio: 20, attack: 0.001, release: 0.08 });
    const clip = new WaveShaperNode(ctx, { curve: softClipCurve(0.8), oversample: '2x' });
    const mixIn = gainNode(ctx, 1);
    chain(mixIn, glue, this.master, this.fade, limiter, clip, ctx.destination);
    this.uiBus = gainNode(ctx, 1);
    this.uiBus.connect(this.master);

    this.direct = gainNode(ctx, 1);
    this.direct.connect(mixIn);
    this.outside = gainNode(ctx, 1);
    this.outsideLP = biquad(ctx, 'lowpass', v.outsideLP, 0.6);
    chain(this.outside, this.outsideLP, mixIn);
    const conv = new ConvolverNode(ctx, { buffer: this.b.ir });
    this.revSend = gainNode(ctx, v.reverb);
    const revRet = gainNode(ctx, 0.9);
    chain(this.outsideLP, this.revSend, conv, revRet, mixIn);
    this.fxBus = gainNode(ctx, 1);
    this.fxBus.connect(this.direct);
    this.fxBus.connect(gainNode(ctx, 0.18)).connect(conv);

    // --- player buses
    this.nearIn = gainNode(ctx, 1);
    this.nearBody = biquad(ctx, 'lowshelf', 140, 0.7, v.body);
    this.nearAtt = gainNode(ctx, 1);
    this.nearPan = new StereoPannerNode(ctx, { pan: 0 });
    this.nearDirect = gainNode(ctx, v.nearDirect);
    this.nearOut = gainNode(ctx, 1 - v.nearDirect);
    chain(this.nearIn, this.nearBody, this.nearAtt, this.nearPan);
    this.nearPan.connect(this.nearDirect).connect(this.direct);
    this.nearPan.connect(this.nearOut).connect(this.outside);
    const farIn = gainNode(ctx, 1);
    this.farAtt = gainNode(ctx, 1);
    this.farPan = new StereoPannerNode(ctx, { pan: 0 });
    chain(farIn, this.farAtt, this.farPan, this.outside);

    // --- player engine + car fx
    const src = createEngineSource(ctx, worklet, false, 0x1234567, 0.5, this.b);
    this.engine = new PlayerEngine(ctx, src, this.b, this.nearIn, farIn, v);
    this.fx = new CarFx(ctx, this.b);
    this.fx.out.connect(this.nearIn);

    // --- opponents
    this.oppBus = gainNode(ctx, v.opponents);
    this.oppBus.connect(this.outside);
    for (let i = 0; i < OPP_VOICES; i++) {
      const s = createEngineSource(ctx, worklet, true, 0x9e3779b1 + i * 7919, (i * 0.37 + 0.15) % 1, this.b);
      this.voices.push(new OpponentVoice(ctx, s, this.oppBus));
    }
    const wn = loopSource(ctx, this.b.pink);
    const wBP = biquad(ctx, 'bandpass', 1100, 0.5);
    this.whooshG = gainNode(ctx, 0);
    chain(wn, wBP, this.whooshG, this.oppBus);

    // --- crowd
    this.crowdFx = new Crowd(ctx, this.b);
    this.crowdFx.out.connect(this.outside);

    // --- weather
    this.weatherFx = new WeatherSound(ctx, this.b);
    this.weatherFx.out.connect(this.outside);
    this.weatherFx.near.connect(this.fxBus);

    this.ready = true;
    this.applyView(ctx.currentTime);
  }

  setVolume(master: number): void {
    this.vol = clamp(master, 0, 1.5);
    if (!this.ready) return;
    setT(this.master.gain, this.vol, this.now(), 0.03);
  }

  setView(v: 'chase' | 'cockpit' | 'tv'): void {
    if (v === this.view) return;
    this.view = v;
    if (v === 'tv') this.tv.x = -(80 + Math.random() * 60);
    if (this.ready) this.applyView(this.now());
  }

  private applyView(now: number): void {
    const v = VIEWS[this.view];
    this.engine.setMix(v, now);
    setT(this.nearDirect.gain, v.nearDirect, now, 0.06);
    setT(this.nearOut.gain, 1 - v.nearDirect, now, 0.06);
    setT(this.outsideLP.frequency, v.outsideLP, now, 0.08);
    setT(this.revSend.gain, v.reverb, now, 0.1);
    setT(this.nearBody.gain, v.body, now, 0.1);
    setT(this.oppBus.gain, v.opponents, now, 0.1);
    if (this.view !== 'tv') {
      this.dop = 1;
      for (const p of [this.nearAtt.gain, this.farAtt.gain]) setT(p, 1, now, 0.05);
      for (const p of [this.nearPan.pan, this.farPan.pan]) setT(p, 0, now, 0.05);
    }
    this.pushPlayer(now);
  }

  updatePlayer(s: PlayerAudioState): void {
    this.ps = { ...s };
    if (!this.live()) return;
    this.pushPlayer(this.now());
  }

  private pushPlayer(now: number): void {
    const s = this.ps;
    const v = VIEWS[this.view];
    this.engine.set(
      {
        rpm: s.rpm,
        throttle: s.throttle,
        brake: s.brake,
        speed: s.speed,
        ers: s.ers,
        limiter: s.limiter,
        boost: this.boost,
        dop: this.dop,
        popBoost: this.popBoost,
      },
      now,
    );
    this.fx.set(s, v, this.dop, now);
  }

  shift(up: boolean): void {
    if (!this.live()) return;
    this.engine.shift(up, this.now());
    if (!up) this.popBoost = 1;
  }

  updateOpponents(list: { id: number; rpm: number; throttle: number; distance: number; relVel: number; pan: number }[]): void {
    if (!this.live()) return;
    const now = this.now();
    const cand = list
      .filter((o) => Number.isFinite(o.distance) && Number.isFinite(o.rpm) && o.distance < 320)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.voices.length);
    const want = new Set(cand.map((o) => o.id));
    for (const vc of this.voices) if (vc.id !== null && !want.has(vc.id)) vc.release(now);
    let whoosh = 0;
    for (const o of cand) {
      let vc = this.voices.find((x) => x.id === o.id);
      if (!vc) {
        vc = this.voices.filter((x) => x.id === null).sort((a, b) => a.freeAt - b.freeAt)[0];
        if (!vc) continue;
        vc.assign(o.id, o, now);
      }
      vc.set(o, now, 1);
      // close, fast pass → air displacement whoosh
      whoosh += Math.min(1, Math.abs(o.relVel) / 45) / (1 + (o.distance / 5) ** 2);
    }
    setT(this.whooshG.gain, 0.12 * Math.min(1, whoosh), now, 0.04);
  }

  impact(strength: number): void {
    if (!this.live()) return;
    impactSound(this.ctx!, this.b, this.fxBus, strength, this.now());
  }

  /** a car exploding; near 0..1 by distance */
  explosion(near: number): void {
    if (!this.live()) return;
    explosionSound(this.ctx!, this.b, this.fxBus, near, this.now());
  }

  startBeep(final: boolean): void {
    if (!this.live()) return;
    beepSound(this.ctx!, this.fxBus, final, this.now());
  }

  /** rain rate and track water 0..1, player speed (m/s), lightning flash 0..1, wind (m/s) — every frame */
  weather(rain: number, wet: number, speed: number, flash: number, wind = 0): void {
    if (!this.ready) return;
    this.weatherFx.set(rain, wet, speed, flash, wind, this.now());
  }

  crowd(level: number): void {
    if (!this.ready) return;
    this.crowdFx.setLevel(level, this.now());
  }

  ui(kind: 'move' | 'select' | 'back'): void {
    if (!this.live()) return;
    uiSound(this.ctx!, this.b, this.uiBus, kind, this.now());
  }

  /**
   * Optional: real tv-camera geometry (distance m, relVel m/s + = approaching, pan −1..1).
   * Without it the tv view simulates trackside cameras the car drives past.
   */
  setTvCamera(distance: number, relVel: number, pan: number): void {
    if (!this.ready) return;
    this.tv.extT = this.now();
    this.tv.dist = Math.max(1, distance);
    this.tv.relVel = relVel;
    this.tv.pan = pan;
  }

  update(dt: number): void {
    if (!this.live()) return;
    const now = this.now();
    dt = clamp(dt, 0, 0.1);
    const s = this.ps;

    // turbo shaft speed: spools with revs × load, lags, spins down slowly
    const R = clamp(s.rpm / 12000, 0, 1.1);
    const target = R * R * (0.25 + 0.75 * clamp(s.throttle, 0, 1));
    const tau = target > this.boost ? 0.28 : 0.9;
    this.boost += (target - this.boost) * (1 - Math.exp(-dt / tau));
    this.popBoost *= Math.exp(-dt / 0.35);

    if (this.view === 'tv') this.updateTv(dt, now);
    this.fx.update(dt);
    this.crowdFx.update(dt, now);
    this.pushPlayer(now);
  }

  private updateTv(dt: number, now: number): void {
    const tv = this.tv;
    if (now - tv.extT > 0.3) {
      const v = Math.max(0, this.ps.speed);
      tv.x += v * dt;
      if (tv.x > 55 + tv.lat) {
        // director cuts to the next camera down the road
        tv.x = -(70 + Math.random() * 110);
        tv.lat = 7 + Math.random() * 22;
        tv.side = Math.random() < 0.5 ? -1 : 1;
      }
      tv.dist = Math.hypot(tv.x, tv.lat);
      tv.relVel = (-v * tv.x) / tv.dist;
      tv.pan = clamp((tv.x / tv.dist) * 0.85 * tv.side, -1, 1);
    }
    this.dop = C_SOUND / (C_SOUND - clamp(tv.relVel, -140, 140));
    const att = clamp(16 / (6 + tv.dist), 0.02, 1.2);
    setT(this.nearAtt.gain, att, now, 0.03);
    setT(this.farAtt.gain, att, now, 0.03);
    setT(this.nearPan.pan, tv.pan, now, 0.04);
    setT(this.farPan.pan, tv.pan, now, 0.04);
    setT(this.outsideLP.frequency, 1800 + 16000 * Math.exp(-tv.dist / 120), now, 0.05);
  }

  suspend(): void {
    const ctx = this.ctx;
    if (!ctx || !isRealtime(ctx) || !this.ready) return;
    const tok = ++this.suspendToken;
    this.fade.gain.cancelScheduledValues(ctx.currentTime);
    this.fade.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
    setTimeout(() => {
      if (tok === this.suspendToken) void ctx.suspend().catch(() => {});
    }, 90);
  }

  resume(): void {
    const ctx = this.ctx;
    if (!ctx || !isRealtime(ctx)) return;
    const tok = ++this.suspendToken;
    void ctx
      .resume()
      .then(() => {
        if (tok !== this.suspendToken || !this.ready) return;
        this.fade.gain.cancelScheduledValues(ctx.currentTime);
        this.fade.gain.setTargetAtTime(1, ctx.currentTime, 0.03);
        this.pushPlayer(ctx.currentTime);
      })
      .catch(() => {});
  }

  /** Dev/debug: current internal state (tv doppler factor, turbo shaft speed). */
  _info(): { dop: number; boost: number } {
    return { dop: this.dop, boost: this.boost };
  }

  /**
   * Dev/debug: keep only the named layers — engine layers (exhaust, rasp, pops, intake, roar,
   * mech, whistle, whoosh, gear, ers, clack) and/or 'fx' (tyres/surfaces/wind), 'opp', 'crowd',
   * 'events' (impacts, beeps, ui).
   */
  _solo(keep: string[] | null): void {
    if (!this.ready) return;
    this.engine.solo(keep);
    const toggle = (node: AudioNode, dest: AudioNode, on: boolean) => {
      try {
        node.disconnect(dest);
      } catch {
        /* not connected */
      }
      if (on) node.connect(dest);
    };
    toggle(this.fx.out, this.nearIn, !keep || keep.includes('fx'));
    toggle(this.oppBus, this.outside, !keep || keep.includes('opp'));
    toggle(this.crowdFx.out, this.outside, !keep || keep.includes('crowd'));
    toggle(this.fxBus, this.direct, !keep || keep.includes('events'));
    toggle(this.uiBus, this.master, !keep || keep.includes('events'));
  }
}
