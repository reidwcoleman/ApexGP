// The crowd reacting: a camera pinned on the track looking at the stand the leader is about to pass,
// screenshots as the field goes by.
//   node tools/rx_crowd.mjs shots/prefix [--track monza] [--ahead 160] [--frames 5] [--gap 700] [--skip 8] [--eval js]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const prefix = args[0] ?? 'shots/rx';
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt('port', '5191');
const track = opt('track', 'monza');
const ahead = +opt('ahead', '160');
const frames = +opt('frames', '5');
const gap = +opt('gap', '700');
const skip = +opt('skip', '8');
const what = opt('what', 'crowd');
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
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
  async ([ahead, skip, what]) => {
    const g = window.__game;
    g.adaptQuality = () => {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    g.debugStart({ autopilot: true, skip, camera: 'tv' });
    await sleep(2500);
    const race = g.race;
    const lead = race.cars.reduce((a, c) => (c.position < a.position ? c : a));
    const L = g.track.length;
    // the target: a member of `what` (a mesh name) closest to `ahead` metres in front of the leader
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
    // from the far side of the track, looking at the fan, a little above
    const side = Math.sign((p.x - c.x) * f.right.x + (p.z - c.z) * f.right.z) || 1;
    const eye = g.track.point(s - 25, -side * 6, 0, new V());
    eye.y = c.y + 3.5;
    const target = p.clone();
    target.y += 1.5;
    const cam = g.camera;
    const orig = cam.updateMatrixWorld.bind(cam);
    cam.updateMatrixWorld = (fl) => {
      cam.position.copy(eye);
      cam.lookAt(target);
      if (cam.fov !== 42) { cam.fov = 42; cam.updateProjectionMatrix(); }
      orig(fl);
    };
    window.__rxLead = () => {
      const lead = race.cars.reduce((a, c) => (c.position < a.position ? c : a));
      return { leadS: +lead.car.s.toFixed(0), fanS: +s.toFixed(0), quiet: +g.__cu?.toFixed?.(2) };
    };
    return { fan: best, s: +s.toFixed(1), leadS: +lead.car.s.toFixed(1), dist: +bd.toFixed(1) };
  },
  [ahead, skip, what],
);
console.log('target', JSON.stringify(info));
const ev = opt('eval', null);
if (ev) console.log('eval', JSON.stringify(await page.evaluate(ev)));
for (let k = 0; k < frames; k++) {
  await page.waitForTimeout(gap);
  const st = await page.evaluate(() => window.__rxLead());
  await page.screenshot({ path: `${prefix}_${k}.png` });
  console.log('saved', `${prefix}_${k}.png`, JSON.stringify(st));
}
await browser.close();
