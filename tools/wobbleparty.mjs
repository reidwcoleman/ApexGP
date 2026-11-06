// Wobble Mania online: a host and a guest in two browsers, over the real broker, play a round each
// of the given games side by side. Checks the two agree on the scores or the field, that the
// guest's own bean gets somewhere, and that nothing throws.
//   node tools/wobbleparty.mjs [--port 5197] [--rounds pinball,bigshot,rocketrumble] [--secs 40]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const port = opt('port', '5197');
const rounds = opt('rounds', 'pinball,bigshot,rocketrumble,beancup').split(',');
const secs = Number(opt('secs', 40));
const base = `http://localhost:${port}/marbles.html`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = async (name, errs) => {
  const p = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
  p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load|WebSocket|ERR_/.test(m.text()) && errs.push(`${name}: ${m.text().slice(0, 160)}`));
  return p;
};
const snap = () => {
  const g = window.__marbles;
  const b = g.pinP ?? g.shotP;
  const me = g.racers.find((r) => r.c.player);
  return {
    state: g.state, t: g.playT, id: g.course?.id,
    cup: g.cupP ? { s: [...g.cupP.score], ball: g.cupP.arena.balls[0].pos.toArray(), live: g.cupP.arena.balls[0].live } : null,
    scores: b ? Object.fromEntries(g.racers.map((r) => [r.c.id, b.of(r.m.id)])) : null,
    alive: g.racers.filter((r) => !r.out).length,
    me: me ? { id: me.c.id, y: me.m.pos.y, x: me.m.pos.x, z: me.m.pos.z, s: b ? b.of(me.m.id) : 0, puppet: me.m.puppet } : null,
    pos: Object.fromEntries(g.racers.map((r) => [r.c.id, [r.m.pos.x, r.m.pos.y, r.m.pos.z]])),
  };
};
async function party(id) {
  const errs = [];
  const A = await page('host', errs), B = await page('guest', errs);
  await A.goto(`${base}?lineup=${id},crownpeak&auto=1&settle=100`);
  await A.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await A.evaluate(() => window.__marbles.hostParty());
  await A.waitForFunction(() => window.__marbles.host?.code && window.__marbles.host.peer.open, null, { timeout: 30000 });
  const code = await A.evaluate(() => window.__marbles.host.code);
  await B.goto(`${base}?join=${code}&auto=1&settle=100`);
  await B.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await A.waitForFunction(() => window.__marbles.members.length === 2, null, { timeout: 40000 });
  await A.waitForTimeout(1500);
  await A.evaluate(() => [...document.querySelectorAll('button')].find((b) => /start/i.test(b.textContent))?.click());
  await Promise.all([A, B].map((p) => p.waitForFunction(() => window.__marbles.state === 'play', null, { timeout: 90000 })));
  const rows = [];
  let last = null;
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < secs) {
    await A.waitForTimeout(2000);
    const [a, b] = await Promise.all([A.evaluate(snap), B.evaluate(snap)]);
    if (a.state !== 'play' || b.state !== 'play') break;
    last = [a, b];
    let same = 0, n = 0;
    if (a.scores) for (const k in a.scores) { n++; if (Math.abs(a.scores[k] - b.scores[k]) <= 30) same++; }
    let gap = 0;
    for (const k in a.pos) if (b.pos[k]) gap = Math.max(gap, Math.hypot(a.pos[k][0] - b.pos[k][0], a.pos[k][2] - b.pos[k][2]));
    const ballGap = a.cup && a.cup.live && b.cup.live ? Math.hypot(a.cup.ball[0] - b.cup.ball[0], a.cup.ball[2] - b.cup.ball[2]) : 0;
    rows.push({ same, n, alive: [a.alive, b.alive], gap, ballGap, cup: a.cup ? a.cup.s.join('-') === b.cup.s.join('-') : true });
  }
  const [a, b] = last;
  const mine = b.me;
  const hostView = a.scores?.[mine.id];
  await browser.contexts().forEach(() => {});
  await A.context().close();
  await B.context().close();
  const agree = rows.filter((r) => r.n ? r.same >= r.n - 1 : Math.abs(r.alive[0] - r.alive[1]) <= 1).length;
  return { id, ballGap: +Math.max(...rows.map((r) => r.ballGap)).toFixed(1), goalsAgree: rows.every((r) => r.cup), samples: rows.length, agree, id2: a.id === id && b.id === id, guestScore: mine.s, hostSawGuest: hostView, alive: [a.alive, b.alive], guestRan: !mine.puppet, errs: errs.slice(0, 3) };
}
const res = await Promise.all(rounds.map(party));
let bad = 0;
for (const r of res) {
  const ok = !r.errs.length && r.id2 && r.samples > 3 && r.agree >= r.samples - 1 && r.guestRan;
  if (!ok) bad++;
  console.log(ok ? 'ok  ' : 'BAD ', JSON.stringify(r));
}
await browser.close();
console.log(bad ? `FAIL ${bad}` : 'PASS');
process.exit(bad ? 1 : 0);
