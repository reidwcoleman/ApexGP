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
async function round(n) {
  await A.click('#l-start');
  await B.waitForFunction(() => window.__boost.mode === 'guest' && window.__boost.me >= 0, null, { timeout: 15000 });
  await B.waitForTimeout(4500); // countdown
  const me = await B.evaluate(() => window.__boost.me);
  const hostMe = await A.evaluate(() => window.__boost.me);
  const at = (p, i) => p.evaluate((i) => { const c = window.__boost.world.cars[i]; return { x: c.pos.x, y: c.pos.y }; }, i);
  const g0 = await at(A, me);
  const h0 = await at(A, hostMe);
  await B.keyboard.down('KeyW');
  await A.keyboard.down('KeyW');
  await B.waitForTimeout(1500);
  await B.keyboard.up('KeyW');
  await A.keyboard.up('KeyW');
  await B.waitForTimeout(300);
  const gB = await at(B, me);
  const gA = await at(A, me);
  const h1 = await at(A, hostMe);
  const mv = (a, b) => Math.hypot(a.x - b.x, a.y - b.y).toFixed(0);
  console.log(`round ${n}: guest car moved ${mv(gA, g0)} uu on the host's screen, host car moved ${mv(h1, h0)} uu; host/guest disagree by ${mv(gA, gB)} uu`);
}
await round(1);
// end the match on the host, back to the lobby, play again
await A.evaluate(() => { const w = window.__boost.world; w.phase = 'end'; w.events.push({ t: 'end' }); });
await A.waitForSelector('#e-again', { timeout: 8000 });
await A.click('#e-again');
await A.waitForTimeout(800);
await round(2);
await A.screenshot({ path: 'shots/boost/net_host.png' });
await B.screenshot({ path: 'shots/boost/net_guest.png' });
await browser.close();
