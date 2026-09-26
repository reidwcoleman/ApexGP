import { type AudioBuffers, biquad, chain, clamp, gainNode, loopSource, rectCurve, setT, smoothstep, tanhCurve } from './dsp.ts';

export interface CarFxState {
  speed: number;
  slip: number;
  brake: number;
  throttle: number;
  surface: number;
  onKerb: boolean;
  drs: boolean;
}

export interface CarFxMix {
  tyres: number;
  wind: number;
  buffet: number;
}

/**
 * Everything the player's car makes besides the engine: tyre scrub/squeal (rubber stick-slip,
 * not a whistle), kerb rumble, gravel crunch, grass swish, road roar, wind rush, helmet buffeting
 * and the DRS "stall" change.
 */
export class CarFx {
  readonly out: GainNode;
  private scrubG: GainNode;
  private sqBP1: BiquadFilterNode;
  private sqBP2: BiquadFilterNode;
  private sqSaw: OscillatorNode;
  private sqAMDepth: GainNode;
  private sqChatter: OscillatorNode;
  private sqG: GainNode;
  private kerbOsc: OscillatorNode;
  private kerbG: GainNode;
  private gravel: AudioBufferSourceNode;
  private gravelG: GainNode;
  private gravelRumbleG: GainNode;
  private grassG: GainNode;
  private grassRumbleG: GainNode;
  private roadG: GainNode;
  private roadLP: BiquadFilterNode;
  private windBP: BiquadFilterNode;
  private windG: GainNode;
  private buffetG: GainNode;
  private drsG: GainNode;
  private sqBase = 900;
  private sqLast = 0;
  private t = 0;

