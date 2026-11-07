import type { Sound } from './audio.ts';

/**
 * A two-stroke, synthesised: it fires once a revolution, so its note is the revs over sixty. Saws at
 * the firing rate and its octave through a filter that opens with the throttle, a rasp of noise
 * gated by the same, and a low throb. The nearest karts get a voice each, panned and quieter, with
 * their own revs. Under that: tyres squealing by how far past the peak they are, and the rumble of
 * whatever you've run onto.
 */

interface Engine {
  a: OscillatorNode;
  b: OscillatorNode;
  c: OscillatorNode;
  f: BiquadFilterNode;
  g: GainNode;
  p: StereoPannerNode;
}

export class KartAudio {
  private voices: Engine[] = [];
  private squeal: { g: GainNode; f: BiquadFilterNode; o: OscillatorNode } | null = null;
  private rumble: { g: GainNode; f: BiquadFilterNode } | null = null;
  private crashB: AudioBuffer | null = null;
  private out: GainNode | null = null;
  private srcs: AudioScheduledSourceNode[] = [];
  constructor(private sound: Sound) {}

  private up() {
    const ctx = this.sound.ctx;
    if (!ctx || this.out) return ctx;
    const out = (this.out = ctx.createGain());
    out.gain.value = 1;
    out.connect(this.sound.bus);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (let k = 0; k < 4; k++) {
      const a = ctx.createOscillator(), b = ctx.createOscillator(), c = ctx.createOscillator();
      a.type = 'sawtooth';
      b.type = 'sawtooth';
      c.type = 'square';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 2.2;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      const ga = ctx.createGain(), gb = ctx.createGain(), gc = ctx.createGain();
      ga.gain.value = 0.42;
      gb.gain.value = 0.3;
      gc.gain.value = 0.2;
      a.connect(ga).connect(f);
      b.connect(gb).connect(f);
      c.connect(gc).connect(f);
      f.connect(g).connect(p).connect(out);
      a.start();
      b.start();
      c.start();
      this.srcs.push(a, b, c);
      this.voices.push({ a, b, c, f, g, p });
    }
    // the squeal: a resonant band of noise, and a thin tone wavering inside it
    {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 9;
      f.frequency.value = 1100;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const og = ctx.createGain();
      og.gain.value = 0.12;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g);
      o.connect(og).connect(g);
      g.connect(out);
      src.start();
      o.start();
      this.srcs.push(src, o);
      this.squeal = { g, f, o };
    }
    {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 300;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(out);
      src.start();
      this.srcs.push(src);
      this.rumble = { g, f };
    }
    const crash = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const e = crash.getChannelData(0);
    for (let i = 0; i < e.length; i++) {
      const t = i / e.length;
      e[i] = (Math.random() * 2 - 1) * Math.exp(-t * 9) + Math.sin(i * 0.02 * (1 - t * 0.6)) * Math.exp(-t * 7) * 0.7;
    }
    this.crashB = crash;
    return ctx;
  }

  /** one of the four engine voices: rpm, how open the throttle is, how loud (0..1), left-right */
  engine(k: number, rpm: number, thr: number, vol: number, pan: number) {
    const ctx = this.up();
    if (!ctx || !this.voices[k]) return;
    const v = this.voices[k], t = ctx.currentTime, hz = rpm / 60;
    v.a.frequency.setTargetAtTime(hz, t, 0.012);
    v.b.frequency.setTargetAtTime(hz * 2.003, t, 0.012);
    v.c.frequency.setTargetAtTime(hz * 0.5, t, 0.012);
    v.f.frequency.setTargetAtTime(500 + rpm * 0.14 + thr * 1900, t, 0.03);
    v.g.gain.setTargetAtTime(this.sound.sfxOn ? vol * (0.1 + thr * 0.09) : 0, t, 0.03);
    v.p.pan.setTargetAtTime(pan, t, 0.05);
  }
  /** the tyres (0..1, how much they're sliding) and the ground (0..1, how rough) under your own kart */
  tyres(slide: number, rough: number, speed: number) {
    const ctx = this.up();
    if (!ctx || !this.squeal || !this.rumble) return;
    const t = ctx.currentTime, on = this.sound.sfxOn ? 1 : 0;
    this.squeal.g.gain.setTargetAtTime(on * Math.min(1, slide) ** 1.4 * 0.2, t, 0.03);
    const hz = 860 + slide * 340 + Math.sin(t * 19) * 26;
    this.squeal.f.frequency.setTargetAtTime(hz, t, 0.02);
    this.squeal.o.frequency.setTargetAtTime(hz * 0.998, t, 0.02);
    this.rumble.g.gain.setTargetAtTime(on * rough * Math.min(1, speed / 18) * 0.34, t, 0.05);
    this.rumble.f.frequency.setTargetAtTime(160 + speed * 16, t, 0.05);
  }
  /** a bang: how hard, how near */
  crash(power: number, vol: number, pan: number) {
    const ctx = this.up();
    if (!ctx || !this.crashB || !this.out || !this.sound.sfxOn) return;
    const s = ctx.createBufferSource();
    s.buffer = this.crashB;
    s.playbackRate.value = 0.75 + Math.random() * 0.5;
    const g = ctx.createGain();
    g.gain.value = Math.min(0.55, 0.1 + power * 0.03) * vol;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    s.connect(g).connect(p).connect(this.out);
    s.start();
  }
  /** a pop out of the exhaust: a gear, a lift */
  pop(vol: number) {
    const ctx = this.up();
    if (!ctx || !this.crashB || !this.out || !this.sound.sfxOn) return;
    const s = ctx.createBufferSource();
    s.buffer = this.crashB;
    s.playbackRate.value = 2.6 + Math.random();
    const g = ctx.createGain();
    g.gain.value = 0.05 * vol;
    s.connect(g).connect(this.out);
    s.start();
    s.stop(ctx.currentTime + 0.06);
  }
  dispose() {
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        /* (never started) */
      }
    }
    this.out?.disconnect();
    this.out = null;
    this.voices = [];
    this.srcs = [];
  }
}
