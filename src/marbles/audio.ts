import * as THREE from 'three';
import { Mat, type Hit } from './physics.ts';

/**
 * Every sound is synthesised here (no sample files):
 *  - glass on glass: a modal "clack" — five inharmonic modes of a glass sphere around 3–4 kHz that
 *    die in tens of milliseconds, a sharp contact click and a little body; harder hits ring brighter.
 *  - glass on the wooden chute: a hollow "tock" (the board's low modes plus the box resonance) with
 *    the marble's own glassy tick on top; painted blocks knock higher and harder, like a temple block.
 *  - rolling: a grainy rumble per marble (brown noise and the tiny knocks of the grain), pitched and
 *    filtered by speed; the nearest marbles get a voice each.
 *  - bumpers ding, the paint lake gloops, the countdown and the music are marimba.
 * Hits are placed in stereo and fade with distance from the camera; a small room adds air.
 */

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function buffer(ctx: BaseAudioContext, dur: number, f: (data: Float32Array, sr: number) => void, ch = 1) {
  const sr = ctx.sampleRate;
  const n = Math.ceil(dur * sr);
  const b = ctx.createBuffer(ch, n, sr);
  for (let c = 0; c < ch; c++) f(b.getChannelData(c), sr);
  // (a short fade at the end: a ring cut off mid-decay clicks)
  const tail = Math.min(n >> 2, Math.floor(sr * 0.04));
  for (let c = 0; c < ch; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < tail; i++) d[n - 1 - i] *= i / tail;
  }
  // normalise to a peak of 0.9
  let pk = 0;
  for (let c = 0; c < ch; c++) for (const v of b.getChannelData(c)) pk = Math.max(pk, Math.abs(v));
  if (pk > 0) for (let c = 0; c < ch; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= 0.9 / pk;
  }
  return b;
}

/** a sum of damped sinusoids: modes [freq, amp, decay s] */
function modal(d: Float32Array, sr: number, modes: [number, number, number][], r: () => number, attack = 0.0004) {
  for (const [f, a, tau] of modes) {
    const ph = r() * Math.PI * 2;
    const w = (2 * Math.PI * f) / sr;
    const k = Math.exp(-1 / (tau * sr));
    let env = a;
    for (let i = 0; i < d.length; i++) {
      const atk = Math.min(1, i / (attack * sr));
      d[i] += Math.sin(w * i + ph) * env * atk;
      env *= k;
      if (env < 1e-5) break;
    }
  }
}

