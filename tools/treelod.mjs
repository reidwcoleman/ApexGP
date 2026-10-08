// Tree LOD match (src/dev/treelod.html): each prototype's LOD0 / LOD1 / LOD2 against its impostor —
// coverage as a share of the impostor's (1.00 = the same crown density as the full scan) and the mean
// luminance of what each covers. A hand-over that pops shows up as a ratio far from 1 or a jump in L.
//   node tools/treelod.mjs [protos=0,1,2,5,6] [dists=35,55,90] ["variant query", …]   (env PORT, H)
//   node tools/treelod.mjs calib            solve each prototype's impostor colour gain (IMP_GAIN in
//                                           treematerial.ts) against its LOD2 at the hand-over distance
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [protos = '0,1,2,3,4,5,6,9', dists = '35,55,90', ...variants] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: Number(process.env.H ?? 1080) }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const measure = async (query) => {
  await page.goto(`http://localhost:${process.env.PORT ?? 5805}/src/dev/treelod.html?key=1&${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  return page.evaluate(() => window.__info);
};
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
if (protos === 'calib') {
  const IDS = ['jacaranda', 'dome', 'gnarl', 'umbrella', 'poplar', 'spruce_a', 'fir_a', 'fir_b', 'fir_c', 'shrub_a', 'shrub_b', 'shrub_c'];
  const out = {};
  for (let p = 0; p < IDS.length; p++) {
    const d = IDS[p].startsWith('fir') || IDS[p].startsWith('spruce') ? 52 : IDS[p].startsWith('shrub') ? 40 : 89;
    let gain = [1, 1, 1];
    for (let it = 0; it < 3; it++) {
      const a = [0, 0, 0], b = [0, 0, 0];
      for (const az of [0, 90, 180, 270]) {
        const j = await measure(`p=${p}&d=${d}&az=${az}&ig=${gain.join(',')}`);
        for (let c = 0; c < 3; c++) {
          a[c] += lin(j.info[2].rgb[c]);
          b[c] += lin(j.info[3].rgb[c]);
        }
      }
      console.log(IDS[p], 'iter', it, 'lod2/imp', a.map((x, c) => (x / b[c]).toFixed(3)).join(','));
      gain = gain.map((g, c) => +(g * Math.min(2.5, Math.max(0.4, a[c] / b[c]))).toFixed(3));
    }
    out[IDS[p]] = gain;
  }
  console.log(JSON.stringify(out));
} else {
  for (const v of variants.length ? variants : ['']) {
    for (const d of dists.split(','))
      for (const p of protos.split(',')) {
        const j = await measure(`p=${p}&d=${d}&${v}`);
        const i = j.info[3].cover;
        console.log((v || 'default').padEnd(30), String(d).padStart(4), j.proto.padEnd(10), j.info.map((c) => `${c.col} ${(c.cover / i).toFixed(2)} L${c.lum.toFixed(0)}`).join(' | '));
      }
  }
}
await browser.close();
