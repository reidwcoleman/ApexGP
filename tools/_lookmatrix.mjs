// Every time of day × weather in one sweep (the lighting regression sheet), plus the TikTok look-study scenes.
//   node tools/_lookmatrix.mjs <outdir> [track] [cond,...]
// cond = weather:time[:track[:cam[:skip]]], optionally prefixed `name=` (then saved as <name>_<i>.jpg, N frames,
// no vista); `look` expands to the reference-matching scenes of tools/_lookshots.mjs.
// Default: all 8 times clear + every weather in the afternoon, each shot with the race camera ($CAM, default tv)
// and a frozen free-camera vista down the valley toward the horizon ($VISTA = "s,lat,h,lookS,lookLat,lookH,fov",
// s relative to the start line; VISTA=none skips it), to judge the haze. A crashed browser is relaunched.
// PORT env picks the dev server. Compare against the footage with tools/lookcompare.py.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out = 'shots/matrix', track = 'spa', list] = process.argv.slice(2);
const TIMES = ['dawn', 'morning', 'midday', 'afternoon', 'golden', 'sunset', 'dusk', 'night'];
const WX = ['clear', 'cloudy', 'overcast', 'mist', 'fog', 'drizzle', 'rain', 'storm'];
const LOOK = [
  'rain_cockpit=rain:morning:spa:cockpit',
  'night_cockpit=clear:night:monza:cockpit',
  'mist_halo=mist:dusk:spielberg:cockpit',
  'day_halo=clear:afternoon:monza:cockpit',
  'golden_longlens=clear:golden:spa:longlens:25',
  'day_tv=clear:afternoon:monza:tv',
  'day_chase=clear:golden:spa:chase',
];
let conds = list ? list.split(',') : [...TIMES.map((t) => `clear:${t}`), ...WX.filter((w) => w !== 'clear').map((w) => `${w}:afternoon`)];
conds = conds.flatMap((c) => (c === 'look' ? LOOK : [c]));
const vistaEnv = process.env.VISTA ?? '300,-20,30,1500,0,10,60';
const vista = vistaEnv === 'none' ? null : vistaEnv.split(',').map(Number);
const launch = () => chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let browser = await launch();
for (const c0 of conds) {
  const [name, spec] = c0.includes('=') ? c0.split('=') : [null, c0];
  const [wx, time, tr = track, cam = process.env.CAM ?? 'tv', skip = process.env.SKIP ?? 40] = spec.split(':');
  for (let attempt = 0; attempt < 2; attempt++) {
    let page;
    try {
      if (!browser.isConnected()) browser = await launch();
      page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) }, deviceScaleFactor: 1 });
      page.on('pageerror', (e) => console.log('[pageerror]', e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('403')) console.log('[err]', m.text().slice(0, 300)); });
      await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${tr}&demo=race&cam=${cam}&skip=${skip}&weather=${wx}&time=${time}`, { timeout: 180000 });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
      await page.evaluate((cam) => { document.getElementById('ui').style.visibility = 'hidden'; const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); g.cams.set(cam); }, cam);
      if (name) {
        for (let i = 0; i < Number(process.env.N ?? 3); i++) {
          await page.waitForTimeout(i === 0 ? 2500 : 1700);
          await page.screenshot({ path: `${out}/${name}_${i}.jpg`, quality: 85 });
        }
      } else {
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${out}/${tr}_${wx}_${time}_cam.jpg`, quality: 85 });
        if (vista) {
          await page.evaluate(([s, lat, h, ls, ll, lh, fov]) => {
            const g = window.__game; const L = g.track.length; const S = (v) => (((g.track.startS + v) % L) + L) % L;
            g.freeCam = { pos: g.trackPoint(S(s), lat, h), look: g.trackPoint(S(ls), ll, lh), fov };
          }, vista);
          await page.waitForTimeout(1800);
          await page.screenshot({ path: `${out}/${tr}_${wx}_${time}_vista.jpg`, quality: 85 });
        }
      }
      console.log('saved', c0);
      await page.close();
      break;
    } catch (e) {
      console.log('FAILED', c0, e.message.split('\n')[0].slice(0, 160));
      try { await page?.close(); } catch {}
    }
  }
}
await browser.close();
