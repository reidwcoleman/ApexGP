// Monza landmark views (Villa Reale, Milan). node tools/_monzalm.mjs <out>
import { chromium } from 'playwright-core';
const [out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=monza&demo=race&skip=20&weather=clear&time=${process.env.TIME ?? 'afternoon'}&settle=500`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
const V = await page.evaluate(() => {
  document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none'));
  const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1);
  const { map, layout } = window.__park;
  const v = layout.landmarks.find((l) => l.kind === 'villa');
  const C = map.A.center;
  const B = (deg, d) => { const a = deg * Math.PI / 180; return [C.x + Math.sin(a) * d, C.z - Math.cos(a) * d]; };
  return { v: [v.x, v.y, v.z, v.rot], C: [C.x, map.height(C.x, C.z), C.z], pn: B(205, 13800), cl: B(214, 14600), st: g.trackPoint(g.track.startS, 0, 2) };
});
console.log(JSON.stringify(V));
const [vx, vy, vz, rot] = V.v;
const fwd = [Math.sin(rot), Math.cos(rot)]; // local +z (toward the town)
const views = {
  villa_front: { pos: [vx + fwd[0] * 260, vy + 40, vz + fwd[1] * 260], look: [vx, vy + 10, vz], fov: 40 },
  villa_garden: { pos: [vx - fwd[0] * 330 + 80, vy + 60, vz - fwd[1] * 330], look: [vx, vy + 8, vz], fov: 40 },
  villa_air: { pos: [vx + 220, vy + 220, vz - 150], look: [vx, vy, vz + 20], fov: 45 },
  milan_tele: { pos: [V.st[0], V.st[1] + 30, V.st[2]], look: [V.pn[0], 80, V.pn[1]], fov: 9 },
  milan_cl: { pos: [V.st[0], V.st[1] + 30, V.st[2]], look: [V.cl[0], 100, V.cl[1]], fov: 7 },
};
for (const [k, f] of Object.entries(views)) {
  await page.evaluate((f) => { window.__game.freeCam = f; }, f);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${k}.jpg`, quality: 86 });
}
await browser.close();
