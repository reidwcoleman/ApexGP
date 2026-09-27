// Look at the backdrop: from the circuit centre-ish, a camera at height h looking along compass bearings.
//   node tools/horizon.mjs <track> <bearings,...> [outdir=shots/hz] [--h 40] [--fov 40] [--time afternoon] [--weather clear]
import { chromium } from 'playwright-core';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [track = 'austin', bearings = '0,90,180,270'] = args;
const out = args[2] && !args[2].startsWith('--') ? args[2] : 'shots/hz';
const q = new URLSearchParams({ track, demo: 'race', skip: '20', weather: opt('weather', 'clear'), time: opt('time', 'afternoon'), settle: '500' });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?${q}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.evaluate(() => { document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none')); });
for (const b of bearings.split(',').map(Number)) {
  await page.evaluate(([b, h, fov, s]) => {
    const g = window.__game;
    const pos = g.trackPoint(g.track.length * s, 0, h);
    const r = (b * Math.PI) / 180;
    const look = [pos[0] + Math.sin(r) * 1000, pos[1] + 10, pos[2] - Math.cos(r) * 1000];
    g.freeCam = { pos, look, fov };
  }, [b, Number(opt('h', 40)), Number(opt('fov', 40)), Number(opt('s', 0.5))]);
  await page.waitForTimeout(900);
  const f = `${out}/${track}_b${b}.png`;
  await page.screenshot({ path: f });
  console.log('saved', f);
}
await browser.close();
