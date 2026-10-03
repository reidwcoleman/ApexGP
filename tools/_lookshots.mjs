// Shoots the reference-matching scenes (TikTok look study). node tools/_lookshots.mjs <outdir> [scene,...]
import { chromium } from 'playwright-core';
const [out = 'shots/look', only] = process.argv.slice(2);
const SCENES = {
  rain_cockpit: { track: 'spa', weather: 'rain', time: 'morning', cam: 'cockpit' },
  night_cockpit: { track: 'monza', weather: 'clear', time: 'night', cam: 'cockpit' },
  sunset_longlens: { track: 'spa', weather: 'clear', time: 'sunset', cam: 'longlens', skip: 25 },
  mist_halo: { track: 'spielberg', weather: 'mist', time: 'dusk', cam: 'cockpit' },
  day_halo: { track: 'monza', weather: 'clear', time: 'afternoon', cam: 'cockpit' },
  day_chase: { track: 'spa', weather: 'clear', time: 'golden', cam: 'chase' },
  day_helmet: { track: 'suzuka', weather: 'cloudy', time: 'morning', cam: 'helmet' },
  day_tv: { track: 'monza', weather: 'clear', time: 'afternoon', cam: 'tv' },
  golden_longlens: { track: 'spa', weather: 'clear', time: 'golden', cam: 'longlens', skip: 25 },
};
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
for (const [name, s] of Object.entries(SCENES)) {
  if (only && !only.split(',').includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
  await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${s.track}&demo=race&cam=${s.cam}&skip=${s.skip ?? 40}&weather=${s.weather}&time=${s.time}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  await page.evaluate((cam) => { document.getElementById('ui').style.visibility = 'hidden'; window.__game.adaptQuality = () => {}; window.__game.gfx.setDynamicScale(1); window.__game.cams.set(cam); }, s.cam);
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(i === 0 ? 2500 : 1700);
    await page.screenshot({ path: `${out}/${name}_${i}.jpg`, quality: 85 });
  }
  console.log('saved', name);
  await page.close();
}
await browser.close();
