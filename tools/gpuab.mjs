// GPU ms per frame in a live race, pinned resolution (no governor), A/B across servers.
//   node tools/gpuab.mjs <ports=5217,5218> [track=monza] [cams=chase,tcam,tv] [secs=8]   (env WEATHER, TIME, W, H)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [portsArg = '5217,5218', track = 'monza', camsArg = 'chase,tcam,tv', secs = '8'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const res = {};
for (const port of portsArg.split(',')) {
  const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1920), height: Number(process.env.H ?? 1080) }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/?track=${track}&demo=race&cam=chase&skip=20&weather=${process.env.WEATHER ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  await page.evaluate(() => { const g = window.__game; const o = g.adaptQuality.bind(g); g.adaptQuality = (dt) => { o(dt); g.gfx.setDynamicScale(1); }; g.gfx.setDynamicScale(1); });
  for (const cam of camsArg.split(',')) {
    await page.evaluate((c) => window.__game.cams.set(c), cam);
    await page.waitForTimeout(1500);
    const gpu = [], fps = [];
    for (let i = 0; i < Number(secs); i++) {
      await page.waitForTimeout(1000);
      const s = await page.evaluate(() => ({ fps: window.__fps, gpu: window.__gpuMs }));
      gpu.push(s.gpu); fps.push(s.fps);
    }
    const med = (a) => { const b = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); return b.length ? +b[b.length >> 1].toFixed(2) : null; };
    (res[cam] ??= {})[port] = { gpuMs: med(gpu), fps: med(fps) };
    console.log(port, cam, JSON.stringify(res[cam][port]));
  }
  await page.close();
}
console.log(JSON.stringify(res, null, 1));
await browser.close();
