// Wobble Mania: checks the show rules in the real page. Deals thousands of shows and fails if any
// repeats a round or a kind of game, then checks Colour Call's calls in a built round.
//   node tools/wobbledeal.mjs [--port 5197]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const i = process.argv.indexOf('--port');
const port = i > 0 ? process.argv[i + 1] : '5197';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/marbles.html?nohud=1`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const res = await page.evaluate(async () => {
  const C = await import('/src/marbles/courses.ts');
  const N = 20000;
  let badRound = 0, badMode = 0, badLen = 0, teamLate = 0, sameAsLast = 0, prev = [];
  const finals = {}, seen = {}, sample = [];
  for (let k = 0; k < N; k++) {
    const ids = C.dealShow();
    if (k < 6) sample.push(ids.join(' > '));
    if (ids.length !== 6) badLen++;
    if (new Set(ids).size !== 6) badRound++;
    const modes = ids.map(C.modeOf);
    // the final is its own kind, and the crown race never comes with an obstacle race's twin
    if (new Set(modes).size !== 6) badMode++;
    if (ids[5] === 'crownpeak' && modes.includes('race')) badMode++;
    if (ids[4] === 'paintparty' || ids[4] === 'splatring') teamLate++;
    sameAsLast += ids.filter((x) => prev.includes(x) && x !== 'crownkeep' && x !== 'crownpeak').length;
    prev = ids;
    finals[ids[5]] = (finals[ids[5]] ?? 0) + 1;
    for (const x of ids) seen[x] = (seen[x] ?? 0) + 1;
  }
  const never = C.POOL.filter((x) => !seen[x]);
  // Colour Call, the real thing
  const c = C.buildRound('colourcall');
  const runs = [];
  for (const seed of [101, 102, 907]) {
    c.call.deal(seed);
    const list = [];
    let x = 0;
    for (let k = 0; k < 24; k++) {
      const a = c.call.at(x);
      list.push(a);
      // (on to the next call, however long the rest between them is)
      x = a.back;
      while (c.call.at(x).i === a.i) x += 0.05;
    }
    runs.push(list);
  }
  const names = ['Pink', 'Yel', 'Grn', 'Blu', 'Org', 'Pur'];
  const seq = runs.map((l) => l.map((a) => (a.fake >= 0 ? `${names[a.fake]}>` : '') + names[a.c] + (a.c2 >= 0 ? '+' + names[a.c2] : '')).join(' '));
  let repeats = 0, unreachable = 0, badTiles = 0;
  const counts = [0, 0, 0, 0, 0, 0];
  for (const l of runs) {
    l.forEach((a, k) => {
      counts[a.c]++;
      // (neither the safe colour nor the first one shown is one the last call left safe)
      const was = k ? [l[k - 1].c, l[k - 1].c2] : [];
      if (was.includes(a.c) || (a.fake >= 0 && was.includes(a.fake)) || a.c2 === a.c || a.fake === a.c) repeats++;
      if (!a.safe.length) unreachable++;
      for (const t of a.safe) if (a.tiles[t] !== a.c && a.tiles[t] !== a.c2) badTiles++;
      if (a.fake >= 0 && (a.fake === a.c || !a.decoy.length || a.drop - a.swap < 1.4)) badTiles++;
    });
  }
  return { N, badRound, badMode, badLen, teamLate, sameAsLast, finals, never, sample, seq, repeats, unreachable, badTiles, counts };
});
console.log(JSON.stringify(res, null, 1));
console.log('page errors', errs.length, errs.slice(0, 3));
await browser.close();
const ok = !res.badRound && !res.badMode && !res.badLen && !res.teamLate && !res.repeats && !res.unreachable && !res.badTiles && !res.never.length && !errs.length;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
