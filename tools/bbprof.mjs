// Bluebird profiler: boots headless, runs an optional setup script file, CPU-profiles a few seconds and prints the hottest functions.
//   node tools/bbprof.mjs [setup.js] [seconds]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [setup, secs = '4'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:5321/bluebird.html?fresh');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
if (setup) await page.evaluate(readFileSync(setup, 'utf8'));
await page.waitForTimeout(3000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');
await page.waitForTimeout(+secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); });
const total = [...self.values()].reduce((a, b) => a + b, 0);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log((v / total * 100).toFixed(1).padStart(5) + '%', k);
await browser.close();
