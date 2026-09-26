/**
 * Generative lo-fi for the menus, the garage and the loading screen. Nothing is sampled or
 * pre-composed: every bar is decided as it is scheduled.
 *
 *  - harmony: jazzy four-chord loops (ii–V–I–vi, IV–iii–vi–I, …) of 7th/9th/11th chords in a
 *    warm key; each "song" picks a key, tempo and progression, and runs a few 8-bar sections
 *    (intro → groove / lite / break …) before drifting to the next
 *  - keys: two-operator FM electric piano (Rhodes-like bark on the attack, mellow tail) with
 *    voice-led rootless voicings, humanised strums and a slow suitcase auto-pan
 *  - pad: detuned saws under a slowly breathing low-pass
 *  - bass: round sine + octave, root on the one, a pickup now and then
 *  - drums: soft kick, dusty snare, swung hats, all low-passed; patterns vary per bar
 *  - sparse pentatonic melody fragments on the keys
 *  - tape: wow & flutter on every pitched voice, vinyl crackle and hiss, gentle saturation
 *
 * Realtime: a timer schedules ~0.6 s ahead (more during loading, when the main thread stalls).
 * Offline: call schedule(untilTime) yourself before rendering.
 */
import { type AudioBuffers, biquad, chain, clamp, gainNode, loopSource, rng, tanhCurve } from './dsp.ts';

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

type Quality = 'maj7' | 'maj9' | 'm7' | 'm9' | 'm11' | 'dom9' | 'dom13' | 'sus9' | 'six9';
const CHORD: Record<Quality, number[]> = {
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17],
  dom9: [0, 4, 7, 10, 14],
  dom13: [0, 4, 10, 14, 21],
  sus9: [0, 5, 7, 10, 14],
  six9: [0, 4, 7, 9, 14],
};

/** [scale degree in semitones from the key root, chord quality] per bar */
const PROGS: [number, Quality][][] = [
  [[2, 'm9'], [7, 'dom13'], [0, 'maj9'], [9, 'm9']],
  [[5, 'maj9'], [4, 'm7'], [9, 'm9'], [0, 'maj7']],
  [[0, 'maj9'], [9, 'm9'], [2, 'm11'], [7, 'sus9']],
  [[9, 'm9'], [5, 'maj9'], [0, 'six9'], [7, 'dom9']],
  [[2, 'm9'], [4, 'm7'], [5, 'maj9'], [7, 'sus9']],
  [[5, 'maj7'], [7, 'dom9'], [4, 'm7'], [9, 'm9']],
  [[2, 'm11'], [7, 'sus9'], [2, 'm9'], [7, 'dom13']],
  [[0, 'maj7'], [5, 'maj9'], [4, 'm7'], [2, 'm9']],
];
/** warm keys (pitch class of the key root) */
const KEYS = [0, 2, 3, 5, 7, 8, 10];
/** major pentatonic (melody) */
const PENTA = [0, 2, 4, 7, 9];

type Section = 'intro' | 'groove' | 'lite' | 'break';

interface Song {
  key: number;
  prog: [number, Quality][];
  bpm: number;
  swing: number;
  sections: Section[];
}

/** kick / snare / hat step patterns (16 steps; value = velocity) */
const KICKS: number[][] = [
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0.8, 0, 0, 0, 0, 0],
  [1, 0, 0, 0.5, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0.9, 0, 0, 0, 0, 0.4],
];
const SNARES: number[][] = [
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.25],
  [0, 0, 0, 0, 1, 0, 0, 0.2, 0, 0, 0, 0, 1, 0, 0, 0],
];

export class LofiMusic {
  /** fade gain (0 = off, 1 = playing) */
  readonly out: GainNode;
  private ctx: BaseAudioContext;
  private r: () => number;
  private white: AudioBuffer;

