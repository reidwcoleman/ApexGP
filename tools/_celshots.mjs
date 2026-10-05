// The podium ceremony, a frame every `every` s. node tools/_celshots.mjs <out> [track=monza] [every=2] [weather] [time]
import { chromium } from 'playwright-core';
const [out, track = 'monza', every = '2', weather = 'clear', time = 'afternoon'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&skip=30&weather=${weather}&time=${time}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
await page.waitForTimeout(2000);
await page.evaluate(() => { const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); g['startCelebration'](); });
await page.waitForFunction(() => window.__game.state === 'celebration', null, { timeout: 120000 });
const t0 = Date.now();
let k = 0;
while (true) {
  const st = await page.evaluate(() => [window.__game.state, window.__game.celebration?.time ?? -1]);
  if (st[0] !== 'celebration') break;
  await page.screenshot({ path: `${out}/cel_${String(k++).padStart(2, '0')}_${st[1].toFixed(1)}.jpg`, quality: 85 });
  await page.waitForTimeout(Number(every) * 1000);
  if (Date.now() - t0 > 120000) break;
}
console.log('frames', k);
await browser.close();
