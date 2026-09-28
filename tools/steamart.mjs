// Beauty frames for the Steam store capsules (steam/art/raw). node tools/steamart.mjs
import { chromium } from 'playwright-core';
const SHOTS = [
  { track: 'spa', time: 'golden', cam: 'chase', skip: 70, name: 'spa_chase' },
  { track: 'monza', time: 'afternoon', cam: 'tv', skip: 45, name: 'monza_tv' },
  { track: 'yasmarina', time: 'dusk', cam: 'chase', skip: 60, name: 'yas_chase' },
  { track: 'suzuka', time: 'sunset', cam: 'tcam', skip: 50, name: 'suzuka_tcam' },
];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:5191/?track=${s.track}&demo=race&cam=${s.cam}&skip=${s.skip}&weather=clear&time=${s.time}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; window.__game.adaptQuality = () => {}; window.__game.gfx.setDynamicScale(1); });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `steam/art/raw/${s.name}.png` });
  console.log('saved', s.name);
  await page.close();
}
await browser.close();
