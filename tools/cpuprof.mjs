import { chromium } from 'playwright-core';
const [from='spa', to='monza'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:5191/?track=${from}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const r = await page.evaluate(async (id) => { await window.__game.travelAsync(id); return window.__game.worldTimes; }, to);
const { profile } = await cdp.send('Profiler.stop');
console.log(JSON.stringify(r));
// self time per function
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas; 
const counts = new Map();
profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)));
for (const [id, t] of counts) { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0]}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + t); }
const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 40);
for (const [k, t] of top) console.log((t / 1000).toFixed(0).padStart(6), 'ms', k);
// inclusive time per function (a function counted once per sample even if recursive)
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map();
for (const [id, t] of counts) {
  const seenK = new Set();
  for (let x = id; x !== undefined; x = parent.get(x)) {
    const n = byId.get(x);
    const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0]}:${n.callFrame.lineNumber}`;
    if (seenK.has(k)) continue;
    seenK.add(k);
    incl.set(k, (incl.get(k) || 0) + t);
  }
}
console.log('--- inclusive');
for (const [k, t] of [...incl].sort((a, b) => b[1] - a[1]).filter(([k]) => !k.startsWith('(') && !k.includes('three.module')).slice(0, Number(process.env.N ?? 60))) console.log((t / 1000).toFixed(0).padStart(6), 'ms', k);
await browser.close();
