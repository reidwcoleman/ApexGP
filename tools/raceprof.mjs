// CPU profile of a live race (main thread): self and inclusive time per function over N seconds.
//   node tools/raceprof.mjs [track] [secs=6] [cam=chase]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', secs = '6', cam = 'chase'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:5191/?track=${track}&demo=race&cam=${cam}&skip=30&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.waitForTimeout(2000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
await cdp.send('Profiler.start');
const frames = await page.evaluate(async (ms) => { let n = 0; const t0 = performance.now(); await new Promise((res) => { const f = () => { n++; performance.now() - t0 < ms ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }); return n; }, Number(secs) * 1000);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const counts = new Map();
profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (profile.timeDeltas[i] || 0)));
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0].split('?')[0]}:${n.callFrame.lineNumber}`;
const self = new Map(), incl = new Map();
let total = 0, idle = 0;
for (const [id, t] of counts) {
  total += t;
  const n = byId.get(id);
  if (n.callFrame.functionName === '(idle)') idle += t;
  self.set(key(n), (self.get(key(n)) || 0) + t);
  const seen = new Set();
  for (let x = id; x !== undefined; x = parent.get(x)) { const k = key(byId.get(x)); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + t); }
}
const per = (t) => (t / 1000 / frames).toFixed(2);
console.log(`${frames} frames in ${secs}s (${(frames / secs).toFixed(1)} fps); busy ${per(total - idle)} ms/frame, idle ${per(idle)} ms/frame`);
console.log('--- inclusive ms/frame');
for (const [k, t] of [...incl].sort((a, b) => b[1] - a[1]).filter(([k]) => !k.startsWith('(')).slice(0, Number(process.env.N ?? 45))) console.log(per(t).padStart(7), k);
console.log('--- self ms/frame');
for (const [k, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(per(t).padStart(7), k);
await browser.close();
