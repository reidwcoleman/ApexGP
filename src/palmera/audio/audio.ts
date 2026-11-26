// All game audio is synthesised with WebAudio: no sound files.
import { Radio } from './radio';

export class AudioSys {
  readonly radio = new Radio();
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private eng: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
  private siren: { o: OscillatorNode; lfo: OscillatorNode; g: GainNode } | null = null;
  private horn: { g: GainNode } | null = null;
  private screech: { g: GainNode; f: BiquadFilterNode } | null = null;
  private amb: { g: GainNode; waves: GainNode; wf: BiquadFilterNode } | null = null;
  private boatMode = false;
  private nextChirp = 3;
  private t = 0;
  muted = false;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.buildEngine();
    this.buildSiren();
    this.buildHorn();
    this.buildScreech();
    this.buildAmbient();
    this.radio.station = 1;
    this.radio.attach(ctx, this.master, this.noise);
  }

  private noiseSrc(loop = true): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  private buildEngine() {
    const c = this.ctx!;
    const o1 = c.createOscillator(), o2 = c.createOscillator(), o3 = c.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    o3.type = 'triangle';
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    f.Q.value = 2;
    const g = c.createGain();
    g.gain.value = 0;
    const g2 = c.createGain();
    g2.gain.value = 0.4;
    o1.connect(f);
    o2.connect(g2).connect(f);
    o3.connect(f);
    f.connect(g).connect(this.master);
    o1.start();
    o2.start();
    o3.start();
    this.eng = { o1, o2, o3, f, g };
  }

  private buildSiren() {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = 900;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.4;
    const lg = c.createGain();
    lg.gain.value = 320;
    lfo.connect(lg).connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2200;
    const g = c.createGain();
    g.gain.value = 0;
    o.connect(f).connect(g).connect(this.master);
    o.start();
    lfo.start();
    this.siren = { o, lfo, g };
  }

  private buildHorn() {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.value = 0;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    for (const fr of [392, 494]) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = fr;
      o.connect(f);
      o.start();
    }
    f.connect(g).connect(this.master);
    this.horn = { g };
  }

  private buildScreech() {
    const c = this.ctx!;
    const s = this.noiseSrc();
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    f.Q.value = 8;
    const g = c.createGain();
    g.gain.value = 0;
    s.connect(f).connect(g).connect(this.master);
    s.start();
    this.screech = { g, f };
  }

  private buildAmbient() {
    const c = this.ctx!;
    // city rumble (brown-ish noise)
    const s = this.noiseSrc();
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 280;
    const g = c.createGain();
    g.gain.value = 0.05;
    s.connect(f).connect(g).connect(this.master);
    s.start();
    // surf
    const s2 = this.noiseSrc();
    const wf = c.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 900;
    const wg = c.createGain();
    wg.gain.value = 0;
    s2.connect(wf).connect(wg).connect(this.master);
    s2.start();
    this.amb = { g, waves: wg, wf };
  }

  setEngine(on: boolean, rpm: number, thr: number, boat: boolean) {
    if (!this.ctx || !this.eng) return;
    const t = this.ctx.currentTime;
    const e = this.eng;
    this.boatMode = boat;
    const base = boat ? 38 : 32;
    const fr = base + rpm * (boat ? 110 : 150);
    e.o1.frequency.setTargetAtTime(fr, t, 0.05);
    e.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.05);
    e.o3.frequency.setTargetAtTime(fr * 2.01, t, 0.05);
    e.f.frequency.setTargetAtTime(300 + rpm * 1400 + Math.abs(thr) * 500, t, 0.05);
    e.g.gain.setTargetAtTime(on ? 0.06 + 0.06 * Math.abs(thr) + rpm * 0.03 : 0, t, 0.08);
  }

  setSiren(level: number) {
    if (!this.ctx || !this.siren) return;
    this.siren.g.gain.setTargetAtTime(Math.min(0.08, level * 0.08), this.ctx.currentTime, 0.1);
  }

  private rainN: { g: GainNode } | null = null;
  /** rain hissing on everything, 0..1 */
  setRain(level: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    if (!this.rainN) {
      if (level <= 0.01) return;
      const s = this.noiseSrc();
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2600;
      f.Q.value = 0.4;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.sfx);
      s.start();
      this.rainN = { g };
    }
    this.rainN.g.gain.setTargetAtTime(Math.min(0.16, level * 0.16), c.currentTime, 0.5);
  }

  private rotor: { g: GainNode } | null = null;
  /** the helicopter overhead: a low thudding noise, 0 (gone) .. 1 (right above) */
  setRotor(level: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    if (!this.rotor) {
      if (level <= 0) return;
      const s = this.noiseSrc();
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 320;
      const am = c.createGain();
      am.gain.value = 0.5;
      const lfo = c.createOscillator();
      lfo.frequency.value = 11;
      const depth = c.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(am.gain);
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(f).connect(am).connect(g).connect(this.sfx);
      s.start();
      lfo.start();
      this.rotor = { g };
    }
    this.rotor.g.gain.setTargetAtTime(Math.min(0.5, level * level * 0.5), c.currentTime, 0.2);
  }

  setHorn(on: boolean) {
    if (!this.ctx || !this.horn) return;
    this.horn.g.gain.setTargetAtTime(on ? 0.1 : 0, this.ctx.currentTime, 0.02);
  }

  setScreech(amount: number) {
    if (!this.ctx || !this.screech) return;
    this.screech.g.gain.setTargetAtTime(Math.min(0.06, amount * 0.06), this.ctx.currentTime, 0.05);
    this.screech.f.frequency.setTargetAtTime(1800 + amount * 900, this.ctx.currentTime, 0.1);
  }

  /** Ambient mix: night 0..1, beach 0..1 (closeness to surf), city 0..1 */
  ambient(dt: number, night: number, beach: number, city: number) {
    if (!this.ctx || !this.amb) return;
    this.t += dt;
    const t = this.ctx.currentTime;
    this.amb.g.gain.setTargetAtTime(0.02 + city * 0.05, t, 0.5);
    const surf = beach * (0.05 + 0.04 * Math.sin(this.t * 0.6) ** 2);
    this.amb.waves.gain.setTargetAtTime(surf, t, 0.3);
    this.nextChirp -= dt;
    if (this.nextChirp <= 0) {
      this.nextChirp = 2 + Math.random() * 6;
      if (night > 0.5) this.cricket();
      else if (beach > 0.3) this.gull();
      else if (city > 0.5 && Math.random() < 0.4) this.distantHorn();
    }
  }

  private env(g: GainNode, t0: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  private gull() {
    const c = this.ctx!;
    const t0 = c.currentTime;
    for (let k = 0; k < 2; k++) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      const g = c.createGain();
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1500;
      o.frequency.setValueAtTime(1300, t0 + k * 0.3);
      o.frequency.linearRampToValueAtTime(900, t0 + k * 0.3 + 0.25);
      o.connect(f).connect(g).connect(this.master);
      this.env(g, t0 + k * 0.3, 0.03, 0.015, 0.25);
      o.start(t0 + k * 0.3);
      o.stop(t0 + k * 0.3 + 0.35);
    }
  }

  private cricket() {
    const c = this.ctx!;
    const t0 = c.currentTime;
    for (let k = 0; k < 4; k++) {
      const o = c.createOscillator();
      o.frequency.value = 4200;
      const g = c.createGain();
      o.connect(g).connect(this.master);
      this.env(g, t0 + k * 0.09, 0.01, 0.01, 0.05);
      o.start(t0 + k * 0.09);
      o.stop(t0 + k * 0.09 + 0.08);
    }
  }

  honk(dist: number) {
    if (!this.ctx || dist > 60) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1500;
    for (const fr of [370, 466]) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = fr;
      o.connect(f);
      o.start(t0);
      o.stop(t0 + 0.45);
    }
    f.connect(g).connect(this.sfx);
    this.env(g, t0, 0.01, 0.08 / (1 + dist * 0.08), 0.4);
  }

  private distantHorn() {
    const c = this.ctx!;
    const t0 = c.currentTime;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = 350 + Math.random() * 120;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = c.createGain();
    o.connect(f).connect(g).connect(this.master);
    this.env(g, t0, 0.02, 0.012, 0.4);
    o.start(t0);
    o.stop(t0 + 0.5);
  }

  gunshot(kind: string, dist: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const loud = kind === 'shotgun' ? 1.5 : kind === 'sniper' ? 1.8 : kind === 'rifle' ? 1.2 : 1;
    const vol = Math.max(0.02, (0.35 * loud) / (1 + dist * 0.05));
    if (kind === 'shotgun' || kind === 'sniper') {
      // a long tail off the buildings
      const s2 = this.noiseSrc(false);
      const f2 = c.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.setValueAtTime(1400, t0);
      f2.frequency.exponentialRampToValueAtTime(120, t0 + 0.9);
      const g2 = c.createGain();
      s2.connect(f2).connect(g2).connect(this.sfx);
      this.env(g2, t0 + 0.01, 0.01, vol * 0.5, 0.9);
      s2.start(t0, Math.random());
      s2.stop(t0 + 1.1);
    }
    const s = this.noiseSrc(false);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(kind === 'pistol' ? 5000 : kind === 'shotgun' ? 2600 : kind === 'rifle' ? 6000 : 3800, t0);
    f.frequency.exponentialRampToValueAtTime(300, t0 + 0.18);
    const g = c.createGain();
    s.connect(f).connect(g).connect(this.sfx);
    this.env(g, t0, 0.002, vol, kind === 'pistol' ? 0.28 : kind === 'shotgun' ? 0.4 : kind === 'sniper' ? 0.5 : 0.16);
    s.start(t0, Math.random());
    s.stop(t0 + 0.4);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(150, t0);
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.12);
    const og = c.createGain();
    o.connect(og).connect(this.sfx);
    this.env(og, t0, 0.002, vol * 0.8, 0.14);
    o.start(t0);
    o.stop(t0 + 0.2);
  }

  punch() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(180, t0);
    o.frequency.exponentialRampToValueAtTime(60, t0 + 0.1);
    const g = c.createGain();
    o.connect(g).connect(this.sfx);
    this.env(g, t0, 0.003, 0.25, 0.12);
    o.start(t0);
    o.stop(t0 + 0.15);
    const s = this.noiseSrc(false);
    const sg = c.createGain();
    const f = c.createBiquadFilter();
    f.frequency.value = 1200;
    s.connect(f).connect(sg).connect(this.sfx);
    this.env(sg, t0, 0.002, 0.12, 0.06);
    s.start(t0, Math.random());
    s.stop(t0 + 0.1);
  }

  whoosh() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const s = this.noiseSrc(false);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(600, t0);
    f.frequency.linearRampToValueAtTime(1600, t0 + 0.15);
    const g = c.createGain();
    s.connect(f).connect(g).connect(this.sfx);
    this.env(g, t0, 0.04, 0.05, 0.12);
    s.start(t0, Math.random());
    s.stop(t0 + 0.25);
  }

  crash(intensity: number, dist = 0) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const vol = Math.min(0.5, intensity * 0.03) / (1 + dist * 0.04);
    if (vol < 0.01) return;
    const s = this.noiseSrc(false);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = c.createGain();
    s.connect(f).connect(g).connect(this.sfx);
    this.env(g, t0, 0.003, vol, 0.35);
    s.start(t0, Math.random());
    s.stop(t0 + 0.5);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(90, t0);
    o.frequency.exponentialRampToValueAtTime(35, t0 + 0.3);
    const og = c.createGain();
    o.connect(og).connect(this.sfx);
    this.env(og, t0, 0.003, vol, 0.3);
    o.start(t0);
    o.stop(t0 + 0.4);
  }

  /** thunder: a sharp crack when close, a long low rumble from far off */
  thunder(dist: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const near = Math.max(0, 1 - dist / 700);
    const vol = 0.35 + near * 0.5;
    const len = 3 + (1 - near) * 3;
    // the crack
    if (near > 0.3) {
      const s = this.noiseSrc(false);
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 900;
      const g = c.createGain();
      s.connect(f).connect(g).connect(this.sfx);
      this.env(g, t0, 0.003, vol * near * 0.7, 0.35);
      s.start(t0, Math.random());
      s.stop(t0 + 0.5);
    }
    // the rumble: lowpassed noise that rolls (a slow wobble on the filter and the level)
    const s = this.noiseSrc(true);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(380 + near * 500, t0);
    f.frequency.exponentialRampToValueAtTime(70, t0 + len);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.08 + (1 - near) * 0.5);
    for (let k = 1; k < 6; k++) g.gain.linearRampToValueAtTime(vol * (0.45 + Math.random() * 0.55) * (1 - k / 7), t0 + (len * k) / 6);
    g.gain.linearRampToValueAtTime(0, t0 + len);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t0, Math.random());
    s.stop(t0 + len + 0.1);
  }

  explosion(dist: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const vol = 0.8 / (1 + dist * 0.02);
    const s = this.noiseSrc(false);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2000, t0);
    f.frequency.exponentialRampToValueAtTime(120, t0 + 1.4);
    const g = c.createGain();
    s.connect(f).connect(g).connect(this.sfx);
    this.env(g, t0, 0.005, vol, 1.6);
    s.start(t0, Math.random());
    s.stop(t0 + 1.8);
  }

  /** fireworks: a rising whistle at launch; a deep boom (late, across the water) or a crackle at the burst */
  firework(dist: number, kind: 'launch' | 'boom' | 'crackle') {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime + (kind === 'launch' ? 0 : dist / 343);
    const vol = 0.9 / (1 + dist * 0.012);
    if (kind === 'launch') {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(900, t0);
      o.frequency.exponentialRampToValueAtTime(2400, t0 + 1.6);
      const g = c.createGain();
      o.connect(g).connect(this.sfx);
      this.env(g, t0, 0.05, vol * 0.05, 1.7);
      o.start(t0);
      o.stop(t0 + 1.8);
      return;
    }
    const s = this.noiseSrc(false);
    const f = c.createBiquadFilter();
    const g = c.createGain();
    if (kind === 'boom') {
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, t0);
      f.frequency.exponentialRampToValueAtTime(60, t0 + 1.6);
      this.env(g, t0, 0.004, vol * 0.9, 2.0);
    } else {
      // crackle: highpassed noise chopped into pops
      f.type = 'highpass';
      f.frequency.value = 2200;
      g.gain.setValueAtTime(0, t0);
      for (let k = 0; k < 26; k++) {
        const tk = t0 + 0.25 + Math.random() * 1.6;
        g.gain.setValueAtTime(vol * 0.35, tk);
        g.gain.setValueAtTime(0, tk + 0.015);
      }
    }
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t0, Math.random());
    s.stop(t0 + 2.2);
  }

  splash() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const s = this.noiseSrc(false);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 800;
    const g = c.createGain();
    s.connect(f).connect(g).connect(this.sfx);
    this.env(g, t0, 0.01, 0.3, 0.7);
    s.start(t0, Math.random());
    s.stop(t0 + 0.9);
  }

  /** Short melodic cues: pickup, mission pass/fail, wanted up. */
  cue(kind: 'pickup' | 'pass' | 'fail' | 'wanted' | 'start' | 'cash' | 'click') {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const notes: Record<string, [number, number][]> = {
      pickup: [[880, 0], [1320, 0.07]],
      pass: [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [988, 0.56], [1047, 0.68]],
      fail: [[392, 0], [349, 0.2], [311, 0.4], [262, 0.6]],
      wanted: [[740, 0], [554, 0.12]],
      start: [[440, 0], [554, 0.1], [659, 0.2]],
      cash: [[1568, 0], [2093, 0.06]],
      click: [[1200, 0]],
    };
    for (const [fr, dt] of notes[kind]) {
      const o = c.createOscillator();
      o.type = kind === 'fail' ? 'sawtooth' : 'triangle';
      o.frequency.value = fr;
      const g = c.createGain();
      const f = c.createBiquadFilter();
      f.frequency.value = 3000;
      o.connect(f).connect(g).connect(this.sfx);
      this.env(g, t0 + dt, 0.01, kind === 'click' ? 0.05 : 0.12, kind === 'pass' ? 0.35 : 0.2);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.5);
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  quietAll() {
    this.setEngine(false, 0, 0, this.boatMode);
    this.setSiren(0);
    this.setHorn(false);
    this.setScreech(0);
  }
}
