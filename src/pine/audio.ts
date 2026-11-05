// A four-voice chip: two pulses, triangle bass, noise. Public-domain carols plus one original tune.
// The trick: the lead line always runs in time with the backing but sits behind a gate, and working
// (cutting, planting, shearing) opens it. Mow a field and you are the one playing the carol.

interface Song { bpm: number; beats: number; lead: string; chords: string; drum?: boolean; arp?: 'up' | 'wave' | 'soft'; gated?: boolean; swing?: number }
const repeat = (s: string, n: number) => Array(n).fill(s).join(' ');
const JB_A = 'E5:2 E5:2 E5:4 E5:2 E5:2 E5:4 E5:2 G5:2 C5:3 D5:1 E5:8 F5:2 F5:2 F5:3 F5:1 F5:2 E5:2 E5:2 E5:1 E5:1';
const COTB = 'Bb4:2 A4:1 Bb4:1 G4:2';
export const SONGS: Record<string, Song> = {
  title: {
    bpm: 96, beats: 3, arp: 'soft',
    lead: 'R:4 G4:2 C5:3 C5:1 C5:2 D5:2 E5:3 E5:1 E5:2 D5:2 E5:2 F5:2 B4:2 D5:2 C5:4 G4:2 C5:3 C5:1 C5:2 D5:2 E5:3 E5:1 E5:2 D5:2 E5:2 F5:2 B4:2 D5:2 C5:6 G5:2 G5:2 E5:2 A5:2 G5:2 G5:1 F5:1 F5:2 F5:2 D5:2 G5:2 F5:2 F5:1 E5:1 E5:4 G4:2 C5:3 C5:1 C5:2 D5:2 E5:3 E5:1 E5:2 D5:2 E5:2 F5:2 B4:2 D5:2 C5:6',
    chords: 'C C G C G C C G C G C C F G G C C G C G C',
  },
  spring: {
    bpm: 118, beats: 4, gated: true, arp: 'up',
    lead: 'G4:2 G4:2 G4:2 A4:2 G4:2 G4:2 D4:4 E4:2 D4:2 E4:2 F#4:2 G4:4 G4:4 G4:2 G4:2 G4:2 A4:2 G4:2 G4:2 D4:4 E4:2 D4:2 E4:2 F#4:2 G4:4 G4:4 D5:2 C5:2 B4:2 A4:2 B4:2 A4:2 G4:4 E4:2 D4:2 E4:2 F#4:2 G4:4 G4:4 D4:2 D4:2 E4:2 F#4:2 G4:2 G4:2 A4:4 D5:2 C5:2 B4:2 A4:2 G4:4 C5:4 G4:8',
    chords: 'G G C G G G C G G Em C G D G D G G',
  },
  summer: {
    bpm: 132, beats: 4, gated: true, arp: 'wave', drum: true, swing: 0.12,
    lead: 'C5:2 A4:2 F4:2 A4:2 C5:3 D5:1 C5:4 Bb4:2 G4:2 E4:2 G4:2 Bb4:3 C5:1 Bb4:4 A4:2 F4:2 A4:2 C5:2 F5:4 E5:2 D5:2 C5:2 Bb4:2 A4:2 G4:2 F4:8 D5:2 C5:2 Bb4:2 D5:2 C5:2 A4:2 F4:4 Bb4:2 A4:2 G4:2 Bb4:2 A4:2 F4:2 C4:4 D4:2 F4:2 A4:2 D5:2 C5:3 Bb4:1 A4:2 G4:2 A4:2 G4:2 F4:2 E4:2 F4:8',
    chords: 'F F C C F Bb C F Bb F C F Dm F C F',
  },
  fall: {
    bpm: 126, beats: 4, gated: true, arp: 'up', drum: true,
    lead: 'R:6 E4:2 E4:2 B4:2 B4:2 A4:2 G4:2 F#4:2 E4:2 D4:2 E4:2 F#4:2 G4:2 A4:2 B4:6 E4:2 E4:2 B4:2 B4:2 A4:2 G4:2 F#4:2 E4:2 D4:2 E4:2 F#4:2 G4:2 A4:2 B4:6 B4:2 C5:2 A4:2 B4:2 C5:2 D5:2 E5:2 B4:2 A4:2 G4:2 E4:2 F#4:2 G4:2 A4:4 G4:2 A4:2 B4:6 R:2',
    chords: 'Em Em Em Em Em Em Em Em Em C G Em C Em',
  },
  harvest: {
    bpm: 172, beats: 4, gated: true, arp: 'wave', drum: true,
    lead: `${JB_A} E5:2 D5:2 D5:2 E5:2 D5:4 G5:4 ${JB_A} G5:2 G5:2 F5:2 D5:2 C5:8 G4:2 E5:2 D5:2 C5:2 G4:6 G4:1 G4:1 G4:2 E5:2 D5:2 C5:2 A4:8 A4:2 F5:2 E5:2 D5:2 B4:8 G5:2 G5:2 F5:2 D5:2 E5:8 G4:2 E5:2 D5:2 C5:2 G4:8 G4:2 E5:2 D5:2 C5:2 A4:6 A4:2 A4:2 F5:2 E5:2 D5:2 G5:2 G5:2 G5:2 G5:2 A5:2 G5:2 F5:2 D5:2 C5:4 G5:4`,
    chords: 'C C C C F C D G C C C C F C G C C C C F F G G C C C C F F G G C',
  },
  rush: {
    bpm: 208, beats: 3, gated: true, arp: 'wave', drum: true,
    lead: `${repeat(COTB, 4)} ${repeat('D5:2 C5:1 D5:1 Bb4:2', 4)} ${repeat(COTB, 2)} ${repeat('G5:2 F5:1 G5:1 Eb5:2', 2)} G5:1 G5:1 G5:1 F5:1 Eb5:1 D5:1 C5:1 C5:1 C5:1 Bb4:1 A4:1 G4:1 G5:1 G5:1 G5:1 F5:1 Eb5:1 D5:1 C5:1 C5:1 C5:1 Bb4:1 A4:1 G4:1 A4:2 Bb4:2 C5:2 A4:2 Bb4:2 C5:2 D5:2 C5:1 D5:1 Bb4:2 D5:2 C5:1 D5:1 Bb4:2 ${repeat(COTB, 2)}`,
    chords: 'Gm Gm Gm Gm Gm Gm Gm Gm Gm Gm Eb Eb Cm F Cm F F D Gm Gm Gm Gm',
  },
  winter: {
    bpm: 84, beats: 3, arp: 'soft',
    lead: 'G4:3 A4:1 G4:2 E4:6 G4:3 A4:1 G4:2 E4:6 D5:4 D5:2 B4:6 C5:4 C5:2 G4:6',
    chords: 'C C C C G G C C',
  },
  eve: {
    bpm: 74, beats: 3, arp: 'soft',
    lead: 'G4:3 A4:1 G4:2 E4:6 G4:3 A4:1 G4:2 E4:6 D5:4 D5:2 B4:6 C5:4 C5:2 G4:6 A4:4 A4:2 C5:3 B4:1 A4:2 G4:3 A4:1 G4:2 E4:6 A4:4 A4:2 C5:3 B4:1 A4:2 G4:3 A4:1 G4:2 E4:6 D5:4 D5:2 F5:3 D5:1 B4:2 C5:6 E5:6 C5:2 G4:2 E4:2 G4:3 F4:1 D4:2 C4:6 R:6',
    chords: 'C C C C G G C C F F C C F F C C G G C C C G C C',
  },
};

