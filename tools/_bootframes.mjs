// The long frames of a boot (garage up, world building behind it) and of the start of a race, each
// attributed to the game functions that ran in it (CPU profile aligned on a marker).
//   node tools/_bootframes.mjs [track] [port] [minMs=80]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', port = '5191', minMs = '80'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
if (!process.env.COLD) {
  await page.goto(`http://localhost:${port}/?track=${track}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
}
await page.addInitScript(() => {
  window.__gaps = [];
  let last = 0;
  const f = (t) => { if (last) window.__gaps.push([last, t - last]); last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
  window.__markAt = performance.now();
  (function APEXMARKER() { const t = performance.now(); while (performance.now() - t < 8); })();
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await page.goto(`http://localhost:${port}/?track=${track}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
const tReady = await page.evaluate(() => performance.now());
if (!process.env.NORACE) {
  await page.evaluate(() => window.__game.debugStart({ camera: 'chase' }));
  await page.waitForTimeout(6000);
}
const { profile } = await cdp.send('Profiler.stop');
const { gaps, mark } = await page.evaluate(() => ({ gaps: window.__gaps, mark: window.__markAt }));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
let t = profile.startTime;
const times = profile.timeDeltas.map((x) => (t += x));
const mi = profile.samples.findIndex((id) => byId.get(id).callFrame.functionName === 'APEXMARKER');
if (mi < 0) { console.log('no marker in profile'); process.exit(1); }
const off = times[mi] / 1000 - mark;
const long = gaps.filter((g) => g[1] > Number(minMs));
const total = (arr) => arr.reduce((s, g) => s + g[1], 0);
console.log(`ready at ${(tReady / 1000).toFixed(1)} s; frames ${gaps.length}; long (>${minMs} ms) ${long.length}, ${(total(long) / 1000).toFixed(1)} s in them; worst ${Math.max(...gaps.map((g) => g[1])).toFixed(0)} ms`);
console.log(`  before ready: ${long.filter((g) => g[0] < tReady).length} long; after (race start): ${long.filter((g) => g[0] >= tReady).length} long, worst ${Math.max(0, ...gaps.filter((g) => g[0] >= tReady).map((g) => g[1])).toFixed(0)} ms`);
const skip = /three\.|^\(|chunk-|postprocessing|APEXMARKER|loop Game|frame Game/;
for (const [s, d] of long.filter((g) => !process.env.RACEONLY || g[0] >= tReady).sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP ?? 12))) {
  const incl = new Map();
  profile.samples.forEach((id, i) => {
    const ms = times[i] / 1000 - off;
    if (ms < s || ms > s + d) return;
    const dt = profile.timeDeltas[i] / 1000;
    const seen = new Set();
    for (let x = id; x !== undefined; x = parent.get(x)) { const k = key(byId.get(x)); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) ?? 0) + dt); }
  });
  const top = [...incl].filter(([k]) => !skip.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${k.split(' ')[0]}@${k.split(' ')[1]} ${v.toFixed(0)}`);
  const self = (incl.get('(idle) :0') ?? 0) + (incl.get('(program) :0') ?? 0);
  console.log(`${(s / 1000).toFixed(2)} s  ${d.toFixed(0)} ms ${s >= tReady ? '[race]' : ''} idle/prog ${self.toFixed(0)} | ${top.join(' | ')}`);
}
await browser.close();
