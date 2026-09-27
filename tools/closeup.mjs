// Close-up studio shots of the car (src/dev/car.html). node tools/closeup.mjs <out.png> <cam x,y,z> <look x,y,z> [fov=30] [extra query]
import { chromium } from 'playwright-core';
const [out, cam, look, fov = '30', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/src/dev/car.html?team=rossa&cam=${cam}&look=${look}&fov=${fov}&yaw=0${extra}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(600);
await page.screenshot({ path: out });
await browser.close();
