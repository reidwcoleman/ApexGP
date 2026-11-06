// Captures the ambient light volume from the baked world:  node tools/lastframe/volume.mjs PORT
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const port = process.argv[2] ?? '5281';
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const p = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&nolights=1`);
await p.waitForFunction(() => window.__frames > 3, null, { timeout: 120000 });
const t0 = Date.now();
const r = await p.evaluate(() => window.__capture());
console.log('captured', (Date.now() - t0) / 1000, 's', r.meta);
fs.writeFileSync('public/lastframe/volume.bin', Buffer.from(r.b64, 'base64'));
fs.writeFileSync('public/lastframe/volume.json', JSON.stringify(r.meta));
await b.close();
