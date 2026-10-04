// Frames from a running race every few seconds (glitch hunting). node tools/_lapshots.mjs <out> <track> [cam=chase] [n=24] [every=3.2]
import { chromium } from 'playwright-core';
const [out, track, cam = 'chase', n = '24', every = '3.2'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&cam=${cam}&skip=${process.env.SKIP ?? 15}&weather=${process.env.WX ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
await page.evaluate((cam) => { document.getElementById('ui').style.visibility = 'hidden'; const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); g.cams.set(cam); }, cam);
await page.waitForTimeout(2500);
for (let k = 0; k < Number(n); k++) {
  await page.screenshot({ path: `${out}/${track}_${cam}_${String(k).padStart(2, '0')}.jpg`, quality: 80 });
  await page.waitForTimeout(Number(every) * 1000);
}
await browser.close();
console.log('done');
