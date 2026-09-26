// GPU time per frame on a page (timer query spanning rAF to rAF). node tools/_cargpu.mjs "<path>" [w h]
import { chromium } from 'playwright-core';
const [path, W = '1600', H = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191${path}`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => console.log('no ready'));
const r = await page.evaluate(async () => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return 'no ext';
  const samples = [];
  const pend = [];
  let q = null;
  await new Promise((res) => {
    let n = 0;
    const f = () => {
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pend.push(q); }
      while (pend.length && gl.getQueryParameter(pend[0], gl.QUERY_RESULT_AVAILABLE)) { const p = pend.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) samples.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6); }
      if (++n > 150) { res(); return; }
      q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  const s = samples.sort((a, b) => a - b);
  return { n: s.length, med: +s[Math.floor(s.length / 2)].toFixed(2), p10: +s[Math.floor(s.length * 0.1)].toFixed(2) };
});
console.log(path, JSON.stringify(r));
await browser.close();
