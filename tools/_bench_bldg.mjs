// Robust-ish GPU cost of the buildings on a busy machine: min-of-many frame times with everything,
// without the pit complex, without the stands/landmarks, from a few cameras.  node tools/_bench_bldg.mjs <track>
import { chromium } from 'playwright-core';
const [track = 'monza'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5191}/?track=${track}&demo=race&cam=chase&skip=30&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
await page.waitForTimeout(2500);
const r = await page.evaluate(async () => {
  const g = window.__game;
  g.adaptQuality = () => {};
  g.gfx.setDynamicScale(1);
  await new Promise((r) => setTimeout(r, 300));
  const gl = g.gfx.renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const frame = (n = 12) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) g.gfx.render(0.016);
    sync();
    return (performance.now() - t0) / n;
  };
  const scen = g.env.group.children.find((c) => c.name === 'Scenery');
  const stands = scen ? scen.children.filter((c) => /Grandstand|Villages/i.test(c.name)) : [];
  const side = g.track.pit.side;
  const st = g.track.startS;
  const cams = {
    grid: [g.trackPoint(st - 160, -3 * side, 1.1), g.trackPoint(st + 40, 30 * side, 7), 58],
    tv: [g.trackPoint(st - 420, -14 * side, 10), g.trackPoint(st + 40, 30 * side, 9), 22],
    across: [g.trackPoint(st + 20, -28 * side, 7), g.trackPoint(st + 20, 36 * side, 9), 55],
  };
  const out = {};
  for (const [name, [pos, look, fov]] of Object.entries(cams)) {
    g.freeCam = { pos, look, fov };
    g.worldBusy = false;
    await new Promise((r) => setTimeout(r, 600));
    g.worldBusy = true;
    frame(4);
    const best = { all: 1e9, noPits: 1e9, noStands: 1e9 };
    for (let k = 0; k < 8; k++) {
      best.all = Math.min(best.all, frame());
      g.pits.group.visible = false;
      best.noPits = Math.min(best.noPits, frame());
      g.pits.group.visible = true;
      stands.forEach((s) => (s.visible = false));
      best.noStands = Math.min(best.noStands, frame());
      stands.forEach((s) => (s.visible = true));
    }
    out[name] = `all ${best.all.toFixed(2)}  pits ${(best.all - best.noPits).toFixed(2)}  stands+villages ${(best.all - best.noStands).toFixed(2)}`;
  }
  g.worldBusy = false;
  out.standsGroups = stands.map((s) => s.name).join(',');
  return out;
});
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(10), v);
await browser.close();
