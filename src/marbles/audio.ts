import * as THREE from 'three';
import { Mat, type Hit } from './physics.ts';

/**
 * Every sound is synthesised here (no sample files), baked once into buffers and played with
 * per-hit gain, pitch, brightness and stereo position:
 *  - glass on glass: the "clack" — a Hertzian contact pulse (broadband, shorter and brighter the
 *    harder the hit), five inharmonic modes of a glass sphere around 3–4 kHz dying in tens of
 *    milliseconds and a little body; each marble has its own glass, so a pair always clacks at
 *    the same pitch; a hard hit sometimes chatters (a second tick as they rebound).
 *  - glass on the wooden chute: on the floor a hollow "tock" (the chute's air cavity, the board's
 *    modes and the marble's own glassy tick); on a rail a thinner, higher "tak"; a hard landing
 *    adds a sub thump. Painted blocks knock like temple blocks, padding thuds, bumpers pok-ding.
 *  - rolling: a grainy rumble per marble pitched and filtered by speed (the nearest six get a
 *    voice), the board joints ticking under your own marble, air past the camera.
 *  - a crowd: a murmur under the round, an "ooh" when you fall, cheers and an "aww".
 *  - the music: marimba, glockenspiel, plucked bass and a kit, in a new key each round, adding
 *    layers as the round heats up; it ducks under the big moments.
 * Hits are placed in stereo and fade with distance; a small bright room adds air; a limiter on top.
 */

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function buffer(ctx: BaseAudioContext, dur: number, f: (data: Float32Array, sr: number, ch: number) => void, ch = 1, peak = 0.9) {
  const sr = ctx.sampleRate;
  const n = Math.ceil(dur * sr);
  const b = ctx.createBuffer(ch, n, sr);
  for (let c = 0; c < ch; c++) f(b.getChannelData(c), sr, c);
  // (a short fade at the end: a ring cut off mid-decay clicks)
  const tail = Math.min(n >> 2, Math.floor(sr * 0.04));
  for (let c = 0; c < ch; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < tail; i++) d[n - 1 - i] *= i / tail;
  }
  let pk = 0;
  for (let c = 0; c < ch; c++) for (const v of b.getChannelData(c)) pk = Math.max(pk, Math.abs(v));
  if (pk > 0)
    for (let c = 0; c < ch; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= peak / pk;
    }
  return b;
}

/** a sum of damped sinusoids: modes [freq, amp, decay s] */
function modal(d: Float32Array, sr: number, modes: [number, number, number][], r: () => number, attack = 0.0004, at = 0) {
  for (const [f, a, tau] of modes) {
    const ph = r() * Math.PI * 2;
    const w = (2 * Math.PI * f) / sr;
    const k = Math.exp(-1 / (tau * sr));
    let env = a;
    const i0 = Math.floor(at * sr);
    for (let i = i0; i < d.length; i++) {
      const j = i - i0;
      const atk = Math.min(1, j / (attack * sr));
      d[i] += Math.sin(w * j + ph) * env * atk;
      env *= k;
      if (env < 1e-5) break;
    }
  }
}

/** a noise burst (high-passed: a click; low-passed: a thud) */
function burst(d: Float32Array, sr: number, amp: number, tau: number, r: () => number, hp = true, at = 0, lp = 0.25) {
  let prev = 0, l = 0;
  const k = Math.exp(-1 / (tau * sr));
  let env = amp;
  for (let i = Math.floor(at * sr); i < d.length && env > 1e-5; i++) {
    const n = r() * 2 - 1;
    const v = hp ? n - prev : (l += (n - l) * lp);
    prev = n;
    d[i] += v * env;
    env *= k;
  }
}

/** the contact itself: a half-sine force pulse (width w s) — broadband, the shorter the brighter */
function pulse(d: Float32Array, sr: number, amp: number, w: number, at = 0) {
  const n = Math.max(2, Math.round(w * sr));
  const i0 = Math.floor(at * sr);
  for (let i = 0; i < n && i0 + i < d.length; i++) d[i0 + i] += Math.sin((Math.PI * i) / n) * amp * (i < n / 2 ? 1 : -0.6);
}

type Bank = AudioBuffer[];

/** vowel formants (F1, F2, F3) for a small cartoon voice */
const VOW: Record<string, [number, number, number]> = { a: [850, 1350, 2800], o: [560, 950, 2600], u: [380, 900, 2400], e: [560, 2000, 2800], i: [360, 2500, 3200] };

/**
 * A little voice: a pulse train (summed harmonics, so no aliasing) through three formant resonators
 * gliding between vowels, a breath of noise on top. `f0` and the vowel follow `t` 0..1.
 */
