/**
 * Spatial ambience around the player: the rest of the field heard from afar, wind in the
 * trackside trees, and early reflections off nearby walls / the pit building.
 */
import { createEngineSource, type EngineSource } from './engine.ts';
import { type AudioBuffers, biquad, chain, clamp, gainNode, loopSource, setT } from './dsp.ts';

/** A far car (or a cluster of them) as the distant field sees it. */
export interface FarCar {
  rpm: number;
  throttle: number;
  distance: number;
  pan: number;
}

/**
 * The rest of the field, beyond the close opponent voices: two cheap engine voices (left and
 * right of the listener) that follow the loudness-weighted mix of the far cars — heavily
 * low-passed by distance and washed in reverb, the drone you hear from across the circuit.
 */
export class DistantField {
  readonly out: GainNode;
  /** reverb send (distance = mostly reflected sound) */
  readonly wet: GainNode;
  private sides: { src: EngineSource; lp: BiquadFilterNode; g: GainNode; pan: StereoPannerNode; quietFor: number; on: boolean }[] = [];

  constructor(ctx: BaseAudioContext, worklet: boolean, b: AudioBuffers) {
    this.out = gainNode(ctx, 1);
    this.wet = gainNode(ctx, 1);
    for (let i = 0; i < 2; i++) {
      const src = createEngineSource(ctx, worklet, true, 0x51ed27 + i * 104729, 0.3 + 0.4 * i, b);
      const lp = biquad(ctx, 'lowpass', 900, 0.5);
      const g = gainNode(ctx, 0);
      const pan = new StereoPannerNode(ctx, { pan: i ? 0.55 : -0.55 });
      chain(src.out, lp, g, pan);
      pan.connect(this.out);
      pan.connect(this.wet);
      src.p.active.value = 0;
      this.sides.push({ src, lp, g, pan, quietFor: 0, on: false });
    }
  }

  set(far: FarCar[], dt: number, now: number): void {
    for (let side = 0; side < 2; side++) {
      const s = this.sides[side];
      let e = 0, rpmW = 0, thrW = 0, dW = 0, panW = 0;
      for (const c of far) {
        if ((c.pan >= 0 ? 1 : 0) !== side) continue;
        const a = clamp(4.5 / (4 + c.distance), 0, 0.5);
        const w = a * a;
        e += w;
        rpmW += w * c.rpm;
        thrW += w * c.throttle;
        dW += w * c.distance;
        panW += w * c.pan;
      }
      const lvl = Math.sqrt(e);
      if (lvl > 0.002) {
        s.quietFor = 0;
        if (!s.on) {
          s.on = true;
          s.src.p.active.setValueAtTime(1, now);
        }
        const d = dW / e;
        setT(s.src.p.rpm, clamp(rpmW / e, 3000, 14000), now, 0.25, 2e-3);
        setT(s.src.p.load, clamp(thrW / e, 0, 1), now, 0.3);
        setT(s.g.gain, Math.min(0.14, lvl * 0.9), now, 0.35);
        setT(s.lp.frequency, 350 + 2600 * Math.exp(-d / 180), now, 0.4);
        setT(s.pan.pan, clamp(panW / e, -0.9, 0.9), now, 0.4);
      } else {
        setT(s.g.gain, 0, now, 0.3);
        s.quietFor += dt;
        // silent for a while: park the voice (saves the worklet's CPU)
        if (s.on && s.quietFor > 2.5) {
          s.on = false;
          s.src.p.active.setValueAtTime(0, now);
        }
      }
    }
  }
}

/**
 * Wind moving through the trees and grandstand flags around the circuit: a soft, gusting
 * leaf rustle and a low swell of air. Always a little there, more with the weather's wind.
 */
export class TreeWind {
  readonly out: GainNode;
  private rustleG: GainNode;
  private rustleBP: BiquadFilterNode;
  private airG: GainNode;
  private airBP: BiquadFilterNode;
  private level = 0;

  constructor(ctx: BaseAudioContext, b: AudioBuffers) {
    this.out = gainNode(ctx, 1);
    // rustle: fine grains (the crunch buffer played fast and filtered is leafy) + airy noise
    this.rustleBP = biquad(ctx, 'bandpass', 2600, 0.55);
    const am = gainNode(ctx, 0.6);
    loopSource(ctx, b.wander, 0.35).connect(gainNode(ctx, 0.4)).connect(am.gain);
    this.rustleG = gainNode(ctx, 0);
    const leaves = loopSource(ctx, b.crunch, 2.3);
    const leavesG = gainNode(ctx, 0.25);
    chain(leaves, biquad(ctx, 'highpass', 2500, 0.6), leavesG, this.rustleBP);
    chain(loopSource(ctx, b.pink, 1), this.rustleBP, am, biquad(ctx, 'lowpass', 6000, 0.5), this.rustleG, this.out);
    // air: a low, slow swell
    this.airBP = biquad(ctx, 'bandpass', 420, 0.6);
    this.airG = gainNode(ctx, 0);
    chain(loopSource(ctx, b.pink, 0.6), this.airBP, this.airG, this.out);
  }

  /** amb 0..1 (how much of the outdoors we hear), wind m/s */
  set(amb: number, wind: number, now: number): void {
    this.level = clamp(amb, 0, 1);
    const w = clamp(0.25 + wind / 10, 0, 1.4);
    // gusts: a few incommensurate slow sines
    const g = clamp(0.55 + 0.35 * Math.sin(now * 0.21) * Math.sin(now * 0.077 + 2.1) + 0.2 * Math.sin(now * 0.53 + 0.7), 0, 1);
    setT(this.rustleG.gain, 0.045 * this.level * w * (0.35 + 0.65 * g), now, 0.6);
    setT(this.rustleBP.frequency, 2000 + 1400 * g, now, 0.8);
    setT(this.airG.gain, 0.06 * this.level * w * (0.3 + 0.7 * g), now, 0.8);
    setT(this.airBP.frequency, 300 + 260 * g, now, 0.8);
  }
}

/**
 * Early reflections from the barriers either side (and the pit wall / garages in the pit lane):
 * a short, dark slap-back per side whose delay follows the distance to that wall.
 */
export class WallReflections {
  readonly input: GainNode;
  readonly out: GainNode;
  private sides: { d: DelayNode; g: GainNode }[] = [];

  constructor(ctx: BaseAudioContext) {
    this.input = gainNode(ctx, 1);
    this.out = gainNode(ctx, 1);
    const shaped = biquad(ctx, 'lowpass', 3200, 0.6);
    chain(this.input, biquad(ctx, 'highpass', 180, 0.6), shaped);
    for (const p of [-0.75, 0.75]) {
      const d = new DelayNode(ctx, { maxDelayTime: 0.2, delayTime: 0.06 });
      const g = gainNode(ctx, 0);
      chain(shaped, d, g, new StereoPannerNode(ctx, { pan: p }), this.out);
      this.sides.push({ d, g });
    }
  }

  /** distances (m) to the left and right walls; `pit` = in the pit lane (garages close by) */
  set(left: number, right: number, pit: boolean, now: number): void {
    [left, right].forEach((dist, i) => {
      const s = this.sides[i];
      const d = clamp(Number.isFinite(dist) ? dist : 60, 1, 60);
      setT(s.d.delayTime, clamp((2 * d) / 343, 0.004, 0.18), now, 0.12, 5e-3);
      const near = clamp(4 / (d + 2), 0, 1);
      setT(s.g.gain, (pit ? 0.3 : 0.22) * near * near + (pit ? 0.05 : 0), now, 0.15);
    });
  }
}
