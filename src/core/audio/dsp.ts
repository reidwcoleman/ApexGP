/**
 * Small DSP helpers for the synthesized audio: parameter smoothing, generated
 * buffers (noise, gravel crunch, carbon crackle, reverb IR) and shaper curves.
 * Everything is generated in code — no audio files.
 */

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

const lastTarget = new WeakMap<AudioParam, number>();

/**
 * setTargetAtTime with de-duplication (skips the call if the target hasn't
 * meaningfully changed, so per-frame updates don't flood the automation list).
 */
export function setT(p: AudioParam, v: number, t: number, tau: number, eps = 2e-3): void {
  if (!Number.isFinite(v)) return;
  const last = lastTarget.get(p);
  if (last !== undefined && Math.abs(last - v) <= Math.abs(v) * eps + 1e-6) return;
  lastTarget.set(p, v);
  p.setTargetAtTime(v, t, tau);
}

/** Forget the cached target (after cancelScheduledValues or manual automation). */
export function forget(p: AudioParam): void {
  lastTarget.delete(p);
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AudioBuffers {
  /** 3 s white noise (mono, loopable) */
  white: AudioBuffer;
  /** 4 s pink noise (mono, seamless loop) */
  pink: AudioBuffer;
  /** 8 s smooth random LFO in −1..1 (0.4–8 Hz content, seamless loop) */
  wander: AudioBuffer;
  /** 2 s gravel crunch / stone rattle grains (seamless loop) */
  crunch: AudioBuffer;
  /** 0.8 s carbon-fibre crack burst (one-shot) */
  crackle: AudioBuffer;
  /** 1.7 s stereo reverb impulse response */
  ir: AudioBuffer;
}

function normalize(d: Float32Array, peak: number): void {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}

/** Crossfade the tail of an (n + fade) sample signal into its head → seamless loop of n samples. */
function loopify(src: Float32Array, n: number, fade: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(n);
  out.set(src.subarray(0, n));
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    out[i] = src[i] * w + src[n + i] * (1 - w);
  }
  return out;
}

