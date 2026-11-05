// Pine & Dandy test harness: boots the page, runs a script of steps, screenshots.
//   node tools/pineshot.mjs out.png [--port 5311] [--q "?skip"] [--eval "js"] [--after ms] [--keys "KeyD:800,Space+KeyD:1500"] [--w 1440 --h 900] [--dpr 2]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = args[0] ?? 'shots/pine.png', port = opt('port', '5311');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +opt('w', 1440), height: +opt('h', 900) }, deviceScaleFactor: +opt('dpr', 1) });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); if (m.text().startsWith('[t]')) console.log(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + (e.stack ?? '').split('\n').slice(0, 4).join('\n')));
await page.goto(`http://localhost:${port}/pine.html${opt('q', '')}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).catch(() => console.log('not ready'));
await page.waitForTimeout(+opt('after', 800));
const keys = opt('keys', null);
if (keys) for (const step of keys.split(',')) {
  const [ks, ms] = step.split(':'); const list = ks.split('+');
  for (const k of list) await page.keyboard.down(k);
  await page.waitForTimeout(+(ms ?? 100));
  for (const k of list) await page.keyboard.up(k);
}
const ev = opt('eval', null);
if (ev) { const r = await page.evaluate(ev); if (r !== undefined) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r)); await page.waitForTimeout(+opt('after2', 700)); }
await page.screenshot({ path: out });
console.log(errors.slice(0, 15).join('\n') || 'no errors');
await browser.close();
