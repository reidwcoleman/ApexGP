/**
 * The sound of the place, synthesised (no files): surf (filtered noise breathing with the swash,
 * louder toward the water), a far city hum and a sea breeze in the palms, and an engine when you
 * drive (two detuned saws through a low-pass, pitch from speed). Starts on the first click/key.
 */
export class Ambience {
  private ctx: AudioContext | null = null;
  private surf!: GainNode;
  private surfF!: BiquadFilterNode;
  private hum!: GainNode;
  private breeze!: GainNode;
  private eng!: GainNode;
  private engO: OscillatorNode[] = [];
  private engF!: BiquadFilterNode;
  private rain!: GainNode;
  private master!: GainNode;

  constructor() {
    const start = () => {
      if (this.ctx) return;
      this.init();
      removeEventListener('pointerdown', start);
      removeEventListener('keydown', start);
    };
    addEventListener('pointerdown', start);
    addEventListener('keydown', start);
  }

  private noise(ctx: AudioContext, white = false): AudioBufferSourceNode {
    const len = ctx.sampleRate * 4;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        // brownish noise
        if (white) d[i] = (Math.random() * 2 - 1) * 0.5;
        else {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          d[i] = last * 3.5;
        }
      }
    }
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    return s;
  }

  private init() {
    const ctx = (this.ctx = new AudioContext());
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    this.master = master;
    // surf
    const n1 = this.noise(ctx);
    this.surfF = ctx.createBiquadFilter();
    this.surfF.type = 'lowpass';
    this.surfF.frequency.value = 900;
    this.surf = ctx.createGain();
    this.surf.gain.value = 0;
    n1.connect(this.surfF).connect(this.surf).connect(master);
    n1.start();
    // city hum
    const n2 = this.noise(ctx);
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 220;
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    n2.connect(hf).connect(this.hum).connect(master);
    n2.start(0, 1.3);
    // breeze
    const n3 = this.noise(ctx);
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = 1800;
    bf.Q.value = 0.6;
    this.breeze = ctx.createGain();
    this.breeze.gain.value = 0;
    n3.connect(bf).connect(this.breeze).connect(master);
    n3.start(0, 2.7);
    // rain: hiss on everything, plus a softer patter
    const n4 = this.noise(ctx, true);
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 1400;
    const rf2 = ctx.createBiquadFilter();
    rf2.type = 'lowpass';
    rf2.frequency.value = 9000;
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    n4.connect(rf).connect(rf2).connect(this.rain).connect(master);
    n4.start(0, 0.7);
    // engine
    this.engF = ctx.createBiquadFilter();
    this.engF.type = 'lowpass';
    this.engF.frequency.value = 600;
    this.eng = ctx.createGain();
    this.eng.gain.value = 0;
    this.engF.connect(this.eng).connect(master);
    for (const det of [0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 40;
      o.detune.value = det;
      o.connect(this.engF);
      o.start();
      this.engO.push(o);
    }
  }

  /** a roll of thunder: a crack (near) then a long low rumble */
  thunder(loud: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const len = ctx.sampleRate * 7;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      last = (last + 0.06 * (Math.random() * 2 - 1)) / 1.06;
      const env = Math.min(1, t * 12) * Math.exp(-t * 0.55) * (0.65 + 0.35 * Math.sin(t * 2.3 + Math.sin(t * 5.1)));
      const crack = loud > 0.8 ? (Math.random() * 2 - 1) * Math.exp(-t * 9) * 0.6 : 0;
      d[i] = (last * 6 * env + crack) * 0.9;
    }
    const s = ctx.createBufferSource();
    s.buffer = b;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 220 + 600 * Math.min(1, loud);
    const g = ctx.createGain();
    g.gain.value = 0.9 * Math.min(1.2, loud);
    s.connect(f).connect(g).connect(this.master);
    s.start();
  }

  /** x: three x (the sea is at x ≈ 262); swash: -0.07..0.07; kmh while driving or -1; rain 0..1 */
  update(t: number, x: number, swash: number, kmh: number, rain = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const toSea = Math.max(0, 262 - x);
    const near = 1 / (1 + toSea / 45);
    const breath = 0.6 + 0.4 * (0.5 + swash * 7);
    this.surf.gain.setTargetAtTime(0.5 * near * breath + 0.05, now, 0.3);
    this.surfF.frequency.setTargetAtTime(500 + 1500 * near * breath, now, 0.3);
    this.hum.gain.setTargetAtTime(0.25 / (1 + Math.max(0, x) / 60), now, 0.5);
    this.breeze.gain.setTargetAtTime(0.035 * (0.6 + 0.4 * Math.sin(t * 0.37) * Math.sin(t * 0.11)), now, 0.8);
    this.rain.gain.setTargetAtTime(0.32 * rain, now, 0.8);
    const driving = kmh >= 0;
    this.eng.gain.setTargetAtTime(driving ? 0.16 : 0, now, 0.15);
    if (driving) {
      const rpm = 900 + ((kmh % 70) / 70) * 5200 + Math.min(kmh, 70) * 20;
      for (const o of this.engO) o.frequency.setTargetAtTime(rpm / 60, now, 0.08);
      this.engF.frequency.setTargetAtTime(400 + rpm * 0.35, now, 0.1);
    }
  }
}
