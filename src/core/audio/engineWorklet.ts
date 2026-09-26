/**
 * AudioWorklet source for the engine voice (loaded through a Blob URL — no files).
 *
 * Physical-ish model of a 1.6 L 90° V6 four-stroke:
 *  - a crank-phase accumulator fires 6 combustion events per 720° (firing frequency = rpm/60·3)
 *  - bank B's exhaust runners are slightly longer → its pulses arrive a little late, and every
 *    cylinder has its own strength → the uneven pulse train carries the half-order (rpm/120·k)
 *    components that give the V6 its gruff, "busy" edge instead of a clean buzz
 *  - each event drops a fractionally-positioned impulse (+ small random timing / amplitude
 *    jitter = combustion variability) into a pulse shaper whose width is part fixed time,
 *    part crank angle, and gets sharper with load
 *  - exhaust path: tail pipe waveguide (inverted, lossy reflection) → collector resonance →
 *    radiation high-pass. The resonances are fixed in Hz, so the harmonics sweep through
 *    them as revs rise (that moving formant is what makes it sound like an engine, not a synth)
 *  - rasp: white noise gated by each blowdown pulse (turbulent flow), band-passed downstream
 *  - intake: suction pulses through an airbox/trumpet resonator + induction roar noise
 *  - mechanical: valvetrain clicks ringing two metal resonances
 *  - overrun: weak, jittery pulses + random afterfire pops/crackles; limiter cuts ignition
 *
 * Outputs (full mode, 6 channels): 0 exhaust tone, 1 exhaust rasp (raw gated noise),
 * 2 intake tone, 3 induction roar (raw gated noise), 4 pops/crackle noise, 5 mechanical.
 * Mono mode (opponents): one pre-mixed exterior channel, intake/mech skipped (cheaper).
 */
