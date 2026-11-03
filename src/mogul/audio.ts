// Small synthesized sounds: coins, clicks, the goal fanfare, a survey ping, a soft city bed.
export class Sfx {
  ctx: AudioContext | null = null;
  master!: GainNode;
  muted = false;
  private bed: { g: GainNode } | null = null;
  private last = 0;

  private ensure() {
    if (this.ctx) return this.ctx;
    const C = window.AudioContext || (window as any).webkitAudioContext;
    if (!C) return null;
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.startBed();
    return this.ctx;
  }
  unlock() { const c = this.ensure(); if (c && c.state === 'suspended') c.resume(); }
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; }

  private tone(f: number, t0: number, dur: number, type: OscillatorType, vol: number, f2?: number) {
    const c = this.ctx!;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  coin(big = false) {
    const c = this.ensure(); if (!c) return;
    const now = c.currentTime;
    if (now - this.last < 0.05) return;
    this.last = now;
    const p = big ? 1 : 0.9 + Math.random() * 0.2;
    this.tone(1320 * p, now, 0.08, 'square', 0.05);
    this.tone(1760 * p, now + 0.06, 0.18, 'square', 0.045);
  }
  click() { const c = this.ensure(); if (!c) return; this.tone(660, c.currentTime, 0.05, 'triangle', 0.08); }
  buy() { const c = this.ensure(); if (!c) return; const t = c.currentTime; this.tone(523, t, 0.1, 'triangle', 0.12); this.tone(784, t + 0.08, 0.16, 'triangle', 0.12); }
  bad() { const c = this.ensure(); if (!c) return; const t = c.currentTime; this.tone(220, t, 0.14, 'sawtooth', 0.05, 160); }
  goal() {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.09, 0.3, 'triangle', 0.13));
    this.tone(1568, t + 0.36, 0.5, 'sine', 0.08);
  }
  frenzy() {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime;
    [392, 494, 587, 784, 988, 1175, 1568].forEach((f, i) => { this.tone(f, t + i * 0.06, 0.22, 'square', 0.05); this.tone(f / 2, t + i * 0.06, 0.2, 'triangle', 0.08); });
    this.tone(1568, t + 0.45, 0.8, 'sawtooth', 0.04, 2093);
  }
  cash() {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 6; i++) this.tone(1200 + i * 180 + Math.random() * 80, t + i * 0.045, 0.12, 'square', 0.04);
    this.tone(2093, t + 0.3, 0.4, 'triangle', 0.08);
  }
  ping() { const c = this.ensure(); if (!c) return; const t = c.currentTime; this.tone(880, t, 0.9, 'sine', 0.14, 440); this.tone(1320, t + 0.15, 0.7, 'sine', 0.06, 660); }
  found() { const c = this.ensure(); if (!c) return; const t = c.currentTime; [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, t + i * 0.07, 0.25, 'square', 0.05)); }

  private startBed() {
    // a quiet city hum: filtered noise
    const c = this.ctx!;
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = b * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = b * 3; }
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = c.createGain(); g.gain.value = 0.18;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.bed = { g };
  }
  setBed(level: number) { if (this.bed) this.bed.g.gain.value = 0.05 + 0.2 * level; }
}
