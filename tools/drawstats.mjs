// Exact per-frame accounting of draw calls and triangles, by top-level group and
// by pass (main camera, shadow cameras, other render targets).
//   node tools/drawstats.mjs [--scene menu|grid|chase|tv|podium] [--track monza] [--q high] [--depth 2]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const scene = opt('scene', 'chase');
const q = opt('q', 'high');
const track = opt('track', 'monza');
const depth = Number(opt('depth', 2));

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
await page.addInitScript(([q]) => {
  try {
    localStorage.setItem('apexgp.settings', JSON.stringify({ v: 99, quality: q, camera: 'chase', volume: 0, autoQuality: false }));
  } catch {}
}, [q]);
await page.goto(`http://localhost:5191/?track=${track}&settle=500`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const out = await page.evaluate(
  async ([scene, depth]) => {
    const g = window.__game;
    g.adaptQuality = () => {};
    if (scene === 'grid') g.debugStart({ autopilot: true, camera: 'chase' });
    else if (scene !== 'menu') g.debugStart({ autopilot: true, skip: 20, camera: 'chase' });
    if (scene === 'tv') g.cams.set('tv');
    if (scene === 'podium') g.startCelebration();
    const frames = (n) => new Promise((r) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); });
    await frames(scene === 'grid' ? 5 : 30);
    const r = g.gfx.renderer;
    const acc = {};
    let on = false;
    const orig = r.renderBufferDirect.bind(r);
    const pathOf = (o) => {
      const chain = [];
      for (let p = o; p; p = p.parent) chain.unshift(p);
      // chain[0] is the scene (or the object itself for off-scene renders)
      const names = chain.slice(1, 1 + depth).map((x) => x.name || x.type);
      return names.join('/') || o.name || o.type;
    };
    r.renderBufferDirect = (camera, sc, geo, mat, obj, group) => {
      if (on) {
        const pass = camera.isOrthographicCamera && camera !== g.camera ? (r.getRenderTarget() && r.getRenderTarget().depthTexture ? 'shadow' : 'ortho') : camera === g.camera ? 'main' : 'other';
        const key = pass + ' ' + pathOf(obj);
        let n = geo.index ? geo.index.count : geo.attributes.position ? geo.attributes.position.count : 0;
        if (group) n = Math.min(n, group.count);
        n = Math.min(n, geo.drawRange.count);
        const inst = obj.isInstancedMesh ? obj.count : geo.isInstancedBufferGeometry ? geo.instanceCount : 1;
        const tris = (mat.wireframe ? 0 : n / 3) * (isFinite(inst) ? inst : 1);
        const a = (acc[key] ??= { calls: 0, ktris: 0 });
        a.calls++;
        a.ktris += tris / 1000;
      }
      return orig(camera, sc, geo, mat, obj, group);
    };
    on = true;
    await frames(2);
    on = false;
    const rows = Object.entries(acc).map(([k, v]) => [k, v.calls / 2, Math.round(v.ktris / 2)]).sort((a, b) => b[2] - a[2]);
    const tot = rows.reduce((s, x) => [s[0] + x[1], s[1] + x[2]], [0, 0]);
    return { total: { calls: tot[0], ktris: tot[1] }, rows: rows.filter((x) => x[2] > 5 || x[1] > 5) };
  },
  [scene, depth],
);
console.log(scene, 'total', JSON.stringify(out.total));
for (const r of out.rows) console.log(String(r[1]).padStart(5), String(r[2]).padStart(7) + 'k', r[0]);
await browser.close();