  constructor(ctx: BaseAudioContext, b: AudioBuffers) {
    this.out = gainNode(ctx, 1);
    const white = () => loopSource(ctx, b.white);
    const pink = () => loopSource(ctx, b.pink);

    // --- tyre scrub: low grumbly sliding noise with grainy amplitude
    const scrubBP = biquad(ctx, 'bandpass', 420, 0.9);
    const scrubLP = biquad(ctx, 'lowpass', 1100, 0.7);
    const scrubAM = gainNode(ctx, 0.6);
    const grain = loopSource(ctx, b.crunch, 0.35);
    const grainG = gainNode(ctx, 0.5);
    grain.connect(grainG).connect(scrubAM.gain);
    this.scrubG = gainNode(ctx, 0);
    chain(pink(), scrubBP, scrubLP, scrubAM, this.scrubG, this.out);

    // --- squeal: stick-slip relaxation tone (jittery saw) + resonant noise, chattering AM
    this.sqSaw = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 900 });
    const sawFM = loopSource(ctx, b.wander, 3.1);
    const sawFMg = gainNode(ctx, 55);
    sawFM.connect(sawFMg).connect(this.sqSaw.frequency);
    const sawJit = loopSource(ctx, b.white, 0.02); // very slow = rough random walk
    const sawJitG = gainNode(ctx, 18);
    sawJit.connect(sawJitG).connect(this.sqSaw.frequency);
    const sawShape = biquad(ctx, 'bandpass', 1300, 1.4);
    const sawG = gainNode(ctx, 0.2);
    chain(this.sqSaw, sawShape, sawG);
    this.sqSaw.start();

    this.sqBP1 = biquad(ctx, 'bandpass', 900, 4);
    this.sqBP2 = biquad(ctx, 'bandpass', 1900, 3.5);
    const nz = white();
    nz.connect(this.sqBP1);
    nz.connect(this.sqBP2);
    const wob = loopSource(ctx, b.wander, 1.7);
    const wobG1 = gainNode(ctx, 70);
    const wobG2 = gainNode(ctx, 140);
    wob.connect(wobG1).connect(this.sqBP1.frequency);
    wob.connect(wobG2).connect(this.sqBP2.frequency);
    const bp2g = gainNode(ctx, 0.4);
    this.sqBP2.connect(bp2g);

    const sqAM = gainNode(ctx, 0.55);
    this.sqChatter = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 38 });
    const chatRect = new WaveShaperNode(ctx, { curve: rectCurve(1.5) });
    this.sqAMDepth = gainNode(ctx, 0.45);
    chain(this.sqChatter, chatRect, this.sqAMDepth);
    this.sqAMDepth.connect(sqAM.gain);
    this.sqChatter.start();
    const sqPre = gainNode(ctx, 1);
    this.sqBP1.connect(sqPre);
    bp2g.connect(sqPre);
    sawG.connect(sqPre);
    const sqSat = new WaveShaperNode(ctx, { curve: tanhCurve(1.4), oversample: '2x' });
    // the squeal's top end is what makes it grate: keep the body, roll the fizz off
    const sqLP = biquad(ctx, 'lowpass', 2800, 0.6);
    this.sqG = gainNode(ctx, 0);
    chain(sqPre, sqAM, sqSat, sqLP, this.sqG, this.out);

    // --- kerb rumble: narrow pulse train at ridge rate → body thump + rattle
    const K = 24;
    const re = new Float32Array(K + 1);
    const im = new Float32Array(K + 1);
    for (let k = 1; k <= K; k++) re[k] = Math.sin(Math.PI * k * 0.12) / k;
    this.kerbOsc = new OscillatorNode(ctx, { frequency: 20 });
    this.kerbOsc.setPeriodicWave(ctx.createPeriodicWave(re, im));
    const kerbThumpLP = biquad(ctx, 'lowpass', 170, 1.1);
    const kerbBody = biquad(ctx, 'peaking', 75, 2, 4);
    const kerbRect = new WaveShaperNode(ctx, { curve: rectCurve(2) });
    const kerbRattle = gainNode(ctx, 0);
    const kerbRattleBP = biquad(ctx, 'bandpass', 750, 0.9);
    this.kerbG = gainNode(ctx, 0);
    chain(this.kerbOsc, kerbThumpLP, kerbBody, this.kerbG);
    this.kerbOsc.connect(kerbRect);
    kerbRect.connect(kerbRattle.gain);
    chain(white(), kerbRattleBP, kerbRattle);
    const kerbRattleG = gainNode(ctx, 0.32);
    kerbRattle.connect(kerbRattleG).connect(this.kerbG);
    this.kerbG.connect(this.out);
    this.kerbOsc.start();

    // --- gravel: crunch grains + low rumble
    this.gravel = loopSource(ctx, b.crunch, 1);
    const gravelHP = biquad(ctx, 'highpass', 380, 0.7);
    this.gravelG = gainNode(ctx, 0);
    chain(this.gravel, gravelHP, this.gravelG, this.out);
    const rumbleLP = biquad(ctx, 'lowpass', 110, 0.9);
    this.gravelRumbleG = gainNode(ctx, 0);
    chain(pink(), rumbleLP, this.gravelRumbleG, this.out);

    // --- grass: airy swish + soft bumps
    const grassBP = biquad(ctx, 'bandpass', 2100, 0.55);
    const grassAM = gainNode(ctx, 0.7);
    const grassWob = loopSource(ctx, b.wander, 6);
    const grassWobG = gainNode(ctx, 0.3);
    grassWob.connect(grassWobG).connect(grassAM.gain);
    this.grassG = gainNode(ctx, 0);
    chain(pink(), grassBP, grassAM, this.grassG, this.out);
    const grassLP = biquad(ctx, 'lowpass', 90, 0.8);
    this.grassRumbleG = gainNode(ctx, 0);
    chain(pink(), grassLP, this.grassRumbleG, this.out);

    // --- road roar (tyre carcass on asphalt)
    this.roadLP = biquad(ctx, 'lowpass', 600, 0.6);
    const roadHP = biquad(ctx, 'highpass', 60, 0.7);
    this.roadG = gainNode(ctx, 0);
    chain(pink(), roadHP, this.roadLP, this.roadG, this.out);

    // --- wind rush ∝ v², helmet buffeting, DRS whoosh
    this.windBP = biquad(ctx, 'bandpass', 800, 0.45);
    this.windG = gainNode(ctx, 0);
    chain(pink(), this.windBP, this.windG, this.out);
    const buffLP = biquad(ctx, 'lowpass', 150, 0.9);
    const buffAM = gainNode(ctx, 0.6);
    const buffWob = loopSource(ctx, b.wander, 2.3);
    const buffWobG = gainNode(ctx, 0.45);
    buffWob.connect(buffWobG).connect(buffAM.gain);
    this.buffetG = gainNode(ctx, 0);
    chain(pink(), buffLP, buffAM, this.buffetG, this.out);
    const drsBP = biquad(ctx, 'bandpass', 2800, 1.1);
    this.drsG = gainNode(ctx, 0);
    chain(white(), drsBP, this.drsG, this.out);
  }

  set(s: CarFxState, mix: CarFxMix, dop: number, now: number): void {
    const v = Math.max(0, s.speed);
    const sp = smoothstep(2, 35, v);
    const slip = Math.max(0, s.slip);
    const surf = s.surface | 0;
    const loose = surf === 3 || surf === 4;
    const lock = s.brake > 0.5 && slip > 0.7 ? 1 : 0;

    // tyres
    const scrub = smoothstep(0.22, 0.85, slip) * (0.35 + 0.65 * sp) * (loose ? 0.35 : 1);
    setT(this.scrubG.gain, 0.5 * scrub * mix.tyres, now, 0.04);
    const sq = smoothstep(0.6, 1.2, slip) * sp * (loose ? 0.12 : 1);
    // softer onset (no stab on every little slide), and quieter overall: it's feedback, not a siren
    setT(this.sqG.gain, 0.15 * sq * (1 + 0.3 * lock) * mix.tyres, now, sq > this.sqLast ? 0.07 : 0.05);
    this.sqLast = sq;
    const f0 = (this.sqBase + 160 * clamp(slip - 0.6, 0, 1) + 240 * lock) * dop;
    setT(this.sqBP1.frequency, f0, now, 0.05);
    setT(this.sqBP2.frequency, f0 * 2.08, now, 0.05);
    setT(this.sqSaw.frequency, f0 * 0.98, now, 0.05);
    setT(this.sqChatter.frequency, 26 + 30 * clamp(slip, 0, 1.5) + 0.2 * v, now, 0.1);

    // kerb: ridge thumps at a rate ∝ speed
    const kerb = s.onKerb || surf === 1;
    setT(this.kerbOsc.frequency, clamp(v / 1.9, 3, 70), now, 0.03);
    setT(this.kerbG.gain, kerb ? 0.17 * smoothstep(1, 20, v) * mix.tyres : 0, now, 0.03);

    // surfaces
    setT(this.gravelG.gain, surf === 4 ? 0.32 * smoothstep(1, 25, v) * mix.tyres : 0, now, 0.04);
    setT(this.gravel.playbackRate, 0.55 + clamp(v / 45, 0, 1.4), now, 0.08);
    setT(this.gravelRumbleG.gain, surf === 4 ? 0.5 * sp * mix.tyres : 0, now, 0.05);
    setT(this.grassG.gain, surf === 3 ? 0.22 * smoothstep(2, 40, v) * mix.tyres : 0, now, 0.05);
    setT(this.grassRumbleG.gain, surf === 3 ? 0.35 * sp * mix.tyres : 0, now, 0.05);
    const road = surf === 2 ? 1.7 : loose ? 0.2 : 1;
    setT(this.roadG.gain, 0.05 * Math.pow(clamp(v / 90, 0, 1.2), 1.3) * road * mix.tyres, now, 0.08);
    setT(this.roadLP.frequency, 350 + 5 * v, now, 0.1);

    // wind ∝ v²; DRS open = less drag → slightly lighter, brighter rush
    const q = Math.pow(clamp(v / 92, 0, 1.25), 2);
    setT(this.windG.gain, 0.3 * q * (s.drs ? 0.82 : 1) * mix.wind, now, 0.06);
    setT(this.windBP.frequency, (380 + 16 * v) * (s.drs ? 1.18 : 1), now, 0.1);
    setT(this.buffetG.gain, 0.5 * q * (s.drs ? 0.75 : 1) * mix.buffet, now, 0.08);
    setT(this.drsG.gain, s.drs ? 0.035 * q * (0.5 + mix.wind) : 0, now, 0.12);
  }

  update(dt: number): void {
    // squeal pitch drifts slowly (tyre temperature/load), keeps it from sounding like a fixed whistle
    this.t += dt;
    this.sqBase = 880 + 90 * Math.sin(this.t * 0.37) + 50 * Math.sin(this.t * 1.13 + 1.3);
  }
}