export const ENGINE_WORKLET_SRC = /* js */ `
'use strict';
var SR = sampleRate;
var TWO_PI = 6.283185307179586;
function lpk(fc) { var k = 1 - Math.exp(-TWO_PI * fc / SR); return k > 1 ? 1 : k; }

class ApexEngine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 4200, minValue: 0, maxValue: 30000, automationRate: 'k-rate' },
      { name: 'rpmOfs', defaultValue: 0, minValue: -10000, maxValue: 10000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'dop', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' },
      { name: 'limiter', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'pops', defaultValue: 0, minValue: 0, maxValue: 8, automationRate: 'k-rate' },
      { name: 'bang', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
      { name: 'active', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor(options) {
    super();
    var po = (options && options.processorOptions) || {};
    this.mono = !!po.mono;
    var v = typeof po.variant === 'number' ? po.variant : 0.5;
    this.rs = (po.seed | 0) || 0x2545F491;
    this.phase = 0; this.base = 0; this.cyl = 0;
    var late = 0.008 + 0.012 * v;
    this.evPos = [0, 1 / 6 + late, 2 / 6 + 0.004, 3 / 6 + late - 0.002, 4 / 6 - 0.003, 5 / 6 + late + 0.002];
    this.nextEv = 0;
    this.cylAmp = [1.0, 0.83, 0.97, 0.87, 1.06, 0.8];
    this.cylIn = [0.92, 1.0, 0.88, 1.03, 0.95, 0.97];
    this.rEx = new Float32Array(256);
    this.rIn = new Float32Array(256);
    this.rMe = new Float32Array(256);
    this.rp = 0;
    this.cb1 = new Float32Array(2048);
    this.cb2 = new Float32Array(2048);
    this.cbi = new Float32Array(2048);
    this.cw = 0;
    this.st = new Float64Array(24);
    this.popEnv = 0; this.popDec = 0.99;
    this.limPh = 0; this.lastBang = -1; this.bangPend = 0;
    this.lastRpm = -1; this.lastLoad = 0; this.og = 1;
    this.dTail = 0.00215 * (0.9 + 0.2 * v);
    this.dColl = 0.00083 * (0.94 + 0.12 * v);
    this.dIn = 0.00105;
  }

  fire(frac, L, rpm, cut, pops, inc) {
    var c = this.cyl;
    var Lc = L > 1 ? 1 : L;
    // cylinder imbalance grows at low revs / low load → lumpy idle, gruff slow-corner burble
    var lump = 1 + 2.2 * (1 - Lc) * Math.min(1, Math.max(0, (7000 - rpm) / 2800));
    var a = Math.pow(this.cylAmp[c], lump) * (0.14 + 0.86 * L) * (1 + (0.05 + 0.2 * (1 - Lc)) * (Math.random() * 2 - 1));
    if (cut) a *= 0.1;
    var big = 0;
    if (this.bangPend) { this.bangPend = 0; a *= 1.35 + 0.45 * Math.random(); big = 0.12 + 0.22 * Math.random(); }
    if (L < 0.3 && rpm > 4500) {
      var pr = (0.0015 + 0.028 * pops) * (1 - L / 0.3) * Math.min(1, (rpm - 4500) / 3000);
      if (Math.random() < pr) { var q = Math.random(); if (0.2 + 0.8 * q * q > big) big = 0.2 + 0.8 * q * q; }
    }
    if (cut && Math.random() < 0.015) { var b2 = 0.25 + 0.4 * Math.random(); if (b2 > big) big = b2; }
    var cyc = 1 / inc;
    var pos = 2 + Math.random() * cyc * (0.0018 + 0.004 * (1 - Lc)) - frac;
    if (pos > 200) pos = 200;
    var ip = pos | 0, f = pos - ip, g = 1 - f;
    var w0 = (this.rp + ip) & 255, w1 = (w0 + 1) & 255;
    var ab = a + big * 1.6;
    this.rEx[w0] += ab * g; this.rEx[w1] += ab * f;
    if (!this.mono) {
      var ai = this.cylIn[c] * (0.2 + 0.8 * Lc) * (1 + 0.08 * (Math.random() * 2 - 1));
      this.rIn[w0] += ai * g; this.rIn[w1] += ai * f;
      var am = (0.35 + 0.65 * Math.random()) * (0.4 + 0.6 * Lc);
      this.rMe[w0] += am * g; this.rMe[w1] += am * f;
    }
    if (big > 0) {
      if (big > this.popEnv) this.popEnv = big;
      this.popDec = Math.exp(-1 / ((0.002 + 0.016 * big * Math.random()) * SR));
    }
    c = c + 1;
    if (c === 6) { c = 0; this.base += 1; }
    this.cyl = c;
    this.nextEv = this.base + this.evPos[c];
  }

  process(inputs, outputs, P) {
    var out = outputs[0];
    var o0 = out[0];
    var n = o0.length;
    if (P.active[0] < 0.5) { this.lastRpm = -1; return true; }
    if (this.base > 65536) { this.base -= 65536; this.phase -= 65536; this.nextEv -= 65536; }
    var mono = this.mono;
    var dop = P.dop[0]; if (!(dop > 0.25)) dop = 0.25;
    // engine off (rpm param < 300): fade to silence without a click
    var onT = P.rpm[0] < 300 ? 0 : 1;
    if (onT === 0 && this.og < 1e-4) { this.og = 0; this.lastRpm = -1; return true; }
    var og = this.og, ogK = 1 - Math.exp(-1 / (0.015 * SR));
    var rpmT = P.rpm[0] + P.rpmOfs[0]; if (!(rpmT > 400)) rpmT = 400; if (rpmT > 20000) rpmT = 20000;
    var loadT = P.load[0]; if (!(loadT > 0)) loadT = 0; if (loadT > 1.5) loadT = 1.5;
    var rpm0 = this.lastRpm < 0 ? rpmT : this.lastRpm;
    var L = this.lastRpm < 0 ? loadT : this.lastLoad;
    var dR = (rpmT - rpm0) / n, dLd = (loadT - L) / n;
    this.lastRpm = rpmT; this.lastLoad = loadT;
    // 1 = rev limiter (fast, hard stutter), 2 = pit-lane speed limiter (slower, softer burble)
    var lim = P.limiter[0] > 0.5;
    var pitLim = P.limiter[0] > 1.5;
    var limRate = pitLim ? 8.5 : 14.5, limDepth = pitLim ? 150 : 230, limDuty = pitLim ? 0.28 : 0.4;
    var pops = P.pops[0];
    var bang = P.bang[0];
    if (this.lastBang < 0) this.lastBang = bang;
    if (bang !== this.lastBang) { this.bangPend = 1; this.lastBang = bang; }

    // per-block coefficients
    var fC = 0.5 * (rpm0 + rpmT) / 120 * dop; if (fC < 3) fC = 3;
    var Lm = 0.5 * (L + loadT); if (Lm > 1) Lm = 1;
    var T = (0.00009 / dop + 0.0125 / fC) * (1.45 - 0.6 * Lm);
    var kS = 1 - Math.exp(-1 / (T * SR)), gS = 1 / kS;
    var TI = T * 1.8;
    var kI = 1 - Math.exp(-1 / (TI * SR)), gI = 1 / kI;
    var kE = 1 - Math.exp(-1 / (T * 3.0 * SR));
    var kEI = 1 - Math.exp(-1 / (TI * 2.2 * SR));
    var D1 = this.dTail * SR / dop, D2 = this.dColl * SR / dop, DI = this.dIn * SR / dop;
    var c1 = lpk(3000 * dop), c2 = lpk(5200 * dop), ci = lpk(2400 * dop);
    var g1 = -0.58, g2 = 0.3, gi = -0.5;
    var aH = Math.exp(-TWO_PI * 170 * dop / SR), aHI = Math.exp(-TWO_PI * 110 * dop / SR);
    // mechanical resonators
    var r1 = 0.984, r2 = 0.978;
    var w1 = TWO_PI * Math.min(3100 * dop, SR * 0.4) / SR, w2 = TWO_PI * Math.min(5300 * dop, SR * 0.4) / SR;
    var b11 = 2 * r1 * Math.cos(w1), b12 = -r1 * r1, b21 = 2 * r2 * Math.cos(w2), b22 = -r2 * r2;
    // mono-mode rasp band-pass (Chamberlin SVF)
    var fS = 2 * Math.sin(Math.PI * Math.min(2300 * dop, SR / 7) / SR), qS = 1.25;
    var raspAmt = 0.3 + 0.7 * Lm;

    var rEx = this.rEx, rIn = this.rIn, rMe = this.rMe;
    var cb1 = this.cb1, cb2 = this.cb2, cbi = this.cbi;
    var st = this.st;
    var s1 = st[0], s2 = st[1], e1 = st[2], l1 = st[3], l2 = st[4], hx = st[5], hy = st[6];
    var i1 = st[7], i2 = st[8], ei = st[9], li = st[10], hix = st[11], hiy = st[12];
    var m1 = st[13], m1b = st[14], m2 = st[15], m2b = st[16];
    var svL = st[17], svB = st[18];
    var rs = this.rs | 0;
    var cw = this.cw, rp = this.rp;
    var popEnv = this.popEnv, popDec = this.popDec;
    var o1 = out[1], o2 = out[2], o3 = out[3], o4 = out[4], o5 = out[5];
    var full = !mono && o5 !== undefined;

    for (var i = 0; i < n; i++) {
      var rpmS = rpm0 + dR * (i + 1);
      L += dLd;
      var cut = false;
      if (lim) {
        var lp = this.limPh + limRate / SR; if (lp >= 1) lp -= 1; this.limPh = lp;
        cut = lp < limDuty;
        rpmS -= limDepth * (cut ? lp / limDuty : 1 - (lp - limDuty) / (1 - limDuty));
      }
      var inc = rpmS / 120 * dop / SR;
      var ph = this.phase + inc;
      this.phase = ph;
      if (ph >= this.nextEv) {
        this.rp = rp; this.popEnv = popEnv;
        do { this.fire((ph - this.nextEv) / inc, L, rpmS, cut, pops, inc); } while (ph >= this.nextEv);
        popEnv = this.popEnv; popDec = this.popDec;
      }

      // ---- exhaust ----
      var x = rEx[rp]; rEx[rp] = 0;
      s1 += kS * (x * gS - s1);
      s2 += kS * (s1 - s2);
      e1 += kE * (s2 - e1);
      var rd = cw - D1, ri = Math.floor(rd), rf = rd - ri;
      var a0 = cb1[ri & 2047], a1 = cb1[(ri + 1) & 2047];
      l1 += c1 * (a0 + (a1 - a0) * rf - l1);
      var y1 = s2 + g1 * l1;
      cb1[cw] = y1;
      rd = cw - D2; ri = Math.floor(rd); rf = rd - ri;
      a0 = cb2[ri & 2047]; a1 = cb2[(ri + 1) & 2047];
      l2 += c2 * (a0 + (a1 - a0) * rf - l2);
      var y2 = y1 + g2 * l2;
      cb2[cw] = y2;
      var h = aH * (hy + y2 - hx); hx = y2; hy = h;

      rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5;
      var nz = rs * 4.656612873077393e-10;
      rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5;
      var nz2 = rs * 4.656612873077393e-10;
      var rasp = nz * e1;
      popEnv *= popDec;
      var pop = nz2 * popEnv;

      og += ogK * (onT - og);
      if (!full) {
        var inp = rasp * raspAmt * 2.2 + pop * 0.5;
        svL += fS * svB; var hp = inp - svL - qS * svB; svB += fS * hp;
        o0[i] = (h * 0.9 + svB * 0.9) * og;
      } else {
        o0[i] = h * og;
        o1[i] = rasp * og;
        o4[i] = pop * og;
        // ---- intake ----
        var xi = rIn[rp]; rIn[rp] = 0;
        i1 += kI * (xi * gI - i1);
        i2 += kI * (i1 - i2);
        ei += kEI * (i2 - ei);
        rd = cw - DI; ri = Math.floor(rd); rf = rd - ri;
        a0 = cbi[ri & 2047]; a1 = cbi[(ri + 1) & 2047];
        li += ci * (a0 + (a1 - a0) * rf - li);
        var yi = i2 + gi * li;
        cbi[cw] = yi;
        var hi = aHI * (hiy + yi - hix); hix = yi; hiy = hi;
        o2[i] = -hi * og;
        rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5;
        o3[i] = rs * 4.656612873077393e-10 * ei * og;
        // ---- mechanical ----
        var xm = rMe[rp]; rMe[rp] = 0;
        var mA = xm + b11 * m1 + b12 * m1b; m1b = m1; m1 = mA;
        var mB = xm + b21 * m2 + b22 * m2b; m2b = m2; m2 = mB;
        o5[i] = (mA * (1 - r1) + 0.6 * mB * (1 - r2)) * og;
      }
      rp = (rp + 1) & 255;
      cw = (cw + 1) & 2047;
    }

    st[0] = s1; st[1] = s2; st[2] = e1; st[3] = l1; st[4] = l2; st[5] = hx; st[6] = hy;
    st[7] = i1; st[8] = i2; st[9] = ei; st[10] = li; st[11] = hix; st[12] = hiy;
    st[13] = m1; st[14] = m1b; st[15] = m2; st[16] = m2b; st[17] = svL; st[18] = svB;
    // flush denormals / runaway
    for (var k = 0; k < 19; k++) { var sv = st[k]; if (!(sv > -1e6 && sv < 1e6) || (sv < 1e-20 && sv > -1e-20)) st[k] = 0; }
    this.rs = rs || 0x2545F491;
    this.cw = cw; this.rp = rp;
    this.popEnv = popEnv < 1e-6 ? 0 : popEnv; this.popDec = popDec;
    this.og = og;
    return true;
  }
}

registerProcessor('apex-engine', ApexEngine);
`;
