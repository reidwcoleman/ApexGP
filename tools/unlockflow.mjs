// The career's unlock chain, raced for real: a new driver career (F2, the real start: grid swap and
// travel), the first round's race screen, then the race itself at the career distance (5 laps) on
// autopilot, fast-forwarded in the page (Race.update at 60 Hz, nothing skipped). Attempt 1 is driven
// slowly (expect P6 or worse: the round stays locked and is offered again), attempt 2 from pole at
// full pace (expect the top five: the next round unlocks and "Next round" travels there). Prints
// the results and the career state after each, and shoots the race screen, both results screens
// and the map.
//   PORT=5191 node tools/unlockflow.mjs [outDir=shots/unlockflow] [slowPace=0.8]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [out = 'shots/unlockflow', slow = '0.8'] = process.argv.slice(2);
const PORT = process.env.PORT ?? '5191';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => (errors.push(e.message), console.log('[pageerror]', e.message)));
page.on('console', (m) => m.type() === 'error' && (errors.push(m.text()), console.log('[console]', m.text().slice(0, 300))));
await page.addInitScript(() => localStorage.removeItem('apexgp.drivercareer'));
await page.goto(`http://localhost:${PORT}/?track=spa`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.evaluate(() => {
  window.__game['startDriverCareer']({ first: 'Reid', last: 'Coleman', code: 'COL', number: 27, nationality: 'ITA', helmet: ['#ff2b3f', '#ffffff'], look: { skin: 0xf0cdb0, hair: 0x3a2a1e, style: 'short' } }, { series: 'f2', team: 'f2-invicta', seat: 1, until: new Date().getFullYear(), salary: 0.2, status: 'lead' });
});
await page.waitForFunction(() => window.__game.track.def.id === 'monza' && window.__game.worldProgress === 1, null, { timeout: 180000 });
await page.waitForTimeout(1500);
const state = () => page.evaluate(() => { const dc = window.__game.dc, d = dc.data; return { round: d.round, next: dc.nextTrack, tries: dc.tries, laps: dc.laps, starts: d.starts, points: d.points, results: d.results.map((r) => `${r.track} P${r.pos}`) }; });
console.log('start', JSON.stringify(await state()));

/** one attempt at the next round: its race screen, the race on autopilot, the results */
async function attempt(n, pace, grid) {
  const track = await page.evaluate(() => window.__game.dc.nextTrack);
  await page.evaluate((t) => window.__game.menu['cb'].onCareerRace(t), track);
  await page.waitForFunction(() => window.__game.menu.screen === 'setup', null, { timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/${n}_setup.png` });
  await page.evaluate((grid) => {
    const g = window.__game;
    // (the garage runs a session of its own behind the menu: wait for the round's race to replace it)
    window.__garageRace = g.race;
    g.menu['cb'].onStart('career', { ...g.menu.setup, grid });
  }, grid);
  await page.waitForFunction(() => window.__game.race !== window.__garageRace && window.__game.race.opts.mode === 'race' && window.__game.careerRace, null, { timeout: 60000 });
  // the player's car on autopilot at this pace (a fraction of the limit, like the AI's levels): the
  // game's own AIDriver, from the same module the game imports
  const info = await page.evaluate(async (pace) => {
    const g = window.__game;
    const { AIDriver } = await import('/src/sim/AIDriver.ts');
    g['autopilot'] = new AIDriver(pace, 0.5);
    g['autopilot'].startFrom(g.race.player.car, g.track);
    if (g.race.phase === 'grid') g.race.startLights();
    g.state = 'race';
    return { laps: g.race.opts.laps, track: g.track.def.id, fuel: +g.race.player.car.fuel.toFixed(1), compound: g.race.player.compound, grid: g.race.player.position, pace };
  }, Number(pace));
  console.log(`attempt ${n}`, JSON.stringify(info));
  // fast-forward to the flag, 20 s of race at a time
  for (let k = 0; k < 200; k++) {
    const st = await page.evaluate(() => {
      const g = window.__game, r = g.race, dt = 1 / 60;
      for (let t = 0; t < 20 && !(r.player.finished || r.player.retired); t += dt) {
        g['driveInput'](dt);
        r.update(dt);
      }
      return { lap: r.player.laps, pos: r.player.position, done: r.player.finished || r.player.retired, phase: r.phase };
    });
    if (st.done) break;
  }
  const res = await page.evaluate(() => {
    const g = window.__game;
    g['showResults']();
    const p = g.race.player;
    return { pos: p.position, retired: p.retired, stops: p.stops, fuelLeft: +p.car.fuel.toFixed(1), compounds: p.compoundsUsed.join('>'), next: [...document.querySelectorAll('.results .actions .cta')].map((e) => e.textContent) };
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${n}_results.png` });
  console.log(`attempt ${n} result`, JSON.stringify(res));
  console.log(`attempt ${n} career`, JSON.stringify(await state()));
  return res;
}

// (grid: 0 pole, 2 the back of the grid)
const a = await attempt(1, Number(slow), 2);
// "Retry round" (the results screen's first button) goes back to the same round's race screen
const b = await attempt(2, 0.995, 0);
// the next round: "Next round" travels there; the garage's map shows the round cleared and the next one open
await page.evaluate(() => window.__game.menu['items'][0].select());
await page.waitForFunction(() => window.__game.menu.screen === 'setup' && window.__game.track.def.id === window.__game.dc.nextTrack, null, { timeout: 180000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/3_next_setup.png` });
console.log('travelled to', await page.evaluate(() => window.__game.track.def.id));
await page.evaluate(() => {
  const g = window.__game;
  g['toMenu']();
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  const m = window.__game.menu;
  m['buildTitle']();
  m['setTab']('career');
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/4_map.png` });
console.log(JSON.stringify({ slow: a.pos, fast: b.pos, errors: errors.length }));
await browser.close();
