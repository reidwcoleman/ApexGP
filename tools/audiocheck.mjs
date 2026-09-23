// Offline audio verification: renders the dev page's scripted lap through the real GameAudio graph
// (OfflineAudioContext in headless Chrome), pulls the samples back and analyses them.
//
//   node tools/audiocheck.mjs [--view chase|cockpit|tv] [--out shots/audio_lap.wav] [--spec] [--port 5190]
//                             [--solo exhaust,rasp,…] [--native] [--quiet] [--script lap|events]
//
// Prints per-250 ms: expected firing frequency (rpm/60·3), estimated firing pitch (harmonic sum
// search ±15 %), dominant spectral peak, RMS/peak — plus NaN / clipping / silence / level-jump stats.
// Writes a 16-bit stereo WAV (and a spectrogram PNG with --spec, via ffmpeg if installed).
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const flag = (k) => args.includes('--' + k);
const view = opt('view', 'chase');
const port = opt('port', '5190');
const out = opt('out', view === 'chase' ? 'shots/audio_lap.wav' : `shots/audio_lap_${view}.wav`);
const seconds = Number(opt('seconds', '8'));
const solo = opt('solo', null); // e.g. --solo exhaust,rasp  (layer levels, see GameAudio._solo)
const quiet = flag('quiet');
// the engine's rpm param glides with a ~16 ms time constant (+ one 16 ms control step)
const LAT = 0.025;

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
// (retry: the Vite dev server may hot-reload the page while other files are being edited)
let res = null;
for (let attempt = 1; attempt <= 4 && !res; attempt++) {
  try {
    await page.goto(`http://localhost:${port}/src/dev/audio.html?auto=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
    res = await page.evaluate((o) => window.__renderLap(o), { view, seconds, solo: solo ? solo.split(',') : undefined, native: flag('native'), script: opt('script', 'lap') });
  } catch (e) {
    console.log(`render attempt ${attempt} failed: ${e.message.split('\n')[0]}`);
  }
}
if (!res) process.exit(1);
await browser.close();
for (const e of errors.slice(0, 20)) console.log(e);

const dec = (b64) => {
  const b = Buffer.from(b64, 'base64');
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const L = dec(res.left);
const R = dec(res.right);
const sr = res.sampleRate;
const N = L.length;
const mono = new Float32Array(N);
for (let i = 0; i < N; i++) mono[i] = 0.5 * (L[i] + R[i]);
console.log(`rendered ${(N / sr).toFixed(2)} s @ ${sr} Hz in ${res.ms} ms (${res.worklet ? 'AudioWorklet' : 'native fallback'} engine), view=${view}`);

// ---------------------------------------------------------------------------------- stats
let nan = 0, clip = 0, hot = 0, peak = 0, bigJump = 0;
const jumpSec = new Set();
for (const ch of [L, R]) {
  for (let i = 0; i < N; i++) {
    const x = ch[i];
    if (!Number.isFinite(x)) { nan++; continue; }
    const a = Math.abs(x);
    if (a >= 0.999) clip++;
    if (a >= 0.891) hot++; // > −1 dBFS
    if (a > peak) peak = a;
    if (i && Math.abs(x - ch[i - 1]) > 0.6) { bigJump++; if (ch === L) jumpSec.add((i / sr).toFixed(1)); }
  }
}
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -200);

// Intentional transients: shifts (cut/crack, blip decay), overrun pops, limiter stutter, kerb/gravel,
// one-shot events (impacts, beeps, UI) and big throttle steps. Continuity is judged away from these.
const tlAll = res.timeline;
const evT = tlAll.filter((e, i) => e.shift !== 0 || e.act || (i > 0 && Math.abs(e.thr - tlAll[i - 1].thr) > 0.25)).map((e) => e.t);
const at = (t) => tlAll[Math.max(0, Math.min(tlAll.length - 1, Math.round(t / (tlAll[1].t - tlAll[0].t))))];
const expected = (t) => {
  if (evT.some((s) => t > s - 0.06 && t < s + 0.3)) return true;
  const e = at(t);
  return e.thr < 0.1 || e.limiter || e.surf === 1 || e.surf === 4;
};
// click detector: 2nd-difference spikes far above the local (50 ms) 2nd-difference level
let clicks = 0, clicksExp = 0;
const clickAt = [];
{
  const d2 = new Float32Array(N);
  for (let i = 2; i < N; i++) d2[i] = Math.abs(mono[i] - 2 * mono[i - 1] + mono[i - 2]);
  const W = Math.floor(sr * 0.05);
  for (let b = 0; b + W <= N; b += W) {
    let ss = 0;
    for (let i = b; i < b + W; i++) ss += d2[i] * d2[i];
    const rmsd = Math.sqrt(ss / W);
    let mx = 0, atI = b;
    for (let i = b; i < b + W; i++) if (d2[i] > mx) { mx = d2[i]; atI = i; }
    const at = atI;
    if (mx > 12 * rmsd && mx > 0.02) {
      if (expected(at / sr)) clicksExp++;
      else { clicks++; clickAt.push((at / sr).toFixed(2)); }
    }
  }
}

// ---------------------------------------------------------------------------------- FFT
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}
const NF = 8192;
const hann = new Float64Array(NF).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (NF - 1)));
function spectrum(center) {
  const re = new Float64Array(NF), im = new Float64Array(NF);
  const s0 = Math.round(center - NF / 2);
  for (let i = 0; i < NF; i++) {
    const k = s0 + i;
    re[i] = k >= 0 && k < N ? mono[k] * hann[i] : 0;
  }
  fft(re, im);
  const mag = new Float64Array(NF / 2);
  for (let i = 0; i < NF / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}
const binHz = sr / NF;
const magAt = (mag, f) => {
  const b = f / binHz;
  const i = Math.floor(b);
  if (i < 1 || i + 1 >= mag.length) return 0;
  // take the max of the neighbourhood (tolerant to slight smearing within the window)
  return Math.max(mag[i - 1] * 0.7, mag[i], mag[i + 1], mag[i + 2] * 0.7);
};

// ---------------------------------------------------------------------------------- per window
const HOP = 0.25;
const tl = res.timeline;
const rows = [];
for (let t0 = 0; t0 + HOP <= N / sr + 1e-6; t0 += HOP) {
  const i0 = Math.floor(t0 * sr), i1 = Math.min(N, Math.floor((t0 + HOP) * sr));
  let ss = 0, pk = 0;
  for (let i = i0; i < i1; i++) {
    ss += mono[i] * mono[i];
    pk = Math.max(pk, Math.abs(mono[i]));
  }
  const rms = Math.sqrt(ss / Math.max(1, i1 - i0));
  // analysis window: the central 8192 samples (≈170 ms) of this 250 ms slot
  const c = (i0 + i1) / 2;
  const tc = c / sr;
  const tw0 = tc - NF / 2 / sr, tw1 = tc + NF / 2 / sr;
  const sl = tl.filter((e) => e.t + LAT >= tw0 && e.t + LAT <= tw1);
  const rpm = sl.reduce((a, e) => a + e.rpm, 0) / Math.max(1, sl.length);
  const rpmMin = Math.min(...sl.map((e) => e.rpm)), rpmMax = Math.max(...sl.map((e) => e.rpm));
  const gear = sl.length ? sl[Math.floor(sl.length / 2)].gear : 0;
  const thr = sl.reduce((a, e) => a + e.thr, 0) / Math.max(1, sl.length);
  const shifted = sl.some((e) => e.shift !== 0);
  const opp = sl.some((e) => e.opp >= 0 && e.opp < 35);
  const lim = sl.some((e) => e.limiter);
  // expected firing frequency = rpm/60·3, times the doppler factor in tv view
  const dop = sl.reduce((a, e) => a + (e.dop ?? 1), 0) / Math.max(1, sl.length);
  const dopSpan = sl.length ? Math.max(...sl.map((e) => e.dop ?? 1)) / Math.min(...sl.map((e) => e.dop ?? 1)) : 1;
  const fExp = (rpm / 20) * dop;
  const mag = spectrum(c);
  // dominant peak 60–4000 Hz
  let best = 0, bi = 0;
  for (let i = Math.floor(60 / binHz); i < 4000 / binHz; i++) if (mag[i] > best) { best = mag[i]; bi = i; }
  let dom = bi * binHz;
  if (bi > 0) {
    const a = mag[bi - 1], b = mag[bi], g = mag[bi + 1];
    const p = (0.5 * (a - g)) / (a - 2 * b + g || 1);
    dom = (bi + p) * binHz;
  }
  // firing pitch: harmonic-sum search ±15 % around the expected firing frequency
  let bestF = fExp, bestS = -1e9;
  for (let r = 0.85; r <= 1.15; r += 0.001) {
    const f = fExp * r;
    let sc = 0;
    for (let k = 1; k <= 6; k++) sc += Math.log10(magAt(mag, f * k) + 1e-9) / Math.sqrt(k);
    if (sc > bestS) { bestS = sc; bestF = f; }
  }
  // share of 80–6000 Hz energy that sits on firing harmonics (±2.5 %) or half-orders
  let eTot = 0, eH = 0;
  for (let i = Math.floor(80 / binHz); i < 6000 / binHz; i++) {
    const f = i * binHz;
    const e = mag[i] * mag[i];
    eTot += e;
    const h = f / (bestF / 2); // in half-order units
    if (Math.abs(h - Math.round(h)) * (bestF / 2) < Math.max(binHz * 1.5, 0.025 * f)) eH += e;
  }
  rows.push({ t0, dopSpan, gear, rpm, rpmMin, rpmMax, fExp, fEst: bestF, err: bestF / fExp - 1, dom, domRatio: dom / fExp, rms, pk, thr, shifted, opp, lim, harm: eH / (eTot || 1) });
}

if (!quiet) console.log('\n  t(s)  g   rpm(avg)  fire(exp)  fire(est)   err%   dominant(×fire)   harm%  RMS dBFS  pk dBFS  notes');
for (const r of quiet ? [] : rows) {
  const notes = [r.shifted ? 'shift' : '', r.thr > 0.5 ? 'on-throttle' : r.thr < 0.1 ? 'overrun' : 'part', r.opp ? 'OPP-near' : '', r.lim ? 'limiter' : ''].filter(Boolean).join(' ');
  console.log(
    `${r.t0.toFixed(2).padStart(6)}  ${String(r.gear).padStart(1)}  ${r.rpm.toFixed(0).padStart(7)}  ${r.fExp.toFixed(1).padStart(8)}  ${r.fEst.toFixed(1).padStart(9)}  ${(r.err * 100).toFixed(2).padStart(6)}  ${r.dom.toFixed(1).padStart(8)} (${r.domRatio.toFixed(2)}×)  ${(r.harm * 100).toFixed(0).padStart(5)}  ${db(r.rms).toFixed(1).padStart(8)}  ${db(r.pk).toFixed(1).padStart(7)}  ${notes}`,
  );
}

// level continuity on 50 ms blocks
const B = Math.floor(sr * 0.05);
const blk = [];
for (let i = 0; i + B <= N; i += B) {
  let ss = 0;
  for (let k = i; k < i + B; k++) ss += mono[k] * mono[k];
  blk.push(db(Math.sqrt(ss / B)));
}
// shift events (torque cut / blip) are intentional level steps: judge continuity elsewhere
const nearShift = (t) => evT.some((s) => t > s - 0.06 && t < s + 0.3) || at(t).surf === 4 || at(t).thr < 0.1; // overrun = afterfire pops
let maxJump = 0, jumps6 = 0, silent = 0, shiftJump = 0;
const jumpAt = [];
for (let i = 1; i < blk.length; i++) {
  const j = Math.abs(blk[i] - blk[i - 1]);
  const t = i * 0.05;
  if (t < 0.15) continue; // start-up (sources fading in from silence)
  if (nearShift(t)) { shiftJump = Math.max(shiftJump, j); continue; }
  maxJump = Math.max(maxJump, j);
  if (j > 6) { jumps6++; jumpAt.push(t.toFixed(2)); }
}
for (const b of blk) if (b < -50) silent++;

// pitch tracking stats (steady windows: no shift inside, no nearby opponent, rpm span < 6 %)
const steady = rows.filter((r) => !r.shifted && !r.opp && (r.rpmMax - r.rpmMin) / r.rpm < 0.06 && r.dopSpan < 1.03 && r.rms > 0.004);
const errs = steady.map((r) => Math.abs(r.err)).sort((a, b) => a - b);
const med = errs.length ? errs[Math.floor(errs.length / 2)] : NaN;
const maxErr = errs.length ? errs[errs.length - 1] : NaN;
const bad = steady.filter((r) => Math.abs(r.err) > 0.03).length;
const harmMed = steady.map((r) => r.harm).sort((a, b) => a - b)[Math.floor(steady.length / 2)];
const rmsVals = rows.map((r) => db(r.rms));

console.log('\nsummary');
console.log(`  NaN samples            ${nan}`);
console.log(`  clipped (|x|≥0.999)    ${clip}`);
console.log(`  hot (> −1 dBFS)        ${hot}   peak ${db(peak).toFixed(2)} dBFS`);
console.log(`  click-like spikes      ${clicks} unexpected${clickAt.length ? ' at ' + clickAt.slice(0, 12).join(', ') + ' s' : ''} (+${clicksExp} intentional: shift crack, pops, kerb/gravel, one-shots)`);
console.log(`  sample jumps > 0.6     ${bigJump}${jumpSec.size ? ' (in ' + [...jumpSec].slice(0, 12).join(', ') + ' s)' : ''}`);
const rmsAll = db(Math.sqrt(mono.reduce((a, x) => a + x * x, 0) / N));
const rmsOn = db(Math.sqrt(rows.filter((r) => r.thr > 0.5).reduce((a, r) => a + r.rms * r.rms, 0) / Math.max(1, rows.filter((r) => r.thr > 0.5).length)));
const rmsOff = db(Math.sqrt(rows.filter((r) => r.thr < 0.1).reduce((a, r) => a + r.rms * r.rms, 0) / Math.max(1, rows.filter((r) => r.thr < 0.1).length)));
console.log(`  RMS 250 ms             min ${Math.min(...rmsVals).toFixed(1)}  max ${Math.max(...rmsVals).toFixed(1)} dBFS · overall ${rmsAll.toFixed(1)} · on-throttle ${rmsOn.toFixed(1)} · overrun ${rmsOff.toFixed(1)}`);
console.log(`  silent 50 ms blocks    ${silent} (< −50 dBFS)`);
console.log(`  50 ms level jumps      max ${maxJump.toFixed(1)} dB, ${jumps6} over 6 dB${jumpAt.length ? ' at ' + jumpAt.join(', ') + ' s' : ''} (away from events); at shifts/throttle steps/one-shots/overrun pops up to ${shiftJump.toFixed(1)} dB`);
console.log(`  pitch tracking         ${steady.length} steady windows: median |err| ${(med * 100).toFixed(2)} %, max ${(maxErr * 100).toFixed(2)} %, ${bad} over 3 %`);
console.log(`  harmonic energy share  median ${(harmMed * 100).toFixed(0)} % on firing orders/half-orders`);
const pass = nan === 0 && clip === 0 && silent === 0 && bad === 0 && jumps6 === 0 && clicks === 0;
console.log(`  RESULT                 ${pass ? 'PASS' : 'CHECK'}`);

// ---------------------------------------------------------------------------------- WAV
mkdirSync(dirname(out), { recursive: true });
const wav = Buffer.alloc(44 + N * 4);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + N * 4, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(sr, 24);
wav.writeUInt32LE(sr * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const q = (x) => Math.max(-32768, Math.min(32767, Math.round((Number.isFinite(x) ? x : 0) * 32767)));
  wav.writeInt16LE(q(L[i]), 44 + i * 4);
  wav.writeInt16LE(q(R[i]), 46 + i * 4);
}
writeFileSync(out, wav);
console.log(`\nsaved ${out}`);
if (flag('spec')) {
  const png = out.replace(/\.wav$/, '_spec.png');
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-lavfi', 'showspectrumpic=s=1600x800:mode=combined:scale=log:fscale=lin:stop=8000:legend=1', png]);
    console.log(`saved ${png}`);
  } catch (e) {
    console.log('spectrogram skipped: ' + e.message);
  }
}
