// Heat haze check: a long lens down the main straight, and a chase view (exhaust plumes).
//   node tools/_hazeshot.mjs <out> <track> [time=midday] [sFrom sTo]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track, time = 'midday', sCam = '1180', sLook = '300'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text().slice(0, 300)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5191}/?track=${track}&demo=race&cam=chase&skip=8&weather=clear&time=${time}&quality=high`, { timeout: 300000 });
await page.waitForFunction(() => window.__ready === true && !!window.__park, null, { timeout: 600000 });
await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); });
await page.waitForTimeout(2500);
const st = await page.evaluate(() => ({ haze: window.__game.gfx.heatHaze, temp: window.__game.race.weatherState.trackTemp }));
console.log(JSON.stringify(st));
await page.screenshot({ path: `${out}/${track}_hz_chase.jpg`, quality: 90 });
for (const k of ['on', 'off']) {
  await page.evaluate(({ k, sCam, sLook }) => {
    const g = window.__game;
    if (k === 'off') { g.gfx.heatHaze = 0; g.gfx.heatExhaust = 0; g.__hzOff = true; }
    const p = g.trackPoint(Number(sCam), 12, 2.5), l = g.trackPoint(Number(sLook), 0, 1);
    g.freeCam = { pos: p, look: l, fov: 4 };
  }, { k, sCam, sLook });
  if (k === 'off') await page.evaluate(() => { const g = window.__game; const f = g.gfx; const orig = Object.getOwnPropertyDescriptor(f, 'heatHaze'); Object.defineProperty(f, 'heatHaze', { get: () => 0, set: () => {}, configurable: true }); Object.defineProperty(f, 'heatExhaust', { get: () => 0, set: () => {}, configurable: true }); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${track}_hz_tele_${k}.jpg`, quality: 90 });
}
await browser.close();
