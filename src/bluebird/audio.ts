// Bluebird: every sound is synthesised. Wind, the hiss of carving skis, a diesel snowcat, a two-stroke
// sled, snow guns, little chimes for money, and a slow chalet-lounge music loop.
export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private wind!: { f: BiquadFilterNode; g: GainNode };
  private carve!: { f: BiquadFilterNode; g: GainNode };
  private spray!: { f: BiquadFilterNode; g: GainNode };
  private gun!: { f: BiquadFilterNode; g: GainNode };
  private diesel!: { o: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode; lfo: OscillatorNode };
  private twoStroke!: { o: OscillatorNode; f: BiquadFilterNode; g: GainNode };
  private hum!: { o: OscillatorNode; g: GainNode };
  musicOn = true;
  sfxOn = true;
  private nextBar = 0;
  private bar = 0;

  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const C = (this.ctx = new AudioContext());
    this.master = C.createGain();
    this.master.gain.value = 0.8;
    const comp = C.createDynamicsCompressor();
    this.master.connect(comp).connect(C.destination);
    this.sfx = C.createGain(); this.sfx.connect(this.master);
    this.music = C.createGain(); this.music.gain.value = this.musicOn ? 0.22 : 0; this.music.connect(this.master);
    this.noise = C.createBuffer(1, C.sampleRate * 2, C.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.5; }
    const loop = (type: BiquadFilterType, f: number, q: number) => {
      const s = C.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const fl = C.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = C.createGain(); g.gain.value = 0;
      s.connect(fl).connect(g).connect(this.sfx);
      s.start(C.currentTime + Math.random());
      return { f: fl, g };
    };
    this.wind = loop('lowpass', 500, 0.7);
    this.carve = loop('bandpass', 2400, 0.9);
    this.spray = loop('bandpass', 1200, 0.6);
    this.gun = loop('highpass', 3500, 0.5);
    {
      const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 40;
      const o2 = C.createOscillator(); o2.type = 'square'; o2.frequency.value = 80;
      const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 2;
      const g = C.createGain(); g.gain.value = 0;
      const lfo = C.createOscillator(); lfo.frequency.value = 9; const lg = C.createGain(); lg.gain.value = 0.15;
      const o2g = C.createGain(); o2g.gain.value = 0.3;
      o.connect(f); o2.connect(o2g).connect(f); f.connect(g).connect(this.sfx);
      lfo.connect(lg).connect(g.gain);
      o.start(); o2.start(); lfo.start();
      this.diesel = { o, o2, f, g, lfo };
    }
    {
      const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 90;
      const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 1.4;
      const g = C.createGain(); g.gain.value = 0;
      o.connect(f).connect(g).connect(this.sfx); o.start();
      this.twoStroke = { o, f, g };
    }
    {
      const o = C.createOscillator(); o.type = 'triangle'; o.frequency.value = 55;
      const g = C.createGain(); g.gain.value = 0; o.connect(g).connect(this.sfx); o.start();
      this.hum = { o, g };
    }
    this.nextBar = C.currentTime + 0.5;
  }

  setMusic(on: boolean) { this.musicOn = on; if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.4); }
  setSfx(on: boolean) { this.sfxOn = on; if (this.ctx) this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.1); }

  /** called every frame with what's happening */
  frame(s: { wind: number; carve: number; spray: number; cat: number; catLoad: number; sled: number; gun: number; hum: number; night: number }) {
    const C = this.ctx;
    if (!C) return;
    const t = C.currentTime;
    const set = (p: AudioParam, v: number, k = 0.08) => p.setTargetAtTime(v, t, k);
    set(this.wind.g.gain, 0.05 + s.wind * 0.5);
    set(this.wind.f.frequency, 300 + s.wind * 1400);
    set(this.carve.g.gain, s.carve * 0.35);
    set(this.carve.f.frequency, 1600 + s.carve * 2200);
    set(this.spray.g.gain, s.spray * 0.5);
    set(this.gun.g.gain, s.gun * 0.22);
    set(this.diesel.g.gain, s.cat * (0.32 + s.catLoad * 0.12));
    set(this.diesel.o.frequency, 34 + s.catLoad * 26);
    set(this.diesel.o2.frequency, 68 + s.catLoad * 52);
    set(this.diesel.f.frequency, 220 + s.catLoad * 380);
    set(this.twoStroke.g.gain, s.sled * 0.18);
    set(this.twoStroke.o.frequency, 70 + s.sled * 0 + this.sledRpm * 190);
    set(this.twoStroke.f.frequency, 500 + this.sledRpm * 1300);
    set(this.hum.g.gain, s.hum * 0.06);
    this.musicTick(s.night);
  }
  sledRpm = 0;

  private tone(f: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, when = 0, dest?: AudioNode) {
    const C = this.ctx; if (!C) return;
    const t = C.currentTime + when;
    const o = C.createOscillator(); o.type = type; o.frequency.value = f;
    const g = C.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }
  private burst(dur: number, f: number, vol: number, type: BiquadFilterType = 'lowpass') {
    const C = this.ctx; if (!C) return;
    const t = C.currentTime;
    const s = C.createBufferSource(); s.buffer = this.noise;
    const fl = C.createBiquadFilter(); fl.type = type; fl.frequency.value = f;
    const g = C.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(fl).connect(g).connect(this.sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  cash() { this.tone(1318, 0.18, 'triangle', 0.12); this.tone(1760, 0.3, 'triangle', 0.1, 0.07); }
  buy() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.12, i * 0.06)); }
  click() { this.tone(900, 0.05, 'square', 0.04); }
  bad() { this.tone(220, 0.35, 'sawtooth', 0.08); this.tone(196, 0.45, 'sawtooth', 0.07, 0.12); }
  good() { this.tone(784, 0.2, 'sine', 0.12); this.tone(1175, 0.35, 'sine', 0.1, 0.1); }
  crash() { this.burst(0.6, 700, 0.9); this.burst(0.25, 180, 1.2); }
  land(impact: number) { this.burst(0.2, 400 + impact * 60, Math.min(0.7, 0.15 + impact * 0.05)); }
  pop() { this.burst(0.12, 1500, 0.3, 'bandpass'); }
  trick(score: number) { const n = Math.min(6, 2 + Math.floor(score / 400)); for (let i = 0; i < n; i++) this.tone([659, 784, 988, 1175, 1318, 1568][i], 0.3, 'triangle', 0.11, i * 0.07); }
  clunk() { this.burst(0.18, 300, 0.6); this.tone(110, 0.2, 'square', 0.05); }
  wrench(ok: boolean) { ok ? (this.tone(1500, 0.08, 'square', 0.06), this.burst(0.1, 3000, 0.25, 'highpass')) : this.tone(160, 0.25, 'sawtooth', 0.08); }

  // ------------------------------------------------------------------ music: slow lounge chords
  private musicTick(night: number) {
    const C = this.ctx!;
    if (!this.musicOn) return;
    if (C.currentTime < this.nextBar - 0.2) return;
    const t0 = this.nextBar;
    const beat = 60 / 72;
    const day = [[48, 55, 59, 64], [45, 52, 57, 60], [41, 48, 52, 57], [43, 50, 55, 59]];
    const eve = [[45, 52, 55, 60], [41, 48, 53, 57], [48, 55, 59, 62], [43, 50, 53, 59]];
    const prog = night > 0.5 ? eve : day;
    const ch = prog[this.bar % 4];
    const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    for (const n of ch) {
      const o = C.createOscillator(); o.type = 'sine'; o.frequency.value = hz(n + 12);
      const o2 = C.createOscillator(); o2.type = 'triangle'; o2.frequency.value = hz(n + 12) * 1.003;
      const g = C.createGain();
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.045, t0 + 0.8); g.gain.setValueAtTime(0.045, t0 + beat * 3.4); g.gain.linearRampToValueAtTime(0, t0 + beat * 4.2);
      o.connect(g); o2.connect(g); g.connect(this.music);
      o.start(t0); o2.start(t0); o.stop(t0 + beat * 4.3); o2.stop(t0 + beat * 4.3);
    }
    // bass
    this.tone(hz(ch[0] - 12), beat * 1.6, 'sine', 0.12, t0 - C.currentTime, this.music);
    this.tone(hz(ch[0] - 12), beat * 1.2, 'sine', 0.08, t0 - C.currentTime + beat * 2.5, this.music);
    // a few soft plucks from the chord
    const pent = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[1] + 24, ch[2] + 24];
    for (let i = 0; i < 4; i++) {
      if (Math.random() < 0.45) continue;
      const n = pent[(Math.random() * pent.length) | 0];
      this.tone(hz(n), 0.9, 'triangle', 0.05, t0 - C.currentTime + i * beat + (Math.random() < 0.3 ? beat / 2 : 0), this.music);
    }
    this.bar++;
    this.nextBar = t0 + beat * 4;
  }
}
