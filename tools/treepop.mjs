// Tree detail changes while racing, per camera: how many trees dissolved from one LOD (or their
// impostor) into the next, how many changed in one frame without a camera cut (pops — should be
// 0), how many changed at cuts (a new view: not seen), and how many changes waited for the dissolve before them.
//   node tools/treepop.mjs [track=monza] [cams=chase,cockpit,tcam,tv,heli] [secs=15]   (env PORT, WEATHER, TIME)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', camsArg = 'chase,cockpit,tcam,tv,heli', secs = '15'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5805}/?track=${track}&demo=race&cam=chase&skip=20&weather=${process.env.WEATHER ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
for (const cam of camsArg.split(',')) {
  await page.evaluate((c) => window.__game.cams.set(c), cam);
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async (ms) => {
    const d = window.__park.veg.debug;
    for (const k of ['fades', 'pops', 'snaps', 'deferred', 'cuts']) d[k] = 0;
    await new Promise((res) => setTimeout(res, ms));
    return { ...d };
  }, Number(secs) * 1000);
  console.log(cam.padEnd(8), `${secs}s: dissolves ${r.fades} (${(r.fades / Number(secs)).toFixed(1)}/s), pops ${r.pops}, cuts ${r.cuts} (trees set at cuts ${r.snaps}), held back for a dissolve ${r.deferred}`);
}
if (errors.length) console.log('errors:', errors.slice(0, 5));
await browser.close();