  private keysBus: GainNode;
  private padBus: GainNode;
  private bassBus: GainNode;
  private drumBus: GainNode;
  private hatBus: GainNode;
  private revIn: GainNode;
  /** tape wow & flutter, in cents, fed into every pitched voice's detune */
  private wow: GainNode;

  private playing = false;
  private active = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopAt = 0;
  /** seconds scheduled ahead of currentTime (realtime) */
  private ahead = 0.6;

  // sequencer state
  private song!: Song;
  private secIdx = 0;
  private barInSec = 0;
  private secLen = 8;
  private step = 0;
  private barCount = 0;
  private nextT = 0;
  private voicing: number[] = [];
  private melNote = 72;
  private kick: number[] = KICKS[0];
  private snare: number[] = SNARES[0];
  private hatDensity = 0.8;
  private chordMidi: number[] = [];
  private bassRoot = 40;
  private offSince = -1e9;

  constructor(ctx: BaseAudioContext, b: AudioBuffers, seed = (Math.random() * 2 ** 31) | 0) {
    this.ctx = ctx;
    this.r = rng(seed);
    this.white = b.white;
    this.out = gainNode(ctx, 0);

    // warm master: a little low shelf, rolled-off top, gentle tape saturation
    const mix = gainNode(ctx, 1.5);
    const shelf = biquad(ctx, 'lowshelf', 180, 0.7, 1);
    const air = biquad(ctx, 'highshelf', 6000, 0.7, -3);
    const lp = biquad(ctx, 'lowpass', 11000, 0.5);
    const sat = new WaveShaperNode(ctx, { curve: tanhCurve(1.15), oversample: '2x' });
    chain(mix, shelf, air, lp, sat, this.out);

    // room: a soft, dark plate
    const rev = new ConvolverNode(ctx, { buffer: makeRoomIR(ctx, this.r) });
    this.revIn = gainNode(ctx, 1);
    chain(this.revIn, biquad(ctx, 'highpass', 220, 0.7), rev, gainNode(ctx, 0.42), mix);

    // keys: suitcase auto-pan
    this.keysBus = gainNode(ctx, 1);
    const kp = new StereoPannerNode(ctx, { pan: 0 });
    const kpLfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.23 });
    kpLfo.connect(gainNode(ctx, 0.28)).connect(kp.pan);
    kpLfo.start();
    chain(this.keysBus, kp, mix);
    kp.connect(gainNode(ctx, 0.5)).connect(this.revIn);

    this.padBus = gainNode(ctx, 1);
    this.padBus.connect(mix);
    this.padBus.connect(gainNode(ctx, 0.7)).connect(this.revIn);

    this.bassBus = gainNode(ctx, 1);
    chain(this.bassBus, biquad(ctx, 'lowpass', 420, 0.6), mix);

    this.drumBus = gainNode(ctx, 1);
    chain(this.drumBus, biquad(ctx, 'lowpass', 5000, 0.6), mix);
    this.drumBus.connect(gainNode(ctx, 0.12)).connect(this.revIn);
    // hats skip the dusty low-pass (they'd vanish), but stay soft and never fizzy
    this.hatBus = gainNode(ctx, 1);
    chain(this.hatBus, biquad(ctx, 'lowpass', 9500, 0.5), mix);

    // tape wow (slow) + flutter (fast), a few cents
    this.wow = gainNode(ctx, 1);
    const w1 = new OscillatorNode(ctx, { type: 'sine', frequency: 0.29 });
    const w2 = new OscillatorNode(ctx, { type: 'sine', frequency: 0.071 });
    const fl = new OscillatorNode(ctx, { type: 'sine', frequency: 5.3 });
    w1.connect(gainNode(ctx, 5)).connect(this.wow);
    w2.connect(gainNode(ctx, 4)).connect(this.wow);
    fl.connect(gainNode(ctx, 1.2)).connect(this.wow);
    for (const o of [w1, w2, fl]) o.start();

    // vinyl: crackle + hiss (outside the saturation, straight to the output)
    const crackle = loopSource(ctx, makeVinylCrackle(ctx, this.r));
    chain(crackle, biquad(ctx, 'highpass', 700, 0.6), biquad(ctx, 'lowpass', 6500, 0.6), gainNode(ctx, 0.05), this.out);
    const hiss = loopSource(ctx, b.pink, 1);
    chain(hiss, biquad(ctx, 'bandpass', 3800, 0.45), gainNode(ctx, 0.006), this.out);

    this.newSong(true);
  }

  private isRealtime(): boolean {
    return typeof AudioContext !== 'undefined' && this.ctx instanceof AudioContext;
  }

  /** Scheduling horizon (seconds). Longer while the main thread is busy (loading). */
  setLookahead(s: number): void {
    this.ahead = clamp(s, 0.2, 8);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Fade the music in or out. */
  setPlaying(on: boolean, fade = on ? 3 : 1.4): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (on === this.playing) return;
    this.playing = on;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(on ? 1 : 0, now, fade / 3.5);
    if (on) {
      if (!this.active) {
        this.active = true;
        // back after a long while: a new tune; otherwise pick up with a gentle intro
        if (now - this.offSince > 45) this.newSong(false);
        else this.startSection('intro', 4);
        this.nextT = now + 0.12;
        this.step = 0;
      }
      this.stopAt = Infinity;
      this.startTimer();
    } else {
      this.offSince = now;
      this.stopAt = now + fade * 1.3;
    }
  }

  private startTimer(): void {
    if (this.timer || !this.isRealtime()) return;
    this.timer = setInterval(() => this.tick(), 90);
  }

  private tick(): void {
    const now = this.ctx.currentTime;
    if (!this.playing && now > this.stopAt) {
      this.active = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    this.schedule(now + this.ahead);
  }

  /** Schedule every note that starts before `until` (context time). */
  schedule(until: number): void {
    if (!this.active) return;
    const now = this.ctx.currentTime;
    // the main thread stalled past our horizon: skip the missed steps silently (no pile-up)
    while (this.nextT < now + 0.01) this.advance(this.nextT, false);
    while (this.nextT < until) this.advance(this.nextT, true);
  }

  // --------------------------------------------------------------------------- sequencer

  private newSong(first: boolean): void {
    const r = this.r;
    const prev = this.song;
    let key = KEYS[Math.floor(r() * KEYS.length)];
    // modulate by a fourth/fifth from the last tune (smooth), or anywhere on the first
    if (prev && !first) key = (prev.key + (r() < 0.5 ? 5 : 7)) % 12;
    const prog = PROGS[Math.floor(r() * PROGS.length)];
    const bpm = 68 + Math.floor(r() * 14);
    const n = 4 + Math.floor(r() * 3);
    const sections: Section[] = ['intro'];
    for (let i = 1; i < n; i++) {
      const last = sections[i - 1];
      const x = r();
      sections.push(last === 'intro' ? 'groove' : x < 0.5 ? 'groove' : x < 0.8 ? 'lite' : 'break');
    }
    sections.push('break');
    this.song = { key, prog, bpm, swing: 0.56 + r() * 0.06, sections };
    this.secIdx = 0;
    this.startSection('intro', 4);
  }

  private startSection(s: Section, bars: number): void {
    this.secLen = bars;
    this.barInSec = 0;
    this.song.sections[this.secIdx] = s;
  }

  private get section(): Section {
    return this.song.sections[this.secIdx] ?? 'groove';
  }

  private advance(t: number, play: boolean): void {
    const song = this.song;
    const d16 = 60 / song.bpm / 4;
    if (this.step === 0) this.barStart(t, play);
    if (play) this.drumStep(t, this.step);
    // swing: the first 16th of each pair is longer
    const pair = 2 * d16;
    this.nextT = t + (this.step % 2 === 0 ? pair * song.swing : pair * (1 - song.swing));
    this.step = (this.step + 1) % 16;
    if (this.step === 0) {
      this.barCount++;
      if (++this.barInSec >= this.secLen) {
        this.secIdx++;
        if (this.secIdx >= this.song.sections.length) this.newSong(false);
        else this.startSection(this.song.sections[this.secIdx], this.song.sections[this.secIdx] === 'break' ? 4 : 8);
      }
    }
  }

  private barStart(t: number, play: boolean): void {
    const r = this.r;
    const song = this.song;
    const [deg, q] = song.prog[this.barInSec % song.prog.length];
    const root = (song.key + deg) % 12;
    this.bassRoot = 36 + ((root + 12 - 4) % 12) + 4; // E2..D#3 → keeps the bass out of the mud
    this.voicing = this.voiceLead(root, CHORD[q]);
    this.chordMidi = this.voicing;
    const bar = (60 / song.bpm) * 4;
    const sec = this.section;
    // per-bar drum variation
    this.kick = KICKS[Math.floor(r() * KICKS.length)];
    this.snare = SNARES[Math.floor(r() * SNARES.length)];
    this.hatDensity = sec === 'lite' ? 0.55 : 0.85;
    if (!play) return;

    // pad: every bar in intro/break, every other bar otherwise (long overlapping swells)
    if (sec === 'intro' || sec === 'break' || this.barInSec % 2 === 0) {
      this.pad(t, this.voicing.map((m) => m - 12), bar * (sec === 'intro' || sec === 'break' ? 1.05 : 2.05), sec === 'intro' || sec === 'break' ? 1.5 : 0.75);
    }
    // keys comping
    const hits: [number, number, number][] = []; // [beat offset, length beats, vel]
    if (sec === 'break' || sec === 'intro') {
      // no drums here: the keys carry it, a held chord and sometimes a soft answer
      if (r() < 0.55) hits.push([0, 2.4, 0.72 + 0.15 * r()], [2.5, 1.3, 0.55 + 0.1 * r()]);
      else hits.push([0, 3.6, 0.75 + 0.15 * r()]);
    }
    else {
      const pat = Math.floor(r() * 4);
      if (pat === 0) hits.push([0, 1.4, 0.7], [1.5, 2.2, 0.55]);
      else if (pat === 1) hits.push([0, 2.4, 0.72], [2.75, 1.1, 0.5]);
      else if (pat === 2) hits.push([0.5, 1.8, 0.62], [2.5, 1.4, 0.58]);
      else hits.push([0, 3.5, 0.7]);
    }
    const beat = 60 / song.bpm;
    for (const [b, len, vel] of hits) {
      const t0 = t + b * beat + (r() - 0.5) * 0.012;
      // strum from the bottom, a few ms apart
      this.voicing.forEach((m, i) => this.rhodes(t0 + i * (0.008 + r() * 0.012), m, vel * (0.85 + 0.3 * r()), len * beat));
    }
    // bass
    if (sec !== 'intro' && sec !== 'break') {
      this.bass(t + 0.004, this.bassRoot, beat * (1.6 + r() * 0.6), 0.9);
      const x = r();
      if (x < 0.45) this.bass(t + beat * 2.5, this.bassRoot + (r() < 0.6 ? 7 : 12), beat * 1.1, 0.6);
      else if (x < 0.7) this.bass(t + beat * 3.5, this.bassRoot + (r() < 0.5 ? 10 : 5), beat * 0.45, 0.5);
    } else if (sec === 'break' && this.barInSec % 2 === 0) this.bass(t + 0.004, this.bassRoot, beat * 3.5, 0.55);
    // melody fragments (a few notes, not every bar)
    if ((sec === 'groove' || sec === 'lite') && r() < 0.42) {
      const n = 1 + Math.floor(r() * 3);
      let bt = 1 + Math.floor(r() * 4) * 0.5;
      for (let i = 0; i < n && bt < 3.8; i++) {
        this.melNote = this.nextMelody(song.key);
        this.rhodes(t + bt * beat + (r() - 0.5) * 0.01, this.melNote, 0.38 + 0.2 * r(), beat * (0.6 + r()));
        bt += r() < 0.5 ? 0.5 : 1;
      }
    }
    // vinyl-era "turnaround" hint: a lone high chord tone at the end of the last bar
    if (this.barInSec === this.secLen - 1 && r() < 0.5) this.rhodes(t + beat * 3.5, this.voicing[this.voicing.length - 1] + 12, 0.3, beat * 1.2);
  }

  /** closest inversion to the previous voicing, rootless when it's rich enough */
  private voiceLead(root: number, ivs: number[]): number[] {
    const pcs = (ivs.length >= 5 ? ivs.filter((i) => i !== 0) : ivs).map((i) => (root + i) % 12);
    const center = this.voicing.length ? this.voicing.reduce((a, b) => a + b, 0) / this.voicing.length : 62;
    const target = clamp(center + (this.r() - 0.5) * 2, 58, 66);
    const out = pcs.map((pc) => {
      let m = pc + 12 * Math.round((target - pc) / 12);
      if (m < 52) m += 12;
      if (m > 76) m -= 12;
      return m;
    });
    out.sort((a, b) => a - b);
    // no seconds low down (mud): lift the upper note of a low cluster an octave
    for (let i = 1; i < out.length; i++) if (out[i] - out[i - 1] <= 2 && out[i - 1] < 60) out[i] += 12;
    out.sort((a, b) => a - b);
    return [...new Set(out)];
  }

  private nextMelody(key: number): number {
    const r = this.r;
    const cand: number[] = [];
    for (let m = 67; m <= 86; m++) if (PENTA.includes((m - key + 120) % 12)) cand.push(m);
    let i = cand.findIndex((m) => m >= this.melNote);
    if (i < 0) i = cand.length - 1;
    const stepBy = r() < 0.7 ? (r() < 0.5 ? -1 : 1) : r() < 0.5 ? -2 : 2;
    i = clamp(i + stepBy, 0, cand.length - 1);
    // drift back toward the middle
    if (cand[i] > 81 && r() < 0.5) i = Math.max(0, i - 2);
    return cand[i];
  }

  private drumStep(t: number, s: number): void {
    const sec = this.section;
    if (sec === 'intro' || sec === 'break') {
      // just a hint of time: soft hats every other beat in the intro
      if (sec === 'intro' && s % 8 === 4 && this.barInSec >= 2) this.hat(t, 0.35);
      return;
    }
    const r = this.r;
    const hum = (r() - 0.5) * 0.008;
    if (sec === 'groove' && this.kick[s] > 0) this.kickHit(t + hum, this.kick[s]);
    if (this.snare[s] > 0) (sec === 'lite' ? this.rim(t + hum, this.snare[s]) : this.snareHit(t + hum, this.snare[s]));
    if (s % 2 === 0 && r() < this.hatDensity) this.hat(t + hum, (s % 4 === 0 ? 0.75 : 0.5) * (0.7 + 0.3 * r()));
    else if (s % 2 === 1 && r() < 0.12) this.hat(t + hum, 0.3);
  }

  // --------------------------------------------------------------------------- instruments

  /** two-op FM electric piano */
  private rhodes(t: number, midi: number, vel: number, dur: number): void {
    const ctx = this.ctx;
    const f = mtof(midi);
    const v = clamp(vel, 0, 1);
    const car = new OscillatorNode(ctx, { type: 'sine', frequency: f });
    const mod = new OscillatorNode(ctx, { type: 'sine', frequency: f });
    const modG = gainNode(ctx, 0);
    // bark: index high on the attack, settling to a mellow tone; lower notes stay rounder
    const idx = (0.9 + 1.9 * v) * clamp(1.25 - (midi - 60) / 40, 0.5, 1.3);
    modG.gain.setValueAtTime(f * idx, t);
    modG.gain.setTargetAtTime(f * 0.75 * clamp(1.2 - (midi - 60) / 50, 0.5, 1.2), t + 0.005, 0.3);
    mod.connect(modG).connect(car.frequency);
    // tine ping
    const tine = new OscillatorNode(ctx, { type: 'sine', frequency: f * 4 });
    const tineG = gainNode(ctx, 0);
    tineG.gain.setValueAtTime(0, t);
    tineG.gain.linearRampToValueAtTime(0.09 * v, t + 0.002);
    tineG.gain.setTargetAtTime(0, t + 0.003, 0.05);
    const amp = gainNode(ctx, 0);
    const pk = 0.11 * (0.35 + 0.65 * v) * clamp(1.15 - (midi - 60) / 60, 0.6, 1.2);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(pk, t + 0.006);
    amp.gain.setTargetAtTime(pk * 0.45, t + 0.008, 0.35);
    amp.gain.setTargetAtTime(0, t + 0.3, 1.6);
    const end = t + Math.max(0.3, dur);
    amp.gain.setTargetAtTime(0, end, 0.14);
    chain(car, amp, this.keysBus);
    chain(tine, tineG, amp);
    for (const o of [car, mod, tine]) {
      this.wow.connect(o.detune);
      o.start(t);
      o.stop(end + 0.9);
    }
    car.onended = () => this.unwow(car);
    mod.onended = () => this.unwow(mod);
    tine.onended = () => this.unwow(tine);
  }

  /** a finished voice lets go of the shared wow LFO (or it could never be collected) */
  private unwow(o: OscillatorNode): void {
    try {
      this.wow.disconnect(o.detune);
    } catch {
      /* already gone */
    }
  }

  private pad(t: number, midis: number[], dur: number, lvl: number): void {
    const ctx = this.ctx;
    const r = this.r;
    const lp = biquad(ctx, 'lowpass', 500, 0.8);
    // the filter breathes open and closed over the chord
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.setTargetAtTime(1000 + 800 * r(), t + 0.1, dur * 0.3);
    lp.frequency.setTargetAtTime(600, t + dur * 0.6, dur * 0.3);
    const g = gainNode(ctx, 0);
    const pk = 0.02 * lvl;
    g.gain.setValueAtTime(0, t);
    g.gain.setTargetAtTime(pk, t, 0.7);
    g.gain.setTargetAtTime(0, t + dur, 0.9);
    chain(lp, g, this.padBus);
    for (const m of midis) {
      for (const det of [-7, 6]) {
        const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: mtof(m), detune: det + (r() - 0.5) * 4 });
        this.wow.connect(o.detune);
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 4.5);
        o.onended = () => this.unwow(o);
      }
    }
  }

  private bass(t: number, midi: number, dur: number, vel: number): void {
    const ctx = this.ctx;
    const f = mtof(midi);
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: f });
    const o2 = new OscillatorNode(ctx, { type: 'sine', frequency: f * 2 });
    const g2 = gainNode(ctx, 0.28);
    const g = gainNode(ctx, 0);
    const pk = 0.07 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pk, t + 0.012);
    g.gain.setTargetAtTime(pk * 0.6, t + 0.02, 0.35);
    g.gain.setTargetAtTime(0, t + dur, 0.07);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.bassBus);
    for (const x of [o, o2]) {
      x.start(t);
      x.stop(t + dur + 0.5);
    }
  }

  private noise(t: number, len: number): AudioBufferSourceNode {
    const n = new AudioBufferSourceNode(this.ctx, { buffer: this.white });
    n.start(t, this.r() * (this.white.duration - len - 0.1), len);
    return n;
  }

  private kickHit(t: number, vel: number): void {
    const ctx = this.ctx;
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: 120 });
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    const g = gainNode(ctx, 0);
    const pk = 0.16 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pk, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.012, 0.085);
    chain(o, g, this.drumBus);
    o.start(t);
    o.stop(t + 0.7);
    // felt beater
    const n = this.noise(t, 0.03);
    const ng = gainNode(ctx, 0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.07 * vel, t + 0.001);
    ng.gain.setTargetAtTime(0, t + 0.002, 0.004);
    chain(n, biquad(ctx, 'lowpass', 1600, 0.7), ng, this.drumBus);
  }

  private snareHit(t: number, vel: number): void {
    const ctx = this.ctx;
    const n = this.noise(t, 0.35);
    const g = gainNode(ctx, 0);
    const pk = 0.17 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pk, t + 0.002);
    g.gain.setTargetAtTime(pk * 0.25, t + 0.006, 0.03);
    g.gain.setTargetAtTime(0, t + 0.04, 0.09);
    chain(n, biquad(ctx, 'bandpass', 1900 + this.r() * 400, 0.5), g, this.drumBus);
    const b = new OscillatorNode(ctx, { type: 'triangle', frequency: 190 });
    b.frequency.setValueAtTime(205, t);
    b.frequency.exponentialRampToValueAtTime(170, t + 0.08);
    const bg = gainNode(ctx, 0);
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.08 * vel, t + 0.002);
    bg.gain.setTargetAtTime(0, t + 0.004, 0.035);
    chain(b, bg, this.drumBus);
    b.start(t);
    b.stop(t + 0.3);
  }

  private rim(t: number, vel: number): void {
    const ctx = this.ctx;
    const o = new OscillatorNode(ctx, { type: 'triangle', frequency: 1650 + this.r() * 80 });
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045 * vel, t + 0.001);
    g.gain.setTargetAtTime(0, t + 0.002, 0.012);
    chain(o, biquad(ctx, 'bandpass', 1700, 2), g, this.drumBus);
    o.start(t);
    o.stop(t + 0.15);
    const n = this.noise(t, 0.05);
    const ng = gainNode(ctx, 0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.04 * vel, t + 0.001);
    ng.gain.setTargetAtTime(0, t + 0.002, 0.01);
    chain(n, biquad(ctx, 'bandpass', 2600, 1), ng, this.drumBus);
  }

  private hat(t: number, vel: number): void {
    const ctx = this.ctx;
    const n = this.noise(t, 0.12);
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.0015);
    g.gain.setTargetAtTime(0, t + 0.003, 0.018 + this.r() * 0.01);
    chain(n, biquad(ctx, 'highpass', 5500, 0.7), g, this.hatBus);
  }
}