// ---------------------------------------------------------------------------------------------

/** Stadium crowd bed: formant-filtered pink noise with swells, cheers and synthesized air horns. */
export class Crowd {
  readonly out: GainNode;
  private ctx: BaseAudioContext;
  private bedG: GainNode;
  private swellG: GainNode;
  private cheerG: GainNode;
  private level = 0;
  private cheerT = 6;
  private hornT = 8;
  private r = Math.random;

  constructor(ctx: BaseAudioContext, b: AudioBuffers) {
    this.ctx = ctx;
    this.out = gainNode(ctx, 1);
    const src = loopSource(ctx, b.pink);
    const f1 = biquad(ctx, 'bandpass', 420, 0.8);
    const f2 = biquad(ctx, 'bandpass', 1050, 1.2);
    const f3 = biquad(ctx, 'bandpass', 2500, 1.6);
    const g2 = gainNode(ctx, 0.75);
    const g3 = gainNode(ctx, 0.3);
    const sum = gainNode(ctx, 1);
    src.connect(f1).connect(sum);
    src.connect(f2).connect(g2).connect(sum);
    src.connect(f3).connect(g3).connect(sum);
    this.bedG = gainNode(ctx, 0);
    const swell = loopSource(ctx, b.wander, 0.12);
    this.swellG = gainNode(ctx, 0);
    swell.connect(this.swellG).connect(this.bedG.gain);
    chain(sum, this.bedG, this.out);

    // cheer layer: brighter "aaah" formants, normally silent
    const csrc = loopSource(ctx, b.pink);
    const c1 = biquad(ctx, 'bandpass', 800, 1.3);
    const c2 = biquad(ctx, 'bandpass', 1250, 1.6);
    const c3 = biquad(ctx, 'bandpass', 2700, 2.2);
    const cs = gainNode(ctx, 1);
    csrc.connect(c1).connect(cs);
    csrc.connect(c2).connect(cs);
    csrc.connect(c3).connect(gainNode(ctx, 0.5)).connect(cs);
    const cAM = gainNode(ctx, 0.75);
    loopSource(ctx, b.wander, 4).connect(gainNode(ctx, 0.25)).connect(cAM.gain);
    this.cheerG = gainNode(ctx, 0);
    chain(cs, cAM, this.cheerG, biquad(ctx, 'lowpass', 4200, 0.6), this.out);

    // "oooh": a darker, rounder vowel for crashes and near misses
    const gsrc = loopSource(ctx, b.pink);
    const o1 = biquad(ctx, 'bandpass', 360, 1.6);
    const o2 = biquad(ctx, 'bandpass', 720, 2.2);
    const os = gainNode(ctx, 1);
    gsrc.connect(o1).connect(os);
    gsrc.connect(o2).connect(gainNode(ctx, 0.6)).connect(os);
    this.gaspG = gainNode(ctx, 0);
    chain(os, this.gaspG, this.out);
  }

