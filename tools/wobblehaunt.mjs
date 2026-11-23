// Wobble Mania online: out of the show with friends. A host and a guest in two browsers play
// a survival round, a team game and the final. The guest's bean is knocked out a few seconds
// into the first round with enough stars banked for a revive. Checks:
//   - a moment after it's out, the guest is a ghost, and the host sees that ghost flying about
//   - at the end of the round the guest spends its stars, and is back in the next round on both
//   - in the team game the two people are on the same team
//   - in the final (a gate each, lives) the two agree on who has how many lives
//   node tools/wobblehaunt.mjs [--port 5197] [--show jumpclub,spothogs,gatecrashers]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const port = opt('port', '5197');
const show = opt('show', 'jumpclub,spothogs,gatecrashers');
const base = `http://localhost:${port}/marbles.html`;
let browser;
for (let tries = 0; tries < 6 && !browser; tries++) {
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
    await (await browser.newPage()).close();
  } catch {
    await browser?.close().catch(() => undefined);
    browser = undefined;
    await new Promise((r) => setTimeout(r, 4000));
  }
}
if (!browser) { console.log('FAIL: the browser would not start'); process.exit(1); }
const errs = [];
const page = async (name) => {
  const p = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
  p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load|WebSocket|ERR_/.test(m.text()) && errs.push(`${name}: ${m.text().slice(0, 160)}`));
  return p;
};
const A = await page('host'), B = await page('guest');
await A.goto(`${base}?lineup=${show}&auto=1&settle=100`);
await A.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await A.evaluate(() => window.__marbles.hostParty());
await A.waitForFunction(() => window.__marbles.host?.code && window.__marbles.host.peer.open, null, { timeout: 30000 });
const code = await A.evaluate(() => window.__marbles.host.code);
await B.goto(`${base}?join=${code}&auto=1&settle=100`);
await B.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await A.waitForFunction(() => window.__marbles.members.length === 2, null, { timeout: 40000 });
await A.waitForTimeout(1500);
await Promise.all([A, B].map((p) => p.evaluate(() => (window.__marbles.autopilot = true))));
await A.evaluate(() => [...document.querySelectorAll('button')].find((b) => /start/i.test(b.textContent))?.click());
const snap = () => {
  const g = window.__marbles;
  const me = g.roster.find((x) => x.player);
  const people = g.roster.filter((x) => x.human).map((x) => x.id);
  const T = g.teamPlay, G = g.course?.cup?.gates;
  return {
    i: g.roundIdx, id: g.course?.id, state: g.state, t: +g.playT.toFixed(1), stars: g.starCount,
    ghost: !!g.ghostsI?.me, others: g.ghostsI ? [...g.ghostsI.others.keys()] : [], ghostAt: g.ghostsI?.me ? g.ghostsI.me.pos.toArray().map((v) => +v.toFixed(1)) : null,
    otherAt: g.ghostsI && g.ghostsI.others.size ? [...g.ghostsI.others.values()][0].pos.toArray().map((v) => +v.toFixed(1)) : null,
    meOut: !!me?.out, meId: me?.id, inRound: g.racers.some((r) => r.c.player), asked: g.reviveAsked, field: g.racers.length,
    teams: T ? people.map((id) => (g.racers.some((r) => r.c.id === id) ? T.teamOf(id) : -1)) : null,
    lives: G ? [...G.lives.entries()].sort((a, b) => a[0] - b[0]).map((e) => e.join(':')).join(' ') : null,
    alive: g.racers.filter((r) => !r.out).length,
  };
};
const log = [];
const seen = { ghostOnGuest: false, ghostOnHost: false, moved: 0, asked: false, backGuest: false, backHost: false, sameTeam: null, livesAgree: 0, livesN: 0, final: false, lost: false };
let knocked = false, firstAt = null, lastKey = '';
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < 420) {
  await A.waitForTimeout(1000);
  const r = await Promise.all([A.evaluate(snap), B.evaluate(snap)]).catch((e) => (errs.push(`lost: ${String(e.message).slice(0, 100)}`), null));
  if (!r) { seen.lost = true; break; }
  const [a, b] = r;
  const key = `${a.i}:${a.state}`;
  if (key !== lastKey) { log.push(`${a.i} ${a.id} ${a.state} (host field ${a.field}, guest ${b.inRound ? 'in' : b.ghost ? 'ghost' : 'out'}${a.lives ? `, lives ${a.lives}` : ''})`); lastKey = key; }
  if (a.i === 0 && a.state === 'play' && b.state === 'play' && !knocked && b.t > 3) {
    knocked = true;
    // the guest's own bean is out (as if it had fallen), with 60 stars in its pocket
    await B.evaluate(() => { const g = window.__marbles; g.starCount = 60; const me = g.racers.find((q) => q.c.player); g.guest.send({ t: 'out', id: me.c.id }); });
  }
  if (a.i === 0 && knocked) {
    if (b.ghost) { seen.ghostN = (seen.ghostN ?? 0) + 1; seen.ghostStars = b.stars; seen.hostSees = a.otherAt; seen.guestAt = b.ghostAt;
      seen.ghostOnGuest = true; firstAt ??= b.ghostAt; if (firstAt && b.ghostAt) seen.moved = Math.max(seen.moved, Math.hypot(b.ghostAt[0] - firstAt[0], b.ghostAt[2] - firstAt[2])); }
    if (a.others.includes(b.meId)) seen.ghostOnHost = true;
    if (b.asked) seen.asked = true;
  }
  if (a.i === 1 && a.state === 'play' && b.state === 'play') {
    seen.backGuest ||= b.inRound && !b.ghost;
    seen.backHost ||= a.field === b.field && a.teams?.every((t) => t >= 0);
    if (!seen.dbg) seen.dbg = { a: a.teams, b: b.teams, fa: a.field, fb: b.field };
    if (a.teams && b.teams) seen.sameTeam = a.teams[0] === a.teams[1] && b.teams[0] === b.teams[1] && a.teams[0] === b.teams[0];
    // (no need to sit through all of it: the host calls time)
    if (a.t > 12) await A.evaluate(() => window.__marbles.endRound());
  }
  if (a.i === 2 && a.state === 'play' && b.state === 'play') {
    seen.final = true;
    seen.livesN++;
    if (a.lives === b.lives && a.alive === b.alive) seen.livesAgree++;
  }
  if (a.state === 'champion' && b.state === 'champion') break;
}
console.log(log.join('\n'));
console.log(JSON.stringify(seen));
const bad = [];
if (seen.lost) bad.push('lost a page');
if (!seen.ghostOnGuest) bad.push('the guest never became a ghost');
if (!seen.ghostOnHost) bad.push("the host never saw the guest's ghost");
if (seen.moved < 3) bad.push('the ghost did not fly anywhere');
if (!seen.asked) bad.push('the stars were not spent on a revive');
if (!seen.backGuest || !seen.backHost) bad.push('the revived bean was not back in the next round');
if (seen.sameTeam !== true) bad.push('the two people were not on the same team');
if (!seen.final || seen.livesAgree < seen.livesN - 2) bad.push('host and guest did not agree on the final');
if (errs.length) bad.push(`errors: ${[...new Set(errs)].slice(0, 3).join(' | ')}`);
console.log(bad.length ? `FAIL: ${bad.join('; ')}` : 'PASS');
await browser.close().catch(() => undefined);
process.exit(bad.length ? 1 : 0);
