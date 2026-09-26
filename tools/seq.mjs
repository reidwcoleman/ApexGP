// Screenshot sequence: node tools/seq.mjs <path> <outPrefix> "<setup js>" t1,t2,t3 ["<per-shot js>"]
// Runs the setup (may be async), then screenshots at the given seconds after it.
import { chromium } from 'playwright-core';
const [path = '/', out = 'shots/seq', setup = '1', times = '1', perShot = ''] = process.argv.slice(2);
const url = path.startsWith('http') ? path : `http://localhost:${process.env.PORT ?? 5191}${path}`;
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text()); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }).catch(() => console.log('no __ready'));
await page.waitForTimeout(3000);
console.log('setup', await page.evaluate(setup).catch((e) => 'ERR ' + e.message));
const t0 = Date.now();
for (const [i, t] of times.split(',').map(Number).entries()) {
  const wait = t * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  if (perShot) console.log('shot', t, await page.evaluate(perShot).catch((e) => 'ERR ' + e.message));
  await page.screenshot({ path: `${out}_${i}.png`, timeout: 180000 });
}
await browser.close();
