// Screenshots from trackside viewpoints around a circuit (free camera), with a race running.
//   node tools/tour.mjs <track> [n=8] [outdir=shots/tour] [--h 3] [--lat 0] [--weather clear] [--time midday] [--skip 20]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const track = args[0] ?? 'monza';
const n = Number(args[1] ?? 8);
const out = args[2] && !args[2].startsWith('--') ? args[2] : 'shots/tour';
const H = Number(opt('h', 3)), LAT = Number(opt('lat', 0));
const q = new URLSearchParams({ track, demo: 'race', skip: opt('skip', '20'), weather: opt('weather', 'clear'), time: opt('time', 'midday'), settle: '500' });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(opt('w', 1600)), height: Number(opt('hgt', 900)) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?${q}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.evaluate(() => { document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none')); });
const L = await page.evaluate(() => window.__game.track.length);
for (let k = 0; k < n; k++) {
  const s = (L * k) / n + Number(opt('offset', 0));
  await page.evaluate(([s, H, LAT]) => {
    const g = window.__game;
    const pos = g.trackPoint(s, LAT, H);
    const look = g.trackPoint(s + 60, 0, 1);
    g.freeCam = { pos, look, fov: 62 };
  }, [s, H, LAT]);
  await page.waitForTimeout(Number(opt('wait', 900)));
  const f = `${out}/${track}_${String(k).padStart(2, '0')}.png`;
  await page.screenshot({ path: f });
  console.log('saved', f, 's', Math.round(s));
}
await browser.close();
