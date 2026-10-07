// The crowd reacting, under control: the race frozen, a camera pinned on the track looking at a
// stand, the cars placed by hand; one screenshot per scenario.
//   node tools/rx_crowd.mjs shots/prefix [--track monza] [--ahead 160] [--scn none,lead,pack,mex,hot] [--what crowd]
//     [--cam dx,dy,back] (camera: back metres up-track of the fan, dx metres across, dy up) [--fov 42] [--eval js]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';

const args = process.argv.slice(2);
const prefix = args[0] ?? 'shots/rx';
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt('port', '5191');
const track = opt('track', 'monza');
const ahead = +opt('ahead', '160');
const scns = opt('scn', 'none,lead,pack,mex').split(',');
const what = opt('what', 'crowd');
const camSpec = opt('cam', '-6,3.5,25').split(',').map(Number);
const fov = +opt('fov', '42');
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.text().startsWith('[rx]')) console.log('[' + m.type() + '] ' + m.text().slice(0, 400));
});
await page.addInitScript(() => {
  try {
    localStorage.setItem('apexgp.settings', JSON.stringify({ v: 99, quality: 'high', camera: 'chase', volume: 0, autoQuality: false }));
  } catch {}
});
await page.goto(`http://localhost:${port}/?track=${track}&settle=500`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const info = await page.evaluate(
  async ([ahead, what, camSpec, fov]) => {
    const g = window.__game;
    g.adaptQuality = () => {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    g.debugStart({ autopilot: true, skip: 6, camera: 'tv', weather: 'clear', time: 'midday' });
    await sleep(2500);
    const race = g.race;
    // freeze the race; no depth of field
    race.update = () => void (race.events.length = 0);
    g.gfx.setDepthOfField(false);
    g.gfx.setDepthOfField = () => {};
    const lead = race.cars.reduce((a, c) => (c.position < a.position ? c : a));
    const L = g.track.length;
    let mesh = null;
    g.scene.traverse((o) => {
      if (o.name === what && o.isInstancedMesh && !mesh) mesh = o;
    });
    if (!mesh) return { err: 'no ' + what };
    const sAttr = mesh.geometry.attributes.aS;
    const want = (lead.car.s + ahead) % L;
    let best = -1, bd = 1e9;
    const M = new mesh.matrixWorld.constructor();
    for (let i = 0; i < mesh.count; i++) {
      const s = sAttr ? sAttr.getX(i) : 0;
      const d = Math.abs(((s - want + L * 1.5) % L) - L / 2);
      if (d < bd) { bd = d; best = i; }
    }
    mesh.getMatrixAt(best, M);
    M.premultiply(mesh.matrixWorld);
    const V = g.camera.position.constructor;
    const p = new V().setFromMatrixPosition(M);
    const s = sAttr ? sAttr.getX(best) : want;
    const f = g.track.frame(s);
    const c = g.track.point(s, 0, 0, new V());
    const side = Math.sign((p.x - c.x) * f.right.x + (p.z - c.z) * f.right.z) || 1;
    const eye = g.track.point(s - camSpec[2], side * camSpec[0], 0, new V());
    eye.y = c.y + camSpec[1];
    const target = p.clone();
    target.y += 1.5;
    const cam = g.camera;
    const orig = cam.updateMatrixWorld.bind(cam);
    cam.updateMatrixWorld = (fl) => {
      cam.position.copy(eye);
      cam.lookAt(target);
      if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
      orig(fl);
    };
    const mod = await import('/src/people/reactions.ts');
    window.__rx = { s, L, mod, race };
    return { fan: best, s: +s.toFixed(1), dist: +bd.toFixed(1), count: mesh.count };
  },
  [ahead, what, camSpec, fov],
);
console.log('target', JSON.stringify(info));
const ev = opt('eval', null);
if (ev) console.log('eval', JSON.stringify(await page.evaluate(ev)));
for (const scn of scns) {
  await page.evaluate((scn) => {
    const { s, L, mod, race } = window.__rx;
    const cr = mod.crowdReactions;
    cr.hot = [];
    cr.mexLeft = 0;
    const cars = [...race.cars].sort((a, b) => a.position - b.position);
    // everyone far away
    cars.forEach((c, i) => (c.car.s = (s + L / 2 + i * 10) % L));
    if (scn === 'lead') cars[0].car.s = (s - 40 + L) % L;
    if (scn === 'pack') cars.slice(4, 10).forEach((c, i) => (c.car.s = (s - 30 - i * 12 + L) % L));
    if (scn === 'mex') {
      cr.mexS = s - 10;
      cr.mexLeft = 120;
    }
    if (scn === 'hot') cr.addHot(s, 2.2, 90, 30);
    for (const c of race.cars) c.car.vx = Math.max(c.car.vx, 60);
  }, scn);
  await page.waitForTimeout(scn === 'mex' ? 400 : 1500);
  await page.screenshot({ path: `${prefix}_${scn}.png` });
  console.log('saved', `${prefix}_${scn}.png`);
}
await browser.close();
