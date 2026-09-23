import { ENGINE_WORKLET_SRC } from './engineWorklet.ts';
import { type AudioBuffers, biquad, chain, clamp, forget, gainNode, loopSource, rectCurve, setT, smoothstep, tanhCurve } from './dsp.ts';

/** AudioParams every engine voice exposes (worklet or native fallback). */
export interface EngineParams {
  rpm: AudioParam;
  rpmOfs: AudioParam;
  load: AudioParam;
  dop: AudioParam;
  limiter: AudioParam;
  pops: AudioParam;
  bang: AudioParam;
  active: AudioParam;
}

export interface EngineSource {
  out: AudioNode;
  channels: number;
  p: EngineParams;
  worklet: boolean;
}

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Registers the engine processor on this context. Resolves false if AudioWorklet is unavailable. */
export function loadEngineWorklet(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx);
  if (!p) {
    p = (async () => {
      if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
      const url = URL.createObjectURL(new Blob([ENGINE_WORKLET_SRC], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
        return true;
      } catch (e) {
        console.warn('[audio] engine worklet failed, using native fallback', e);
        return false;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    loaded.set(ctx, p);
  }
  return p;
}

export function createEngineSource(ctx: BaseAudioContext, worklet: boolean, mono: boolean, seed: number, variant: number, bufs: AudioBuffers): EngineSource {
  if (worklet) {
    const node = new AudioWorkletNode(ctx, 'apex-engine', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [mono ? 1 : 6],
      processorOptions: { mono, seed, variant },
    });
    const g = (n: string) => node.parameters.get(n)!;
    return {
      out: node,
      channels: mono ? 1 : 6,
      worklet: true,
      p: { rpm: g('rpm'), rpmOfs: g('rpmOfs'), load: g('load'), dop: g('dop'), limiter: g('limiter'), pops: g('pops'), bang: g('bang'), active: g('active') },
    };
  }
  return createNativeEngine(ctx, mono, variant, bufs);
}

/**
 * Fallback (no AudioWorklet, e.g. insecure http origin): PeriodicWave core at the 720° cycle
 * frequency with firing orders + half orders, noise rasp gated at firing rate.
 */
function createNativeEngine(ctx: BaseAudioContext, mono: boolean, variant: number, bufs: AudioBuffers): EngineSource {
  const cs = (v: number) => {
    const c = new ConstantSourceNode(ctx, { offset: v });
    c.start();
    return c;
  };
  const rpm = cs(4200);
  const rpmOfs = cs(0);
  const load = cs(0);
  const dummy = cs(0);
  // cycle frequency = rpm / 120 × dop
  const toHz = gainNode(ctx, 1 / 120);
  const dopG = gainNode(ctx, 1);
  rpm.connect(toHz);
  rpmOfs.connect(toHz);
  toHz.connect(dopG);

  const N = 72;
  const mk = (bright: number, halfOrders: number) => {
    const re = new Float32Array(N + 1);
    const im = new Float32Array(N + 1);
    for (let k = 1; k <= N; k++) {
      const order = k / 2;
      let a = 0.05 / Math.sqrt(k);
      if (k % 6 === 0) a = (order === 6 ? 1.3 : 1) / Math.pow(order / 3, 2.1 - 0.6 * bright);
      else if (k % 3 === 0) a = halfOrders / Math.pow(order / 1.5, 1.6);
      const ph = Math.sin(k * 12.9898 + variant * 7) * Math.PI;
      re[k] = a * Math.cos(ph);
      im[k] = a * Math.sin(ph);
    }
    return ctx.createPeriodicWave(re, im);
  };
  const core = new OscillatorNode(ctx, { frequency: 0 });
  core.setPeriodicWave(mk(0.8, 0.28));
  dopG.connect(core.frequency);
  const coreG = gainNode(ctx, 0.12);
  const loadToCore = gainNode(ctx, 0.3);
  load.connect(loadToCore).connect(coreG.gain);
  const coreLP = biquad(ctx, 'lowpass', 3200, 0.6);
  chain(core, coreLP, coreG);
  core.start();

  // rasp: noise × rectified firing-rate pulse
  const fire = new OscillatorNode(ctx, { frequency: 0, type: 'sawtooth' });
  const toFire = gainNode(ctx, 6);
  dopG.connect(toFire).connect(fire.frequency);
  const rect = new WaveShaperNode(ctx, { curve: rectCurve(3) });
  const noise = loopSource(ctx, bufs.white);
  const raspAM = gainNode(ctx, 0);
  chain(fire, rect);
  rect.connect(raspAM.gain);
  noise.connect(raspAM);
  const raspBP = biquad(ctx, 'bandpass', 2200, 0.8);
  const raspG = gainNode(ctx, 0.05);
  load.connect(gainNode(ctx, 0.12)).connect(raspG.gain);
  chain(raspAM, raspBP, raspG);
  fire.start();

  let out: AudioNode;
  if (mono) {
    const sum = gainNode(ctx, 1);
    coreG.connect(sum);
    raspG.connect(sum);
    out = sum;
  } else {
    const merge = new ChannelMergerNode(ctx, { numberOfInputs: 6 });
    coreG.connect(merge, 0, 0);
    raspAM.connect(merge, 0, 1);
    const inCore = new OscillatorNode(ctx, { frequency: 0 });
    inCore.setPeriodicWave(mk(0.2, 0.15));
    dopG.connect(inCore.frequency);
    const inG = gainNode(ctx, 0.1);
    inCore.connect(inG).connect(merge, 0, 2);
    inCore.start();
    const roar = gainNode(ctx, 0);
    rect.connect(roar.gain);
    loopSource(ctx, bufs.white).connect(roar);
    roar.connect(merge, 0, 3);
    out = merge;
  }
  return {
    out,
    channels: mono ? 1 : 6,
    worklet: false,
    p: { rpm: rpm.offset, rpmOfs: rpmOfs.offset, load: load.offset, dop: dopG.gain, limiter: dummy.offset, pops: dummy.offset, bang: dummy.offset, active: dummy.offset },
  };
}

// ---------------------------------------------------------------------------------------------

/** Per-view weights of the player's engine layers. */
export interface EngineMix {
  exhaust: number;
  rasp: number;
  pops: number;
  intake: number;
  roar: number;
  mech: number;
  whistle: number;
  gear: number;
}

export interface EngineDrive {
  rpm: number;
  throttle: number;
  brake: number;
  speed: number;
  ers: number;
  limiter: boolean;
  /** turbo shaft speed 0..1 (lagged) */
  boost: number;
  /** doppler factor applied to everything (tv view) */
  dop: number;
  /** extra pop probability (after downshift blips) */
  popBoost: number;
}

/**
 * The player's engine: one 6-channel voice split into layers with their own filters/gains,
 * plus natively generated turbo whistle, gearbox whine, ERS whine and gearshift "clack".
 * `near` receives cockpit-side layers (intake, mechanical, whines), `far` the exhaust.
 */
export class PlayerEngine {
  readonly src: EngineSource;
  private ctx: BaseAudioContext;
  private exLP: BiquadFilterNode;
  private exG: GainNode;
  private raspBP: BiquadFilterNode;
  private raspG: GainNode;
  private popG: GainNode;
  private exView: GainNode;
  private inLP: BiquadFilterNode;
  private inView: GainNode;
  private roarBP: BiquadFilterNode;
  private roarG: GainNode;
  private mechG: GainNode;
  private w1: OscillatorNode;
  private w2: OscillatorNode;
  private wG: GainNode;
  private whooshBP: BiquadFilterNode;
  private whooshG: GainNode;
  private gearOsc: OscillatorNode;
  private gearG: GainNode;
  private ersOsc: OscillatorNode;
  private ersG: GainNode;
  private clackOut: GainNode;
  private bufs: AudioBuffers;
  private mix: EngineMix;
  private bangCount = 0;
  cutUntil = 0;
  private lastThr = 0;

  constructor(ctx: BaseAudioContext, src: EngineSource, bufs: AudioBuffers, near: AudioNode, far: AudioNode, mix: EngineMix) {
    this.ctx = ctx;
    this.src = src;
    this.bufs = bufs;
    this.mix = mix;
    const sp = new ChannelSplitterNode(ctx, { numberOfOutputs: 6 });
    src.out.connect(sp);

    // --- exhaust tone: body + bark formants, load-dependent brightness
    const exBody = biquad(ctx, 'peaking', 115, 0.9, 3.5);
    const exBark = biquad(ctx, 'peaking', 1450, 1.1, 2.5);
    this.exLP = biquad(ctx, 'lowpass', 6000, 0.55);
    this.exG = gainNode(ctx, 1);
    sp.connect(exBody, 0);
    chain(exBody, exBark, this.exLP, this.exG);

    // --- rasp: gated noise, band-passed
    const raspHP = biquad(ctx, 'highpass', 650, 0.6);
    this.raspBP = biquad(ctx, 'bandpass', 2200, 0.75);
    this.raspG = gainNode(ctx, 0);
    sp.connect(raspHP, 1);
    chain(raspHP, this.raspBP, this.raspG);

    // --- pops / crackles
    const popHP = biquad(ctx, 'highpass', 220, 0.7);
    const popSh = new WaveShaperNode(ctx, { curve: tanhCurve(2.2), oversample: '2x' });
    const popPk = biquad(ctx, 'peaking', 2400, 1.0, 3);
    const popLP = biquad(ctx, 'lowpass', 6500, 0.6);
    this.popG = gainNode(ctx, 0);
    sp.connect(popHP, 4);
    chain(popHP, popSh, popPk, popLP, this.popG);

    const exSum = gainNode(ctx, 1);
    const exSat = new WaveShaperNode(ctx, { curve: tanhCurve(1.4), oversample: '2x' });
    this.exView = gainNode(ctx, mix.exhaust);
    this.exG.connect(exSum);
    this.raspG.connect(exSum);
    this.popG.connect(exSum);
    chain(exSum, exSat, this.exView, far);

    // --- intake tone: airbox Helmholtz peak + trumpet, low-passed
    const inBox = biquad(ctx, 'peaking', 165, 1.3, 5);
    const inHonk = biquad(ctx, 'peaking', 520, 1.4, 3);
    this.inLP = biquad(ctx, 'lowpass', 3000, 0.6);
    this.inView = gainNode(ctx, mix.intake);
    sp.connect(inBox, 2);
    chain(inBox, inHonk, this.inLP, this.inView, near);

    // --- induction roar
    this.roarBP = biquad(ctx, 'bandpass', 1100, 0.65);
    this.roarG = gainNode(ctx, 0);
    sp.connect(this.roarBP, 3);
    chain(this.roarBP, this.roarG, near);

    // --- mechanical (valvetrain)
    const mechHP = biquad(ctx, 'highpass', 1500, 0.7);
    this.mechG = gainNode(ctx, 0);
    sp.connect(mechHP, 5);
    chain(mechHP, this.mechG, near);

    // --- turbo / MGU-H whistle + compressor whoosh
    this.w1 = new OscillatorNode(ctx, { type: 'sine', frequency: 3000 });
    this.w2 = new OscillatorNode(ctx, { type: 'sine', frequency: 4500 });
    const w2g = gainNode(ctx, 0.35);
    this.wG = gainNode(ctx, 0);
    this.w1.connect(this.wG);
    this.w2.connect(w2g).connect(this.wG);
    this.wG.connect(near);
    this.whooshBP = biquad(ctx, 'bandpass', 3500, 1.6);
    this.whooshG = gainNode(ctx, 0);
    chain(loopSource(ctx, bufs.white), this.whooshBP, this.whooshG, near);
    this.w1.start();
    this.w2.start();

    // --- gearbox whine (straight-cut gears, rises with road speed)
    const gw = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.32, 0.12, 0.05]));
    this.gearOsc = new OscillatorNode(ctx, { frequency: 200 });
    this.gearOsc.setPeriodicWave(gw);
    this.gearG = gainNode(ctx, 0);
    chain(this.gearOsc, this.gearG, near);
    this.gearOsc.start();

    // --- MGU-K / ERS electric whine
    this.ersOsc = new OscillatorNode(ctx, { type: 'triangle', frequency: 2000 });
    this.ersG = gainNode(ctx, 0);
    chain(this.ersOsc, this.ersG, near);
    this.ersOsc.start();

    this.clackOut = gainNode(ctx, 1);
    this.clackOut.connect(near);

    this.layers = {
      exhaust: [this.exG, exSum],
      rasp: [this.raspG, exSum],
      pops: [this.popG, exSum],
      intake: [this.inView, near],
      roar: [this.roarG, near],
      mech: [this.mechG, near],
      whistle: [this.wG, near],
      whoosh: [this.whooshG, near],
      gear: [this.gearG, near],
      ers: [this.ersG, near],
      clack: [this.clackOut, near],
    };
  }

  private layers: Record<string, [AudioNode, AudioNode]>;

  /** Debug: keep only the named layers audible (null = all). */
  solo(keep: string[] | null): void {
    for (const [name, [node, dest]] of Object.entries(this.layers)) {
      try {
        node.disconnect(dest);
      } catch {
        /* not connected */
      }
      if (!keep || keep.includes(name)) node.connect(dest);
    }
  }

  setMix(mix: EngineMix, now: number): void {
    this.mix = mix;
    setT(this.exView.gain, mix.exhaust, now, 0.08);
    setT(this.inView.gain, mix.intake, now, 0.08);
  }

  set(d: EngineDrive, now: number): void {
    const p = this.src.p;
    const m = this.mix;
    const thr = clamp(d.throttle, 0, 1);
    this.lastThr = thr;
    const R = clamp(d.rpm / 12000, 0.2, 1.15);
    setT(p.rpm, d.rpm, now, 0.012, 5e-4);
    setT(p.dop, d.dop, now, 0.04, 5e-4);
    const cutting = now < this.cutUntil;
    if (!cutting) setT(p.load, thr, now, 0.028);
    setT(p.limiter, d.limiter ? 1 : 0, now, 0.001);
    const overrun = thr < 0.1 && d.rpm > 6000 ? 0.18 : 0;
    setT(p.pops, overrun + d.popBoost, now, 0.01);

    // layer levels crossfaded by revs and load
    const lpHz = (1600 + 5200 * thr * (0.4 + 0.6 * R) + 1200 * R) * d.dop;
    setT(this.exLP.frequency, lpHz, now, 0.03);
    setT(this.exG.gain, 0.8 + 0.25 * R, now, 0.05);
    if (!cutting) {
      setT(this.raspG.gain, (0.12 + 0.88 * thr) * (0.3 + 0.7 * Math.pow(R, 1.4)) * 1.9 * m.rasp, now, 0.03);
      setT(this.roarG.gain, (0.08 + 0.92 * thr) * Math.pow(R, 1.6) * 1.4 * m.roar, now, 0.03);
    }
    setT(this.raspBP.frequency, (1500 + 1500 * R) * d.dop, now, 0.05);
    setT(this.roarBP.frequency, (850 + 700 * R) * d.dop, now, 0.05);
    setT(this.inLP.frequency, (1500 + 3000 * thr * R + 600) * d.dop, now, 0.04);
    setT(this.popG.gain, 0.9 * m.pops, now, 0.05);
    setT(this.mechG.gain, 3.8 * (0.3 + 0.7 * R) * m.mech, now, 0.05);

    // turbo: whistle frequency follows shaft speed
    const b = clamp(d.boost, 0, 1.2);
    setT(this.w1.frequency, (2600 + 5400 * b) * d.dop, now, 0.03);
    setT(this.w2.frequency, (2600 + 5400 * b) * 1.503 * d.dop, now, 0.03);
    setT(this.wG.gain, 0.022 * b * b * m.whistle, now, 0.04);
    setT(this.whooshBP.frequency, (1800 + 3000 * b) * d.dop, now, 0.05);
    setT(this.whooshG.gain, 0.05 * b * b * (0.3 + 0.7 * thr) * m.whistle, now, 0.05);

    // gearbox whine ∝ road speed
    const sp = Math.max(0, d.speed);
    setT(this.gearOsc.frequency, Math.max(20, sp * 41) * d.dop, now, 0.03);
    setT(this.gearG.gain, 0.03 * (0.35 + 0.65 * thr) * smoothstep(3, 30, sp) * m.gear, now, 0.05);

    // ERS: deploy whine + fainter harvest whine under braking
    setT(this.ersOsc.frequency, Math.max(40, d.rpm * 0.29) * d.dop, now, 0.03);
    const ersLvl = clamp(d.ers, 0, 1) * 0.006 + clamp(d.brake, 0, 1) * smoothstep(10, 40, sp) * 0.0035;
    setT(this.ersG.gain, ersLvl * m.gear, now, 0.06);
  }

  /** Upshift: ~50 ms torque cut then re-bite with a small bang. Downshift: throttle blip + crackle. */
  shift(up: boolean, now: number): void {
    const p = this.src.p;
    const thr = this.lastThr;
    const m = this.mix;
    p.load.cancelScheduledValues(now);
    forget(p.load);
    forget(this.raspG.gain);
    forget(this.roarG.gain);
    if (up) {
      const cutEnd = now + 0.048;
      p.load.setTargetAtTime(0.08, now, 0.004);
      p.load.setTargetAtTime(thr, cutEnd, 0.01);
      p.bang.setValueAtTime(++this.bangCount, cutEnd - 0.004);
      this.raspG.gain.setTargetAtTime(0.25 * m.rasp, now, 0.006);
      this.raspG.gain.setTargetAtTime(1.9 * m.rasp * (0.12 + 0.88 * thr), cutEnd, 0.012);
      this.roarG.gain.setTargetAtTime(0.15 * m.roar, now, 0.008);
      this.roarG.gain.setTargetAtTime(1.4 * m.roar * (0.08 + 0.92 * thr), cutEnd, 0.02);
      this.cutUntil = cutEnd + 0.03;
    } else {
      const blipEnd = now + 0.075;
      p.load.setTargetAtTime(0.85, now, 0.008);
      p.load.setTargetAtTime(thr, blipEnd, 0.03);
      p.rpmOfs.cancelScheduledValues(now);
      p.rpmOfs.setTargetAtTime(480, now, 0.018);
      p.rpmOfs.setTargetAtTime(0, blipEnd, 0.05);
      this.raspG.gain.setTargetAtTime(1.2 * m.rasp, now, 0.01);
      this.raspG.gain.setTargetAtTime(1.9 * m.rasp * (0.12 + 0.88 * thr) * 0.5, blipEnd, 0.04);
      this.roarG.gain.setTargetAtTime(1.0 * m.roar, now, 0.01);
      this.roarG.gain.setTargetAtTime(0.1 * m.roar, blipEnd, 0.05);
      this.cutUntil = blipEnd + 0.06;
    }
    this.clack(now, up);
  }

  /** Short mechanical "clack" of the seamless-shift barrel (mostly heard onboard). */
  private clack(now: number, up: boolean): void {
    const ctx = this.ctx;
    const lvl = this.mix.mech;
    if (lvl < 0.05) return;
    const n = new AudioBufferSourceNode(ctx, { buffer: this.bufs.white, playbackRate: 1 });
    const bp = biquad(ctx, 'bandpass', up ? 2400 : 1900, 1.8);
    const g = gainNode(ctx, 0);
    chain(n, bp, g, this.clackOut);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.16 * lvl, now + 0.002);
    g.gain.setTargetAtTime(0, now + 0.004, 0.006);
    n.start(now, Math.random() * 2, 0.06);
    const th = new OscillatorNode(ctx, { type: 'sine', frequency: 95 });
    const tg = gainNode(ctx, 0);
    chain(th, tg, this.clackOut);
    tg.gain.setValueAtTime(0, now);
    tg.gain.linearRampToValueAtTime(0.1 * lvl, now + 0.003);
    tg.gain.setTargetAtTime(0, now + 0.006, 0.012);
    th.frequency.setValueAtTime(110, now);
    th.frequency.exponentialRampToValueAtTime(60, now + 0.05);
    th.start(now);
    th.stop(now + 0.09);
  }
}

