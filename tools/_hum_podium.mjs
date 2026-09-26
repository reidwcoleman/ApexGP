// Podium screenshots for the people pass: node tools/_hum_podium.mjs out_prefix [times s, comma] [--port 5191]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const prefix = args[0] ?? 'shots/hum_pod';
const times = (args[1] ?? '4,12,24').split(',').map(Number);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt('port', '5191');
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[error] ' + m.text().slice(0, 300));
});
await page.addInitScript(() => {
  try {
    localStorage.setItem('apexgp.settings', JSON.stringify({ v: 99, quality: 'high', camera: 'chase', volume: 0, autoQuality: false }));
  } catch {}
});
await page.goto(`http://localhost:${port}/?track=monza&settle=500`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 150000 });
const info = await page.evaluate(async () => {
  const g = window.__game;
  g.adaptQuality = () => {};
  g.debugStart({ autopilot: true, skip: 20, camera: 'chase' });
  await new Promise((r) => setTimeout(r, 1500));
  g.startCelebration();
  const c = g.celebration;
  let n = 0;
  c?.group.traverse((o) => {
    if (o.isInstancedMesh && o.material?.name !== 'x') n = Math.max(n, o.count);
  });
  return { fans: n };
});
console.log('podium', JSON.stringify(info));
let t0 = 0;
for (const t of times) {
  await page.waitForTimeout((t - t0) * 1000);
  t0 = t;
  await page.screenshot({ path: `${prefix}_${t}.png` });
  console.log('saved', `${prefix}_${t}.png`);
}
await browser.close();
