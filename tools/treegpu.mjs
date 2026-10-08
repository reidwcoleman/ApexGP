// What the trees cost on the GPU, in place: a race held still mid-lap with the given camera, the
// GPU time of the frame with the vegetation drawn and without, alternated so a GPU shared with other
// work shows up as noise on both, not as a difference. Per server, so two builds compare.
//   node tools/treegpu.mjs [ports=5806,5807] [track=monza] [cams=chase,cockpit,heli] [rounds=6]   (env W, H)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [portsArg = '5806,5807', track = 'monza', camsArg = 'chase,cockpit,heli', rounds = '6'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const med = (a) => { const b = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
for (const port of portsArg.split(',')) {
  const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1920), height: Number(process.env.H ?? 1080) }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/?track=${track}&demo=race&cam=chase&skip=30&weather=${process.env.WEATHER ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  await page.evaluate(() => { const g = window.__game; const o = g.adaptQuality.bind(g); g.adaptQuality = (dt) => { o(dt); g.gfx.setDynamicScale(1); }; g.gfx.setDynamicScale(1); document.getElementById('ui').style.visibility = 'hidden'; });
  for (const cam of camsArg.split(',')) {
    await page.evaluate((c) => { const g = window.__game; g.state = 'race'; g.cams.set(c); }, cam);
    await page.waitForTimeout(1500);
    // (held still: the race paused without its menu, the frame still drawn and timed)
    await page.evaluate(() => (window.__game.state = 'paused'));
    await page.waitForTimeout(800);
    const on = [], off = [];
    for (let r = 0; r < Number(rounds); r++) {
      for (const vis of [true, false]) {
        await page.evaluate((v) => (window.__park.veg.group.visible = v), vis);
        await page.waitForTimeout(1200);
        (vis ? on : off).push(await page.evaluate(() => window.__gpuMs));
      }
    }
    await page.evaluate(() => (window.__park.veg.group.visible = true));
    const a = med(on), b = med(off);
    console.log(port, cam.padEnd(8), `with trees ${a.toFixed(2)} ms, without ${b.toFixed(2)} ms, trees ${(a - b).toFixed(2)} ms  (on ${on.join(' ')} | off ${off.join(' ')})`);
  }
  await page.close();
}
await browser.close();
