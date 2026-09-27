// How often the TV director cuts in a simulated race (real seconds between cuts).
//   node tools/cuts.mjs [seconds=60] [track=monza] [speed=1]
import { chromium } from 'playwright-core';
const secs = Number(process.argv[2] ?? 60);
const track = process.argv[3] ?? 'monza';
const speed = Number(process.argv[4] ?? 1);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?track=${track}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.evaluate((sp) => window.__game.debugSpectate({ skip: 20, speed: sp }), speed);
const log = await page.evaluate(async (secs) => {
  const g = window.__game;
  const out = [];
  let last = '';
  const t0 = performance.now();
  while (performance.now() - t0 < secs * 1000) {
    await new Promise((r) => setTimeout(r, 100));
    const c = g.cams;
    const key = `${c.mode}|${c.tvIndex}|${g.focusId}|${c.lost}`;
    if (key !== last) {
      out.push([((performance.now() - t0) / 1000).toFixed(1), key]);
      last = key;
    }
  }
  return { out, fps: window.__fps };
}, secs);
const t = log.out.map((x) => Number(x[0]));
const gaps = t.slice(1).map((x, i) => x - t[i]);
console.log(log.out.map((x) => x.join(' ')).join('\n'));
console.log(`cuts ${gaps.length} in ${secs}s  mean ${(gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)).toFixed(1)}s  min ${Math.min(...gaps).toFixed(1)}s  fps ${log.fps}`);
await browser.close();
