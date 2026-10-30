// Plush Panic screenshot: start a CPU match on an arena, run it for a while, screenshot (UI optional).
//   node tools/brawlshot.mjs <arena> <out.png> [--n 6] [--secs 6] [--ui] [--w 1600 --h 900] [--eval js]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const arena = args[0] ?? 'tilt', out = args[1] ?? 'shots/brawl.png';
const n = Number(opt('n', 6)), secs = Number(opt('secs', 6)), W = Number(opt('w', 1600)), H = Number(opt('h', 900));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${opt('port', '5196')}/brawl.html?manual`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const info = await page.evaluate(async ({ arena, n, secs, ui, ev }) => {
  const g = window.__brawl;
  const seats = g.cpuSeats(n);
  await g.startMatch(seats, arena, 3);
  if (!ui) document.getElementById('ui').style.display = 'none';
  g.state = 'fight';
  for (let k = 0; k < secs * 60; k++) { g.tick(1 / 60); if (k % 2 === 0) g.draw(1 / 30); }
  if (ev) eval(ev);
  g.draw(1 / 60);
  return { alive: g.fighters.filter((f) => f.alive && !f.out).length, arena: g.arenaId };
}, { arena, n, secs, ui: args.includes('--ui'), ev: opt('eval', null) });
await page.screenshot({ path: out });
console.log('saved', out, JSON.stringify(info));
await browser.close();
