// Runtime toggles shot back to back in one live race (no reboot between variants, so the moment barely moves):
//   node tools/_quickab.mjs <out> <weather> <time> <cam> '{"name":"js"}'   (env PORT, TRACK, SKIP, SETTLE, GAP)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, weather, time, cam, variants] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const V = JSON.parse(variants);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5703}/?track=${process.env.TRACK ?? 'monza'}&demo=race&cam=${cam}&skip=${process.env.SKIP ?? 40}&weather=${weather}&time=${time}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.evaluate((c) => { document.getElementById('ui').style.visibility = 'hidden'; window.__game.adaptQuality = () => {}; window.__game.gfx.setDynamicScale(1); window.__game.cams.set(c); }, cam);
await page.waitForTimeout(Number(process.env.SETTLE ?? 3000));
for (const [name, js] of Object.entries(V)) {
  if (js) await page.evaluate(js);
  await page.waitForTimeout(Number(process.env.GAP ?? 250));
  await page.screenshot({ path: `${out}/${cam}_${name}.jpg`, quality: 90 });
  console.log('saved', name);
}
await browser.close();
