// Shadow casters per scene group: triangles (each cascade draws them again, less what it culls). node tools/casters.mjs [track]
import { chromium } from 'playwright-core';
const [track = 'monza'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:5191/?track=${track}&demo=race&cam=chase&skip=30&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const g = window.__game;
  const out = {};
  const count = (name, root) => {
    let tris = 0, n = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.castShadow || !o.visible) return;
      let p = o, vis = true;
      while (p) { if (!p.visible) { vis = false; break; } p = p.parent; }
      if (!vis) return;
      const geo = o.geometry;
      const t = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      tris += t * (o.isInstancedMesh ? o.count : o.isBatchedMesh ? 1 : 1);
      n++;
    });
    out[name] = { tris: Math.round(tris), meshes: n };
  };
  const scen = g.env.group.children.find((c) => c.name === 'Scenery');
  for (const c of scen?.children ?? []) count('scen:' + c.name, c);
  count('trackside', g.trackside.group);
  count('pits', g.pits.group);
  count('cars', g.carsGroup);
  // the heaviest single casters in the trackside and pits
  const list = [];
  for (const root of [g.trackside.group, g.pits.group]) root.traverse((o) => {
    if (!o.isMesh || !o.castShadow) return;
    const geo = o.geometry;
    list.push([(o.name || o.parent?.name || '?') + (o.material?.name ? '/' + o.material.name : ''), Math.round((geo.index ? geo.index.count : geo.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1), o.geometry.boundingSphere?.radius | 0]);
  });
  list.sort((a, b) => b[1] - a[1]);
  out.top = list.slice(0, 14);
  return out;
});
const top = r.top; delete r.top;
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(26), String(v.tris).padStart(9), 'tris', v.meshes, 'meshes');
for (const t of top) console.log('  ', t.join('  '));
await browser.close();
