// The loading screens' pictures (public/loading/<name>.webp), framed for the art panel: a near-square
// frame (1200×1080 at 1.5×) with the car in the middle, no wordmark — the loader's panel (index.html,
// the travel veil) crops it to whatever is left of the window, centred.
//   node tools/loadart.mjs [name,name…]          (dev server: PORT, default 5196)
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHROME, ANGLE } from './chrome.mjs';
export const ART = [
  { name: 'yas_chase', track: 'yasmarina', time: 'dusk', weather: 'clear', cam: 'chase', skip: 60 },
  { name: 'suzuka_onboard', track: 'suzuka', time: 'sunset', weather: 'clear', cam: 'tcam', skip: 78 },
  { name: 'zandvoort_sunset', track: 'zandvoort', time: 'sunset', weather: 'clear', cam: 'chase', skip: 45 },
  { name: 'spa_rain', track: 'spa', time: 'afternoon', weather: 'rain', cam: 'chase', skip: 65 },
  { name: 'interlagos_rain', track: 'interlagos', time: 'afternoon', weather: 'rain', cam: 'chase', skip: 60 },
  { name: 'suzuka_dusk', track: 'suzuka', time: 'dusk', weather: 'clear', cam: 'chase', skip: 60 },
  { name: 'hungaroring_golden', track: 'hungaroring', time: 'golden', weather: 'clear', cam: 'chase', skip: 50 },
  { name: 'melbourne_golden', track: 'melbourne', time: 'golden', weather: 'clear', cam: 'chase', skip: 50 },
  { name: 'silverstone_drizzle', track: 'silverstone', time: 'afternoon', weather: 'drizzle', cam: 'chase', skip: 60 },
  { name: 'mexico_golden', track: 'mexico', time: 'golden', weather: 'haze', cam: 'chase', skip: 55 },
  { name: 'monza_sunset', track: 'monza', time: 'sunset', weather: 'clear', cam: 'chase', skip: 60 },
  { name: 'monza_rain', track: 'monza', time: 'golden', weather: 'sunshower', cam: 'chase', skip: 50 },
  { name: 'sakhir_night', track: 'sakhir', time: 'night', weather: 'clear', cam: 'chase', skip: 55 },
  { name: 'montreal_sunset', track: 'montreal', time: 'sunset', weather: 'clear', cam: 'chase', skip: 50 },
  { name: 'serena_golden', track: 'serena', time: 'golden', weather: 'clear', cam: 'chase', skip: 40 },
  { name: 'bergsee_valley', track: 'bergsee', time: 'morning', weather: 'clear', cam: 'chase', skip: 40 },
  { name: 'redmesa_golden', track: 'redmesa', time: 'golden', weather: 'clear', cam: 'chase', skip: 40 },
];
const want = process.argv[2]?.split(',');
const port = process.env.PORT ?? 5196;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loadart-'));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
for (const s of ART.filter((x) => !want || want.includes(x.name))) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1080 }, deviceScaleFactor: 1.5 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/?track=${s.track}&demo=race&cam=${s.cam}&skip=${s.skip}&weather=${s.weather}&time=${s.time}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
  await page.evaluate(() => {
    document.getElementById('ui').style.visibility = 'hidden';
    const g = window.__game;
    g.adaptQuality = () => {};
    g.gfx.setQuality('ultra');
    g.gfx.setDynamicScale(1);
    if (g.cams?.prefs) g.cams.prefs.mirror = false;
  });
  await page.waitForTimeout(3500);
  const png = path.join(tmp, `${s.name}.png`);
  await page.screenshot({ path: png });
  execFileSync('cwebp', ['-quiet', '-q', '80', '-m', '6', png, '-o', `public/loading/${s.name}.webp`]);
  console.log('saved', s.name, (fs.statSync(`public/loading/${s.name}.webp`).size / 1024).toFixed(0), 'KB');
  await page.close();
}
await browser.close();
