// node tools/_parkeval.mjs "<js expression>" — evaluates in the world dev page after build, prints JSON
import { chromium } from 'playwright-core';
const expr = process.argv[2];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5190/src/dev/world.html?frames=5' + (process.argv[3] ?? ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const r = await page.evaluate(expr);
console.log(typeof r === 'string' ? r : JSON.stringify(r));
await browser.close();
