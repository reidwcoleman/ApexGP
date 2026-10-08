// The 3D → impostor hand-over in place, in the real scene (src/dev/nature.html: the game's light,
// shadows and grade): one view shot with the trees as the game draws them, then with every tree
// switched to its impostor (veg.debug.reach = 0) — what a tree at the hand-over distance turns into.
//   node tools/treehand.mjs <out prefix> "<nature.html query>"   (env PORT, W, H)
// Writes <out>_3d.png and <out>_imp.png; compare them (or flip between them) by eye or by region.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out = 'shots/hand', query = 'track=monza&s=1500&lat=0&h=1.5&ahead=60&llat=-40&lh=6'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1600), height: Number(process.env.H ?? 900) }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5805}/src/dev/nature.html?${query}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}_3d.png` });
await page.evaluate(() => (window.__park.veg.debug.reach = 0));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}_imp.png` });
await browser.close();
