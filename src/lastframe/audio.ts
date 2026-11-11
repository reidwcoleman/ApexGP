import * as THREE from 'three';
import { WEAPON_LIST, type WeaponId } from './shared.ts';

/**
 * All sound is made here, no samples. A shot is three layers: the crack (a noise burst), the body (a
 * falling thump), and the room's answer (a convolution reverb chosen by where you are). Distance
 * takes the top end off and delays nothing, walls muffle.
 */
export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private room!: ConvolverNode;
  private street!: ConvolverNode;
  private hall!: ConvolverNode;
  private roomG!: GainNode;
  private streetG!: GainNode;
  private hallG!: GainNode;
  private noise!: AudioBuffer;
  private rainG!: GainNode;
  private humG!: GainNode;
  private ring!: GainNode;
  private duck!: GainNode;
  volume = 0.8;

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const c = (this.ctx = new AudioContext());
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    this.duck = c.createGain();
    // a body camera's microphone: what's loud saturates, and a shot up close crunches
    const clip = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
    }
    clip.curve = curve;
    clip.oversample = '2x';
    this.duck.connect(comp).connect(clip).connect(this.master).connect(c.destination);
    this.dry = c.createGain();
    this.dry.connect(this.duck);
    const n = c.sampleRate * 2;
    this.noise = c.createBuffer(1, n, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.room = this.ir(0.5, 2.4, 3800);
    this.hall = this.ir(2.4, 1.9, 2200);
    this.street = this.ir(1.5, 2.8, 1600, 0.12);
    [this.roomG, this.hallG, this.streetG] = [this.room, this.hall, this.street].map((v) => {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(v);
      v.connect(this.duck);
      return g;
    });
    // ambience
    const rain = c.createBufferSource();
    rain.buffer = this.noise;
    rain.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    this.rainG = c.createGain();
    this.rainG.gain.value = 0;
    rain.connect(hp).connect(lp).connect(this.rainG).connect(this.dry);
    rain.start();
    const hum = c.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 120;
    const hlp = c.createBiquadFilter();
    hlp.type = 'lowpass';
    hlp.frequency.value = 420;
    this.humG = c.createGain();
    this.humG.gain.value = 0;
    hum.connect(hlp).connect(this.humG).connect(this.dry);
    hum.start();
    const city = c.createBufferSource();
    city.buffer = this.noise;
    city.loop = true;
    const clp = c.createBiquadFilter();
    clp.type = 'lowpass';
    clp.frequency.value = 170;
    const cg = c.createGain();
    cg.gain.value = 0.055;
    city.connect(clp).connect(cg).connect(this.dry);
    city.start();
    // the ring in your ears
    const t = c.createOscillator();
    t.frequency.value = 4100;
    this.ring = c.createGain();
    this.ring.gain.value = 0;
    t.connect(this.ring).connect(this.master);
    t.start();
  }

  private ir(sec: number, decay: number, cut: number, late = 0) {
    const c = this.ctx!;
    const n = Math.floor(sec * c.sampleRate);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      const a = Math.exp((-2 * Math.PI * cut) / c.sampleRate);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const pre = late ? Math.min(1, t / late) : 1;
        const x = (Math.random() * 2 - 1) * Math.pow(1 - t, decay * 2) * pre;
        lp = lp * a + x * (1 - a);
        d[i] = lp;
      }
      // early reflections: a slapback off the facades
      if (late) for (const r of [0.09, 0.17, 0.31]) d[Math.floor(r * c.sampleRate)] += (ch ? 0.5 : -0.5) * (1 - r);
    }
    const v = c.createConvolver();
    v.buffer = b;
    return v;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  /** where the listener is */
  listen(cam: THREE.Camera, kind: 'street' | 'small' | 'hall') {
    const c = this.ctx;
    if (!c) return;
    const l = c.listener, p = cam.position;
    this.ear.copy(p);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) {
      const t = c.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.01);
      l.positionY.setTargetAtTime(p.y, t, 0.01);
      l.positionZ.setTargetAtTime(p.z, t, 0.01);
      l.forwardX.setTargetAtTime(f.x, t, 0.01);
      l.forwardY.setTargetAtTime(f.y, t, 0.01);
      l.forwardZ.setTargetAtTime(f.z, t, 0.01);
      l.upX.setTargetAtTime(u.x, t, 0.01);
      l.upY.setTargetAtTime(u.y, t, 0.01);
      l.upZ.setTargetAtTime(u.z, t, 0.01);
    } else {
      // Firefox's older listener
      const o = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      o.setPosition?.(p.x, p.y, p.z);
      o.setOrientation?.(f.x, f.y, f.z, u.x, u.y, u.z);
    }
    const t = c.currentTime;
    this.roomG.gain.setTargetAtTime(kind === 'small' ? 1 : 0, t, 0.12);
    this.hallG.gain.setTargetAtTime(kind === 'hall' ? 1 : 0, t, 0.12);
    this.streetG.gain.setTargetAtTime(kind === 'street' ? 0.9 : 0, t, 0.12);
    this.rainG.gain.setTargetAtTime(this.coast ? 0 : kind === 'street' ? 0.075 : 0.016, t, 0.3);
    this.humG.gain.setTargetAtTime(kind === 'small' ? 0.006 : 0, t, 0.3);
  }

  /** a map by the sea: no rain, surf and wind instead */
  coast = false;
  private surfLo: GainNode | null = null;
  private surfHi!: GainNode;
  private airG!: GainNode;
  private airF!: BiquadFilterNode;
  private seaLvl = 0;
  private nextSet = 0;
  private nextGull = 4;
  private gust = 0;
  private lastP = new THREE.Vector3();
  private ear = new THREE.Vector3();

  private coastUp() {
    const c = this.ctx!;
    const loop = (type: BiquadFilterType, f: number, q: number) => {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.playbackRate.value = 0.7 + Math.random() * 0.3;
      const b = c.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(b).connect(g).connect(this.dry);
      s.start();
      return [g, b] as const;
    };
    this.surfLo = loop('lowpass', 380, 0.4)[0];
    this.surfHi = loop('bandpass', 2300, 0.45)[0];
    [this.airG, this.airF] = loop('bandpass', 420, 0.8);
  }

  /** d: metres to the water. Sets of waves come in and drag back; the higher you are the more it's wind */
  shore(d: number, inside: boolean, height: number, dt: number) {
    const c = this.ctx;
    if (!c) return;
    if (!this.surfLo) this.coastUp();
    const t = c.currentTime;
    const near = (inside ? 0.28 : 1) / (1 + d / 45);
    this.seaLvl = near;
    if (t > this.nextSet) {
      // a wave breaking: up fast, and the long hiss of it running back down the shingle
      const k = 0.65 + Math.random() * 0.7;
      this.nextSet = t + 5.5 + Math.random() * 4.5;
      const lo = this.surfLo!.gain, hi = this.surfHi.gain;
      lo.cancelScheduledValues(t);
      hi.cancelScheduledValues(t);
      lo.setTargetAtTime(0.2 * k * near + 0.012, t, 0.7);
      lo.setTargetAtTime(0.06 * near + 0.008, t + 1.8, 1.6);
      hi.setTargetAtTime(0.012 * near, t, 0.5);
      hi.setTargetAtTime(0.07 * k * near, t + 1.4, 0.35);
      hi.setTargetAtTime(0.008 * near, t + 2.4, 1.3);
    }
    this.gust += dt;
    const wind = (inside ? 0.12 : 1) * (0.02 + Math.min(0.05, height * 0.0011)) * (0.75 + 0.45 * Math.sin(this.gust * 0.31) * Math.sin(this.gust * 0.13 + 1));
    this.airG.gain.setTargetAtTime(wind, t, 0.8);
    this.airF.frequency.setTargetAtTime(340 + 220 * (0.5 + 0.5 * Math.sin(this.gust * 0.21)), t, 1.2);
    this.nextGull -= dt;
    if (this.nextGull < 0 && !inside) {
      this.nextGull = 7 + Math.random() * 16;
      const a = Math.random() * 6.28, r = 25 + Math.random() * 60;
      this.lastP.set(Math.cos(a) * r, 14 + Math.random() * 18, Math.sin(a) * r).add(this.ear);
      this.gull(this.lastP);
    }
  }

  /** a herring gull: a run of falling cries, each a rise then a long slide down */
  private gull(p: THREE.Vector3) {
    const c = this.ctx!;
    const out = this.src(p, 0.7 + Math.random() * 0.4, false);
    const n = 2 + Math.floor(Math.random() * 5);
    const base = 1250 + Math.random() * 500;
    let t = c.currentTime + 0.02;
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'sawtooth';
      o2.type = 'triangle';
      f.type = 'bandpass';
      f.frequency.value = 2100;
      f.Q.value = 1.4;
      const dur = (i === 0 ? 0.42 : 0.24) + Math.random() * 0.1;
      const top = base * (i === 0 ? 1.28 : 1.08);
      for (const q of [o.frequency, o2.frequency]) {
        q.setValueAtTime(base * 0.8, t);
        q.exponentialRampToValueAtTime(top, t + dur * 0.28);
        q.exponentialRampToValueAtTime(base * 0.62, t + dur);
      }
      o2.detune.value = 18;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.03);
      g.gain.setTargetAtTime(0.0001, t + dur * 0.62, dur * 0.2);
      o.connect(f);
      o2.connect(f);
      f.connect(g).connect(out);
      o.start(t);
      o2.start(t);
      o.stop(t + dur + 0.2);
      o2.stop(t + dur + 0.2);
      t += dur + 0.06 + Math.random() * 0.12;
    }
  }

  private src(p: THREE.Vector3 | null, gain: number, muffled: boolean) {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.value = gain;
    const out = c.createGain();
    if (!p) {
      g.connect(out);
    } else {
      const pan = c.createPanner();
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'inverse';
      pan.refDistance = 3;
      pan.rolloffFactor = 1.1;
      pan.positionX.value = p.x;
      pan.positionY.value = p.y;
      pan.positionZ.value = p.z;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      const d = Math.hypot((c.listener.positionX?.value ?? p.x) - p.x, (c.listener.positionZ?.value ?? p.z) - p.z) || 0;
      lp.frequency.value = (muffled ? 900 : 15000) / (1 + d / 42);
      g.connect(lp).connect(pan).connect(out);
    }
    out.connect(this.dry);
    out.connect(this.roomG);
    out.connect(this.hallG);
    out.connect(this.streetG);
    return g;
  }

  private burst(dst: AudioNode, dur: number, gain: number, hp: number, lp: number, delay = 0) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const off = Math.random() * 1.5;
    const a = c.createBiquadFilter();
    a.type = 'highpass';
    a.frequency.value = hp;
    const b = c.createBiquadFilter();
    b.type = 'lowpass';
    b.frequency.value = lp;
    const g = c.createGain();
    const t = c.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    s.connect(a).connect(b).connect(g).connect(dst);
    s.start(t, off, dur + 0.02);
  }

  private thump(dst: AudioNode, f0: number, f1: number, dur: number, gain: number, delay = 0, type: OscillatorType = 'sine') {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    const g = c.createGain();
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g).connect(dst);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** thunder: a crack if it's close, then the roll going on and on */
  thunder(delay: number, near: number) {
    const c = this.ctx;
    if (!c) return;
    const out = c.createGain();
    out.gain.value = 1;
    out.connect(this.dry);
    out.connect(this.streetG);
    if (near > 0.5) this.burst(out, 0.35, 0.5 * near, 600, 5000, delay);
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160 + near * 220;
    const g = c.createGain();
    const t = c.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * (0.5 + near * 0.5), t + 0.12 + (1 - near) * 0.5);
    g.gain.setTargetAtTime(0.35, t + 0.6, 0.6);
    g.gain.setTargetAtTime(0.0, t + 1.8, 1.4);
    s.connect(lp).connect(g).connect(out);
    s.start(t, Math.random());
    s.stop(t + 9);
  }

  /** an empty building at night: a low draught through it that swells and falls, water dripping (more of it underground),
   * and once in a while a long groan from the structure. ear: where I am; under: below ground */
  private dreadG: GainNode | null = null;
  private dreadF!: BiquadFilterNode;
  private dreadT = 0;
  private dripT = 1;
  dread(ear: THREE.Vector3, under: boolean, dt: number, on: boolean) {
    const c = this.ctx;
    if (!c) return;
    if (!this.dreadG) {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.playbackRate.value = 0.5;
      this.dreadF = c.createBiquadFilter();
      this.dreadF.type = 'lowpass';
      this.dreadF.frequency.value = 140;
      this.dreadF.Q.value = 2.5;
      this.dreadG = c.createGain();
      this.dreadG.gain.value = 0;
      s.connect(this.dreadF).connect(this.dreadG).connect(this.dry);
      s.start();
    }
    const t = c.currentTime;
    this.dreadT += dt;
    const swell = 0.5 + 0.5 * Math.sin(this.dreadT * 0.21) * Math.sin(this.dreadT * 0.077 + 1);
    this.dreadG.gain.setTargetAtTime(on ? (under ? 0.11 : 0.07) * (0.45 + swell * 0.8) : 0, t, 0.5);
    if (!on) return;
    this.dreadF.frequency.setTargetAtTime(90 + swell * 120, t, 0.8);
    this.dripT -= dt;
    if (this.dripT <= 0) {
      this.dripT = (under ? 0.5 : 2.2) + Math.random() * (under ? 1.6 : 5);
      const a = Math.random() * 6.283, d = 1.5 + Math.random() * 7;
      this.drip(new THREE.Vector3(ear.x + Math.cos(a) * d, ear.y + 0.5 - Math.random() * 1.6, ear.z + Math.sin(a) * d));
    }
  }

  /** one drop into a puddle: a short falling tone and a tick */
  drip(p: THREE.Vector3) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    const f = 900 + Math.random() * 1400;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.05);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g).connect(this.src(p, 0.9, false));
    o.start(t);
    o.stop(t + 0.1);
  }

  /** the structure itself: a deep slow groan, far off */
  groan(p: THREE.Vector3) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f0 = 38 + Math.random() * 20;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * 0.82, t + 2.6);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    lp.Q.value = 8;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.9);
    g.gain.linearRampToValueAtTime(0, t + 2.8);
    o.connect(lp).connect(g).connect(this.src(p, 1.6, true));
    o.start(t);
    o.stop(t + 3);
  }

  /** somewhere in the building, something gives: a long creak of metal or wood */
  creak(p: THREE.Vector3) {
    const c = this.ctx;
    if (!c) return;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const t = c.currentTime;
    const f0 = 70 + Math.random() * 90;
    o.frequency.setValueAtTime(f0, t);
    for (let i = 1; i < 8; i++) o.frequency.linearRampToValueAtTime(f0 * (0.85 + Math.random() * 0.4), t + i * 0.16);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600 + Math.random() * 700;
    bp.Q.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.15);
    g.gain.setValueAtTime(0.4, t + 0.9);
    g.gain.linearRampToValueAtTime(0, t + 1.3);
    o.connect(bp).connect(g).connect(this.src(p, 1.4, true));
    o.start(t);
    o.stop(t + 1.4);
  }

  shot(w: number, p: THREE.Vector3 | null, muffled = false) {
    if (!this.ctx) return;
    const id: WeaponId = WEAPON_LIST[w];
    const k = { carbine: [0.95, 170, 0.09], shotgun: [1.2, 105, 0.16], rifle: [1.3, 120, 0.15], pistol: [0.72, 215, 0.07] }[id] as number[];
    const dst = this.src(p, p ? 1 : 0.8, muffled);
    this.burst(dst, 0.06, 1.1 * k[0], 1400, 13000);
    this.burst(dst, k[2] * 2.2, 0.9 * k[0], 240, 3400);
    this.thump(dst, k[1] * 1.9, k[1] * 0.42, k[2] * 1.6, 1.25 * k[0]);
    this.thump(dst, 65, 34, 0.19, 0.8 * k[0]);
    if (!p) this.burst(dst, 0.024, 0.45, 2600, 9000, 0.03 + Math.random() * 0.01);
  }

  dry_(p: THREE.Vector3 | null) {
    if (!this.ctx) return;
    this.burst(this.src(p, 0.3, false), 0.018, 0.5, 2100, 9000);
  }

  /** mechanical sounds: a mag, a bolt, a pump */
  clack(p: THREE.Vector3 | null, kind: 'mag_out' | 'mag_in' | 'bolt' | 'pump_a' | 'pump_b' | 'shell' | 'draw') {
    if (!this.ctx) return;
    const d = this.src(p, 0.42, false);
    const T: Record<string, [number, number, number, number]> = { mag_out: [0.03, 700, 3400, 1], mag_in: [0.022, 1100, 6200, 1.2], bolt: [0.03, 1400, 7200, 1.1], pump_a: [0.05, 500, 3000, 1.2], pump_b: [0.04, 800, 4300, 1.3], shell: [0.018, 2000, 8000, 0.8], draw: [0.05, 360, 2200, 0.7] };
    const [dur, h, l, g] = T[kind];
    this.burst(d, dur, g, h, l);
    this.burst(d, dur * 0.6, g * 0.6, h * 1.6, l, dur * 0.7);
    this.thump(d, 240, 90, 0.04, 0.25);
  }

  step(p: THREE.Vector3 | null, surf: string, speed: number, gain = 1) {
    if (!this.ctx) return;
    const g = (0.1 + Math.min(0.45, speed * 0.075)) * gain;
    const d = this.src(p, g, false);
    if (surf === 'metal') {
      this.burst(d, 0.05, 0.9, 700, 5200);
      this.thump(d, 620, 310, 0.11, 0.24, 0, 'triangle');
    } else if (surf === 'wood') {
      this.thump(d, 170, 80, 0.07, 0.9);
      this.burst(d, 0.03, 0.4, 500, 2600);
    } else if (surf === 'wet') {
      this.burst(d, 0.09, 0.8, 900, 6200);
      this.burst(d, 0.05, 0.35, 2600, 8200, 0.03);
      this.thump(d, 110, 62, 0.05, 0.5);
    } else if (surf === 'grit') {
      this.burst(d, 0.11, 0.9, 1400, 7200);
      this.thump(d, 120, 70, 0.05, 0.5);
    } else if (surf === 'turf') {
      // a boot through long grass: a soft fall, and the swish after it
      this.thump(d, 95, 55, 0.07, 0.55);
      this.burst(d, 0.13, 0.42, 900, 3600, 0.015);
      this.burst(d, 0.08, 0.2, 2400, 6400, 0.06);
    } else if (surf === 'shingle') {
      // pebbles shifting under the heel
      for (let i = 0; i < 4; i++) this.burst(d, 0.022, 0.75, 1800, 8200, i * 0.024 + Math.random() * 0.016);
      this.thump(d, 130, 74, 0.05, 0.42);
    } else {
      this.thump(d, 120, 62, 0.06, 0.9);
      this.burst(d, 0.03, 0.34, 700, 3400);
    }
  }

  door(p: THREE.Vector3, opening: boolean) {
    if (!this.ctx) return;
    const d = this.src(p, 0.7, false);
    this.thump(d, opening ? 150 : 95, opening ? 95 : 56, 0.1, 0.8);
    this.burst(d, 0.03, 0.5, 1100, 4800);
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const t = c.currentTime + 0.04;
    o.frequency.setValueAtTime(opening ? 310 : 420, t);
    o.frequency.linearRampToValueAtTime(opening ? 520 : 240, t + 0.42);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.04, t + 0.1);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.44);
    o.connect(bp).connect(g).connect(d);
    o.start(t);
    o.stop(t + 0.46);
  }

  tink(p: THREE.Vector3) {
    if (!this.ctx) return;
    const d = this.src(p, 0.12, false);
    this.thump(d, 3200 + Math.random() * 1800, 2600, 0.05, 0.5, 0, 'triangle');
  }

  impact(p: THREE.Vector3, surf: string) {
    if (!this.ctx) return;
    const d = this.src(p, 0.3, false);
    if (surf === 'water') {
      this.burst(d, 0.09, 0.5, 700, 3800);
      this.burst(d, 0.16, 0.22, 2500, 7000, 0.05);
      return;
    }
    if (surf === 'soil') {
      this.thump(d, 150, 70, 0.06, 0.7);
      this.burst(d, 0.05, 0.4, 300, 2300);
      return;
    }
    if (surf === 'metal') this.thump(d, 1900 + Math.random() * 1300, 900, 0.09, 0.5, 0, 'triangle');
    else if (surf === 'glass') {
      for (let i = 0; i < 9; i++) this.burst(d, 0.05, 0.6, 3000, 11000, i * 0.022 + Math.random() * 0.03);
    }
    this.burst(d, 0.03, 0.6, surf === 'flesh' ? 200 : 700, surf === 'flesh' ? 1200 : 5200);
  }

  /** a round going off at an angle, tumbling */
  ricochet(p: THREE.Vector3) {
    if (!this.ctx) return;
    const d = this.src(p, 0.26, false);
    const f = 1500 + Math.random() * 1300;
    this.thump(d, f, f * 0.42, 0.34 + Math.random() * 0.2, 0.42, 0, 'sine');
    this.burst(d, 0.03, 0.5, 1800, 9000);
  }

  /** a bullet passing close */
  snap(p: THREE.Vector3) {
    if (!this.ctx) return;
    this.burst(this.src(p, 0.7, false), 0.022, 0.9, 2400, 11000);
  }

  /** the wearer's own chest: one in and one out, harder the worse it's going */
  breath(k: number) {
    if (!this.ctx) return;
    const d = this.src(null, 0.2 + k * 0.32, false);
    this.burst(d, 0.42, 0.34, 500, 2300);
    this.burst(d, 0.52, 0.42, 340, 1500, 0.62 - k * 0.2);
  }

  heart(k: number) {
    if (!this.ctx) return;
    const d = this.src(null, 0.34 + k * 0.4, false);
    this.thump(d, 62, 40, 0.13, 0.9);
    this.thump(d, 54, 36, 0.11, 0.62, 0.21);
  }

  /** cloth and tape */
  /** a rat, put up */
  /** a trolley somewhere in the shop, rolling a few metres on its own: the basket's rattle, one wheel that wants oil, slowing */
  trolley(p: THREE.Vector3) {
    if (!this.ctx) return;
    const d = this.src(p, 0.5, true);
    let t = 0, gap = 0.045;
    for (let i = 0; i < 46 && t < 3.2; i++) {
      const k = 1 - t / 3.4;
      this.burst(d, 0.02, 0.16 * k * (0.6 + Math.random() * 0.6), 1800, 7000, t);
      if (i % 5 === 0) this.burst(d, 0.05, 0.07 * k, 4200, 6800, t + 0.01);
      t += gap * (0.8 + Math.random() * 0.4);
      gap *= 1.035;
    }
    this.thump(d, 190, 120, 0.09, 0.5, t + 0.05, 'triangle');
    this.burst(d, 0.05, 0.3, 900, 5000, t + 0.05);
  }

  /** a tin comes off a shelf: the drop, two bounces, and it rolls until something stops it */
  tin(p: THREE.Vector3) {
    if (!this.ctx) return;
    const d = this.src(p, 0.55, true);
    let t = 0, g = 0.5;
    for (const dt of [0, 0.34, 0.2, 0.11]) {
      t += dt;
      this.thump(d, 1500 + Math.random() * 500, 900, 0.05, g, t, 'triangle');
      this.burst(d, 0.03, g * 0.5, 1500, 6000, t);
      g *= 0.55;
    }
    for (let i = 0; i < 16; i++) this.burst(d, 0.04, 0.06 * (1 - i / 16), 1200, 3800, t + 0.12 + i * 0.075);
  }

  squeak(p: THREE.Vector3) {
    if (!this.ctx) return;
    const d = this.src(p, 0.3, false);
    this.burst(d, 0.035, 0.32, 5200, 9500);
    this.burst(d, 0.03, 0.26, 6000, 10000, 0.07);
  }

  /** a pipe lets go: the bang of the coupling, then water under pressure for as long as it lasts */
  spray(p: THREE.Vector3, secs: number) {
    if (!this.ctx) return;
    const d = this.src(p, 1.1, false);
    this.burst(d, 0.09, 1.0, 300, 3800);
    this.burst(d, secs, 0.5, 1400, 9000, 0.05);
    this.burst(d, secs * 0.8, 0.3, 300, 1200, 0.1);
  }

  /** someone keys their radio: the squelch in your earpiece */
  radio() {
    if (!this.ctx) return;
    const d = this.src(null, 0.22, false);
    this.burst(d, 0.045, 0.4, 1700, 3400);
  }

  cloth() {
    if (!this.ctx) return;
    const d = this.src(null, 0.3, false);
    this.burst(d, 0.14, 0.5, 900, 5200);
    this.burst(d, 0.1, 0.34, 1600, 7000, 0.11);
  }

  /** a boot meeting something */
  boot(hit: boolean) {
    if (!this.ctx) return;
    const d = this.src(null, 0.6, false);
    this.burst(d, 0.1, 0.25, 500, 2400);
    if (hit) this.thump(d, 130, 52, 0.15, 1.1, 0.02);
  }

  hurt() {
    if (!this.ctx) return;
    const d = this.src(null, 0.5, false);
    this.thump(d, 90, 45, 0.16, 1);
    this.burst(d, 0.05, 0.3, 300, 1700);
  }

  boom(p: THREE.Vector3, flash: boolean) {
    if (!this.ctx) return;
    const d = this.src(p, 1.1, false);
    this.burst(d, 0.11, 1.2, 500, 11000);
    this.burst(d, 0.8, 1.2, 40, 900);
    this.thump(d, 120, 26, 0.9, 1.6);
    if (flash) this.burst(d, 0.3, 0.5, 3200, 12000);
  }

  /** sound shut out, then a thin whine back */
  deafen(sec: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(0.05, t);
    this.duck.gain.linearRampToValueAtTime(1, t + sec);
    this.ring.gain.cancelScheduledValues(t);
    this.ring.gain.setValueAtTime(0.09, t);
    this.ring.gain.linearRampToValueAtTime(0, t + sec * 1.1);
  }

  /** the feed dies: a short tone and the room gone */
  cut() {
    if (!this.ctx) return;
    const d = this.src(null, 0.16, false);
    this.thump(d, 1000, 1000, 0.32, 0.5, 0, 'square');
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(1, t + 0.32);
    this.duck.gain.linearRampToValueAtTime(0.25, t + 0.5);
    this.duck.gain.linearRampToValueAtTime(1, t + 4.5);
  }

  beep(hi = true) {
    if (!this.ctx) return;
    this.thump(this.src(null, 0.09, false), hi ? 1320 : 880, hi ? 1320 : 880, 0.08, 0.5, 0, 'sine');
  }
}
