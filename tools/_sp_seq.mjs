// Spielberg camera tour: node tools/_sp_seq.mjs <prefix> "skip:cam[:focus],skip:cam,..." [track]
import { chromium } from 'playwright-core';
const [prefix = 'shots/sp_tour', list = '20:tv', track = 'spielberg'] = process.argv.slice(2);
const url = `http://localhost:${process.env.PORT ?? 5191}/?track=${track}`;
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text()); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 }).catch(() => console.log('no __ready'));
for (const [i, item] of list.split(',').entries()) {
  const [skip, cam, focus] = item.split(':');
  const r = await page.evaluate(`(() => { const g = window.__game; g.debugSpectate({ skip: ${Number(skip)}, camera: '${cam}', ${focus ? `focus: ${Number(focus)},` : ''} laps: 3 }); const c = g.race.cars.find((k) => k.id === g.focusId) ?? g.race.cars[0]; return { s: Math.round(c.car.s), cam: g.cams.mode }; })()`).catch((e) => 'ERR ' + e.message);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${prefix}_${i}_${cam}.png`, timeout: 180000 });
  console.log(i, item, JSON.stringify(r));
}
await browser.close();
