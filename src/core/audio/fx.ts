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
    const sawG = gainNode(ctx, 0.35);
    chain(this.sqSaw, sawShape, sawG);
    this.sqSaw.start();

    this.sqBP1 = biquad(ctx, 'bandpass', 900, 6);
    this.sqBP2 = biquad(ctx, 'bandpass', 1900, 5);
    const nz = white();
    nz.connect(this.sqBP1);
    nz.connect(this.sqBP2);
    const wob = loopSource(ctx, b.wander, 1.7);
    const wobG1 = gainNode(ctx, 70);
    const wobG2 = gainNode(ctx, 140);
    wob.connect(wobG1).connect(this.sqBP1.frequency);
    wob.connect(wobG2).connect(this.sqBP2.frequency);
    const bp2g = gainNode(ctx, 0.55);
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
    const sqSat = new WaveShaperNode(ctx, { curve: tanhCurve(1.8) });
    this.sqG = gainNode(ctx, 0);
    chain(sqPre, sqAM, sqSat, this.sqG, this.out);

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
    const kerbRattleBP = biquad(ctx, 'bandpass', 900, 0.9);
    this.kerbG = gainNode(ctx, 0);
    chain(this.kerbOsc, kerbThumpLP, kerbBody, this.kerbG);
    this.kerbOsc.connect(kerbRect);
    kerbRect.connect(kerbRattle.gain);
    chain(white(), kerbRattleBP, kerbRattle);
    const kerbRattleG = gainNode(ctx, 0.5);
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
    const sq = smoothstep(0.55, 1.15, slip) * sp * (loose ? 0.12 : 1);
    setT(this.sqG.gain, 0.26 * sq * (1 + 0.35 * lock) * mix.tyres, now, 0.035);
    const f0 = (this.sqBase + 160 * clamp(slip - 0.6, 0, 1) + 240 * lock) * dop;
    setT(this.sqBP1.frequency, f0, now, 0.05);
    setT(this.sqBP2.frequency, f0 * 2.08, now, 0.05);
    setT(this.sqSaw.frequency, f0 * 0.98, now, 0.05);
    setT(this.sqChatter.frequency, 26 + 30 * clamp(slip, 0, 1.5) + 0.2 * v, now, 0.1);

    // kerb: ridge thumps at a rate ∝ speed
    const kerb = s.onKerb || surf === 1;
    setT(this.kerbOsc.frequency, clamp(v / 1.9, 3, 70), now, 0.03);
    setT(this.kerbG.gain, kerb ? 0.2 * smoothstep(1, 20, v) * mix.tyres : 0, now, 0.025);

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
  private cheerT = 2.5;
  private hornT = 1.2;
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
    chain(cs, cAM, this.cheerG, this.out);
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
      this.cheerT = 7 + this.r() * 14;
      this.cheer(now, 0.5 + 0.5 * this.r());
    }
    if (this.hornT <= 0) {
      this.hornT = 4 + this.r() * 9;
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
    const lp = biquad(ctx, 'lowpass', 2600, 0.7);
    const pk = biquad(ctx, 'peaking', 1200, 1.2, 5);
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
    const lvl = 0.05 * this.level * (0.5 + 0.5 * this.r());
    g.gain.setValueAtTime(0, now);
    g.gain.setTargetAtTime(lvl, now, 0.02);
    g.gain.setTargetAtTime(0, now + dur, 0.06);
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
  th.frequency.setValueAtTime(130, now);
  th.frequency.exponentialRampToValueAtTime(38, now + 0.25);
  const thG = gainNode(ctx, 0);
  chain(th, thG, out);
  thG.gain.setValueAtTime(0, now);
  thG.gain.linearRampToValueAtTime(0.9 * s, now + 0.004);
  thG.gain.setTargetAtTime(0, now + 0.01, 0.07 + 0.08 * s);
  th.start(now);
  th.stop(now + 0.8);
  // low noise burst
  const nb = new AudioBufferSourceNode(ctx, { buffer: b.white });
  const nbLP = biquad(ctx, 'lowpass', 900 + 1800 * s, 0.7);
  const nbG = gainNode(ctx, 0);
  chain(nb, nbLP, nbG, out);
  nbG.gain.setValueAtTime(0, now);
  nbG.gain.linearRampToValueAtTime(0.6 * s, now + 0.003);
  nbG.gain.setTargetAtTime(0, now + 0.006, 0.05);
  nb.start(now, r() * 2, 0.5);
  // carbon crunch (cracking shards)
  const cr = new AudioBufferSourceNode(ctx, { buffer: b.crackle, playbackRate: 0.75 + 0.5 * r() });
  const crBP = biquad(ctx, 'bandpass', 2600, 0.6);
  const crSh = new WaveShaperNode(ctx, { curve: tanhCurve(2.5) });
  const crG = gainNode(ctx, 0.55 * Math.sqrt(s));
  chain(cr, crBP, crSh, crG, out);
  cr.start(now + 0.002);
  // scrape: grinding carbon on concrete, pitch falling as the car slows
  const sc = new AudioBufferSourceNode(ctx, { buffer: b.white, loop: true });
  const scBP = biquad(ctx, 'bandpass', 3400, 3.5);
  const scBP2 = biquad(ctx, 'bandpass', 1500, 2);
  const scG = gainNode(ctx, 0);
  sc.connect(scBP).connect(scG);
  sc.connect(scBP2).connect(gainNode(ctx, 0.6)).connect(scG);
  scG.connect(out);
  const dur = 0.25 + 0.7 * s;
  scBP.frequency.setValueAtTime(3600, now);
  scBP.frequency.exponentialRampToValueAtTime(1500, now + dur);
  const lvl = 0.35 * s;
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
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: 2500 + r() * 4500 });
    const og = gainNode(ctx, 0);
    chain(o, og, out);
    og.gain.setValueAtTime(0, tt);
    og.gain.linearRampToValueAtTime(0.04 * s * (0.4 + r()), tt + 0.001);
    og.gain.setTargetAtTime(0, tt + 0.002, 0.012);
    o.start(tt);
    o.stop(tt + 0.1);
  }
}

