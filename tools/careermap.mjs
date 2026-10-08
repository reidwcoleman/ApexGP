// The career's season map in every state, at 1280×720 and 1920×1080: no career yet (the way in), a
// new F2 season (round 1 open, the rest locked), cleared rounds with their medals (P1 gold, P3 silver,
// P5 bronze), a P8 that leaves the next round locked (attempt counter), a locked pin picked, and the
// round's race screen with the lap choice. The rounds are scored through DriverCareer.recordRound
// (the same call the results screen makes), so the unlock rule itself is what's being checked.
//   PORT=5191 node tools/careermap.mjs [outDir=shots/careermap]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [out = 'shots/careermap'] = process.argv.slice(2);
const PORT = process.env.PORT ?? '5191';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => (errors.push(e.message), console.log('[pageerror]', e.message)));
page.on('console', (m) => m.type() === 'error' && (errors.push(m.text()), console.log('[console]', m.text().slice(0, 300))));
await page.addInitScript(() => localStorage.removeItem('apexgp.drivercareer'));
await page.goto(`http://localhost:${PORT}/?track=monza`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(1500);

const sizes = [[1280, 720], [1920, 1080]];
async function shoot(name) {
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => window.__game.menu['renderTab']());
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${out}/${name}_${w}.png` });
  }
}
const hub = () => page.evaluate(() => {
  const m = window.__game.menu;
  m.show('title');
  m['setTab']('career');
});
/** a round raced: the player at `pos` (0 = DNF), the field in pace order around them */
const race = (pos) => page.evaluate((pos) => {
  const g = window.__game, dc = g.dc, d = dc.data;
  g['syncCareerGrid']();
  const track = dc.nextTrack;
  const ents = g.entries.slice().sort((a, b) => b.team.pace * b.driver.skill - a.team.pace * a.driver.skill);
  const me = ents.splice(ents.findIndex((e) => e.driver.code === d.driver.code), 1)[0];
  ents.splice(Math.max(0, (pos || ents.length + 1) - 1), 0, me);
  const rows = ents.map((e, k) => ({ code: e.driver.code, name: `${e.driver.first} ${e.driver.last}`, team: e.team.name, teamId: e.team.id, color: '#888', pos: k + 1, dnf: pos === 0 && e === me, fastest: k === 1, isPlayer: e === me, seatMate: e.team === me.team && e !== me }));
  const s = dc.recordRound(track, rows);
  window.__lastSum = window.__lastSum ?? {};
  window.__lastSum[pos] = s;
  return { track, pos: pos || 'DNF', cleared: s?.cleared, round: d.round, next: dc.nextTrack, tries: dc.tries.n, laps: dc.laps };
}, pos);

// 1. no career: the map of the season to come and the way in
await hub();
await shoot('1_start');

// 2. a new Formula 2 career: round 1 open, every other round locked
await page.evaluate(() => {
  const dc = window.__game.dc;
  dc.start({ first: 'Reid', last: 'Coleman', code: 'COL', number: 27, nationality: 'GBR', helmet: ['#ff2b3f', '#ffffff'], look: { skin: 0xf0cdb0, hair: 0x3a2a1e, style: 'short' } }, { series: 'f2', team: 'f2-campos', seat: 1, until: new Date().getFullYear(), salary: 0.2, status: 'equal' });
});
console.log('laps by default', await page.evaluate(() => window.__game.dc.laps));
await hub();
await shoot('2_new');

// 3. the unlock rule: P1, P3, P5 clear their rounds (gold, silver, bronze); P8 and a DNF don't
const log = [];
for (const p of [1, 3, 5, 8, 0]) log.push(await race(p));
console.log(JSON.stringify(log, null, 1));
await hub();
await shoot('3_progress');

// 4. a locked pin picked on the map
await page.evaluate(() => {
  const d = window.__game.dc.data;
  const id = d.calendar[d.round + 2];
  document.querySelector(`.ch-map .pinw[data-id="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForTimeout(1200);
for (const [w, h] of sizes) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/4_locked_${w}.png` });
}
// 5. a cleared pin picked
await page.evaluate(() => {
  const d = window.__game.dc.data;
  document.querySelector(`.ch-map .pinw[data-id="${d.calendar[0]}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForTimeout(1300);
await page.screenshot({ path: `${out}/5_cleared_1920.png` });

// 5b. the results screen's career block: a round cleared (P5) and one not (P8)
for (const pos of [5, 8]) {
  await page.evaluate((pos) => {
    const g = window.__game;
    const rows = g.entries.slice(0, 22).map((e, k) => ({ entry: e, pos: k + 1, time: 900 + k, gap: k * 1.3, best: 80 + k * 0.1, dnf: false, fastest: k === 0, isPlayer: k === pos - 1, penalty: 0 }));
    const s = window.__lastSum[pos];
    g.menu.showResults(rows, `Finished P${pos}`, 'Career round · 5 laps · test', () => {}, () => {}, () => {}, null, { label: s.cleared ? 'Next round · Silverstone' : 'Retry round · Spielberg', go: () => {} }, s);
  }, pos);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/5_results_P${pos}_1920.png` });
}

// 6. the race distance: 15 laps picked on the card, then the round's race screen (its Laps option)
await page.setViewportSize({ width: 1280, height: 720 });
await hub();
await page.waitForTimeout(800);
await page.evaluate(() => [...document.querySelectorAll('.ch-lap')].find((b) => b.textContent === '15').click());
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/6_laps15_1280.png` });
console.log('laps after pick', await page.evaluate(() => window.__game.dc.laps));
await page.evaluate(() => window.__game.menu['cb'].onCareerRace(window.__game.dc.nextTrack));
await page.waitForFunction(() => window.__game.menu.screen === 'setup', null, { timeout: 180000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/7_setup_1280.png` });
console.log('errors', errors.length);
await browser.close();