function vox(d: Float32Array, sr: number, f0: (t: number) => number, vowels: string[], env: (t: number) => number, r: () => number, breath = 0.08) {
  const n = d.length;
  let ph = 0;
  const y1 = [0, 0, 0], y2 = [0, 0, 0];
  const co = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const gains = [1, 0.55, 0.22];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    if (i % 32 === 0) {
      // (the formants glide through the vowels in turn)
      const x = t * (vowels.length - 1);
      const k = Math.min(vowels.length - 2, Math.floor(x));
      const f = x - k;
      const A = VOW[vowels[k]], B = VOW[vowels[Math.min(vowels.length - 1, k + 1)]];
      for (let j = 0; j < 3; j++) {
        const F = (A[j] + (B[j] - A[j]) * f) * 1.18;
        const bw = 80 + j * 60;
        const rr = Math.exp((-Math.PI * bw) / sr);
        co[j][0] = 1 - rr;
        co[j][1] = 2 * rr * Math.cos((2 * Math.PI * F) / sr);
        co[j][2] = -rr * rr;
      }
    }
    const f = f0(t);
    ph += f / sr;
    if (ph > 1) ph -= 1;
    let src = 0;
    const H = Math.min(14, Math.floor(4800 / f));
    for (let h = 1; h <= H; h++) src += Math.sin(2 * Math.PI * h * ph) / h;
    src = src * 0.5 + (r() * 2 - 1) * breath;
    let out = 0;
    for (let j = 0; j < 3; j++) {
      const y = co[j][0] * src + co[j][1] * y1[j] + co[j][2] * y2[j];
      y2[j] = y1[j];
      y1[j] = y;
      out += y * gains[j];
    }
    d[i] = out * env(t);
  }
}

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private duck!: GainNode;
  private wet!: GainNode;
  private glass: Bank = [];
  private woodFloor: Bank = [];
  private woodWall: Bank = [];
  private paint: Bank = [];
  private felt: Bank = [];
  private ding: Bank = [];
  private sub!: AudioBuffer;
  private tick: Bank = [];
  private splashB!: AudioBuffer;
  private rollB: AudioBuffer[] = [];
  private windB!: AudioBuffer;
  private cheerB: AudioBuffer | null = null;
  private murmurB: AudioBuffer | null = null;
  private oohB: AudioBuffer | null = null;
  private awwB: AudioBuffer | null = null;
  private popB!: AudioBuffer;
  private vox = new Map<string, AudioBuffer[]>();
  private stepB: Bank = [];
  private whooshB!: AudioBuffer;
  private voices = 0;
  private rolls: { src: AudioBufferSourceNode; f: BiquadFilterNode; lp: BiquadFilterNode; g: GainNode; p: StereoPannerNode }[] = [];
  private wind: { g: GainNode; f: BiquadFilterNode } | null = null;
  private murmur: GainNode | null = null;
  private seamAcc = 0;
  private seamNext = 1;
  readonly cam = new THREE.Vector3();
  readonly right = new THREE.Vector3(1, 0, 0);
  musicOn = true;
  sfxOn = true;
  private music: Music | null = null;

  /** on the first gesture */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
    // a gentle glue compressor, then a limiter
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.knee.value = 12;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.005;
    glue.release.value = 0.2;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.08;
    this.master = ctx.createGain();
    this.master.gain.value = 0.95;
    this.master.connect(glue).connect(lim).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.duck = ctx.createGain();
    this.duck.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.3;
    this.musicBus.connect(this.duck);
    // a small, bright room (a stereo tail, early reflections a few ms in)
    const conv = ctx.createConvolver();
    conv.buffer = buffer(
      ctx,
      1.1,
      (d, sr, c) => {
        const r = rng(d.length + c * 77);
        for (let i = 0; i < d.length; i++) d[i] = (r() * 2 - 1) * Math.exp(-i / (0.2 * sr)) * (i < sr * 0.006 ? 0 : 1);
        for (let k = 0; k < 8; k++) d[Math.floor((0.007 + r() * 0.03) * sr)] += (r() - 0.5) * 3;
      },
      2,
    );
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.18;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 250;
    this.wet.connect(hp).connect(conv).connect(this.master);
    this.bake();
    this.music = new Music(ctx, this.musicBus);
  }

  private bake() {
    const ctx = this.ctx!;
    this.bakeVoices(ctx);
    // ---- glass on glass
    for (let v = 0; v < 16; v++) {
      const r = rng(100 + v);
      const f0 = 2600 + r() * 1600;
      const k = 0.85 + r() * 0.45;
      this.glass.push(
        buffer(ctx, 0.14, (d, sr) => {
          pulse(d, sr, 1.6, 0.00009);
          modal(
            d,
            sr,
            [
              [f0, 1, 0.034 * k],
              [f0 * (1.506 + r() * 0.04), 0.6, 0.026 * k],
              [f0 * (2.21 + r() * 0.05), 0.42, 0.019 * k],
              [f0 * (2.88 + r() * 0.06), 0.28, 0.014 * k],
              [f0 * (3.62 + r() * 0.07), 0.18, 0.01 * k],
              [f0 * (4.4 + r() * 0.08), 0.1, 0.007 * k],
              [950 + r() * 350, 0.32, 0.004],
            ],
            r,
            0.00015,
          );
          burst(d, sr, 0.7, 0.0006, r);
        }),
      );
    }
    // ---- glass on the chute floor: cavity thump, board modes, tok, the marble's tick
    for (let v = 0; v < 12; v++) {
      const r = rng(200 + v);
      const f0 = 220 + r() * 130;
      const tok = 850 + r() * 450;
      this.woodFloor.push(
        buffer(ctx, 0.4, (d, sr) => {
          pulse(d, sr, 0.9, 0.0004);
          modal(
            d,
            sr,
            [
              [95 + r() * 45, 0.9, 0.09],
              [f0, 0.8, 0.065],
              [f0 * (2.3 + r() * 0.1), 0.55, 0.042],
              [f0 * (3.7 + r() * 0.15), 0.38, 0.028],
              [f0 * (5.4 + r() * 0.2), 0.24, 0.018],
              [f0 * (7.6 + r() * 0.3), 0.14, 0.012],
              [tok, 0.75, 0.014],
              [tok * 1.85, 0.25, 0.009],
              [3800 + r() * 1400, 0.22, 0.005],
            ],
            r,
            0.0005,
          );
          burst(d, sr, 0.5, 0.0013, r, false, 0, 0.35);
        }),
      );
    }
    // ---- on a rail: thinner board, higher and drier
    for (let v = 0; v < 8; v++) {
      const r = rng(250 + v);
      const f0 = 380 + r() * 180;
      this.woodWall.push(
        buffer(ctx, 0.28, (d, sr) => {
          pulse(d, sr, 0.9, 0.0003);
          modal(
            d,
            sr,
            [
              [f0, 0.9, 0.045],
              [f0 * (2.4 + r() * 0.1), 0.6, 0.028],
              [f0 * (4.1 + r() * 0.2), 0.36, 0.016],
              [1500 + r() * 600, 0.6, 0.01],
              [4200 + r() * 1200, 0.2, 0.004],
            ],
            r,
            0.0004,
          );
          burst(d, sr, 0.55, 0.0009, r);
        }),
      );
    }
    // ---- painted blocks: temple blocks
    for (let v = 0; v < 8; v++) {
      const r = rng(300 + v);
      const f0 = 480 + r() * 340;
      this.paint.push(
        buffer(ctx, 0.3, (d, sr) => {
          pulse(d, sr, 0.8, 0.0003);
          modal(
            d,
            sr,
            [
              [f0, 1, 0.06],
              [f0 * (2.62 + r() * 0.15), 0.5, 0.03],
              [f0 * (4.8 + r() * 0.3), 0.26, 0.016],
              [3600 + r() * 900, 0.2, 0.005],
            ],
            r,
            0.0003,
          );
          burst(d, sr, 0.6, 0.0009, r);
        }),
      );
    }
    for (let v = 0; v < 4; v++) {
      const r = rng(400 + v);
      this.felt.push(
        buffer(ctx, 0.22, (d, sr) => {
          modal(d, sr, [[85 + r() * 30, 1, 0.05], [190 + r() * 40, 0.45, 0.024]], r, 0.002);
          burst(d, sr, 0.35, 0.005, r, false, 0, 0.1);
        }),
      );
    }
    // ---- bumpers: the pok, the bell, the spring
    for (let v = 0; v < 4; v++) {
      const r = rng(500 + v);
      const f = [880, 988, 1047, 1175][v];
      this.ding.push(
        buffer(ctx, 0.9, (d, sr) => {
          pulse(d, sr, 1, 0.0003);
          modal(d, sr, [[520 + r() * 80, 0.8, 0.03], [f, 1, 0.45], [f * 2.76, 0.4, 0.22], [f * 5.4, 0.18, 0.09], [f * 0.5, 0.22, 0.32]], r, 0.0006);
          for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            const fr = 240 * Math.exp(-t * 7) + 85;
            d[i] += Math.sin(2 * Math.PI * fr * t * (1 + 0.18 * Math.sin(t * 46))) * Math.exp(-t / 0.13) * 0.5;
          }
        }),
      );
    }
    // ---- a hard landing's sub thump
    {
      const r = rng(550);
      this.sub = buffer(ctx, 0.35, (d, sr) => {
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          d[i] = Math.sin(2 * Math.PI * (48 + 40 * Math.exp(-t * 30)) * t) * Math.exp(-t / 0.11) * Math.min(1, t * 400);
        }
        burst(d, sr, 0.3, 0.01, r, false, 0, 0.05);
      });
    }
    // ---- board joints under a rolling marble: tiny dry ticks
    for (let v = 0; v < 6; v++) {
      const r = rng(580 + v);
      this.tick.push(
        buffer(ctx, 0.08, (d, sr) => {
          pulse(d, sr, 0.8, 0.0002);
          modal(d, sr, [[700 + r() * 500, 0.6, 0.012], [2400 + r() * 900, 0.3, 0.005]], r, 0.0002);
        }),
      );
    }
    {
      const r = rng(600);
      this.splashB = buffer(ctx, 1.3, (d, sr) => {
        // thick paint: a deep gloop, a heavy low splash, bubbles popping after
        let lp = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const f = 330 * Math.exp(-t * 8) + 60;
          d[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.2) * 0.9;
          lp += (r() * 2 - 1 - lp) * (0.05 + 0.25 * Math.exp(-t * 9));
          d[i] += lp * Math.exp(-t / 0.35) * 1.8 * Math.min(1, t * 300);
        }
        for (let k = 0; k < 9; k++) {
          const t0 = 0.15 + r() * 0.9, f0 = 380 + r() * 900;
          for (let i = Math.floor(t0 * sr); i < d.length; i++) {
            const t = i / sr - t0;
            if (t > 0.07) break;
            d[i] += Math.sin(2 * Math.PI * f0 * (1 + t * 14) * t) * Math.exp(-t / 0.02) * 0.28;
          }
        }
      });
      for (const [seed, grain, cav] of [
        [700, 150, 0.985],
        [710, 60, 0.97],
      ] as const) {
        const rr = rng(seed);
        this.rollB.push(
          buffer(ctx, 3, (d, sr) => {
            // brown rumble plus the grain: a stream of tiny wooden knocks
            let br = 0;
            for (let i = 0; i < d.length; i++) {
              br = br * cav + (rr() * 2 - 1) * 0.12;
              d[i] = br;
            }
            const n = 3 * grain;
            for (let k = 0; k < n; k++) {
              const i0 = Math.floor(rr() * d.length);
              const f = 260 + rr() * 560, a = Math.pow(rr(), 3) * 0.55;
              const w = (2 * Math.PI * f) / sr;
              for (let j = 0; j < sr * 0.012; j++) d[(i0 + j) % d.length] += Math.sin(w * j) * a * Math.exp(-j / (sr * 0.003));
            }
            const fade = Math.floor(sr * 0.05);
            for (let i = 0; i < fade; i++) {
              const k = i / fade;
              d[i] = d[i] * k + d[d.length - fade + i] * (1 - k);
            }
          }),
        );
      }
      this.windB = buffer(ctx, 2, (d) => {
        for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
      });
      // the crowd is slow to synthesise: baked a buffer per task after the rest (mono, then widened)
      const crowd = (dur: number, env: (t: number) => number, vowel: (t: number) => number, voices: number, seed: number, claps = 0) =>
        buffer(
          ctx,
          dur,
          (d, sr, c) => {
            if (c === 1) return;
            const rr = rng(seed);
            for (let v = 0; v < voices; v++) {
              // a voice: a buzzy glottal tone through one moving formant
              const f0 = 110 + rr() * 170, jit = rr() * 6, ph = rr() * 6, del = rr() * 0.25;
              let y1 = 0, y2 = 0, phase = 0;
              for (let i = 0; i < d.length; i++) {
                const t = i / sr - del;
                if (t < 0) continue;
                const e = env(t) * (0.7 + 0.3 * Math.sin(t * (2 + jit) + ph));
                if (e < 1e-4) continue;
                phase += (f0 * (1 + 0.04 * Math.sin(t * 5 + ph)) * (0.9 + 0.2 * vowel(t))) / sr;
                const src = (phase % 1) * 2 - 1;
                // a resonator at the formant
                const fc = 350 + 650 * vowel(t), q = 6;
                const w = (2 * Math.PI * fc) / sr, rad = Math.exp(-w / (2 * q));
                const y = src * (1 - rad) + 2 * rad * Math.cos(w) * y1 - rad * rad * y2;
                y2 = y1;
                y1 = y;
                d[i] += y * e * 0.4;
              }
            }
            for (let k = 0; k < claps; k++) {
              const t0 = rr() * dur * 0.8;
              for (let j = 0; j < sr * 0.02; j++) {
                const i = Math.floor(t0 * sr) + j;
                if (i >= d.length) break;
                d[i] += (rr() * 2 - 1) * Math.exp(-j / (sr * 0.004)) * 0.5;
              }
            }
          },
          2,
        );
      const widen = (b: AudioBuffer) => {
        // the right channel: the left 11 ms later (a wide crowd from one take)
        const l = b.getChannelData(0), rt = b.getChannelData(1), o = Math.floor(b.sampleRate * 0.011);
        for (let i = 0; i < rt.length; i++) rt[i] = l[Math.max(0, i - o)];
        return b;
      };
      const jobs: (() => void)[] = [
        () => (this.oohB = widen(crowd(1.8, (t) => Math.min(1, t * 5) * Math.exp(-Math.max(0, t - 0.6) * 2.5), (t) => 0.15 + 0.25 * Math.min(1, t * 2), 14, 920))),
        () => (this.awwB = widen(crowd(1.8, (t) => Math.min(1, t * 6) * Math.exp(-Math.max(0, t - 0.4) * 2.2), (t) => 0.7 - 0.45 * Math.min(1, t), 14, 940))),
        () => (this.cheerB = widen(crowd(3.4, (t) => Math.min(1, t * 4) * Math.exp(-Math.max(0, t - 1.4) * 1.3), (t) => 0.75 + 0.2 * Math.sin(t * 9), 16, 900, 110))),
        () => (this.murmurB = widen(crowd(6, () => 0.5, (t) => 0.45 + 0.3 * Math.sin(t * 1.7), 10, 960, 6))),
      ];
      const run = () => {
        const j = jobs.shift();
        if (!j) return;
        j();
        setTimeout(run, 30);
      };
      setTimeout(run, 50);
      this.popB = buffer(ctx, 0.5, (d, sr) => {
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          d[i] += Math.sin(2 * Math.PI * (500 + 900 * Math.min(1, t * 12)) * t) * Math.exp(-t / 0.05) * 0.7;
        }
        for (let k = 0; k < 7; k++) modal(d, sr, [[2200 + r() * 3000, 0.25, 0.08]], r, 0.001, 0.02 + k * 0.035);
      });
      this.whooshB = buffer(ctx, 0.5, (d, sr) => {
        let lp = 0, bp = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const fc = 0.02 + 0.25 * Math.sin(Math.min(1, t / 0.4) * Math.PI);
          lp += (r() * 2 - 1 - lp) * fc;
          bp += (lp - bp) * fc * 0.5;
          d[i] = (lp - bp) * Math.sin(Math.min(1, t / 0.45) * Math.PI) ** 1.5;
        }
      });
    }
  }

  private spatial(x: number, y: number, z: number) {
    const dx = x - this.cam.x, dy = y - this.cam.y, dz = z - this.cam.z;
    const d = Math.hypot(dx, dy, dz);
    const pan = d > 0.01 ? THREE.MathUtils.clamp((dx * this.right.x + dy * this.right.y + dz * this.right.z) / d, -1, 1) * 0.85 : 0;
    const g = 1 / (1 + Math.pow(d / 7, 1.35));
    return { pan, g, d };
  }

  private play(buf: AudioBuffer | null, gain: number, pan: number, rate = 1, wet = 0.25, lowpass = 0, when = 0) {
    const ctx = this.ctx;
    if (!ctx || !buf || !this.sfxOn || gain < 0.004) return;
    if (this.voices > 48) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    let head: AudioNode = src;
    if (lowpass > 0 && lowpass < 16000) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      f.Q.value = 0.5;
      src.connect(f);
      head = f;
    }
    head.connect(g).connect(p).connect(this.sfx);
    if (wet > 0) {
      const w = ctx.createGain();
      w.gain.value = wet;
      p.connect(w).connect(this.wet);
    }
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
    };
    src.start(ctx.currentTime + when);
  }

  /** each marble's own glass: a fixed pitch for its clacks */
  private voiceOf(m: { id: number } | undefined) {
    if (!m) return 1;
    return 0.9 + ((m.id * 0.618) % 1) * 0.22;
  }

  private bakeVoices(ctx: AudioContext) {
    const env = (a: number, rel: number) => (t: number) => Math.min(1, t / a) * Math.pow(Math.max(0, 1 - t), rel);
    const mk = (dur: number, f0: (t: number) => number, vowels: string[], e: (t: number) => number, seed: number, breath = 0.08) =>
      buffer(ctx, dur, (d, sr) => vox(d, sr, f0, vowels, e, rng(seed), breath), 1, 0.8);
    const set = (k: string, ...b: AudioBuffer[]) => this.vox.set(k, b);
    set('hup', mk(0.15, (t) => 470 + 90 * t, ['u', 'a'], env(0.08, 1.4), 1), mk(0.13, (t) => 520 + 60 * t, ['e', 'a'], env(0.08, 1.6), 2), mk(0.16, (t) => 430 + 120 * t, ['o', 'a'], env(0.1, 1.3), 3));
    set('hyah', mk(0.3, (t) => 560 - 120 * t, ['i', 'a', 'a'], env(0.06, 1.2), 4), mk(0.28, (t) => 600 - 160 * t, ['e', 'a'], env(0.05, 1.1), 5));
    set('oof', mk(0.24, (t) => 380 - 150 * t, ['u', 'o'], env(0.04, 1.8), 6, 0.2), mk(0.2, (t) => 420 - 170 * t, ['o', 'u'], env(0.03, 2), 7, 0.25));
    set('wah', mk(1.15, (t) => 640 - 380 * t + Math.sin(t * 50) * 22, ['a', 'a', 'o', 'u'], env(0.05, 0.7), 8), mk(1.0, (t) => 700 - 420 * t + Math.sin(t * 44) * 26, ['o', 'a', 'o'], env(0.04, 0.8), 9));
    set('yay', mk(0.6, (t) => 460 + 300 * Math.min(1, t * 1.6), ['e', 'a', 'i'], env(0.05, 0.9), 10), mk(0.5, (t) => 500 + 260 * Math.min(1, t * 1.8), ['i', 'a', 'e'], env(0.05, 1), 11));
    set('heh', mk(0.17, (t) => 520 - 40 * t, ['e', 'e'], (t) => Math.min(1, t / 0.05) * (t < 0.45 ? 1 : t < 0.55 ? 0.15 : 1) * (1 - t), 12, 0.15));
    set('aww', mk(0.8, (t) => 470 - 200 * t, ['a', 'o', 'u'], env(0.1, 0.8), 13));
    // a soft rubber footfall: a thump and a squeak of the sole
    for (let v = 0; v < 6; v++) {
      const r = rng(300 + v);
      this.stepB.push(
        buffer(ctx, 0.09, (d, sr) => {
          const f = 90 + r() * 40, sq = 900 + r() * 700;
          for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            d[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 60) * 0.9 + (r() * 2 - 1) * Math.exp(-t * 140) * 0.35 + Math.sin(2 * Math.PI * sq * t) * Math.exp(-t * 90) * 0.12;
          }
        }),
      );
    }
  }

  /** a bean says something; each bean's voice has its own pitch */
  voice(kind: string, id: number, x: number, y: number, z: number, mine = false) {
    const b = this.vox.get(kind);
    if (!b || !this.ctx) return;
    const { pan, g } = this.spatial(x, y, z);
    const lvl = mine ? 0.42 : Math.min(0.35, g * 0.8);
    if (lvl < 0.02) return;
    const rate = 0.84 + ((id * 0.618) % 1) * 0.42 + (Math.random() - 0.5) * 0.05;
    this.play(b[(Math.random() * b.length) | 0], lvl, mine ? pan * 0.3 : pan, rate, 0.18);
  }

  /** a footfall */
  step(x: number, y: number, z: number, mine: boolean, mat: Mat) {
    const { pan, g } = this.spatial(x, y, z);
    const lvl = (mine ? 0.2 : g * 0.22) * (mat === Mat.Paint ? 0.8 : 1);
    if (lvl < 0.015) return;
    this.play(this.stepB[(Math.random() * this.stepB.length) | 0], lvl, pan, 0.85 + Math.random() * 0.3, 0.06, mat === Mat.Paint ? 1800 : 3500);
  }

  /** the physics' contacts this frame */
  hits(list: Hit[], player: unknown) {
    if (!this.ctx) return;
    const sorted = list.length > 12 ? [...list].sort((a, b) => b.speed - a.speed) : list;
    for (const h of sorted) {
      const { pan, g } = this.spatial(h.x, h.y, h.z);
      const mine = h.a === player || h.b === player;
      const near = mine ? Math.max(g, 0.6) : g;
      const v = h.speed;
      if (h.kind === 'glass') {
        // bean on bean: a squashy bump
        const k = THREE.MathUtils.clamp((v - 1) / 9, 0, 1);
        this.play(this.felt[(Math.random() * this.felt.length) | 0], k * near * 0.9, pan, 0.7 + Math.random() * 0.2, 0.15, 1400 + k * 2000);
        if (v > 4) this.play(this.sub, k * near * 0.6, pan * 0.5, 1.3 + Math.random() * 0.3, 0.05);
        continue;
      }
      if (h.kind === ('marble' as string)) {
        const k = THREE.MathUtils.clamp((v - 0.3) / 9, 0, 1);
        const amp = Math.pow(k, 0.85) * 0.95 * near;
        const buf = this.glass[(Math.random() * this.glass.length) | 0];
        // the pair's glass sets the pitch; a soft touch is darker, a hard hit opens right up
        const rate = (this.voiceOf(h.a) + this.voiceOf(h.b)) / 2 - Math.min(0.06, v * 0.005) + (Math.random() - 0.5) * 0.03;
        this.play(buf, amp, pan, rate, 0.32, 2500 + k * 16000);
        // (a hard hit chatters as they bounce apart)
        if (v > 5 && Math.random() < 0.45) this.play(this.glass[(Math.random() * this.glass.length) | 0], amp * 0.3, pan, rate * 1.03, 0.2, 6000, 0.004 + Math.random() * 0.006);
        continue;
      }
      const k = THREE.MathUtils.clamp((v - 0.6) / 11, 0, 1);
      const amp = k * near;
      if (h.mat === Mat.Bumper) {
        this.play(this.ding[(Math.random() * this.ding.length) | 0], Math.max(0.4, amp) * near * 1.1, pan, 1, 0.45);
        continue;
      }
      const floor = h.ny > 0.6;
      const bank = h.mat === Mat.Paint ? this.paint : h.mat === Mat.Felt ? this.felt : floor ? this.woodFloor : this.woodWall;
      const buf = bank[(Math.random() * bank.length) | 0];
      this.play(buf, amp * 1.1, pan, 0.95 + Math.random() * 0.1 - (v > 9 ? 0.06 : 0), 0.3, 900 + v * 900);
      if (v > 7 && floor) this.play(this.sub, Math.min(1, (v - 7) / 8) * near * 0.9, pan * 0.5, 0.9 + Math.random() * 0.2, 0.1);
    }
  }

  /** the rolling voices: the nearest rolling marbles (and always the one followed) */
  rolling(list: { key: unknown; x: number; y: number; z: number; speed: number; on: boolean; mat: Mat }[], focus: unknown, dt: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.rolls.length < 6) {
      const src = ctx.createBufferSource();
      src.buffer = this.rollB[this.rolls.length % 2];
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 0.8;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      src.connect(f).connect(lp).connect(g).connect(p).connect(this.sfx);
      src.start(0, Math.random() * 2.5);
      this.rolls.push({ src, f, lp, g, p });
    }
    const t = ctx.currentTime;
    const score = (e: { m: { key: unknown; on: boolean; speed: number }; sp: { g: number } }) => (e.m.key === focus ? 1e9 : e.sp.g * (e.m.on ? e.m.speed : 0));
    const scored = list
      .map((m) => ({ m, sp: this.spatial(m.x, m.y, m.z) }))
      .sort((a, b) => score(b) - score(a))
      .slice(0, this.rolls.length);
    for (let k = 0; k < this.rolls.length; k++) {
      const v = this.rolls[k];
      const e = scored[k];
      if (!e || !e.m.on || !this.sfxOn) {
        v.g.gain.setTargetAtTime(0, t, 0.05);
        continue;
      }
      const sp = e.m.speed;
      const paint = e.m.mat === Mat.Paint;
      const mine = e.m.key === focus;
      const lvl = Math.pow(THREE.MathUtils.clamp(sp / 16, 0, 1.4), 1.1) * (mine ? 0.62 : 0.5) * Math.max(e.sp.g, mine ? 0.55 : 0);
      v.g.gain.setTargetAtTime(lvl, t, 0.04);
      v.f.frequency.setTargetAtTime((paint ? 330 : 160) + sp * 30, t, 0.05);
      v.lp.frequency.setTargetAtTime(900 + sp * 120, t, 0.05);
      v.src.playbackRate.setTargetAtTime(0.5 + Math.min(1.6, sp * 0.05), t, 0.05);
      v.p.pan.setTargetAtTime(e.sp.pan, t, 0.05);
      // the board joints ticking past under your own marble
      if (mine && !paint && sp > 2) {
        this.seamAcc += sp * dt;
        if (this.seamAcc > this.seamNext) {
          this.seamAcc = 0;
          this.seamNext = 0.6 + Math.random() * 1.6;
          this.play(this.tick[(Math.random() * this.tick.length) | 0], Math.min(0.22, sp * 0.012), e.sp.pan, 0.9 + Math.random() * 0.25, 0.1, 1500 + sp * 300);
        }
      }
    }
  }

  /** air past the camera at speed */
  windAt(speed: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.wind) {
      const src = ctx.createBufferSource();
      src.buffer = this.windB;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.sfx);
      src.start();
      this.wind = { g, f };
    }
    const t = ctx.currentTime;
    this.wind.g.gain.setTargetAtTime(this.sfxOn ? Math.pow(THREE.MathUtils.clamp((speed - 6) / 22, 0, 1), 2) * 0.13 : 0, t, 0.2);
    this.wind.f.frequency.setTargetAtTime(400 + speed * 35, t, 0.2);
  }

  /** the crowd's murmur under a round */
  crowd(on: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.murmur) {
      if (!this.murmurB) return;
      const src = ctx.createBufferSource();
      src.buffer = this.murmurB;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      this.murmur = ctx.createGain();
      this.murmur.gain.value = 0;
      src.connect(lp).connect(this.murmur).connect(this.sfx);
      src.start();
    }
    this.murmur.gain.setTargetAtTime(on && this.sfxOn ? 0.07 : 0, ctx.currentTime, 0.8);
  }

  splash(x: number, y: number, z: number) {
    const { pan, g } = this.spatial(x, y, z);
    this.play(this.splashB, Math.max(0.25, g * 2.2), pan, 0.85 + Math.random() * 0.25, 0.35);
  }

  /** the player went over the edge */
  ooh() {
    this.play(this.oohB, 0.42, 0, 0.95 + Math.random() * 0.1, 0.3);
  }

  /** back on the course */
  respawn() {
    this.play(this.popB, 0.35, 0, 1, 0.3);
  }

  /** a hop off the ground (a soft knock and a little air), a dash (a whoosh) */
  hop(x: number, y: number, z: number, mat: Mat) {
    const { pan, g } = this.spatial(x, y, z);
    const bank = mat === Mat.Paint ? this.paint : this.woodFloor;
    this.play(bank[(Math.random() * bank.length) | 0], 0.3 * Math.max(g, 0.5), pan, 1.2, 0.2, 2400);
    this.play(this.whooshB, 0.12 * Math.max(g, 0.5), pan, 1.6, 0.05);
  }
  dash(x: number, y: number, z: number) {
    const { pan, g } = this.spatial(x, y, z);
    this.play(this.whooshB, 0.55 * Math.max(g, 0.5), pan, 1 + Math.random() * 0.15, 0.15);
    this.play(this.tick[(Math.random() * this.tick.length) | 0], 0.25 * Math.max(g, 0.5), pan, 0.7, 0.1);
  }

  cheer(level = 1) {
    this.play(this.cheerB, 0.5 * level, 0, 0.97 + Math.random() * 0.06, 0.2);
  }

  /** marimba (and glockenspiel) notes for the UI: midi numbers, seconds apart */
  notes(midis: number[], gap = 0.09, vel = 0.5, glock = false) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const t = ctx.currentTime + 0.01;
    midis.forEach((m, k) => {
      marimba(ctx, this.sfx, t + k * gap, m, vel);
      if (glock) glockenspiel(ctx, this.sfx, t + k * gap, m + 12, vel * 0.35);
    });
  }
  private duckFor(sec: number, depth = 0.35) {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.duck.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(depth, t, 0.03);
    g.setTargetAtTime(1, t + sec, 0.4);
  }
  countdown(n: number) {
    if (n > 0) this.notes([72], 0, 0.6, true);
    else {
      this.notes([72, 76, 79, 84], 0.0, 0.5, true);
      this.play(this.whooshB, 0.3, 0, 0.8, 0.2);
      this.cheer(0.5);
    }
  }
  qualified() {
    this.duckFor(2.4);
    this.notes([72, 76, 79, 84, 88, 91], 0.075, 0.55, true);
    setTimeout(() => this.cheer(1.1), 120);
  }
  eliminated() {
    this.duckFor(2.4, 0.2);
    this.notes([67, 63, 60, 55], 0.24, 0.5);
    const ctx = this.ctx;
    if (ctx && this.sfxOn) {
      // the womp: a falling sawtooth through a closing filter
      const t = ctx.currentTime + 0.9;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.7);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(1600, t);
      f.frequency.exponentialRampToValueAtTime(200, t + 0.7);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.25, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      o.connect(f).connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 0.85);
    }
    setTimeout(() => this.play(this.awwB, 0.45, 0, 1, 0.3), 300);
  }
  crowned() {
    this.duckFor(4, 0.15);
    this.notes([60, 64, 67, 72, 67, 72, 76, 79, 84], 0.11, 0.55, true);
    const ctx = this.ctx;
    if (ctx && this.sfxOn) brass(ctx, this.sfx, ctx.currentTime + 1.05, [60, 64, 67, 72], 1.6);
    setTimeout(() => this.cheer(1.3), 200);
    setTimeout(() => this.cheer(0.9), 1900);
  }
  click() {
    this.notes([84], 0, 0.25);
  }

  /** a firework bursting `d` metres off: the thump (later the further it is), the long roll, a crackle */
  boom(x: number, y: number, z: number) {
    const { pan, d } = this.spatial(x, y, z);
    const when = Math.min(0.6, d / 340);
    const g = THREE.MathUtils.clamp(60 / Math.max(d, 30), 0.2, 1);
    this.play(this.sub, 0.9 * g, pan * 0.5, 0.42 + Math.random() * 0.08, 0.7, 500, when);
    this.play(this.whooshB, 0.35 * g, pan * 0.5, 0.32, 0.8, 900, when);
    for (let k = 0; k < 9; k++) this.play(this.tick[(Math.random() * this.tick.length) | 0], 0.12 * g, pan * 0.6 + (Math.random() - 0.5) * 0.4, 1.4 + Math.random(), 0.5, 0, when + 0.5 + Math.random() * 0.9);
  }

  /** a bet placed (a chip down on the felt), and money paid out (a run of bright coins) */
  chip() {
    this.play(this.tick[(Math.random() * this.tick.length) | 0], 0.5, 0, 0.55, 0.1);
    this.play(this.tick[(Math.random() * this.tick.length) | 0], 0.35, 0, 0.8, 0.1, 0, 0.035);
  }
  coins(n = 12) {
    for (let k = 0; k < n; k++) this.play(this.tick[(Math.random() * this.tick.length) | 0], 0.3, (Math.random() - 0.5) * 0.8, 2.2 + Math.random() * 0.8, 0.2, 0, k * 0.045 + Math.random() * 0.03);
    this.notes([84, 88, 91, 96], 0.06, 0.4, true);
  }

  setMusic(mode: 'off' | 'menu' | 'play' | 'calm') {
    if (!this.music) return;
    this.music.mode(this.musicOn ? mode : 'off');
  }
  /** 0..1: how hot the round is (adds layers) */
  setHeat(k: number) {
    this.music?.heat(k);
  }
  /** a new key for a new round */
  setKey(round: number) {
    this.music?.key([0, 2, -3, 5, 7, -1][round % 6]);
  }
}

