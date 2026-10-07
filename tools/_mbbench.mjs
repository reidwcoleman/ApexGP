// GPU cost of the camera motion blur: frames rendered back to back with the camera moving 1.5 m a frame.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=monza&demo=race&cam=cockpit&skip=30&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(2500);
console.log(await page.evaluate(async () => {
  const g = window.__game;
  g.adaptQuality = () => {};
  g.gfx.setDynamicScale(1);
  await new Promise((r) => setTimeout(r, 300));
  g.worldBusy = true;
  const gl = g.gfx.renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const cam = g.camera;
  const fwd = cam.getWorldDirection(cam.position.clone());
  const base = cam.position.clone();
  const own = g.gfx.onboardCar;
  const run = (mb, ob = true) => {
    g.gfx.motionBlur = mb;
    g.gfx.onboardCar = ob ? own : null;
    const ts = [];
    for (let k = 0; k < 4; k++) {
      const t0 = performance.now();
      for (let i = 0; i < 30; i++) { cam.position.copy(base).addScaledVector(fwd, (i % 2) * 1.5); g.gfx.render(1 / 60); }
      sync();
      ts.push((performance.now() - t0) / 30);
    }
    ts.sort((a, b) => a - b);
    return +ts[1].toFixed(2);
  };
  run(0);
  return { none: run(0, false), onboard: run(0, true), both: run(0.6, true), none2: run(0, false), onboard2: run(0, true), both2: run(0.6, true), hadOwn: !!own };
}));
await browser.close();
