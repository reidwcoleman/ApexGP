// Main-thread cost of Game.frame per frame during a demo race (CPU side only), plus the
// self-time profile of the frames that spike.  node tools/_cpuframes.mjs [track] [secs] [port]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', secs = '20', port = '5191'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}/?track=${track}&demo=race&cam=${process.env.CAM ?? 'chase'}&skip=20&weather=${process.env.WX ?? 'clear'}&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.waitForTimeout(3000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
await page.evaluate(() => {
  const g = window.__game;
  const f = g.frame.bind(g);
  window.__ft = [];
  g.frame = (dt) => { const t = performance.now(); f(dt); const e = performance.now(); window.__ft.push([t, e - t]); };
});
await cdp.send('Profiler.start');
// a marker the profile can be aligned on: a busy function at a known performance.now()
await page.evaluate(() => { window.__mark = performance.now(); (function APEXMARKER() { const t = performance.now(); while (performance.now() - t < 6); })(); });
await page.waitForTimeout(Number(secs) * 1000);
const { profile } = await cdp.send('Profiler.stop');
const ft = await page.evaluate(() => ({ ft: window.__ft, mark: window.__mark }));
const d = ft.ft.map((x) => x[1]).sort((a, b) => a - b);
const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(1);
console.log(`frames ${d.length} cpu p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${d[d.length - 1].toFixed(1)}  >12ms ${d.filter((x) => x > 12).length} >20ms ${d.filter((x) => x > 20).length}`);
// self time per function, overall and in the spiking frames (aligned by the profile's own clock:
// its endTime is "now" in µs of the same monotonic clock as performance.now()+timeOrigin is not, so
// align on the window end instead)
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
let t = profile.startTime;
const times = profile.timeDeltas.map((x) => (t += x));
const markIdx = profile.samples.findIndex((id) => byId.get(id).callFrame.functionName === 'APEXMARKER');
const off = times[markIdx] / 1000 - ft.mark;
const spikes = ft.ft.filter((x) => x[0] > ft.mark).filter((x) => x[1] > Number(process.env.SPIKE ?? 14));
const inSpike = (us) => { const ms = us / 1000 - off; return spikes.some(([s, l]) => ms >= s && ms <= s + l); };
const all = new Map(), sp = new Map(), spIncl = new Map();
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
profile.samples.forEach((id, i) => {
  const k = key(byId.get(id));
  const dt = profile.timeDeltas[i] / 1000;
  all.set(k, (all.get(k) ?? 0) + dt);
  if (inSpike(times[i])) {
    sp.set(k, (sp.get(k) ?? 0) + dt);
    const seen = new Set();
    for (let x = id; x !== undefined; x = parent.get(x)) { const kk = key(byId.get(x)); if (seen.has(kk)) continue; seen.add(kk); spIncl.set(kk, (spIncl.get(kk) ?? 0) + dt); }
  }
});
console.log('--- self, all frames (ms)');
for (const [k, v] of [...all].filter(([k]) => !k.startsWith('(idle') && !k.startsWith('(program')).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(v.toFixed(0).padStart(6), k);
console.log(`--- self, in ${spikes.length} spike frames (ms)`);
for (const [k, v] of [...sp].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(v.toFixed(0).padStart(6), k);
console.log('--- inclusive in spike frames, game code (ms)');
for (const [k, v] of [...spIncl].filter(([k]) => !/three\.|^\(|chunk-|_cpuframes/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.N ?? 40))) console.log(v.toFixed(0).padStart(6), k);
await browser.close();