  private gaspG: GainNode;
  private reactAt = -1e9;

  /**
   * The grandstands react: 'cheer' (lights out, an overtake, the flag) or 'gasp' (a crash).
   * amt 0..1. Rate-limited so a busy lap doesn't turn into a wall of noise.
   */
  react(kind: 'cheer' | 'gasp', amt: number, now: number): void {
    if (this.level < 0.02 || now - this.reactAt < (kind === 'gasp' ? 1.5 : 4)) return;
    this.reactAt = now;
    if (kind === 'cheer') {
      this.cheer(now, clamp(amt, 0, 1));
      return;
    }
    const g = this.gaspG.gain;
    const pk = 0.5 * this.level * clamp(amt, 0, 1);
    g.cancelScheduledValues(now);
    g.setTargetAtTime(pk, now + 0.05, 0.12);
    g.setTargetAtTime(0, now + 0.7 + this.r() * 0.4, 0.5);
  }

  setLevel(l: number, now: number): void {
    this.level = clamp(l, 0, 1);
    const base = 0.3 * this.level;
    setT(this.bedG.gain, base, now, 0.4);
    setT(this.swellG.gain, base * 0.35, now, 0.4);
  }

  update(dt: number, now: number): void {
    if (this.level < 0.02) return;
    this.cheerT -= dt * this.level;
    this.hornT -= dt * this.level;
    if (this.cheerT <= 0) {
      this.cheerT = 10 + this.r() * 18;
      this.cheer(now, 0.35 + 0.4 * this.r());
    }
    if (this.hornT <= 0) {
      // the odd air horn somewhere in the stands (not a metronome)
      this.hornT = 14 + this.r() * 26;
      this.horn(now);
    }
  }

  cheer(now: number, amt: number): void {
    const g = this.cheerG.gain;
    const peak = 0.28 * this.level * amt;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(peak, now, 0.35);
    g.setTargetAtTime(0, now + 1.2 + this.r() * 1.5, 0.9);
  }

  horn(now: number): void {
    const ctx = this.ctx;
    const f = 400 + this.r() * 110;
    const dur = 0.35 + this.r() * 0.9;
    const pan = new StereoPannerNode(ctx, { pan: this.r() * 1.6 - 0.8 });
    const lp = biquad(ctx, 'lowpass', 1700, 0.7);
    const pk = biquad(ctx, 'peaking', 1000, 1.2, 3);
    const sh = new WaveShaperNode(ctx, { curve: tanhCurve(1.6) });
    const g = gainNode(ctx, 0);
    const oscs: OscillatorNode[] = [];
    const tones = this.r() < 0.4 ? [f, f * 1.26] : [f];
    for (const ft of tones) {
      const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: ft * 0.94 });
      o.frequency.setTargetAtTime(ft, now, 0.03);
      o.connect(lp);
      o.start(now);
      o.stop(now + dur + 0.3);
      oscs.push(o);
    }
    chain(lp, pk, sh, g, pan, this.out);
    const lvl = 0.028 * this.level * (0.5 + 0.5 * this.r());
    g.gain.setValueAtTime(0, now);
    g.gain.setTargetAtTime(lvl, now, 0.03);
    g.gain.setTargetAtTime(0, now + dur, 0.08);
  }
}

// ---------------------------------------------------------------------------------------------

