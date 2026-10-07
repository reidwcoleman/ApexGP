// In-race camera sheet: one race, several cameras.
//   node tools/raceshots.mjs <outdir> [track=monza] [cams=chase,tcam,cockpit,...] (env W,H,PORT,WEATHER,TIME,SKIP)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import { mkdirSync } from 'node:fs';
const [out = 'shots/game', track = 'monza', camsArg] = process.argv.slice(2);
const cams = (camsArg ?? 'chase,far,gtchase,tcam,halo,cockpit,helmet,nose,tv,longlens,heli').split(',');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
const t0 = Date.now();
await page.goto(`http://localhost:${process.env.PORT ?? 5190}/?track=${track}&demo=race&cam=${cams[0]}&skip=${process.env.SKIP ?? 40}&weather=${process.env.WEATHER ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
console.log('ready in', Date.now() - t0, 'ms');
await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; window.__game.adaptQuality = () => {}; window.__game.gfx.setDynamicScale(1); });
for (const cam of cams) {
  await page.evaluate((c) => window.__game.cams.set(c), cam);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${track}_${cam}.jpg`, quality: 88 });
  console.log('saved', cam);
}
await browser.close();
