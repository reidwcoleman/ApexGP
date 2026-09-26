// Headless screenshot of a page served by the Vite dev server (system Chrome, GPU on).
//
//   node tools/shot.mjs /src/dev/car.html shots/car.png [--w 1600] [--h 900] [--wait 20000] [--eval "js"]
//
// Waits until the page sets `window.__ready = true` (or the timeout), then
// screenshots. Prints page console errors so broken shaders show up here.
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const path = args[0] ?? '/';
const out = args[1] ?? 'shots/shot.png';
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const W = Number(opt('w', 1600));
const H = Number(opt('h', 900));
const wait = Number(opt('wait', 25000));
const evalJs = opt('eval', null);
const after = Number(opt('after', 1500));
const port = opt('port', '5190');
const url = path.startsWith('http') ? path : `http://localhost:${port}${path}`;

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  if (m.text().startsWith('[shot]')) console.log(m.text());
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: wait });
} catch {
  errors.push('[shot] timed out waiting for window.__ready');
}
if (evalJs) {
  const r = await page.evaluate(evalJs);
  if (r !== undefined) console.log('eval', JSON.stringify(r));
  await page.waitForTimeout(after);
}
await page.screenshot({ path: out, timeout: 180000 });
const info = await page.evaluate(() => window.__info ?? null).catch(() => null);
console.log(`saved ${out} in ${Date.now() - t0}ms`);
if (info) console.log('info', JSON.stringify(info));
for (const e of errors.slice(0, 30)) console.log(e);
await browser.close();
