// CPU profile of a boot (dev server), then the inclusive time of everything under one function.
//   node tools/_profsub.mjs <functionName> [port=5190] [track=monza]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [fn = 'buildGrandstands', port = '5190', track = 'monza'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await p.context().newCDPSession(p);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await p.goto(`http://localhost:${port}/?track=${track}`);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dts = profile.timeDeltas;
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dts[i] ?? 0) / 1000));
const incl = (n) => (n._incl ??= (self.get(n.id) ?? 0) + (n.children ?? []).reduce((s, c) => s + incl(byId.get(c)), 0));
const roots = profile.nodes.filter((n) => n.callFrame.functionName === fn);
let total = 0;
const agg = new Map();
const walk = (n, depth) => {
  if (depth > 0 && depth <= Number(process.env.DEPTH ?? 2)) {
    const k = `${'  '.repeat(depth - 1)}${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    agg.set(k, (agg.get(k) ?? 0) + incl(n));
  }
  if (depth < Number(process.env.DEPTH ?? 2)) for (const c of n.children ?? []) walk(byId.get(c), depth + 1);
};
for (const r of roots) { total += incl(r); walk(r, 0); }
console.log(fn, 'inclusive ms', total.toFixed(0));
for (const [k, v] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 30)) if (v > 15) console.log(v.toFixed(0).padStart(6), k);
await b.close();