/** Carbon crunch + thump + scrape + debris tinkle. */
export function impactSound(ctx: BaseAudioContext, b: AudioBuffers, out: AudioNode, strength: number, now: number): void {
  const s = clamp(strength, 0, 1);
  if (s < 0.01) return;
  const r = Math.random;
  // body thump
  const th = new OscillatorNode(ctx, { type: 'sine', frequency: 120 });
  const thF = 110 + 40 * r();
  th.frequency.setValueAtTime(thF, now);
  th.frequency.exponentialRampToValueAtTime(thF * 0.3, now + 0.25);
  const thG = gainNode(ctx, 0);
  chain(th, thG, out);
  thG.gain.setValueAtTime(0, now);
  thG.gain.linearRampToValueAtTime(0.8 * s, now + 0.004);
  thG.gain.setTargetAtTime(0, now + 0.01, 0.07 + 0.08 * s);
  th.start(now);
  th.stop(now + 0.8);
  // low noise burst
  const nb = new AudioBufferSourceNode(ctx, { buffer: b.white });
  const nbLP = biquad(ctx, 'lowpass', 700 + 1300 * s, 0.7);
  const nbG = gainNode(ctx, 0);
  chain(nb, nbLP, nbG, out);
  nbG.gain.setValueAtTime(0, now);
  nbG.gain.linearRampToValueAtTime(0.5 * s, now + 0.003);
  nbG.gain.setTargetAtTime(0, now + 0.006, 0.05);
  nb.start(now, r() * 2, 0.5);
  // carbon crunch (cracking shards)
  const cr = new AudioBufferSourceNode(ctx, { buffer: b.crackle, playbackRate: 0.75 + 0.5 * r() });
  const crBP = biquad(ctx, 'bandpass', 1500 + 700 * r(), 0.6);
  const crSh = new WaveShaperNode(ctx, { curve: tanhCurve(1.6), oversample: '2x' });
  const crG = gainNode(ctx, 0.32 * Math.sqrt(s));
  chain(cr, crBP, crSh, biquad(ctx, 'lowpass', 4500, 0.6), crG, out);
  cr.start(now + 0.002);
  // scrape: grinding carbon on concrete, pitch falling as the car slows
  const sc = new AudioBufferSourceNode(ctx, { buffer: b.white, loop: true });
  const scBP = biquad(ctx, 'bandpass', 2200, 2);
  const scBP2 = biquad(ctx, 'bandpass', 1100, 1.6);
  const scG = gainNode(ctx, 0);
  sc.connect(scBP).connect(scG);
  sc.connect(scBP2).connect(gainNode(ctx, 0.8)).connect(scG);
  chain(scG, biquad(ctx, 'lowpass', 3800, 0.6), out);
  const dur = 0.25 + 0.7 * s;
  scBP.frequency.setValueAtTime(2300 + 500 * r(), now);
  scBP.frequency.exponentialRampToValueAtTime(1000, now + dur);
  const lvl = 0.2 * s;
  scG.gain.setValueAtTime(0, now);
  let t = now + 0.01;
  while (t < now + dur) {
    const k = 1 - (t - now) / dur;
    scG.gain.setTargetAtTime(lvl * k * (0.35 + 0.65 * r()), t, 0.008);
    t += 0.012 + r() * 0.025;
  }
  scG.gain.setTargetAtTime(0, now + dur, 0.05);
  sc.start(now, r() * 2);
  sc.stop(now + dur + 0.4);
  // debris tinkle
  const bits = Math.floor(2 + 6 * s);
  for (let i = 0; i < bits; i++) {
    const tt = now + 0.08 + r() * (0.3 + 0.5 * s);
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: 1800 + r() * 2800 });
    const og = gainNode(ctx, 0);
    chain(o, og, out);
    og.gain.setValueAtTime(0, tt);
    og.gain.linearRampToValueAtTime(0.018 * s * (0.4 + r()), tt + 0.002);
    og.gain.setTargetAtTime(0, tt + 0.002, 0.012);
    o.start(tt);
    o.stop(tt + 0.1);
  }
}

/**
 * A car going up: a sharp crack, a deep chest-thump boom that rolls away (duller
 * with distance), then the roar and crackle of the fire. `near` 0..1 (1 = right
 * there, 0 = far away).
 */
