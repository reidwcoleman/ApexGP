// A laid-back procedural city groove: warm keys, a walking bass, soft drums and a sparse pentatonic
// melody that never repeats exactly. Speeds up a little and gets brighter during a Frenzy.
export class Music {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private bus!: GainNode;
  private timer = 0;
  private next = 0;
  private step = 0;
  on = false;
  hype = 0;
  private noise: AudioBuffer | null = null;

  attach(ctx: AudioContext, dest: AudioNode) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 5200;
    this.bus = ctx.createGain();
    this.bus.connect(lp).connect(this.out).connect(dest);
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
  }
  setOn(on: boolean) {
    this.on = on;
    if (!this.ctx) return;
    this.out.gain.setTargetAtTime(on ? 0.11 : 0, this.ctx.currentTime, 0.4);
    if (on && !this.timer) { this.next = this.ctx.currentTime + 0.1; this.timer = window.setInterval(() => this.schedule(), 60); }
    if (!on && this.timer) { clearInterval(this.timer); this.timer = 0; }
  }

  // F major-ish: Fmaj7 Dm7 Bbmaj7 C7sus, then Fmaj7 Am7 Gm7 C7
  private chords = [[53, 57, 60, 64], [50, 53, 57, 60], [46, 50, 53, 57], [48, 53, 55, 58], [53, 57, 60, 64], [45, 48, 52, 55], [43, 46, 50, 53], [48, 52, 55, 58]];
  private scale = [65, 67, 69, 72, 74, 77, 79, 81];
  private hz(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }

  private schedule() {
    const c = this.ctx!;
    const bpm = 84 + this.hype * 14;
    const e = 60 / bpm / 2; // eighth note
    while (this.next < c.currentTime + 0.25) {
      const s = this.step % 8, bar = Math.floor(this.step / 8) % this.chords.length;
      const t = this.next + (s % 2 ? e * 0.16 : 0); // a little swing
      const ch = this.chords[bar];
      if (s === 0 || s === 3 || s === 6) this.keys(ch, t, s === 0 ? 0.9 : 0.55, e * (s === 0 ? 3 : 2.6));
      if (s === 0) this.bass(ch[0] - 12, t, e * 2.5);
      if (s === 3) this.bass(ch[0] - 12 + (Math.random() < 0.5 ? 7 : 12), t, e * 1.4);
      if (s === 5) this.bass(ch[0] - 12 + 7, t, e * 1.4);
      if (s === 0 || s === 4 || (s === 7 && Math.random() < 0.3)) this.kick(t);
      if (s === 2 || s === 6) this.snare(t);
      this.hat(t, s % 2 ? 0.5 : 0.9);
      if (Math.random() < 0.22 + this.hype * 0.25 && s % 2 === 0) this.lead(this.scale[Math.floor(Math.random() * this.scale.length)] + (this.hype > 0.5 ? 12 : 0), t, e * (1 + Math.floor(Math.random() * 3)));
      this.next += e;
      this.step++;
    }
  }
  private env(t: number, a: number, peak: number, dur: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }
  private keys(notes: number[], t: number, vel: number, dur: number) {
    const c = this.ctx!;
    for (const n of notes) {
      const o = c.createOscillator(), o2 = c.createOscillator();
      o.type = 'sine'; o2.type = 'triangle';
      o.frequency.value = this.hz(n); o2.frequency.value = this.hz(n) * 2.001;
      const g = this.env(t, 0.015, 0.09 * vel, dur);
      const g2 = this.env(t, 0.005, 0.025 * vel, dur * 0.4);
      o.connect(g).connect(this.bus); o2.connect(g2).connect(this.bus);
      o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    }
  }
  private bass(n: number, t: number, dur: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = this.hz(n);
    const g = this.env(t, 0.01, 0.32, dur);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  private kick(t: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.env(t, 0.003, 0.55, 0.22);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 0.25);
  }
  private snare(t: number) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    const g = this.env(t, 0.002, 0.22, 0.16);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t); s.stop(t + 0.2);
  }
  private hat(t: number, v: number) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = this.env(t, 0.001, 0.06 * v, 0.05);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t); s.stop(t + 0.07);
  }
  private lead(n: number, t: number, dur: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = this.hz(n);
    const vib = c.createOscillator(), vg = c.createGain();
    vib.frequency.value = 5.5; vg.gain.value = 3;
    vib.connect(vg).connect(o.frequency);
    const g = this.env(t, 0.02, 0.07, dur * 1.3);
    o.connect(g).connect(this.bus);
    o.start(t); vib.start(t); o.stop(t + dur * 1.4); vib.stop(t + dur * 1.4);
  }
}
