// Mogul test harness: boots a city headless, runs JS steps, screenshots.
//   node tools/mogulshot.mjs out.png [--city nyc] [--port 5201] [--eval "js"] [--after ms] [--w 1600 --h 900] [--fresh]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = args[0] ?? 'shots/mogul.png';
const city = opt('city', 'nyc'), port = opt('port', '5201');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +opt('w', 1600), height: +opt('h', 900) }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); if (m.text().startsWith('[t]')) console.log(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
if (args.includes('--fresh')) { await page.goto(`http://localhost:${port}/mogul.html?x`); await page.evaluate(() => localStorage.clear()); }
await page.goto(`http://localhost:${port}/mogul.html${args.includes('--title') ? '' : '?city=' + city}`, { waitUntil: 'load' });
if (!args.includes('--title')) await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).catch(() => console.log('not ready'));
await page.waitForTimeout(+opt('after', 2500));
const ev = opt('eval', null);
if (ev) { const r = await page.evaluate(ev); if (r !== undefined) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r)); await page.waitForTimeout(+opt('after2', 1500)); }
await page.screenshot({ path: out });
console.log(errors.slice(0, 15).join('\n') || 'no errors');
await browser.close();
