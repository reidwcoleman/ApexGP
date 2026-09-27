// GPU ms / fps / dynamic scale in a live race (chase cam) at a circuit.
//   node tools/perfnow.mjs <track> [cam=chase] [seconds=12] [quality]
import { chromium } from 'playwright-core';
const [track = 'monza', cam = 'chase', secs = '12', quality] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?track=${track}&demo=race&cam=${cam}&skip=15&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
if (quality) await page.evaluate((q) => { const g = window.__game; g.menu.settings.quality = q; g.menu.settings.autoQuality = false; g.applySettings(g.menu.settings); }, quality);
const samples = [];
for (let i = 0; i < Number(secs); i++) {
  await page.waitForTimeout(1000);
  samples.push(await page.evaluate(() => ({ fps: window.__fps, gpu: window.__gpuMs, dyn: +window.__game.gfx.dynamicScale.toFixed(2), pr: +window.__game.gfx.renderer.getPixelRatio().toFixed(2), q: window.__game.gfx.qualityLevel, calls: window.__game.gfx.renderer.info.render.calls, tris: window.__game.gfx.renderer.info.render.triangles })));
}
console.log(samples.map((s) => JSON.stringify(s)).join('\n'));
await browser.close();
