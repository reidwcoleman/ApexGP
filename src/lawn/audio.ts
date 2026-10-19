/**
 * Apex Lawn's sound. The engine, the thuds, the coins, the chimes and the birds are real recordings
 * (public/lawn/sfx, see tools/build_lawn_sounds.py); what is left is synthesised: the grass being
 * snipped (a grain per bit of lawn cut), the pull-cord, soft footsteps, the UI ticks and the tune.
 */

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
/** the windchime recordings ring at about this pitch: A6; ratios from it land on the tune's A minor */
const A_MINOR = [0.5, 0.5946, 0.7491, 1, 1.189, 1.498];

const BASE = `${import.meta.env.BASE_URL}lawn/sfx/`;
const FILES = [
  'mower_lo', 'mower_hi', 'thud', 'knock', 'knock2', 'twig', 'clank', 'coin1', 'coin2', 'coin3', 'coin4', 'cash',
  'glock1', 'glock2', 'chime', 'applause', 'amb_day', 'amb_breeze', 'amb_dusk',
] as const;
type Sample = (typeof FILES)[number];

/** start fetching early (no AudioContext needed): decoding waits for the first tap */
const bytes = new Map<Sample, Promise<ArrayBuffer | null>>();
export function prefetchSounds() {
  for (const n of FILES) {
    if (!bytes.has(n)) bytes.set(n, fetch(`${BASE}${n}.wav`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
  }
}

export type Material = 'wood' | 'stone' | 'metal' | 'leaf' | 'soft';

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
const BED: Record<string, Sample> = { meadow: 'amb_day', blossom: 'amb_day', autumn: 'amb_breeze', dusk: 'amb_dusk' };

interface Play {
  rate?: number;
  gain?: number;
  pan?: number;
  /** how much goes to the reverb */
  send?: number;
  when?: number;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private bedBus!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private grains: AudioBuffer[] = [];
  private samples = new Map<Sample, AudioBuffer>();
  private ready = false;
  private pendingStart = false;
  // the engine: two recorded loops (free-running, and chewing grass) kept at the same pitch
  private engLo: AudioBufferSourceNode | null = null;
  private engHi: AudioBufferSourceNode | null = null;
  private gLo!: GainNode;
  private gHi!: GainNode;
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private rollGain!: GainNode;
  private rollFilter!: BiquadFilterNode;
  private rpm = 0;
  private startT = 0;
  private running = false;
  private lastDrive = 0;
  private lastActive = false;
  /** what this mower's engine is like: a big rider is lower and fuller than a push mower */
  private voice = { pitch: 1, gain: 1, dark: 1 };
  private bed: { name: Sample; src: AudioBufferSourceNode; g: GainNode } | null = null;
  private stepDist = 0;
  private lastCoin = 0;
  private lastBump = 0;
  sound = true;
  music = true;
  private theme = 'meadow';
  private timer = 0;
  private step = 0;
  private nextT = 0;
  private playing = false;
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
    this.master.gain.value = this.sound ? 1.0 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 14;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.bedBus = ctx.createGain();
    this.bedBus.gain.value = 0.5;
    this.bedBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.music ? 0.42 : 0;
    this.musicBus.connect(this.master);

    // a made-up room: decaying noise as the impulse (a little of it on the chimes and coins)
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
    this.reverb.connect(rg).connect(this.master);

    const nlen = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
    this.makeGrains();

    // the engine bus
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 5200;
    this.engFilter.Q.value = 0.4;
    this.gLo = ctx.createGain();
    this.gHi = ctx.createGain();
    this.gLo.gain.value = this.gHi.gain.value = 0;
    this.gLo.connect(this.engFilter);
    this.gHi.connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.sfx);

    // the wheels hissing through the grass
    const rs = ctx.createBufferSource();
    rs.buffer = this.noiseBuf;
    rs.loop = true;
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'bandpass';
    this.rollFilter.frequency.value = 1500;
    this.rollFilter.Q.value = 0.5;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    rs.connect(this.rollFilter).connect(this.rollGain).connect(this.sfx);
    rs.start();

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });

    prefetchSounds();
    void this.decodeAll();
  }

  private async decodeAll() {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      FILES.map(async (n) => {
        const ab = await bytes.get(n);
        if (!ab) return;
        try {
          this.samples.set(n, await ctx.decodeAudioData(ab.slice(0)));
        } catch {
          /* that sound stays silent */
        }
      }),
    );
    this.ready = true;
    this.startEngineLoops();
    this.setBed();
    if (this.pendingStart) this.engineStart();
  }

  private startEngineLoops() {
    const c = this.ctx;
    const lo = this.samples.get('mower_lo');
    const hi = this.samples.get('mower_hi');
    if (!c || !lo || !hi) return;
    this.engLo = c.createBufferSource();
    this.engLo.buffer = lo;
    this.engLo.loop = true;
    this.engHi = c.createBufferSource();
    this.engHi.buffer = hi;
    this.engHi.loop = true;
    this.engLo.connect(this.gLo);
    this.engHi.connect(this.gHi);
    this.engLo.start();
    this.engHi.start();
    this.engLo.playbackRate.value = this.engHi.playbackRate.value = 0.4;
  }

  /** the grass being snipped: tiny bursts of band-limited noise with a crisp front */
  private makeGrains() {
    const c = this.ctx!;
    const sr = c.sampleRate;
    const make = (ms: number, f: number, q: number, decay: number, click: number) => {
      const n = Math.floor((ms / 1000) * sr);
      const b = c.createBuffer(1, n, sr);
      const d = b.getChannelData(0);
      // a state-variable band-pass over white noise
      const w = 2 * Math.sin((Math.PI * f) / sr);
      let low = 0;
      let band = 0;
      for (let i = 0; i < n; i++) {
        const x = Math.random() * 2 - 1;
        low += w * band;
        const high = x - low - band / q;
        band += w * high;
        const env = Math.exp((-i / n) * decay) * Math.min(1, i / (sr * 0.0007));
        d[i] = band * env * 1.6 + (i < sr * 0.0012 ? x * click * (1 - i / (sr * 0.0012)) : 0);
      }
      return b;
    };
    for (const f of [2300, 3100, 4200, 5600, 7200]) this.grains.push(make(14, f, 3.2, 6, 0.4));
    for (const f of [1300, 1900]) this.grains.push(make(26, f, 2.4, 5, 0.25));
  }

  setSound(on: boolean) {
    this.sound = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 1.0 : 0, this.ctx.currentTime, 0.05);
  }
  setMusic(on: boolean) {
    this.music = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.42 : 0, this.ctx.currentTime, 0.2);
  }

  // --------------------------------------------------------------- the mower

  /** The pull-cord, a cough or two, and the engine catching. Call as the mowing begins. */
  engineStart() {
    const c = this.ctx;
    if (!c || !this.engLo || !this.engHi) {
      this.pendingStart = !this.ready; // still decoding: start as soon as the sounds are in
      return;
    }
    this.pendingStart = false;
    const t = c.currentTime;
    this.startT = t + 1.5;
    this.running = false;
    this.rpm = 0.1;
    // the rip of the cord, twice
    for (const [dt, dur] of [[0.05, 0.34], [0.55, 0.3]] as const) {
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.3;
      f.frequency.setValueAtTime(900, t + dt);
      f.frequency.exponentialRampToValueAtTime(2600, t + dt + dur);
      const am = c.createGain();
      am.gain.setValueAtTime(0.0001, t + dt);
      am.gain.exponentialRampToValueAtTime(0.1, t + dt + dur * 0.5);
      am.gain.exponentialRampToValueAtTime(0.0001, t + dt + dur);
      const lfo = c.createOscillator();
      lfo.frequency.value = 38;
      const lg = c.createGain();
      lg.gain.value = 0.06;
      lfo.connect(lg).connect(am.gain);
      s.connect(f).connect(am).connect(this.sfx);
      s.start(t + dt);
      s.stop(t + dt + dur + 0.05);
      lfo.start(t + dt);
      lfo.stop(t + dt + dur + 0.05);
    }
    // the engine: a stutter of compressions, then it catches and settles to idle
    const lo = this.engLo.playbackRate;
    const hi = this.engHi.playbackRate;
    const g = this.engGain.gain;
    lo.cancelScheduledValues(t);
    hi.cancelScheduledValues(t);
    g.cancelScheduledValues(t);
    this.gLo.gain.cancelScheduledValues(t);
    this.gHi.gain.cancelScheduledValues(t);
    this.gLo.gain.setValueAtTime(1, t);
    this.gHi.gain.setValueAtTime(0, t);
    const bursts: [number, number, number][] = [[0.38, 0.5, 0.12], [0.62, 0.62, 0.12], [0.84, 0.8, 0.2], [1.1, 1.0, 0.4]];
    lo.setValueAtTime(0.35, t);
    g.setValueAtTime(0, t);
    for (const [bt, rt, gv] of bursts) {
      lo.setTargetAtTime(0.5 + rt * 0.42, t + bt, 0.05);
      g.setTargetAtTime(gv * 1.4, t + bt, 0.025);
      if (bt < 1) g.setTargetAtTime(0.02, t + bt + 0.11, 0.05);
    }
    g.setTargetAtTime(0.8, t + 1.1, 0.18);
    hi.setValueAtTime(0.3, t);
    hi.setTargetAtTime(0.6, t + 1.1, 0.1);
    this.noiseBurst(0.3, 0.05, 250, 90, 0.38, 0.9);
  }

  /** Per frame: how fast, how hard, how much grass is being cut right now. */
  drive(speed01: number, throttle: number, cutting: number, active: boolean) {
    const c = this.ctx;
    if (!c || !this.engLo || !this.engHi) return;
    const t = c.currentTime;
    // (a few dozen updates a second are plenty for a motor; every call adds automation events)
    if (active === this.lastActive && t - this.lastDrive < 0.03) return;
    this.lastDrive = t;
    this.lastActive = active;
    const starting = t < this.startT;
    if (!active) {
      // spinning down
      if (this.running) {
        this.running = false;
        this.engGain.gain.cancelScheduledValues(t);
        this.engGain.gain.setTargetAtTime(0, t, 0.28);
        this.engLo.playbackRate.setTargetAtTime(0.3, t, 0.4);
        this.engHi.playbackRate.setTargetAtTime(0.26, t, 0.4);
        this.rollGain.gain.setTargetAtTime(0, t, 0.1);
      }
      this.bedBus.gain.setTargetAtTime(0.5, t, 0.8);
      return;
    }
    if (starting) {
      this.bedBus.gain.setTargetAtTime(0.4, t, 0.3);
      return;
    }
    if (!this.running) {
      // hand the engine over from the start-up script
      this.running = true;
      this.engGain.gain.cancelScheduledValues(t);
      this.engLo.playbackRate.cancelScheduledValues(t);
      this.engHi.playbackRate.cancelScheduledValues(t);
      this.engGain.gain.setTargetAtTime(0.8, t, 0.05);
    }
    // revs follow the throttle and the speed; a mouthful of long grass drags them down, clean ground lets them sing
    const wob = Math.sin(t * 3.3) * 0.012 + Math.sin(t * 8.1) * 0.006 + Math.sin(t * 23) * 0.003;
    const target = 0.2 + throttle * 0.5 + speed01 * 0.2 - cutting * 0.1 + wob;
    this.rpm += (target - this.rpm) * (target < this.rpm ? 0.14 : 0.07);
    const rate = (0.8 + this.rpm * 0.62) * this.voice.pitch;
    this.engLo.playbackRate.setTargetAtTime(rate, t, 0.05);
    this.engHi.playbackRate.setTargetAtTime(rate * 0.875, t, 0.05);
    const load = Math.min(1, cutting * 1.15 + throttle * 0.2);
    this.gLo.gain.setTargetAtTime(1 - load * 0.85, t, 0.12);
    this.gHi.gain.setTargetAtTime(0.2 + load * 0.95, t, 0.1);
    this.engFilter.frequency.setTargetAtTime((2600 + this.rpm * 2200 + cutting * 1200) * this.voice.dark, t, 0.1);
    this.engGain.gain.setTargetAtTime((0.52 + this.rpm * 0.4 + cutting * 0.08) * this.voice.gain, t, 0.1);
    this.rollFilter.frequency.setTargetAtTime(900 + speed01 * 1700, t, 0.1);
    this.rollGain.gain.setTargetAtTime(speed01 * 0.05, t, 0.12);
    this.bedBus.gain.setTargetAtTime(0.28, t, 0.5);
  }

  setProgress(p: number) {
    this.level = p;
  }

  setMower(kind: 'push' | 'rider', width: number) {
    this.voice = kind === 'rider' ? { pitch: 0.7 - (width - 1) * 0.12, gain: 1.2, dark: 0.7 } : { pitch: 1.04 - (width - 0.56) * 0.5, gain: 1, dark: 1 };
  }

  /** the last of the lawn folding down in a ripple: a long rising hush of blades */
  ripple() {
    this.noiseBurst(2.2, 0.16, 350, 5200, 0.0, 0.5);
    this.noiseBurst(2.2, 0.08, 1800, 7000, 0.15, 0.8);
    this.tone(180, 1.6, 0.05, 'sine', 0, 520);
  }

  /** `n` bits of lawn were just cut: a grain of snipping for some of them */
  cut(n: number, speed01: number) {
    const c = this.ctx;
    if (!c || !this.running || n <= 0 || !this.grains.length) return;
    const want = Math.min(3, n / 10);
    const k = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
    for (let i = 0; i < k; i++) {
      const s = c.createBufferSource();
      s.buffer = this.grains[(Math.random() * this.grains.length) | 0];
      s.playbackRate.value = 0.85 + Math.random() * 0.4 + this.level * 0.12;
      const g = c.createGain();
      g.gain.value = (0.05 + speed01 * 0.07) * (0.5 + Math.random() * 0.8);
      const p = c.createStereoPanner();
      p.pan.value = (Math.random() - 0.5) * 0.7;
      s.connect(g).connect(p).connect(this.sfx);
      s.start(c.currentTime + Math.random() * 0.012);
    }
  }

  /** Soft footfalls on the turf, one for each stride of the gardener. */
  steps(odo: number, speed01: number) {
    const c = this.ctx;
    if (!c || !this.running || speed01 < 0.08) {
      return;
    }
    const stride = 0.62;
    if (odo - this.stepDist < stride) {
      if (odo < this.stepDist) this.stepDist = odo;
      return;
    }
    this.stepDist = odo;
    const side = Math.floor(odo / stride) % 2 ? 0.12 : -0.12;
    this.noiseBurst(0.09, 0.04 + speed01 * 0.05, 700, 260, 0.2 + speed01 * 0.1, 0.7, side);
    this.noiseBurst(0.05, 0.03, 2200, 1500, 0.04 + speed01 * 0.03, 0.5, side);
  }

  // --------------------------------------------------------------- one-shots

  private play(name: Sample, o: Play = {}) {
    const c = this.ctx;
    const b = this.samples.get(name);
    if (!c || !b) return;
    const s = c.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = o.rate ?? 1;
    const g = c.createGain();
    g.gain.value = o.gain ?? 1;
    s.connect(g);
    if (o.pan) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      g.connect(p).connect(this.sfx);
    } else g.connect(this.sfx);
    if (o.send) {
      const r = c.createGain();
      r.gain.value = o.send;
      g.connect(r).connect(this.reverb);
    }
    s.start(c.currentTime + (o.when ?? 0));
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
  /** a burst of band-passed noise sliding from f0 to f1 */
  private noiseBurst(dur: number, vol: number, f0: number, f1: number, when = 0, q = 1, pan = 0) {
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
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g);
    if (pan) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.sfx);
    } else g.connect(this.sfx);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  coin(chain: number, pan = 0) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // a real clink, climbing the scale as the chain grows
    let n = 1 + ((Math.random() * 4) | 0);
    if (n === this.lastCoin) n = (n % 4) + 1;
    this.lastCoin = n;
    const semis = SCALE[Math.min(chain, SCALE.length - 1)];
    const rate = Math.min(2.3, 0.92 * Math.pow(2, semis / 24));
    this.play(`coin${n}` as Sample, { rate, gain: 0.8, pan, send: 0.25 });
    // and a clean ping on the scale so the run of coins sings
    const f = 523.25 * Math.pow(2, semis / 12);
    this.tone(f, 0.5, 0.06, 'sine', 0.012);
    this.tone(f * 2, 0.3, 0.03, 'sine', 0.02);
    void now;
  }
  flower(pan = 0) {
    this.play('twig', { rate: 1.5 + Math.random() * 0.5, gain: 0.3, pan });
    this.tone(1180 + Math.random() * 380, 0.09, 0.04, 'sine', 0.02, 1700);
  }
  /** the mower meeting something: what it is decides what it sounds like */
  bump(v: number, material: Material = 'soft', pan = 0) {
    const c = this.ctx;
    if (!c) return;
    if (c.currentTime - this.lastBump < 0.12) return;
    this.lastBump = c.currentTime;
    const k = Math.min(1, v / 4);
    const gain = 0.35 + 0.65 * k;
    this.play('thud', { rate: 0.8 + Math.random() * 0.15, gain: gain * 0.9, pan });
    switch (material) {
      case 'wood':
        this.play(Math.random() < 0.5 ? 'knock' : 'knock2', { rate: 0.85 + Math.random() * 0.2, gain: gain * 0.9, pan });
        break;
      case 'stone':
        this.play('clank', { rate: 0.7 + Math.random() * 0.15, gain: gain * 0.35, pan });
        this.noiseBurst(0.08, 0.1 * gain, 3500, 1200, 0, 1.2, pan);
        break;
      case 'metal':
        this.play('clank', { rate: 1.0 + Math.random() * 0.25, gain: gain * 0.55, pan, send: 0.15 });
        break;
      case 'leaf':
        this.noiseBurst(0.4, 0.18 * gain, 5200, 1800, 0.01, 0.7, pan);
        this.play('twig', { rate: 0.8, gain: gain * 0.25, pan });
        break;
      default:
        break;
    }
  }
  milestone(i: number) {
    const rates = [A_MINOR[3], A_MINOR[4], A_MINOR[5]];
    const r = rates[i % 3];
    this.play('glock2', { rate: r, gain: 0.55, send: 0.4 });
    this.play('glock2', { rate: r * 2, gain: 0.14, send: 0.4, when: 0.03 });
  }
  complete() {
    [0, 1, 2, 3, 4, 5].forEach((k, i) => this.play('glock2', { rate: A_MINOR[k] * 1.0, gain: 0.5, send: 0.45, when: i * 0.12 }));
    this.play('chime', { rate: 0.5, gain: 0.5, send: 0.5, when: 0.5 });
    this.play('applause', { gain: 0.55, when: 0.35 });
    this.noiseBurst(0.9, 0.05, 500, 6000, 0, 0.6);
  }
  tap() {
    this.tone(1250, 0.05, 0.05, 'triangle');
  }
  back() {
    this.tone(820, 0.07, 0.045, 'triangle', 0, 560);
  }
  whoosh() {
    this.noiseBurst(1.0, 0.1, 260, 2400, 0, 0.5);
  }
  pop() {
    this.tone(360, 0.14, 0.12, 'sine', 0, 980);
  }
  buy() {
    this.play('cash', { gain: 0.75, send: 0.15 });
    this.play('glock2', { rate: A_MINOR[4], gain: 0.3, send: 0.3, when: 0.35 });
  }
  nope() {
    this.play('thud', { rate: 1.3, gain: 0.45 });
    this.tone(196, 0.2, 0.06, 'triangle', 0.02, 140);
  }
  count() {
    this.tone(1500 + Math.random() * 200, 0.04, 0.03, 'triangle');
  }

  // --------------------------------------------------------------- the bed of birds and breeze

  private setBed() {
    const c = this.ctx;
    if (!c || !this.ready) return;
    const name = BED[this.theme] ?? 'amb_day';
    if (this.bed?.name === name) return;
    const buf = this.samples.get(name);
    if (!buf) return;
    const t = c.currentTime;
    if (this.bed) {
      const old = this.bed;
      old.g.gain.setTargetAtTime(0, t, 0.8);
      window.setTimeout(() => {
        try {
          old.src.stop();
        } catch {
          /* already stopped */
        }
      }, 4000);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(1, t, 1.2);
    src.connect(g).connect(this.bedBus);
    src.start(t, Math.random() * buf.duration);
    this.bed = { name, src, g };
  }

  // --------------------------------------------------------------- the tune

  startMusic(theme: string) {
    this.theme = theme;
    if (!this.ctx) return;
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.tick(), 90);
  }
  setTheme(theme: string) {
    this.theme = theme;
    this.setBed();
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
}