function click(d: Float32Array, sr: number, amp: number, tau: number, r: () => number, hp = true) {
  let prev = 0, lp = 0;
  const k = Math.exp(-1 / (tau * sr));
  let env = amp;
  for (let i = 0; i < d.length && env > 1e-5; i++) {
    const n = r() * 2 - 1;
    const v = hp ? n - prev : (lp += (n - lp) * 0.25);
    prev = n;
    d[i] += v * env;
    env *= k;
  }
}

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private wet!: GainNode;
  private glass: AudioBuffer[] = [];
  private wood: AudioBuffer[] = [];
  private paint: AudioBuffer[] = [];
  private felt: AudioBuffer[] = [];
  private ding: AudioBuffer[] = [];
  private splashB!: AudioBuffer;
  private rollB!: AudioBuffer;
  private windB!: AudioBuffer;
  private cheerB!: AudioBuffer;
  private voices = 0;
  private rolls: { src: AudioBufferSourceNode; f: BiquadFilterNode; g: GainNode; p: StereoPannerNode; key: unknown }[] = [];
  private wind: { g: GainNode; f: BiquadFilterNode } | null = null;
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
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.32;
    this.musicBus.connect(this.master);
    // a small, bright room
    const conv = ctx.createConvolver();
    conv.buffer = buffer(
      ctx,
      0.9,
      (d, sr) => {
        const r = rng(d.length);
        for (let i = 0; i < d.length; i++) d[i] = (r() * 2 - 1) * Math.exp(-i / (0.16 * sr)) * (i < sr * 0.004 ? 0 : 1);
      },
      2,
    );
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.16;
    this.wet.connect(conv).connect(this.master);
    this.bake();
    this.music = new Music(ctx, this.musicBus);
  }

  private bake() {
    const ctx = this.ctx!;
    for (let v = 0; v < 10; v++) {
      const r = rng(100 + v);
      const f0 = 2900 + r() * 1300;
      const k = 0.85 + r() * 0.4;
      this.glass.push(
        buffer(ctx, 0.12, (d, sr) => {
          modal(
            d,
            sr,
            [
              [f0, 1, 0.03 * k],
              [f0 * (1.51 + r() * 0.05), 0.55, 0.022 * k],
              [f0 * (2.24 + r() * 0.06), 0.36, 0.015 * k],
              [f0 * (2.93 + r() * 0.07), 0.22, 0.011 * k],
              [f0 * (3.68 + r() * 0.08), 0.13, 0.008 * k],
              [650 + r() * 200, 0.3, 0.006],
            ],
            r,
            0.0002,
          );
          click(d, sr, 0.9, 0.0009, r);
        }),
      );
    }
    for (let v = 0; v < 10; v++) {
      const r = rng(200 + v);
      const f0 = 185 + r() * 140;
      const tok = 900 + r() * 500;
      this.wood.push(
        buffer(ctx, 0.36, (d, sr) => {
          modal(
            d,
            sr,
            [
              [f0, 1, 0.075],
              [f0 * (2.2 + r() * 0.1), 0.62, 0.045],
              [f0 * (3.55 + r() * 0.15), 0.42, 0.03],
              [f0 * (5.3 + r() * 0.2), 0.26, 0.02],
              [tok, 0.9, 0.016],
              [tok * 1.9, 0.3, 0.01],
              [4600 + r() * 1400, 0.12, 0.007],
            ],
            r,
            0.0006,
          );
          click(d, sr, 0.55, 0.0016, r, false);
        }),
      );
    }
    for (let v = 0; v < 8; v++) {
      const r = rng(300 + v);
      const f0 = 420 + r() * 260;
      this.paint.push(
        buffer(ctx, 0.26, (d, sr) => {
          modal(
            d,
            sr,
            [
              [f0, 1, 0.05],
              [f0 * (2.7 + r() * 0.2), 0.55, 0.025],
              [f0 * (4.9 + r() * 0.3), 0.3, 0.014],
              [3800 + r() * 900, 0.18, 0.006],
            ],
            r,
            0.0004,
          );
          click(d, sr, 0.7, 0.0011, r);
        }),
      );
    }
    for (let v = 0; v < 4; v++) {
      const r = rng(400 + v);
      this.felt.push(
        buffer(ctx, 0.22, (d, sr) => {
          modal(d, sr, [[95 + r() * 30, 1, 0.04], [210 + r() * 40, 0.4, 0.02]], r, 0.002);
          click(d, sr, 0.3, 0.004, r, false);
        }),
      );
    }
    for (let v = 0; v < 4; v++) {
      const r = rng(500 + v);
      const f = [880, 988, 1047, 1175][v];
      this.ding.push(
        buffer(ctx, 0.8, (d, sr) => {
          modal(d, sr, [[f, 1, 0.42], [f * 2.76, 0.42, 0.22], [f * 5.4, 0.2, 0.09], [f * 0.5, 0.25, 0.3]], r, 0.0008);
          // the spring's boing under it
          for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            const fr = 230 * Math.exp(-t * 6) + 90;
            d[i] += Math.sin(2 * Math.PI * fr * t * (1 + 0.15 * Math.sin(t * 40))) * Math.exp(-t / 0.12) * 0.55;
          }
          click(d, sr, 0.6, 0.001, r);
        }),
      );
    }
    {
      const r = rng(600);
      this.splashB = buffer(ctx, 1.1, (d, sr) => {
        // a heavy gloop: a falling bubble tone over a thick, low-passed splash
        let lp = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const f = 380 * Math.exp(-t * 7) + 70;
          d[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.18) * 0.8;
          lp += (r() * 2 - 1 - lp) * (0.08 + 0.3 * Math.exp(-t * 8));
          d[i] += lp * Math.exp(-t / 0.3) * 1.6 * Math.min(1, t * 200);
        }
        for (let k = 0; k < 6; k++) {
          const t0 = 0.12 + r() * 0.6, f0 = 500 + r() * 700;
          for (let i = Math.floor(t0 * sr); i < d.length; i++) {
            const t = i / sr - t0;
            if (t > 0.08) break;
            d[i] += Math.sin(2 * Math.PI * f0 * (1 + t * 12) * t) * Math.exp(-t / 0.025) * 0.25;
          }
        }
      });
    }
    {
      const r = rng(700);
      this.rollB = buffer(ctx, 3, (d, sr) => {
        // brown rumble plus the grain: a stream of tiny wooden knocks
        let br = 0;
        for (let i = 0; i < d.length; i++) {
          br = br * 0.985 + (r() * 2 - 1) * 0.12;
          d[i] = br;
        }
        const n = 3 * 140;
        for (let k = 0; k < n; k++) {
          const i0 = Math.floor(r() * d.length);
          const f = 280 + r() * 520, a = Math.pow(r(), 3) * 0.6;
          const w = (2 * Math.PI * f) / sr;
          for (let j = 0; j < sr * 0.012; j++) d[(i0 + j) % d.length] += Math.sin(w * j) * a * Math.exp(-j / (sr * 0.003));
        }
        // (a seamless loop: crossfade the ends)
        const fade = Math.floor(sr * 0.05);
        for (let i = 0; i < fade; i++) {
          const k = i / fade;
          d[i] = d[i] * k + d[d.length - fade + i] * (1 - k);
        }
      });
      this.windB = buffer(ctx, 2, (d) => {
        for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
      });
      this.cheerB = buffer(
        ctx,
        3.2,
        (d, sr) => {
          // a crowd: many band-limited voices swelling, with claps
          const voices = 26;
          for (let v = 0; v < voices; v++) {
            const f = 300 + r() * 900, am = 3 + r() * 6, ph = r() * 6;
            let lp = 0, bp = 0;
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              const env = Math.min(1, t * 3) * Math.exp(-Math.max(0, t - 1.4) * 1.4);
              const n = r() * 2 - 1;
              lp += (n - lp) * ((2 * Math.PI * f) / sr);
              bp += (lp - bp) * 0.5;
              d[i] += (lp - bp) * env * (0.6 + 0.4 * Math.sin(t * am + ph)) * 0.6;
            }
          }
          for (let k = 0; k < 90; k++) {
            const t0 = r() * 2.6;
            for (let j = 0; j < sr * 0.02; j++) {
              const i = Math.floor(t0 * sr) + j;
              if (i >= d.length) break;
              d[i] += (r() * 2 - 1) * Math.exp(-j / (sr * 0.004)) * 0.5;
            }
          }
        },
        2,
      );
    }
  }

  private spatial(x: number, y: number, z: number) {
    const dx = x - this.cam.x, dy = y - this.cam.y, dz = z - this.cam.z;
    const d = Math.hypot(dx, dy, dz);
    const pan = d > 0.01 ? THREE.MathUtils.clamp((dx * this.right.x + dy * this.right.y + dz * this.right.z) / d, -1, 1) * 0.85 : 0;
    const g = 1 / (1 + Math.pow(d / 7, 1.35));
    return { pan, g, d };
  }

  private play(buf: AudioBuffer, gain: number, pan: number, rate = 1, wet = 0.25, lowpass = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn || gain < 0.004) return;
    if (this.voices > 40) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    let head: AudioNode = src;
    if (lowpass > 0) {
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
    src.start();
  }

  /** the physics' contacts this frame */
  hits(list: Hit[], player: unknown) {
    if (!this.ctx) return;
    // the loudest first (the voice cap drops the quiet ones)
    const sorted = list.length > 12 ? [...list].sort((a, b) => b.speed - a.speed) : list;
    for (const h of sorted) {
      const { pan, g } = this.spatial(h.x, h.y, h.z);
      const mine = h.a === player || h.b === player;
      const near = mine ? Math.max(g, 0.55) : g;
      const v = h.speed;
      if (h.kind === 'glass') {
        const amp = Math.pow(THREE.MathUtils.clamp((v - 0.3) / 9, 0, 1), 0.9) * 0.9 * near;
        const buf = this.glass[(Math.random() * this.glass.length) | 0];
        // (a hard hit rings a touch lower and longer)
        this.play(buf, amp, pan, 1.04 - Math.min(0.1, v * 0.008) + (Math.random() - 0.5) * 0.06, 0.3);
      } else {
        const amp = Math.pow(THREE.MathUtils.clamp((v - 0.6) / 11, 0, 1), 1.05) * near;
        if (h.mat === Mat.Bumper) {
          this.play(this.ding[(Math.random() * this.ding.length) | 0], Math.max(0.35, amp) * near * 1.1, pan, 1, 0.45);
          continue;
        }
        const bank = h.mat === Mat.Paint ? this.paint : h.mat === Mat.Felt ? this.felt : this.wood;
        const buf = bank[(Math.random() * bank.length) | 0];
        // brighter the harder it lands
        this.play(buf, amp * 1.1, pan, 0.94 + Math.random() * 0.12, 0.28, 1400 + v * 700);
      }
    }
  }

  /** the rolling voices: the nearest rolling marbles (and always the player) */
  rolling(list: { key: unknown; x: number; y: number; z: number; speed: number; on: boolean; mat: Mat }[]) {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.rolls.length < 6) {
      const src = ctx.createBufferSource();
      src.buffer = this.rollB;
      src.loop = true;
      src.loopStart = Math.random() * 2;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 0.7;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      src.connect(f).connect(lp).connect(g).connect(p).connect(this.sfx);
      src.start(0, Math.random() * 2.5);
      this.rolls.push({ src, f, g, p, key: null });
    }
    const t = ctx.currentTime;
    const scored = list
      .map((m) => ({ m, sp: this.spatial(m.x, m.y, m.z) }))
      .sort((a, b) => b.sp.g * (b.m.on ? b.m.speed : 0) - a.sp.g * (a.m.on ? a.m.speed : 0))
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
      const lvl = Math.pow(THREE.MathUtils.clamp(sp / 16, 0, 1.4), 1.1) * 0.55 * Math.max(e.sp.g, k === 0 ? 0.5 : 0);
      v.g.gain.setTargetAtTime(lvl, t, 0.04);
      v.f.frequency.setTargetAtTime((paint ? 320 : 170) + sp * 32, t, 0.05);
      v.src.playbackRate.setTargetAtTime(0.55 + Math.min(1.6, sp * 0.05), t, 0.05);
      v.p.pan.setTargetAtTime(e.sp.pan, t, 0.05);
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
    this.wind.g.gain.setTargetAtTime(this.sfxOn ? Math.pow(THREE.MathUtils.clamp((speed - 6) / 22, 0, 1), 2) * 0.12 : 0, t, 0.2);
    this.wind.f.frequency.setTargetAtTime(400 + speed * 35, t, 0.2);
  }

  splash(x: number, y: number, z: number) {
    const { pan, g } = this.spatial(x, y, z);
    this.play(this.splashB, Math.max(0.25, g * 2.2), pan, 0.9 + Math.random() * 0.2, 0.35);
  }

  /** a hop off the ground (a soft knock), a dash (a whoosh) */
  hop(x: number, y: number, z: number, mat: Mat) {
    const { pan, g } = this.spatial(x, y, z);
    const bank = mat === Mat.Paint ? this.paint : this.wood;
    this.play(bank[(Math.random() * bank.length) | 0], 0.35 * Math.max(g, 0.5), pan, 1.25, 0.2, 2200);
  }
  dash(x: number, y: number, z: number) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const { pan, g } = this.spatial(x, y, z);
    const src = ctx.createBufferSource();
    src.buffer = this.windB;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.25);
    const gg = ctx.createGain();
    gg.gain.setValueAtTime(0, t);
    gg.gain.linearRampToValueAtTime(0.4 * Math.max(g, 0.5), t + 0.04);
    gg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(gg).connect(p).connect(this.sfx);
    src.start(t, Math.random(), 0.4);
  }

  cheer(level = 1) {
    this.play(this.cheerB, 0.5 * level, 0, 1, 0.2);
  }

  /** marimba notes for the UI (midi numbers, seconds apart) */
  notes(midis: number[], gap = 0.09, vel = 0.5) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const t = ctx.currentTime + 0.01;
    midis.forEach((m, k) => marimba(ctx, this.sfx, t + k * gap, m, vel));
  }
  countdown(n: number) {
    if (n > 0) this.notes([72], 0, 0.6);
    else this.notes([72, 76, 79, 84], 0.0, 0.5);
  }
  qualified() {
    this.notes([72, 76, 79, 84, 88], 0.08, 0.55);
    setTimeout(() => this.cheer(1), 120);
  }
  eliminated() {
    this.notes([67, 63, 60, 55], 0.22, 0.5);
  }
  crowned() {
    this.notes([60, 64, 67, 72, 67, 72, 76, 79, 84], 0.11, 0.55);
    setTimeout(() => this.cheer(1.3), 200);
  }
  click() {
    this.notes([84], 0, 0.25);
  }

  setMusic(mode: 'off' | 'menu' | 'play' | 'calm') {
    if (!this.music) return;
    this.music.mode(this.musicOn ? mode : 'off');
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
  const o1 = ctx.createOscillator();
  o1.frequency.value = f;
  o1.connect(g);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.35, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  const o2 = ctx.createOscillator();
  o2.frequency.value = f * 4;
  o2.connect(g2).connect(g);
  const g3 = ctx.createGain();
  g3.gain.setValueAtTime(0.18, t);
  g3.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  const o3 = ctx.createOscillator();
  o3.frequency.value = f * 10;
  o3.connect(g3).connect(g);
  for (const o of [o1, o2, o3]) {
    o.start(t);
    o.stop(t + dur * 1.5);
  }
  o1.onended = () => g.disconnect();
}

