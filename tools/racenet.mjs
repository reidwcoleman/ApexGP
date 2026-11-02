// Two headless browsers race online: one opens a room, the other joins with the invite link, both
// ready up, the host starts, both drive; checks the lights go out together, every car moves on both
// screens and the two agree where each car is.
//   node tools/racenet.mjs [port=5262] [seconds=10]
// (needs the no-HMR server: npx vite --config vite.stable.config.mjs --port 5262)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const port = process.argv[2] ?? '5262';
const secs = Number(process.argv[3] ?? 10);
const base = `http://localhost:${port}/`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = () => browser.newContext({ viewport: { width: 1280, height: 720 } });
const A = await (await ctx()).newPage();
const B = await (await ctx()).newPage();
for (const [n, p] of [['host', A], ['guest', B]]) {
  p.on('console', (m) => (m.type() === 'error' || m.text().includes('[online]')) && console.log(`[${n}] ${m.type()} ${m.text().slice(0, 240)}`));
  p.on('pageerror', (e) => console.log(`[${n}] pageerror ${e.message}`));
}
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);
await A.goto(base);
await A.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
log('host ready');
await A.evaluate(() => {
  const o = window.__game.online;
  o.show();
  o.name = 'Hosty';
  o.createRoom();
});
await A.waitForFunction(() => window.__game.online.host?.peer.open, null, { timeout: 30000 });
const code = await A.evaluate(() => window.__game.online.code);
log('room', code);
// the host races where the garage is (no travel), 2 laps, 3 AI
await A.evaluate((laps) => {
  const o = window.__game.online;
  o.setSetting('track', o.hooks.currentTrack());
  o.setSetting('laps', laps);
  o.setSetting('ai', 3);
}, Number(process.env.LAPS ?? 2));
await B.goto(`${base}?join=${code}`);
const watch = setInterval(async () => {
  const st = await B.evaluate(() => ({ ready: window.__ready, vis: document.visibilityState, online: window.__game?.online?.screen, step: document.querySelector('#loading')?.textContent?.slice(0, 80) })).catch((e) => String(e));
  log('guest', JSON.stringify(st));
}, 10000);
await B.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
clearInterval(watch);
await B.waitForFunction(() => window.__game.online.screen === 'lobby', null, { timeout: 30000 });
await B.evaluate(() => window.__game.online.setMe({ name: 'Guesty', ready: true }));
await A.waitForFunction(() => window.__game.online.members.length === 2 && window.__game.online.members[1].ready, null, { timeout: 15000 });
log('lobby:', await A.evaluate(() => window.__game.online.members.map((m) => `${m.name}${m.ready ? '✓' : ''}`).join(', ')));
await B.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/lobby.png` : '/dev/null' }).catch(() => {});
await A.evaluate(() => window.__game.online.startRace());
await Promise.all([A, B].map((p) => p.waitForFunction(() => window.__game.online.screen === 'race', null, { timeout: 90000 })));
log('both in the race');
const cars = (p) => p.evaluate(() => window.__game.online.debug().cars);
log('host grid', JSON.stringify(await cars(A)));
log('guest grid', JSON.stringify(await cars(B)));
// lights
const outAt = (p) => p.evaluate(() => new Promise((r) => {
  const tick = () => (window.__game.online.race?.phase === 'racing' ? r(window.__game.online.now()) : requestAnimationFrame(tick));
  tick();
}));
const [la, lb] = await Promise.all([outAt(A), outAt(B)]);
log(`lights out: host ${la.toFixed(3)} guest ${lb.toFixed(3)} (session clock), apart ${((lb - la) * 1000).toFixed(0)} ms`);
await A.bringToFront();
await Promise.all([A.keyboard.down('ArrowUp'), B.keyboard.down('ArrowUp')]);
await A.waitForTimeout(secs * 1000);
await B.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/guest-race.png` : '/dev/null' }).catch(() => {});
await A.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/host-race.png` : '/dev/null' }).catch(() => {});
const [ca, cb] = await Promise.all([cars(A), cars(B)]);
await Promise.all([A.keyboard.up('ArrowUp'), B.keyboard.up('ArrowUp')]);
for (let i = 0; i < ca.length; i++) {
  const a = ca[i], b = cb[i];
  log(`car ${i} ${a.code.padEnd(3)} host: s ${a.s.toFixed(0)} ${a.player ? 'mine' : a.remote ? 'net ' : 'AI  '} P${a.pos} | guest: s ${b.s.toFixed(0)} ${b.player ? 'mine' : b.remote ? 'net ' : 'AI  '} P${b.pos} | apart ${Math.abs(a.s - b.s).toFixed(1)} m`);
}
if (process.argv[4] === 'full') {
  // the pause menu's autopilot drives both cars to the flag (the race never waits online)
  await Promise.all([A, B].map((p) => p.evaluate(() => window.__game.pause())));
  log('both paused: autopilot driving');
  const fin = (p) => p.waitForFunction(() => window.__game.online.race?.player.finished, null, { timeout: 400000, polling: 1000 });
  await Promise.all([fin(A), fin(B)]);
  log('both took the flag');
  await Promise.all([A, B].map((p) => p.evaluate(() => window.__game.resume())));
  for (let i = 0; i < 40; i++) {
    const st = await Promise.all([A, B].map((p) => p.evaluate(() => window.__game.state)));
    if (st.every((x) => x === 'results')) break;
    if (i % 4 === 0) log('states', st.join(' / '));
    // (skip the podium)
    for (const [k, p] of [A, B].entries()) if (st[k] === 'celebration') await p.evaluate(() => window.__game.endCelebration());
    await A.waitForTimeout(3000);
  }
  for (const [n, p] of [['host', A], ['guest', B]]) {
    const r = await p.evaluate(() => ({
      lede: document.querySelector('.results')?.textContent?.slice(0, 160),
      cls: window.__game.online.race?.cars.slice().sort((a, b) => a.position - b.position).map((c) => `P${c.position} ${c.entry.driver.code} laps ${c.laps} ${c.finished ? 'fin ' + c.finishTime.toFixed(2) : ''}${c.retired ? ' RET' : ''} best ${Number.isFinite(c.bestLap) ? c.bestLap.toFixed(2) : '-'}`),
      order: window.__game.online.race?.finishOrder,
    }));
    log('RESULT', n, JSON.stringify(r));
  }
  await B.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/guest-results.png` : '/dev/null' }).catch(() => {});
  // rematch: the host goes back to the lobby (everyone with it) and starts again
  await A.evaluate(() => window.__game.online.toLobby());
  await B.waitForFunction(() => window.__game.online.screen === 'lobby', null, { timeout: 15000 });
  log('both back in the lobby; codes restored:', await B.evaluate(() => window.__game.online.debug().cars ?? 'no race'));
  await A.evaluate(() => window.__game.online.startRace());
  await Promise.all([A, B].map((p) => p.waitForFunction(() => window.__game.online.screen === 'race', null, { timeout: 90000 })));
  const [l2a, l2b] = await Promise.all([outAt(A), outAt(B)]);
  log(`rematch lights out ${((l2b - l2a) * 1000).toFixed(0)} ms apart`);
  await A.waitForTimeout(4000);
  const [c2a, c2b] = await Promise.all([cars(A), cars(B)]);
  log('rematch apart (m):', c2a.map((a, i) => Math.abs(a.s - c2b[i].s).toFixed(1)).join(' '), 'codes', c2a.map((c) => c.code).join(' '));
}
await browser.close();
