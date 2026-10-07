// Frame a named mesh from a few angles. node tools/_meshview.mjs <out> <track> <meshName> [dist=1.2]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track, name, distK = '1.2'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&skip=20&weather=clear&time=${process.env.TIME ?? 'afternoon'}&settle=500`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
const views = await page.evaluate(([name, k]) => {
  document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none'));
  const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1);
  let m = null; g.scene.traverse((o) => { if (o.name === name) m = o; });
  if (!m) return null;
  m.geometry.computeBoundingSphere();
  const s = m.geometry.boundingSphere;
  return { c: [s.center.x, s.center.y, s.center.z], r: s.radius * Number(k) };
}, [name, distK]);
console.log(JSON.stringify(views));
if (!views) process.exit(1);
const { c, r } = views;
const cams = (process.env.CAMS ? JSON.parse(process.env.CAMS) : [[1, 0.35, 0], [0, 0.35, 1], [-0.7, 0.2, -0.7], [0.5, 0.08, -0.85]]);
for (let i = 0; i < cams.length; i++) {
  const [dx, dy, dz] = cams[i];
  await page.evaluate(([c, r, dx, dy, dz]) => { const g = window.__game; g.freeCam = { pos: [c[0] + dx * r, c[1] + dy * r + 2, c[2] + dz * r], look: [c[0], c[1], c[2]], fov: 50 }; }, [c, r, dx, dy, dz]);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${name}_${i}.jpg`, quality: 85 });
}
await browser.close();