/** a marimba bar: fundamental, the 4th partial (tuned 1:4:10) and a woody attack */
function marimba(ctx: AudioContext, out: AudioNode, t: number, midi: number, vel: number, dur = 0.6) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur * (midi < 55 ? 1.4 : 1));
  g.connect(out);
  const parts: [number, number, number][] = [
    [1, 1, dur],
    [4, 0.35, 0.12],
    [10, 0.18, 0.04],
  ];
  for (const [m, a, d] of parts) {
    const o = ctx.createOscillator();
    o.frequency.value = f * m;
    const gg = ctx.createGain();
    gg.gain.setValueAtTime(a, t);
    gg.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(gg).connect(g);
    o.start(t);
    o.stop(t + dur * 1.5);
    o.onended = () => gg.disconnect();
  }
}

/** a glockenspiel: bright, ringing, inharmonic */
function glockenspiel(ctx: AudioContext, out: AudioNode, t: number, midi: number, vel: number) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  for (const [m, a, d] of [
    [1, 1, 1.2],
    [2.76, 0.4, 0.5],
    [5.4, 0.2, 0.2],
  ] as [number, number, number][]) {
    const o = ctx.createOscillator();
    o.frequency.value = f * m;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * a, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + d + 0.05);
    o.onended = () => g.disconnect();
  }
}

