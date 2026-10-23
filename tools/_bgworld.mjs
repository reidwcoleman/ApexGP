// CPU profile of the circuit built behind the garage (garage → world ready) on the production build,
// second (warm-cache) boot. npm run build && npx vite preview --port 5194 & node tools/_bgworld.mjs [track]
import { chromium } from 'playwright-core';
import fs from 'fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza'] = process.argv.slice(2);
const dir = fs.mkdtempSync('/tmp/apexbg-');
const ctx = await chromium.launchPersistentContext(dir, { executablePath: CHROME, headless: true, viewport: { width: 1440, height: 900 }, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
for (let i = 0; i < 2; i++) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (i === 1) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  await page.goto(`http://localhost:${process.env.PORT ?? 5194}/?track=${track}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  const r = await page.evaluate(() => ({ world: window.__game.worldTimes, marks: Object.fromEntries(performance.getEntriesByType('mark').filter((e) => e.name.startsWith('apex')).map((e) => [e.name, Math.round(e.startTime)])) }));
  console.log(`boot ${i + 1}`, JSON.stringify(r));
  if (i === 1) {
    const { profile } = await cdp.send('Profiler.stop');
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const counts = new Map();
    profile.samples.forEach((id, k) => counts.set(id, (counts.get(id) || 0) + (profile.timeDeltas[k] || 0)));
    const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0].split('?')[0].replace(/-[\w-]{8}\.js/, '')}:${n.callFrame.lineNumber}`;
    const incl = new Map(), self = new Map();
    for (const [id, t] of counts) {
      self.set(key(byId.get(id)), (self.get(key(byId.get(id))) || 0) + t);
      const seen = new Set();
      for (let x = id; x !== undefined; x = parent.get(x)) { const k = key(byId.get(x)); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + t); }
    }
    console.log('--- self (ms)');
    for (const [k, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(String(Math.round(t / 1000)).padStart(6), k);
    console.log('--- inclusive (ms)');
    for (const [k, t] of [...incl].sort((a, b) => b[1] - a[1]).filter(([k]) => !k.startsWith('(')).slice(0, Number(process.env.N ?? 60))) console.log(String(Math.round(t / 1000)).padStart(6), k);
  }
  await page.waitForTimeout(i === 0 ? 8000 : 200);
  await page.close();
}
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
