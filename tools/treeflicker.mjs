// Shimmer of a still view: src/dev/nature.html held on a fixed 60 Hz clock (requestAnimationFrame
// stepped one frame at a time, as tools/treeseq.mjs), N consecutive frames saved, and the mean
// absolute change from one frame to the next printed for the whole frame and for its top half
// (where the crowns are). A still camera: what changes is wind, leaf flutter — and any noise that
// crawls (hashed alpha, dithers, specular sparkle), which is what an A/B of two builds shows.
//   node tools/treeflicker.mjs <outdir> [ports=5893,5805] [frames=6] "<nature.html query>"   (env W, H)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import { mkdirSync } from 'node:fs';
const [out = 'shots/flicker', portsArg = '5893,5805', framesArg = '6', query = 'track=monza&s=1500&lat=-8&h=1.5&ahead=10&llat=-40&lh=8&weather=rain'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const port of portsArg.split(',')) {
  const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1600), height: Number(process.env.H ?? 900) }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const vf = { hold: false, queue: [], t: 0 };
    window.__vf = vf;
    window.requestAnimationFrame = (cb) => {
      if (!vf.hold) return raf((t) => { vf.t = t; cb(t); });
      vf.queue.push(cb);
      return vf.queue.length;
    };
    window.__step = (n = 1) => new Promise((res) => {
      const one = () => raf(() => {
        vf.t += 1000 / 60;
        for (const cb of vf.queue.splice(0)) cb(vf.t);
        if (--n > 0) one(); else raf(() => res());
      });
      one();
    });
  });
  await page.goto(`http://localhost:${port}/src/dev/nature.html?${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => (window.__vf.hold = true));
  await page.evaluate(() => window.__step(30));
  const shots = [];
  for (let i = 0; i < Number(framesArg); i++) {
    await page.evaluate(() => window.__step(1));
    shots.push(await page.screenshot({ path: `${out}/${port}_${i}.png` }));
    // pixel data for the diff: read back from the PNG via the page (no image library in node)
  }
  const diffs = await page.evaluate(async (pngs) => {
    const load = (b64) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + b64; });
    const ims = await Promise.all(pngs.map(load));
    const w = ims[0].width, h = ims[0].height;
    const cv = new OffscreenCanvas(w, h);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const px = ims.map((im) => { cx.drawImage(im, 0, 0); return cx.getImageData(0, 0, w, h).data.slice(); });
    const out = [];
    for (let i = 1; i < px.length; i++) {
      let all = 0, top = 0;
      for (let p = 0; p < w * h * 4; p += 4) {
        const d = (Math.abs(px[i][p] - px[i - 1][p]) + Math.abs(px[i][p + 1] - px[i - 1][p + 1]) + Math.abs(px[i][p + 2] - px[i - 1][p + 2])) / 3;
        all += d;
        if (p < (w * h * 4) / 2) top += d;
      }
      out.push([all / (w * h), top / ((w * h) / 2)]);
    }
    return out;
  }, shots.map((b) => b.toString('base64')));
  const m = (k) => (diffs.reduce((a, d) => a + d[k], 0) / diffs.length).toFixed(2);
  console.log(port, `mean |Δ| per frame: frame ${m(0)}, top half ${m(1)}  (${diffs.map((d) => d[1].toFixed(2)).join(' ')})`);
  await page.close();
}
await browser.close();
