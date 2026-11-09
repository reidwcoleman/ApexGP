// Bluebird Peak test harness: boots the resort headless, runs JS steps, screenshots.
//   node tools/bbshot.mjs out.png [--port 5321] [--q "fresh&mode=ski"] [--eval "js"] [--after ms] [--after2 ms] [--w 1600 --h 900]
// window.__bb = { sim, world, m, lifts, crowd, skier, cat, sled, ui, setMode, orbit, village, fx }
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = args[0] ?? 'shots/bb.png';
const port = opt('port', '5321');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +opt('w', 1600), height: +opt('h', 900) }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); if (m.text().startsWith('[t]')) console.log(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/bluebird.html?${opt('q', 'fresh')}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }).catch(() => console.log('not ready'));
console.log('ready in', Date.now() - t0, 'ms');
await page.waitForTimeout(+opt('after', 1500));
const evs = args.flatMap((a, i) => (a === '--eval' ? [args[i + 1]] : []));
for (const ev of evs) { const r = await page.evaluate(ev); if (r !== undefined) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r)); await page.waitForTimeout(+opt('after2', 1200)); }
await page.screenshot({ path: out });
// --step "path.png::js::ms" (repeatable): run js, wait, screenshot
const steps = args.flatMap((a, i) => (a === '--step' ? [args[i + 1]] : []));
for (const st of steps) { const [p, js, ms] = st.split('::'); const r = await page.evaluate(js); if (r !== undefined) console.log(p, 'eval:', typeof r === 'string' ? r : JSON.stringify(r)); await page.waitForTimeout(+(ms || 1500)); await page.screenshot({ path: p }); }
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 1500) requestAnimationFrame(f); else res(Math.round(n / ((performance.now() - t) / 1000))); }; requestAnimationFrame(f); }));
console.log('fps', fps);
console.log(errors.slice(0, 15).join('\n') || 'no errors');
await browser.close();
