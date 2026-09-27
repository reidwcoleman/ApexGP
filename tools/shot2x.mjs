// Like shot.mjs but a Retina viewport (1440×900 CSS @2x) with the adaptive resolution running.
//   node tools/shot2x.mjs "<query>" out.png [waitMs=6000] [--eval js]
import { chromium } from 'playwright-core';
const [q, out, wait = '6000'] = process.argv.slice(2);
const evalI = process.argv.indexOf('--eval');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto(`http://localhost:5191/${q}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
if (evalI > 0) await page.evaluate(process.argv[evalI + 1]);
await page.waitForTimeout(Number(wait));
const info = await page.evaluate(() => ({ fps: window.__fps, gpu: window.__gpuMs, pr: window.__game.gfx.renderer.getPixelRatio(), dyn: window.__game.gfx.dynamicScale, q: window.__game.gfx.qualityLevel }));
await page.screenshot({ path: out });
console.log(out, JSON.stringify(info));
await browser.close();
