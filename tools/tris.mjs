// Triangles and draw calls per scene group (main + shadow passes) in a live race. node tools/tris.mjs [track] [cam]
import { chromium } from 'playwright-core';
const [track = 'monza', cam = 'chase'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:5191/?track=${track}&demo=race&cam=${cam}&skip=30&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const g = window.__game;
  g.worldBusy = true;
  const info = g.gfx.renderer.info;
  info.autoReset = false;
  const frame = () => { info.reset(); g.gfx.render(0.016); return { tris: info.render.triangles, calls: info.render.calls }; };
  frame();
  const base = frame();
  const out = { base };
  const groups = [];
  const scen = g.env.group.children.find((c) => c.name === 'Scenery');
  if (scen) for (const c of scen.children) groups.push(['scen:' + c.name, c]);
  for (const c of g.env.group.children) if (c !== scen) groups.push(['env:' + (c.name || c.type), c]);
  groups.push(['trackside', g.trackside.group], ['pits', g.pits.group], ['cars', g.carsGroup]);
  for (const [n, o] of groups) {
    const v = o.visible;
    o.visible = false;
    const f = frame();
    o.visible = v;
    out[n] = { tris: base.tris - f.tris, calls: base.calls - f.calls };
  }
  info.autoReset = true;
  g.worldBusy = false;
  return out;
});
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(28), String(v.tris).padStart(9), 'tris', String(v.calls).padStart(5), 'calls');
await browser.close();
