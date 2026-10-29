/**
 * The music: an original, generated-on-the-fly track that sits under the game. Soft detuned pads on a
 * slow four-chord loop, a round bass, a sparse plucked arpeggio through an echo, and a quiet shaker
 * and soft kick for a pulse. Fuller in the menus, pulled right back under a match. Scheduled a little
 * ahead on the audio clock, so it never stutters with the frame rate.
 */

const BPM = 94;
const STEP = 60 / BPM / 4; // a sixteenth
// the loop: four chords, two bars each (midi notes; the bass takes the first)
const CHORDS: number[][] = [
  [45, 57, 60, 64, 67], // A minor 7
  [41, 57, 60, 64, 69], // F major 7
  [48, 55, 59, 64, 67], // C major 7
  [43, 55, 59, 62, 66], // G, with the sixth and the major seventh over it
];
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  private out: GainNode;
  private echo: DelayNode;
  private timer = 0;
  private next = 0;
  private step = 0;
  private seed = 7;
  /** the music volume (the player's setting) and how much of it the moment wants */
  private vol = 0.5;
  private want = 1;

  constructor(private ctx: AudioContext, dest: AudioNode, private noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    // an echo for the plucks: dotted eighths, softened each time round
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    this.echo.connect(tone).connect(fb).connect(this.echo);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    tone.connect(wet).connect(this.out);
  }

  start(): void {
    if (this.timer) return;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 50);
    this.level();
  }

  /** the player's music volume 0…1 */
  setVolume(v: number): void {
    this.vol = v;
    this.level();
  }

  /** how much of the music the moment wants: 1 in the menus, less under a match */
  setMood(k: number): void {
    if (Math.abs(k - this.want) < 0.01) return;
    this.want = k;
    this.level();
  }

  private level(): void {
    const g = this.out.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(0.22 * this.vol * this.want, this.ctx.currentTime, 0.8);
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private schedule(): void {
    // (a hidden tab's timers run late: never pile up a backlog of notes)
    if (this.next < this.ctx.currentTime - 0.2) this.next = this.ctx.currentTime + 0.05;
    while (this.next < this.ctx.currentTime + 0.3) {
      this.play(this.step, this.next);
      this.next += STEP;
      this.step = (this.step + 1) % (CHORDS.length * 32);
    }
  }

  private play(step: number, t: number): void {
    const chord = CHORDS[Math.floor(step / 32)];
    const s = step % 16;
    if (step % 32 === 0) this.pad(chord, t, STEP * 32);
    if (s === 0 || s === 6 || s === 10) this.bass(chord[0], t, s === 0 ? 0.9 : 0.6);
    if (s % 2 === 0 && this.rand() < 0.55) {
      const tones = chord.slice(1);
      this.pluck(tones[Math.floor(this.rand() * tones.length)] + 12, t);
    }
    if (s === 0 || s === 8) this.kick(t);
    if (s % 4 === 2) this.shaker(t, s === 6 || s === 14 ? 1 : 0.6);
  }

  private pad(chord: number[], t: number, len: number): void {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1300, t + len * 0.5);
    f.frequency.linearRampToValueAtTime(600, t + len);
    f.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 1.4);
    g.gain.setValueAtTime(0.05, t + len - 0.6);
    g.gain.linearRampToValueAtTime(0, t + len + 1.6);
    f.connect(g).connect(this.out);
    for (const m of chord.slice(1)) {
      for (const det of [-7, 7]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + len + 1.7);
      }
    }
  }

  private bass(m: number, t: number, k: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz(m - 12);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * k, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 5);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + STEP * 5 + 0.05);
  }

  private pluck(m: number, t: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz(m);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g);
    g.connect(this.out);
    g.connect(this.echo);
    o.start(t);
    o.stop(t + 0.4);
  }

  private kick(t: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.32);
  }

  private shaker(t: number, k: number): void {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.05 * k, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 1.5, 0.09);
  }
}
