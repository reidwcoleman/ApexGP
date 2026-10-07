// Wet-weather sheet: each weather:time scene booted once, shot through a list of cameras.
//   node tools/_wetshots.mjs <outdir> [track=monza] [weather:time,…] [cams=chase,cockpit,tv]   (env PORT, W, H, SKIP, FLASH=1)
// FLASH=1 also fires a lightning strike and shoots its peak (thunderstorm / storm scenes).
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import { mkdirSync } from 'node:fs';
const [out = 'shots/wet', track = 'monza', scenesArg = 'drizzle:midday,rain:midday,storm:midday,thunderstorm:sunset,sunshower:morning', camsArg = 'chase,cockpit,tv'] = process.argv.slice(2);
const cams = camsArg.split(',');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
for (const sc of scenesArg.split(',')) {
  const [weather, time] = sc.split(':');
  const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
  const t0 = Date.now();
  await page.goto(`http://localhost:${process.env.PORT ?? 5703}/?track=${track}&demo=race&cam=${cams[0]}&skip=${process.env.SKIP ?? 40}&weather=${weather}&time=${time}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  console.log(sc, 'ready in', Date.now() - t0, 'ms');
  await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; window.__game.adaptQuality = () => {}; window.__game.gfx.setDynamicScale(1); });
  for (const cam of cams) {
    await page.evaluate((c) => window.__game.cams.set(c), cam);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${weather}_${time}_${cam}.jpg`, quality: 88 });
    if (process.env.FLASH) {
      // fire a strike now and shoot inside its first return stroke
      await page.evaluate(() => { window.__game.race.weather.nextFlash = 0; });
      await page.waitForTimeout(Number(process.env.FLASH_MS ?? 60));
      await page.screenshot({ path: `${out}/${weather}_${time}_${cam}_flash.jpg`, quality: 88 });
    }
  }
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { if (++n < 90) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t))); }; requestAnimationFrame(f); }));
  console.log(sc, 'saved', cams.join(','), 'fps', fps);
  await page.close();
}
await browser.close();
