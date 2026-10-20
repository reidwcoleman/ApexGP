// The race tab scrolled to the bottom (the scenic roads). node tools/_menuscroll.mjs <out> [track]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track = 'serena'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?track=${track}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__game.menu['setTab']('race'));
await page.waitForTimeout(1500);
await page.evaluate(() => { const c = document.querySelector('.ccard.scenic'); c?.scrollIntoView({ block: 'center' }); });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/race_scenic.png` });
await browser.close();
