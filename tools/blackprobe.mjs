// Take N screenshots of a running demo, 1 s apart, and flag near-black frames.
//   node tools/blackprobe.mjs '/?demo=race&cam=far&weather=overcast&time=golden' [n] [interval ms]
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const path = process.argv[2];
const N = Number(process.argv[3] ?? 30);
const every = Number(process.argv[4] ?? 1000);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://localhost:5190' + path);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
mkdirSync('shots/probe', { recursive: true });
let bad = 0;
for (let i = 0; i < N; i++) {
  await page.waitForTimeout(every);
  const buf = await page.screenshot({ type: 'png' });
  // mean luma of the centre region via the page (decode PNG in browser)
  const mean = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 64; c.height = 36;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 64, 36);
    const d = g.getImageData(16, 4, 32, 20).data;
    let s = 0;
    for (let k = 0; k < d.length; k += 4) s += (d[k] + d[k + 1] + d[k + 2]) / 3;
    return s / (d.length / 4);
  }, buf.toString('base64'));
  const info = await page.evaluate(() => { const g = window.__game; const c = g.camera.position; return { s: Math.round(g.race.player.car.s), cam: [c.x, c.y, c.z].map((v) => Math.round(v)), fps: window.__fps }; });
  const flag = mean < 12 ? ' <<< DARK' : '';
  if (flag) { bad++; writeFileSync(`shots/probe/dark_${i}.png`, buf); }
  console.log(`${i} mean ${mean.toFixed(0)} s ${info.s} cam ${info.cam} fps ${info.fps}${flag}`);
}
console.log('dark frames', bad, '/', N, errs.length ? 'errors: ' + errs.slice(0, 5).join(' | ') : '');
await browser.close();
