import { biquad, chain, clamp, gainNode, loopSource, makeBuffers, setT, smoothstep, type AudioBuffers } from '../core/audio/dsp.ts';
import { CarFx, impactSound } from '../core/audio/fx.ts';

/**
 * The open world's sound, all synthesised (the race game's noise buffers, tyre model and impact
 * thumps, plus its own voices): the Roadster's motor — the electric whine of three motors and the
 * inverter's switching tone, no combustion — the cold-gas thrusters' hiss, a combustion engine for
 * the city's cars and the bike, the helicopter's blade slap over its turbine, the seaplane's prop
 * buzz, the boat's outboards and hull slap; horns, honks and police sirens (wail / yelp, by
 * distance); and the city under it all: the traffic roar, the surf near the beach, rain.
 */

export interface AudioFrame {
  /** what the player is in */
  kind: 'roadster' | 'car' | 'bike' | 'heli' | 'plane' | 'boat' | 'foot';
  speed: number;
  throttle: number;
  brake: number;
  slip: number;
  /** cold-gas thrust 0..1 (boost or flight) */
  thrust: number;
  /** rotor / prop speed 0..1 */
  rpm: number;
  airborne: boolean;
  impact: number;
  horn: boolean;
  /** the player's own siren */
  siren: boolean;
  /** police sirens about: distance (m) to each */
  sirens: number[];
  honks: number[];
  /** distance to the surf (m) */
  surf: number;
  rain: number;
  /** a city density 0..1 around the listener */
  city: number;
  /** listener height above the ground (m) */
  height: number;
}

export class OpenWorldAudio {
  private ctx: AudioContext | null = null;
  private b!: AudioBuffers;
  private master!: GainNode;
  private sfx!: GainNode;
  private verb!: GainNode;
  private carFx!: CarFx;
  // the EV motor
  private evA!: OscillatorNode;
  private evB!: OscillatorNode;
  private evInv!: OscillatorNode;
  private evG!: GainNode;
  private evInvG!: GainNode;
  // combustion
  private iceA!: OscillatorNode;
  private iceB!: OscillatorNode;
  private iceLP!: BiquadFilterNode;
  private iceG!: GainNode;
  // thrusters
  private thrBP!: BiquadFilterNode;
  private thrG!: GainNode;
  private thrRoar!: GainNode;
  // rotor / prop
  private rotLFO!: OscillatorNode;
  private rotAM!: GainNode;
  private rotG!: GainNode;
  private turb!: OscillatorNode;
  private turbG!: GainNode;
  private prop!: OscillatorNode;
  private propG!: GainNode;
  // water
  private hullG!: GainNode;
  // horn
  private hornG!: GainNode;
  // sirens
  private sirOsc!: OscillatorNode;
  private sirG!: GainNode;
  private sirT = 0;
  // ambience
  private cityG!: GainNode;
  private surfG!: GainNode;
  private surfLFO!: OscillatorNode;
  private rainG!: GainNode;
  private windG!: GainNode;
  private lastImpact = 0;
  private volume = 0.8;
  ready = false;

  /** starts on the first gesture (browsers won't play before one) */
  arm() {
    const go = () => {
      this.init();
      removeEventListener('keydown', go);
      removeEventListener('pointerdown', go);
    };
    addEventListener('keydown', go);
    addEventListener('pointerdown', go);
  }

  private init() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
    const b = (this.b = makeBuffers(ctx));
    const comp = new DynamicsCompressorNode(ctx, { threshold: -14, knee: 8, ratio: 4, attack: 0.004, release: 0.2 });
    this.master = gainNode(ctx, this.volume);
    chain(comp, this.master, ctx.destination);
    this.sfx = gainNode(ctx, 1);
    this.sfx.connect(comp);
    // a short city reverb for the honks and sirens (the street canyons)
    const conv = new ConvolverNode(ctx, { buffer: b.ir });
    this.verb = gainNode(ctx, 0.5);
    chain(this.verb, conv, comp);

    this.carFx = new CarFx(ctx, b);
    this.carFx.out.connect(this.sfx);

