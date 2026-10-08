// Many weather × time conditions from ONE boot (the look iterates in seconds, not a boot per shot):
// the live race's forecast is swapped for a freshly rolled plan of each condition, then the chase
// camera, a frozen vista down the start straight toward the horizon and a frozen look up at the sky
// (`up`: 25° above the horizon, across the straight, away from the pits) are shot.
//   PORT=5701 node tools/_wxsweep.mjs <outdir> [track=monza] clear:midday,overcast:morning,… [views=chase,vista,up]
// (more views: sun — toward the sun's azimuth just above the horizon; heli, tv — the race's own cameras)
// Not a substitute for a real boot (a night race's headlights, the start's own weather): a sheet for
// tuning the sky. Same seed every condition, so the clouds sit in the same place.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [out = 'shots/sweep', track = 'monza', list = 'clear:midday', viewsArg = 'chase,vista,up'] = process.argv.slice(2);
const views = viewsArg.split(',');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('403')) console.log('[err]', m.text().slice(0, 300)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5701}/?track=${track}&demo=race&cam=chase&skip=${process.env.SKIP ?? 40}&weather=clear&time=afternoon`, { timeout: 180000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); });
for (const c of list.split(',')) {
  const [wx, time] = c.split(':');
  await page.evaluate(async ([wx, time, seed]) => {
    const W = await import('/src/world/Weather.ts');
    const w = window.__game.race.weather;
    const p = W.planWeather(wx, time, 900, seed);
    Object.assign(w.plan, { keys: p.keys, windX: p.windX, windZ: p.windZ, start: p.start, end: p.end, changeAt: p.changeAt, time: p.time });
    w.state.time = time;
    w.state.t = 0;
    // (a drying track starts wet with a line already cleared, as the Weather constructor has it)
    w.state.wetness = wx === 'drying' ? 0.7 : 0;
    w.state.dryLine = wx === 'drying' ? 0.3 : 0;
  }, [wx, time, Number(process.env.SEED ?? 7)]);
  for (const v of views) {
    await page.evaluate((v) => {
      const g = window.__game;
      const L = g.track.length;
      const S = (x) => (((g.track.startS + x) % L) + L) % L;
      if (v === 'chase' || v === 'heli' || v === 'tv') { g.freeCam = null; g.cams.set(v); }
      else if (v === 'sun') {
        // toward the sun's azimuth, 4° up: the glow, the disc, the far hills against the bright sky
        const p = g.trackPoint(S(300), -20, 30);
        const s = g.env.sun.position.clone().normalize();
        const h = Math.hypot(s.x, s.z) || 1;
        g.freeCam = { pos: p, look: [p[0] + (s.x / h) * 100, p[1] + 100 * Math.tan(4 * Math.PI / 180), p[2] + (s.z / h) * 100], fov: 60 };
      }
      else if (v === 'vista') g.freeCam = { pos: g.trackPoint(S(300), -20, 30), look: g.trackPoint(S(1500), 0, 10), fov: 60 };
      else if (v === 'up') {
        const p = g.trackPoint(S(200), 0, 2);
        const a = g.trackPoint(S(260), 0, 2);
        // across the straight (to the left, away from the pit building), 25° up
        const dx = a[0] - p[0], dz = a[2] - p[2], l = Math.hypot(dx, dz);
        const rx = dz / l, rz = -dx / l;
        g.freeCam = { pos: p, look: [p[0] + rx * 100, p[1] + 100 * Math.tan(25 * Math.PI / 180), p[2] + rz * 100], fov: 70 };
      }
    }, v);
    await page.waitForTimeout(v === views[0] ? Number(process.env.SETTLE ?? 3500) : 1800);
    await page.screenshot({ path: `${out}/${track}_${wx}_${time}_${v}.jpg`, quality: 88 });
  }
  console.log('saved', c);
}
await browser.close();
