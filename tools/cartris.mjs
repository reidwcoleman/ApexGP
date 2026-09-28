// Triangles and meshes per car detail level, and per car at each level in the live scene. node tools/cartris.mjs
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage();
await page.goto('http://localhost:5191/?track=monza');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const r = await page.evaluate(() => {
  const g = window.__game;
  const rig = [...g.rigs.values()][3];
  const out = {};
  for (const lv of [0, 1, 2]) {
    rig.root.visible = true;
    rig.setDetail(lv);
    rig.root.updateMatrixWorld(true);
    let tris = 0, meshes = 0;
    rig.root.traverseVisible((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry;
      const n = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      tris += n * (o.isInstancedMesh ? o.count : 1);
      meshes++;
    });
    out['LOD' + lv] = { tris: Math.round(tris), meshes };
  }
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
