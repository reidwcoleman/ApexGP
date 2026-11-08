// All sound is synthesized: steel on steel, volleys, horns, drums, crowd roar,
// and a modal lyre-and-drone score for the campaign.

class Audio {
  constructor() { this.ctx = null; this.muted = false; this.musicOn = true; this.amb = null; this.mode = null; this.last = {}; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.musBus = c.createGain(); this.musBus.gain.value = 0.38; this.musBus.connect(this.master);
    // a hall-ish reverb for music and horns
    this.verb = c.createConvolver();
    const len = c.sampleRate * 2.4, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.verb.buffer = ir;
    const vg = c.createGain(); vg.gain.value = 0.35; this.verb.connect(vg); vg.connect(this.master);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    if (this.mode) { const m = this.mode; this.mode = null; this.setMode(m); }
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); }

  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4; return s; }

  env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }

  // vol 0..1 already attenuated by distance
  sfx(name, vol = 1) {
    if (!this.ctx || this.muted || vol < 0.02) return;
    const now = this.ctx.currentTime;
    const gap = { clash: 0.035, death: 0.05, block: 0.06, volley: 0.25, impact: 0.08 }[name] ?? 0;
    if (gap && this.last[name] && now - this.last[name] < gap) return;
    this.last[name] = now;
    const c = this.ctx, out = this.sfxBus;
    const t = now + Math.random() * 0.02;
    if (name === 'clash' || name === 'block') {
      const n = this.noiseSrc(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500 + Math.random() * 2500; bp.Q.value = 6;
      const g = c.createGain(); this.env(g, t, 0.002, 0.35 * vol, 0.09);
      n.connect(bp); bp.connect(g); g.connect(out); n.start(t); n.stop(t + 0.15);
      for (const f of [1700 + Math.random() * 900, 3100 + Math.random() * 1500]) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const og = c.createGain(); this.env(og, t, 0.001, 0.07 * vol, 0.25 + Math.random() * 0.2);
        o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.5);
      }
    } else if (name === 'death' || name === 'impact') {
      const n = this.noiseSrc(); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = name === 'impact' ? 500 : 280;
      const g = c.createGain(); this.env(g, t, 0.005, (name === 'impact' ? 0.7 : 0.35) * vol, 0.18);
      n.connect(lp); lp.connect(g); g.connect(out); n.start(t); n.stop(t + 0.3);
    } else if (name === 'volley') {
      const n = this.noiseSrc(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25 * vol, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      n.connect(bp); bp.connect(g); g.connect(out); n.start(t); n.stop(t + 1);
    } else if (name === 'horn') {
      this.horn(t, vol, 98);
    } else if (name === 'hornHigh') {
      this.horn(t, vol, 147);
    } else if (name === 'roar') {
      const n = this.noiseSrc(); const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 650; f1.Q.value = 2;
      const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 1400;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      n.connect(f1); f1.connect(f2); f2.connect(g); g.connect(out); g.connect(this.verb); n.start(t); n.stop(t + 2.8);
    } else if (name === 'drum') {
      const o = c.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
      const g = c.createGain(); this.env(g, t, 0.003, 0.7 * vol, 0.4);
      o.connect(g); g.connect(out); g.connect(this.verb); o.start(t); o.stop(t + 0.5);
    } else if (name === 'click') {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 900;
      const g = c.createGain(); this.env(g, t, 0.001, 0.12 * vol, 0.06); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.1);
    } else if (name === 'coin') {
      for (const [f, dt] of [[1320, 0], [1760, 0.07]]) { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const g = c.createGain(); this.env(g, t + dt, 0.002, 0.15 * vol, 0.25); o.connect(g); g.connect(out); o.start(t + dt); o.stop(t + dt + 0.3); }
    } else if (name === 'build') {
      for (let k = 0; k < 3; k++) { const n = this.noiseSrc(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 3; const g = c.createGain(); this.env(g, t + k * 0.14, 0.002, 0.3 * vol, 0.08); n.connect(bp); bp.connect(g); g.connect(out); n.start(t + k * 0.14); n.stop(t + k * 0.14 + 0.12); }
    } else if (name === 'fanfare') {
      [[0, 147], [0.25, 196], [0.5, 220], [0.9, 294]].forEach(([dt, f]) => this.horn(t + dt, vol * 0.8, f, 0.6));
    } else if (name === 'dirge') {
      [[0, 147], [0.6, 139], [1.2, 110]].forEach(([dt, f]) => this.horn(t + dt, vol * 0.7, f, 0.9));
    }
  }

  horn(t, vol, f, len = 1.5) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22 * vol, t + 0.12); g.gain.setValueAtTime(0.22 * vol, t + len * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(1600, t + 0.15); lp.frequency.linearRampToValueAtTime(900, t + len);
    for (const [mul, type] of [[1, 'sawtooth'], [1.5, 'sawtooth'], [2, 'square']]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f * mul;
      const vib = c.createOscillator(); vib.frequency.value = 5; const vg = c.createGain(); vg.gain.value = f * 0.006; vib.connect(vg); vg.connect(o.frequency);
      const og = c.createGain(); og.gain.value = mul === 2 ? 0.15 : 0.4;
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + len + 0.1); vib.start(t); vib.stop(t + len + 0.1);
    }
    lp.connect(g); g.connect(this.sfxBus); g.connect(this.verb);
  }

  // battle crowd bed whose loudness follows the fighting
  setBattleIntensity(x) {
    if (!this.ctx || !this.amb) return;
    this.amb.g.gain.setTargetAtTime(0.03 + Math.min(1, x) * 0.32, this.ctx.currentTime, 0.4);
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (!this.ctx) return;
    if (this.amb) { const a = this.amb; a.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4); setTimeout(() => a.src.stop(), 2000); this.amb = null; }
    clearInterval(this.musTimer);
    if (this.musGain) { const mg = this.musGain; mg.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6); setTimeout(() => mg.disconnect(), 3000); }
    const c = this.ctx;
    this.musGain = c.createGain(); this.musGain.gain.value = 0; this.musGain.connect(this.musBus); this.musGain.connect(this.verb);
    this.musGain.gain.setTargetAtTime(1, c.currentTime, 1.2);
    if (mode === 'battle') {
      const n = this.noiseSrc(); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650;
      const bp = c.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 900; bp.gain.value = 6;
      const g = c.createGain(); g.gain.value = 0.03;
      n.connect(lp); lp.connect(bp); bp.connect(g); g.connect(this.sfxBus); n.start();
      this.amb = { src: n, g };
      this.startMusic('battle');
    } else if (mode === 'campaign' || mode === 'menu') {
      this.startMusic('campaign');
    }
  }

  startMusic(kind) {
    const c = this.ctx;
    // D dorian / phrygian-tinged scale
    const scale = kind === 'battle' ? [146.8, 155.6, 174.6, 196, 220, 233.1, 261.6, 293.7] : [146.8, 164.8, 174.6, 196, 220, 246.9, 261.6, 293.7, 329.6, 349.2];
    let next = c.currentTime + 0.3, step = 0;
    const drone = () => {
      if (kind === 'battle') return;
      for (const f of [73.4, 110]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, next); g.gain.exponentialRampToValueAtTime(0.05, next + 2); g.gain.exponentialRampToValueAtTime(0.0001, next + 7.8);
        o.connect(lp); lp.connect(g); g.connect(this.musGain); o.start(next); o.stop(next + 8);
      }
    };
    let phrase = [];
    const gm = this.musGain;
    const tick = () => {
      if (this.musGain !== gm || !this.musicOn) return;
      while (next < c.currentTime + 0.6) {
        if (kind === 'battle') {
          const beat = step % 8;
          if ([0, 3, 4, 6].includes(beat)) this.drumAt(next, beat === 0 ? 0.55 : 0.32, gm);
          if (step % 32 === 0) this.hornAt(next, scale[0] / 2, 2.2, gm);
          if (step % 32 === 16) this.hornAt(next, scale[3] / 2, 1.6, gm);
          next += 0.24; step++;
        } else {
          if (step % 16 === 0) drone();
          if (!phrase.length) {
            let i = Math.floor(Math.random() * 4) + 2;
            for (let k = 0; k < 6; k++) { i = Math.max(0, Math.min(scale.length - 1, i + Math.floor(Math.random() * 5) - 2)); phrase.push(Math.random() < 0.2 ? -1 : i); }
            phrase.push(-1, -1);
          }
          const n = phrase.shift();
          if (n >= 0) this.pluck(next, scale[n], gm);
          if (step % 4 === 0 && Math.random() < 0.5) this.pluck(next, scale[0] / 2, gm, 0.5);
          next += step % 2 ? 0.42 : 0.5; step++;
        }
      }
    };
    this.musTimer = setInterval(tick, 150);
    tick();
  }

  pluck(t, f, out, vol = 1) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.01;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(500, t + 1.2);
    const g = c.createGain(); this.env(g, t, 0.004, 0.13 * vol, 1.6);
    const g2 = c.createGain(); g2.gain.value = 0.3;
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o2.start(t); o.stop(t + 1.8); o2.stop(t + 1.8);
  }
  drumAt(t, vol, out) {
    const c = this.ctx;
    const o = c.createOscillator(); o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.3);
    const g = c.createGain(); this.env(g, t, 0.003, vol * 0.5, 0.45);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.6);
  }
  hornAt(t, f, len, out) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    for (const m of [1, 1.5]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * m; o.connect(lp); o.start(t); o.stop(t + len); }
    lp.connect(g); g.connect(out);
  }
}

export const audio = new Audio();
