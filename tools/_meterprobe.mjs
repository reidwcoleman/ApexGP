// What the auto-exposure meter reads per camera: the frame's metered log luminance before the grade
// (reference / adapted), the grade's exposure and the exposed key (log of the mid level the grade
// lands on). node tools/_meterprobe.mjs [track] [cams] (PORT, WEATHER, TIME env)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', camsArg = 'chase,tv,longlens,heli'] = process.argv.slice(2);
const cams = camsArg.split(',');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5190}/?track=${track}&demo=race&cam=${cams[0]}&skip=40&weather=${process.env.WEATHER ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.evaluate(() => { window.__game.adaptQuality = () => {}; window.__game.gfx.setDynamicScale(1); });
for (const cam of cams) {
  await page.evaluate((c) => window.__game.cams.set(c), cam);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const gfx = window.__game.gfx;
    const g = gfx.grade;
    const a = g.auto;
    const buf = new Uint16Array(4);
    gfx.renderer.readRenderTargetPixels(a.rtA, 0, 0, 1, 1, buf);
    const h = (x) => {
      const s = x >> 15, e = (x >> 10) & 31, m = x & 1023;
      const v = e === 0 ? m * 2 ** -24 : e === 31 ? NaN : (1 + m / 1024) * 2 ** (e - 15);
      return s ? -v : v;
    };
    const u = g.uniforms;
    const ex = u.get('exposure').value * u.get('lookExposure').value;
    const op = u.get('operator')?.value; const lk = u.get('lookExposure').value; const key2 = h(buf[1]) + Math.log(lk); let d = op ? op.x - key2 : 0; d = Math.sign(d) * Math.max(Math.abs(d) - (op ? op.z : 0), 0); const k = op ? Math.exp(Math.min(0.9, Math.max(-0.3, d * op.y))) : 0;
    return { adapted: h(buf[0]), ref: h(buf[1]), exposure: ex, key: h(buf[1]) + Math.log(ex), lookKey: key2, opStrength: op ? op.y : 0, opGain: k };
  });
  console.log(cam.padEnd(10), Object.entries(r).map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(3) : v}`).join('  '));
}
await browser.close();