// ------------------------------------------------------------------------------------------

/** sparse vinyl crackle: little ticks, the odd louder pop, all soft-edged (no digital clicks) */
function makeVinylCrackle(ctx: BaseAudioContext, r: () => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 7);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const ticks = Math.floor(7 * 9);
  for (let k = 0; k < ticks; k++) {
    const at = Math.floor(r() * (n - 400));
    const big = r() < 0.08;
    const amp = (big ? 0.7 : 0.12 + 0.3 * r()) * (r() < 0.5 ? -1 : 1);
    const len = Math.floor(sr * (big ? 0.0015 : 0.0005 + r() * 0.0006));
    for (let i = 0; i < len; i++) {
      const w = Math.sin((Math.PI * i) / len);
      d[at + i] += amp * w * (0.6 + 0.4 * (r() * 2 - 1));
    }
  }
  // dust: a faint continuous grain
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += 0.2 * ((r() * 2 - 1) * 0.02 - lp);
    d[i] += lp;
  }
  return buf;
}

/** a warm, dark 2.6 s stereo room for the music */
function makeRoomIR(ctx: BaseAudioContext, r: () => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 2.6);
  const ir = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    const pre = Math.floor(sr * 0.018);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp(-t / 0.55) * Math.min(1, t / 0.03);
      const k = 0.35 * Math.exp(-t * 1.6) + 0.04;
      lp += k * (r() * 2 - 1 - lp);
      d[i] = lp * env * 0.5;
    }
  }
  return ir;
}
