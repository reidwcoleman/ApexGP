// A returning player's boot on the production build (vite preview on :5194): boots twice in one profile
// (the second has the livery / fan caches and the GPU shader cache warm) and CPU-profiles the second.
//   npm run build && npx vite preview --port 5194 & node tools/bootwarm.mjs [track]
import { chromium } from 'playwright-core';
import fs from 'fs';
const [track = 'monza'] = process.argv.slice(2);
const dir = fs.mkdtempSync('/tmp/apexwarm-');
const ctx = await chromium.launchPersistentContext(dir, { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport: { width: 1440, height: 900 }, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (let i = 0; i < 2; i++) {
  const page = await ctx.newPage();
  let cdp = null;
  if (i === 1) {
    cdp = await ctx.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  const t0 = Date.now();
  await page.goto(process.env.URL ?? `http://localhost:5194/?track=${track}`);
  await page.waitForFunction(() => window.__game?.bootMs > 0, null, { timeout: 240000 });
  const wall = Date.now() - t0;
  const r = await page.evaluate(() => ({ boot: window.__game.bootMs, steps: window.__game.bootSteps, world: window.__game.worldTimes, warm: window.__game.warmTimes }));
  console.log(`boot ${i + 1}: page→ready ${wall} ms`, JSON.stringify(r));
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const counts = new Map();
    profile.samples.forEach((id, k) => counts.set(id, (counts.get(id) || 0) + (profile.timeDeltas[k] || 0)));
    const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0].split('?')[0]}:${n.callFrame.lineNumber}`;
    const incl = new Map(), self = new Map();
    for (const [id, t] of counts) {
      self.set(key(byId.get(id)), (self.get(key(byId.get(id))) || 0) + t);
      const seen = new Set();
      for (let x = id; x !== undefined; x = parent.get(x)) { const k = key(byId.get(x)); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + t); }
    }
    console.log('--- self (ms)');
    for (const [k, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(Math.round(t / 1000)).padStart(6), k);
    console.log('--- inclusive, named (ms)');
    for (const [k, t] of [...incl].sort((a, b) => b[1] - a[1]).filter(([k]) => !k.startsWith('(') && !/^\S+ index-/.test(k) || /index-/.test(k)).slice(0, Number(process.env.N ?? 50))) console.log(String(Math.round(t / 1000)).padStart(6), k);
  }
  await page.waitForTimeout(i === 0 ? 14000 : 500);
  await page.close();
}
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
