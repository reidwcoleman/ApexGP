// Beauty frames for key art / loading screens (steam/art/raw, 3840×2160).
//   node tools/keyart.mjs [name,name…]   (dev server on :5191)
import { chromium } from 'playwright-core';
export const SHOTS = [
  { name: 'sakhir_night', track: 'sakhir', time: 'night', weather: 'clear', cam: 'chase', skip: 55 },
  { name: 'melbourne_golden', track: 'melbourne', time: 'golden', weather: 'clear', cam: 'chase', skip: 50 },
  { name: 'interlagos_rain', track: 'interlagos', time: 'afternoon', weather: 'rain', cam: 'chase', skip: 60 },
  { name: 'zandvoort_golden', track: 'zandvoort', time: 'golden', weather: 'clear', cam: 'tv', skip: 55 },
  { name: 'montreal_sunset', track: 'montreal', time: 'sunset', weather: 'clear', cam: 'chase', skip: 50 },
  { name: 'silverstone_drizzle', track: 'silverstone', time: 'afternoon', weather: 'drizzle', cam: 'chase', skip: 60 },
  { name: 'mexico_golden', track: 'mexico', time: 'golden', weather: 'haze', cam: 'chase', skip: 55 },
  { name: 'austin_sunset', track: 'austin', time: 'sunset', weather: 'clear', cam: 'tv', skip: 55 },
  { name: 'hungaroring_golden', track: 'hungaroring', time: 'golden', weather: 'clear', cam: 'chase', skip: 50 },
  { name: 'spielberg_morning', track: 'spielberg', time: 'morning', weather: 'clear', cam: 'tv', skip: 45 },
  { name: 'monza_sunset', track: 'monza', time: 'sunset', weather: 'clear', cam: 'chase', skip: 60 },
  { name: 'suzuka_dusk', track: 'suzuka', time: 'dusk', weather: 'clear', cam: 'chase', skip: 60 },
  { name: 'spa_rain', track: 'spa', time: 'afternoon', weather: 'rain', cam: 'chase', skip: 65 },
  { name: 'yas_night', track: 'yasmarina', time: 'night', weather: 'clear', cam: 'chase', skip: 70 },
  { name: 'zandvoort_sunset', track: 'zandvoort', time: 'sunset', weather: 'clear', cam: 'chase', skip: 45 },
  { name: 'suzuka_onboard', track: 'suzuka', time: 'sunset', weather: 'clear', cam: 'tcam', skip: 50, noMirror: true },
  { name: 'monza_rain', track: 'monza', time: 'golden', weather: 'sunshower', cam: 'chase', skip: 50 },
];
const want = process.argv[2]?.split(',');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const s of SHOTS.filter((x) => !want || want.includes(x.name))) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:5191/?track=${s.track}&demo=race&cam=${s.cam}&skip=${s.skip}&weather=${s.weather}&time=${s.time}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; window.__game.adaptQuality = () => {}; window.__game.gfx.setDynamicScale(1); });
  if (s.noMirror) await page.evaluate(() => (window.__game.cams.prefs.mirror = false));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `steam/art/raw/${s.name}.png` });
  console.log('saved', s.name);
  await page.close();
}
await browser.close();
