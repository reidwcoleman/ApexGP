// The car radio: three stations of music written as it plays (WebAudio synths, a step sequencer
// and a little random composer per station), plus off. Plays only while you're in a vehicle.
// Everything here is generated: chord progressions, bass lines and melodies are drawn each bar
// from the station's scale, so no two minutes are the same.

interface Station {
  name: string;
  tag: string;
  bpm: number;
  swing: number;
  /** semitone offsets of the scale from the root */
  scale: number[];
  root: number; // midi
  /** chord roots by scale degree, one per bar */
  prog: number[][];
  voice: 'saw' | 'rhodes' | 'pluck';
  drums: 'four' | 'lofi' | 'dembow';
}

export const STATIONS: Station[] = [
  { name: 'NEON TIDE 98.1', tag: 'retro synth after dark', bpm: 104, swing: 0, scale: [0, 2, 3, 5, 7, 8, 10], root: 45, prog: [[0, 5, 2, 6], [0, 3, 5, 4], [5, 3, 0, 4]], voice: 'saw', drums: 'four' },
  { name: 'PALM LOUNGE 89.5', tag: 'slow beats for the drive home', bpm: 78, swing: 0.18, scale: [0, 2, 4, 5, 7, 9, 11], root: 50, prog: [[1, 4, 0, 5], [3, 2, 1, 4], [0, 5, 3, 4]], voice: 'rhodes', drums: 'lofi' },
  { name: 'CALOR 101.7', tag: 'heat on the dance floor', bpm: 96, swing: 0, scale: [0, 2, 3, 5, 7, 8, 11], root: 43, prog: [[0, 5, 3, 4], [0, 3, 4, 0], [5, 4, 3, 4]], voice: 'pluck', drums: 'dembow' },
];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Radio {
  static readonly stations = STATIONS;
  station = 0; // 0 = off, 1.. = STATIONS[i-1]
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private bus!: GainNode;
  private noise!: AudioBuffer;
  private timer: number | null = null;
  private nextT = 0;
  private step = 0;
  private bar = 0;
  private progI = 0;
  private melody: (number | null)[] = [];
  private bass: (number | null)[] = [];
  private seed = 1;
  private on = false;

  attach(ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // a touch of "speaker": low cut, gentle high cut
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 70;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.9;
    this.bus.connect(hp).connect(lp).connect(this.out).connect(dest);
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** in a car or not; station switching resets the composer */
  setOn(on: boolean) {
    if (!this.ctx) return;
    const playing = on && this.station > 0;
    if (playing === this.on) return;
    this.on = playing;
    this.out.gain.setTargetAtTime(playing ? 0.32 : 0, this.ctx.currentTime, 0.25);
    if (playing && this.timer === null) {
      this.nextT = this.ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 25);
    } else if (!playing && this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  tune(dir: number): string {
    this.station = (this.station + dir + STATIONS.length + 1) % (STATIONS.length + 1);
    this.step = 0;
    this.bar = 0;
    this.seed = 1 + Math.floor(Math.random() * 1e6);
    this.progI = Math.floor(this.rnd() * 3);
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const was = this.on;
    this.on = false;
    this.setOn(was || this.station > 0);
    return this.station === 0 ? 'RADIO OFF' : `${STATIONS[this.station - 1].name} · ${STATIONS[this.station - 1].tag}`;
  }

  private schedule() {
    if (!this.ctx || this.station === 0) return;
    const st = STATIONS[this.station - 1];
    const sixteenth = 60 / st.bpm / 4;
    while (this.nextT < this.ctx.currentTime + 0.12) {
      const s = this.step % 16;
      if (s === 0) this.newBar(st);
      const swing = s % 2 === 1 ? st.swing * sixteenth : 0;
      this.play(st, s, this.nextT + swing, sixteenth);
      this.nextT += sixteenth;
      this.step++;
    }
  }

  private chordRoot(st: Station) {
    const prog = st.prog[this.progI];
    return prog[this.bar % prog.length];
  }

  private noteOf(st: Station, degree: number, octave = 0) {
    const n = st.scale.length;
    const d = ((degree % n) + n) % n;
    const o = Math.floor(degree / n);
    return st.root + st.scale[d] + 12 * (o + octave);
  }

  private newBar(st: Station) {
    this.bar++;
    if (this.bar % 16 === 0) this.progI = Math.floor(this.rnd() * st.prog.length);
    const r = this.chordRoot(st);
    // a melody: chord tones on strong beats, steps between, rests
    this.melody = [];
    let cur = r + 7;
    for (let i = 0; i < 16; i++) {
      const strong = i % 4 === 0;
      const p = this.rnd();
      if ((st.voice === 'rhodes' && i % 2 === 1) || p < (strong ? 0.15 : 0.5)) {
        this.melody.push(null);
        continue;
      }
      if (strong) cur = r + [7, 9, 11, 14][Math.floor(this.rnd() * 4)];
      else cur += Math.floor(this.rnd() * 5) - 2;
      this.melody.push(cur);
    }
    // the bass
    this.bass = [];
    for (let i = 0; i < 16; i++) {
      if (st.drums === 'four') this.bass.push(i % 2 === 0 ? r + (i % 8 === 6 ? 7 : 0) : null);
      else if (st.drums === 'lofi') this.bass.push(i === 0 || i === 10 ? r : i === 7 && this.rnd() < 0.5 ? r + 4 : null);
      else this.bass.push(i === 0 || i === 3 || i === 8 || i === 11 ? r + (i === 11 ? 4 : 0) : null);
    }
  }

  private play(st: Station, s: number, t: number, six: number) {
    const r = this.chordRoot(st);
    // drums
    if (st.drums === 'four') {
      if (s % 4 === 0) this.kick(t, 0.9);
      if (s === 4 || s === 12) this.snare(t, 0.5, 0.25);
      if (s % 2 === 1) this.hat(t, 0.12, 0.03);
    } else if (st.drums === 'lofi') {
      if (s === 0 || s === 7 || s === 10) this.kick(t, 0.6);
      if (s === 4 || s === 12) this.snare(t, 0.3, 0.14);
      if (s % 2 === 0) this.hat(t, 0.06 + this.rnd() * 0.04, 0.04);
      if (s === 0 && this.rnd() < 0.5) this.crackle(t, six * 16);
    } else {
      if (s === 0 || s === 8) this.kick(t, 0.85);
      if (s === 3 || s === 6 || s === 11 || s === 14) this.snare(t, 0.38, 0.1);
      if (s % 2 === 0) this.hat(t, 0.08, 0.025);
    }
    // chords on the bar (sustained) or stabs
    if (s === 0 || (st.voice === 'pluck' && (s === 6 || s === 10))) {
      const tones = [0, 2, 4, ...(st.voice === 'rhodes' ? [6] : [])].map((k) => this.noteOf(st, r + k, 1));
      const len = st.voice === 'pluck' ? six * 2 : six * 16;
      for (const n of tones) this.tone(n, t, len, st.voice === 'saw' ? 'pad' : st.voice === 'rhodes' ? 'rhodes' : 'pluck', 0.055);
    }
    const b = this.bass[s];
    if (b !== null && b !== undefined) this.tone(this.noteOf(st, b, -1), t, six * (st.drums === 'lofi' ? 3 : 1.6), 'bass', 0.22);
    const m = this.melody[s];
    if (m !== null && m !== undefined) this.tone(this.noteOf(st, m, 1), t, six * (st.voice === 'rhodes' ? 3 : 1.4), st.voice === 'saw' ? 'lead' : st.voice === 'rhodes' ? 'rhodes' : 'pluck', st.voice === 'saw' ? 0.07 : 0.09);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0008, t + a + d);
  }

  private tone(midi: number, t: number, len: number, kind: 'pad' | 'lead' | 'rhodes' | 'pluck' | 'bass', vol: number) {
    const c = this.ctx!;
    const f = mtof(midi);
    const g = c.createGain();
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    const oscs: OscillatorNode[] = [];
    const mk = (type: OscillatorType, det = 0, mul = 1) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      o.detune.value = det;
      o.connect(filt);
      oscs.push(o);
    };
    switch (kind) {
      case 'pad':
        mk('sawtooth', -9);
        mk('sawtooth', 9);
        filt.frequency.setValueAtTime(900, t);
        filt.frequency.linearRampToValueAtTime(2200, t + len * 0.5);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.25);
        g.gain.setValueAtTime(vol, t + len * 0.85);
        g.gain.linearRampToValueAtTime(0.0001, t + len);
        break;
      case 'lead':
        mk('square', 4);
        mk('sawtooth', -4, 2);
        filt.frequency.value = 2600;
        this.env(g, t, 0.01, vol, len);
        break;
      case 'rhodes':
        mk('sine');
        mk('triangle', 0, 2);
        filt.frequency.value = 2400;
        this.env(g, t, 0.006, vol, len * 1.6);
        break;
      case 'pluck':
        mk('triangle');
        mk('square', 0, 1);
        filt.frequency.setValueAtTime(3500, t);
        filt.frequency.exponentialRampToValueAtTime(400, t + 0.25);
        this.env(g, t, 0.004, vol, Math.max(0.2, len));
        break;
      case 'bass':
        mk('sawtooth');
        mk('sine', 0, 0.5);
        filt.frequency.setValueAtTime(600, t);
        filt.frequency.exponentialRampToValueAtTime(160, t + len);
        this.env(g, t, 0.008, vol, len);
        break;
    }
    filt.connect(g).connect(this.bus);
    for (const o of oscs) {
      o.start(t);
      o.stop(t + len * 1.8 + 0.1);
    }
  }

  private kick(t: number, vol: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = c.createGain();
    this.env(g, t, 0.002, vol * 0.5, 0.28);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.35);
  }

  private snare(t: number, vol: number, len: number) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.7;
    const g = c.createGain();
    this.env(g, t, 0.002, vol * 0.4, len);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t, Math.random());
    s.stop(t + len + 0.05);
  }

  private hat(t: number, vol: number, len: number) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = c.createGain();
    this.env(g, t, 0.001, vol * 0.4, len);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t, Math.random());
    s.stop(t + len + 0.03);
  }

  private crackle(t: number, len: number) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3000;
    f.Q.value = 4;
    const g = c.createGain();
    g.gain.value = 0.012;
    s.connect(f).connect(g).connect(this.bus);
    s.start(t, Math.random());
    s.stop(t + len);
  }
}
