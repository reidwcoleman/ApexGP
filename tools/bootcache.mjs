// Boot twice in one browser profile with the generated-image cache on: the second boot should
// skip painting liveries and the fan atlas. node tools/bootcache.mjs
import { chromium } from 'playwright-core';
import fs from 'fs';
import { CHROME, ANGLE } from './chrome.mjs';
const dir = fs.mkdtempSync('/tmp/apexprof-');
const ctx = await chromium.launchPersistentContext(dir, { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 800 }, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
for (let i = 0; i < 2; i++) {
  const page = await ctx.newPage();
  await page.goto('http://localhost:5191/?track=melbourne&pixcache');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const r = await page.evaluate(() => ({ steps: window.__game.bootSteps, world: window.__game.worldTimes }));
  console.log(`boot ${i + 1}`, JSON.stringify(r));
  await page.waitForTimeout(12000); // idle encode + store
  await page.close();
}
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