/**
 * The show's music: a bouncy marimba tune over pizzicato bass, a kick, claps, a shaker and a
 * wood block, I–vi–IV–V in C at 126 bpm, scheduled ahead on the audio clock.
 */
class Music {
  private timer = 0;
  private step = 0;
  private next = 0;
  private m: 'off' | 'menu' | 'play' | 'calm' = 'off';
  private bus: GainNode;
  private noise: AudioBuffer;
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
    const spb = 60 / 126 / 4;
    while (this.next < this.ctx.currentTime + 0.12) {
      this.note(this.step, this.next);
      this.step++;
      this.next += spb;
    }
  }
  private note(step: number, t: number) {
    const SCALE = [0, 2, 4, 5, 7, 9, 11];
    const bar = Math.floor(step / 16) % 8;
    const s = step % 16;
    const chord = [0, 5, 3, 4, 0, 5, 3, 4][bar];
    const deg = (d: number, oct: number) => 60 + 12 * oct + SCALE[(((chord + d) % 7) + 7) % 7] + 12 * Math.floor((chord + d) / 7);
    const calm = this.m === 'calm';
    // melody: two phrases, the second answering the first
    const A = [0, -1, 2, -1, 4, -1, 2, 4, 5, -1, 4, -1, 2, -1, -1, -1];
    const B = [4, -1, 4, 5, 7, -1, 4, -1, 2, -1, 4, 2, 0, -1, -1, -1];
    const C = [7, -1, 6, -1, 4, -1, 2, -1, 4, 5, 4, 2, 1, -1, -1, -1];
    const mel = bar % 4 === 3 ? C : bar % 2 ? B : A;
    if (mel[s] >= 0 && (!calm || s % 4 === 0)) marimba(this.ctx, this.bus, t, deg(mel[s], 1), 0.22);
    // off-beat chord stabs
    if (!calm && (s === 2 || s === 10)) for (const d of [0, 2, 4]) marimba(this.ctx, this.bus, t, deg(d, 0), 0.07, 0.25);
    // bass
    if (s === 0 || s === 6 || s === 8 || s === 14) this.bass(t, deg(0, -2) + (s === 14 ? 7 : 0));
    if (calm) return;
    if (s === 0 || s === 8 || (s === 10 && bar % 2)) this.kick(t);
    if (s === 4 || s === 12) this.clap(t);
    this.hat(t, s % 2 ? 0.025 : 0.045);
    if (s === 3 || s === 11 || (s === 15 && bar % 2)) this.block(t);
  }
  private bass(t: number, midi: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.45, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.3);
  }
  private kick(t: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.25);
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
    for (let k = 0; k < 3; k++) this.noiseHit(t + k * 0.011, 'bandpass', 1500, 0.9, 0.32, 0.09 + k * 0.03);
  }
  private hat(t: number, g: number) {
    this.noiseHit(t, 'highpass', 7000, 0.7, g, 0.04);
  }
  private block(t: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = 1050;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.08);
  }
}
