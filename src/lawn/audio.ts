/** All sound is synthesised: the engine, the cutter's shhh, coins on a rising scale, a soft generative tune. */

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface MusicSet {
  chords: number[][];
  shift: number;
}
const CH = {
  cmaj7: [48, 55, 60, 64, 67, 71],
  am7: [45, 52, 57, 60, 64, 67],
  fmaj7: [41, 53, 57, 60, 64, 69],
  g6: [43, 50, 55, 59, 62, 64],
  dm9: [50, 53, 57, 60, 64, 65],
  em7: [40, 52, 55, 59, 62, 67],
};
const MUSIC: Record<string, MusicSet> = {
  meadow: { chords: [CH.cmaj7, CH.am7, CH.fmaj7, CH.g6], shift: 0 },
  blossom: { chords: [CH.cmaj7, CH.em7, CH.fmaj7, CH.g6], shift: 2 },
  autumn: { chords: [CH.am7, CH.fmaj7, CH.cmaj7, CH.g6], shift: -2 },
  dusk: { chords: [CH.fmaj7, CH.dm9, CH.am7, CH.g6], shift: 3 },
};

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private engGain!: GainNode;
  private eng1!: OscillatorNode;
  private eng2!: OscillatorNode;
  private engFilter!: BiquadFilterNode;
  private lfoGain!: GainNode;
  private lfo!: OscillatorNode;
  private cutGain!: GainNode;
  private cutFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  sound = true;
  music = true;
  private theme = 'meadow';
  private timer = 0;
  private step = 0;
  private nextT = 0;
  private playing = false;
  private nextBird = 0;
  private level = 0;

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  private init() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.sound ? 0.85 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.music ? 0.5 : 0;
    this.musicBus.connect(this.master);

    // a made-up room: decaying noise as the impulse
    const len = Math.floor(ctx.sampleRate * 2.4);
    const imp = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = imp.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = imp;
    const rg = ctx.createGain();
    rg.gain.value = 0.55;
    this.reverb.connect(rg).connect(this.musicBus);

    const nlen = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    // engine
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 360;
    this.eng1 = ctx.createOscillator();
    this.eng1.type = 'sawtooth';
    this.eng2 = ctx.createOscillator();
    this.eng2.type = 'square';
    this.eng1.frequency.value = this.eng2.frequency.value = 55;
    const e2 = ctx.createGain();
    e2.gain.value = 0.4;
    this.eng1.connect(this.engFilter);
    this.eng2.connect(e2).connect(this.engFilter);
    const trem = ctx.createGain();
    trem.gain.value = 1;
    this.engFilter.connect(trem).connect(this.engGain).connect(this.sfx);
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 17;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0.28;
    this.lfo.connect(this.lfoGain).connect(trem.gain);
    this.eng1.start();
    this.eng2.start();
    this.lfo.start();

    // the cutter's shhh
    const cs = ctx.createBufferSource();
    cs.buffer = this.noiseBuf;
    cs.loop = true;
    this.cutFilter = ctx.createBiquadFilter();
    this.cutFilter.type = 'bandpass';
    this.cutFilter.frequency.value = 2400;
    this.cutFilter.Q.value = 0.7;
    this.cutGain = ctx.createGain();
    this.cutGain.gain.value = 0;
    cs.connect(this.cutFilter).connect(this.cutGain).connect(this.sfx);
    cs.start();

    // a breath of wind
    const ws = ctx.createBufferSource();
    ws.buffer = this.noiseBuf;
    ws.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 480;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.02;
    ws.connect(wf).connect(this.windGain).connect(this.sfx);
    ws.start();
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.13;
    const wlg = ctx.createGain();
    wlg.gain.value = 0.012;
    wl.connect(wlg).connect(this.windGain.gain);
    wl.start();

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  setSound(on: boolean) {
    this.sound = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
  }
  setMusic(on: boolean) {
    this.music = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.2);
  }

  /** Per frame: how fast, how hard, how much grass is being cut right now. */
  drive(speed01: number, throttle: number, cutting: number, active: boolean) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const on = active ? 1 : 0.0;
    const f = 46 + speed01 * 38 + throttle * 10;
    this.eng1.frequency.setTargetAtTime(f, t, 0.06);
    this.eng2.frequency.setTargetAtTime(f * 1.005, t, 0.06);
    this.lfo.frequency.setTargetAtTime(15 + speed01 * 22, t, 0.1);
    this.engFilter.frequency.setTargetAtTime(280 + speed01 * 380 + throttle * 120, t, 0.08);
    this.engGain.gain.setTargetAtTime(on * (0.045 + speed01 * 0.05 + throttle * 0.02), t, 0.08);
    this.cutFilter.frequency.setTargetAtTime(1900 + cutting * 1500 + this.level * 900, t, 0.1);
    this.cutGain.gain.setTargetAtTime(on * cutting * 0.17, t, 0.05);
  }
  setProgress(p: number) {
    this.level = p;
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', when = 0, to?: number, dest?: AudioNode) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  private noise(dur: number, vol: number, f0: number, f1: number, when = 0, q = 1) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  coin(chain: number) {
    if (!this.ctx) return;
    const f = 523.25 * Math.pow(2, SCALE[Math.min(chain, SCALE.length - 1)] / 12);
    this.tone(f, 0.5, 0.2, 'sine');
    this.tone(f * 2, 0.32, 0.09, 'sine', 0.012);
    this.tone(f * 3, 0.16, 0.035, 'triangle', 0.02);
  }
  flower() {
    this.tone(1180 + Math.random() * 380, 0.09, 0.05, 'sine', 0, 1700);
  }
  bump(v: number) {
    const k = Math.min(1, v / 4);
    this.tone(120, 0.2, 0.28 * k + 0.05, 'sine', 0, 48);
    this.noise(0.12, 0.08 * k, 700, 160);
  }
  milestone(i: number) {
    const base = [72, 76, 79][i % 3];
    this.tone(mtof(base), 0.9, 0.12, 'sine');
    this.tone(mtof(base + 12), 0.7, 0.05, 'sine', 0.02);
    this.tone(mtof(base + 7), 0.8, 0.05, 'triangle', 0.06);
  }
  complete() {
    [72, 76, 79, 84, 88, 91].forEach((m, i) => {
      this.tone(mtof(m), 1.3, 0.14, 'sine', i * 0.1);
      this.tone(mtof(m + 12), 0.8, 0.04, 'sine', i * 0.1 + 0.01);
    });
    this.noise(0.9, 0.06, 500, 6000, 0, 0.6);
  }
  tap() {
    this.tone(1250, 0.05, 0.06, 'triangle');
  }
  back() {
    this.tone(820, 0.07, 0.05, 'triangle', 0, 560);
  }
  whoosh() {
    this.noise(1.0, 0.1, 260, 2400, 0, 0.5);
  }
  pop() {
    this.tone(360, 0.14, 0.14, 'sine', 0, 980);
  }
  buy() {
    [76, 79, 83, 88].forEach((m, i) => this.tone(mtof(m), 0.5, 0.1, 'sine', i * 0.07));
  }
  nope() {
    this.tone(220, 0.16, 0.1, 'triangle', 0, 160);
    this.tone(196, 0.2, 0.1, 'triangle', 0.1, 140);
  }
  count() {
    this.tone(1500 + Math.random() * 200, 0.04, 0.035, 'triangle');
  }

  // --------------------------------------------------------------- music + ambience

  startMusic(theme: string) {
    this.theme = theme;
    if (!this.ctx) return;
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    this.nextBird = this.ctx.currentTime + 3;
    this.timer = window.setInterval(() => this.tick(), 90);
  }
  setTheme(theme: string) {
    this.theme = theme;
  }
  stopMusic() {
    this.playing = false;
    window.clearInterval(this.timer);
  }

  private tick() {
    const c = this.ctx;
    if (!c || !this.playing) return;
    const stepDur = 60 / 74 / 2;
    while (this.nextT < c.currentTime + 0.5) {
      this.schedule(this.step, this.nextT - c.currentTime);
      this.step++;
      this.nextT += stepDur;
    }
    if (c.currentTime > this.nextBird) {
      this.nextBird = c.currentTime + 4 + Math.random() * 7;
      this.birds();
    }
  }

  private pluck(midi: number, when: number, vol: number, dur = 1.5) {
    const c = this.ctx!;
    const t = c.currentTime + Math.max(0, when);
    const f = mtof(midi);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverb);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.1);
    o2.stop(t + dur + 0.1);
  }

  private pad(notes: number[], when: number, dur: number, vol: number) {
    const c = this.ctx!;
    const t = c.currentTime + Math.max(0, when);
    for (const n of notes) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = mtof(n);
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.musicBus);
      g.connect(this.reverb);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private schedule(step: number, when: number) {
    const set = MUSIC[this.theme] ?? MUSIC.meadow;
    const bar = Math.floor(step / 8) % set.chords.length;
    const chord = set.chords[bar].map((n) => n + set.shift);
    const s = step % 8;
    if (s === 0) {
      this.pad(chord.slice(1, 5), when, 60 / 74 * 4, 0.028);
      this.pluck(chord[0], when, 0.1, 2.2);
    }
    // a wandering arpeggio over the chord, with rests so it breathes
    const pat = [0, -1, 2, 3, -1, 4, 3, -1];
    const idx = pat[s];
    if (idx >= 0 && Math.random() < 0.82) {
      const note = chord[1 + (idx % (chord.length - 1))] + (idx > 3 ? 12 : 0);
      this.pluck(note + 12, when, 0.05 + Math.random() * 0.03);
    }
    if (s === 4 && Math.random() < 0.5) this.pluck(chord[chord.length - 1] + 12, when + 0.02, 0.03, 2.2);
  }

  private birds() {
    const c = this.ctx;
    if (!c || !this.sound) return;
    if (this.theme === 'dusk') {
      // crickets
      for (let i = 0; i < 7; i++) this.tone(4300, 0.05, 0.012, 'sine', i * 0.075);
      return;
    }
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2300 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      this.tone(base + i * 80, 0.09, 0.022, 'sine', i * 0.11, base * (1.15 + Math.random() * 0.3));
    }
  }
}
