import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`http://localhost:5191/?track=${process.argv[2]}&demo=race&skip=5`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
  const out = {};
  window.__game.scene.traverse((o) => { if (o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) { const k = (o.parent?.name||'?')+'/'+(o.name||'?')+(o.isInstancedMesh?'[I]':o.isBatchedMesh?'[B]':'[S]'); out[k]=(out[k]??0)+(o.count??1); } });
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
