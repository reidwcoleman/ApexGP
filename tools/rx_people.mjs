// People around the circuit, under control: a race started and frozen (no depth of field), then for
// each scenario a JS snippet run in the page that returns { eye: [x,y,z], target: [x,y,z], fov? };
// the camera is pinned there and a screenshot taken.
//   node tools/rx_people.mjs shots/prefix [--track monza] [--weather clear] [--time midday] [--live] [--wait 1500] -- name1 'js…' name2 'js…'
// In the snippets: g (the game), R (src/people/reactions.ts), V (THREE.Vector3), T (the track).
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';

const args = process.argv.slice(2);
const prefix = args[0] ?? 'shots/rxp';
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && i < args.indexOf('--') ? args[i + 1] : d;
};
const port = opt('port', '5191');
const track = opt('track', 'monza');
const weather = opt('weather', 'clear');
const time = opt('time', 'midday');
const live = args.includes('--live');
const wait = +opt('wait', '1500');
const skip = +opt('skip', '6');
const rest = args.slice(args.indexOf('--') + 1);
const scns = [];
for (let i = 0; i + 1 < rest.length; i += 2) scns.push([rest[i], rest[i + 1]]);
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[rx]')) console.log('[' + m.type() + '] ' + m.text().slice(0, 300));
});
await page.addInitScript(() => {
  try {
    localStorage.setItem('apexgp.settings', JSON.stringify({ v: 99, quality: 'high', camera: 'chase', volume: 0, autoQuality: false }));
  } catch {}
});
await page.goto(`http://localhost:${port}/?track=${track}&settle=500`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.evaluate(
  async ([weather, time, live, skip]) => {
    const g = window.__game;
    g.adaptQuality = () => {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    g.debugStart({ autopilot: true, skip, camera: 'tv', weather, time });
    await sleep(2500);
    if (!live) g.race.update = () => void (g.race.events.length = 0);
    g.gfx.setDepthOfField(false);
    g.gfx.setDepthOfField = () => {};
    const R = await import('/src/people/reactions.ts');
    const cam = g.camera;
    const V = cam.position.constructor;
    const orig = cam.updateMatrixWorld.bind(cam);
    window.__pin = null;
    cam.updateMatrixWorld = (f) => {
      const p = window.__pin;
      if (p) {
        cam.position.set(...p.eye);
        cam.lookAt(new V(...p.target));
        const fov = p.fov ?? 40;
        if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
      }
      orig(f);
    };
    window.__rxEnv = { g, R, V, T: g.track };
    // wait for the people to be built (the avatars load in the background)
    const t0 = performance.now();
    while (performance.now() - t0 < 60000) {
      let n = 0;
      g.scene.traverse((o) => { if (o.name === 'track_people_extras') n++; });
      if (n) break;
      await sleep(500);
    }
  },
  [weather, time, live, skip],
);
for (const [name, js] of scns) {
  const r = await page.evaluate(async (js) => {
    const { g, R, V, T } = window.__rxEnv;
    const f = new Function('g', 'R', 'V', 'T', `return (async () => { ${js} })()`);
    const out = await f(g, R, V, T);
    if (out && out.eye) window.__pin = out;
    return out;
  }, js);
  console.log(name, JSON.stringify(r)?.slice(0, 300));
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${prefix}_${name}.png` });
  console.log('saved', `${prefix}_${name}.png`);
}
await browser.close();
