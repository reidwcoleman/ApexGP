// Garage hub screenshots per tab. node tools/menushot.mjs [track] [tabs=race,career] [outdir]
import { chromium } from 'playwright-core';
const [track = 'monza', tabs = 'race,career', out = 'shots/menu'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto(`http://localhost:5191/?track=${track}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(1500);
for (const t of tabs.split(',')) {
  await page.evaluate((t) => window.__game.menu.setTabPublic?.(t) ?? window.__game.menu['setTab'](t), t);
  await page.waitForTimeout(Number(process.env.WAIT ?? 1500));
  await page.screenshot({ path: `${out}/${track}_${t}.png` });
  console.log('saved', t);
}
await browser.close();