// ---------------------------------------------------------------------------------------------

/** Cheaper exterior-only engine voice for an opponent car (pooled). */
export class OpponentVoice {
  readonly src: EngineSource;
  readonly lp: BiquadFilterNode;
  readonly g: GainNode;
  readonly pan: StereoPannerNode;
  id: number | null = null;
  freeAt = 0;
  startAt = 0;
  dist = 1e9;
  relVel = 0;

  constructor(ctx: BaseAudioContext, src: EngineSource, out: AudioNode) {
    this.src = src;
    this.lp = biquad(ctx, 'lowpass', 8000, 0.5);
    this.g = gainNode(ctx, 0);
    this.pan = new StereoPannerNode(ctx, { pan: 0 });
    chain(src.out, this.lp, this.g, this.pan, out);
    src.p.active.value = 0;
  }

  assign(id: number, o: { rpm: number; throttle: number }, now: number): void {
    this.id = id;
    const t = Math.max(now, this.freeAt);
    this.startAt = t;
    const p = this.src.p;
    p.active.cancelScheduledValues(now);
    p.active.setValueAtTime(1, now);
    for (const prm of [p.rpm, p.load, p.dop, this.g.gain]) forget(prm);
    p.rpm.setValueAtTime(clamp(o.rpm, 3000, 15000), t);
    p.load.setValueAtTime(clamp(o.throttle, 0, 1), t);
  }