    // ---- the EV motor: two motor orders and the inverter's whine
    this.evA = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 80 });
    this.evB = new OscillatorNode(ctx, { type: 'sine', frequency: 160 });
    const evBP = biquad(ctx, 'bandpass', 900, 0.9);
    this.evG = gainNode(ctx, 0);
    const evMix = gainNode(ctx, 0.5);
    this.evA.connect(evMix);
    this.evB.connect(evMix);
    chain(evMix, evBP, this.evG, this.sfx);
    this.evInv = new OscillatorNode(ctx, { type: 'triangle', frequency: 2400 });
    this.evInvG = gainNode(ctx, 0);
    chain(this.evInv, this.evInvG, this.sfx);
    this.evA.start();
    this.evB.start();
    this.evInv.start();

    // ---- combustion: a firing-order saw pair through a resonant lowpass + a bit of drive
    this.iceA = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 40 });
    this.iceB = new OscillatorNode(ctx, { type: 'square', frequency: 20 });
    const shaper = new WaveShaperNode(ctx, { curve: driveCurve(2.2) });
    this.iceLP = biquad(ctx, 'lowpass', 600, 2.5);
    this.iceG = gainNode(ctx, 0);
    const iceMix = gainNode(ctx, 0.4);
    this.iceA.connect(iceMix);
    this.iceB.connect(iceMix);
    chain(iceMix, shaper, this.iceLP, this.iceG, this.sfx);
    this.iceA.start();
    this.iceB.start();

    // ---- cold-gas thrusters: a hard hiss with a low roar under it
    this.thrBP = biquad(ctx, 'bandpass', 3200, 0.6);
    this.thrG = gainNode(ctx, 0);
    chain(loopSource(ctx, b.white), this.thrBP, this.thrG, this.sfx);
    const roarLP = biquad(ctx, 'lowpass', 220, 0.8);
    this.thrRoar = gainNode(ctx, 0);
    chain(loopSource(ctx, b.pink), roarLP, this.thrRoar, this.sfx);

    // ---- the rotor: blade-slap (noise chopped at the blade-pass rate) over the turbine
    this.rotLFO = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 0 });
    const rotShape = new WaveShaperNode(ctx, { curve: slapCurve() });
    this.rotAM = gainNode(ctx, 0);
    chain(this.rotLFO, rotShape);
    rotShape.connect(this.rotAM.gain);
    const rotLP = biquad(ctx, 'lowpass', 520, 0.9);
    this.rotG = gainNode(ctx, 0);
    chain(loopSource(ctx, b.pink), rotLP, this.rotAM, this.rotG, this.sfx);
    this.rotLFO.start();
    this.turb = new OscillatorNode(ctx, { type: 'sine', frequency: 300 });
    this.turbG = gainNode(ctx, 0);
    chain(this.turb, this.turbG, this.sfx);
    this.turb.start();
    // ---- the prop: a buzzing saw
    this.prop = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 60 });
    const propLP = biquad(ctx, 'lowpass', 700, 1.2);
    this.propG = gainNode(ctx, 0);
    chain(this.prop, propLP, this.propG, this.sfx);
    this.prop.start();

    // ---- water: hull slap and spray
    const hullBP = biquad(ctx, 'bandpass', 700, 0.5);
    this.hullG = gainNode(ctx, 0);
    chain(loopSource(ctx, b.crunch, 0.45), hullBP, this.hullG, this.sfx);

    // ---- the horn: two detuned squares (a car's dual-tone horn, ~420 / 520 Hz)
    this.hornG = gainNode(ctx, 0);
    const hornLP = biquad(ctx, 'lowpass', 2200, 0.7);
    for (const f of [420, 523]) {
      const o = new OscillatorNode(ctx, { type: 'square', frequency: f });
      chain(o, hornLP);
      o.start();
    }
    chain(hornLP, this.hornG, this.sfx);

    // ---- the siren
    this.sirOsc = new OscillatorNode(ctx, { type: 'triangle', frequency: 800 });
    const sirShape = new WaveShaperNode(ctx, { curve: driveCurve(1.4) });
    this.sirG = gainNode(ctx, 0);
    chain(this.sirOsc, sirShape, this.sirG, this.sfx);
    this.sirG.connect(this.verb);
    this.sirOsc.start();

    // ---- the city: a distant traffic roar, the surf, rain, wind aloft
    const cityLP = biquad(ctx, 'lowpass', 380, 0.6);
    this.cityG = gainNode(ctx, 0);
    chain(loopSource(ctx, b.pink), cityLP, this.cityG, this.sfx);
    this.surfLFO = new OscillatorNode(ctx, { type: 'sine', frequency: 0.11 });
    const surfAM = gainNode(ctx, 0.5);
    const surfDepth = gainNode(ctx, 0.45);
    chain(this.surfLFO, surfDepth);
    surfDepth.connect(surfAM.gain);
    const surfBP = biquad(ctx, 'bandpass', 900, 0.4);
    this.surfG = gainNode(ctx, 0);
    chain(loopSource(ctx, b.white), surfBP, surfAM, this.surfG, this.sfx);
    this.surfLFO.start();
    const rainHP = biquad(ctx, 'highpass', 1800, 0.5);
    this.rainG = gainNode(ctx, 0);
    chain(loopSource(ctx, b.white), rainHP, this.rainG, this.sfx);
    const windBP = biquad(ctx, 'bandpass', 400, 0.5);
    this.windG = gainNode(ctx, 0);
    chain(loopSource(ctx, b.pink), windBP, this.windG, this.sfx);
    this.ready = true;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  suspend() {
    void this.ctx?.suspend();
  }
  resume() {
    void this.ctx?.resume();
  }

  /** one-shot sounds by distance */
  honk(dist: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const g = gainNode(ctx, 0);
    const lp = biquad(ctx, 'lowpass', 1800, 0.7);
    const lvl = 0.18 / (1 + dist / 12);
    for (const f of [380 + Math.random() * 120, 470 + Math.random() * 120]) {
      const o = new OscillatorNode(ctx, { type: 'square', frequency: f });
      o.connect(lp);
      o.start(now);
      o.stop(now + 0.7);
    }
    chain(lp, g, this.sfx);
    g.connect(this.verb);
    const len = Math.random() < 0.4 ? 0.18 : 0.5;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(lvl, now + 0.01);
    g.gain.setValueAtTime(lvl, now + len);
    g.gain.linearRampToValueAtTime(0, now + len + 0.04);
  }

  crash(strength: number) {
    if (!this.ctx) return;
    impactSound(this.ctx, this.b, this.sfx, strength, this.ctx.currentTime);
  }

  update(dt: number, f: AudioFrame) {
    if (!this.ctx || !this.ready) return;
    const now = this.ctx.currentTime;
    const v = f.speed;
    const k = f.kind;
    // the EV motor (the Roadster; three motors, ~20 000 rpm at the top)
    const ev = k === 'roadster' ? 1 : 0;
    const mf = 55 + v * 9.5;
    setT(this.evA.frequency, mf, now, 0.03);
    setT(this.evB.frequency, mf * 2.02, now, 0.03);
    setT(this.evInv.frequency, 1800 + v * 38, now, 0.03);
    setT(this.evG.gain, ev * (0.05 + 0.12 * f.throttle + 0.05 * smoothstep(0, 40, v)) * (f.airborne ? 0.4 : 1), now, 0.05);
    setT(this.evInvG.gain, ev * 0.012 * (0.3 + f.throttle) * smoothstep(1, 20, v), now, 0.05);
    // combustion (city cars, the bike — the bike revs higher, harder)
    const ice = k === 'car' || k === 'bike' || k === 'boat' ? 1 : 0;
    const bike = k === 'bike';
    const gearV = bike ? 14 : 11;
    const g = Math.min(5, Math.floor(v / gearV));
    const rpm = (bike ? 2200 : 900) + (((v - g * gearV) / gearV) * 0.75 + 0.25 * f.throttle) * (bike ? 9000 : 4800) * (v < 0.5 ? 0.3 * f.throttle + 0.05 : 1);
    const fire = (rpm / 60) * (bike ? 2 : k === 'boat' ? 4 : 2);
    setT(this.iceA.frequency, fire, now, 0.04);
    setT(this.iceB.frequency, fire / 2, now, 0.04);
    setT(this.iceLP.frequency, 300 + f.throttle * 1400 + (bike ? 600 : 0), now, 0.05);
    setT(this.iceG.gain, ice * (0.07 + 0.13 * f.throttle) * (k === 'boat' ? 1.2 : 1), now, 0.05);
    // thrusters
    setT(this.thrG.gain, 0.22 * f.thrust, now, f.thrust > 0.1 ? 0.02 : 0.08);
    setT(this.thrRoar.gain, 0.3 * f.thrust, now, 0.05);
    setT(this.thrBP.frequency, 2400 + f.thrust * 2400, now, 0.05);
    // rotor: two blades, ~6.5 rev/s at flight rpm → 13 Hz slaps; the turbine whine
    const heli = k === 'heli' ? 1 : 0;
    setT(this.rotLFO.frequency, 13 * f.rpm, now, 0.1);
    setT(this.rotG.gain, heli * 0.55 * smoothstep(0.05, 0.6, f.rpm), now, 0.1);
    setT(this.turb.frequency, 260 + f.rpm * 2600, now, 0.2);
    setT(this.turbG.gain, heli * 0.025 * f.rpm, now, 0.1);
    // prop
    const plane = k === 'plane' ? 1 : 0;
    setT(this.prop.frequency, 30 + f.rpm * 85, now, 0.1);
    setT(this.propG.gain, plane * (0.04 + 0.12 * f.rpm), now, 0.08);
    // water
    setT(this.hullG.gain, (k === 'boat' ? 0.22 : k === 'plane' && !f.airborne ? 0.12 : 0) * smoothstep(1, 20, v), now, 0.1);
    // tyres + wind (ground vehicles)
    const ground = (k === 'roadster' || k === 'car' || k === 'bike') && !f.airborne;
    this.carFx.set(
      { speed: v, slip: ground ? f.slip : 0, brake: f.brake, throttle: f.throttle, surface: 0, onKerb: false, drs: false },
      { tyres: ground ? 1 : 0, wind: k === 'foot' ? 0 : 0.9, buffet: k === 'bike' ? 1 : 0.2 },
      1,
      now,
    );
    this.carFx.update(dt);
    // horn
    setT(this.hornG.gain, f.horn && k !== 'heli' && k !== 'plane' ? 0.1 : 0, now, 0.01);
    // sirens: the nearest one dominates; wail at a distance, yelp when it's on you
    let near = 1e9;
    for (const d of f.sirens) near = Math.min(near, d);
    if (f.siren) near = 2;
    this.sirT += dt;
    if (near < 600) {
      const yelp = near < 40;
      const ph = yelp ? (this.sirT * 3.2) % 1 : (Math.sin(this.sirT * 1.1) + 1) / 2;
      setT(this.sirOsc.frequency, 680 + ph * 820, now, 0.02);
      setT(this.sirG.gain, 0.12 / (1 + near / 40), now, 0.05);
    } else setT(this.sirG.gain, 0, now, 0.2);
    for (const d of f.honks) if (d < 160) this.honk(d);
    if (f.impact > 3 && now - this.lastImpact > 0.15) {
      this.lastImpact = now;
      this.crash(clamp(f.impact / 25, 0.1, 1));
    }
    // the city
    const aloft = smoothstep(20, 200, f.height);
    setT(this.cityG.gain, (0.05 + 0.1 * f.city) * (1 - 0.7 * aloft), now, 0.5);
    setT(this.surfG.gain, 0.16 * (1 - smoothstep(30, 260, f.surf)) * (1 - aloft), now, 0.5);
    setT(this.rainG.gain, 0.12 * f.rain, now, 0.5);
    setT(this.windG.gain, 0.08 * aloft + (k === 'foot' ? 0.01 : 0), now, 0.5);
  }
}

function driveCurve(k: number) {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return c;
}

/** a saw phase → a sharp blade slap per cycle, quiet between */
function slapCurve() {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1; // -1..1 over the cycle
    c[i] = 0.25 + 1.1 * Math.exp(-((x - 0.85) ** 2) / 0.006);
  }
  return c;
}
