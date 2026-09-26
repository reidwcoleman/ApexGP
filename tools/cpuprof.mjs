// CPU profile (V8 sampling profiler over CDP) of one JS expression, summarised by self time
// and by total time per function.
//   node tools/cpuprof.mjs "/?track=monza" "await __game.travelAsync('spa')" [--top 40] [--pre "js"]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const path = args[0] ?? '/?track=monza';
const expr = args[1] ?? "await __game.travelAsync('spa')";
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const top = Number(opt('top', 40));
const pre = opt('pre', null);
const callersOf = opt('callers', null);

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
await page.addInitScript(() => {
  try {
    localStorage.setItem('apexgp.settings', JSON.stringify({ v: 99, quality: 'high', camera: 'chase', volume: 0, autoQuality: false }));
  } catch {}
});
await page.goto(`http://localhost:5191${path}${path.includes('?') ? '&' : '?'}settle=300`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
if (pre) await page.evaluate(`(async () => { ${pre} })()`);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const t0 = Date.now();
const r = await page.evaluate(`(async () => { const v = ${expr.startsWith('await') ? `(${expr.slice(6)})` : expr}; await v; return 1; })()`);
const wall = Date.now() - t0;
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
const counts = new Map();
profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const name = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${n.callFrame.lineNumber + 1}`;
const total = new Map();
for (const [id, us] of counts) {
  const n = byId.get(id);
  const k = name(n);
  self.set(k, (self.get(k) ?? 0) + us);
  // add to every distinct ancestor function once
  const seen = new Set();
  for (let p = id; p !== undefined; p = parent.get(p)) {
    const kk = name(byId.get(p));
    if (seen.has(kk)) continue;
    seen.add(kk);
    total.set(kk, (total.get(kk) ?? 0) + us);
  }
}
const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`).join('\n');
console.log('wall', wall, 'ms  result', r);
if (callersOf) {
  // self time of matching functions, attributed to the nearest caller outside three.js internals
  const acc = new Map();
  for (const [id, us] of counts) {
    const n = byId.get(id);
    if (!(n.callFrame.functionName || '').includes(callersOf)) continue;
    const chain = [];
    for (let p = parent.get(id); p !== undefined && chain.length < 6; p = parent.get(p)) {
      const pn = byId.get(p);
      if ((pn.callFrame.functionName || '').includes(callersOf)) continue;
      chain.push(name(pn));
    }
    const k = chain.slice(0, 3).join(' <- ');
    acc.set(k, (acc.get(k) ?? 0) + us);
  }
  console.log('--- callers of', callersOf);
  console.log([...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`).join('\n'));
}
console.log('--- self');
console.log(fmt(self));
console.log('--- total');
console.log(fmt(total));
await browser.close();
