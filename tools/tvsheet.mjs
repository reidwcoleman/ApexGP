// Frames from the TV director in a simulated race: n shots, `gap` real seconds apart (UI hidden).
//   node tools/tvsheet.mjs <track> [n=4] [gap=7] [outdir=shots/tv]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', n = '4', gap = '7', out = 'shots/tv'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?track=${track}&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.evaluate(() => window.__game.debugSpectate({ skip: 25, speed: 1, weather: 'clear' }));
await page.waitForTimeout(3000);
await page.evaluate(() => { const s = document.createElement('style'); s.textContent = '#ui, #ui * { visibility: hidden !important; }'; document.head.appendChild(s); });
for (let i = 0; i < Number(n); i++) {
  await page.waitForTimeout(Number(gap) * 1000);
  await page.screenshot({ path: `${out}/${track}_${i}.png` });
}
await browser.close();
