// The race intro, a frame from each shot. node tools/introshot.mjs [track] [times=1.5,4.8,8,11] [outdir]
import { chromium } from 'playwright-core';
const [track = 'monza', times = '1.5,4.8,8,11', out = 'shots/intro'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?track=${track}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.evaluate(() => { const g = window.__game; g.adaptQuality = () => {}; g['careerRace'] = true; g.menu.setup.grid = 1; g['startRace']('race', g['sessionSetup'](g.menu.setup)); });
let last = 0;
for (const t of times.split(',').map(Number)) {
  await page.waitForTimeout((t - last) * 1000);
  last = t;
  await page.screenshot({ path: `${out}/${track}_${t}.png` });
  console.log('saved', t, await page.evaluate(() => window.__game['stateTime'].toFixed(1)));
}
await browser.close();