/** Start-light beep. final = lights out: brighter two-tone and longer. */
export function beepSound(ctx: BaseAudioContext, out: AudioNode, final: boolean, now: number): void {
  const freqs = final ? [1318.5, 1975.5] : [987.8];
  const dur = final ? 0.55 : 0.17;
  const g = gainNode(ctx, 0);
  const lp = biquad(ctx, 'lowpass', 5000, 0.7);
  chain(lp, g, out);
  for (const f of freqs) {
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: f });
    o.connect(lp);
    const sq = new OscillatorNode(ctx, { type: 'square', frequency: f });
    const sqG = gainNode(ctx, 0.06);
    sq.connect(sqG).connect(lp);
    o.start(now);
    sq.start(now);
    o.stop(now + dur + 0.2);
    sq.stop(now + dur + 0.2);
  }
  const lvl = final ? 0.13 : 0.12;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(lvl, now + 0.006);
  g.gain.setValueAtTime(lvl, now + dur - 0.02);
  g.gain.setTargetAtTime(0, now + dur - 0.02, final ? 0.08 : 0.012);
}

/** Tasteful UI ticks/whooshes. */
export function uiSound(ctx: BaseAudioContext, b: AudioBuffers, out: AudioNode, kind: 'move' | 'select' | 'back', now: number): void {
  const tone = (f0: number, f1: number, t0: number, len: number, lvl: number) => {
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: f0 });
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + len);
    const g = gainNode(ctx, 0);
    chain(o, g, out);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(lvl, t0 + 0.003);
    g.gain.setTargetAtTime(0, t0 + 0.004, len / 3);
    o.start(t0);
    o.stop(t0 + len * 2.5 + 0.05);
  };
  const whoosh = (f0: number, f1: number, len: number, lvl: number) => {
    const n = new AudioBufferSourceNode(ctx, { buffer: b.white });
    const bp = biquad(ctx, 'bandpass', f0, 1.4);
    bp.frequency.setValueAtTime(f0, now);
    bp.frequency.exponentialRampToValueAtTime(f1, now + len);
    const g = gainNode(ctx, 0);
    chain(n, bp, g, out);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(lvl, now + len * 0.45);
    g.gain.linearRampToValueAtTime(0, now + len);
    n.start(now, Math.random() * 2, len + 0.02);
  };
  const click = (lvl: number) => {
    const n = new AudioBufferSourceNode(ctx, { buffer: b.white });
    const hp = biquad(ctx, 'highpass', 3500, 0.7);
    const g = gainNode(ctx, 0);
    chain(n, hp, g, out);
    g.gain.setValueAtTime(lvl, now);
    g.gain.setTargetAtTime(0, now + 0.001, 0.0025);
    n.start(now, Math.random() * 2, 0.03);
  };
  if (kind === 'move') {
    click(0.06);
    tone(2100, 1900, now, 0.03, 0.05);
  } else if (kind === 'select') {
    click(0.07);
    tone(880, 900, now, 0.05, 0.07);
    tone(1320, 1340, now + 0.055, 0.09, 0.07);
    whoosh(700, 3200, 0.16, 0.05);
  } else {
    click(0.05);
    tone(1150, 1050, now, 0.05, 0.06);
    tone(760, 700, now + 0.05, 0.08, 0.06);
    whoosh(2600, 600, 0.14, 0.04);
  }
}

