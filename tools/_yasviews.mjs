// Yas Marina views via src/dev/nature.html (one page per view, sequential).
//   OUT=<dir> node tools/_yasviews.mjs name1 name2 ...   (names from VIEWS below, or a raw query string)
//   TIME=dusk|night|afternoon (default dusk)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const VIEWS = {
  aerial: 's=5100&lat=420&h=260&ahead=0&llat=40&lh=0',
  hotelTrack: 's=5020&lat=0&h=2&ahead=90',
  hotelUnder: 's=5075&lat=-2&h=1.5&ahead=40&lh=12',
  hotelMarina: 's=4560&lat=90&h=12&ahead=520&llat=40&lh=18',
  marina: 's=560&lat=150&h=30&ahead=0&llat=320&lh=0',
  straight: 's=300&lat=-2&h=1.5&ahead=300',
  grid: 's=330&lat=-30&h=16&ahead=160&llat=5&lh=0',
  pits: 's=420&lat=4&h=3&ahead=120&llat=18&lh=2',
  hairpin: 's=1700&lat=-10&h=4&ahead=200',
  ferrari: 's=1850&lat=60&h=40&az=60&pitch=-2',
  back: 's=2200&lat=0&h=2&ahead=400',
  t8: 's=2900&lat=0&h=3&ahead=200',
  marinaGs: 's=4450&lat=-20&h=6&ahead=160',
  blimp: 's=3600&lat=-900&h=700&ahead=1200&llat=300&lh=0',
};
const time = process.env.TIME ?? 'dusk';
const out = process.env.OUT ?? 'shots';
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(VIEWS);
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'],
});
for (const [ni, n] of names.entries()) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[' + m.type() + ']', m.text().slice(0, 300)); });
  const t0 = Date.now();
  const q = VIEWS[n] ?? n;
  const tag = VIEWS[n] ? n : 'custom' + ni;
  await page.goto(`http://localhost:${process.env.PORT ?? 5191}/src/dev/nature.html?track=yasmarina&time=${time}&${q}`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 }).catch(() => console.log('no __ready'));
  await page.waitForTimeout(2500);
  try { await page.screenshot({ path: `${out}/yas_${tag}_${time}.png`, timeout: 180000 }); } catch (e) { console.log(n, 'screenshot failed', e.message.slice(0, 80)); }
  const info = await page.evaluate(() => window.__info ?? null).catch(() => null);
  console.log(n, Date.now() - t0, 'ms', JSON.stringify(info));
  await page.close();
}
await browser.close();