export function makeBuffers(ctx: BaseAudioContext): AudioBuffers {
  const sr = ctx.sampleRate;
  const r = rng(0x5eed);

  // white
  const wN = Math.floor(sr * 3);
  const white = ctx.createBuffer(1, wN, sr);
  {
    const d = white.getChannelData(0);
    for (let i = 0; i < wN; i++) d[i] = r() * 2 - 1;
  }

  // pink (Paul Kellet's refined filter)
  const pN = Math.floor(sr * 4);
  const pink = ctx.createBuffer(1, pN, sr);
  {
    const fade = 4096;
    const tmp = new Float32Array(pN + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < tmp.length; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      tmp[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
    const d = loopify(tmp, pN, fade);
    normalize(d, 0.9);
    pink.copyToChannel(d, 0);
  }

  // wander: sum of sinusoids with an integer number of cycles over the buffer → seamless
  const lenS = 8;
  const aN = Math.floor(sr * lenS);
  const wander = ctx.createBuffer(1, aN, sr);
  {
    const d = wander.getChannelData(0);
    const comps: [number, number, number][] = [];
    for (let k = 0; k < 14; k++) {
      const cycles = 3 + Math.floor(r() * 60); // 0.375 .. 8 Hz
      comps.push([(2 * Math.PI * cycles) / aN, r() * Math.PI * 2, (0.4 + r()) / Math.sqrt(cycles)]);
    }
    for (let i = 0; i < aN; i++) {
      let s = 0;
      for (const [w, ph, a] of comps) s += a * Math.sin(w * i + ph);
      d[i] = s;
    }
    normalize(d, 1);
  }

  // gravel crunch: dense random grains (stones hitting the floor, tyres crushing gravel)
  const cN = Math.floor(sr * 2);
  const crunch = ctx.createBuffer(1, cN, sr);
  {
    const d = crunch.getChannelData(0);
    const grains = Math.floor(2 * 420);
    for (let g = 0; g < grains; g++) {
      const start = Math.floor(r() * cN);
      const len = Math.floor(sr * (0.0008 + r() * r() * 0.012));
      const amp = Math.pow(r(), 2.2) * (r() < 0.08 ? 2.2 : 1);
      const tone = r() < 0.35; // pebble "knock" with a short ring
      const f = (1400 + r() * 3600) / sr;
      let hp = 0, prev = 0;
      for (let i = 0; i < len; i++) {
        const e = Math.exp((-5 * i) / len);
        let x = r() * 2 - 1;
        // 1-pole high-pass → clicky
        hp = 0.85 * (hp + x - prev);
        prev = x;
        x = tone ? 0.6 * hp + 0.8 * Math.sin(2 * Math.PI * f * i) : hp;
        d[(start + i) % cN] += x * e * amp;
      }
    }
    normalize(d, 0.95);
  }

  // carbon-fibre crackle: a burst of sharp cracks thinning out over time
  const kN = Math.floor(sr * 0.8);
  const crackle = ctx.createBuffer(1, kN, sr);
  {
    const d = crackle.getChannelData(0);
    for (let g = 0; g < 260; g++) {
      const t = Math.pow(r(), 2.4); // front-loaded
      const start = Math.floor(t * kN * 0.9);
      const len = Math.floor(sr * (0.0003 + r() * 0.0035));
      const amp = (0.25 + r()) * (1 - t * 0.8);
      let hp = 0, prev = 0;
      for (let i = 0; i < len && start + i < kN; i++) {
        const x = r() * 2 - 1;
        hp = 0.7 * (hp + x - prev);
        prev = x;
        d[start + i] += hp * amp * Math.exp((-4 * i) / len);
      }
    }
    normalize(d, 0.95);
  }

  // reverb IR: early reflections (grandstands / pit wall) + damped diffuse tail
  const iN = Math.floor(sr * 1.7);
  const ir = ctx.createBuffer(2, iN, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const pre = Math.floor(sr * 0.011);
    const taps = [0.017, 0.029, 0.041, 0.058, 0.073, 0.097, 0.121];
    for (const tp of taps) {
      const i = pre + Math.floor(sr * tp * (1 + (ch ? 0.07 : -0.05) * r()));
      if (i < iN) d[i] += (r() < 0.5 ? -1 : 1) * (0.5 + 0.4 * r()) * Math.exp(-tp * 9);
    }
    let lp = 0;
    for (let i = pre; i < iN; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp(-t / 0.22) * Math.min(1, t / 0.02);
      const k = 0.55 * Math.exp(-t * 2.2) + 0.06; // darker as it decays
      lp += k * (r() * 2 - 1 - lp);
      d[i] += lp * env * 0.9;
    }
  }

  return { white, pink, wander, crunch, crackle, ir };
}

/** Looping buffer source started at a random offset. */
export function loopSource(ctx: BaseAudioContext, buf: AudioBuffer, rate = 1, offset = Math.random()): AudioBufferSourceNode {
  const s = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true, playbackRate: rate });
  s.start(0, offset * buf.duration);
  return s;
}

/** Transparent up to `knee`, then smoothly saturates toward ±1 (never reaches it). */
export function softClipCurve(knee = 0.72, n = 4096): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const rest = 1 - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + rest * Math.tanh((a - knee) / rest);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/** tanh saturation normalised so ±1 → ±1. */
export function tanhCurve(drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const k = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / k;
  }
  return c;
}

/** Half-wave rectifier with exponent: max(0,x)^p (for amplitude-modulation drivers). */
export function rectCurve(p = 1, n = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = x > 0 ? Math.pow(x, p) : 0;
  }
  return c;
}

export function biquad(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, Q = 0.707, gain = 0): BiquadFilterNode {
  return new BiquadFilterNode(ctx, { type, frequency, Q, gain });
}

export function gainNode(ctx: BaseAudioContext, gain = 0): GainNode {
  return new GainNode(ctx, { gain });
}

export function chain(...nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}
