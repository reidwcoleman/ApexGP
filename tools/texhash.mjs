// Hash every 8-bit DataTexture the finished circuit uses (the ground pack — asphalt, macro, macroN,
// gravel, fence — the env noise and detail normal, …): proves that moving texture generation (e.g.
// into the ground worker) left the pixels identical. Run it against two builds and diff the output.
//   node tools/texhash.mjs [port=5191] [track=monza] [--warm]
// --warm: hash a second visit in the same browser context (textures read back from the caches)
import { chromium } from 'playwright-core';
const [port = '5191', track = 'monza'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const warm = process.argv.includes('--warm');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
let page;
for (let v = 0; v < (warm ? 2 : 1); v++) {
  if (page) {
    await page.waitForTimeout(12000); // (idle-time cache writes)
    await page.close();
  }
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/?track=${track}&settle=0`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000, polling: 500 });
}
const out = await page.evaluate(() => {
  const seen = new Set();
  const rows = [];
  const visit = (t) => {
    if (!t?.isDataTexture || seen.has(t)) return;
    seen.add(t);
    const d = t.image?.data;
    if (!(d instanceof Uint8Array) && !(d instanceof Uint8ClampedArray)) return;
    let a = 2166136261 >>> 0;
    for (let i = 0; i < d.length; i++) a = Math.imul(a ^ d[i], 16777619) >>> 0;
    rows.push(`${t.image.width}x${t.image.height} ${t.colorSpace || '-'} ${t.anisotropy} ${a.toString(16)}${t.name ? ' ' + t.name : ''}`);
  };
  window.__game.scene.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const v of Object.values(m)) visit(v);
      if (m.uniforms) for (const k in m.uniforms) visit(m.uniforms[k]?.value);
      // (and the uniforms an onBeforeCompile patch added: three keeps them with the material's program)
      const pu = window.__game.gfx.renderer.properties.get(m)?.uniforms;
      if (pu) for (const k in pu) visit(pu[k]?.value);
    }
  });
  return rows.sort();
});
// (one line per distinct texture content: some sets — the flood fields — are many copies of one image)
console.log([...new Set(out)].join('\n'));
await browser.close();