/**
 * Weather: rain hiss and droplet patter (world bus — muffled in the cockpit
 * like everything outside), tyre spray hiss near the car, and thunder rolling
 * in a moment after each lightning flash.
 */
export class WeatherSound {
  /** world sounds: rain bed + thunder */
  readonly out: GainNode;
  /** close to the player: spray off the tyres */
  readonly near: GainNode;
  private ctx: BaseAudioContext;
  private b: AudioBuffers;
  private bedG: GainNode;
  private patterG: GainNode;
  private sprayG: GainNode;
  private sprayBP: BiquadFilterNode;
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
  }

  /** rain rate, water on track 0..1, player speed m/s, lightning flash 0..1 */
  set(rain: number, wet: number, speed: number, flash: number, now: number): void {
    setT(this.bedG.gain, 0.2 * Math.pow(clamp(rain, 0, 1), 0.8), now, 0.6);
    setT(this.patterG.gain, 0.1 * clamp(rain, 0, 1), now, 0.6);
    const spray = clamp(wet, 0, 1) * clamp(speed / 60, 0, 1);
    setT(this.sprayG.gain, 0.3 * spray, now, 0.08);
    setT(this.sprayBP.frequency, 450 + speed * 11, now, 0.1);
    if (flash > 0.9 && this.lastFlash < 0.5) this.thunder(now + 0.5 + Math.random() * 2.5);
    this.lastFlash = flash;
  }

  private thunder(at: number): void {
    const ctx = this.ctx;
    const close = at - ctx.currentTime < 1.2;
    const len = 5 + Math.random() * 3;
    const src = new AudioBufferSourceNode(ctx, { buffer: this.b.pink, loop: true, playbackRate: 0.55 });
    const lp = biquad(ctx, 'lowpass', close ? 320 : 170, 0.7);
    const g = gainNode(ctx, 0);
    chain(src, lp, g, this.out);
    const peak = close ? 1.1 : 0.7;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.25);
    // a few rolls as the sound comes off the clouds
    g.gain.setTargetAtTime(peak * 0.45, at + 0.3, 0.5);
    g.gain.setTargetAtTime(peak * 0.7, at + 1.4, 0.3);
    g.gain.setTargetAtTime(0, at + 1.9, len / 4);
    src.start(at, Math.random() * 3);
    src.stop(at + len + 1);
    if (close) {
      const cr = new AudioBufferSourceNode(ctx, { buffer: this.b.white });
      const hp = biquad(ctx, 'highpass', 1800, 0.6);
      const cg = gainNode(ctx, 0);
      chain(cr, hp, cg, this.out);
      cg.gain.setValueAtTime(0.5, at);
      cg.gain.setTargetAtTime(0, at + 0.02, 0.09);
      cr.start(at);
      cr.stop(at + 0.8);
    }
  }
}
