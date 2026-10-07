// Free camera at track distance s (fraction), height h, looking at a world point (x,y,z).
//   node tools/lookat.mjs <track> <x> <y> <z> <out.png> [--s 0.5] [--h 6] [--fov 40] [--time afternoon] [--lat 0]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [track, x, y, z, out] = args;
const q = new URLSearchParams({ track, demo: 'race', skip: '20', weather: opt('weather', 'clear'), time: opt('time', 'afternoon'), settle: '500' });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?${q}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.evaluate(() => { document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none')); });
await page.evaluate(([s, lat, h, fov, x, y, z]) => {
  const g = window.__game;
  g.freeCam = { pos: g.trackPoint(g.track.length * s, lat, h), look: [x, y, z], fov };
}, [Number(opt('s', 0.5)), Number(opt('lat', 0)), Number(opt('h', 6)), Number(opt('fov', 40)), Number(x), Number(y), Number(z)]);
await page.waitForTimeout(Number(opt('wait', 1500)));
await page.screenshot({ path: out });
await browser.close();
