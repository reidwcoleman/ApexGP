// Driver career, the real flow: a created driver's career starts (F2 grid, travel), the round's race
// screen, a race (specs checked), results with the career block, "Next round" to the next circuit.
//   node tools/dcflow.mjs [outDir=shots/dcflow]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [out = 'shots/dcflow'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto('http://localhost:5191/?track=spa');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.evaluate(() => {
  localStorage.removeItem('apexgp.drivercareer');
  const g = window.__game;
  g['startDriverCareer']({ first: 'Reid', last: 'Coleman', code: 'COL', number: 27, nationality: 'ITA', helmet: ['#ff2b3f', '#ffffff'], look: { skin: 0xf0cdb0, hair: 0x3a2a1e, style: 'short' } }, { series: 'f2', team: 'f2-invicta', seat: 1, until: new Date().getFullYear(), salary: 0.2, status: 'lead' });
});
await page.waitForFunction(() => window.__game.track.def.id === 'monza' && window.__game.worldProgress === 1, null, { timeout: 180000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__game.menu['cb'].onCareerRace(window.__game.dc.nextTrack));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/1_setup.png` });
await page.evaluate(() => window.__game.menu['cb'].onStart('career', { ...window.__game.menu.setup }));
await page.waitForTimeout(1500);
const r1 = await page.evaluate(() => {
  const g = window.__game;
  const p = g.race.player.car.spec, ai = g.race.cars.find((c) => !c.isPlayer).car.spec;
  return { laps: g.race.opts.laps, me: g.race.player.entry.driver.code, team: g.race.player.entry.team.name, pace: g.race.player.entry.team.pace, power: [p.power, ai.power].map((x) => Math.round(x)), clA: [p.clA, ai.clA].map((x) => +x.toFixed(2)) };
});
console.log('race', JSON.stringify(r1));
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const g = window.__game;
  g.race.player.position = 3;
  g['showResults']();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/2_results.png` });
console.log('after', JSON.stringify(await page.evaluate(() => { const d = window.__game.dc.data; return { round: d.round, rp: d.rp, ovr: window.__game.dc.ovr, last: d.last && { obj: d.last.objectives, rp: d.last.rp } }; })));
await page.evaluate(() => window.__game.menu['items'][0].select());
await page.waitForFunction(() => window.__game.track.def.id === 'spa' && window.__game.menu.screen === 'setup', null, { timeout: 180000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/3_next.png` });
console.log('next ok', await page.evaluate(() => window.__game.track.def.id));
await browser.close();