/** a brass chord swell (the crown) */
function brass(ctx: AudioContext, out: AudioNode, t: number, midis: number[], dur: number) {
  for (const m of midis) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
      o.detune.value = det;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(400, t);
      f.frequency.linearRampToValueAtTime(2600, t + 0.15);
      f.frequency.linearRampToValueAtTime(1200, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.06);
      g.gain.setValueAtTime(0.06, t + dur - 0.3);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(f).connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
}

/**
 * The show's music: a bouncy marimba tune over a plucked bass, a kit, a shaker and a wood block,
 * a 16-bar form (I–vi–IV–V twice, then IV–V–iii–vi into IV–V and home), 128 bpm, scheduled ahead
 * on the audio clock. Heat adds a glockenspiel answer, extra stabs and busier drums; each round has
 * its own key.
 */
class Music {
  private timer = 0;
  private step = 0;
  private next = 0;
  private m: 'off' | 'menu' | 'play' | 'calm' = 'off';
  private bus: GainNode;
  private noise: AudioBuffer;
  private h = 0;
  private tr = 0;
  constructor(
    private ctx: AudioContext,
    out: GainNode,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(out);
    const r = rng(9);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  }
  heat(k: number) {
    this.h = THREE.MathUtils.clamp(k, 0, 1);
  }
  key(semis: number) {
    this.tr = semis;
  }
  mode(m: 'off' | 'menu' | 'play' | 'calm') {
    if (m === this.m) return;
    this.m = m;
    const t = this.ctx.currentTime;
    this.bus.gain.setTargetAtTime(m === 'off' ? 0 : m === 'calm' ? 0.55 : m === 'menu' ? 0.85 : 1, t, 0.4);
    if (m !== 'off' && !this.timer) {
      this.next = t + 0.1;
      this.timer = window.setInterval(() => this.tick(), 25);
    }
    if (m === 'off' && this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }
  private tick() {
    const spb = 60 / 128 / 4;
    while (this.next < this.ctx.currentTime + 0.12) {
      this.note(this.step, this.next);
      this.step++;
      this.next += spb;
    }
  }
  private note(step: number, t: number) {
    const SCALE = [0, 2, 4, 5, 7, 9, 11];
    const bar = Math.floor(step / 16) % 16;
    const s = step % 16;
    const prog = [0, 5, 3, 4, 0, 5, 3, 4, 3, 4, 2, 5, 3, 4, 0, 4];
    const chord = prog[bar];
    const deg = (d: number, oct: number) => 60 + this.tr + 12 * oct + SCALE[(((chord + d) % 7) + 7) % 7] + 12 * Math.floor((chord + d) / 7);
    const calm = this.m === 'calm';
    const hot = this.m === 'play' ? this.h : 0;
    const A = [0, -1, 2, -1, 4, -1, 2, 4, 5, -1, 4, -1, 2, -1, -1, -1];
    const B = [4, -1, 4, 5, 7, -1, 4, -1, 2, -1, 4, 2, 0, -1, -1, -1];
    const C = [7, -1, 6, -1, 4, -1, 2, -1, 4, 5, 4, 2, 1, -1, -1, -1];
    const D = [2, 4, 5, 7, -1, 7, 5, 4, 2, -1, 0, -1, 2, 4, 2, -1];
    const mel = bar >= 8 ? (bar % 2 ? C : D) : bar % 4 === 3 ? C : bar % 2 ? B : A;
    if (mel[s] >= 0 && (!calm || s % 4 === 0)) marimba(this.ctx, this.bus, t, deg(mel[s], 1), 0.22);
    // the glockenspiel answers when it's hot
    if (hot > 0.35 && s % 4 === 2 && bar % 2 === 1) glockenspiel(this.ctx, this.bus, t, deg([4, 2, 5, 7][(s >> 2) % 4], 2), 0.06 + hot * 0.04);
    if (!calm && (s === 2 || s === 10 || (hot > 0.6 && (s === 6 || s === 14)))) for (const d of [0, 2, 4]) marimba(this.ctx, this.bus, t, deg(d, 0), 0.07, 0.25);
    if (s === 0 || s === 6 || s === 8 || s === 14 || (hot > 0.5 && s === 11)) this.bass(t, deg(0, -2) + (s === 14 ? 7 : 0));
    if (calm) return;
    if (s === 0 || s === 8 || (s === 10 && bar % 2) || (hot > 0.7 && s === 14)) this.kick(t);
    if (s === 4 || s === 12) this.clap(t);
    // a fill into every fourth bar
    if (bar % 4 === 3 && s >= 12) this.block(t, 900 + (s - 12) * 120);
    this.hat(t, s % 2 ? 0.022 + hot * 0.015 : 0.042);
    if (hot > 0.3 && s % 2 === 1) this.shaker(t, 0.03 * hot);
    if (s === 3 || s === 11 || (s === 15 && bar % 2)) this.block(t, 1050);
  }
  private bass(t: number, midi: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = o.frequency.value;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.45, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g).connect(this.bus);
    for (const x of [o, o2]) {
      x.start(t);
      x.stop(t + 0.32);
    }
  }
  private kick(t: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.26);
  }
  private noiseHit(t: number, type: BiquadFilterType, f: number, q: number, gain: number, dur: number) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(fl).connect(g).connect(this.bus);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }
  private clap(t: number) {
    for (let k = 0; k < 3; k++) this.noiseHit(t + k * 0.011, 'bandpass', 1500, 0.9, 0.3, 0.09 + k * 0.03);
  }
  private hat(t: number, g: number) {
    this.noiseHit(t, 'highpass', 7000, 0.7, g, 0.04);
  }
  private shaker(t: number, g: number) {
    this.noiseHit(t, 'bandpass', 5200, 1.5, g, 0.06);
  }
  private block(t: number, f: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.08);
  }
}