export function explosionSound(ctx: BaseAudioContext, b: AudioBuffers, out: AudioNode, near: number, now: number): void {
  const n = clamp(near, 0, 1);
  if (n < 0.02) return;
  const r = Math.random;
  const bus = gainNode(ctx, 0.75 * n);
  // distance takes the top end off
  const air = biquad(ctx, 'lowpass', 900 + 9000 * n * n, 0.6);
  chain(bus, air, out);
  // the crack (fuel cell rupturing)
  const ck = new AudioBufferSourceNode(ctx, { buffer: b.white });
  const ckHP = biquad(ctx, 'highpass', 700, 0.7);
  const ckG = gainNode(ctx, 0);
  chain(ck, ckHP, biquad(ctx, 'lowpass', 5000, 0.6), ckG, bus);
  ckG.gain.setValueAtTime(0, now);
  ckG.gain.linearRampToValueAtTime(0.5, now + 0.002);
  ckG.gain.setTargetAtTime(0, now + 0.004, 0.035);
  ck.start(now, r() * 2, 0.4);
  // the boom: a falling sine plus a big low noise swell
  const bo = new OscillatorNode(ctx, { type: 'sine', frequency: 70 });
  bo.frequency.setValueAtTime(78, now);
  bo.frequency.exponentialRampToValueAtTime(24, now + 0.9);
  const boG = gainNode(ctx, 0);
  const boSh = new WaveShaperNode(ctx, { curve: tanhCurve(1.8) });
  chain(bo, boSh, boG, bus);
  boG.gain.setValueAtTime(0, now);
  boG.gain.linearRampToValueAtTime(1.1, now + 0.012);
  boG.gain.setTargetAtTime(0, now + 0.05, 0.35);
  bo.start(now);
  bo.stop(now + 2.5);
  const rum = new AudioBufferSourceNode(ctx, { buffer: b.white });
  const rumLP = biquad(ctx, 'lowpass', 420, 0.8);
  rumLP.frequency.setValueAtTime(1600, now);
  rumLP.frequency.exponentialRampToValueAtTime(140, now + 1.8);
  const rumG = gainNode(ctx, 0);
  chain(rum, rumLP, rumG, bus);
  rumG.gain.setValueAtTime(0, now);
  rumG.gain.linearRampToValueAtTime(0.95, now + 0.02);
  rumG.gain.setTargetAtTime(0, now + 0.15, 0.6);
  rum.start(now, r() * 2, 4);
  // the fire: a breathy roar with crackle, dying down over a few seconds
  const fr = new AudioBufferSourceNode(ctx, { buffer: b.white, loop: true });
  const frBP = biquad(ctx, 'bandpass', 520, 0.5);
  const frG = gainNode(ctx, 0);
  chain(fr, frBP, frG, bus);
  frG.gain.setValueAtTime(0, now);
  frG.gain.linearRampToValueAtTime(0.28, now + 0.4);
  frG.gain.setTargetAtTime(0.1, now + 1, 1.5);
  frG.gain.setTargetAtTime(0, now + 5, 1.2);
  fr.start(now, r() * 2);
  fr.stop(now + 10);
  const cr = new AudioBufferSourceNode(ctx, { buffer: b.crackle, loop: true, playbackRate: 0.6 + 0.3 * r() });
  const crBP = biquad(ctx, 'bandpass', 1800, 0.7);
  const crG = gainNode(ctx, 0);
  chain(cr, crBP, crG, bus);
  crG.gain.setValueAtTime(0, now);
  crG.gain.linearRampToValueAtTime(0.45, now + 0.3);
  crG.gain.setTargetAtTime(0, now + 3, 1.5);
  cr.start(now);
  cr.stop(now + 10);
  // debris raining down
  for (let i = 0; i < 14; i++) {
    const tt = now + 0.4 + r() * 1.6;
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: 900 + r() * 2600 });
    const og = gainNode(ctx, 0);
    chain(o, og, bus);
    og.gain.setValueAtTime(0, tt);
    og.gain.linearRampToValueAtTime(0.03 * (0.4 + r()), tt + 0.002);
    og.gain.setTargetAtTime(0, tt + 0.003, 0.02);
    o.start(tt);
    o.stop(tt + 0.15);
  }
}

/**
 * Start-light beep. final = lights out: a brighter two-note chime, a touch longer.
 * Soft sines (no square-wave edge), smooth attack and release.
 */
export function beepSound(ctx: BaseAudioContext, out: AudioNode, final: boolean, now: number): void {
  const freqs = final ? [1174.7, 1760] : [880];
  const dur = final ? 0.42 : 0.15;
  const g = gainNode(ctx, 0);
  const lp = biquad(ctx, 'lowpass', 3800, 0.6);
  chain(lp, g, out);
  for (const f of freqs) {
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: f });
    o.connect(lp);
    // a little 2nd harmonic for presence instead of a buzzy square
    const h = new OscillatorNode(ctx, { type: 'sine', frequency: f * 2 });
    h.connect(gainNode(ctx, 0.12)).connect(lp);
    for (const x of [o, h]) {
      x.start(now);
      x.stop(now + dur + 0.6);
    }
  }
  const lvl = final ? 0.06 : 0.055;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(lvl, now + 0.008);
  g.gain.setValueAtTime(lvl, now + dur - 0.03);
  g.gain.setTargetAtTime(0, now + dur - 0.03, final ? 0.1 : 0.022);
}

let lastUi = -1;

/**
 * Menu sounds: quiet, rounded, a little different every time (they're heard hundreds of times).
 * No noise clicks, no hard attacks.
 */
