// CPU profile of a boot through the background world build (until __ready), dev server names.
//   node tools/_bgprof.mjs [track] [port]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', port = '5191'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// warm the module graph first so the profile is the game, not vite transforms
if (!process.env.COLD) {
  await page.goto(`http://localhost:${port}/?track=${track}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
}
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 400 });
await cdp.send('Profiler.start');
const t0 = Date.now();
if (process.env.COLD) await page.goto(`http://localhost:${port}/?track=${track}`); else await page.reload();
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
console.log('page→ready', Date.now() - t0, JSON.stringify(await page.evaluate(() => ({ steps: window.__game.bootSteps, world: window.__game.worldTimes }))));
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const counts = new Map();
profile.samples.forEach((id, k) => counts.set(id, (counts.get(id) || 0) + (profile.timeDeltas[k] || 0)));
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0].split('?')[0]}:${n.callFrame.lineNumber + 1}`;
const incl = new Map(), self = new Map();
for (const [id, t] of counts) {
  self.set(key(byId.get(id)), (self.get(key(byId.get(id))) || 0) + t);
  const seen = new Set();
  for (let x = id; x !== undefined; x = parent.get(x)) { const k = key(byId.get(x)); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + t); }
}
console.log('--- self (ms)');
for (const [k, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.S ?? 30))) console.log(String(Math.round(t / 1000)).padStart(6), k);
console.log('--- inclusive (ms)');
const skip = /three\.module|three\.core|^\(|chunk-/;
for (const [k, t] of [...incl].sort((a, b) => b[1] - a[1]).filter(([k]) => !skip.test(k.split(' ')[1] ?? '') && !k.startsWith('(')).slice(0, Number(process.env.N ?? 80))) console.log(String(Math.round(t / 1000)).padStart(6), k);
await browser.close();
