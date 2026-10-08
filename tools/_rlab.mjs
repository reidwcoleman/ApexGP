// Frozen A/B of renderer toggles across several cameras from one boot: each camera is cut to and
// settled live, then the simulation is held (race.update, cams.update and the exposure meter stubbed: the frame and its exposure hold still) and every variant is shot in turn.
//   node tools/_rlab.mjs <out> <track> <cams> '{"name":"js", …}'   (env PORT, TIME, WEATHER, SETTLE, GAP, W, H)
// A variant's js runs before its shot and stays applied: put the reset of a toggle in the next variant.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track = 'monza', camsArg = 'chase,tv,longlens,heli', variants = '{"base":""}'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const V = JSON.parse(variants);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
const cams = camsArg.split(',');
await page.goto(`http://localhost:${process.env.PORT ?? 5190}/?track=${track}&demo=race&cam=${cams[0]}&skip=${process.env.SKIP ?? 40}&weather=${process.env.WEATHER ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.evaluate(() => { window.__game.adaptQuality = () => {}; window.__game.gfx.setDynamicScale(1); });
const hide = () => page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; });
for (const cam of cams) {
  await page.evaluate((c) => { const g = window.__game; if (g.race._upd) { g.race.update = g.race._upd; g.cams.update = g.cams._upd; g.gfx.grade.auto.update = g.gfx.grade.auto._upd; } g.directorOn = false; g.cams.set(c); }, cam);
  await hide();
  await page.waitForTimeout(Number(process.env.SETTLE ?? 2500));
  await page.evaluate(() => { const r = window.__game.race; r._upd = r._upd || r.update; r.update = () => {}; const c = window.__game.cams; c._upd = c._upd || c.update; c.update = () => {}; const a = window.__game.gfx.grade.auto; a._upd = a._upd || a.update; a.update = () => {}; });
  for (const [name, js] of Object.entries(V)) {
    if (js) await page.evaluate(js);
    await page.waitForTimeout(Number(process.env.GAP ?? 700));
    await page.screenshot({ path: `${out}/${track}_${cam}_${name}.jpg`, quality: 90 });
  }
  console.log('saved', cam);
}
await browser.close();
