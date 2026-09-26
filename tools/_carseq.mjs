// node tools/_carseq.mjs <path> <outPrefix> "<setup js>" "<js per shot 1>" "<js per shot 2>" ... (env W,H,WAIT seconds between shots)
import { chromium } from 'playwright-core';
const [path, out, setup, ...shots] = process.argv.slice(2);
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 720), GAP = +(process.env.WAIT ?? 3);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 600)); });
await page.goto(`http://localhost:5191${path}`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 150000 }).catch(() => console.log('no __ready'));
await page.waitForTimeout(2000);
console.log('setup', await page.evaluate(setup).catch((e) => 'ERR ' + e.message));
for (const [i, js] of shots.entries()) {
  console.log('shot', i, await page.evaluate(js).catch((e) => 'ERR ' + e.message));
  await page.waitForTimeout(GAP * 1000);
  await page.screenshot({ path: `${out}_${i}.png`, timeout: 120000 }).catch((e) => console.log('shot fail', i, e.message.slice(0, 80)));
}
await browser.close();
