// Two headless browsers: one hosts a Boostball lobby, the other joins with the code; start a
// match, drive the guest, check snapshots flow and the guest's car moves on both screens.
//   node tools/boostnet.mjs [port=5241]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const port = process.argv[2] ?? '5241';
const base = `http://localhost:${port}/boost.html`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const A = await ctxA.newPage();
const B = await ctxB.newPage();
for (const [n, p] of [['host', A], ['guest', B]]) {
  p.on('console', (m) => (m.type() === 'error' || m.text().includes('PeerJS')) && console.log(`[${n}] ${m.type()} ${m.text().slice(0, 200)}`));
  p.on('pageerror', (e) => console.log(`[${n}] pageerror ${e.message}`));
}
await A.goto(base);
await A.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await A.click('text=Play with friends');
await A.click('#b-host');
await A.waitForFunction(() => window.__boost?.lobby?.code, null, { timeout: 30000 });
const code = await A.evaluate(() => window.__boost.lobby.code);
console.log('lobby code', code);
await B.goto(`${base}?join=${code}`);
await B.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await B.waitForFunction(() => window.__boost?.lobby?.players?.length >= 2, null, { timeout: 30000 });
console.log('guest in lobby:', await B.evaluate(() => window.__boost.lobby.players.map((p) => `${p.name}/${p.team}`).join(', ')));
await B.click('.team.o h3 button');
await A.waitForTimeout(800);
console.log('host sees:', await A.evaluate(() => window.__boost.lobby.players.map((p) => `${p.name}/${p.team}`).join(', ')));
await A.click('#l-start');
await B.waitForFunction(() => window.__boost.mode === 'guest' && window.__boost.me >= 0, null, { timeout: 15000 });
await B.waitForTimeout(4500); // countdown
const before = await B.evaluate(() => { const g = window.__boost; const c = g.world.cars[g.me]; return { me: g.me, x: c.pos.x, y: c.pos.y }; });
await B.keyboard.down('KeyW');
await B.keyboard.down('ShiftLeft');
await B.waitForTimeout(1500);
await B.keyboard.up('ShiftLeft');
await B.keyboard.up('KeyW');
await B.waitForTimeout(300);
const guestView = await B.evaluate(() => { const g = window.__boost; const c = g.world.cars[g.me]; return { x: c.pos.x, y: c.pos.y, snapTick: g.lastSnapTick, seq: g.seq, phase: g.world.phase }; });
const hostView = await A.evaluate((me) => { const g = window.__boost; const c = g.world.cars[me]; return { x: c.pos.x, y: c.pos.y, tick: g.world.tick, phase: g.world.phase, owners: g.owners }; }, before.me);
console.log('guest car before', before, '\nguest view', guestView, '\nhost view ', hostView);
const d = Math.hypot(guestView.x - hostView.x, guestView.y - hostView.y);
console.log(`moved ${Math.hypot(guestView.x - before.x, guestView.y - before.y).toFixed(0)} uu; host/guest disagree by ${d.toFixed(0)} uu`);
await A.screenshot({ path: 'shots/boost/net_host.png' });
await B.screenshot({ path: 'shots/boost/net_guest.png' });
await browser.close();