const NOTE: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const midi = (n: string) => { const m = /^([A-G][#b]?)(\d)$/.exec(n)!; return NOTE[m[1]] + (+m[2] + 1) * 12; };
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
interface Ev { step: number; len: number; m: number }
interface Compiled { lead: Ev[]; chords: { root: number; minor: boolean }[]; barSteps: number; total: number; song: Song; stepT: number }
function compile(s: Song): Compiled {
  const lead: Ev[] = []; let step = 0;
  for (const tok of s.lead.split(/\s+/)) { const [n, d] = tok.split(':'), len = +d * 2; if (n !== 'R') lead.push({ step, len, m: midi(n) }); step += len; }
  const chords = s.chords.split(' ').map((c) => { const m = /^([A-G][#b]?)(m?)/.exec(c)!; return { root: NOTE[m[1]], minor: m[2] === 'm' }; });
  const barSteps = s.beats * 4;
  return { lead, chords, barSteps, total: Math.max(chords.length * barSteps, Math.ceil(step / barSteps) * barSteps), song: s, stepT: 60 / s.bpm / 4 };
}

export class Chip {
  ctx: AudioContext | null = null; master!: GainNode; music!: GainNode; lead!: GainNode; fx!: GainNode;
  muted = false; private noise!: AudioBuffer; private pulse25!: PeriodicWave; private pulse12!: PeriodicWave;
  private cur: Compiled | null = null; private curName = ''; private step = 0; private nextT = 0; private li = 0; private gateUntil = 0;
  private timer = 0; private last: Record<string, number> = {}; private pending = '';

  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const A = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; if (!A) return;
    const c = this.ctx = new A();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.5;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; this.master.connect(comp); comp.connect(c.destination);
    this.music = c.createGain(); this.music.gain.value = 0.52; this.music.connect(this.master);
    this.lead = c.createGain(); this.lead.gain.value = 0.12; this.lead.connect(this.music);
    this.fx = c.createGain(); this.fx.gain.value = 0.8; this.fx.connect(this.master);
    const n = c.sampleRate; this.noise = c.createBuffer(1, n, n); const d = this.noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.pulse25 = this.duty(0.25); this.pulse12 = this.duty(0.125);
    this.timer = window.setInterval(() => this.tick(), 30);
    if (this.pending) { const p = this.pending; this.pending = ''; this.play(p); }
  }
  private duty(d: number) { const c = this.ctx!, n = 24, re = new Float32Array(n), im = new Float32Array(n); for (let k = 1; k < n; k++) { im[k] = 0; re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * d); } return c.createPeriodicWave(re, im); }
  toggle() { this.muted = !this.muted; if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02); return this.muted; }
  play(name: string) {
    if (!this.ctx) { this.pending = name; return; }
    if (name === this.curName) return;
    this.curName = name; this.cur = compile(SONGS[name]); this.step = 0; this.li = 0; this.nextT = this.ctx.currentTime + 0.12;
    this.lead.gain.cancelScheduledValues(0); this.lead.gain.setTargetAtTime(SONGS[name].gated ? 0.1 : 0.85, this.ctx.currentTime, 0.05);
  }
  stop() { this.cur = null; this.curName = ''; }
  /** a tree came down, a seedling went in: let the melody through for a moment */
  work(mine = true) { if (!this.ctx || !this.cur?.song.gated) return; const now = this.ctx.currentTime; if (!mine && now < this.gateUntil) return; this.gateUntil = Math.max(this.gateUntil, now + (mine ? 0.65 : 0.25)); this.lead.gain.setTargetAtTime(mine ? 1 : 0.55, now, 0.012); }
  private tick() {
    const c = this.ctx; if (!c || !this.cur) return;
    const now = c.currentTime, S = this.cur;
    if (S.song.gated && now > this.gateUntil) this.lead.gain.setTargetAtTime(0.1, now, 0.14);
    if (this.nextT < now) this.nextT = now + 0.02;
    while (this.nextT < now + 0.14) {
      const st = this.step, sw = S.song.swing && st % 2 ? S.song.swing * S.stepT * 2 : 0, t = this.nextT + sw;
      while (this.li < S.lead.length && S.lead[this.li].step === st) { const e = S.lead[this.li++]; this.voice(this.pulse25, hz(e.m), t, e.len * S.stepT * 0.92, 0.2, this.lead, 0.85); }
      this.backing(S, st, t);
      this.step++;
      if (this.step >= S.total) { this.step = 0; this.li = 0; }
      this.nextT += S.stepT;
    }
  }
  private backing(S: Compiled, st: number, t: number) {
    const bar = Math.floor(st / S.barSteps) % S.chords.length, inBar = st % S.barSteps, ch = S.chords[bar], root = ch.root, third = root + (ch.minor ? 3 : 4), fifth = root + 7, beats = S.song.beats;
    const arp = S.song.arp ?? 'up', soft = arp === 'soft';
    if (inBar % 4 === 0) {
      const beat = inBar / 4, f = beat === 0 ? root : beats === 3 ? (beat === 1 ? fifth : root + 12) : (beat % 2 ? fifth : root);
      this.voice('triangle', hz(36 + f), t, S.stepT * (soft ? 7 : 3.2), soft ? 0.34 : 0.42, this.music);
    }
    if (inBar % 2 === 0) {
      const seq = arp === 'wave' ? [root, third, fifth, root + 12, fifth, third] : [root, fifth, third, root + 12];
      this.voice(this.pulse12, hz(60 + seq[(inBar / 2) % seq.length]), t, S.stepT * 1.6, soft ? 0.05 : 0.075, this.music, 0.7);
    }
    // sleigh bells on every beat, all year round
    if (!soft && inBar % 4 === 0) this.jingle(t, inBar === 0 ? 0.05 : 0.034);
    if (S.song.drum) {
      if (inBar % 4 === 2) this.hit(t, 0.03, 0.06, 7000);
      if (inBar % 8 === 4 || (beats === 3 && inBar === 8)) this.hit(t, 0.08, 0.11, 2200);
      if (inBar === 0) this.thump(t);
    }
  }
  private jingle(t: number, v: number, out: AudioNode = this.music) { for (const [f, d] of [[3136, 0], [3951, 0.012], [4699, 0.024]]) this.voice('square', f, t + d, 0.05, v * 0.5, out, 0.3); this.hit(t, 0.05, v * 1.1, 8500, out); }
  private voice(type: OscillatorType | PeriodicWave, f: number, t: number, d: number, v: number, out: AudioNode, sustain = 0.6) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    if (type instanceof PeriodicWave) o.setPeriodicWave(type); else o.type = type;
    o.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.setValueAtTime(v * sustain, t + Math.min(0.04, d * 0.3)); g.gain.linearRampToValueAtTime(0, t + d);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.01);
  }
  private hit(t: number, d: number, v: number, f: number, out: AudioNode = this.music) {
    const c = this.ctx!, s = c.createBufferSource(), g = c.createGain(), b = c.createBiquadFilter();
    s.buffer = this.noise; s.loop = true; b.type = 'highpass'; b.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(b); b.connect(g); g.connect(out); s.start(t, Math.random() * 0.8); s.stop(t + d + 0.01);
  }
  private thump(t: number, v = 0.32, out: AudioNode = this.music) { const c = this.ctx!, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.09); g.gain.setValueAtTime(v, t); g.gain.linearRampToValueAtTime(0, t + 0.11); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.12); }
  private tone(f: number, at: number, d: number, v = 0.16, w: 'p' | 't' | 's' = 'p') { const c = this.ctx!; this.voice(w === 'p' ? this.pulse25 : w === 's' ? 'square' : 'triangle', f, c.currentTime + at, d, v, this.fx); }
  private seq(notes: number[], gap: number, d: number, v = 0.16) { notes.forEach((m, i) => this.tone(hz(m), i * gap, d, v)); }

  sfx(n: string) {
    const c = this.ctx; if (!c) return;
    const now = c.currentTime, min = n === 'chop' ? 0.05 : n === 'plant' || n === 'shear' ? 0.06 : n === 'blip' ? 0.03 : 0.08;
    if (now - (this.last[n] ?? 0) < min) return; this.last[n] = now;
    switch (n) {
      case 'chop': this.hit(now, 0.07, 0.2, 1400, this.fx); this.thump(now, 0.2, this.fx); break;
      case 'plant': this.tone(320 + Math.random() * 40, 0, 0.05, 0.1, 't'); this.hit(now, 0.03, 0.07, 3000, this.fx); break;
      case 'shear': this.hit(now, 0.03, 0.14, 5000, this.fx); this.hit(now + 0.05, 0.03, 0.11, 6000, this.fx); break;
      case 'spray': this.hit(now, 0.14, 0.08, 4000, this.fx); break;
      case 'blip': this.tone(880, 0, 0.03, 0.08); break;
      case 'click': this.tone(660, 0, 0.04, 0.12); this.tone(990, 0.03, 0.04, 0.1); break;
      case 'deny': this.tone(170, 0, 0.09, 0.17, 's'); this.tone(130, 0.09, 0.12, 0.17, 's'); break;
      case 'cash': this.tone(1320, 0, 0.05, 0.1); this.tone(1760, 0.05, 0.12, 0.1); break;
      case 'unload': this.seq([72, 76, 79], 0.05, 0.07, 0.1); this.hit(now, 0.1, 0.1, 500, this.fx); break;
      case 'build': this.hit(now, 0.05, 0.2, 800, this.fx); this.hit(now + 0.1, 0.05, 0.2, 800, this.fx); this.seq([67, 72], 0.1, 0.1); break;
      case 'buy': this.seq([76, 79, 84], 0.06, 0.09, 0.13); break;
      case 'goal': this.seq([72, 76, 79, 84, 88], 0.07, 0.14, 0.13); break;
      case 'order': this.seq([79, 84, 88, 91], 0.06, 0.12, 0.14); break;
      case 'miss': this.seq([64, 60, 55], 0.12, 0.16, 0.14); break;
      case 'ticket': this.tone(1568, 0, 0.06, 0.09); this.tone(1319, 0.08, 0.08, 0.09); break;
      case 'alarm': for (let i = 0; i < 4; i++) { this.tone(i % 2 ? 620 : 830, i * 0.13, 0.11, 0.13, 's'); } break;
      case 'full': this.tone(240, 0, 0.08, 0.1, 's'); break;
      case 'ram': this.thump(now, 0.4, this.fx); this.seq([84, 91], 0.05, 0.08, 0.14); break;
      case 'fanfare': this.seq([67, 72, 76, 79, 84, 79, 84, 88], 0.09, 0.16, 0.14); break;
      case 'month': this.tone(1046, 0, 0.05, 0.05); break;
      case 'sleigh': for (let i = 0; i < 12; i++) this.jingle(now + i * 0.14, 0.06 + (i % 4 === 0 ? 0.02 : 0), this.fx); break;
    }
  }
}
