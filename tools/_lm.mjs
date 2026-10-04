// Shots of every cluster of a mesh (landmarks_rooms, village_walls…; CL cluster radius, MAXCL, PORT env). node tools/_lm.mjs <out> <track> [mesh] [dist<0: far side] [h]
import { chromium } from 'playwright-core';
const [out, track, mesh = 'landmarks_rooms', dist = '70', hh = '12'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5191}/?track=${track}&demo=race&skip=20&weather=${process.env.WX ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}&settle=500`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
const n = await page.evaluate(([mesh, R, MAXCL]) => {
  document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none'));
  const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1);
  let m = null; g.scene.traverse((o) => { if (o.name === mesh) m = o; });
  if (!m) return 0;
  const p = m.isInstancedMesh ? { count: m.count, getX: (i) => m.instanceMatrix.array[i * 16 + 12], getY: (i) => m.instanceMatrix.array[i * 16 + 13], getZ: (i) => m.instanceMatrix.array[i * 16 + 14] } : m.geometry.attributes.position;
  const cl = [];
  for (let i = 0; i < p.count; i += m.isInstancedMesh ? 1 : 4) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let c = cl.find((c) => Math.hypot(c.x / c.n - x, c.z / c.n - z) < R);
    if (!c) cl.push((c = { x: 0, y: 0, z: 0, n: 0 }));
    c.x += x; c.y += y; c.z += z; c.n++;
  }
  cl.sort((a, b) => b.n - a.n);
  window.__cl = cl.slice(0, MAXCL).map((c) => [c.x / c.n, c.y / c.n, c.z / c.n]);
  return window.__cl.length;
}, [mesh, Number(process.env.CL ?? 90), Number(process.env.MAXCL ?? 8)]);
console.log('clusters', n);
for (let k = 0; k < n; k++) {
  await page.evaluate(([k, dist, hh]) => {
    const g = window.__game; const [x, y, z] = window.__cl[k];
    const pr = g.track.project(x, z);
    const t = g.track.point(pr.s, 0, 0);
    const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz);
    // from the circuit side, `dist` m out, a little to one side
    const px = x + (dx / d) * dist + (dz / d) * dist * 0.35, pz = z + (dz / d) * dist - (dx / d) * dist * 0.35;
    g.freeCam = { pos: [px, y + hh, pz], look: [x, y, z], fov: 55 };
  }, [k, Number(dist), Number(hh)]);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/${track}_${mesh}_${k}.jpg`, quality: 88 });
}
await browser.close();
console.log('done', track);
