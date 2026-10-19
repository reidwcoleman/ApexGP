// Record what Apex Lawn sounds like: play it headless (the ?auto bot mows) and capture the master bus.
//
//   node tools/lawnaudio.mjs <out.wav> "<query>" <seconds> [js to run after 4 s]
//
// Prints the level of each second (dBFS RMS / peak) so a mix can be judged without ears.
// The page must be served: npx vite --config vite.stable.config.mjs   (port 5191)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CHROME, ANGLE } from './chrome.mjs';

const [out, query = 'auto', secs = '12', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5191}/lawn.html?${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.evaluate(() => window.__lawn.begin());
await page.waitForTimeout(300);
await page.evaluate(() => {
  const a = window.__lawn.audio;
  const ctx = a.ctx;
  const dest = ctx.createMediaStreamDestination();
  a.master.connect(dest);
  const chunks = [];
  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
  rec.ondataavailable = (e) => chunks.push(e.data);
  window.__rec = { rec, chunks };
  rec.start();
});
if (extra) {
  await page.waitForTimeout(4000);
  await page.evaluate(extra);
  await page.waitForTimeout(Math.max(0, Number(secs) * 1000 - 4000));
} else await page.waitForTimeout(Number(secs) * 1000);
const b64 = await page.evaluate(
  () =>
    new Promise((res) => {
      const { rec, chunks } = window.__rec;
      rec.onstop = async () => {
        const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        res(btoa(s));
      };
      rec.stop();
    }),
);
fs.writeFileSync(out + '.webm', Buffer.from(b64, 'base64'));
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', out + '.webm', '-ac', '1', '-ar', '32000', out]);
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'f32le', '-ac', '1', '-ar', '32000', '-'], { maxBuffer: 1 << 28 });
const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const lines = [];
for (let s = 0; s * 32000 < x.length; s++) {
  let sum = 0;
  let pk = 0;
  const a = s * 32000;
  const b = Math.min(x.length, a + 32000);
  for (let i = a; i < b; i++) {
    sum += x[i] * x[i];
    pk = Math.max(pk, Math.abs(x[i]));
  }
  lines.push(`${s}s rms ${(20 * Math.log10(Math.sqrt(sum / (b - a)) + 1e-9)).toFixed(1)} peak ${(20 * Math.log10(pk + 1e-9)).toFixed(1)}`);
}
console.log(lines.join('\n'));
console.log('logs', logs.length ? logs : 'none');
await browser.close();
