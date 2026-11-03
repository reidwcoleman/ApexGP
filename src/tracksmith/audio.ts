/** Everything you hear is synthesised here: engine with gears, tyres, wind, and short event sounds. */
const GEARS = [0, 13, 23, 33, 44, 55, 80];

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private eng!: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; f: BiquadFilterNode; g: GainNode };
  private tyre!: { f: BiquadFilterNode; g: GainNode };
  private wind!: { f: BiquadFilterNode; g: GainNode };
  private noise!: AudioBuffer;
  volume = 0.7;
  private gear = 1;
  private shiftT = 0;

  /** call from a user gesture */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const C = (this.ctx = new AudioContext());
    this.master = C.createGain();
    this.master.gain.value = this.volume;
    const comp = C.createDynamicsCompressor();
    this.master.connect(comp).connect(C.destination);

    this.noise = C.createBuffer(1, C.sampleRate * 2, C.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const f = C.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.Q.value = 3;
    const g = C.createGain();
    g.gain.value = 0;
    const o1 = C.createOscillator(); o1.type = 'sawtooth';
    const o2 = C.createOscillator(); o2.type = 'square';
    const o3 = C.createOscillator(); o3.type = 'sawtooth';
    const g2 = C.createGain(); g2.gain.value = 0.45;
    const g3 = C.createGain(); g3.gain.value = 0.25;
    o1.connect(f); o2.connect(g2).connect(f); o3.connect(g3).connect(f);
    f.connect(g).connect(this.master);
    o1.start(); o2.start(); o3.start();
    this.eng = { o1, o2, o3, f, g };

    this.tyre = this.loopNoise('bandpass', 1500, 2);
    this.wind = this.loopNoise('lowpass', 420, 0.7);
  }

  private loopNoise(type: BiquadFilterType, freq: number, q: number) {
    const C = this.ctx!;
    const s = C.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = C.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = C.createGain();
    g.gain.value = 0;
    s.connect(f).connect(g).connect(this.master);
    s.start();
    return { f, g };
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** per frame: speed m/s, throttle 0..1, tyre slip 0..1, airborne */
  drive(speed: number, throttle: number, slip: number, air: boolean, on: boolean, dt: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!on) {
      this.eng.g.gain.setTargetAtTime(0, t, 0.08);
      this.tyre.g.gain.setTargetAtTime(0, t, 0.05);
      this.wind.g.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    // gears
    const v = Math.abs(speed);
    while (this.gear < GEARS.length - 1 && v > GEARS[this.gear]) { this.gear++; this.shiftT = 0.12; }
    while (this.gear > 1 && v < GEARS[this.gear - 1] - 3) this.gear--;
    const lo = GEARS[this.gear - 1], hi = GEARS[this.gear];
    let rpm = 0.25 + 0.75 * Math.min(1, (v - lo) / (hi - lo));
    if (air) rpm = Math.min(1.05, rpm + throttle * 0.25);
    this.shiftT = Math.max(0, this.shiftT - dt);
    if (this.shiftT > 0) rpm *= 0.86;
    const base = 46 + rpm * 120 + this.gear * 4;
    this.eng.o1.frequency.setTargetAtTime(base, t, 0.03);
    this.eng.o2.frequency.setTargetAtTime(base * 0.5, t, 0.03);
    this.eng.o3.frequency.setTargetAtTime(base * 1.5, t, 0.03);
    this.eng.f.frequency.setTargetAtTime(500 + rpm * 1500 + throttle * 900, t, 0.05);
    this.eng.g.gain.setTargetAtTime(0.09 + throttle * 0.1 + rpm * 0.05, t, 0.05);
    this.tyre.g.gain.setTargetAtTime(air ? 0 : Math.min(0.32, Math.max(0, slip - 0.12) * Math.min(1, v / 8) * 0.6), t, 0.04);
    this.wind.g.gain.setTargetAtTime(Math.min(0.25, (v / 70) ** 2 * 0.25), t, 0.1);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, when = 0, slide = 0) {
    if (!this.ctx) return;
    const C = this.ctx;
    const t = C.currentTime + when;
    const o = C.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = C.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, vol: number, type: BiquadFilterType = 'bandpass', sweep = 1) {
    if (!this.ctx) return;
    const C = this.ctx;
    const t = C.currentTime;
    const s = C.createBufferSource();
    s.buffer = this.noise;
    const f = C.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    const g = C.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  check(better: boolean | null) {
    const b = better === false ? 0.94 : 1;
    this.tone(880 * b, 0.25, 'triangle', 0.18);
    this.tone(1318 * b, 0.35, 'triangle', 0.16, 0.08);
  }
  finish(record: boolean) {
    const notes = record ? [523, 659, 784, 1046, 1318] : [523, 659, 784];
    notes.forEach((n, i) => this.tone(n, 0.5, 'triangle', 0.16, i * 0.09));
  }
  boost() { this.burst(0.7, 400, 0.35, 'bandpass', 6); this.tone(220, 0.5, 'sawtooth', 0.05, 0, 2.2); }
  land(v: number) { this.tone(70, 0.25, 'sine', Math.min(0.5, v / 18), 0, 0.5); this.burst(0.15, 300, Math.min(0.25, v / 30), 'lowpass'); }
  respawn() { this.tone(660, 0.12, 'square', 0.06); this.tone(440, 0.18, 'square', 0.06, 0.07); }
  click() { this.tone(1200, 0.05, 'square', 0.04); }
  place() { this.tone(300, 0.08, 'triangle', 0.15, 0, 1.6); this.burst(0.06, 2000, 0.06); }
  erase() { this.tone(500, 0.1, 'triangle', 0.12, 0, 0.5); }
  go() { this.tone(660, 0.2, 'triangle', 0.12, 0, 1.5); }
}
