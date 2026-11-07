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
    this.duck.connect(comp).connect(this.master).connect(c.destination);
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
    this.rainG.gain.setTargetAtTime(kind === 'street' ? 0.075 : 0.016, t, 0.3);
    this.humG.gain.setTargetAtTime(kind === 'small' ? 0.006 : 0, t, 0.3);
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
    const d = this.src(null, 0.16 + k * 0.2, false);
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
