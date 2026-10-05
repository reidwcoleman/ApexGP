// Face/upper-body close-ups of the garage people (head bone framed): node tools/faceshot.mjs [outDir] [idx,idx…] [dist=0.9]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [out = 'shots/people', list = '', dist = '0.9'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=monza`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(1500);
const n = await page.evaluate(() => {
  document.getElementById('ui').style.visibility = 'hidden';
  for (const el of document.querySelectorAll('.menu, #menu, .hub')) el.style.visibility = 'hidden';
  // the garage hides people near the lens or in the line of sight: off for close-ups
  const gs = window.__game.garage, upd = gs.update;
  gs.update = (dt) => { for (const { p } of gs.people) p.root.visible = true; upd.call(gs, dt); };
  return window.__game.garage.people.length;
});
const idx = list ? list.split(',').map(Number) : [...Array(n).keys()];
for (const i of idx) {
  const ok = await page.evaluate(([i, d]) => {
    const g = window.__game;
    const p = g.garage.people[i]?.p;
    if (!p) return false;
    const head = p.bones['Bip01 Head'] ?? p.bones['head'] ?? Object.values(p.bones).find((b) => /head/i.test(b.name));
    p.root.updateMatrixWorld(true);
    const h = head.getWorldPosition(head.position.clone());
    // shoot from the garage camera's side (the open bay), so no wall is in between
    window.__home ??= g.camera.position.clone();
    const dx = window.__home.x - h.x, dz = window.__home.z - h.z, yaw = Math.atan2(dx, dz);
    g.freeCam = { pos: [h.x + Math.sin(yaw) * d, h.y - 0.3, h.z + Math.cos(yaw) * d], look: [h.x, h.y - (d > 1.5 ? 0.6 : 0.12), h.z], fov: 45 };
    return true;
  }, [i, Number(dist)]);
  if (!ok) continue;
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/face${i}.png` });
  console.log(`${out}/face${i}.png`);
}
await browser.close();
