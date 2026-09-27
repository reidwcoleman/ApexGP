import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await page.goto('http://localhost:5191/?track=melbourne');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const { profile } = await cdp.send('Profiler.stop');
// self time per function
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
  self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000);
}
// total (inclusive) per function name+file
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const seen = new Set();
  let id = profile.samples[i];
  while (id !== undefined) {
    const n = byId.get(id);
    const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}`;
    if (!seen.has(k)) { incl.set(k, (incl.get(k) ?? 0) + (dt[i] ?? 0) / 1000); seen.add(k); }
    id = parent.get(id);
  }
}
console.log('--- self');
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => v.toFixed(0).padStart(6) + '  ' + k).join('\n'));
console.log('--- inclusive');
console.log([...incl].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([k, v]) => v.toFixed(0).padStart(6) + '  ' + k).join('\n'));
await browser.close();
