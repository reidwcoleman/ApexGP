/** All sound is synthesized: plush thumps, swishes, squeaks, arena noises, a crowd and a bouncy loop. */
export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private mus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private crowd!: GainNode;
  private last: Record<string, number> = {};
  musicOn = true;
  musicVol = 0.22;
  private musicTimer = 0;
  private beat = 0;
  private nextT = 0;
  private bpm = 118;
  private mood: 'menu' | 'fight' = 'menu';

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return;
    const c = (this.ctx = new C());
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.gain.value = 0.85;
    this.sfx.connect(this.master);
    this.mus = c.createGain();
    this.mus.gain.value = this.musicOn ? this.musicVol : 0;
    this.mus.connect(this.master);
    this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.6;
    this.crowd = c.createGain();
    this.crowd.gain.value = 0;
    s.connect(f).connect(this.crowd).connect(this.sfx);
    s.start();
    this.startMusic(this.mood);
  }

  private ok(key: string, gap = 0.03) {
    if (!this.ctx) return false;
    const t = this.ctx.currentTime;
    if (this.last[key] && t - this.last[key] < gap) return false;
    this.last[key] = t;
    return true;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, dest?: AudioNode) {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1, delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  /** a soft plush thump; heavier hits go lower and add a squeak */
  hit(s = 1) {
    if (!this.ok('hit', 0.025)) return;
    const p = 0.85 + Math.random() * 0.3;
    this.tone('sine', 190 * p, 55, 0.2, 0.75 * s);
    this.noise(0.1, 0.45 * s, 'lowpass', 1800, 300);
    if (s > 0.8) this.tone('triangle', 900 * p, 1500 * p, 0.07, 0.07);
  }
  thud(s = 1) {
    if (!this.ok('thud', 0.06)) return;
    this.tone('sine', 110, 40, 0.25, 0.55 * s);
    this.noise(0.16, 0.3 * s, 'lowpass', 800, 120);
  }
  swish() {
    if (this.ok('swish', 0.04)) this.noise(0.12, 0.16, 'bandpass', 900, 3200, 1.4);
  }
  whoosh(s = 1) {
    if (this.ok('whoosh', 0.05)) this.noise(0.36, 0.3 * s, 'bandpass', 420, 2000, 0.9);
  }
  jump(slot = 0) {
    if (!this.ok('jump' + slot, 0.05)) return;
    const b = 290 + slot * 35;
    this.tone('sine', b, b * 2.3, 0.13, 0.17);
  }
  grab() {
    if (!this.ok('grab', 0.05)) return;
    this.tone('sine', 640, 360, 0.06, 0.18);
    this.noise(0.05, 0.1, 'highpass', 2000);
  }
  ko() {
    if (!this.ok('ko', 0.1)) return;
    [988, 1319, 1661, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.16, 0.14, i * 0.07));
    this.cheer(0.5);
  }
  fall() {
    if (!this.ok('fall', 0.1)) return;
    this.tone('sine', 1250, 150, 1.3, 0.2);
    this.cheer(0.9);
  }
  splash() {
    if (!this.ok('splash', 0.1)) return;
    this.noise(0.8, 0.55, 'lowpass', 3200, 260);
    this.tone('sine', 320, 80, 0.3, 0.25);
  }
  ding(pitch = 1) {
    if (!this.ok('ding', 0.04)) return;
    for (const [f, v] of [[1320, 0.16], [2640, 0.06], [3960, 0.03]] as const) this.tone('sine', f * pitch, f * pitch * 0.99, 0.5, v);
  }
  flip() {
    if (!this.ok('flip', 0.08)) return;
    this.tone('square', 160, 80, 0.12, 0.08);
    this.noise(0.1, 0.25, 'bandpass', 1200, 400, 2);
  }
  clunk() {
    if (!this.ok('clunk', 0.15)) return;
    this.tone('square', 90, 60, 0.25, 0.1);
    this.noise(0.2, 0.22, 'bandpass', 600, 300, 2);
  }
  tick() {
    if (this.ok('tick', 0.2)) this.tone('square', 2200, 2100, 0.03, 0.05);
  }
  chop() {
    if (!this.ok('chop', 0.3)) return;
    this.noise(0.18, 0.5, 'highpass', 3000, 6000);
    this.tone('sine', 140, 40, 0.3, 0.5, 0.05);
  }
  click() {
    if (this.ok('click', 0.02)) this.tone('sine', 900, 1300, 0.05, 0.15);
  }
  back() {
    if (this.ok('back', 0.02)) this.tone('sine', 700, 420, 0.07, 0.15);
  }
  join(slot: number) {
    if (!this.ok('join', 0.05)) return;
    const base = [523, 587, 659, 784][slot % 4];
    [1, 1.25, 1.5].forEach((m, i) => this.tone('triangle', base * m, base * m, 0.14, 0.17, i * 0.06));
  }
  bell() {
    if (!this.ok('bell', 0.3)) return;
    for (const [f, v] of [[784, 0.28], [1568, 0.1], [2352, 0.05]] as const) this.tone('sine', f, f * 0.995, 1.4, v);
  }
  countdown(final = false) {
    if (!this.ok('count', 0.2)) return;
    const f = final ? 1046 : 523;
    this.tone('square', f, f, final ? 0.4 : 0.15, 0.07);
    this.tone('sine', f, f, final ? 0.5 : 0.18, 0.24);
  }
  fanfare() {
    if (!this.ctx) return;
    [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => {
      this.tone('square', f, f, 0.22, 0.05, i * 0.11);
      this.tone('triangle', f, f, 0.26, 0.18, i * 0.11);
    });
    this.cheer(1.2);
  }
  crowdLevel(v: number) {
    if (this.ctx) this.crowd.gain.setTargetAtTime(v * 0.05, this.ctx.currentTime, 0.4);
  }
  cheer(s = 1) {
    if (!this.ctx || !this.ok('cheer', 0.4)) return;
    const g = this.crowd.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.15 * s, t + 0.15);
    g.setTargetAtTime(0.03, t + 0.6, 0.6);
    for (let i = 0; i < 6 * s; i++) this.noise(0.25, 0.05, 'bandpass', 1500 + Math.random() * 1500, 2500, 6, Math.random() * 0.6);
  }

  // --- music: an original loop in A minor, scheduled ahead
  startMusic(mood: 'menu' | 'fight') {
    this.mood = mood;
    if (!this.ctx || this.musicTimer) return;
    this.beat = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.schedule(), 60);
  }
  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.ctx) this.mus.gain.setTargetAtTime(this.musicOn ? this.musicVol : 0, this.ctx.currentTime, 0.1);
    return this.musicOn;
  }
  private schedule() {
    const c = this.ctx!, step = 60 / this.bpm / 2;
    const roots = [45, 41, 48, 43]; // Am F C G
    const lead = [
      [69, -1, 72, -1, 76, 74, 72, -1],
      [69, -1, 65, 69, -1, 72, 71, -1],
      [67, -1, 72, 76, -1, 79, 76, -1],
      [74, -1, 71, -1, 67, 69, 71, -1],
    ];
    while (this.nextT < c.currentTime + 0.25) {
      const b = this.beat, bar = Math.floor(b / 8) % 4, i = b % 8, t = this.nextT;
      const r = roots[bar];
      const menu = this.mood === 'menu';
      if (i % 2 === 0 || i === 3) this.note('triangle', mtof(r - 12 + (i === 6 ? 7 : 0)), step * 1.4, 0.3, t);
      if (!menu && (i === 0 || i === 3 || i === 5)) this.kick(t);
      if (i % 2 === 1) this.hat(t, menu ? 0.025 : 0.05);
      if (!menu && i === 4) this.snare(t);
      const n = lead[bar][i];
      if (n > 0 && (!menu || i % 4 === 0)) this.note('square', mtof(n), step * 0.8, menu ? 0.03 : 0.045, t, 2200);
      if (i === 2 || i === 6) for (const iv of [0, 3, 7]) this.note('sine', mtof(r + 12 + iv), step * 0.6, 0.045, t);
      this.beat++;
      this.nextT += step;
    }
  }
  private note(type: OscillatorType, f: number, dur: number, vol: number, t: number, cutoff = 0) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (cutoff) {
      const fl = c.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = cutoff;
      o.connect(fl).connect(g);
    } else o.connect(g);
    g.connect(this.mus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  private kick(t: number) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.mus);
    o.start(t);
    o.stop(t + 0.2);
  }
  private hat(t: number, v: number) {
    const c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf;
    f.type = 'highpass';
    f.frequency.value = 7000;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    s.connect(f).connect(g).connect(this.mus);
    s.start(t, Math.random());
    s.stop(t + 0.05);
  }
  private snare(t: number) {
    const c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf;
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.7;
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    s.connect(f).connect(g).connect(this.mus);
    s.start(t, Math.random());
    s.stop(t + 0.16);
  }
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
