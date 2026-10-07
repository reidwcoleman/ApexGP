// Is the generated-image cache (IndexedDB apex-pixels) filled after a boot, and used on the next? node tools/pixcheck.mjs [port=5192]
import { chromium } from 'playwright-core';
import fs from 'fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [port = '5194'] = process.argv.slice(2);
const dir = fs.mkdtempSync('/tmp/apexpix-');
const ctx = await chromium.launchPersistentContext(dir, { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 800 }, args: [ANGLE] });
const stored = (page) => page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  if (!dbs.some((d) => d.name === 'apex-pixels')) return 'no db';
  return new Promise((res) => { const rq = indexedDB.open('apex-pixels'); rq.onsuccess = () => { const db = rq.result; if (!db.objectStoreNames.contains('img')) return res('no store'); const c = db.transaction('img', 'readonly').objectStore('img').getAllKeys(); c.onsuccess = () => res(c.result.length + ' images'); }; });
});
for (let i = 0; i < 2; i++) {
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${port}/?track=monza`);
  await page.waitForFunction(() => window.__game?.bootMs > 0, null, { timeout: 240000 });
  console.log(`boot ${i + 1}`, JSON.stringify(await page.evaluate(() => window.__game.bootSteps)));
  for (let s = 0; s < 4; s++) { await page.waitForTimeout(4000); console.log('  ', await stored(page)); }
  await page.close();
}
await ctx.close();
