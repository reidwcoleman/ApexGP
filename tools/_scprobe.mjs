import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track, secs = '90'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', (m) => { const t = m.text(); if (m.type() !== 'debug' && !/Download the React|DevTools/.test(t)) console.log(`[${m.type()}]`, t.slice(0, 500)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')));
const t0 = Date.now();
await page.goto(`http://localhost:5191/?track=${track}&demo=race&skip=20&quality=high`, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < Number(secs); i += 5) {
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => ({ ready: window.__ready, load: document.querySelector('#loader, .loader, #boot')?.textContent?.slice(0, 80) })).catch((e) => ({ err: String(e) }));
  console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(st));
  if (st.ready) break;
}
await browser.close();