export function uiSound(ctx: BaseAudioContext, _b: AudioBuffers, out: AudioNode, kind: 'move' | 'select' | 'back', now: number): void {
  // key-repeat scrolling: thin the ticks out instead of machine-gunning
  if (kind === 'move' && now - lastUi < 0.045) return;
  lastUi = now;
  const r = Math.random;
  const tone = (f0: number, f1: number, t0: number, len: number, lvl: number, harm = 0.15) => {
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: f0 });
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + len);
    const h = new OscillatorNode(ctx, { type: 'sine', frequency: f0 * 2 });
    h.frequency.setValueAtTime(f0 * 2, t0);
    h.frequency.exponentialRampToValueAtTime(f1 * 2, t0 + len);
    const g = gainNode(ctx, 0);
    o.connect(g);
    h.connect(gainNode(ctx, harm)).connect(g);
    g.connect(out);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(lvl, t0 + 0.004);
    g.gain.setTargetAtTime(0, t0 + 0.006, len / 3);
    for (const x of [o, h]) {
      x.start(t0);
      x.stop(t0 + len * 2.5 + 0.08);
    }
  };
  const k = 1 + (r() - 0.5) * 0.05; // ±2.5 % pitch
  if (kind === 'move') {
    tone(1250 * k, 1150 * k, now, 0.028, 0.018, 0.08);
  } else if (kind === 'select') {
    tone(784 * k, 790 * k, now, 0.06, 0.026);
    tone(1175 * k, 1180 * k, now + 0.06 + r() * 0.008, 0.1, 0.022);
  } else {
    tone(988 * k, 960 * k, now, 0.05, 0.022);
    tone(740 * k, 720 * k, now + 0.055, 0.09, 0.02);
  }
}

/**
 * Team radio opening: a short band-limited squelch and a soft "bip" — the cue that a message
 * came in, heard over the car without cutting through it.
 */
export function radioSound(ctx: BaseAudioContext, b: AudioBuffers, out: AudioNode, now: number): void {
  const r = Math.random;
  const n = new AudioBufferSourceNode(ctx, { buffer: b.white });
  const bp = biquad(ctx, 'bandpass', 1500 + 300 * r(), 0.9);
  const hp = biquad(ctx, 'highpass', 450, 0.7);
  const g = gainNode(ctx, 0);
  chain(n, hp, bp, g, out);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.022, now + 0.004);
  g.gain.setValueAtTime(0.022, now + 0.05);
  g.gain.setTargetAtTime(0, now + 0.05, 0.01);
  n.start(now, r() * 2, 0.2);
  const t1 = now + 0.07;
  const o = new OscillatorNode(ctx, { type: 'sine', frequency: 1320 });
  const og = gainNode(ctx, 0);
  chain(o, biquad(ctx, 'lowpass', 3000, 0.6), og, out);
  og.gain.setValueAtTime(0, t1);
  og.gain.linearRampToValueAtTime(0.02, t1 + 0.005);
  og.gain.setValueAtTime(0.02, t1 + 0.06);
  og.gain.setTargetAtTime(0, t1 + 0.06, 0.012);
  o.start(t1);
  o.stop(t1 + 0.2);
}

/**
 * Weather: rain hiss and droplet patter (world bus — muffled in the cockpit
 * like everything outside), wind that gusts with the weather, rain drumming on
 * the bodywork and tyre spray near the car, and thunder: a crackle train for a
 * close strike, then a rumble that rolls and deepens as it comes off the clouds.
 */
export class WeatherSound {
  /** world sounds: rain bed, wind, thunder */
  readonly out: GainNode;
  /** close to the player: spray off the tyres, rain on the car */
  readonly near: GainNode;
  private ctx: BaseAudioContext;
  private b: AudioBuffers;
  private bedG: GainNode;
  private patterG: GainNode;
  private sprayG: GainNode;
  private sprayBP: BiquadFilterNode;
  private windG: GainNode;
  private windBP: BiquadFilterNode;
  private whistleG: GainNode;
  private whistleBP: BiquadFilterNode;
  private drumG: GainNode;
  private lastFlash = 0;

  constructor(ctx: BaseAudioContext, b: AudioBuffers) {
    this.ctx = ctx;
    this.b = b;
    this.out = gainNode(ctx, 1);
    this.near = gainNode(ctx, 1);
    this.bedG = gainNode(ctx, 0);
    chain(loopSource(ctx, b.white), biquad(ctx, 'highpass', 900, 0.5), biquad(ctx, 'lowpass', 7000, 0.5), this.bedG, this.out);
    this.patterG = gainNode(ctx, 0);
    chain(loopSource(ctx, b.crackle, 1.7), biquad(ctx, 'highpass', 1800, 0.7), this.patterG, this.out);
    this.sprayG = gainNode(ctx, 0);
    this.sprayBP = biquad(ctx, 'bandpass', 700, 0.6);
    chain(loopSource(ctx, b.pink), this.sprayBP, this.sprayG, this.near);
    // wind: a broad low roar plus a thin whistle that rises with the gusts
    this.windG = gainNode(ctx, 0);
    this.windBP = biquad(ctx, 'bandpass', 380, 0.7);
    chain(loopSource(ctx, b.pink, 0.8), this.windBP, biquad(ctx, 'lowpass', 1400, 0.5), this.windG, this.out);
    this.whistleG = gainNode(ctx, 0);
    this.whistleBP = biquad(ctx, 'bandpass', 1100, 9);
    chain(loopSource(ctx, b.white, 0.9), this.whistleBP, this.whistleG, this.out);
    // heavy drops drumming on the bodywork and the halo
    this.drumG = gainNode(ctx, 0);
    chain(loopSource(ctx, b.crackle, 0.75), biquad(ctx, 'bandpass', 900, 0.9), this.drumG, this.near);
  }

