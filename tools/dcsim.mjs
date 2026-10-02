// Driver-career simulator + screenshots: starts a created-driver career, simulates rounds (the player
// finishing around `pos`), then shoots every hub section, contract talks and a results screen.
//   node tools/dcsim.mjs [rounds=5] [pos=6] [outDir=shots/dc] [--existing]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const existing = process.argv.includes('--existing');
const [rounds = '5', ppos = '6', out = 'shots/dc'] = args;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text().slice(0, 300)));
await page.goto('http://localhost:5191/?track=monza');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
const info = await page.evaluate(([rounds, ppos, existing]) => {
  const g = window.__game, dc = g.dc;
  localStorage.removeItem('apexgp.drivercareer');
  const year = new Date().getFullYear();
  if (existing) dc.start({ first: 'Lando', last: 'Morris', code: 'MRS', number: 4, nationality: 'GBR', helmet: ['#d4ff00', '#101216'], look: { skin: 0xf2cfb4, hair: 0x5c4028, style: 'wavy' }, from: 'MRS' }, { series: 'f1', team: 'solis', seat: 0, until: year + 1, salary: 12, status: 'lead' });
  else dc.start({ first: 'Reid', last: 'Coleman', code: 'COL', number: 27, nationality: 'GBR', helmet: ['#ff2b3f', '#ffffff'], look: { skin: 0xf0cdb0, hair: 0x3a2a1e, style: 'short' } }, { series: 'f2', team: 'f2-campos', seat: 1, until: year, salary: 0.2, status: 'equal' });
  const log = [];
  for (let i = 0; i < rounds; i++) {
    const d = dc.data;
    if (d.choosing) {
      const m = d.inbox.find((x) => x.kind === 'offer' && x.picked === undefined);
      dc.choose(m.id, 0);
      log.push(`signed ${m.offer.teamName}`);
    }
    g['syncCareerGrid']();
    const track = dc.nextTrack;
    if (!track) break;
    const ents = g.entries.slice().sort((a, b) => b.team.pace * b.driver.skill - a.team.pace * a.driver.skill + (Math.random() - 0.5) * 0.02);
    const meI = ents.findIndex((e) => e.driver.code === d.driver.code);
    const me = ents.splice(meI, 1)[0];
    const want = Math.max(1, Math.min(22, Math.round(ppos + (Math.random() - 0.5) * 6)));
    ents.splice(want - 1, 0, me);
    const pteam = me.team;
    const rows = ents.map((e, k) => ({ code: e.driver.code, name: `${e.driver.first} ${e.driver.last}`, team: e.team.name, teamId: e.team.id, color: '#888', pos: k + 1, dnf: Math.random() < 0.04, fastest: k === 2, isPlayer: e === me, seatMate: e.team === pteam && e !== me }));
    const s = dc.recordRound(track, rows);
    log.push(`${d.year} ${track} P${want} ovr ${s?.ovr} rp ${s?.rp} obj ${s?.objectives.filter((o) => o.done).length}/${s?.objectives.length}`);
  }
  g['syncCareerGrid']();
  const d = dc.data;
  return { log, year: d.year, series: d.series, team: d.contract.team, ovr: dc.ovr, rp: d.rp, rival: d.rival, trophies: d.trophies.map((t) => t.title), inbox: d.inbox.length, market: d.market.f1.map((t) => t.drivers.map((x) => x.code).join('/')).join(' ') };
}, [Number(rounds), Number(ppos), existing]);
console.log(JSON.stringify(info, null, 1));
await page.evaluate(() => {
  const g = window.__game;
  g.menu['buildTitle']();
  g.menu['setTab']('career');
});
await page.waitForTimeout(900);
const tabs = await page.$$eval('.ch-tab', (t) => t.length);
for (let i = 0; i < tabs; i++) {
  await page.evaluate((i) => document.querySelectorAll('.ch-tab')[i].click(), i);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/hub_${i}.png` });
}
await page.evaluate(() => window.__game.menu['setTab']('car'));
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/rd.png` });
// contract talks, if an offer is waiting
await page.evaluate(() => {
  window.__game.menu['setTab']('career');
  document.querySelectorAll('.ch-tab')[1]?.click();
});
await page.waitForTimeout(400);
const neg = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.ch-choice')].find((x) => x.textContent === 'Negotiate');
  b?.click();
  return !!b;
});
if (neg) {
  await page.waitForTimeout(500);
  await page.evaluate(() => [...document.querySelectorAll('.tk-b')][1]?.click());
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/talks.png` });
  await page.keyboard.press('Escape');
}
// a results screen with the round summary
await page.evaluate(() => {
  const g = window.__game, dc = g.dc;
  const rows = g.entries.slice(0, 22).map((e, k) => ({ entry: e, pos: k + 1, time: 900 + k, gap: k * 1.3, best: 80 + k * 0.1, dnf: false, fastest: k === 0, isPlayer: e.driver.code === dc.data.driver.code, penalty: 0 }));
  if (dc.data.last) g.menu.showResults(rows, 'Results', 'Career round · test', () => {}, () => {}, () => {}, null, { label: 'Next round · Spa', go: () => {} }, dc.data.last);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/results.png` });
await browser.close();
