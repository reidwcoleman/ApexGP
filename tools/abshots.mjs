// Same race moment, several renderer toggles: node tools/abshots.mjs <outdir> <track> <cam> '<json {name: js}>'
// Freezes the sim (timeScale 0) so every variant renders the identical frame.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track = 'monza', cam = 'longlens', variants = '{"base":""}'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const V = JSON.parse(variants);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5190}/?track=${track}&demo=race&cam=${cam}&skip=${process.env.SKIP ?? 40}&weather=${process.env.WEATHER ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; window.__game.adaptQuality = () => {}; window.__game.gfx.setDynamicScale(1); });
await page.waitForTimeout(Number(process.env.SETTLE ?? 2500));
for (const [name, js] of Object.entries(V)) {
  if (js) await page.evaluate(js);
  await page.waitForTimeout(Number(process.env.GAP ?? 600));
  await page.screenshot({ path: `${out}/${cam}_${name}.jpg`, quality: 90 });
  console.log('saved', name);
}
await browser.close();
