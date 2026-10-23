/**
 * Every sound is synthesised: engines (two detuned oscillators through a growling filter, pitch from
 * road speed with gear steps), the boost roar (band-passed noise), the supersonic whine, ball hits
 * and bounces (a pitched thump with a click), pad pickups, jumps and flips, demolitions, the goal
 * (an explosion, the horn, the crowd's roar) and a crowd bed that swells when the ball nears a goal.
 * Panned and attenuated from the camera.
 */

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private engines: { osc1: OscillatorNode; osc2: OscillatorNode; filt: BiquadFilterNode; gain: GainNode; boost: GainNode; boostF: BiquadFilterNode; whine: OscillatorNode; whineG: GainNode; pan: StereoPannerNode }[] = [];
  private crowd!: { gain: GainNode; filt: BiquadFilterNode };
  volume = 0.8;

  /** browsers only allow sound after a gesture */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      // pinkish
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    // the crowd bed
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 700;
    filt.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(filt).connect(gain).connect(this.master);
    src.start();
    this.crowd = { gain, filt };
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  private ensureEngines(n: number): void {
    const ctx = this.ctx!;
    while (this.engines.length < n) {
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 4;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      const g2 = ctx.createGain();
      g2.gain.value = 0.5;
      osc1.connect(filt);
      osc2.connect(g2).connect(filt);
      filt.connect(gain).connect(pan).connect(this.sfx);
      const bs = ctx.createBufferSource();
      bs.buffer = this.noise;
      bs.loop = true;
      bs.playbackRate.value = 0.8 + Math.random() * 0.2;
      const boostF = ctx.createBiquadFilter();
      boostF.type = 'bandpass';
      boostF.frequency.value = 900;
      boostF.Q.value = 0.8;
      const boost = ctx.createGain();
      boost.gain.value = 0;
      bs.connect(boostF).connect(boost).connect(pan);
      const whine = ctx.createOscillator();
      whine.type = 'sine';
      whine.frequency.value = 2400;
      const whineG = ctx.createGain();
      whineG.gain.value = 0;
      whine.connect(whineG).connect(pan);
      osc1.start();
      osc2.start();
      bs.start();
      whine.start();
      this.engines.push({ osc1, osc2, filt, gain, boost, boostF, whine, whineG, pan });
    }
  }

  /** per frame: each car's engine (speed uu/s, throttle, boosting, distance m, pan −1..1) */
  engine(i: number, speed: number, throttle: number, boosting: boolean, supersonic: boolean, dist: number, pan: number, alive: boolean, local: boolean): void {
    if (!this.ctx) return;
    this.ensureEngines(i + 1);
    const e = this.engines[i];
    const t = this.ctx.currentTime;
    // gear steps
    const s = Math.abs(speed);
    const gears = [0, 500, 1000, 1500, 2300];
    let g = 0;
    while (g < gears.length - 2 && s > gears[g + 1]) g++;
    const inG = (s - gears[g]) / (gears[g + 1] - gears[g]);
    const rpm = 0.35 + 0.65 * Math.min(1, inG) + g * 0.06;
    const f = 42 + rpm * 70;
    const att = alive ? Math.min(1, 12 / Math.max(6, dist)) : 0;
    const vol = (0.05 + 0.06 * Math.abs(throttle) + (boosting ? 0.03 : 0)) * att * (local ? 1 : 0.6);
    e.osc1.frequency.setTargetAtTime(f, t, 0.05);
    e.osc2.frequency.setTargetAtTime(f * 0.501, t, 0.05);
    e.filt.frequency.setTargetAtTime(300 + rpm * 900 + Math.abs(throttle) * 500, t, 0.05);
    e.gain.gain.setTargetAtTime(vol, t, 0.06);
    e.boost.gain.setTargetAtTime(boosting ? 0.32 * att : 0, t, boosting ? 0.03 : 0.12);
    e.boostF.frequency.setTargetAtTime(700 + s * 0.3, t, 0.1);
    e.whineG.gain.setTargetAtTime(supersonic ? 0.025 * att : 0, t, 0.1);
    e.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.05);
  }

  crowdLevel(excite: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.crowd.gain.gain.setTargetAtTime(0.04 + excite * 0.22, t, 0.3);
    this.crowd.filt.frequency.setTargetAtTime(600 + excite * 600, t, 0.3);
  }

  private env(node: AudioNode, gain: number, a: number, d: number, pan = 0): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(g).connect(p).connect(this.sfx);
    return g;
  }

  private noiseSrc(rate = 1): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rate;
    s.start(this.ctx!.currentTime, Math.random() * 1.5);
    return s;
  }

  hit(power: number, att: number, pan: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const k = Math.min(1, power / 3000);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(220 + k * 120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
    this.env(o, (0.25 + 0.55 * k) * att, 0.003, 0.25, pan);
    o.start();
    o.stop(t + 0.4);
    const n = this.noiseSrc(1.6);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1800;
    this.env(n.connect(f), (0.15 + 0.35 * k) * att, 0.001, 0.06 + k * 0.08, pan);
    n.stop(t + 0.3);
  }

  bounce(speed: number, att: number, pan: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    this.env(o, Math.min(0.35, speed / 4000) * att, 0.002, 0.2, pan);
    o.start();
    o.stop(t + 0.3);
  }

  whoosh(att: number, pan: number, high = false): void {
    if (!this.ctx) return;
    const n = this.noiseSrc(high ? 1.5 : 1);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    const t = this.ctx.currentTime;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(high ? 2600 : 1600, t + 0.2);
    this.env(n.connect(f), 0.22 * att, 0.02, 0.25, pan);
    n.stop(t + 0.4);
  }

  pad(big: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = big ? [392, 587, 784] : [880, 1320];
    notes.forEach((fq, k) => {
      const o = this.ctx!.createOscillator();
      o.type = big ? 'triangle' : 'sine';
      o.frequency.value = fq;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0, t + k * 0.05);
      g.gain.linearRampToValueAtTime(big ? 0.12 : 0.06, t + k * 0.05 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.05 + (big ? 0.5 : 0.18));
      o.connect(g).connect(this.sfx);
      o.start(t + k * 0.05);
      o.stop(t + 0.8);
    });
  }

  explosion(att: number, pan: number, big: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.noiseSrc(0.6);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(big ? 3000 : 2000, t);
    f.frequency.exponentialRampToValueAtTime(120, t + (big ? 2.2 : 1));
    this.env(n.connect(f), (big ? 0.9 : 0.6) * att, 0.005, big ? 2.4 : 1.1, pan);
    n.stop(t + 3);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.8);
    this.env(o, 0.7 * att, 0.005, 0.9, pan);
    o.start();
    o.stop(t + 1.2);
  }

  goal(): void {
    if (!this.ctx) return;
    this.explosion(1, 0, true);
    const t = this.ctx.currentTime;
    // the horn: a brassy chord
    for (const fq of [174.6, 220, 261.6, 349.2]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fq;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + 0.15);
      g.gain.linearRampToValueAtTime(0.06, t + 0.25);
      g.gain.setValueAtTime(0.06, t + 1.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      o.connect(f).connect(g).connect(this.sfx);
      o.start(t + 0.15);
      o.stop(t + 2.5);
    }
    // the roar
    const n = this.noiseSrc(1);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
    n.connect(f).connect(g).connect(this.master);
    n.stop(t + 5.2);
  }

  beep(go: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = go ? 1046 : 523;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2500;
    this.env(o.connect(f), 0.12, 0.005, go ? 0.6 : 0.25);
    o.start();
    o.stop(t + 0.8);
  }

  ui(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(990, t + 0.05);
    this.env(o, 0.05, 0.002, 0.08);
    o.start();
    o.stop(t + 0.15);
  }
}
