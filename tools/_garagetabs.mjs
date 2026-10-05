// Garage hub: each tab's shot and each tour stop. node tools/_garagetabs.mjs <out> [track=monza] [tabs] [spots]
import { chromium } from 'playwright-core';
const [out, track = 'monza', tabs = 'race,career,highlights,car,setup,paint,settings', spots = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
await page.waitForTimeout(3000);
for (const t of tabs.split(',').filter(Boolean)) {
  await page.evaluate((t) => window.__game.menu['setTab'](t), t);
  await page.waitForTimeout(Number(process.env.WAIT ?? 3500));
  await page.screenshot({ path: `${out}/tab_${t}.jpg`, quality: 88 });
}
for (const sp of spots.split(',').filter(Boolean)) {
  await page.evaluate((sp) => window.__game['tourGo'](sp), sp);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/spot_${sp}.jpg`, quality: 88 });
}
console.log('done');
await browser.close();
