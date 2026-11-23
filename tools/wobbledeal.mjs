// Wobble Mania: checks the show rules in the real page. Deals thousands of shows and fails if any
// repeats a round or a kind of game (two obstacle races are allowed), if a show has the same
// final, a round or the same five kinds as the one before it, or if the finals and the kinds
// don't come round evenly. Then checks Colour Call's calls in a built round.
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
  let badRound = 0, badMode = 0, badLen = 0, teamLate = 0, sameAsLast = 0, sameFinal = 0, sameKinds = 0, racesTogether = 0, twoRaces = 0, prev = [], prevKinds = '';
  const kindsIn = {};
  const finals = {}, seen = {}, sample = [];
  for (let k = 0; k < N; k++) {
    const ids = C.dealShow();
    if (k < 6) sample.push(ids.join(' > '));
    if (ids.length !== 6) badLen++;
    if (new Set(ids).size !== 6) badRound++;
    const modes = ids.map(C.modeOf);
    // the final is its own kind; no kind twice but the obstacle races (two at most, never side by
    // side, never with the crown race for a final)
    const races = modes.filter((m) => m === 'race').length;
    if (modes[5] !== 'final' || new Set(modes).size !== 6 - Math.max(0, races - 1) || races > 2) badMode++;
    if (races === 2) twoRaces++;
    if (races === 2 && ids[5] === 'crownpeak') badMode++;
    for (let q = 0; q < 4; q++) if (modes[q] === 'race' && modes[q + 1] === 'race') racesTogether++;
    // a team game or a ball game is never one of the two rounds before the final
    if (['team', 'ball'].includes(modes[3]) || ['team', 'ball'].includes(modes[4])) teamLate++;
    // nothing from the show before: not a round, not the final, not the same five kinds
    sameAsLast += ids.filter((x) => prev.includes(x)).length;
    if (ids[5] === prev[5]) sameFinal++;
    const kinds = [...new Set(modes.slice(0, 5))].sort().join();
    if (kinds === prevKinds) sameKinds++;
    prevKinds = kinds;
    for (const m of new Set(modes.slice(0, 5))) kindsIn[m] = (kindsIn[m] ?? 0) + 1;
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
  for (const m in kindsIn) kindsIn[m] = Math.round((kindsIn[m] / N) * 100) + '%';
  return { N, badRound, badMode, badLen, teamLate, sameAsLast, sameFinal, sameKinds, racesTogether, twoRaces: Math.round((twoRaces / N) * 100) + '%', kindsIn, finals, never, sample, seq, repeats, unreachable, badTiles, counts };
});
console.log(JSON.stringify(res, null, 1));
console.log('page errors', errs.length, errs.slice(0, 3));
await browser.close();
const fin = Object.values(res.finals);
const ok = !res.badRound && !res.badMode && !res.badLen && !res.teamLate && !res.sameAsLast && !res.sameFinal && !res.sameKinds && !res.racesTogether && fin.length === 4 && Math.max(...fin) - Math.min(...fin) <= 2 && !res.repeats && !res.unreachable && !res.badTiles && !res.never.length && !errs.length;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