  release(now: number): void {
    this.id = null;
    this.dist = 1e9;
    forget(this.g.gain);
    this.g.gain.cancelScheduledValues(now);
    this.g.gain.setTargetAtTime(0, now, 0.025);
    this.freeAt = now + 0.14;
    this.src.p.active.setValueAtTime(0, this.freeAt);
  }

  set(o: { rpm: number; throttle: number; distance: number; relVel: number; pan: number }, now: number, level: number): void {
    const t = Math.max(now, this.startAt);
    const p = this.src.p;
    const d = Math.max(0.5, o.distance);
    this.dist = d;
    this.relVel = o.relVel;
    const v = clamp(o.relVel, -140, 140);
    const dop = 343 / (343 - v);
    setT(p.rpm, clamp(o.rpm, 3000, 15000), t, 0.03, 5e-4);
    setT(p.load, clamp(o.throttle, 0, 1), t, 0.04);
    setT(p.dop, dop, t, 0.035, 5e-4);
    // inverse-distance loudness, air absorption, rear-facing exhaust is brighter when receding
    const att = clamp(7 / (2 + d), 0, 1.4) * level;
    const bright = (2200 + 15000 * Math.exp(-d / 55)) * (v < 0 ? 1.15 : 0.8);
    setT(this.g.gain, att, t, 0.04);
    setT(this.lp.frequency, clamp(bright, 800, 20000), t, 0.05);
    setT(this.pan.pan, clamp(o.pan, -1, 1) * 0.9, t, 0.04);
  }
}
