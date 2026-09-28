// Career flow: the map → a round's race screen → a race → results with "Next round" → the next circuit's race screen.
import { chromium } from 'playwright-core';
const out = 'shots/career';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto('http://localhost:5191/?track=monza');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.evaluate(() => window.__game.menu['cb'].onCareerRace('monza'));
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1_setup.png` });
const r1 = await page.evaluate(() => {
  const g = window.__game;
  g.menu['cb'].onStart('career', { ...g.menu.setup, grid: 1 });
  return { laps: g.race.opts.laps, weather: g.race.weatherState.kind, fc: g['careerForecast']('monza'), time: g['plan'].time, aiSpecClA: g.race.cars.find((c) => !c.isPlayer).car.spec.clA };
});
console.log('race', JSON.stringify(r1));
await page.waitForTimeout(3000);
// finish: a P2 (a medal, unlocks Spa) straight into the results
const r2 = await page.evaluate(() => {
  const g = window.__game;
  const p = g.race.player;
  p.position = 2;
  g['showResults']();
  return { best: g.career.data.best.monza, next: g.career.nextRound(), spaOpen: g.career.isUnlocked('spa'), fcAfter: g['careerFc'].get('monza') ?? null };
});
console.log('results', JSON.stringify(r2));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/2_results.png` });
// "Next round"
await page.evaluate(() => window.__game.menu['items'][0].select());
await page.waitForFunction(() => window.__game.track.def.id === 'spa' && window.__game.menu.screen === 'setup', null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/3_next_setup.png` });
console.log('next', JSON.stringify(await page.evaluate(() => ({ track: window.__game.track.def.id, fc: window.__game['careerForecast']('spa') }))));
await page.evaluate(() => { window.__game.menu.show('title'); window.__game.menu['setTab']('career'); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/4_map.png` });
await browser.close();