  /** rain rate, water on track 0..1, player speed m/s, lightning flash 0..1, wind m/s */
  set(rain: number, wet: number, speed: number, flash: number, wind: number, now: number): void {
    const r = clamp(rain, 0, 1);
    setT(this.bedG.gain, 0.2 * Math.pow(r, 0.8), now, 0.6);
    setT(this.patterG.gain, 0.1 * r, now, 0.6);
    setT(this.drumG.gain, 0.16 * r * r * (1 - clamp(speed / 70, 0, 0.7)), now, 0.5);
    const spray = clamp(wet, 0, 1) * clamp(speed / 60, 0, 1);
    setT(this.sprayG.gain, 0.3 * spray, now, 0.08);
    setT(this.sprayBP.frequency, 450 + speed * 11, now, 0.1);

    // gusts: a slow wander of a few incommensurate sines
    const g = 0.5 + 0.5 * Math.sin(now * 0.37) * Math.sin(now * 0.113 + 1.3) + 0.25 * Math.sin(now * 1.07 + 0.4);
    const w = clamp((wind - 1.5) / 11, 0, 1) + r * 0.25;
    setT(this.windG.gain, 0.14 * w * (0.45 + 0.55 * clamp(g, 0, 1)), now, 0.35);
    setT(this.windBP.frequency, 260 + 320 * clamp(g, 0, 1), now, 0.4);
    setT(this.whistleG.gain, 0.025 * w * w * clamp(g - 0.35, 0, 1), now, 0.3);
    setT(this.whistleBP.frequency, 800 + 900 * clamp(g, 0, 1), now, 0.3);

    if (flash > 0.9 && this.lastFlash < 0.5) {
      const close = Math.random() < 0.45;
      this.thunder(now + (close ? 0.12 + Math.random() * 0.5 : 1.2 + Math.random() * 3), close);
    }
    this.lastFlash = flash;
  }

  private thunder(at: number, close: boolean): void {
    const ctx = this.ctx;
    const len = (close ? 6 : 5) + Math.random() * 4;
    // the rumble: two layers of slowed noise, the low-pass closing as it rolls away
    for (const [rate, lvl] of [
      [0.32, close ? 0.8 : 0.55],
      [0.6, close ? 0.35 : 0.2],
    ] as const) {
      const src = new AudioBufferSourceNode(ctx, { buffer: this.b.pink, loop: true, playbackRate: rate });
      const lp = biquad(ctx, 'lowpass', close ? 1100 : 420, 0.8);
      const g = gainNode(ctx, 0);
      chain(src, lp, g, this.out);
      lp.frequency.setValueAtTime(close ? 1100 : 420, at);
      lp.frequency.setTargetAtTime(close ? 180 : 130, at + 0.2, len / 5);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(lvl, at + (close ? 0.08 : 0.5));
      // rolls: the sound arriving off different parts of the cloud
      let t = at + 0.4;
      const rolls = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < rolls; i++) {
        t += 0.35 + Math.random() * 0.9;
        const k = 1 - i / (rolls + 1);
        g.gain.setTargetAtTime(lvl * (0.35 + 0.3 * Math.random()) * k, t - 0.3, 0.12);
        g.gain.setTargetAtTime(lvl * (0.7 + 0.3 * Math.random()) * k, t, 0.15);
      }
      g.gain.setTargetAtTime(0, t + 0.3, len / 4);
      src.start(at, Math.random() * 3);
      src.stop(at + len + 3);
    }
    if (close) {
      // the crack: a quick train of bright bursts as the channel tears open
      const bursts = 3 + Math.floor(Math.random() * 4);
      let t = at;
      for (let i = 0; i < bursts; i++) {
        const cr = new AudioBufferSourceNode(ctx, { buffer: this.b.white });
        const hp = biquad(ctx, 'highpass', 900 + Math.random() * 1500, 0.6);
        const cg = gainNode(ctx, 0);
        chain(cr, hp, cg, this.out);
        const lvl = (0.5 - i * 0.06) * (0.7 + Math.random() * 0.3);
        cg.gain.setValueAtTime(lvl, t);
        cg.gain.setTargetAtTime(0, t + 0.01, 0.04 + Math.random() * 0.06);
        cr.start(t, Math.random() * 2);
        cr.stop(t + 0.6);
        t += 0.03 + Math.random() * 0.09;
      }
      // and the low thump that follows it
      const th = new OscillatorNode(ctx, { type: 'sine', frequency: 55 });
      const tg = gainNode(ctx, 0);
      chain(th, tg, this.out);
      th.frequency.setValueAtTime(70, at);
      th.frequency.exponentialRampToValueAtTime(32, at + 0.6);
      tg.gain.setValueAtTime(0.35, at);
      tg.gain.setTargetAtTime(0, at + 0.05, 0.25);
      th.start(at);
      th.stop(at + 1.6);
    }
  }
}
