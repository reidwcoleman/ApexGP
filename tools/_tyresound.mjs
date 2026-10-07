// Render the tyre fx offline through a scripted slide + lock-up and save a WAV. node tools/_tyresound.mjs <out.wav>
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/tools/blank.html`).catch(() => {});
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/`);
const data = await page.evaluate(async () => {
  const { makeBuffers } = await import('/src/core/audio/dsp.ts');
  const { CarFx } = await import('/src/core/audio/fx.ts');
  const SR = 44100, T = 9;
  const ctx = new OfflineAudioContext(1, SR * T, SR);
  const fx = new CarFx(ctx, makeBuffers(ctx));
  fx.out.connect(ctx.destination);
  const mix = { tyres: 1, wind: 0, buffet: 0 };
  // script: 0–3 s cornering slide building past the peak at 55 m/s; 3.5–7 s lock-up braking 80 → 20 m/s; 7.5–9 s scrub at 25 m/s
  const steps = Math.round(T * 60);
  for (let i = 0; i < steps; i++) {
    const t = i / 60;
    let st = { speed: 0, slip: 0, brake: 0, throttle: 0, surface: 0, onKerb: false, drs: false };
    if (t < 3.2) st = { ...st, speed: 55, slip: Math.min(1.35, t * 0.5), throttle: 0.4 };
    else if (t > 3.5 && t < 7) { const k = (t - 3.5) / 3.5; st = { ...st, speed: 80 - 60 * k, slip: 1.1, brake: 1 }; }
    else if (t > 7.4) st = { ...st, speed: 25, slip: 0.55, throttle: 0.3 };
    fx.update(1 / 60);
    // (offline: schedule against the render clock)
    const sv = ctx.suspend ? null : null;
    fx.set(st, mix, 1, t);
  }
  const buf = await ctx.startRendering();
  return Array.from(buf.getChannelData(0));
});
const SR = 44100;
const n = data.length;
const b = Buffer.alloc(44 + n * 2);
b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
b.write('data', 36); b.writeUInt32LE(n * 2, 40);
let peak = 0;
for (let i = 0; i < n; i++) { peak = Math.max(peak, Math.abs(data[i])); b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2); }
writeFileSync(out, b);
console.log('saved', out, 'peak', peak.toFixed(3));
await browser.close();
