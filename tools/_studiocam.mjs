// Studio framing sheet for the onboard lenses (src/dev/car.html): each view is
// name=px,py,pz/dx,dy,dz/fov[/extra query] in the car's frame; one browser, one page per view.
//   PORT=5803 node tools/_studiocam.mjs <outdir> 'tcam=0,0.985,-0.2/0,-0.07,1/56' ...
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import { mkdirSync } from 'node:fs';
const [out, ...views] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const v of views) {
  const name = v.slice(0, v.indexOf('=')), spec = v.slice(v.indexOf('=') + 1);
  const [p, d, fov, extra = ''] = spec.split('/');
  const P = p.split(',').map(Number), D = d.split(',').map(Number);
  const n = Math.hypot(...D);
  const L = P.map((x, i) => x + (D[i] / n) * 20);
  const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1920), height: Number(process.env.H ?? 1080) } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // (the extra query first: the page reads the first of a repeated key, so it can override the team)
  await page.goto(`http://localhost:${process.env.PORT ?? 5803}/src/dev/car.html?x=1${extra}&team=${process.env.TEAM ?? 'rossa'}&cam=${P.join(',')}&look=${L.map((x) => x.toFixed(3)).join(',')}&fov=${fov}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
  console.log('saved', name);
}
await browser.close();
