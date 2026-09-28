// The boot loader and the travel veil, mid-load. node tools/loadshot.mjs [to=spa] [outdir]
import { chromium } from 'playwright-core';
const [to = 'spa', out = 'shots/loading', w = '1440', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5191/?track=monza');
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/boot_${w}x${h}.png` });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
void page.evaluate((id) => window.__game.travelAsync(id), to);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/travel_${to}_${w}x${h}.png` });
await browser.close();
