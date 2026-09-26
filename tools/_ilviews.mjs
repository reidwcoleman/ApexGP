// Interlagos landscape views via src/dev/nature.html (one page per view, sequential).
//   node tools/_ilviews.mjs name1 name2 ...   (names from VIEWS below; none = all)
import { chromium } from 'playwright-core';
const VIEWS = {
  straight: 's=1000&lat=-2&h=1.4&ahead=200',
  setorA: 's=1150&lat=-60&h=25&ahead=-10&llat=40&lh=10',
  senna: 's=1420&lat=0&h=3&ahead=180',
  sennaHeli: 's=1450&lat=-220&h=160&ahead=160&llat=0&lh=0',
  reta: 's=2000&lat=0&h=2&ahead=300',
  lago: 's=2500&lat=0&h=3&ahead=160',
  lagoHeli: 's=2560&lat=-260&h=140&ahead=40&llat=-60&lh=0',
  infield: 's=3300&lat=0&h=2&ahead=150',
  juncao: 's=4200&lat=0&h=2&ahead=200',
  blimpN: 's=1200&lat=500&h=420&ahead=200&llat=-500&lh=-40',
  blimpS: 's=2800&lat=900&h=500&ahead=-900&llat=-200&lh=0',
  west: 's=900&lat=0&h=6&az=270&pitch=4',
  north: 's=1300&lat=0&h=6&az=0&pitch=3',
  east: 's=2300&lat=0&h=6&az=90&pitch=3',
  south: 's=600&lat=0&h=8&az=180&pitch=3',
};
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(VIEWS);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
for (const n of names) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[interlagos]')) console.log('[' + m.type() + ']', m.text().slice(0, 300)); });
  const t0 = Date.now();
  await page.goto(`http://localhost:${process.env.PORT ?? 5191}/src/dev/nature.html?track=interlagos&${VIEWS[n] ?? n}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 150000 }).catch(() => console.log('no __ready'));
  await page.waitForTimeout(1500);
  try { await page.screenshot({ path: `shots/il_${n}.png`, timeout: 180000 }); } catch (e) { console.log(n, 'screenshot failed', e.message.slice(0, 80)); }
  const info = await page.evaluate(() => window.__info ?? null).catch(() => null);
  console.log(n, Date.now() - t0, 'ms', JSON.stringify(info));
  await page.close();
}
await browser.close();
